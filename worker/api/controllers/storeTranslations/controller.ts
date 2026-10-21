/**
 * A seller's store translations: which stores can be translated, a store's languages and settings, starting a
 * translation, and reading and correcting the translated texts. Store routes are owner-only. Every route answers 503
 * while the store-translations-paused flag is on, and refusals are worded in the seller's saved language.
 */

import type { RouteContext } from '../../types/route-context';
import { formatNumber } from '../../../../shared/i18n/format';
import { isLocale, LOCALE_NAMES, type Locale } from '../../../../shared/i18n/locales';
import { msg } from '../../../../shared/i18n/translate';
import {
	MAX_TEXT_CHARS,
	UNTOUCHED_SETTINGS_VERSION,
	STORE_TRANSLATION_PAGE_SIZE,
	type StoreTranslationOverview,
	type StoreTranslationPage,
	type StoreTranslationRow,
	type StoreTranslationRun,
	type StoreTranslationSettings,
	type StoreTranslationStoreSummary,
} from '../../../../shared/types/store-translations';
import { LiveStoreService } from '../../../database/services/LiveStoreService';
import { StoreTranslationService, isRowsCursor } from '../../../database/services/StoreTranslationService';
import { TaskService } from '../../../database/services/TaskService';
import type { AuthUser } from '../../../types/auth-types';
import { buildOverview } from '../../../services/store-translations/overview';
import { translationDedupeKey } from '../../../services/store-translations/translate-kind';
import { wakeTaskRunner } from '../../../services/tasks/scheduler';
import { taskView } from '../../../services/tasks/task-view';
import { isEmptyPatch, parseSellerText, parseSettingsPatch, type Parsed } from './requests';
import { TranslationsApiController, type Reply } from './translations-api';

/** What a request names once its store, language and the pause have been checked. */
interface Target {
	user: AuthUser;
	appId: string;
	locale: Locale;
	settings: StoreTranslationSettings;
}

const STORE_NOT_FOUND = msg('Store not found.');
const NOT_A_STORE_LANGUAGE = msg("Stores can't be translated into that language.");
const OWN_LANGUAGE = msg("{language} is this store's own language, so there is nothing to translate it into.");
const NEVER_DEPLOYED = msg('Publish or preview your store before translating it.');
const TASK_LIMIT = msg('You have too many unfinished tasks. Let some finish or cancel one, then try again.');
const BAD_CURSOR = msg("That page of texts can't be read. Reload the list.");
const NO_SUCH_TEXT = msg("That text isn't in this store.");
const NOTHING_TO_GO_BACK_TO = msg("That text hasn't been edited, or it has no earlier translation to go back to.");

const TEXT_HASH = /^[0-9a-f]{64}$/;

export class StoreTranslationsController extends TranslationsApiController {
	/** The signed-in seller's stores that have been deployed, for the page's picker. */
	static async stores(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationStoreSummary[]>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<StoreTranslationStoreSummary[]>(env, user);
			if (paused) return paused;
			return this.createSuccessResponse(await new StoreTranslationService(env).storesOf(user.id));
		} catch (error) {
			return this.handleError(error, 'list stores for translations') as Reply<StoreTranslationStoreSummary[]>;
		}
	}

	static async overview(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationOverview>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<StoreTranslationOverview>(env, user);
			if (paused) return paused;
			const appId = context.pathParams.id;
			const overview = appId ? await buildOverview(env, appId, user.id) : null;
			if (!overview) return this.refusal<StoreTranslationOverview>(env, user, 404, STORE_NOT_FOUND);
			return this.createSuccessResponse(overview);
		} catch (error) {
			return this.handleError(error, 'read store translations') as Reply<StoreTranslationOverview>;
		}
	}

	static async saveSettings(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationSettings>> {
		const user = context.user!;
		try {
			const paused = await this.pausedReply<StoreTranslationSettings>(env, user);
			if (paused) return paused;
			const appId = context.pathParams.id;
			if (!appId) return this.refusal<StoreTranslationSettings>(env, user, 404, STORE_NOT_FOUND);
			const service = new StoreTranslationService(env);
			const current = await service.settingsOf(appId);
			const body = await this.parseJsonBody<unknown>(request);
			const parsed = parseSettingsPatch(body.success ? body.data : undefined, current);
			if (!parsed.ok) return this.refusal<StoreTranslationSettings>(env, user, 400, parsed.message);
			if (current.version <= UNTOUCHED_SETTINGS_VERSION && parsed.value.sourceLocale === undefined) {
				return this.refusal<StoreTranslationSettings>(env, user, 400, msg("Choose your store's language first."));
			}
			return this.createSuccessResponse(isEmptyPatch(parsed.value) ? current : await service.saveSettings(appId, parsed.value));
		} catch (error) {
			return this.handleError(error, 'save translation settings') as Reply<StoreTranslationSettings>;
		}
	}

	/**
	 * Starts translating the store into a language, turning the language on first. The same language already queued or
	 * running answers that task with `created: false`, so two quick clicks, or a click during a publish, make one task.
	 */
	static async run(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationRun>> {
		try {
			const target = await this.targetOf<StoreTranslationRun>(env, context);
			if (target instanceof Response) return target;
			const { user, appId, locale, settings } = target;
			const [facts, live] = await Promise.all([new StoreTranslationService(env).storeFacts(appId), new LiveStoreService(env).getByApp(appId)]);
			if (!facts) return this.refusal<StoreTranslationRun>(env, user, 404, STORE_NOT_FOUND);
			if (facts.lastDeployedAt === null && live === null) return this.refusal<StoreTranslationRun>(env, user, 409, NEVER_DEPLOYED);
			if (settings.version <= UNTOUCHED_SETTINGS_VERSION) {
				return this.refusal<StoreTranslationRun>(env, user, 400, msg("Choose your store's language first."));
			}

			const queued = await new TaskService(env).enqueue({ userId: user.id, appId, kind: 'store.translate', payload: { appId, locale }, dedupeKey: translationDedupeKey(appId, locale) });
			if ('refused' in queued) return this.refusal<StoreTranslationRun>(env, user, 429, TASK_LIMIT);
			// Turned on only once the task is queued, so a refused or failed run leaves the language as it was.
			if (!settings.targets[locale]?.enabled) await new StoreTranslationService(env).saveSettings(appId, { targets: { [locale]: { enabled: true } } });
			await wakeTaskRunner(env, user.id);
			const task = taskView(queued.task);
			if (!task) throw new Error(`Task ${queued.task.id} has a payload its kind can't read`);
			return this.createSuccessResponse({ task, created: queued.created });
		} catch (error) {
			return this.handleError(error, 'start a store translation') as Reply<StoreTranslationRun>;
		}
	}

	/** A page of the store's texts with their translations into a language; `query` searches both. */
	static async texts(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationPage>> {
		try {
			const target = await this.targetOf<StoreTranslationPage>(env, context);
			if (target instanceof Response) return target;
			const cursor = context.queryParams.get('cursor') ?? undefined;
			if (cursor !== undefined && !isRowsCursor(cursor)) return this.refusal<StoreTranslationPage>(env, target.user, 400, BAD_CURSOR);
			const page = await new StoreTranslationService(env).listRows(target.appId, target.locale, {
				query: context.queryParams.get('query') ?? undefined,
				cursor,
				limit: STORE_TRANSLATION_PAGE_SIZE,
			});
			return this.createSuccessResponse(page);
		} catch (error) {
			return this.handleError(error, 'list store translations') as Reply<StoreTranslationPage>;
		}
	}

	/** Saves the seller's own words for a text, which no translation task overwrites. */
	static async saveText(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationRow>> {
		try {
			const target = await this.targetOf<StoreTranslationRow>(env, context);
			if (target instanceof Response) return target;
			const { user, appId, locale } = target;
			const hash = context.pathParams.hash ?? '';
			if (!TEXT_HASH.test(hash)) return this.refusal<StoreTranslationRow>(env, user, 404, NO_SUCH_TEXT);
			const body = await this.parseJsonBody<unknown>(request);
			const parsed: Parsed<string> = parseSellerText(body.success ? body.data : undefined);
			if (!parsed.ok) return this.refusal<StoreTranslationRow>(env, user, 400, parsed.message, (language) => ({ max: formatNumber(MAX_TEXT_CHARS, language) }));
			const service = new StoreTranslationService(env);
			if (!(await service.setSellerText(appId, locale, hash, parsed.value))) return this.refusal<StoreTranslationRow>(env, user, 404, NO_SUCH_TEXT);
			return this.rowReply(env, target, hash);
		} catch (error) {
			return this.handleError(error, 'save a seller translation') as Reply<StoreTranslationRow>;
		}
	}

	/** Gives a text back the machine's translation. */
	static async revertText(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Reply<StoreTranslationRow>> {
		try {
			const target = await this.targetOf<StoreTranslationRow>(env, context);
			if (target instanceof Response) return target;
			const { user, appId, locale } = target;
			const hash = context.pathParams.hash ?? '';
			if (!TEXT_HASH.test(hash)) return this.refusal<StoreTranslationRow>(env, user, 404, NO_SUCH_TEXT);
			if (!(await new StoreTranslationService(env).revertToMachine(appId, locale, hash))) return this.refusal<StoreTranslationRow>(env, user, 409, NOTHING_TO_GO_BACK_TO);
			return this.rowReply(env, target, hash);
		} catch (error) {
			return this.handleError(error, 'revert a seller translation') as Reply<StoreTranslationRow>;
		}
	}

	private static async rowReply(env: Env, target: Target, hash: string): Promise<Reply<StoreTranslationRow>> {
		const row = await new StoreTranslationService(env).translationOf(target.appId, target.locale, hash);
		return row ? this.createSuccessResponse(row) : this.refusal<StoreTranslationRow>(env, target.user, 404, NO_SUCH_TEXT);
	}

	/** The request's store and language once the pause is clear, or the refusal to answer with: a language Estori doesn't speak, or the store's own. */
	private static async targetOf<T>(env: Env, context: RouteContext): Promise<Target | Reply<T>> {
		const user = context.user!;
		const paused = await this.pausedReply<T>(env, user);
		if (paused) return paused;
		const appId = context.pathParams.id;
		if (!appId) return this.refusal<T>(env, user, 404, STORE_NOT_FOUND);
		const locale = context.pathParams.locale;
		if (!isLocale(locale)) return this.refusal<T>(env, user, 400, NOT_A_STORE_LANGUAGE);
		const settings = await new StoreTranslationService(env).settingsOf(appId);
		if (locale === settings.sourceLocale) return this.refusal<T>(env, user, 400, OWN_LANGUAGE, { language: LOCALE_NAMES[locale] });
		return { user, appId, locale, settings };
	}
}
