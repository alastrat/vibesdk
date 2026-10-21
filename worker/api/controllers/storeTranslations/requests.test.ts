import { describe, expect, it } from 'vitest';
import { MAX_TEXT_CHARS } from '../../../../shared/types/store-translations';
import { isEmptyPatch, parseSellerText, parseSettingsPatch } from './requests';

const english = { sourceLocale: 'en', targets: {} } as const;
const refusalOf = (parsed: ReturnType<typeof parseSettingsPatch>) => (parsed.ok ? null : parsed.message);

describe('the settings a seller may change', () => {
	it('takes switches that are booleans, a language Estori speaks and the languages to translate into', () => {
		expect(parseSettingsPatch({ matchBrowser: false, showSwitcher: true, autoTranslate: false, sourceLocale: 'es', targets: { 'pt-BR': { enabled: true }, en: { enabled: false } } }, english)).toEqual({
			ok: true,
			value: { matchBrowser: false, showSwitcher: true, autoTranslate: false, sourceLocale: 'es', targets: { 'pt-BR': { enabled: true }, en: { enabled: false } } },
		});
	});

	it('leaves out what it was not sent, ignores what it does not know, and never takes a ready flag from the seller', () => {
		expect(parseSettingsPatch({ showSwitcher: false, version: 99, extra: 1, targets: { es: { enabled: true, ready: true } } }, english)).toEqual({
			ok: true,
			value: { showSwitcher: false, targets: { es: { enabled: true } } },
		});
		expect(parseSettingsPatch({}, english)).toEqual({ ok: true, value: {} });
		expect(isEmptyPatch({})).toBe(true);
		expect(isEmptyPatch({ matchBrowser: true })).toBe(false);
	});

	it('refuses anything that is not a JSON object', () => {
		for (const body of [undefined, null, 'es', 4, [], [{ matchBrowser: true }]]) expect(refusalOf(parseSettingsPatch(body, english)), String(body)).toBe('Send the settings as JSON.');
	});

	it('refuses a switch that is not a boolean', () => {
		for (const value of ['yes', 1, 0, null, 'false', {}]) {
			for (const flag of ['matchBrowser', 'showSwitcher', 'autoTranslate']) expect(refusalOf(parseSettingsPatch({ [flag]: value }, english)), `${flag}=${String(value)}`).toBe('Send each switch as on or off.');
		}
	});

	it('refuses a store language Estori does not speak', () => {
		for (const sourceLocale of ['fr', 'pt', 'EN', '', null, 3]) expect(refusalOf(parseSettingsPatch({ sourceLocale }, english)), String(sourceLocale)).toMatch(/Choose one of Estori/);
	});

	it('takes only the three languages as keys of the targets, whatever the key is', () => {
		for (const key of ['fr', 'pt', '__proto__', 'constructor', 'toString', '']) {
			expect(refusalOf(parseSettingsPatch(JSON.parse(`{"targets":{${JSON.stringify(key)}:{"enabled":true}}}`), english)), key).toBe('Choose languages from the list.');
		}
		for (const targets of [null, 'es', [], 3]) expect(refusalOf(parseSettingsPatch({ targets }, english)), String(targets)).toBe('Send each language as on or off.');
		for (const entry of [true, null, {}, { enabled: 'yes' }, { enabled: 1 }, []]) expect(refusalOf(parseSettingsPatch({ targets: { es: entry } }, english)), JSON.stringify(entry)).toBe('Send each language as on or off.');
	});

	it("refuses to translate a store into its own language, whether it is already its language or the patch makes it so", () => {
		const message = "A store's own language can't also be a translation.";
		expect(refusalOf(parseSettingsPatch({ targets: { en: { enabled: true } } }, english))).toBe(message);
		expect(refusalOf(parseSettingsPatch({ sourceLocale: 'es', targets: { es: { enabled: true } } }, english))).toBe(message);
		// Turning it off, which changes nothing, is not refused.
		expect(parseSettingsPatch({ targets: { en: { enabled: false } } }, english)).toEqual({ ok: true, value: { targets: { en: { enabled: false } } } });
	});

	it('turns a translation off when its language becomes the store\'s own, so one language is never both', () => {
		const translated = { sourceLocale: 'en', targets: { es: { enabled: true, ready: true }, 'pt-BR': { enabled: true, ready: false } } } as const;
		expect(parseSettingsPatch({ sourceLocale: 'es' }, translated)).toEqual({ ok: true, value: { sourceLocale: 'es', targets: { es: { enabled: false } } } });
		expect(parseSettingsPatch({ sourceLocale: 'es', targets: { 'pt-BR': { enabled: false } } }, translated)).toEqual({
			ok: true,
			value: { sourceLocale: 'es', targets: { 'pt-BR': { enabled: false }, es: { enabled: false } } },
		});
		// A language that was not on needs nothing.
		expect(parseSettingsPatch({ sourceLocale: 'pt-BR' }, { sourceLocale: 'en', targets: { 'pt-BR': { enabled: false, ready: false } } })).toEqual({ ok: true, value: { sourceLocale: 'pt-BR' } });
	});
});

describe("the seller's own words for a text", () => {
	it('keeps them trimmed', () => {
		expect(parseSellerText({ text: '  Té de la casa \n' })).toEqual({ ok: true, value: 'Té de la casa' });
		expect(parseSellerText({ text: 'x'.repeat(MAX_TEXT_CHARS) })).toMatchObject({ ok: true });
	});

	it('refuses nothing but spaces, a text that is too long, and anything that is not a text', () => {
		expect(parseSellerText({ text: '   \n\t' })).toEqual({ ok: false, message: 'Write the translation.' });
		expect(parseSellerText({ text: '' })).toEqual({ ok: false, message: 'Write the translation.' });
		expect(parseSellerText({ text: 'x'.repeat(MAX_TEXT_CHARS + 1) })).toMatchObject({ ok: false, message: 'A translation can have at most {max} characters.' });
		// Spaces around a text at the limit are not counted.
		expect(parseSellerText({ text: ` ${'x'.repeat(MAX_TEXT_CHARS)} ` })).toMatchObject({ ok: true });
		for (const body of [undefined, null, 'text', 4, [], {}, { text: 4 }, { text: null }, { text: ['a'] }]) expect(parseSellerText(body), String(body)).toEqual({ ok: false, message: 'Send the translation as JSON.' });
	});
});
