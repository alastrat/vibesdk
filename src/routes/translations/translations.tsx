import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Empty, Loader } from '@cloudflare/kumo';
import { STORE_TRANSLATIONS_PAUSED_MESSAGE, UNTOUCHED_SETTINGS_VERSION, type Locale, type StoreTranslationOverview, type StoreTranslationSettings, type StoreTranslationSettingsPatch } from '@/api-types';
import { Switch } from '@/components/ui/switch';
import { useFlag } from '@/hooks/use-flag';
import { useSaveTranslationSettings, useStoreTranslations, useTranslationStores } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { LanguageCard } from './language-card';
import { StoreLanguageSelect } from './store-language-select';
import { Notice, TaskActivity } from './task-activity';
import { TranslationEditor } from './translation-editor';
import { StoreToolLauncher } from './store-tool-launcher';

/** Compatibility route: choose a store, then manage translations inside its workspace. */
export default function TranslationsPage() {
	const { t } = useI18n();
	const paused = useFlag('store-translations-paused');
	const stores = useTranslationStores(!paused);
	return (
		<StoreToolLauncher
			title={t('Translations')}
			description={t('Choose a store to manage its languages and translations.')}
			section="translations"
			stores={stores.data}
			loading={stores.isLoading}
			error={stores.error}
			retrying={stores.isFetching}
			onRetry={() => void stores.refetch()}
			emptyTitle={t('Publish or preview your store first')}
			emptyDescription={t('Translations start from what your store shows shoppers. Open its preview or publish it, then come back.')}
			notice={paused ? <Paused /> : undefined}
		/>
	);
}

/** Mount only the supplied store, resetting editing and polling state when it changes. */
export function StoreTranslationsPanel({ appId }: { appId: string }) {
	const paused = useFlag('store-translations-paused');
	return <div className="grid gap-6">{paused ? <Paused /> : <StoreTranslations key={appId} appId={appId} />}</div>;
}

function Paused() {
	const { t } = useI18n();
	return <Empty title={t('Translations are paused')} description={t(STORE_TRANSLATIONS_PAUSED_MESSAGE)} />;
}

function Spinner() {
	return (
		<div className="flex justify-center py-16">
			<Loader />
		</div>
	);
}

function NotDeployed() {
	const { t } = useI18n();
	return <Empty title={t('Publish or preview your store first')} description={t('Translations start from what your store shows shoppers. Open its preview or publish it, then come back.')} />;
}

/** The chosen store: its settings, a card per language, what is translating, then every text to review. */
function StoreTranslations({ appId }: { appId: string }) {
	const { t } = useI18n();
	const overview = useStoreTranslations(appId);

	if (!overview.data) {
		return overview.isError ? (
			<Empty
				title={t("Couldn't load this store's translations")}
				description={overview.error.message}
				contents={
					<Button size="sm" variant="secondary" onClick={() => void overview.refetch()}>
						{t('Retry')}
					</Button>
				}
			/>
		) : (
			<Spinner />
		);
	}
	const data = overview.data;
	if (!data.deployed) return <NotDeployed />;
	const noText = !data.textsUnavailable && data.languages.every((language) => language.total === 0);

	return (
		<>
			<StoreNotes data={data} retrying={overview.isFetching} onRetry={() => void overview.refetch()} />
			<SettingsCard appId={appId} settings={data.settings} />
			{noText ? (
				<Empty title={t('No text to translate')} description={t("Your store doesn't show shoppers any text yet. Add some, then publish or preview it again.")} />
			) : (
				<section className="grid gap-3">
					<h2 className="text-lg font-semibold text-kumo-strong">{t('Languages')}</h2>
					<ul className="grid gap-3 sm:grid-cols-2">
						{data.languages.map((language) => (
							<LanguageCard key={language.locale} appId={appId} language={language} settings={data.settings} creditsLeft={data.creditsLeft} storeUrl={data.liveUrl ?? data.previewUrl} />
						))}
					</ul>
				</section>
			)}
			<TaskActivity appId={appId} />
			{!noText && <TranslationEditor appId={appId} sourceLocale={data.settings.sourceLocale} languages={data.languages} />}
		</>
	);
}

/** What the last read of the store couldn't do. Files are never named. */
function StoreNotes({ data, retrying, onRetry }: { data: StoreTranslationOverview; retrying: boolean; onRetry: () => void }) {
	const { t } = useI18n();
	const notes = [
		data.manifestInvalid && t("We couldn't read your products, so they aren't translated."),
		data.truncated && t("Your store has more text than Estori translates, so some of it isn't translated."),
	].filter((note): note is string => typeof note === 'string');
	if (!data.textsUnavailable && notes.length === 0) return null;

	return (
		<div className="grid gap-2">
			{data.textsUnavailable && (
				<Notice
					text={t("We couldn't read your store right now. Try again in a moment.")}
					actions={
						<Button size="sm" variant="secondary" disabled={retrying} loading={retrying} onClick={onRetry}>
							{t('Retry')}
						</Button>
					}
				/>
			)}
			{notes.map((note) => (
				<Notice key={note} text={note} />
			))}
		</div>
	);
}

type SettingSwitch = 'matchBrowser' | 'showSwitcher' | 'autoTranslate';

function SettingsCard({ appId, settings }: { appId: string; settings: StoreTranslationSettings }) {
	const { t } = useI18n();
	const [source, setSource] = useState<Locale>(settings.sourceLocale);
	const untouched = settings.version <= UNTOUCHED_SETTINGS_VERSION;
	const save = useSaveTranslationSettings(appId);
	const change = (patch: StoreTranslationSettingsPatch) => save.mutate(patch, { onSuccess: () => toast.success(t('Saved')), onError: (error) => toast.error(error.message) });
	const switches: Array<{ key: SettingSwitch; label: string; hint: string }> = [
		{ key: 'matchBrowser', label: t("Match the shopper's browser language"), hint: t("Shoppers see your store in their browser's language when it has a translation.") },
		{ key: 'showSwitcher', label: t('Show a language switcher'), hint: t('Shoppers can choose a language on every page.') },
		{ key: 'autoTranslate', label: t('Translate new text when I publish'), hint: t('Each publish translates only text that is new, using AI credits.') },
	];

	return (
		<section className="grid gap-4 rounded-lg border border-kumo-line p-4 text-sm">
			<h2 className="text-lg font-semibold text-kumo-strong">{t('Settings')}</h2>
			<div className="grid gap-1.5 sm:max-w-xs">
				<span className="font-medium text-kumo-default">{untouched ? t('Your store is written in') : t('Store language')}</span>
				<StoreLanguageSelect
					value={untouched ? source : settings.sourceLocale}
					label={untouched ? t('Your store is written in') : t('Store language')}
					disabled={save.isPending}
					onChange={(value) => {
						if (untouched) { setSource(value); return; }
						if (value !== settings.sourceLocale) change({ sourceLocale: value });
					}}
				/>
				<span className="text-kumo-subtle">{t('The language your store is written in.')}</span>
				{untouched && <Button size="sm" variant="primary" disabled={save.isPending} loading={save.isPending} onClick={() => change({ sourceLocale: source })}>{t('Confirm')}</Button>}
			</div>
			<ul className="grid gap-3">
				{switches.map((setting) => (
					<li key={setting.key} className="flex items-start justify-between gap-3">
						<span className="grid gap-0.5">
							<span className="font-medium text-kumo-default">{setting.label}</span>
							<span className="text-kumo-subtle">{setting.hint}</span>
						</span>
							<Switch checked={settings[setting.key]} disabled={save.isPending || untouched} onCheckedChange={(checked) => change({ [setting.key]: checked })} aria-label={setting.label} className="mt-0.5" />
					</li>
				))}
			</ul>
		</section>
	);
}
