/** After a store is published: translates its new text into each language that is on and ready, when the seller allows it. */

import { LOCALES } from '../../../shared/i18n/locales';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { TaskService } from '../../database/services/TaskService';
import { createLogger } from '../../logger';
import { isFlagOn } from '../posthog/flags';
import { wakeTaskRunner } from '../tasks/scheduler';
import { translationDedupeKey } from './translate-kind';
import { refreshStoreTexts } from './texts';

const logger = createLogger('StoreAutoTranslate');

/**
 * Queues a `store.translate` task for each language the seller turned on and finished translating, then wakes their
 * runner. A task already queued or running for a language stays the only one, and the store's texts are read again so
 * it takes the new text on its next step. Nothing here throws, so it never fails or delays the publish it follows.
 */
export async function translateAfterPublish(env: Env, appId: string, userId: string): Promise<void> {
	try {
		if (await isFlagOn(env, 'store-translations-paused', userId)) return;
		const settings = await new StoreTranslationService(env).settingsOf(appId);
		if (!settings.autoTranslate) return;
		const locales = LOCALES.filter((locale) => locale !== settings.sourceLocale && settings.targets[locale]?.enabled && settings.targets[locale]?.ready);
		if (locales.length === 0) return;

		const tasks = new TaskService(env);
		const results = [];
		for (const locale of locales) {
			results.push(await tasks.enqueue({ userId, appId, kind: 'store.translate', payload: { appId, locale }, dedupeKey: translationDedupeKey(appId, locale) }));
		}
		if (results.some((result) => 'refused' in result)) logger.warn('A seller at their task limit got no translation after publishing', { appId, userId });
		if (results.some((result) => 'task' in result && !result.created)) await refreshStoreTexts(env, appId);
		if (results.some((result) => 'task' in result)) await wakeTaskRunner(env, userId);
	} catch (error) {
		logger.error('Could not queue translations after publishing', { appId, userId, error });
	}
}
