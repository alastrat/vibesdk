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
		expect(spanish).toContain('neutral Latin American Spanish, using Mexican vocabulary where words differ, with tú; no voseo, no regional idioms');
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

	it('names html tags that were dropped, renamed or added', () => {
		expect(checkTranslation('Order <b>now</b>', 'Pide ahora')).toMatch(/tag/i);
		expect(checkTranslation('Order <b>now</b>', 'Pide <i>ahora</i>')).toMatch(/tag/i);
		expect(checkTranslation('Order <b>now</b>', 'Pide <b>ahora')).toMatch(/tag/i);
		expect(checkTranslation('Order now', 'Pide <b>ahora</b>')).toMatch(/tag/i);
		expect(checkTranslation('Line<br/>break', 'Línea<br>salto')).toBeNull();
		expect(checkTranslation('Order <B>now</B>', 'Pide <b>ahora</b>')).toBeNull();
		expect(checkTranslation('Save $5 if 3 < 4 and 5 > 2', 'Ahorra $5 si 3 < 4 y 5 > 2')).toBeNull();
	});

	it('lets inline tags change places, since another language orders its words differently', () => {
		expect(checkTranslation('Order <b>now</b> or <i>later</i>', 'Pide <i>luego</i> o <b>ahora</b>')).toBeNull();
		expect(checkTranslation('<a href="/x">Sign in</a> to <strong>save</strong>', 'Para <strong>guardar</strong>, <a href="/x">inicia sesión</a>')).toBeNull();
	});

	it('counts a tag only when it is one: a known name, or a custom element with attributes', () => {
		// A placeholder-like instruction in angle brackets is shopper copy, not markup.
		expect(checkTranslation('Type <your name> here', 'Escribe <tu nombre> aquí')).toBeNull();
		expect(checkTranslation('Type <your name> here', 'Escribe tu nombre aquí')).toBeNull();
		expect(checkTranslation('Press <Enter> to send', 'Pulsa Intro para enviar')).toBeNull();
		// Known names count with or without attributes, and custom elements count when they carry attributes.
		expect(checkTranslation('Go <a href="/menu" class="link">now</a>', 'Ve ahora')).toMatch(/tag/i);
		expect(checkTranslation('See <my-widget id="w1">this</my-widget>', 'Mira esto')).toMatch(/tag/i);
		expect(checkTranslation('See <my-widget id="w1">this</my-widget>', 'Mira <my-widget id="w1">esto</my-widget>')).toBeNull();
	});

	it('checks numbered placeholders like named ones', () => {
		expect(checkTranslation('Item {0} of {1}', 'Artículo {1} de {0}')).toBeNull();
		expect(checkTranslation('Item {0} of {1}', 'Artículo {0} de')).toMatch(/\{1\}/);
		expect(checkTranslation('Item {0} of {1}', 'Artículo {0} de {2}')).toMatch(/placeholder/i);
		expect(checkTranslation('Hello {user_name} {2}', 'Hola {user_name} {2}')).toBeNull();
	});

	it("does not reject a translation for the punctuation of the language it is written in", () => {
		expect(checkTranslation('Do you want {item}?', '¿Quieres {item}?')).toBeNull();
		expect(checkTranslation('Welcome!', '¡Bienvenido!')).toBeNull();
		expect(checkTranslation('Is this {item}? Yes!', '¿Es este {item}? ¡Sí!')).toBeNull();
	});

	it('names a url or an email that is missing', () => {
		expect(checkTranslation('See https://shop.example/menu', 'Mira el menú')).toMatch(/https:\/\/shop\.example\/menu/);
		expect(checkTranslation('See https://shop.example/menu', 'Mira http://shop.example/menu')).toMatch(/shop\.example/);
		expect(checkTranslation('Mail help@shop.example', 'Escribe a ayuda@shop.example')).toMatch(/help@shop\.example/);
		expect(checkTranslation('See (https://shop.example/menu).', 'Mira (https://shop.example/menu).')).toBeNull();
	});

	it('does not take the punctuation around a url, in any language, for part of it', () => {
		for (const [source, translated] of [
			['Visit «https://x.y/z»', 'Visita «https://x.y/z»'],
			['Visit “https://x.y/z”', 'Visita «https://x.y/z»'],
			['Visit https://x.y/z…', 'Visita https://x.y/z...'],
			['Visit https://x.y/z—', 'Visita https://x.y/z -'],
			['Visit https://x.y/z!', 'Visita https://x.y/z.'],
			['Visit https://x.y/z?', 'Visita https://x.y/z'],
			['Write to «help@shop.example»', 'Escribe a “help@shop.example”'],
			['Write to help@shop.example…', 'Escribe a help@shop.example'],
		]) {
			expect(checkTranslation(source, translated), source).toBeNull();
		}
		// The path's own slash is kept: a url that ends in one is the same url only with it.
		expect(checkTranslation('Visit https://x.y/z/', 'Visita https://x.y/z')).toMatch(/https:\/\/x\.y\/z\//);
		expect(checkTranslation('Visit «https://x.y/z»', 'Visita https://x.y/otro')).toMatch(/https:\/\/x\.y\/z/);
	});

	it('refuses an empty translation of a text that is not empty', () => {
		expect(checkTranslation('Add to cart', '')).toMatch(/empty/i);
		expect(checkTranslation('Add to cart', '   ')).toMatch(/empty/i);
		expect(checkTranslation('', '')).toBeNull();
	});
});
