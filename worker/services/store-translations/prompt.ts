/**
 * What the translation model is told and what it must answer, and the check of each translation it gives back: the
 * things a store's text must keep (placeholders, markup, urls and emails) are the things the prompt asks it to keep.
 */

import { z } from 'zod';
import { LOCALE_AI_NAMES, type Locale } from '../../../shared/i18n/locales';

/** The model answers each text's id with its translation. */
export const translationSchema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
export type TranslationAnswer = z.infer<typeof translationSchema>;

export interface TranslationItem {
	id: string;
	text: string;
	/** On a retry, what was wrong with the last answer for this text. */
	problem?: string;
}

/** How each language is written: the variety and the form of address Estori's own app uses. */
const TARGET_STYLE: Record<Locale, string> = {
	en: LOCALE_AI_NAMES.en,
	es: 'neutral Latin American Spanish, using Mexican vocabulary where words differ, with tú; no voseo, no regional idioms',
	'pt-BR': `${LOCALE_AI_NAMES['pt-BR']}, using você`,
};

export function buildTranslationPrompt(source: Locale, target: Locale, items: readonly TranslationItem[]): { system: string; prompt: string } {
	const lines = [
		`You translate a store's text for its shoppers, from ${LOCALE_AI_NAMES[source]} to ${TARGET_STYLE[target]}.`,
		'Keep brand and product names, numbers, prices and currency, URLs, email addresses, emoji, HTML tags and entities, and {placeholders} exactly as written.',
		"Keep each text's meaning, length and tone, as a store talking to its shoppers.",
		'Add no quotes or notes.',
		'The next message is a JSON array of { id, text } objects. Translate every text and answer with the same ids.',
	];
	if (items.some((item) => item.problem !== undefined)) {
		lines.push('A text with a problem field was translated wrongly before, and the problem says what was wrong. Translate it again without that problem.');
	}
	lines.push('Answer only JSON matching the schema.');
	return { system: lines.join('\n'), prompt: JSON.stringify(items) };
}

/** `{name}` and numbered `{0}` placeholders alike. */
const PLACEHOLDER = /\{\w+\}/g;
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s[^<>]*)?)\/?>/g;
/** An attribute with a value, which is what tells markup apart from words in angle brackets such as `<your name>`. */
const TAG_ATTRIBUTE = /\s[^\s=<>"']+\s*=/;
/** The elements a store's text uses; a tag with another name counts only when it carries attributes, like a custom element. */
const KNOWN_TAGS = new Set(
	(
		'a abbr address article aside audio b bdi bdo blockquote body br button caption cite code col colgroup data dd del details dfn div dl dt em fieldset ' +
		'figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i iframe img input ins kbd label legend li main mark nav ol option p picture pre q s samp ' +
		'section select small source span strong sub summary sup svg table tbody td textarea tfoot th thead time tr u ul var video wbr'
	).split(' '),
);
/** A url or email ends at a closing quote or a dash of any language, which a sentence puts after it. */
const URL = /https?:\/\/[^\s<>"'`«»“”‘’…—–]+/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** What ends a sentence, not the url or email before it: anything but a letter, a digit, an underscore or a slash. */
const TRAILING = /[^\p{L}\p{N}_/]+$/u;

const listOf = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(' '));

/** Whether both lists hold the same items the same number of times, in any order. */
function sameItems(a: readonly string[], b: readonly string[]): boolean {
	const sorted = (items: readonly string[]) => [...items].sort();
	const left = sorted(a);
	const right = sorted(b);
	return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Each tag, a closing tag with its slash, so a dropped or added one shows. */
function tagsIn(text: string): string[] {
	const tags: string[] = [];
	for (const [, closing, name, attributes] of text.matchAll(TAG)) {
		const lowercase = name.toLowerCase();
		if (KNOWN_TAGS.has(lowercase) || TAG_ATTRIBUTE.test(attributes)) tags.push(`<${closing}${lowercase}>`);
	}
	return tags;
}

/** The urls and emails of a text, without the punctuation that follows them. */
function addressesIn(text: string): string[] {
	return [...(text.match(URL) ?? []), ...(text.match(EMAIL) ?? [])].map((address) => address.replace(TRAILING, ''));
}

/** A problem with `translated` as the translation of `source`, worded for the model's retry; null when it is sound. */
export function checkTranslation(source: string, translated: string): string | null {
	if (source.trim() !== '' && translated.trim() === '') return 'The translation is empty.';

	const placeholders = source.match(PLACEHOLDER) ?? [];
	const translatedPlaceholders = translated.match(PLACEHOLDER) ?? [];
	if (!sameItems(placeholders, translatedPlaceholders)) {
		return `The placeholders must be kept as written, each as often as in the original. Expected ${listOf(placeholders)}; the translation has ${listOf(translatedPlaceholders)}.`;
	}

	// The tags may change places, since another language orders its words differently, but none may be lost or added.
	const tags = tagsIn(source);
	const translatedTags = tagsIn(translated);
	if (!sameItems(tags, translatedTags)) {
		return `The HTML tags must be kept, each as often as in the original. Expected ${listOf(tags)}; the translation has ${listOf(translatedTags)}.`;
	}

	const lost = addressesIn(source).find((kept) => !translated.includes(kept));
	return lost === undefined ? null : `${lost} must appear in the translation exactly as written.`;
}
