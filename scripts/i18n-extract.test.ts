import { describe, expect, it } from 'vitest';
import { checkCatalog, syncCatalog, usedMessages } from '../shared/i18n/catalog-check';
import { messagesOfFiles } from '../shared/i18n/extract';
import { parseOptions, summaryLines } from './i18n-extract';

const KEEP = { prune: false };

/** The summary for a catalog synced against a source fixture. */
function summary(source: string, catalog: Record<string, unknown>, options = KEEP): string[] {
	const messages = usedMessages(messagesOfFiles({ 'src/fixture.ts': source }));
	const sync = syncCatalog(messages, catalog, options);
	return summaryLines('es.json', sync, checkCatalog(messages, sync.catalog), options);
}

describe('parseOptions', () => {
	it('keeps unused keys unless --prune is given', () => {
		expect(parseOptions([])).toEqual({ prune: false });
		expect(parseOptions(['--prune'])).toEqual({ prune: true });
	});

	it('refuses an option it does not know, and says what it takes', () => {
		expect(() => parseOptions(['--delete'])).toThrow(/Unknown option: --delete\nUsage: bun run i18n:extract \[--prune\]/);
	});
});

describe('summaryLines', () => {
	it('says a complete catalog is up to date', () => {
		expect(summary(`t('Save card');`, { 'Save card': 'Guardar tarjeta' })).toEqual(['es.json: up to date']);
	});

	it('lists what was added and still needs a translation, with where it is used', () => {
		expect(summary(`t('Save card');\ntn('{count} store', '{count} stores', n);`, {})).toEqual([
			'es.json: 2 added, 2 to translate',
			'  to translate:',
			'    "Save card" (src/fixture.ts:1)',
			'    "{count} store|{count} stores" (src/fixture.ts:2)',
		]);
	});

	it('lists unused keys as kept, or as removed when pruning', () => {
		const catalog = { 'Old text': 'Texto viejo', 'Save card': 'Guardar tarjeta' };
		expect(summary(`t('Save card');`, catalog)).toEqual(['es.json: 1 unused, kept (--prune removes them)', '  unused:', '    "Old text"']);
		expect(summary(`t('Save card');`, catalog, { prune: true })).toEqual(['es.json: 1 unused, removed', '  unused:', '    "Old text"']);
	});

	it('lists a translation that needs fixing', () => {
		expect(summary(`t('Renews on {date}');`, { 'Renews on {date}': 'Se renueva el {fecha}' })).toEqual([
			'es.json: 1 to fix',
			'  to fix:',
			'    "Renews on {date}": placeholders differ (English: {date}; translation: {fecha})',
		]);
	});

	it('cuts a long list short, and says how many are left', () => {
		const source = Array.from({ length: 30 }, (_, index) => `t('Message ${String(index).padStart(2, '0')}');`).join('\n');
		const lines = summary(source, {});
		expect(lines).toHaveLength(1 + 1 + 25 + 1);
		expect(lines[0]).toBe('es.json: 30 added, 30 to translate');
		expect(lines.at(-1)).toBe('    ... and 5 more');
	});
});
