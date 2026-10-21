import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, LinkButton, Meter } from '@cloudflare/kumo';
import { LOCALE_NAMES, type StoreLanguageStatus } from '@/api-types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useRunStoreTranslation, useSaveTranslationSettings } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { TaskNotice } from './task-activity';
import { LANGUAGE_STATE_LABELS, LANGUAGE_STATE_VARIANTS, creditsLeftText, estimateText, languageState, previewHref, taskIsUnfinished, translatedPercent } from './translations-format';

interface LanguageCardProps {
	appId: string;
	language: StoreLanguageStatus;
	/** AI credits the seller has left; null while billing is off. */
	creditsLeft: number | null;
	/** The live store, else its preview; null when there is neither. */
	storeUrl: string | null;
}

/** One language the store can be shown in: how far it is, what translating the rest costs, and whether shoppers get it. */
export function LanguageCard({ appId, language, creditsLeft, storeUrl }: LanguageCardProps) {
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
				<Button size="sm" variant="primary" disabled={busy || upToDate || language.total === 0} onClick={() => setConfirming(true)}>
					{t('Translate')}
				</Button>
				{/* The store serves only languages that are on and ready; any other would show its own language. */}
				{storeUrl && language.enabled && language.ready && (
					<LinkButton size="sm" variant="secondary" href={previewHref(storeUrl, language.locale)} external>
						{t('Preview in {language}', { language: name })}
					</LinkButton>
				)}
			</div>
			<TranslateDialog appId={appId} language={language} creditsLeft={creditsLeft} open={confirming} onOpenChange={setConfirming} />
		</li>
	);
}

interface TranslateDialogProps {
	appId: string;
	language: StoreLanguageStatus;
	creditsLeft: number | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Asks before spending credits: what translating costs, and what the seller has. Starting is allowed past what's left. */
function TranslateDialog({ appId, language, creditsLeft, open, onOpenChange }: TranslateDialogProps) {
	const { locale, t, tn } = useI18n();
	const run = useRunStoreTranslation(appId);
	const name = LOCALE_NAMES[language.locale];
	const short = creditsLeft !== null && language.estimateCredits > creditsLeft;

	const start = () =>
		run.mutate(language.locale, {
			onSuccess: (result) => {
				onOpenChange(false);
				toast.success(result.created ? t('Translating your store into {language}', { language: name }) : t('Your store is already being translated into {language}', { language: name }));
			},
			onError: (error) => toast.error(error.message),
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('Translate your store into {language}?', { language: name })}</DialogTitle>
					<DialogDescription>
						{tn(
							'Estori automatically translates the {count} text that has no translation yet. Your edits are never changed.',
							'Estori automatically translates the {count} texts that have no translation yet. Your edits are never changed.',
							language.left,
						)}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-1 text-sm">
					<span className="font-medium text-kumo-default">{estimateText(language.estimateCredits, locale)}</span>
					{creditsLeft !== null && <span className="text-kumo-subtle">{creditsLeftText(creditsLeft, locale)}</span>}
					{short && <span className="text-kumo-default">{t("That's more than you have left. The translation pauses when your credits run out, and you can add credits to finish it.")}</span>}
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					<Button size="sm" variant="secondary" onClick={() => onOpenChange(false)}>
						{t('Cancel')}
					</Button>
					<Button size="sm" variant="primary" disabled={run.isPending} loading={run.isPending} onClick={start}>
						{t('Translate')}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
