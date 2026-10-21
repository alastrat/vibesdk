/**
 * The `store.translate` task: translates a store's missing text into one language, a batch of texts per step. The first
 * step reads the store's texts; each later step asks the model for one batch, checks the answers, retries what failed
 * once, and saves what is good as it lands. A text that stays bad is skipped for the task, so it can't loop. Texts that
 * already have a translation, the seller's included, are never missing, so they are never sent or overwritten.
 */

import { isLocale, type Locale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { TRANSLATION_BATCH_MAX_CHARS, TRANSLATION_BATCH_MAX_TEXTS, type StoreText } from '../../../shared/types/store-translations';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import type { ModelCall, TaskKindHandler, TaskStepContext, TaskStepResult } from '../tasks/kinds';
import { createTaskModel, type TaskModel } from '../tasks/task-model';
import { CHARS_PER_TOKEN } from './estimate';
import { normalizeText } from './extract';
import { buildTranslationPrompt, checkTranslation, translationSchema, type TranslationItem } from './prompt';
import { refreshStoreTexts, type RefreshedStoreTexts } from './texts';

export interface TranslatePayload {
	appId: string;
	locale: Locale;
}

/** One task per store and language: the key the queue dedupes on. */
export function translationDedupeKey(appId: string, locale: Locale): string {
	return `store.translate:${appId}:${locale}`;
}

/** Most texts a task gives up on and remembers; at this many it stops, since something is wrong with all of them. */
const MAX_SKIPPED_HASHES = 500;
/** The JSON around a text takes tokens too, and a very small batch still needs room for it. */
const ITEM_ENVELOPE_TOKENS = 12;
const MIN_OUTPUT_TOKENS = 512;
/** A text is tried this many times in a step: once, and once more with its problem named. */
const ATTEMPTS = 2;

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

const NOTHING_TO_TRANSLATE: TaskStepResult = { progress: { done: 0, total: 0, skipped: 0 }, finished: true, calls: [] };

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
	let result;
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
 * texts were saved and the ones still bad after the retry. A model failure throws.
 */
async function translateBatch(
	model: TaskModel,
	store: StoreTranslationService,
	payload: TranslatePayload,
	source: Locale,
	batch: readonly StoreText[],
	now: number,
): Promise<{ saved: number; failed: StoreText[]; calls: ModelCall[] }> {
	const calls: ModelCall[] = [];
	let pending: Pending[] = batch.map((text, index) => ({ text, item: { id: String(index + 1), text: text.text } }));
	let saved = 0;
	for (let attempt = 0; attempt < ATTEMPTS && pending.length > 0; attempt += 1) {
		const answers = await ask(model, source, payload.locale, pending.map((entry) => entry.item), calls);
		const { good, bad } = judge(pending, answers);
		await store.upsertMachine(payload.appId, payload.locale, good.map(({ text, translation }) => ({ hash: text.hash, source: text.text, text: translation })), now);
		saved += good.length;
		pending = bad;
	}
	return { saved, failed: pending.map((entry) => entry.text), calls };
}

/** Reads the store's texts and says how many the language is missing. */
async function startStep(deps: TranslateKindDeps, ctx: TaskStepContext, payload: TranslatePayload): Promise<TaskStepResult> {
	const refreshed = await deps.refresh(ctx.env, payload.appId);
	if (refreshed.error === 'unavailable') throw new StoreUnavailableError();
	if (!refreshed.deployed || refreshed.count === 0) return NOTHING_TO_TRANSLATE;
	const store = new StoreTranslationService(ctx.env);
	if ((await store.settingsOf(payload.appId)).sourceLocale === payload.locale) return NOTHING_TO_TRANSLATE;
	const total = await store.countMissing(payload.appId, payload.locale);
	return { progress: { done: 0, total, skipped: 0 }, finished: total === 0, calls: [] };
}

async function translateStep(deps: TranslateKindDeps, ctx: TaskStepContext, payload: TranslatePayload): Promise<TaskStepResult> {
	const store = new StoreTranslationService(ctx.env);
	const { sourceLocale } = await store.settingsOf(payload.appId);
	if (sourceLocale === payload.locale) return NOTHING_TO_TRANSLATE;

	const previous = ctx.task.progress;
	const gaveUp = previous.skippedHashes ?? [];
	const batch = withinBatchChars(await store.missingTexts(payload.appId, payload.locale, TRANSLATION_BATCH_MAX_TEXTS, gaveUp));
	const { saved, failed, calls } = await translateBatch(deps.model(ctx.env), store, payload, sourceLocale, batch, ctx.now);

	const skippedHashes = [...gaveUp, ...failed.map((text) => text.hash)].slice(0, MAX_SKIPPED_HASHES);
	const remaining = await store.countMissing(payload.appId, payload.locale, skippedHashes);
	// A step run again after its save was lost has already translated a batch the counts don't know about.
	const done = Math.max(previous.done + saved, previous.total - skippedHashes.length - remaining);
	return {
		progress: { done, total: done + skippedHashes.length + remaining, skipped: skippedHashes.length, skippedHashes },
		finished: remaining === 0 || skippedHashes.length >= MAX_SKIPPED_HASHES,
		calls,
	};
}

export function createStoreTranslateKind(deps: TranslateKindDeps): TaskKindHandler<TranslatePayload> {
	return {
		kind: 'store.translate',
		parsePayload(raw) {
			if (typeof raw !== 'object' || raw === null) return null;
			const { appId, locale } = raw as Record<string, unknown>;
			return typeof appId === 'string' && appId !== '' && isLocale(locale) ? { appId, locale } : null;
		},
		step(ctx, payload) {
			return ctx.task.steps === 0 ? startStep(deps, ctx, payload) : translateStep(deps, ctx, payload);
		},
		async onFinished(ctx, payload) {
			const store = new StoreTranslationService(ctx.env);
			// The store's own language is never translated into, so it is never made ready.
			if ((await store.settingsOf(payload.appId)).sourceLocale === payload.locale) return;
			await store.markReady(payload.appId, payload.locale, ctx.now);
		},
		describeError(error) {
			if (error instanceof StoreUnavailableError) return msg("Couldn't read your store right now.");
			if (error instanceof TranslationModelError) return msg("Couldn't reach the translation service.");
			return null;
		},
	};
}

export const storeTranslateKind = createStoreTranslateKind({ model: (env) => createTaskModel(env), refresh: refreshStoreTexts });
