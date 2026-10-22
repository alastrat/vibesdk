import { describe, expect, it } from 'vitest';
import es from '../i18n/catalogs/es.json';
import ptBR from '../i18n/catalogs/pt-BR.json';
import { ENGLISH, translatorFor } from '../i18n/translate';
import { assertWithinLimit, extraCreditsPriceLabel, limitFeatures, limitsFor, storeAllowance, type PlanAccount } from './plans';

const SPANISH = translatorFor(es, 'es');
const PORTUGUESE = translatorFor(ptBR, 'pt-BR');

/** `Intl` separates the currency from the amount with a no-break space in Spanish and Portuguese. */
const plain = (text: string) => text.replace(/ /g, ' ');

it('words credit and live-store refusals with localized dates, numbers and plurals', () => {
	const account: PlanAccount = {
		billing: true, plan: 'basic', limits: limitsFor({ billing: true, plan: 'basic', adminLimits: null }),
		creditsResetAt: Date.UTC(2026, 10, 19),
	};
	expect(assertWithinLimit(account, 'aiCredits', 5000, SPANISH)?.message).toBe(
		'Ya usaste los créditos de IA gratis de este mes. Se renuevan el 19 de noviembre, o puedes obtener Pro con 20,000 al mes.',
	);
	expect(assertWithinLimit(account, 'liveStores', 2, PORTUGUESE)?.message).toBe(
		'Basic inclui 2 lojas no ar. Assine Pro para ter até 5, ou Premium para ter até 20.',
	);
});

describe('what a plan includes, in the seller\'s language', () => {
	it('is English unless a translator is passed, so the public pricing page keeps its English', () => {
		expect(storeAllowance('pro')).toBe('Up to 5 live stores');
		expect(limitFeatures('pro')).toEqual(['Up to 5 live stores', 'Your own domain on each live store', 'The supplier catalog']);
		expect(limitFeatures('premium', 'pro', ENGLISH)).toEqual(['Up to 20 live stores']);
		expect(extraCreditsPriceLabel()).toBe('$1.50 per 1,000');
	});

	it('words the allowance and the features in Spanish', () => {
		expect(storeAllowance('pro', SPANISH)).toBe('Hasta 5 tiendas publicadas');
		expect(limitFeatures('pro', undefined, SPANISH)).toEqual(['Hasta 5 tiendas publicadas', 'Tu propio dominio en cada tienda publicada', 'El catálogo de proveedores']);
		expect(plain(extraCreditsPriceLabel(SPANISH))).toBe('USD 1.50 por cada 1,000');
	});

	it('words them in Portuguese', () => {
		expect(limitFeatures('pro', undefined, PORTUGUESE)).toEqual(['Até 5 lojas no ar', 'Seu próprio domínio em cada loja no ar', 'O catálogo de fornecedores']);
		expect(plain(extraCreditsPriceLabel(PORTUGUESE))).toBe('US$ 1,50 por 1.000');
	});

	it("leaves out, for a plan above another, what the lower one already has, in the same language", () => {
		expect(limitFeatures('premium', 'pro', SPANISH)).toEqual(['Hasta 20 tiendas publicadas']);
		expect(limitFeatures('premium', 'pro', PORTUGUESE)).toEqual(['Até 20 lojas no ar']);
	});
});
