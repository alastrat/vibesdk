import { useState } from 'react';
import { LayerCard } from '@cloudflare/kumo';
import { Languages } from 'lucide-react';
import { toast } from 'sonner';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/api-types';
import { BRAND } from '@/brand';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useI18n } from '@/lib/i18n';

/** The language of the app and of the emails Estori sends. Each language is named in itself, so it can be found from any other. */
export function LanguageCard() {
	const { locale, setLocale, t } = useI18n();
	const [saving, setSaving] = useState(false);

	const choose = async (value: string) => {
		if (!isLocale(value) || saving) return;
		setSaving(true);
		try {
			await setLocale(value);
		} catch {
			toast.error(t("Couldn't save your language. Try again."));
		} finally {
			setSaving(false);
		}
	};

	return (
		<LayerCard id="language">
			<LayerCard.Secondary className="font-funky-mono tracking-tighter">
				<div className="flex items-center gap-2">
					<span className="flex items-center">
						<Languages className="size-4" />
					</span>
					<span>{t('Language')}</span>
				</div>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="grid gap-1.5">
						<h4 className="text-sm font-medium text-kumo-default">{t('Choose your language')}</h4>
						<p className="text-sm text-kumo-subtle">{t('{brand} uses this language in its menus and messages, and in the emails we send you.', { brand: BRAND.name })}</p>
					</div>
					<RadioGroup value={locale} onValueChange={(value) => void choose(value)} aria-label={t('Choose your language')} className="gap-2">
						{LOCALES.map((code) => (
							<label key={code} className="flex w-fit items-center gap-2 text-sm text-kumo-default">
								<RadioGroupItem value={code} disabled={saving} />
								<span lang={code}>{LOCALE_NAMES[code]}</span>
							</label>
						))}
					</RadioGroup>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}
