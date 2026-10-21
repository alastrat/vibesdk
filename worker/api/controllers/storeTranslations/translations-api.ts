/** What every route of the translations and tasks API shares: the pause, and refusals worded in the seller's language. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { Locale } from '../../../../shared/i18n/locales';
import type { MessageValues } from '../../../../shared/i18n/translate';
import { STORE_TRANSLATIONS_PAUSED_MESSAGE } from '../../../../shared/types/pauses';
import type { AuthUser } from '../../../types/auth-types';
import { isFlagOn } from '../../../services/posthog/flags';
import { translateForUser } from '../../../utils/server-translate';

export type Reply<T> = ControllerResponse<ApiResponse<T>>;

export abstract class TranslationsApiController extends BaseController {
	/** The 503 to answer with while the store-translations-paused flag is on; null when the API is open. */
	protected static async pausedReply<T>(env: Env, user: AuthUser): Promise<Reply<T> | null> {
		return (await isFlagOn(env, 'store-translations-paused', user.id)) ? this.refusal<T>(env, user, 503, STORE_TRANSLATIONS_PAUSED_MESSAGE) : null;
	}

	/**
	 * An error answer worded in the seller's saved language. `english` is a `msg()` text; `values` fill its `{placeholders}`,
	 * and may be a function of the seller's language for a value written its way.
	 */
	protected static async refusal<T>(env: Env, user: AuthUser, status: number, english: string, values?: MessageValues | ((locale: Locale) => MessageValues)): Promise<Reply<T>> {
		return this.createErrorResponse<T>(await translateForUser(env, user.id, english, values), status);
	}
}
