import { describe, expect, it } from 'vitest';
import { serverT } from './server-t';

describe('serverT', () => {
	it('translates with the bundled catalog of each language', () => {
		expect(serverT('es').t('Open billing')).toBe('Abrir facturación');
		expect(serverT('pt-BR').t('Open billing')).toBe('Abrir cobrança');
	});

	it('answers the English text itself for English, and for a message no catalog has', () => {
		expect(serverT('en').t('Open billing')).toBe('Open billing');
		expect(serverT('es').t('A message nobody has translated')).toBe('A message nobody has translated');
		expect(serverT('es').t('A message with {value}', { value: 3 })).toBe('A message with 3');
	});

	it("carries its language, for the amounts and dates it words, and counts by the language's plural rule", () => {
		expect(serverT('pt-BR').locale).toBe('pt-BR');
		const stores = (locale: 'en' | 'es' | 'pt-BR', count: number) => serverT(locale).tn('Up to {count} live store', 'Up to {count} live stores', count);
		expect(stores('en', 1)).toBe('Up to 1 live store');
		expect(stores('es', 3)).toBe('Hasta 3 tiendas publicadas');
		// Portuguese counts 0 as singular.
		expect(stores('pt-BR', 0)).toBe('Até 0 loja no ar');
	});

	it('hands out one translator per language', () => {
		expect(serverT('es')).toBe(serverT('es'));
	});
});
