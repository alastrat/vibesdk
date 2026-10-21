/**
 * `/__estori/i18n.js`: translates the text and attributes a store's scripts add or change after the page loads, with
 * the translations of the texts the store's scripts show inside it. The server already translated the page and the
 * store's products; this covers what scripts render. Text that is already a translation is left as it is.
 *
 * It keys text as the extractor does: whitespace runs collapsed and trimmed with the same expression as
 * `normalizeText`, on text the browser has already decoded. Its containers and attributes are the extractor's.
 */

import type { Locale } from '../../../shared/i18n/locales';
import { jsonForScript } from '../../utils/html';
import { BUTTON_INPUT_TYPES, CODE_CONTAINERS, TEXT_ATTRIBUTES, VALUE_CONTAINERS } from './extract';
import { SWITCHER_ATTRIBUTE } from './switcher';

const upperCased = (names: ReadonlySet<string>): string[] => [...names].map((name) => name.toUpperCase());

/** The overlay for one language: `entries` are `[normalized source text, translation]` pairs of the store's script texts. */
export function overlayScript(locale: Locale, entries: readonly (readonly [string, string])[]): string {
	return `/* Estori store translations: ${locale} */
(function () {
  var translations = new Map(${jsonForScript(entries)});
  var CODE = ${jsonForScript(upperCased(CODE_CONTAINERS))};
  var VALUES = ${jsonForScript(upperCased(VALUE_CONTAINERS))};
  var TEXT_ATTRIBUTES = ${jsonForScript([...TEXT_ATTRIBUTES])};
  var BUTTON_TYPES = ${jsonForScript([...BUTTON_INPUT_TYPES])};
  var SWITCHER = ${jsonForScript(SWITCHER_ATTRIBUTE)};
  var ATTRIBUTES = TEXT_ATTRIBUTES.concat(['value', 'content']);

  function normalize(text) {
    return text.replace(/\\s+/g, ' ').trim();
  }

  // A text that reads as a translation is never translated again, though it may be a source text too.
  var translated = new Set();
  translations.forEach(function (translation) {
    translated.add(normalize(translation));
  });

  function translationOf(text) {
    var key = normalize(text);
    return translated.has(key) ? undefined : translations.get(key);
  }

  function nameOf(element) {
    return String(element.nodeName).toUpperCase();
  }

  // Code, templates and the switcher keep their text and attributes; a textarea keeps only its text.
  function keepsAttributes(element) {
    return CODE.indexOf(nameOf(element)) >= 0 || element.hasAttribute(SWITCHER);
  }

  function keepsText(element) {
    return keepsAttributes(element) || VALUES.indexOf(nameOf(element)) >= 0;
  }

  function insideKept(node) {
    for (var parent = node.parentNode; parent && parent.nodeType === 1; parent = parent.parentNode) {
      if (keepsText(parent)) return true;
    }
    return false;
  }

  function readsAttribute(element, name) {
    if (TEXT_ATTRIBUTES.indexOf(name) >= 0) return true;
    var tag = nameOf(element);
    // A named button's value is also a form value the store's server reads.
    if (name === 'value') return tag === 'INPUT' && !element.hasAttribute('name') && BUTTON_TYPES.indexOf((element.getAttribute('type') || '').trim().toLowerCase()) >= 0;
    if (name !== 'content' || tag !== 'META') return false;
    var meta = (element.getAttribute('name') || '').toLowerCase();
    var property = (element.getAttribute('property') || '').toLowerCase();
    return meta === 'description' || property === 'og:title' || property === 'og:description';
  }

  function translateText(node) {
    var text = node.data;
    var translation = translationOf(text);
    if (translation === undefined) return;
    var leading = text.slice(0, text.length - text.trimStart().length);
    node.data = leading + translation + text.slice(text.trimEnd().length);
  }

  function translateAttribute(element, name) {
    var value = element.getAttribute(name);
    if (value === null || !readsAttribute(element, name)) return;
    var translation = translationOf(value);
    if (translation !== undefined) element.setAttribute(name, translation);
  }

  // A node and everything under it, once its ancestors are known to allow it.
  function walk(node) {
    if (node.nodeType === 3) return translateText(node);
    if (node.nodeType !== 1 || keepsAttributes(node)) return;
    for (var i = 0; i < ATTRIBUTES.length; i++) translateAttribute(node, ATTRIBUTES[i]);
    if (keepsText(node)) return;
    for (var child = node.firstChild; child; child = child.nextSibling) walk(child);
  }

  function translateNode(node) {
    if (!insideKept(node)) walk(node);
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'childList') {
        for (var j = 0; j < record.addedNodes.length; j++) translateNode(record.addedNodes[j]);
      } else if (record.type === 'characterData') {
        translateNode(record.target);
      } else if (record.type === 'attributes' && !insideKept(record.target) && !keepsAttributes(record.target)) {
        translateAttribute(record.target, record.attributeName);
      }
    }
    // What this callback wrote comes back as records; dropping them keeps it from seeing its own writes.
    observer.takeRecords();
  });

  translateNode(document.documentElement);
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTES });
})();
`;
}
