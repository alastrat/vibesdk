/**
 * The `store.translate` task: translates a store's missing text into one language, a batch of texts per step. The first
 * step reads the store's texts; each later step asks the model for one batch, checks the answers, retries what failed
 * once, and saves what is good as it lands. A text that stays bad is skipped for the task, so it can't loop. Texts that
 * already have a translation, the seller's included, are never missing, so they are never sent or overwritten.
 *
 * A language is ready for shoppers when the store has texts and at least half of the task's texts were translated; a
 * task that translated less than half fails, and a store with no texts is done without a language to serve.
 */

import { isLocale, type Locale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { TRANSLATION_BATCH_MAX_CHARS, TRANSLATION_BATCH_MAX_TEXTS, type StoreText } from '../../../shared/types/store-translations';
import { TASK_FAILED_MESSAGE, type TaskProgress } from '../../../shared/types/tasks';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { createLogger } from '../../logger';
import type { ModelCall, TaskKindHandler, TaskStepContext, TaskStepResult } from '../tasks/kinds';
import { isFlagOn } from '../posthog/flags';
import { createTaskModel, isAnswerProblem, type TaskModel } from '../tasks/task-model';
import { CHARS_PER_TOKEN } from './estimate';
import { normalizeText } from './extract';
import { buildTranslationPrompt, checkTranslation, translationSchema, type TranslationAnswer, type TranslationItem } from './prompt';
import { refreshStoreTexts, type RefreshedStoreTexts } from './texts';

const logger = createLogger('StoreTranslation');

export interface TranslatePayload {
	appId: string;
	locale: Locale;
}

/** One task per store and language: the key the queue dedupes on. */
export function translationDedupeKey(appId: string, locale: Locale): string {
	return `store.translate:${appId}:${locale}`;
}

/** How long a task waits before checking again while translations are paused. */
export const PAUSED_RECHECK_MS = 15 * 60_000;
/** Most texts a task gives up on and remembers; at this many it stops, since something is wrong with all of them. */
const MAX_SKIPPED_HASHES = 500;
/** The JSON around a text takes tokens too, and a very small batch still needs room for it. */
const ITEM_ENVELOPE_TOKENS = 12;
const MIN_OUTPUT_TOKENS = 512;
/** A text is tried this many times in a step: once, and once more with its problem named. */
const ATTEMPTS = 2;
/**
 * The batch size after 0, 1, and 2 or more failed steps in a row. A text that makes the model fail is found by taking
 * smaller batches, and set aside once it is alone.
 */
const BATCH_SIZES = [TRANSLATION_BATCH_MAX_TEXTS, 10, 1];

const TRANSLATED_TOO_LITTLE = msg("Couldn't translate most of your store's text.");

/** The store's deployments could not be read, so the task waits and tries again. */
class StoreUnavailableError extends Error {
	constructor() {
		super('The store could not be read');
	}
}

/** The model did not answer or its answer did not fit. The raw error is the `cause`, for logs, and never shown to sellers. */
class TranslationModelError extends Error {
	constructor(cause: unknown) {
		super('The translation model gave no usable answer', { cause });
	}
}

export interface TranslateKindDeps {
	model(env: Env): TaskModel;
	refresh(env: Env, appId: string): Promise<RefreshedStoreTexts>;
}

/** A text in a batch with the item the model sees for it. */
interface Pending {
	text: StoreText;
	item: TranslationItem;
}

/** A task that ends with no language to serve: nothing was read, or the store's own language was asked for. */
function nothingToTranslate(): TaskStepResult {
	return { progress: { done: 0, total: 0, skipped: 0 }, finished: true, calls: [] };
}

/** The texts that fit a batch's character limit, always at least one. */
function withinBatchChars(texts: readonly StoreText[]): StoreText[] {
	const batch: StoreText[] = [];
	let chars = 0;
	for (const text of texts) {
		if (batch.length > 0 && chars + text.text.length > TRANSLATION_BATCH_MAX_CHARS) break;
		batch.push(text);
		chars += text.text.length;
	}
	return batch;
}

/** About twice the batch's estimated tokens: the answer is as long as the batch, and longer in the other language. */
function outputTokenBudget(items: readonly TranslationItem[]): number {
	const chars = items.reduce((sum, item) => sum + item.text.length, 0);
	return Math.max(MIN_OUTPUT_TOKENS, 2 * (Math.ceil(chars / CHARS_PER_TOKEN) + items.length * ITEM_ENVELOPE_TOKENS));
}

async function ask(model: TaskModel, source: Locale, target: Locale, items: readonly TranslationItem[], calls: ModelCall[]): Promise<Map<string, string>> {
	const { system, prompt } = buildTranslationPrompt(source, target, items);
	let result: { object: TranslationAnswer; call: ModelCall };
	try {
		result = await model.generate({ system, prompt, schema: translationSchema, maxOutputTokens: outputTokenBudget(items) });
	} catch (error) {
		throw new TranslationModelError(error);
	}
	calls.push(result.call);
	const answers = new Map<string, string>();
	for (const { id, text } of result.object.items) if (!answers.has(id)) answers.set(id, normalizeText(text));
	return answers;
}

/** Splits a batch into the texts the model translated soundly and those with a problem, named for the retry. */
function judge(pending: readonly Pending[], answers: ReadonlyMap<string, string>): { good: Array<{ text: StoreText; translation: string }>; bad: Pending[] } {
	const good: Array<{ text: StoreText; translation: string }> = [];
	const bad: Pending[] = [];
	for (const { text, item } of pending) {
		const translation = answers.get(item.id);
		const problem = translation === undefined ? 'No translation was returned for this text.' : checkTranslation(item.text, translation);
		if (translation !== undefined && problem === null) good.push({ text, translation });
		else bad.push({ text, item: { id: item.id, text: item.text, problem: problem ?? undefined } });
	}
	return { good, bad };
}

/**
 * Translates one batch and saves what is good after each attempt, so a failing retry loses nothing. Returns how many
 * texts were saved and the ones still bad after the retry. A model failure throws, so the task backs off; the one
 * exception is a batch down to one text after failed steps, when the model's failure to answer for that text (not one to
 * reach the model) sets it aside.
 */
async function translateBatch(
	model: TaskModel,
	store: StoreTranslationService,
	payload: TranslatePayload,
	source: Locale,
	batch: readonly StoreText[],
	options: { setAsideUnanswerable: boolean; now: number },
): Promise<{ saved: number; failed: StoreText[]; calls: ModelCall[] }> {
	const calls: ModelCall[] = [];
	let pending: Pending[] = batch.map((text, index) => ({ text, item: { id: String(index + 1), text: text.text } }));
	let saved = 0;
	for (let attempt = 0; attempt < ATTEMPTS && pending.length > 0; attempt += 1) {
		let answers: Map<string, string>;
		try {
			answers = await ask(model, source, payload.locale, pending.map((entry) => entry.item), calls);
		} catch (error) {
			// Only a problem with the answer to this text sets it aside; reaching the model failing waits for the backoff.
			if (!options.setAsideUnanswerable || !(error instanceof TranslationModelError) || !isAnswerProblem(error.cause)) throw error;
			logger.warn('The model could not answer for a single text; skipping it', { appId: payload.appId, locale: payload.locale, hash: pending[0]?.text.hash, error: error.cause });
			break;
		}
		const { good, bad } = judge(pending, answers);
		await store.upsertMachine(payload.appId, payload.locale, good.map(({ text, translation }) => ({ hash: text.hash, source: text.text, text: translation })), options.now);
		saved += good.length;
		pending = bad;
	}
	return { saved, failed: pending.map((entry) => entry.text), calls };
}

/** Whether the store has any text, for a language with nothing missing: all of it is translated already. */
async function storeHasTexts(store: StoreTranslationService, payload: TranslatePayload): Promise<boolean> {
	return (await store.counts(payload.appId))[payload.locale].total > 0;
}

/** Reads the store's texts and says how many the language is missing. */
async function startStep(deps: TranslateKindDeps, ctx: TaskStepContext, payload: TranslatePayload): Promise<TaskStepResult> {
	const refreshed = await deps.refresh(ctx.env, payload.appId);
	if (refreshed.error === 'unavailable') throw new StoreUnavailableError();
	if (!refreshed.deployed || refreshed.count === 0) return nothingToTranslate();
	const store = new StoreTranslationService(ctx.env);
	if ((await store.settingsOf(payload.appId)).sourceLocale === payload.locale) return nothingToTranslate();
	const total = await store.countMissing(payload.appId, payload.locale);
	const progress = { done: 0, total, skipped: 0 };
	// The store has texts and every one is translated already, so the language is ready as it is.
	return total === 0 ? { progress, finished: true, calls: [], ready: true } : { progress, finished: false, calls: [] };
}

/**
 * Ends a task with nothing left to try. Half or more of its texts translated makes the language ready; less fails the
 * task, forgetting what it gave up on so that a retry takes those texts again.
 */
async function finishedStep(store: StoreTranslationService, payload: TranslatePayload, progress: TaskProgress, calls: ModelCall[]): Promise<TaskStepResult> {
	if (progress.total === 0) return { progress, finished: true, calls, ready: await storeHasTexts(store, payload) };
	if (progress.done * 2 >= progress.total) return { progress, finished: true, calls, ready: true };
	return { progress: { ...progress, skippedHashes: [] }, finished: true, calls, failed: TRANSLATED_TOO_LITTLE };
}

async function translateStep(deps: TranslateKindDeps, ctx: TaskStepContext, payload: TranslatePayload): Promise<TaskStepResult> {
	const store = new StoreTranslationService(ctx.env);
	const { sourceLocale } = await store.settingsOf(payload.appId);
	if (sourceLocale === payload.locale) return nothingToTranslate();

	const previous = ctx.task.progress;
	const gaveUp = previous.skippedHashes ?? [];
	// After failed steps the batch shrinks, down to one text, whose failure is then its own.
	const failures = ctx.task.attempts;
	const batchSize = BATCH_SIZES[Math.min(failures, BATCH_SIZES.length - 1)];
	const batch = withinBatchChars(await store.missingTexts(payload.appId, payload.locale, batchSize, gaveUp));
	const { saved, failed, calls } = await translateBatch(deps.model(ctx.env), store, payload, sourceLocale, batch, { setAsideUnanswerable: batchSize === 1, now: ctx.now });

	const skippedHashes = [...gaveUp, ...failed.map((text) => text.hash)].slice(0, MAX_SKIPPED_HASHES);
	const remaining = await store.countMissing(payload.appId, payload.locale, skippedHashes);
	// A step run again after its save was lost has already translated a batch the counts don't know about.
	const done = Math.max(previous.done + saved, previous.total - skippedHashes.length - remaining);
	const progress: TaskProgress = { done, total: done + skippedHashes.length + remaining, skipped: skippedHashes.length, skippedHashes };
	if (remaining > 0 && skippedHashes.length < MAX_SKIPPED_HASHES) return { progress, finished: false, calls };
	return finishedStep(store, payload, progress, calls);
}

export function createStoreTranslateKind(deps: TranslateKindDeps): TaskKindHandler<TranslatePayload> {
	return {
		kind: 'store.translate',
		parsePayload(raw) {
			if (typeof raw !== 'object' || raw === null) return null;
			const { appId, locale } = raw as Record<string, unknown>;
			return typeof appId === 'string' && appId !== '' && isLocale(locale) ? { appId, locale } : null;
		},
		/** The kill switch: while translations are paused no read, model call or charge is made, and the task waits to be asked again. */
		async hold(ctx) {
			return (await isFlagOn(ctx.env, 'store-translations-paused', ctx.task.userId)) ? ctx.now + PAUSED_RECHECK_MS : null;
		},
		async step(ctx, payload) {
			// The queue's owner checks were made when the task was queued; a task that names another store is not run.
			if (ctx.task.appId !== payload.appId) return { ...nothingToTranslate(), failed: TASK_FAILED_MESSAGE };
			return ctx.task.steps === 0 ? startStep(deps, ctx, payload) : translateStep(deps, ctx, payload);
		},
		async onFinished(ctx, payload, result) {
			if (result.ready === true) await new StoreTranslationService(ctx.env).markReady(payload.appId, payload.locale, ctx.now);
		},
		describeError(error) {
			if (error instanceof StoreUnavailableError) return msg("Couldn't read your store right now.");
			if (error instanceof TranslationModelError) return msg("Couldn't reach the translation service.");
			return null;
		},
	};
}

export const storeTranslateKind = createStoreTranslateKind({ model: (env) => createTaskModel(env), refresh: refreshStoreTexts });
