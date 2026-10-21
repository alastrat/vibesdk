import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, LinkButton, Meter } from '@cloudflare/kumo';
import { LOCALE_NAMES, UNTOUCHED_SETTINGS_VERSION, type Locale, type StoreLanguageStatus, type StoreTranslationSettings } from '@/api-types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useRunStoreTranslation, useSaveTranslationSettings } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { StoreLanguageSelect } from './store-language-select';
import { TaskNotice } from './task-activity';
import { LANGUAGE_STATE_LABELS, LANGUAGE_STATE_VARIANTS, creditsLeftText, estimateText, languageState, previewHref, taskIsUnfinished, translatedPercent } from './translations-format';

interface LanguageCardProps {
	appId: string;
	language: StoreLanguageStatus;
	settings: StoreTranslationSettings;
	/** AI credits the seller has left; null while billing is off. */
	creditsLeft: number | null;
	/** The live store, else its preview; null when there is neither. */
	storeUrl: string | null;
}

/** One language the store can be shown in: how far it is, what translating the rest costs, and whether shoppers get it. */
export function LanguageCard({ appId, language, settings, creditsLeft, storeUrl }: LanguageCardProps) {
	const { locale, t, tn } = useI18n();
	const [confirming, setConfirming] = useState(false);
	const save = useSaveTranslationSettings(appId);
	const name = LOCALE_NAMES[language.locale];
	const state = languageState(language);
	const busy = language.task !== null && taskIsUnfinished(language.task);
	const upToDate = language.ready && language.left === 0;

	const toggle = (enabled: boolean) =>
		save.mutate(
			{ targets: { [language.locale]: { enabled } } },
			{
				onSuccess: () => toast.success(enabled ? t('{language} is on', { language: name }) : t('{language} is off', { language: name })),
				onError: (error) => toast.error(error.message),
			},
		);

	return (
		<li data-locale={language.locale} className="grid content-start gap-3 rounded-lg border border-kumo-line p-4 text-sm">
			<div className="flex items-center justify-between gap-2">
				<span className="flex flex-wrap items-center gap-2">
					<span lang={language.locale} className="font-medium text-kumo-default">
						{name}
					</span>
					<Badge variant={LANGUAGE_STATE_VARIANTS[state]}>{t(LANGUAGE_STATE_LABELS[state])}</Badge>
				</span>
				<Switch checked={language.enabled} disabled={save.isPending} onCheckedChange={toggle} aria-label={t('Show your store in {language}', { language: name })} />
			</div>
			<Meter label={t('Translated')} value={translatedPercent(language)} />
			<div className="grid gap-0.5 text-kumo-subtle">
				<span>
					{tn('{count} text left', '{count} texts left', language.left)}
					{language.left > 0 && ` · ${estimateText(language.estimateCredits, locale)}`}
				</span>
				{language.edited > 0 && <span>{tn('{count} text has your edits', '{count} texts have your edits', language.edited)}</span>}
			</div>
			{language.task && <TaskNotice appId={appId} task={language.task} />}
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="primary" aria-label={t('Translate to {language}', { language: name })} disabled={busy || upToDate || language.total === 0} onClick={() => setConfirming(true)}>
					{t('Translate')}
				</Button>
				{/* The store serves only languages that are on and ready; any other would show its own language. */}
				{storeUrl && language.enabled && language.ready && (
					<LinkButton size="sm" variant="secondary" href={previewHref(storeUrl, language.locale)} external aria-label={t('Preview in {language}', { language: name })}>
						{t('Preview in {language}', { language: name })}
					</LinkButton>
				)}
			</div>
			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t('Translate your store into {language}?', { language: name })}</DialogTitle>
						<DialogDescription>
							{tn(
								'Estori automatically translates {count} text that has no translation yet. Your edits are never changed.',
								'Estori automatically translates {count} texts that have no translation yet. Your edits are never changed.',
								language.left,
							)}
						</DialogDescription>
					</DialogHeader>
					<TranslateForm appId={appId} language={language} settings={settings} creditsLeft={creditsLeft} onDone={() => setConfirming(false)} />
				</DialogContent>
			</Dialog>
		</li>
	);
}

interface TranslateFormProps {
	appId: string;
	language: StoreLanguageStatus;
	settings: StoreTranslationSettings;
	creditsLeft: number | null;
	onDone: () => void;
}

/**
 * Asks before spending credits: the store's language, which checkout and Estori's own pages follow once it is saved, then
 * what translating costs and what the seller has. Mounted with the dialog, so each opening starts from the saved settings.
 * Starting is allowed past what's left.
 */
function TranslateForm({ appId, language, settings, creditsLeft, onDone }: TranslateFormProps) {
	const { locale, t } = useI18n();
	const [source, setSource] = useState<Locale>(settings.sourceLocale);
	const save = useSaveTranslationSettings(appId);
	const run = useRunStoreTranslation(appId);
	const pending = save.isPending || run.isPending;
	const name = LOCALE_NAMES[language.locale];
	const alreadyIn = source === language.locale;
	// Until the seller saves settings, the store's language is a guess, so the first translation saves the one shown.
	const saveSource = settings.version <= UNTOUCHED_SETTINGS_VERSION || source !== settings.sourceLocale;
	const short = creditsLeft !== null && language.estimateCredits > creditsLeft;

	const confirm = async () => {
		try {
			if (saveSource) await save.mutateAsync({ sourceLocale: source });
			if (alreadyIn) {
				onDone();
				toast.success(t('Saved'));
				return;
			}
			const result = await run.mutateAsync(language.locale);
			onDone();
			toast.success(result.created ? t('Translating your store into {language}', { language: name }) : t('Your store is already being translated into {language}', { language: name }));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : t("Couldn't start the translation"));
		}
	};

	return (
		<div className="grid gap-4">
			<div className="grid gap-1.5 text-sm">
				<span className="font-medium text-kumo-default">{t('Your store is written in')}</span>
				<StoreLanguageSelect value={source} onChange={setSource} label={t('Your store is written in')} disabled={pending} />
			</div>
			{alreadyIn ? (
				<p className="text-sm text-kumo-default">{t("Your store is already in {language}, so there's nothing to translate it into.", { language: name })}</p>
			) : (
				<div className="grid gap-1 text-sm">
					<span className="font-medium text-kumo-default">{estimateText(language.estimateCredits, locale)}</span>
					{creditsLeft !== null && <span className="text-kumo-subtle">{creditsLeftText(creditsLeft, locale)}</span>}
					{short && <span className="text-kumo-default">{t("That's more than you have left. The translation pauses when your credits run out, and you can add credits to finish it.")}</span>}
				</div>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				<Button size="sm" variant="secondary" onClick={onDone}>
					{t('Cancel')}
				</Button>
				{alreadyIn ? (
					<Button size="sm" variant="primary" disabled={pending} loading={pending} onClick={() => void confirm()}>
						{t('Save')}
					</Button>
				) : (
					<Button size="sm" variant="primary" aria-label={t('Translate to {language}', { language: name })} disabled={pending} loading={pending} onClick={() => void confirm()}>
						{t('Translate')}
					</Button>
				)}
			</div>
		</div>
	);
}
