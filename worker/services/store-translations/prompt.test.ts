/** What the translation model is told, and the check of its answer, with no model or database involved. */

import { describe, expect, it } from 'vitest';
import { buildTranslationPrompt, checkTranslation, translationSchema } from './prompt';

const items = [
	{ id: '1', text: 'Add to cart' },
	{ id: '2', text: 'Free shipping over $50 on {product}' },
];

describe('the translation prompt', () => {
	it('names the variety (Latin American Spanish with tú; Brazilian Portuguese with você) and keeps brand and product names, numbers, prices, urls and markup', () => {
		const spanish = buildTranslationPrompt('en', 'es', items).system;
		expect(spanish).toContain('from English to Latin American Spanish, using tú');
		const portuguese = buildTranslationPrompt('en', 'pt-BR', items).system;
		expect(portuguese).toContain('from English to Brazilian Portuguese, using você');
		expect(buildTranslationPrompt('es', 'en', items).system).toContain('from Latin American Spanish to English');

		for (const system of [spanish, portuguese]) {
			expect(system).toMatch(/store/i);
			expect(system).toMatch(/brand and product names/i);
			expect(system).toMatch(/numbers, prices and currency/i);
			expect(system).toMatch(/URLs, email addresses/i);
			expect(system).toMatch(/emoji, HTML tags and entities/i);
			expect(system).toContain('{placeholders}');
			expect(system).toMatch(/meaning, length and tone/i);
			expect(system).toMatch(/no quotes or notes|don't add quotes or notes/i);
			expect(system).toMatch(/only JSON/i);
		}
	});

	it('sends the texts as a JSON array of ids and texts, in the order given', () => {
		const { prompt } = buildTranslationPrompt('en', 'es', items);
		expect(JSON.parse(prompt)).toEqual(items);
		expect(prompt).not.toContain('problem');
	});

	it('names the problem of each text on a retry, and says what the problems are for', () => {
		const retry = buildTranslationPrompt('en', 'es', [{ id: '2', text: items[1].text, problem: 'Keep {product} exactly as written.' }]);
		expect(JSON.parse(retry.prompt)).toEqual([{ id: '2', text: items[1].text, problem: 'Keep {product} exactly as written.' }]);
		expect(retry.system).toMatch(/problem/i);
		expect(buildTranslationPrompt('en', 'es', items).system).not.toMatch(/problem/i);
	});

	it('writes accented texts as they are, not as escapes', () => {
		expect(buildTranslationPrompt('es', 'en', [{ id: '1', text: 'Envío gratis' }]).prompt).toContain('Envío gratis');
	});

	it('asks for the same ids back, in a schema the answer must fit', () => {
		expect(translationSchema.parse({ items: [{ id: '1', text: 'Añadir al carrito' }] })).toEqual({ items: [{ id: '1', text: 'Añadir al carrito' }] });
		expect(translationSchema.safeParse({ items: [{ id: 1, text: 'x' }] }).success).toBe(false);
	});
});

describe('checkTranslation', () => {
	it('accepts a translation that keeps the placeholders, the tags, the urls and the emails', () => {
		expect(checkTranslation('Add to cart', 'Añadir al carrito')).toBeNull();
		expect(checkTranslation('Hello {name}, you have {count} items', 'Hola {name}, tienes {count} artículos')).toBeNull();
		expect(checkTranslation('Order <b>now</b> at https://shop.example/menu?x=1.', 'Pide <b>ahora</b> en https://shop.example/menu?x=1.')).toBeNull();
		expect(checkTranslation('Write to help@shop.example.', 'Escribe a help@shop.example.')).toBeNull();
		// Placeholders may move: only what they are matters.
		expect(checkTranslation('{count} items in {place}', 'En {place} hay {count} artículos')).toBeNull();
	});

	it('names a placeholder that was changed, dropped, added or repeated', () => {
		expect(checkTranslation('Hello {name}', 'Hola {nombre}')).toMatch(/placeholder/i);
		expect(checkTranslation('Hello {name}', 'Hola')).toMatch(/\{name\}/);
		expect(checkTranslation('Hello', 'Hola {name}')).toMatch(/placeholder/i);
		expect(checkTranslation('{a} and {a}', '{a} y')).toMatch(/placeholder/i);
	});

	it('names html tags that were dropped, renamed or reordered', () => {
		expect(checkTranslation('Order <b>now</b>', 'Pide ahora')).toMatch(/tag/i);
		expect(checkTranslation('Order <b>now</b>', 'Pide <i>ahora</i>')).toMatch(/tag/i);
		expect(checkTranslation('Order <b>now</b> or <i>later</i>', 'Pide <i>luego</i> o <b>ahora</b>')).toMatch(/tag/i);
		expect(checkTranslation('Line<br/>break', 'Línea<br>salto')).toBeNull();
		expect(checkTranslation('Order <B>now</B>', 'Pide <b>ahora</b>')).toBeNull();
		expect(checkTranslation('Save $5 if 3 < 4 and 5 > 2', 'Ahorra $5 si 3 < 4 y 5 > 2')).toBeNull();
	});

	it('names a url or an email that is missing', () => {
		expect(checkTranslation('See https://shop.example/menu', 'Mira el menú')).toMatch(/https:\/\/shop\.example\/menu/);
		expect(checkTranslation('See https://shop.example/menu', 'Mira http://shop.example/menu')).toMatch(/shop\.example/);
		expect(checkTranslation('Mail help@shop.example', 'Escribe a ayuda@shop.example')).toMatch(/help@shop\.example/);
		expect(checkTranslation('See (https://shop.example/menu).', 'Mira (https://shop.example/menu).')).toBeNull();
	});

	it('refuses an empty translation of a text that is not empty', () => {
		expect(checkTranslation('Add to cart', '')).toMatch(/empty/i);
		expect(checkTranslation('Add to cart', '   ')).toMatch(/empty/i);
		expect(checkTranslation('', '')).toBeNull();
	});
});
