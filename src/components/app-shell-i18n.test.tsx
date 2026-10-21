/**
 * Pieces of the app shell mounted for real in each language: they must change with the language and keep the values
 * (names, numbers, amounts) the seller's data supplies. `react-test-renderer` mounts them without a DOM.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import type { ThinkModelOption } from '@/api-types';
import { applyAccountLocale } from '@/lib/i18n';
import { legalLinkLabel } from '@/lib/legal-link-label';
import { visibilityLabel } from '@/lib/visibility-label';
import { ModelUnavailableNotice } from './ModelUnavailableNotice';

vi.hoisted(() => {
	// React's `await act(...)` queues its work on a MessageChannel, which Workers don't have.
	class Channel {
		port1: { onmessage: ((event: unknown) => void) | null } = { onmessage: null };
		port2 = { postMessage: () => void setTimeout(() => this.port1.onmessage?.({}), 0) };
	}
	Object.assign(globalThis, { MessageChannel: Channel, IS_REACT_ACT_ENVIRONMENT: true });
});

beforeAll(() => {
	// The test renderer announces its own deprecation on every mount.
	const error = console.error.bind(console);
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		if (!String(args[0]).includes('react-test-renderer is deprecated')) error(...args);
	});
});

afterEach(async () => {
	await applyAccountLocale('en');
});

const options: ThinkModelOption[] = [
	{ id: 'google/fast', label: 'Fast', provider: 'google-ai-studio', creditsPerStep: 16 },
	{ id: 'anthropic/deep', label: 'Deep', provider: 'anthropic', creditsPerStep: 136 },
];

/** Every piece of text the notice shows, in order. */
async function noticeText(reason: 'overloaded' | 'timeout'): Promise<string> {
	let renderer!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		renderer = TestRenderer.create(
			createElement(ModelUnavailableNotice, {
				notice: { modelId: 'google/fast', reason, status: 503, alternativeModelId: 'anthropic/deep' },
				options,
				onSwitch: () => undefined,
				onRetry: () => undefined,
				onDismiss: () => undefined,
			}),
		);
	});
	const text: string[] = [];
	const collect = (node: TestRenderer.ReactTestRendererJSON | string | null | Array<TestRenderer.ReactTestRendererJSON | string>): void => {
		if (node === null) return;
		if (typeof node === 'string') text.push(node);
		else if (Array.isArray(node)) node.forEach(collect);
		else node.children?.forEach(collect);
	};
	collect(renderer.toJSON());
	await act(async () => renderer.unmount());
	return text.join(' ');
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
