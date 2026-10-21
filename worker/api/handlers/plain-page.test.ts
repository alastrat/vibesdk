import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import { plainPage } from './plain-page';

const CLOSED = "This store isn't open right now";

const STYLE =
	'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#1c1c1c;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}main{max-width:420px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:#5c5c5c}';

describe('plainPage', () => {
	it('is the page it always was for English', async () => {
		const response = plainPage('en', 404, CLOSED, 'Check back soon.');
		expect(response.status).toBe(404);
		expect(await response.text()).toBe(
			`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${CLOSED}</title>\n<style>${STYLE}</style>\n</head><body><main><h1>${CLOSED}</h1><p>Check back soon.</p></main></body></html>`,
		);
		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it.each<[Locale, string, string]>([
		['es', 'Esta tienda no está abierta en este momento', 'Vuelve pronto.'],
		['pt-BR', 'Esta loja não está aberta no momento', 'Volte em breve.'],
	])('words the %s page in that language, on the document and in its headers', async (locale, title, message) => {
		const response = plainPage(locale, 404, CLOSED, 'Check back soon.');
		const html = await response.text();
		expect(html).toContain(`<html lang="${locale}">`);
		expect(html).toContain(`<title>${title}</title>`);
		expect(html).toContain(`<main><h1>${title}</h1><p>${message}</p></main>`);
		expect(response.headers.get('Content-Language')).toBe(locale);
		expect(response.status).toBe(404);
	});

	it('translates every plain page a store shows, in each language', async () => {
		const pages: Array<[string, string]> = [
			['This store is temporarily unavailable', 'Try again in a moment.'],
			['Your payment is being confirmed', "This store's pages aren't open right now. If your payment goes through, the store has your order."],
			['Thank you for your order', "Your payment went through and the store has your order. Its pages aren't open right now."],
		];
		for (const locale of LOCALES.filter((candidate) => candidate !== 'en')) {
			for (const [title, message] of pages) {
				const html = await plainPage(locale, 200, title, message).text();
				expect(html, `${locale} ${title}`).not.toContain(title);
				expect(html, `${locale} ${message}`).not.toContain(message);
			}
		}
	});

	it('shows the English for text no catalog has, and escapes what it writes', async () => {
		const html = await plainPage('es', 200, '<b>A title</b> & more', 'Plain "words" <script>alert(1)</script>').text();
		expect(html).toContain('<h1>&lt;b&gt;A title&lt;/b&gt; &amp; more</h1>');
		expect(html).toContain('<p>Plain "words" &lt;script&gt;alert(1)&lt;/script&gt;</p>');
		expect(html).not.toContain('<script>alert(1)');
	});

	it('keeps the headers a caller adds, such as the receipt cookie', () => {
		const response = plainPage('es', 200, 'Thank you for your order', 'x', { 'Set-Cookie': 'receipt=1; Path=/' });
		expect(response.headers.get('Set-Cookie')).toBe('receipt=1; Path=/');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});
});
