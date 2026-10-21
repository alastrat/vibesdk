/**
 * What the Translations page shows for one store: its settings, how far each language is, its latest tasks, the AI
 * credits the seller has left, and where to see the store. The store's text is read again when a deploy or a publish
 * is newer than the last read.
 */

import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import type { StoreLanguageStatus, StoreTranslationOverview } from '../../../shared/types/store-translations';
import { isUnfinishedStatus, type TaskView } from '../../../shared/types/tasks';
import { getAgentStubLightweight } from '../../agents';
import { LiveStoreService, type LiveStoreRow, type StoreDomainRow } from '../../database/services/LiveStoreService';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { TaskService } from '../../database/services/TaskService';
import { createLogger } from '../../logger';
import { loadAccount, loadCredits } from '../billing/account';
import { devPortOf, storeUrl } from '../live-stores/view';
import { storeHostConfig } from '../live-stores/hosts';
import { taskView } from '../tasks/task-view';
import { estimateTranslationCredits } from './estimate';
import { refreshStoreTexts } from './texts';

const logger = createLogger('StoreTranslationsOverview');

/** The tasks read to find each language's current one. */
const RECENT_TASKS = 50;

/**
 * The page asks for the overview every few seconds while a task runs, so what a call would only repeat is remembered in
 * the isolate, keyed by store: the preview link, which is signed to last 30 minutes, and a read of the store that
 * wrote nothing.
 */
export const PREVIEW_URL_CACHE_MS = 10 * 60_000;
/** An agent that couldn't give a link, or had none yet, is asked again after this. */
const PREVIEW_URL_RETRY_MS = 60_000;
/** A read of the store's deployments that wrote nothing, an outage or a store with nothing deployed, is tried again after this. */
const READ_RETRY_MS = 60_000;
const MAX_REMEMBERED_STORES = 1_000;

const previewLinks = new Map<string, { url: string | null; until: number }>();
const unwrittenReads = new Map<string, { at: number; unavailable: boolean }>();

/** Remembers an answer for a store, forgetting the oldest once there are too many. */
function remember<T>(memory: Map<string, T>, appId: string, value: T): void {
	memory.delete(appId);
	memory.set(appId, value);
	if (memory.size > MAX_REMEMBERED_STORES) {
		const oldest = memory.keys().next();
		if (!oldest.done) memory.delete(oldest.value);
	}
}

/** Whether the store's texts were read before its latest deploy or publish, or never although it has been deployed. */
function textsAreStale(input: { extractedAt: number | null; everDeployed: boolean; lastDeployedAt: number | null; publishedAt: number | null }): boolean {
	if (input.extractedAt === null) return input.everDeployed;
	return (input.lastDeployedAt ?? 0) > input.extractedAt || (input.publishedAt ?? 0) > input.extractedAt;
}

/** The address shoppers use while the store is live: its own domain once connected, else its subdomain. */
export function liveAddressOf(env: Env, live: LiveStoreRow | null, domain: StoreDomainRow | null): string | null {
	if (live?.status !== 'live') return null;
	const devPort = devPortOf(env.CUSTOM_DOMAIN);
	if (domain?.status === 'active') return storeUrl(domain.hostname, devPort);
	const { storesDomain } = storeHostConfig(env);
	return storesDomain ? storeUrl(`${live.slug}.${storesDomain}`, devPort) : null;
}

/**
 * A link to the store's preview, which no stored address can give since it carries a signed token; null when the agent
 * can't say. The agent is asked once in ten minutes, and again after a minute when it had nothing to give.
 */
async function previewUrlOf(env: Env, appId: string, now: number): Promise<string | null> {
	const known = previewLinks.get(appId);
	if (known !== undefined && now < known.until) return known.url;
	let url: string | null = null;
	try {
		url = await (await getAgentStubLightweight(env, appId)).getPublicPreviewURL();
	} catch (error) {
		logger.warn('Could not read the store preview address', { appId, error });
	}
	remember(previewLinks, appId, { url, until: now + (url === null ? PREVIEW_URL_RETRY_MS : PREVIEW_URL_CACHE_MS) });
	return url;
}

/**
 * Reads the store's deployments again, unless an earlier read of it wrote nothing less than a minute ago: the page would
 * ask SpaceDO on every poll about a store it can't read, or one with nothing deployed. `wrote` says the texts changed.
 */
async function readTexts(env: Env, appId: string, now: number): Promise<{ unavailable: boolean; wrote: boolean }> {
	const earlier = unwrittenReads.get(appId);
	if (earlier !== undefined && now - earlier.at < READ_RETRY_MS) return { unavailable: earlier.unavailable, wrote: false };
	const refreshed = await refreshStoreTexts(env, appId, now);
	const unavailable = refreshed.error === 'unavailable';
	const wrote = !unavailable && refreshed.deployed;
	if (wrote) unwrittenReads.delete(appId);
	else remember(unwrittenReads, appId, { at: now, unavailable });
	return { unavailable, wrote };
}

/** The AI credits left, null while billing is off for the seller. */
async function creditsLeftOf(env: Env, userId: string): Promise<number | null> {
	const account = await loadAccount(env, userId);
	if (!account.billing) return null;
	return Math.max(0, (await loadCredits(env, account)).left);
}

/** The language's task: the one that is unfinished, which may be an older one the seller resumed, else its newest. */
function currentTaskOf(tasks: readonly TaskView[], locale: Locale): TaskView | null {
	const ofLanguage = tasks.filter((task) => task.kind === 'store.translate' && task.payload.locale === locale);
	return ofLanguage.find((task) => isUnfinishedStatus(task.status)) ?? ofLanguage[0] ?? null;
}

/** Null when the store doesn't exist. `ownerId` is whose tasks and credits the page shows. */
export async function buildOverview(env: Env, appId: string, ownerId: string, now: number = Date.now()): Promise<StoreTranslationOverview | null> {
	const service = new StoreTranslationService(env);
	const stores = new LiveStoreService(env);
	const [facts, live, domain, firstRead] = await Promise.all([service.storeFacts(appId), stores.getByApp(appId), stores.domainOfApp(appId), service.extraction(appId)]);
	if (!facts) return null;

	const everDeployed = facts.lastDeployedAt !== null || live !== null;
	let extraction = firstRead;
	let textsUnavailable = false;
	if (textsAreStale({ extractedAt: extraction.extractedAt, everDeployed, lastDeployedAt: facts.lastDeployedAt, publishedAt: live?.publishedAt.getTime() ?? null })) {
		const read = await readTexts(env, appId, now);
		textsUnavailable = read.unavailable;
		if (read.wrote) extraction = await service.extraction(appId);
	}
	// A store whose deployments can't be read right now is still deployed; it isn't one never deployed.
	const deployed = extraction.extractedAt !== null || (textsUnavailable && everDeployed);

	const settings = await service.settingsOf(appId);
	const targets = LOCALES.filter((locale) => locale !== settings.sourceLocale);
	const [counts, sizes, records, creditsLeft, previewUrl] = await Promise.all([
		service.counts(appId),
		Promise.all(targets.map((locale) => service.missingSize(appId, locale))),
		new TaskService(env).listForUser(ownerId, { appId, limit: RECENT_TASKS }),
		creditsLeftOf(env, ownerId),
		deployed ? previewUrlOf(env, appId, now) : null,
	]);
	const tasks = records.flatMap((record) => taskView(record) ?? []);

	const languages = targets.map((locale, index): StoreLanguageStatus => {
		const { total, translated, edited } = counts[locale];
		const size = sizes[index];
		return {
			locale,
			enabled: settings.targets[locale]?.enabled ?? false,
			ready: settings.targets[locale]?.ready ?? false,
			total,
			translated,
			edited,
			left: Math.max(0, total - translated),
			estimateCredits: estimateTranslationCredits(size.chars, size.count),
			task: currentTaskOf(tasks, locale),
		};
	});

	return {
		settings,
		languages,
		extractedAt: extraction.extractedAt === null ? null : new Date(extraction.extractedAt).toISOString(),
		truncated: extraction.truncated,
		manifestInvalid: extraction.manifestInvalid,
		deployed,
		textsUnavailable,
		creditsLeft,
		previewUrl,
		liveUrl: liveAddressOf(env, live, domain),
	};
}
