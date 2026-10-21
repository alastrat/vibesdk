import { toast } from 'sonner';
import type { Locale } from '@/api-types';
import { LocaleSaveError, setLocale, t } from './index';

/**
 * Switches the language and tells the seller when that did not work. A language that could not be loaded stays as it
 * was. One that could not be saved stays switched, and the toast offers to save it again.
 */
export async function chooseLocale(locale: Locale): Promise<void> {
	try {
		await setLocale(locale);
	} catch (error) {
		if (error instanceof LocaleSaveError) {
			toast.error(t("Couldn't save your language. Try again."), { action: { label: t('Try again'), onClick: () => void chooseLocale(locale) } });
		} else {
			toast.error(t("Couldn't load that language. Reload the page and try again."));
		}
	}
}
