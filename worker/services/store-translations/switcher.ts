/**
 * The language switcher on a translated store: a small `<details>` fixed at the bottom-left, so it needs no script and
 * never moves the store's layout. Its styles are inline, and reset where a store's own CSS could reach them.
 */

import type { Locale } from '../../../shared/i18n/locales';
import { escapeHtml } from '../../utils/html';
import { languageUrl } from './language';

/** Each language by its own name, as shoppers look for it. */
export const STORE_LANGUAGE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', es: 'Español', 'pt-BR': 'Português' };

/** The switcher's name for screen readers, in the language the page is in. */
const SWITCHER_LABEL: Readonly<Record<Locale, string>> = { en: 'Language', es: 'Idioma', 'pt-BR': 'Idioma' };

/** Marks the switcher, so the overlay script leaves its names as they are. */
export const SWITCHER_ATTRIBUTE = 'data-estori-languages';

const FONT = "font:400 14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c1c1c;letter-spacing:normal;text-transform:none;text-align:left";
const PANEL = 'background:#fff;border:1px solid rgba(0,0,0,.15);box-shadow:0 2px 8px rgba(0,0,0,.15);box-sizing:border-box';
const STYLES = {
	details: `all:initial;display:block;position:fixed;left:16px;bottom:16px;z-index:2147483000;${FONT}`,
	summary: `display:block;margin:0;padding:6px 12px;cursor:pointer;list-style:none;border-radius:999px;${PANEL};${FONT}`,
	list: `all:initial;display:block;position:absolute;left:0;bottom:100%;margin:0 0 6px;padding:4px;min-width:100%;list-style:none;border-radius:12px;${PANEL}`,
	item: 'all:initial;display:block',
	link: `display:block;margin:0;padding:6px 10px;border-radius:8px;text-decoration:none;white-space:nowrap;background:none;${FONT}`,
	current: 'font-weight:600',
} as const;

/** The switcher's markup: the page's language as its button, and a link to this page in each of the store's languages. */
export function languageSwitcher(current: Locale, languages: readonly Locale[], pageUrl: URL): string {
	const links = languages.map((locale) => {
		const url = languageUrl(pageUrl, locale);
		const href = escapeHtml(`${url.pathname}${url.search}`);
		const marked = locale === current ? ' aria-current="true"' : '';
		const style = locale === current ? `${STYLES.link};${STYLES.current}` : STYLES.link;
		return `<li style="${STYLES.item}"><a href="${href}" hreflang="${locale}" lang="${locale}"${marked} style="${style}">${escapeHtml(STORE_LANGUAGE_NAMES[locale])}</a></li>`;
	});
	return (
		`<details ${SWITCHER_ATTRIBUTE} translate="no" style="${STYLES.details}">` +
		`<summary aria-label="${SWITCHER_LABEL[current]}" style="${STYLES.summary}">${escapeHtml(STORE_LANGUAGE_NAMES[current])}</summary>` +
		`<ul style="${STYLES.list}">${links.join('')}</ul></details>`
	);
}
