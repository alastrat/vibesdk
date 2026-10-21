import { Languages } from 'lucide-react';
import { toast } from 'sonner';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/api-types';
import { useI18n } from '@/lib/i18n';

/** A compact language menu for the sign-in and sign-up screens, where no account is there yet to remember a language. */
export function LanguagePicker() {
	const { locale, setLocale, t } = useI18n();

	const choose = (value: string) => {
		if (!isLocale(value)) return;
		setLocale(value).catch(() => toast.error(t("Couldn't save your language. Try again.")));
	};

	return (
		<div className="inline-flex items-center gap-2 text-kumo-subtle">
			<Languages aria-hidden className="size-4 shrink-0" />
			<select
				aria-label={t('Language')}
				value={locale}
				onChange={(event) => choose(event.target.value)}
				className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1.5 text-sm text-kumo-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue"
			>
				{LOCALES.map((code) => (
					<option key={code} value={code} lang={code}>
						{LOCALE_NAMES[code]}
					</option>
				))}
			</select>
		</div>
	);
}
