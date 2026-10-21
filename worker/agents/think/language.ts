import { LOCALE_AI_NAMES, isLocale } from '../../../shared/i18n/locales';

export function sellerLanguageInstruction(locale: unknown): string {
	return isLocale(locale) && locale !== 'en'
		? `Reply to the seller in ${LOCALE_AI_NAMES[locale]}. Keep code, file names and the store's own text in whatever language the seller asks for.`
		: '';
}
