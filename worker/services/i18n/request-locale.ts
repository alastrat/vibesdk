import { isLocale, localeFromAcceptLanguage, type Locale } from '../../../shared/i18n/locales';
import type { AuthUser } from '../../types/auth-types';
import { serverT } from './server-t';
import { currentLocale as activeLocale } from '../posthog/request-scope';
import type { MessageValues } from '../../../shared/i18n/translate';
export { runWithLocale, currentLocale, setRequestLocale } from '../posthog/request-scope';

export function t(english: string, values?: MessageValues): string {
	return serverT(activeLocale()).t(english, values);
}

/** AuthUser is loaded from the account on each request and carries its saved preference. */
export async function requestLocale(_env: unknown, request: Request, user: AuthUser | null): Promise<Locale> {
	return isLocale(user?.locale) ? user.locale : localeFromAcceptLanguage(request.headers.get('Accept-Language'));
}
