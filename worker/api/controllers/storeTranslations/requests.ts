/** What a seller may send to the translations API, checked before anything is saved. A refusal's message is English marked with `msg()`; the controller translates it. */

import { isLocale, type Locale } from '../../../../shared/i18n/locales';
import { msg } from '../../../../shared/i18n/translate';
import { MAX_TEXT_CHARS, type StoreTranslationSettings, type StoreTranslationSettingsPatch } from '../../../../shared/types/store-translations';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const refused = (message: string): { ok: false; message: string } => ({ ok: false, message });

const SETTING_FLAGS = ['matchBrowser', 'showSwitcher', 'autoTranslate'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTargets(value: unknown, source: Locale): Parsed<NonNullable<StoreTranslationSettingsPatch['targets']>> {
	if (!isRecord(value)) return refused(msg('Send each language as on or off.'));
	const targets: NonNullable<StoreTranslationSettingsPatch['targets']> = {};
	for (const [locale, entry] of Object.entries(value)) {
		if (!isLocale(locale)) return refused(msg('Choose languages from the list.'));
		if (!isRecord(entry) || typeof entry.enabled !== 'boolean') return refused(msg('Send each language as on or off.'));
		if (locale === source && entry.enabled) return refused(msg("A store's own language can't also be a translation."));
		targets[locale] = { enabled: entry.enabled };
	}
	return { ok: true, value: targets };
}

/**
 * The settings the seller changes: switches are on or off, languages are the ones Estori speaks, and the store's own
 * language is never also a language it is translated into. Choosing a language the store was translated into as the
 * store's own turns that translation off.
 */
export function parseSettingsPatch(body: unknown, current: Pick<StoreTranslationSettings, 'sourceLocale' | 'targets'>): Parsed<StoreTranslationSettingsPatch> {
	if (!isRecord(body)) return refused(msg('Send the settings as JSON.'));
	const patch: StoreTranslationSettingsPatch = {};
	if (body.sourceLocale !== undefined) {
		if (!isLocale(body.sourceLocale)) return refused(msg("Choose one of Estori's languages for the store's own language."));
		patch.sourceLocale = body.sourceLocale;
	}
	const source = patch.sourceLocale ?? current.sourceLocale;
	for (const flag of SETTING_FLAGS) {
		const value = body[flag];
		if (value === undefined) continue;
		if (typeof value !== 'boolean') return refused(msg('Send each switch as on or off.'));
		patch[flag] = value;
	}
	if (body.targets !== undefined) {
		const targets = parseTargets(body.targets, source);
		if (!targets.ok) return targets;
		patch.targets = targets.value;
	}
	if (patch.sourceLocale !== undefined && current.targets[source]?.enabled && patch.targets?.[source] === undefined) {
		patch.targets = { ...patch.targets, [source]: { enabled: false } };
	}
	return { ok: true, value: patch };
}

/** Whether the patch changes nothing, so saving it would only bump the store's version. */
export function isEmptyPatch(patch: StoreTranslationSettingsPatch): boolean {
	return Object.keys(patch).length === 0;
}

/** The seller's own words for a text: not empty, and short enough to be translated at all. Kept trimmed. */
export function parseSellerText(body: unknown): Parsed<string> {
	if (!isRecord(body) || typeof body.text !== 'string') return refused(msg('Send the translation as JSON.'));
	const text = body.text.trim();
	if (text === '') return refused(msg('Write the translation.'));
	if (text.length > MAX_TEXT_CHARS) return refused(msg('A translation can have at most {max} characters.'));
	return { ok: true, value: text };
}
