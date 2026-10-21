import { afterEach, describe, expect, it } from 'vitest';
import { applyAccountLocale } from '@/lib/i18n';
import { describeCreditChange } from './credit-change';

afterEach(async () => {
	await applyAccountLocale('en');
});

describe('describeCreditChange', () => {
	it('describes a change between models in typical credits per step', () => {
		expect(describeCreditChange(16, 136)).toBe('about 136 credits per step instead of about 16 (about 8.5x)');
		expect(describeCreditChange(136, 16)).toBe('about 16 credits per step instead of about 136 (about 88% cheaper)');
		expect(describeCreditChange(136, 136)).toBe('about 136 credits per step');
	});

	it('uses the singular for one credit', () => {
		expect(describeCreditChange(1, 1)).toBe('about 1 credit per step');
	});

	it('describes it in Spanish', async () => {
		await applyAccountLocale('es');
		expect(describeCreditChange(16, 136)).toBe('alrededor de 136 créditos por paso, en lugar de 16 (unas 8.5 veces el consumo actual)');
		expect(describeCreditChange(136, 16)).toBe('alrededor de 16 créditos por paso, en lugar de 136 (aproximadamente 88% más barato)');
		expect(describeCreditChange(136, 136)).toBe('alrededor de 136 créditos por paso');
	});

	it('describes it in Portuguese, with its plural rule', async () => {
		await applyAccountLocale('pt-BR');
		expect(describeCreditChange(16, 136)).toBe('cerca de 136 créditos por etapa, em vez de 16 (cerca de 8,5 vezes o consumo atual)');
		expect(describeCreditChange(1, 1)).toBe('cerca de 1 crédito por etapa');
	});
});
