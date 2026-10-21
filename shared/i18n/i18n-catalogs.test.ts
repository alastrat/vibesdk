import { describe, expect, it } from 'vitest';
import es from './catalogs/es.json';
import ptBR from './catalogs/pt-BR.json';
import { checkCatalog, describeMessage, serializeCatalog, syncCatalog, usedMessages, type UsedMessage } from './catalog-check';
import { messagesOfFiles } from './extract';

/** Every source file the app is built from, except tests. `scripts/i18n-extract.ts` scans the same files. */
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '/shared/**/*.{ts,tsx}', '/worker/**/*.{ts,tsx}', '!/**/*.{test,spec}.{ts,tsx}'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

/** The messages the fixture source marks for translation. */
function used(source: string): UsedMessage[] {
	return usedMessages(messagesOfFiles({ 'src/fixture.tsx': source }));
}

const FIXTURE = `
	t('Save card');
	t('Renews on {date}', { date });
	tn('{count} credit', '{count} credits', count);
	<T text="Read the <link>terms</link>" />
`;

const COMPLETE = {
	'Read the <link>terms</link>': 'Lee los <link>términos</link>',
	'Renews on {date}': 'Se renueva el {date}',
	'Save card': 'Guardar tarjeta',
	'{count} credit|{count} credits': { one: '{count} crédito', other: '{count} créditos' },
};

describe('usedMessages', () => {
	it('lists each key once, with every place that uses it, sorted by key', () => {
		const messages = usedMessages(messagesOfFiles({ '/src/b.ts': `t('Zed');\nt('Alpha');`, '/src/a.ts': `t('Alpha');` }));
		expect(messages.map(({ key, sites }) => ({ key, sites }))).toEqual([
			{ key: 'Alpha', sites: ['src/b.ts:2', 'src/a.ts:1'] },
			{ key: 'Zed', sites: ['src/b.ts:1'] },
		]);
	});

	it('keeps the singular and plural of a plural message', () => {
		expect(used(`tn('{count} credit', '{count} credits', n);`)[0].plural).toEqual({ singular: '{count} credit', plural: '{count} credits' });
	});
});

describe('checkCatalog', () => {
	const clean = { missing: [], empty: [], unused: [], badShape: [], mismatched: [], unsorted: false };

	it('has nothing to report for a complete, sorted catalog', () => {
		expect(checkCatalog(used(FIXTURE), COMPLETE)).toEqual(clean);
	});

	it('reports a message the catalog lacks, with where it is used', () => {
		const { missing } = checkCatalog(used(FIXTURE), { 'Save card': 'Guardar tarjeta' });
		expect(missing.map(describeMessage)).toEqual([
			'"Read the <link>terms</link>" (src/fixture.tsx:5)',
			'"Renews on {date}" (src/fixture.tsx:3)',
			'"{count} credit|{count} credits" (src/fixture.tsx:4)',
		]);
	});

	it('does not take a key the object inherits for a translation', () => {
		expect(checkCatalog(used(`t('constructor');`), {}).missing.map((message) => message.key)).toEqual(['constructor']);
	});

	it('reports an empty or blank translation, as the extractor leaves new keys', () => {
		const catalog = { ...COMPLETE, 'Save card': '', 'Renews on {date}': '   ' };
		expect(checkCatalog(used(FIXTURE), catalog).empty.map((message) => message.key)).toEqual(['Renews on {date}', 'Save card']);
	});

	it('reports a plural with a blank form as empty', () => {
		const catalog = { ...COMPLETE, '{count} credit|{count} credits': { one: '', other: '{count} créditos' } };
		expect(checkCatalog(used(FIXTURE), catalog).empty.map((message) => message.key)).toEqual(['{count} credit|{count} credits']);
	});

	it('reports a catalog key that no source uses', () => {
		const catalog = { ...COMPLETE, 'Old text': 'Texto viejo' };
		expect(checkCatalog(used(FIXTURE), catalog).unused).toEqual(['Old text']);
	});

	describe('placeholders', () => {
		it('reports a placeholder that is renamed, dropped or added', () => {
			const catalog = { ...COMPLETE, 'Renews on {date}': 'Se renueva el {fecha}' };
			expect(checkCatalog(used(FIXTURE), catalog).mismatched).toEqual(['"Renews on {date}": placeholders differ (English: {date}; translation: {fecha})']);
			const dropped = { ...COMPLETE, 'Renews on {date}': 'Se renueva pronto' };
			expect(checkCatalog(used(FIXTURE), dropped).mismatched).toEqual(['"Renews on {date}": placeholders differ (English: {date}; translation: none)']);
			const added = { ...COMPLETE, 'Save card': 'Guardar {card}' };
			expect(checkCatalog(used(FIXTURE), added).mismatched).toEqual(['"Save card": placeholders differ (English: none; translation: {card})']);
		});

		it('accepts placeholders that move, or repeat, so the sentence reads naturally', () => {
			const messages = used(`t('{count} of {total} used'); t('{a} and {b}');`);
			const catalog = { '{a} and {b}': '{b} y {a}, {a}', '{count} of {total} used': '{total} en total, {count} usados' };
			expect(checkCatalog(messages, catalog).mismatched).toEqual([]);
		});

		it('checks each plural form against the English form it translates', () => {
			const messages = used(`tn('one credit', '{count} credits', n);`);
			const key = 'one credit|{count} credits';
			expect(checkCatalog(messages, { [key]: { one: 'un crédito', other: '{count} créditos' } }).mismatched).toEqual([]);
			expect(checkCatalog(messages, { [key]: { one: 'un crédito', other: 'varios créditos' } }).mismatched).toEqual([
				'"one credit|{count} credits" (other): placeholders differ (English: {count}; translation: none)',
			]);
			expect(checkCatalog(messages, { [key]: { one: '{count} crédito', other: '{count} créditos' } }).mismatched).toEqual([
				'"one credit|{count} credits" (one): placeholders differ (English: none; translation: {count})',
			]);
		});

		it('does not take braces that are not a placeholder for one', () => {
			const catalog = { 'Use {} or { x } here': 'Usa {} o { x } aquí' };
			expect(checkCatalog(used(`t('Use {} or { x } here');`), catalog).mismatched).toEqual([]);
		});
	});

	describe('tags', () => {
		it('reports a tag that is dropped, renamed or left unclosed', () => {
			const dropped = { ...COMPLETE, 'Read the <link>terms</link>': 'Lee los términos' };
			expect(checkCatalog(used(FIXTURE), dropped).mismatched).toEqual(['"Read the <link>terms</link>": tags differ (English: </link> <link>; translation: none)']);
			const renamed = { ...COMPLETE, 'Read the <link>terms</link>': 'Lee los <a>términos</a>' };
			expect(checkCatalog(used(FIXTURE), renamed).mismatched).toEqual(['"Read the <link>terms</link>": tags differ (English: </link> <link>; translation: </a> <a>)']);
			const unclosed = { ...COMPLETE, 'Read the <link>terms</link>': 'Lee los <link>términos' };
			expect(checkCatalog(used(FIXTURE), unclosed).mismatched).toEqual(['"Read the <link>terms</link>": tags differ (English: </link> <link>; translation: <link>)']);
		});

		it('accepts tags that move', () => {
			const messages = used(`t('<b>Bold</b> and <i>italic</i>');`);
			const catalog = { '<b>Bold</b> and <i>italic</i>': '<i>Cursiva</i> y <b>negrita</b>' };
			expect(checkCatalog(messages, catalog).mismatched).toEqual([]);
		});
	});

	describe('plural entries', () => {
		const key = '{count} credit|{count} credits';

		it('reports a plural message translated as one string', () => {
			const catalog = { ...COMPLETE, [key]: '{count} créditos' };
			expect(checkCatalog(used(FIXTURE), catalog).badShape).toEqual([`"${key}": a plural message needs { "one": …, "other": … }`]);
		});

		it('reports a plural that lacks one or other', () => {
			const lacksOne = { ...COMPLETE, [key]: { other: '{count} créditos' } };
			expect(checkCatalog(used(FIXTURE), lacksOne).badShape).toEqual([`"${key}": lacks "one"`]);
			const lacksOther = { ...COMPLETE, [key]: { one: '{count} crédito' } };
			expect(checkCatalog(used(FIXTURE), lacksOther).badShape).toEqual([`"${key}": lacks "other"`]);
			const lacksBoth = { ...COMPLETE, [key]: {} };
			expect(checkCatalog(used(FIXTURE), lacksBoth).badShape).toEqual([`"${key}": lacks "one"`, `"${key}": lacks "other"`]);
		});

		it('reports a form that is not text, and forms besides one and other', () => {
			const notText = { ...COMPLETE, [key]: { one: 1, other: '{count} créditos' } };
			expect(checkCatalog(used(FIXTURE), notText).badShape).toEqual([`"${key}": lacks "one"`]);
			const extra = { ...COMPLETE, [key]: { one: '{count} crédito', many: '{count} de créditos', other: '{count} créditos' } };
			expect(checkCatalog(used(FIXTURE), extra).badShape).toEqual([`"${key}": has forms besides "one" and "other": many`]);
		});

		it('reports plural forms on a message that is not a plural', () => {
			const catalog = { ...COMPLETE, 'Save card': { one: 'Guardar', other: 'Guardar' } };
			expect(checkCatalog(used(FIXTURE), catalog).badShape).toEqual(['"Save card": must be a string, not an object']);
		});

		it('reports a value that is neither text nor plural forms', () => {
			expect(checkCatalog(used(`t('A'); t('B'); t('C');`), { A: null, B: 7, C: ['x'] }).badShape).toEqual([
				'"A": must be a string, not null',
				'"B": must be a string, not number',
				'"C": must be a string, not an array',
			]);
		});
	});

	it('reports keys that are not sorted', () => {
		const messages = used(`t('A'); t('B');`);
		expect(checkCatalog(messages, { A: 'a', B: 'b' }).unsorted).toBe(false);
		expect(checkCatalog(messages, { B: 'b', A: 'a' }).unsorted).toBe(true);
	});

	it('sorts by code unit, so uppercase comes before lowercase', () => {
		expect(checkCatalog(used(`t('b'); t('B');`), { B: 'b', b: 'b' }).unsorted).toBe(false);
	});
});

describe('syncCatalog', () => {
	const messages = used(FIXTURE);

	it('adds each new message with a blank translation, a plural with two blank forms', () => {
		const { catalog, added } = syncCatalog(messages, {}, { prune: false });
		expect(catalog).toEqual({
			'Read the <link>terms</link>': '',
			'Renews on {date}': '',
			'Save card': '',
			'{count} credit|{count} credits': { one: '', other: '' },
		});
		expect(added.map((message) => message.key)).toEqual(['Read the <link>terms</link>', 'Renews on {date}', 'Save card', '{count} credit|{count} credits']);
	});

	it('leaves existing entries exactly as they are, and adds only what is missing', () => {
		const plural = { one: '{count} crédito', other: '{count} créditos' };
		const existing = { 'Save card': 'Guardar tarjeta', '{count} credit|{count} credits': plural };
		const { catalog, added } = syncCatalog(messages, existing, { prune: false });
		expect(catalog['Save card']).toBe('Guardar tarjeta');
		expect(catalog['{count} credit|{count} credits']).toBe(plural);
		expect(added.map((message) => message.key)).toEqual(['Read the <link>terms</link>', 'Renews on {date}']);
	});

	it('writes the keys sorted, including keys no source uses', () => {
		const { catalog } = syncCatalog(messages, { Zed: 'zeta', 'Save card': 'Guardar tarjeta', Alpha: 'alfa' }, { prune: false });
		expect(Object.keys(catalog)).toEqual(['Alpha', 'Read the <link>terms</link>', 'Renews on {date}', 'Save card', 'Zed', '{count} credit|{count} credits']);
	});

	it('lists unused keys and keeps them, unless asked to prune', () => {
		const existing = { ...COMPLETE, 'Old text': 'Texto viejo' };
		const kept = syncCatalog(messages, existing, { prune: false });
		expect(kept.unused).toEqual(['Old text']);
		expect(kept.catalog['Old text']).toBe('Texto viejo');
		const pruned = syncCatalog(messages, existing, { prune: true });
		expect(pruned.unused).toEqual(['Old text']);
		expect(Object.keys(pruned.catalog)).not.toContain('Old text');
		expect(pruned.catalog['Save card']).toBe('Guardar tarjeta');
	});

	it('does not take an inherited key for an existing entry', () => {
		const { catalog, added } = syncCatalog(used(`t('constructor');`), {}, { prune: false });
		expect(added.map((message) => message.key)).toEqual(['constructor']);
		expect(Object.entries(catalog)).toEqual([['constructor', '']]);
	});

	it('writes the same file when run again, and only adds on the way', () => {
		const first = serializeCatalog(syncCatalog(messages, { Zed: 'zeta', 'Save card': 'Guardar tarjeta' }, { prune: false }).catalog);
		const second = serializeCatalog(syncCatalog(messages, JSON.parse(first), { prune: false }).catalog);
		expect(second).toBe(first);
	});

	it('serializes with tabs, one entry per line, and a final newline', () => {
		expect(serializeCatalog({})).toBe('{}\n');
		expect(serializeCatalog({ A: 'ñ ¿', P: { one: 'x', other: 'y' } })).toBe('{\n\t"A": "ñ ¿",\n\t"P": {\n\t\t"one": "x",\n\t\t"other": "y"\n\t}\n}\n');
	});
});

describe('the catalogs against the source', () => {
	it('scans the app source and not its tests', () => {
		const paths = Object.keys(sources);
		expect(paths).toContain('/src/main.tsx');
		expect(paths).toContain('/shared/i18n/extract.ts');
		expect(paths).toContain('/worker/index.ts');
		expect(paths.filter((path) => /\.(test|spec)\.tsx?$/.test(path))).toEqual([]);
	});

	const messages = usedMessages(messagesOfFiles(sources));

	describe.each([
		['es.json', es],
		['pt-BR.json', ptBR],
	])('%s', (_name, catalog) => {
		const report = checkCatalog(messages, catalog);

		it('translates every message the source marks, with no blank translation', () => {
			expect(report.missing.map(describeMessage)).toEqual([]);
			expect(report.empty.map(describeMessage)).toEqual([]);
		});

		it('has no key that no source uses', () => {
			expect(report.unused).toEqual([]);
		});

		it('keeps every placeholder and tag of the English', () => {
			expect(report.mismatched).toEqual([]);
		});

		it('gives every plural a one and an other form, and every other message a string', () => {
			expect(report.badShape).toEqual([]);
		});

		it('keeps its keys sorted, as bun run i18n:extract writes them', () => {
			expect(report.unsorted).toBe(false);
		});
	});
});
