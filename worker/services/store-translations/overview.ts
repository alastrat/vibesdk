/**
 * What the Translations page shows for one store: its settings, how far each language is, its latest tasks, the AI
 * credits the seller has left, and where to see the store. The store's text is read again when a deploy or a publish
 * is newer than the last read.
 */

import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import type { StoreLanguageStatus, StoreTranslationOverview } from '../../../shared/types/store-translations';
import type { TaskView } from '../../../shared/types/tasks';
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
import { refreshStoreTexts, type RefreshedStoreTexts } from './texts';

const logger = createLogger('StoreTranslationsOverview');

/** The tasks read to find each language's latest. */
const RECENT_TASKS = 50;

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

/** A link to the store's preview, which no stored address can give since it carries a signed token; null when the agent can't say. */
async function previewUrlOf(env: Env, appId: string): Promise<string | null> {
	try {
		return await (await getAgentStubLightweight(env, appId)).getPublicPreviewURL();
	} catch (error) {
		logger.warn('Could not read the store preview address', { appId, error });
		return null;
	}
}

/** The AI credits left, null while billing is off for the seller. */
async function creditsLeftOf(env: Env, userId: string): Promise<number | null> {
	const account = await loadAccount(env, userId);
	if (!account.billing) return null;
	return Math.max(0, (await loadCredits(env, account)).left);
}

function latestTaskOf(tasks: readonly TaskView[], locale: Locale): TaskView | null {
	return tasks.find((task) => task.kind === 'store.translate' && task.payload.locale === locale) ?? null;
}

/** Null when the store doesn't exist. `ownerId` is whose tasks and credits the page shows. */
export async function buildOverview(env: Env, appId: string, ownerId: string, now: number = Date.now()): Promise<StoreTranslationOverview | null> {
	const service = new StoreTranslationService(env);
	const stores = new LiveStoreService(env);
	const [facts, live, domain, firstRead] = await Promise.all([service.storeFacts(appId), stores.getByApp(appId), stores.domainOfApp(appId), service.extraction(appId)]);
	if (!facts) return null;

	const everDeployed = facts.lastDeployedAt !== null || live !== null;
	let extraction = firstRead;
	let refreshed: RefreshedStoreTexts | null = null;
	if (textsAreStale({ extractedAt: extraction.extractedAt, everDeployed, lastDeployedAt: facts.lastDeployedAt, publishedAt: live?.publishedAt.getTime() ?? null })) {
		refreshed = await refreshStoreTexts(env, appId, now);
		if (!refreshed.error) extraction = await service.extraction(appId);
	}
	// A store whose deployments can't be read right now is still deployed; it isn't one never deployed.
	const textsUnavailable = refreshed?.error === 'unavailable';
	const deployed = extraction.extractedAt !== null || (textsUnavailable && everDeployed);

	const settings = await service.settingsOf(appId);
	const targets = LOCALES.filter((locale) => locale !== settings.sourceLocale);
	const [counts, sizes, records, creditsLeft, previewUrl] = await Promise.all([
		service.counts(appId),
		Promise.all(targets.map((locale) => service.missingSize(appId, locale))),
		new TaskService(env).listForUser(ownerId, { appId, limit: RECENT_TASKS }),
		creditsLeftOf(env, ownerId),
		deployed ? previewUrlOf(env, appId) : null,
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
			task: latestTaskOf(tasks, locale),
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
