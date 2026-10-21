/**
 * The pages opened from account emails, mounted for real. An API that answers in the visitor's language must still be
 * understood: an expired link has to show the "request a new link" page whatever language the answer comes in.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { Input } from '@cloudflare/kumo';
import { CONFIRM_LINK_INVALID_MESSAGE, RESET_LINK_INVALID_MESSAGE } from '@/api-types';
import { PasswordField } from '@/components/auth/PasswordField';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { apiClient } from '@/lib/api-client';
import { applyAccountLocale, t } from '@/lib/i18n';
import ResetPasswordPage from './ResetPasswordPage';
import VerifyEmailPage from './VerifyEmailPage';

vi.hoisted(() => {
	// React's `await act(...)` queues its work on a MessageChannel, which Workers don't have.
	class Channel {
		port1: { onmessage: ((event: unknown) => void) | null } = { onmessage: null };
		port2 = { postMessage: () => void setTimeout(() => this.port1.onmessage?.({}), 0) };
	}
	Object.assign(globalThis, { MessageChannel: Channel, IS_REACT_ACT_ENVIRONMENT: true });
});

// Kumo's components read `window` when they mount, which the Workers test pool doesn't have; these keep what the pages
// hand them (text, handlers) in plain elements.
vi.mock('@cloudflare/kumo', async () => {
	const { createElement, forwardRef } = await import('react');
	const text = (props: { title?: string; description?: string }) => createElement('div', null, props.title, props.description);
	const Button = forwardRef<HTMLButtonElement, { children?: React.ReactNode; onClick?: () => void }>((props, ref) => createElement('button', { ref, onClick: props.onClick }, props.children));
	const InputGroup = Object.assign((props: { children?: React.ReactNode }) => createElement('div', null, props.children), { Input: () => null, Addon: () => null, Button: () => null });
	return { Banner: text, Button, Input: () => null, InputGroup, buttonVariants: () => '', cn: (...names: unknown[]) => names.filter(Boolean).join(' ') };
});

vi.mock('@/lib/api-client', () => ({ apiClient: { verifyEmail: vi.fn(), resetPassword: vi.fn() } }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ isAuthenticated: false, refreshUser: async () => undefined }) }));
vi.mock('@/components/auth/AuthModalProvider', () => ({ useAuthModal: () => ({ showAuthModal: () => undefined }) }));

beforeAll(() => {
	// The test renderer announces its own deprecation on every mount.
	const error = console.error.bind(console);
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		if (!String(args[0]).includes('react-test-renderer is deprecated')) error(...args);
	});
});

afterEach(async () => {
	vi.mocked(apiClient.verifyEmail).mockReset();
	vi.mocked(apiClient.resetPassword).mockReset();
	await applyAccountLocale('en');
});

const failure = (message: string) => ({ success: false as const, error: { message, name: 'Error' } });

/** Mounts a page at `/?token=abc`; `screen()` is everything on screen as text. */
async function mount(Page: () => React.ReactNode) {
	const router = createMemoryRouter([{ path: '/', Component: Page }], { initialEntries: ['/?token=abc'] });
	let renderer!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		renderer = TestRenderer.create(createElement(RouterProvider, { router }));
	});
	return { renderer, screen: (): string => JSON.stringify(renderer.toJSON()), unmount: () => act(async () => renderer.unmount()) };
}

describe('Confirm your email', () => {
	it('reads in the language of the visitor', async () => {
		await applyAccountLocale('es');
		const page = await mount(VerifyEmailPage);
		expect(page.screen()).toContain('Confirma tu correo electrónico');
		expect(page.screen()).toContain('Confirmar mi correo electrónico');
		await page.unmount();
	});

	it.each(['en', 'es', 'pt-BR'] as const)('understands an expired link that the API answers in %s', async (locale) => {
		await applyAccountLocale(locale);
		const answered = t(CONFIRM_LINK_INVALID_MESSAGE);
		vi.mocked(apiClient.verifyEmail).mockResolvedValue(failure(answered));
		const page = await mount(VerifyEmailPage);
		await act(async () => page.renderer.root.findByType(OrangeButton).props.onClick());
		// The page for an expired link, with its way to a new one, not the generic failure with a retry button.
		expect(page.screen()).toContain(answered);
		expect(page.screen()).toContain('/settings');
		expect(page.screen()).not.toContain('"Try again"');
		expect(page.screen()).not.toContain('Tentar novamente');
		await page.unmount();
	});

	it('shows any other answer as a failure that can be tried again', async () => {
		await applyAccountLocale('es');
		vi.mocked(apiClient.verifyEmail).mockResolvedValue(failure('Algo salió mal en el servidor'));
		const page = await mount(VerifyEmailPage);
		await act(async () => page.renderer.root.findByType(OrangeButton).props.onClick());
		expect(page.screen()).toContain('Algo salió mal en el servidor');
		expect(page.screen()).toContain('Intentar de nuevo');
		expect(page.screen()).not.toContain('/settings');
		await page.unmount();
	});
});

describe('Reset your password', () => {
	async function submit(page: Awaited<ReturnType<typeof mount>>) {
		await act(async () => {
			page.renderer.root.findByType(PasswordField).props.onChange('Abcdefg1!');
			page.renderer.root.findByType(Input).props.onChange({ target: { value: 'Abcdefg1!' } });
		});
		await act(async () => page.renderer.root.findByType('form').props.onSubmit({ preventDefault: () => undefined }));
	}

	it('reads in the language of the visitor', async () => {
		await applyAccountLocale('pt-BR');
		const page = await mount(ResetPasswordPage);
		expect(page.screen()).toContain('Redefina sua senha');
		expect(page.screen()).toContain('Escolha uma nova senha para sua conta.');
		expect(page.screen()).toContain('Atualizar senha');
		await page.unmount();
	});

	it.each(['en', 'es', 'pt-BR'] as const)('understands an expired link that the API answers in %s', async (locale) => {
		await applyAccountLocale(locale);
		const answered = t(RESET_LINK_INVALID_MESSAGE);
		vi.mocked(apiClient.resetPassword).mockResolvedValue(failure(answered));
		const page = await mount(ResetPasswordPage);
		await submit(page);
		// The page for an expired link, with its button for a new one, not the form again with an error above it.
		expect(page.renderer.root.findAllByType('form')).toHaveLength(0);
		expect(page.screen()).toContain(answered);
		await page.unmount();
	});

	it('keeps the form, with the answer above it, for any other failure', async () => {
		await applyAccountLocale('es');
		vi.mocked(apiClient.resetPassword).mockResolvedValue(failure('Algo salió mal en el servidor'));
		const page = await mount(ResetPasswordPage);
		await submit(page);
		expect(page.renderer.root.findAllByType('form')).toHaveLength(1);
		expect(page.screen()).toContain('Algo salió mal en el servidor');
		await page.unmount();
	});
});
