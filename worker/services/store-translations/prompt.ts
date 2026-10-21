/**
 * What the translation model is told and what it must answer, and the check of each translation it gives back: the
 * things a store's text must keep (placeholders, markup, urls and emails) are the things the prompt asks it to keep.
 */

import { z } from 'zod';
import { LOCALE_AI_NAMES, type Locale } from '../../../shared/i18n/locales';

/** The model answers each text's id with its translation. */
export const translationSchema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });

export interface TranslationItem {
	id: string;
	text: string;
	/** On a retry, what was wrong with the last answer for this text. */
	problem?: string;
}

/** How each language is written: the variety and the form of address Estori's own app uses. */
const FORM_OF_ADDRESS: Record<Locale, string> = { en: '', es: ', using tú', 'pt-BR': ', using você' };

export function buildTranslationPrompt(source: Locale, target: Locale, items: readonly TranslationItem[]): { system: string; prompt: string } {
	const lines = [
		`You translate a store's text for its shoppers, from ${LOCALE_AI_NAMES[source]} to ${LOCALE_AI_NAMES[target]}${FORM_OF_ADDRESS[target]}.`,
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

const PLACEHOLDER = /\{[A-Za-z_]\w*\}/g;
const TAG = /<(\/?)([A-Za-z][\w:-]*)/g;
const URL = /https?:\/\/[^\s<>"'`]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Punctuation that ends a sentence, not the url it follows. */
const URL_TRAILING = /[.,;:!?)\]]+$/;

const listOf = (items: readonly string[]): string => (items.length === 0 ? 'none' : items.join(' '));
const sameItems = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, index) => item === b[index]);

function placeholdersIn(text: string): string[] {
	return (text.match(PLACEHOLDER) ?? []).sort();
}

/** Each tag in order, a closing tag with its slash, so a dropped or reordered tag shows. */
function tagsIn(text: string): string[] {
	return Array.from(text.matchAll(TAG), (match) => `<${match[1]}${match[2].toLowerCase()}>`);
}

function urlsIn(text: string): string[] {
	return (text.match(URL) ?? []).map((url) => url.replace(URL_TRAILING, ''));
}

/** A problem with `translated` as the translation of `source`, worded for the model's retry; null when it is sound. */
export function checkTranslation(source: string, translated: string): string | null {
	if (source.trim() !== '' && translated.trim() === '') return 'The translation is empty.';

	const placeholders = placeholdersIn(source);
	const translatedPlaceholders = placeholdersIn(translated);
	if (!sameItems(placeholders, translatedPlaceholders)) {
		return `The placeholders must be kept as written, each as often as in the original. Expected ${listOf(placeholders)}; the translation has ${listOf(translatedPlaceholders)}.`;
	}

	const tags = tagsIn(source);
	const translatedTags = tagsIn(translated);
	if (!sameItems(tags, translatedTags)) {
		return `The HTML tags must be kept, in the same order. Expected ${listOf(tags)}; the translation has ${listOf(translatedTags)}.`;
	}

	const lost = [...urlsIn(source), ...(source.match(EMAIL) ?? [])].find((kept) => !translated.includes(kept));
	return lost === undefined ? null : `${lost} must appear in the translation exactly as written.`;
}
