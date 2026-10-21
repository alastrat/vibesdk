import { describe, expect, it } from 'vitest';
import es from '../i18n/catalogs/es.json';
import ptBR from '../i18n/catalogs/pt-BR.json';
import { ENGLISH, translatorFor } from '../i18n/translate';
import { extraCreditsPriceLabel, limitFeatures, storeAllowance } from './plans';

const SPANISH = translatorFor(es, 'es');
const PORTUGUESE = translatorFor(ptBR, 'pt-BR');

/** `Intl` separates the currency from the amount with a no-break space in Spanish and Portuguese. */
const plain = (text: string) => text.replace(/ /g, ' ');

describe('what a plan includes, in the seller\'s language', () => {
	it('is English unless a translator is passed, so the public pricing page keeps its English', () => {
		expect(storeAllowance('pro')).toBe('Up to 3 live stores, 10 new stores a day');
		expect(limitFeatures('pro')).toEqual(['Up to 3 live stores, 10 new stores a day', 'Your own domain on each live store', 'The supplier catalog']);
		expect(limitFeatures('premium', 'pro', ENGLISH)).toEqual(['Up to 10 live stores, 25 new stores a day', 'Buy extra credits any time']);
		expect(extraCreditsPriceLabel()).toBe('$1.50 per 1,000');
	});

	it('words the allowance and the features in Spanish', () => {
		expect(storeAllowance('pro', SPANISH)).toBe('Hasta 3 tiendas publicadas, 10 tiendas nuevas al día');
		expect(limitFeatures('pro', undefined, SPANISH)).toEqual(['Hasta 3 tiendas publicadas, 10 tiendas nuevas al día', 'Tu propio dominio en cada tienda publicada', 'El catálogo de proveedores']);
		expect(plain(extraCreditsPriceLabel(SPANISH))).toBe('USD 1.50 por cada 1,000');
	});

	it('words them in Portuguese', () => {
		expect(limitFeatures('pro', undefined, PORTUGUESE)).toEqual(['Até 3 lojas no ar, 10 lojas novas por dia', 'Seu próprio domínio em cada loja no ar', 'O catálogo de fornecedores']);
		expect(plain(extraCreditsPriceLabel(PORTUGUESE))).toBe('US$ 1,50 por 1.000');
	});

	it("leaves out, for a plan above another, what the lower one already has, in the same language", () => {
		expect(limitFeatures('premium', 'pro', SPANISH)).toEqual(['Hasta 10 tiendas publicadas, 25 tiendas nuevas al día', 'Compra créditos adicionales cuando quieras']);
		expect(limitFeatures('premium', 'pro', PORTUGUESE)).toEqual(['Até 10 lojas no ar, 25 lojas novas por dia', 'Compre créditos extras quando quiser']);
	});
});
