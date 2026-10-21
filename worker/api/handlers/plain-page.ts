import type { Locale } from '../../../shared/i18n/locales';
import { translateFor } from '../../utils/server-translate';

function escapeText(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A small page Estori shows on a store's address in its own words, when the store's pages can't be shown. `title` and
 * `message` are English text marked with `msg()`; the page is written in `locale`.
 */
export function plainPage(locale: Locale, status: number, title: string, message: string, headers: Record<string, string> = {}): Response {
	const words = { title: escapeText(translateFor(locale, title)), message: escapeText(translateFor(locale, message)) };
	const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${words.title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f4;color:#1c1c1c;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}main{max-width:420px;text-align:center}h1{font-size:24px;margin:0 0 8px}p{margin:0;color:#5c5c5c}</style>
</head><body><main><h1>${words.title}</h1><p>${words.message}</p></main></body></html>`;
	return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Language': locale, 'Cache-Control': 'no-store', ...headers } });
}
