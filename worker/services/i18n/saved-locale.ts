import { LocalePreferenceService } from '../../database/services/LocalePreferenceService';
import type { Locale } from '../../../shared/i18n/locales';

/** Background work uses the recipient's current preference; unavailable preferences never stop the work. */
export async function savedUserLocale(
	env: ConstructorParameters<typeof LocalePreferenceService>[0],
	userId: string | null | undefined,
): Promise<Locale> {
	if (!userId) return 'en';
	try {
		return (await new LocalePreferenceService(env).locale(userId)) ?? 'en';
	} catch {
		return 'en';
	}
}
