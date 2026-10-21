/**
 * Pieces of the app shell mounted for real in each language: they must change with the language and keep the values
 * (names, numbers, amounts) the seller's data supplies. `react-test-renderer` mounts them without a DOM.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { ThinkModelOption } from '@/api-types';
import { applyAccountLocale } from '@/lib/i18n';
import { legalLinkLabel } from '@/lib/legal-link-label';
import { visibilityLabel } from '@/lib/visibility-label';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import { ModelUnavailableNotice } from './ModelUnavailableNotice';

beforeAll(silenceTestRendererDeprecation);

afterEach(async () => {
	await unmountAll();
	await applyAccountLocale('en');
});

const options: ThinkModelOption[] = [
	{ id: 'google/fast', label: 'Fast', provider: 'google-ai-studio', creditsPerStep: 16 },
	{ id: 'anthropic/deep', label: 'Deep', provider: 'anthropic', creditsPerStep: 136 },
];

/** Every piece of text the notice shows, in order. */
async function noticeText(reason: 'overloaded' | 'timeout'): Promise<string> {
	const renderer = await mountElement(
		createElement(ModelUnavailableNotice, {
			notice: { modelId: 'google/fast', reason, status: 503, alternativeModelId: 'anthropic/deep' },
			options,
			onSwitch: () => undefined,
			onRetry: () => undefined,
			onDismiss: () => undefined,
		}),
	);
	return textOf(renderer);
}

describe('ModelUnavailableNotice', () => {
	it('is in English by default', async () => {
		const text = await noticeText('overloaded');
		expect(text).toContain('Fast is unavailable');
		expect(text).toContain('Google reports high demand');
		expect(text).toContain('Switch to Deep');
		expect(text).toContain('Dismiss');
		expect(text).toContain('Deep uses about 136 credits per step instead of about 16 (about 8.5x)');
	});

	it('follows the language, keeping model and provider names', async () => {
		await applyAccountLocale('es');
		const spanish = await noticeText('timeout');
		expect(spanish).toContain('Fast no está disponible');
		expect(spanish).toContain('Google no respondió en 60 segundos');
		expect(spanish).toContain('Cambiar a Deep');
		expect(spanish).toContain('Descartar');
		await applyAccountLocale('pt-BR');
		const portuguese = await noticeText('timeout');
		expect(portuguese).toContain('Fast não está disponível');
		expect(portuguese).toContain('Google não respondeu em 60 segundos');
		expect(portuguese).toContain('Mudar para Deep');
		expect(portuguese).toContain('Dispensar');
	});
});

describe('labels of the app shell', () => {
	it('name who can see an app in each language', async () => {
		expect(visibilityLabel('private')).toBe('Private');
		await applyAccountLocale('es');
		expect([visibilityLabel('private'), visibilityLabel('public'), visibilityLabel('team'), visibilityLabel('board')]).toEqual(['Privado', 'Público', 'Equipo', 'Tablero']);
		await applyAccountLocale('pt-BR');
		expect([visibilityLabel('private'), visibilityLabel('public'), visibilityLabel('team'), visibilityLabel('board')]).toEqual(['Privado', 'Público', 'Equipe', 'Quadro']);
	});

	it('name the legal documents, whose text stays in English', async () => {
		expect(legalLinkLabel('terms')).toBe('Terms');
		await applyAccountLocale('es');
		expect(legalLinkLabel('copyright')).toBe('Derechos de autor');
		await applyAccountLocale('pt-BR');
		expect(legalLinkLabel('refunds')).toBe('Reembolsos');
	});
});
