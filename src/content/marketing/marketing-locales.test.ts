import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';
import pt from './pt-BR.json';
import esExtra from './es.extra.json';
import ptExtra from './pt-BR.extra.json';
import { marketingCatalog } from './catalog';
import { checkCatalog, usedMessages } from '../../../shared/i18n/catalog-check';
import { messagesOfFiles } from '../../../shared/i18n/extract';

function shape(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(shape);
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, shape(child)]));
 return typeof value;
}
const literal = (value: string) => JSON.stringify(value);

describe.each([['es', es, esExtra], ['pt-BR', pt, ptExtra]] as const)('public marketing %s', (_locale, copy, extra) => {
 it('has every English content path and the same array lengths and types', () => {
  expect(shape(copy)).toEqual(shape(en));
 });
 it('keeps all placeholders, rich-text tags and plural forms without empty values', () => {
  const dictionary = { ...extra, ...marketingCatalog(en, copy) };
  const source = Object.keys(dictionary).map(key => {
   const parts = key.split('|');
   return parts.length === 2 ? `tn(${literal(parts[0])}, ${literal(parts[1])}, count);` : `t(${literal(key)});`;
  }).join('\n');
  const messages = usedMessages(messagesOfFiles({ 'src/public-copy.ts': source }).messages);
  const report = checkCatalog(messages, dictionary);
  expect(report.missing).toEqual([]);
  expect(report.empty).toEqual([]);
  expect(report.badShape).toEqual([]);
  expect(report.mismatched).toEqual([]);
 });
 it('does not translate plan names or the Estori brand', () => {
  const translated = marketingCatalog(en, copy);
  for (const [english, value] of Object.entries(translated)) {
   if (typeof value !== 'string') continue;
   for (const brand of ['Estori', 'Basic', 'Pro', 'Premium', 'Enterprise', 'Stripe']) {
    if (new RegExp(`\\b${brand}\\b`).test(english)) expect(value, english).toMatch(new RegExp(`\\b${brand}\\b`));
   }
  }
 });
});
