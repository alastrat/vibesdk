/**
 * The app's language. English text is the key: `t('Save card')` answers its translation in the active language, or the
 * English when it has none. `t`, `tn` and `getLocale` read a module singleton, so they work anywhere, in a component or
 * not. Every route renders again on a language change (see `localize-routes.ts`), and with it everything below that isn't
 * memoised. What does not update, because React skips it:
 *  - `t` called at module level, which freezes the English;
 *  - text kept in `useMemo`, `useState` or a `React.memo` component, which must depend on `locale` from `useI18n()`;
 *  - JSX built outside the component that renders it: a module-level `const page = <Page />`, an element kept in state,
 *    or a route's `element: <Guard><Page /></Guard>`, which is why routes behind sign-in are `protectedPage(Page)`.
 */

import { createElement, Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from '@/api-types';
import { parseRichText, type RichPart } from '../../../shared/i18n/rich-text';
import { interpolate, translate, translatePlural, type Catalog, type MessageValues } from '../../../shared/i18n/translate';
import { loadCatalog } from './catalog-loader';

/** Where this browser remembers the language; `index.html` reads it before the app loads. */
export const STORAGE_KEY = 'estori:locale';

/** A language's catalog could not be loaded, so the app stays in the language it was in. */
export class LocaleLoadError extends Error {}

/** The language was switched, but could not be saved on the account. */
export class LocaleSaveError extends Error {}

let active: { locale: Locale; catalog: Catalog | null } = { locale: DEFAULT_LOCALE, catalog: null };
/** Counts requests for a language, so one that arrives while an earlier one is loading wins. */
let latestRequest = 0;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
	return active.locale;
}

export function t(english: string, values?: MessageValues): string {
	return translate(active.catalog, english, values);
}

/** The singular or plural text for `count`, by the language's plural rule; `{count}` is the count, formatted. */
export function tn(singular: string, plural: string, count: number, values?: MessageValues): string {
	return translatePlural(active.catalog, active.locale, singular, plural, count, values);
}

export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function storedLocale(): Locale | null {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return isLocale(stored) ? stored : null;
	} catch {
		return null;
	}
}

function remember(locale: Locale): void {
	try {
		localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// Storage is blocked: the choice lasts until the page closes.
	}
}

/** The language a visit starts in: the one this browser remembers, otherwise the first of the browser's own languages we speak. */
export function initialLocale(): Locale {
	return storedLocale() ?? negotiateLocale(typeof navigator === 'undefined' ? [] : (navigator.languages ?? []));
}

/** Tells the browser which language the page is in. */
function declareLanguage(locale: Locale): void {
	if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

async function catalogOf(locale: Locale): Promise<Catalog | null> {
	if (locale === active.locale) return active.catalog;
	try {
		return await loadCatalog(locale);
	} catch (cause) {
		// i18n-ignore: a developer message, the seller sees the toast
		throw new LocaleLoadError(`The ${locale} catalog could not be loaded`, { cause });
	}
}

/**
 * Makes `locale` the active language. Answers false when a later request replaced this one before its catalog arrived,
 * and rejects with a `LocaleLoadError`, leaving the language as it was, when the catalog can't be loaded.
 */
async function activate(locale: Locale, remembered: boolean): Promise<boolean> {
	const request = ++latestRequest;
	const catalog = await catalogOf(locale);
	if (request !== latestRequest) return false;
	const changed = locale !== active.locale;
	if (changed) active = { locale, catalog };
	declareLanguage(locale);
	if (remembered) remember(locale);
	if (changed) for (const listener of [...listeners]) listener();
	return true;
}

type AccountSaver = (locale: Locale) => Promise<void>;
let accountSaver: AccountSaver | null = null;

/** Sets how a chosen language reaches the signed-in account, and answers the call that takes it back. `null` clears it. */
export function bindAccountSaver(saver: AccountSaver | null): () => void {
	accountSaver = saver;
	return () => {
		if (accountSaver === saver) accountSaver = null;
	};
}

/**
 * Switches the app to `locale`: loads its catalog, re-renders, sets `<html lang>`, remembers it in this browser and, when
 * someone is signed in, saves it on their account. The language changes even when the account can't be saved, and the
 * returned promise then rejects with a `LocaleSaveError`. A choice replaced by a later one is never saved.
 */
export async function setLocale(locale: Locale): Promise<void> {
	if (!(await activate(locale, true))) return;
	try {
		await accountSaver?.(locale);
	} catch (cause) {
		// i18n-ignore: a developer message, the seller sees the toast
		throw new LocaleSaveError(`The ${locale} language could not be saved`, { cause });
	}
}

/** Switches to the language the signed-in account saved, which the account already knows. */
export async function applyAccountLocale(locale: Locale): Promise<void> {
	await activate(locale, true);
}

/** Subscribes the component to the language, so it renders again when the language changes. */
export function useLocale(): Locale {
	return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export interface I18n {
	locale: Locale;
	setLocale: typeof setLocale;
	t: typeof t;
	tn: typeof tn;
}

const bound = new Map<Locale, I18n>();

/** One object per language, so a `t` listed in a dependency array changes when the language does. */
function i18nFor(locale: Locale): I18n {
	let api = bound.get(locale);
	if (!api) {
		api = { locale, setLocale, t: (english, values) => t(english, values), tn: (singular, plural, count, values) => tn(singular, plural, count, values) };
		bound.set(locale, api);
	}
	return api;
}

/** The active language, with `setLocale`, `t` and `tn`; the component re-renders when the language changes. */
export function useI18n(): I18n {
	return i18nFor(useLocale());
}

export type RichComponents = Readonly<Record<string, (children: ReactNode) => ReactNode>>;

const NO_COMPONENTS: RichComponents = {};

/** The pieces as React nodes. Values are filled in only inside text, so a value is never read as a tag. */
function renderParts(parts: readonly RichPart[], values: MessageValues | undefined, components: RichComponents): ReactNode[] {
	return parts.map((part, index) => {
		if (typeof part === 'string') return interpolate(part, values);
		const children = renderParts(part.children, values, components);
		const wrap = Object.hasOwn(components, part.tag) ? components[part.tag] : undefined;
		return createElement(Fragment, { key: index }, wrap ? wrap(children) : children);
	});
}

interface TProps {
	/** The English text, with `{values}` and `<tag>…</tag>` pairs. */
	text: string;
	values?: MessageValues;
	/** What each tag renders, given the tag's content. A tag with no entry renders just its content. */
	components?: RichComponents;
}

/** Translated text with links or emphasis: `<T text="Read the <link>terms</link>." components={{ link: (children) => <a>{children}</a> }} />`. */
export function T({ text, values, components = NO_COMPONENTS }: TProps): ReactNode {
	useLocale();
	return createElement(Fragment, null, renderParts(parseRichText(translate(active.catalog, text)), values, components));
}

/**
 * Starts the app in its initial language, with no flash of English: a language that isn't English waits for its catalog.
 * Once the app is showing, `<html lang>` says the language the text is in, which differs from the one `index.html`
 * guessed from storage when that language could not be loaded.
 */
export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
	const [start] = useState(initialLocale);
	const [ready, setReady] = useState(() => start === active.locale);
	useEffect(() => {
		if (ready) {
			declareLanguage(getLocale());
			return;
		}
		let mounted = true;
		// A language that won't load leaves the app in English.
		activate(start, false)
			.catch(() => false)
			.then(() => {
				if (mounted) setReady(true);
			});
		return () => {
			mounted = false;
		};
	}, [ready, start]);
	return ready ? children : null;
}
