import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Empty, Loader, Tabs, cn } from '@cloudflare/kumo';
import { LOCALE_NAMES, isLocale, type Locale, type StoreLanguageStatus, type StoreTranslationRow } from '@/api-types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useRevertTranslationText, useSaveTranslationText, useTranslationTexts } from '@/hooks/use-store-translations';
import { useI18n } from '@/lib/i18n';
import { canUseAutomatic, draftChanged, excerpt, isAutomatic, uniqueRows } from './translations-format';

/** How long the search waits after the last key before it asks for the texts. */
const SEARCH_DELAY_MS = 300;

/** Browsers that size a text box to its text do it with CSS (`field-sizing`); the others are sized by hand. */
const SIZES_ITSELF = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/** What the seller typed in each box and hasn't saved, by language and text. It outlives a search and a change of language, so a failed save loses nothing. */
type Drafts = Map<string, string>;

interface TranslationEditorProps {
	appId: string;
	/** The language the store is written in, which the originals are in. */
	sourceLocale: Locale;
	languages: readonly StoreLanguageStatus[];
}

/** Where the seller reads each text of the store beside its translation, and corrects it: a tab for each language that is on. */
export function TranslationEditor({ appId, sourceLocale, languages }: TranslationEditorProps) {
	const { t } = useI18n();
	const [chosen, setChosen] = useState<Locale | null>(null);
	const [drafts] = useState<Drafts>(() => new Map());
	const on = languages.filter((language) => language.enabled);
	const current = on.find((language) => language.locale === chosen) ?? on[0];
	if (!current) return null;

	return (
		<section className="grid gap-3">
			<div className="grid gap-1">
				<h2 className="text-lg font-semibold text-kumo-strong">{t('Review translations')}</h2>
				<p className="text-sm text-kumo-subtle">{t('Correct any translation. Automatic translation never changes your edits.')}</p>
			</div>
			<Tabs
				value={current.locale}
				onValueChange={(value) => isLocale(value) && setChosen(value)}
				tabs={on.map((language) => ({ value: language.locale, label: <span lang={language.locale}>{LOCALE_NAMES[language.locale]}</span> }))}
				labels={{ scrollStart: t('Scroll tabs left'), scrollEnd: t('Scroll tabs right') }}
				className="w-fit max-w-full"
			/>
			<LanguageTexts key={current.locale} appId={appId} sourceLocale={sourceLocale} locale={current.locale} drafts={drafts} />
		</section>
	);
}

interface LanguageTextsProps {
	appId: string;
	sourceLocale: Locale;
	locale: Locale;
	drafts: Drafts;
}

/** One language's texts: a search, the rows a page at a time, and Load more. */
function LanguageTexts({ appId, sourceLocale, locale, drafts }: LanguageTextsProps) {
	const { t } = useI18n();
	const [search, setSearch] = useState('');
	const query = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
	const texts = useTranslationTexts(appId, locale, query);
	const rows = uniqueRows(texts.data?.pages ?? []);

	return (
		<div className="grid gap-3">
			<Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search your store's text")} aria-label={t("Search your store's text")} className="sm:max-w-sm" />
			{texts.data ? (
				rows.length > 0 ? (
					<ul className={cn('grid gap-3', texts.isPlaceholderData && 'opacity-60')} aria-busy={texts.isPlaceholderData}>
						{rows.map((row) => (
							<TextRow key={row.hash} appId={appId} locale={locale} sourceLocale={sourceLocale} row={row} drafts={drafts} />
						))}
					</ul>
				) : (
					<Empty title={query ? t('No text matches your search.') : t('No text to show yet. Translate this language first.')} />
				)
			) : texts.isError ? (
				<Empty
					title={t("Couldn't load your store's text")}
					description={texts.error.message}
					contents={
						<Button size="sm" variant="secondary" onClick={() => void texts.refetch()}>
							{t('Retry')}
						</Button>
					}
				/>
			) : (
				<div className="flex justify-center py-8">
					<Loader />
				</div>
			)}
			{texts.data && texts.isError && (
				<p role="alert" className="text-sm text-kumo-danger">
					{texts.error.message}
				</p>
			)}
			{texts.hasNextPage && (
				<Button variant="secondary" size="sm" className="w-fit" onClick={() => void texts.fetchNextPage()} loading={texts.isFetchingNextPage}>
					{t('Load more')}
				</Button>
			)}
		</div>
	);
}

/** The box as tall as its text, border included. */
function fit(element: HTMLTextAreaElement): void {
	element.style.height = 'auto';
	element.style.height = `${element.scrollHeight + element.offsetHeight - element.clientHeight}px`;
}

/** Sizes the text box to what it holds where the browser doesn't do that itself, and again when its width changes and the text wraps differently. */
function useAutoGrow(value: string) {
	const box = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const element = box.current;
		if (element && !SIZES_ITSELF) fit(element);
	}, [value]);
	useEffect(() => {
		const element = box.current;
		if (!element || SIZES_ITSELF || typeof ResizeObserver === 'undefined') return;
		// Setting the height also resizes the box, so only a change of width measures again.
		let width: number | undefined;
		const watch = new ResizeObserver((entries) => {
			const next = entries[0]?.contentRect.width;
			if (next === undefined || next === width) return;
			width = next;
			fit(element);
		});
		watch.observe(element);
		return () => watch.disconnect();
	}, []);
	return box;
}

interface TextRowProps {
	appId: string;
	locale: Locale;
	sourceLocale: Locale;
	row: StoreTranslationRow;
	drafts: Drafts;
}

/**
 * One text and its translation. What the seller types stays in the box, saved or not, until a save of exactly that text
 * succeeds or they go back to the automatic translation: a failed save never loses it, not even when the row leaves the
 * list for a search. Words typed while a save is on their way are sent when it lands.
 */
function TextRow({ appId, locale, sourceLocale, row, drafts }: TextRowProps) {
	const { t } = useI18n();
	const draftKey = `${locale}:${row.hash}`;
	// A remembered draft only counts while it still differs from what is saved: a save may have landed after the row left the list.
	const [draft, setDraft] = useState<string | null>(() => {
		const remembered = drafts.get(draftKey);
		return remembered !== undefined && draftChanged(remembered, row.text) ? remembered : null;
	});
	const [saved, setSaved] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	// `typed` is what the seller typed last, which a save that lands later reads; `refused` is the text a save last failed on,
	// which leaving the box doesn't send again; `sending` is set the moment a save starts, before the next render.
	const typed = useRef(draft);
	const refused = useRef<string | null>(null);
	const sending = useRef(false);
	const save = useSaveTranslationText(appId, locale);
	const revert = useRevertTranslationText(appId, locale);
	const sourceId = useId();
	const errorId = useId();
	const shown = draft ?? row.text ?? '';
	const changed = draftChanged(draft, row.text);
	const busy = save.isPending || revert.isPending;
	const box = useAutoGrow(shown);

	// Only what differs from what is saved is kept; the row comes back with it, unsaved, after a search or a change of language.
	useEffect(() => {
		if (draft !== null && changed) drafts.set(draftKey, draft);
		else drafts.delete(draftKey);
	}, [changed, draft, draftKey, drafts]);

	const type = (value: string) => {
		typed.current = value;
		setDraft(value);
		setSaved(false);
		setFailure(null);
	};

	const send = (text: string): void => {
		sending.current = true;
		setFailure(null);
		save.mutate(
			{ hash: row.hash, text },
			{
				onSuccess: (result) => {
					sending.current = false;
					refused.current = null;
					if (typed.current === text) {
						typed.current = null;
						setDraft(null);
					}
					setSaved(true);
					// The row already holds the saved text. Words typed since the save began go next.
					const next = typed.current;
					if (next !== null && draftChanged(next, result.text)) send(next);
				},
				onError: (error) => {
					sending.current = false;
					refused.current = text;
					setFailure(error.message);
				},
			},
		);
	};

	/** Leaving the box saves; the Save button, which is the seller asking again, also sends a text that was refused. */
	const commit = (retry: boolean) => {
		const text = typed.current;
		if (text === null || !draftChanged(text, row.text) || sending.current || revert.isPending) return;
		if (!retry && text === refused.current) return;
		send(text);
	};

	const goBack = () => {
		setSaved(false);
		setFailure(null);
		revert.mutate(row.hash, {
			onSuccess: () => {
				typed.current = null;
				refused.current = null;
				setDraft(null);
			},
			onError: (error) => setFailure(error.message),
		});
	};

	return (
		<li data-hash={row.hash} className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-kumo-line p-3 text-sm md:grid-cols-2 md:gap-4">
			<div className="grid content-start gap-1">
				<span className="text-xs text-kumo-subtle">{t('Original')}</span>
				<p id={sourceId} lang={sourceLocale} className="whitespace-pre-wrap text-kumo-default [overflow-wrap:anywhere]">
					{row.source}
				</p>
			</div>
			<div className="grid content-start gap-2">
				<span className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-kumo-subtle">{t('Translation')}</span>
					{row.origin === 'seller' && <Badge variant="info">{t('Edited by you')}</Badge>}
					{isAutomatic(row) && <Badge variant="outline">{t('Automatic translation')}</Badge>}
				</span>
				<Textarea
					ref={box}
					lang={locale}
					value={shown}
					placeholder={t('Not translated yet')}
					aria-label={t('Translation into {language}: {text}', { language: LOCALE_NAMES[locale], text: excerpt(row.source) })}
					aria-describedby={failure ? `${sourceId} ${errorId}` : sourceId}
					aria-invalid={failure !== null || undefined}
					className="min-h-10"
					onChange={(event) => type(event.target.value)}
					onBlur={() => commit(false)}
				/>
				{failure && (
					<p id={errorId} role="alert" className="text-kumo-danger">
						{failure}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-2">
					{/* The buttons of every row read the same, so each is described by its row's text. */}
					<Button size="sm" variant="primary" aria-describedby={sourceId} disabled={!changed || busy} loading={save.isPending} onClick={() => commit(true)}>
						{t('Save')}
					</Button>
					{canUseAutomatic(row) && (
						<Button
							size="sm"
							variant="ghost"
							aria-describedby={sourceId}
							disabled={busy}
							loading={revert.isPending}
							// Keeps the box from losing focus, which would save what is typed just before it is dropped.
							onMouseDown={(event) => event.preventDefault()}
							onClick={goBack}
						>
							{t('Use the automatic translation')}
						</Button>
					)}
					<span role="status" className="text-xs text-kumo-subtle">
						{saved && !changed && t('Saved')}
					</span>
				</div>
			</div>
		</li>
	);
}
