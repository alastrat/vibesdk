import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { LOCALES, LOCALE_NAMES, STORE_TRANSLATIONS_PAUSED_MESSAGE, isLocale, type StoreTranslationOverview, type StoreTranslationSettings, type StoreTranslationSettingsPatch, type StoreTranslationStoreSummary } from '@/api-types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useFlag } from '@/hooks/use-flag';
import { useSaveTranslationSettings, useStoreTranslations, useTranslationStores } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { LanguageCard } from './language-card';
import { TaskActivity } from './task-activity';

/** Where this browser remembers the store the seller last chose. */
const CHOSEN_STORE_KEY = 'estori:translations-store';

function storedStore(): string | null {
	try {
		return localStorage.getItem(CHOSEN_STORE_KEY);
	} catch {
		return null;
	}
}

function rememberStore(appId: string): void {
	try {
		localStorage.setItem(CHOSEN_STORE_KEY, appId);
	} catch {
		// Storage is blocked: the choice lasts until the page closes.
	}
}

export default function TranslationsPage() {
	const { t } = useI18n();
	const paused = useFlag('store-translations-paused');
	const stores = useTranslationStores(!paused);
	const [chosen, setChosen] = useState(storedStore);
	const list = stores.data ?? [];
	const appId = list.find((store) => store.appId === chosen)?.appId ?? list[0]?.appId ?? null;

	const choose = (value: string) => {
		setChosen(value);
		rememberStore(value);
	};

	return (
		<div className="size-full">
			<title>{pageTitle(t('Translations'))}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">{t('Translations')}</h1>
					<p className="text-kumo-subtle">{t('Show your store in English, Spanish and Portuguese. Automatic translations use AI credits, and your edits are never changed.')}</p>
				</div>

				{paused ? (
					<Empty title={t('Translations are paused')} description={t(STORE_TRANSLATIONS_PAUSED_MESSAGE)} />
				) : stores.data ? (
					list.length === 0 ? (
						<NotDeployed />
					) : (
						<>
							<StorePicker stores={list} value={appId} onChange={choose} />
							{appId && <StoreTranslations key={appId} appId={appId} />}
						</>
					)
				) : stores.isError ? (
					<Empty title={t("Couldn't load your stores")} description={stores.error.message} />
				) : (
					<Spinner />
				)}
			</div>
		</div>
	);
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

function StorePicker({ stores, value, onChange }: { stores: StoreTranslationStoreSummary[]; value: string | null; onChange: (appId: string) => void }) {
	const { t } = useI18n();
	return (
		<div className="grid w-full gap-1.5 text-sm sm:max-w-xs">
			<span className="font-medium text-kumo-default">{t('Store')}</span>
			<Select value={value ?? undefined} onValueChange={onChange}>
				<SelectTrigger aria-label={t('Store')} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{stores.map((store) => (
						<SelectItem key={store.appId} value={store.appId}>
							{store.title.trim() || t('Untitled store')}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

/** The chosen store: its settings, a card per language, then what was translated and is translating. */
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
							<LanguageCard key={language.locale} appId={appId} language={language} creditsLeft={data.creditsLeft} storeUrl={data.liveUrl ?? data.previewUrl} />
						))}
					</ul>
				</section>
			)}
			<TaskActivity appId={appId} />
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
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring ring-kumo-hairline">
					<span className="text-sm text-kumo-default">{t("We couldn't read your store right now. Try again in a moment.")}</span>
					<Button size="sm" variant="secondary" disabled={retrying} loading={retrying} onClick={onRetry}>
						{t('Retry')}
					</Button>
				</div>
			)}
			{notes.map((note) => (
				<p key={note} className="rounded-lg px-3 py-2 text-sm text-kumo-default ring ring-kumo-hairline">
					{note}
				</p>
			))}
		</div>
	);
}

type SettingSwitch = 'matchBrowser' | 'showSwitcher' | 'autoTranslate';

function SettingsCard({ appId, settings }: { appId: string; settings: StoreTranslationSettings }) {
	const { t } = useI18n();
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
				<span className="font-medium text-kumo-default">{t('Store language')}</span>
				<Select
					value={settings.sourceLocale}
					disabled={save.isPending}
					onValueChange={(value) => {
						if (isLocale(value) && value !== settings.sourceLocale) change({ sourceLocale: value });
					}}
				>
					<SelectTrigger aria-label={t('Store language')} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{LOCALES.map((code) => (
							<SelectItem key={code} value={code}>
								<span lang={code}>{LOCALE_NAMES[code]}</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-kumo-subtle">{t('The language your store is written in.')}</span>
			</div>
			<ul className="grid gap-3">
				{switches.map((setting) => (
					<li key={setting.key} className="flex items-start justify-between gap-3">
						<span className="grid gap-0.5">
							<span className="font-medium text-kumo-default">{setting.label}</span>
							<span className="text-kumo-subtle">{setting.hint}</span>
						</span>
						<Switch checked={settings[setting.key]} disabled={save.isPending} onCheckedChange={(checked) => change({ [setting.key]: checked })} aria-label={setting.label} className="mt-0.5" />
					</li>
				))}
			</ul>
		</section>
	);
}
