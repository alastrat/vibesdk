import { describe, expect, it } from 'vitest';
import { interpolate, msg, placeholdersOf, pluralKey, translate, translatePlural, type Catalog } from './translate';

const ES: Catalog = {
	'Renews on {date}': 'Se renueva el {date}',
	'Save card': 'Guardar tarjeta',
	'Empty': '',
	'{count} credit|{count} credits': { one: '{count} crédito', other: '{count} créditos' },
};

const PT: Catalog = {
	'{count} credit|{count} credits': { one: '{count} crédito', other: '{count} créditos' },
};

describe('interpolate', () => {
	it('fills named placeholders', () => {
		expect(interpolate('Renews on {date}', { date: 'May 1' })).toBe('Renews on May 1');
		expect(interpolate('{count} of {total}', { count: 3, total: 10 })).toBe('3 of 10');
		expect(interpolate('{x} and {x}', { x: 'a' })).toBe('a and a');
	});

	it('leaves an unknown placeholder as written', () => {
		expect(interpolate('Renews on {date}', {})).toBe('Renews on {date}');
		expect(interpolate('{a} {b}', { a: 'x' })).toBe('x {b}');
		expect(interpolate('Hello {constructor}', {})).toBe('Hello {constructor}');
	});

	it('returns text without values unchanged', () => {
		expect(interpolate('Renews on {date}')).toBe('Renews on {date}');
		expect(interpolate('Plain text')).toBe('Plain text');
	});

	it('does not expand placeholders that arrive inside a value', () => {
		expect(interpolate('Hi {name} {other}', { name: '{other}', other: 'x' })).toBe('Hi {other} x');
	});

	it('writes zero and numbers as given', () => {
		expect(interpolate('{n} left', { n: 0 })).toBe('0 left');
	});
});

describe('translate', () => {
	it('falls back to the English text when the key is missing', () => {
		expect(translate(ES, 'Not in the catalog')).toBe('Not in the catalog');
		expect(translate(null, 'Save card')).toBe('Save card');
	});

	it('uses a catalog hit', () => {
		expect(translate(ES, 'Save card')).toBe('Guardar tarjeta');
	});

	it('translates first, then interpolates, so translators can reorder', () => {
		expect(translate(ES, 'Renews on {date}', { date: '1 de mayo' })).toBe('Se renueva el 1 de mayo');
		expect(translate(null, 'Renews on {date}', { date: 'May 1' })).toBe('Renews on May 1');
	});

	it('treats an empty translation as missing, so a half-filled catalog never shows blanks', () => {
		expect(translate(ES, 'Empty')).toBe('Empty');
	});

	it('ignores keys inherited from Object and plural entries', () => {
		expect(translate(ES, 'constructor')).toBe('constructor');
		expect(translate(ES, 'toString')).toBe('toString');
		expect(translate(ES, '{count} credit|{count} credits')).toBe('{count} credit|{count} credits');
	});
});

describe('pluralKey and msg', () => {
	it('joins the singular and plural with a bar', () => {
		expect(pluralKey('{count} credit', '{count} credits')).toBe('{count} credit|{count} credits');
	});

	it('marks a string for the extractor and returns it unchanged', () => {
		expect(msg('Something went wrong')).toBe('Something went wrong');
	});
});

describe('translatePlural', () => {
	const credit = '{count} credit';
	const credits = '{count} credits';

	it('picks the form by the language rule: Portuguese counts zero as singular, Spanish does not', () => {
		expect(translatePlural(PT, 'pt-BR', credit, credits, 0)).toBe('0 crédito');
		expect(translatePlural(PT, 'pt-BR', credit, credits, 1)).toBe('1 crédito');
		expect(translatePlural(PT, 'pt-BR', credit, credits, 2)).toBe('2 créditos');
		expect(translatePlural(ES, 'es', credit, credits, 0)).toBe('0 créditos');
		expect(translatePlural(ES, 'es', credit, credits, 1)).toBe('1 crédito');
		expect(translatePlural(ES, 'es', credit, credits, 5)).toBe('5 créditos');
	});

	it('formats {count} for the language', () => {
		expect(translatePlural(ES, 'es', credit, credits, 100_000)).toBe('100,000 créditos');
		expect(translatePlural(PT, 'pt-BR', credit, credits, 100_000)).toBe('100.000 créditos');
		expect(translatePlural(null, 'en', credit, credits, 100_000)).toBe('100,000 credits');
	});

	it('uses the plural form for the large round counts Spanish and Portuguese class as many', () => {
		expect(translatePlural(ES, 'es', credit, credits, 1_000_000)).toBe('1,000,000 créditos');
		expect(translatePlural(PT, 'pt-BR', credit, credits, 1_000_000)).toBe('1.000.000 créditos');
	});

	it('falls back to the English forms by the English rule, in any language', () => {
		expect(translatePlural(null, 'en', credit, credits, 1)).toBe('1 credit');
		expect(translatePlural(null, 'en', credit, credits, 0)).toBe('0 credits');
		expect(translatePlural({}, 'pt-BR', credit, credits, 0)).toBe('0 credits');
		expect(translatePlural({}, 'pt-BR', credit, credits, 1)).toBe('1 credit');
		expect(translatePlural({}, 'es', credit, credits, 2_500)).toBe('2,500 credits');
	});

	it('falls back to English when the entry is a plain string or lacks a form', () => {
		const odd: Catalog = { '{count} credit|{count} credits': 'créditos' };
		expect(translatePlural(odd, 'es', credit, credits, 3)).toBe('3 credits');
		const half: Catalog = { '{count} credit|{count} credits': { one: '', other: '' } };
		expect(translatePlural(half, 'es', credit, credits, 1)).toBe('1 credit');
	});

	it('fills other values too, and keeps {count} as the formatted count', () => {
		const catalog: Catalog = { '{count} left on {plan}|{count} left on {plan}': { one: 'Queda {count} en {plan}', other: 'Quedan {count} en {plan}' } };
		expect(translatePlural(catalog, 'es', '{count} left on {plan}', '{count} left on {plan}', 1_200, { plan: 'Pro', count: 'ignored' })).toBe('Quedan 1,200 en Pro');
	});
});

describe('placeholdersOf', () => {
	it('lists the names of the placeholders, each once, in order of first use', () => {
		expect(placeholdersOf('{count} of {total}, then {count} again')).toEqual(['count', 'total']);
	});

	it('reads the same placeholders interpolate fills', () => {
		expect(placeholdersOf('{a_b} {C1} {_x}')).toEqual(['a_b', 'C1', '_x']);
		expect(placeholdersOf('{} { x } {1} {a-b} none')).toEqual([]);
		expect(placeholdersOf('plain text')).toEqual([]);
	});
});
