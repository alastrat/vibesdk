/**
 * Compares the messages the source marks for translation with a language's catalog: what is missing, blank, unused or
 * wrong, and the catalog `scripts/i18n-extract.ts` writes. Shared by that script and the completeness test.
 */

import type { ExtractedMessage } from './extract';

/** A message the source marks for translation, with every place that uses it. */
export interface UsedMessage {
	key: string;
	plural?: { singular: string; plural: string };
	/** `file:line` of each use. */
	sites: string[];
}

/** What a catalog lacks or gets wrong. Each line of `badShape` and `mismatched` is written to be read as it is. */
export interface CatalogReport {
	/** Used, but the catalog has no entry. */
	missing: UsedMessage[];
	/** The entry is blank, as the extractor leaves a new key, or a plural form is. */
	empty: UsedMessage[];
	/** In the catalog, but no source uses it. */
	unused: string[];
	/** An entry that is not a string, or a plural that is not `{ one, other }`. */
	badShape: string[];
	/** A translation whose `{placeholders}` or `<tags>` differ from the English. */
	mismatched: string[];
	/** The keys are not in the order `syncCatalog` writes. */
	unsorted: boolean;
}

/** The same grammar as `interpolate` in `translate.ts`. */
const PLACEHOLDER = /\{([A-Za-z_]\w*)\}/g;

/** The same bare tags as `parseRichText` in `rich-text.ts`. */
const TAG = /<\/?[A-Za-z][\w-]*>/g;

/** Plain code-unit order, so the catalogs sort the same way everywhere. */
function byCode(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The messages in the extracted calls, once each, sorted by key. */
export function usedMessages(extracted: readonly ExtractedMessage[]): UsedMessage[] {
	const byKey = new Map<string, UsedMessage>();
	for (const { key, plural, file, line } of extracted) {
		const site = `${file}:${line}`;
		const known = byKey.get(key);
		if (known) {
			known.sites.push(site);
			known.plural ??= plural;
		} else {
			byKey.set(key, plural ? { key, plural, sites: [site] } : { key, sites: [site] });
		}
	}
	return [...byKey.values()].sort((a, b) => byCode(a.key, b.key));
}

/** A message for a person: its key, and where it is first used. */
export function describeMessage(message: UsedMessage): string {
	return `${JSON.stringify(message.key)} (${message.sites[0]})`;
}

function uniqueSorted(matches: IterableIterator<RegExpMatchArray>): string[] {
	return [...new Set([...matches].map((match) => match[0]))].sort(byCode);
}

function listed(items: readonly string[]): string {
	return items.length > 0 ? items.join(' ') : 'none';
}

/** How a translation differs from its English in the placeholders and tags it holds; empty when it doesn't. */
function differences(english: string, translation: string): string[] {
	const found: string[] = [];
	for (const [what, pattern] of [
		['placeholders', PLACEHOLDER],
		['tags', TAG],
	] as const) {
		const expected = uniqueSorted(english.matchAll(pattern));
		const actual = uniqueSorted(translation.matchAll(pattern));
		if (expected.join(' ') !== actual.join(' ')) found.push(`${what} differ (English: ${listed(expected)}; translation: ${listed(actual)})`);
	}
	return found;
}

function isBlank(text: string): boolean {
	return text.trim() === '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'an array';
	return typeof value === 'object' ? 'an object' : typeof value;
}

function checkEntry(message: UsedMessage, entry: unknown, report: CatalogReport): void {
	const quoted = JSON.stringify(message.key);
	if (!message.plural) {
		if (typeof entry !== 'string') {
			report.badShape.push(`${quoted}: must be a string, not ${describeType(entry)}`);
		} else if (isBlank(entry)) {
			report.empty.push(message);
		} else {
			report.mismatched.push(...differences(message.key, entry).map((difference) => `${quoted}: ${difference}`));
		}
		return;
	}
	if (!isPlainObject(entry)) {
		report.badShape.push(`${quoted}: a plural message needs { "one": …, "other": … }`);
		return;
	}
	const extra = Object.keys(entry).filter((form) => form !== 'one' && form !== 'other');
	if (extra.length > 0) report.badShape.push(`${quoted}: has forms besides "one" and "other": ${extra.join(', ')}`);
	let blank = false;
	for (const [form, english] of [
		['one', message.plural.singular],
		['other', message.plural.plural],
	] as const) {
		const text = entry[form];
		if (typeof text !== 'string') {
			report.badShape.push(`${quoted}: lacks "${form}"`);
		} else if (isBlank(text)) {
			blank = true;
		} else {
			report.mismatched.push(...differences(english, text).map((difference) => `${quoted} (${form}): ${difference}`));
		}
	}
	if (blank) report.empty.push(message);
}

/** What `catalog` lacks or gets wrong for the messages in `used`. Its values may be anything, as JSON can hold. */
export function checkCatalog(used: readonly UsedMessage[], catalog: Readonly<Record<string, unknown>>): CatalogReport {
	const report: CatalogReport = { missing: [], empty: [], unused: [], badShape: [], mismatched: [], unsorted: false };
	for (const message of used) {
		if (Object.hasOwn(catalog, message.key)) checkEntry(message, catalog[message.key], report);
		else report.missing.push(message);
	}
	const usedKeys = new Set(used.map((message) => message.key));
	const keys = Object.keys(catalog);
	report.unused = keys.filter((key) => !usedKeys.has(key));
	report.unsorted = keys.some((key, index) => index > 0 && byCode(keys[index - 1], key) > 0);
	return report;
}

export interface CatalogSync {
	/** The catalog to write: every entry it had, new keys blank, keys sorted. */
	catalog: Record<string, unknown>;
	/** Messages that had no entry. */
	added: UsedMessage[];
	/** Keys no source uses; they are only dropped from `catalog` when pruning. */
	unused: string[];
}

/**
 * Adds a blank entry for each message the catalog lacks (`{ one, other }` for a plural), sorts the keys, and keeps
 * everything else exactly as it is, so a translator's work is never touched. Unused keys stay unless `prune` is set.
 */
export function syncCatalog(used: readonly UsedMessage[], catalog: Readonly<Record<string, unknown>>, options: { prune: boolean }): CatalogSync {
	const entries = new Map<string, unknown>(Object.entries(catalog));
	const added: UsedMessage[] = [];
	for (const message of used) {
		if (entries.has(message.key)) continue;
		entries.set(message.key, message.plural ? { one: '', other: '' } : '');
		added.push(message);
	}
	const usedKeys = new Set(used.map((message) => message.key));
	const unused = [...entries.keys()].filter((key) => !usedKeys.has(key)).sort(byCode);
	if (options.prune) for (const key of unused) entries.delete(key);
	return { catalog: Object.fromEntries([...entries].sort(([a], [b]) => byCode(a, b))), added, unused };
}

/** The catalog file's text: tab-indented, one entry per line, and a final newline. */
export function serializeCatalog(catalog: Readonly<Record<string, unknown>>): string {
	return `${JSON.stringify(catalog, null, '\t')}\n`;
}
