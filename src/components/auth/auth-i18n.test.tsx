/**
 * The sign-in and sign-up screens in each language: what a visitor reads on the form, the checks it runs, the sentence
 * that says why sign-in was asked for, the note that the legal documents are in English, and the error toast that comes
 * back from a provider. `react-test-renderer` mounts them without a DOM, which the Workers test pool doesn't have.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { SIGNUPS_PAUSED_ERROR_CODE } from '@/api-types';
import { useOAuthErrorToast } from '@/hooks/use-oauth-error-toast';
import { emailError, newPasswordErrors, passwordError } from '@/lib/auth-validation';
import { applyAccountLocale, msg } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import { AuthForm, authCopy, type AuthMode } from './AuthForm';
import { AuthPhoto } from './AuthPhoto';
import { PasswordField } from './PasswordField';
import { TermsAgreementLabel } from './TermsAgreementLabel';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The test setup has no SVG transform, which would hand the logo over as a data address.
vi.mock('@/assets/provider-logos/cloudflare.svg?react', () => ({ default: () => null }));

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		authProviders: { email: true, google: true, github: true, cloudflare: true, emailSending: true },
		hasOAuth: true,
		loginWithEmail: async () => undefined,
		register: async () => undefined,
		error: null,
		clearError: () => undefined,
	}),
}));

beforeAll(silenceTestRendererDeprecation);

afterEach(async () => {
	await unmountAll();
	vi.mocked(toast.error).mockClear();
	await applyAccountLocale('en');
});

const form = (mode: AuthMode): string => renderToStaticMarkup(createElement(AuthForm, { mode, onOAuthLogin: () => undefined, onCreateAccount: () => undefined, onSignIn: () => undefined }));

describe('the sign-in form', () => {
	it('is in English by default', () => {
		const html = form('login');
		for (const text of ['Continue with Google', 'Continue with GitHub', 'Continue with Cloudflare', 'Email address', 'Forgot password?', 'New to Estori?', 'Create an account']) expect(html).toContain(text);
	});

	it('reads in Spanish, keeping the providers named as they are', async () => {
		await applyAccountLocale('es');
		const html = form('login');
		for (const text of ['Continuar con Google', 'Continuar con GitHub', 'Continuar con Cloudflare', 'Correo electrónico', '¿Olvidaste tu contraseña?', 'Contraseña', '¿Es tu primera vez en Estori?', 'Crear una cuenta', 'Iniciar sesión']) expect(html).toContain(text);
		expect(html).not.toContain('Continue with');
	});

	it('reads in Portuguese', async () => {
		await applyAccountLocale('pt-BR');
		const html = form('login');
		for (const text of ['Continuar com Google', 'E-mail', 'Esqueceu a senha?', 'Senha', 'Primeira vez no Estori?', 'Criar uma conta', 'Entrar']) expect(html).toContain(text);
		expect(html).not.toContain('Continue with');
	});
});

describe('the sign-up form', () => {
	it('asks for the name and the confirmation in the language, and says the legal documents are in English', async () => {
		await applyAccountLocale('es');
		const html = form('register');
		for (const text of ['Nombre completo', 'Confirmar contraseña', 'Crear cuenta', '¿Ya tienes una cuenta?', 'Tengo 18 años o más y acepto los']) expect(html).toContain(text);
		expect(html).toContain('(en inglés)');
		await applyAccountLocale('pt-BR');
		const portuguese = form('register');
		for (const text of ['Nome completo', 'Confirmar senha', 'Criar conta', 'Já tem uma conta?', 'Tenho 18 anos ou mais e concordo com os']) expect(portuguese).toContain(text);
		expect(portuguese).toContain('(em inglês)');
	});

	it('asks for a reset link in the language', async () => {
		await applyAccountLocale('es');
		const html = form('forgot');
		expect(html).toContain('Enviar enlace de restablecimiento');
		expect(html).toContain('Volver al inicio de sesión');
		expect(html).not.toContain('Continuar con Google');
	});
});

describe('the terms agreement', () => {
	/** The text, the links with their address, and where they open. */
	async function agreement() {
		const renderer = await mountElement(createElement(TermsAgreementLabel));
		const links = renderer.root.findAllByType('a').map((link) => ({ href: link.props.href, target: link.props.target, rel: link.props.rel, text: [link.props.children].flat().join('') }));
		return { links, text: JSON.stringify(renderer.toJSON()) };
	}

	it('says nothing about a language in English', async () => {
		const { links, text } = await agreement();
		expect(text).toContain("I'm 18 or older and agree to the");
		expect(text).not.toContain('in English');
		expect(links).toEqual([
			{ href: '/terms', target: '_blank', rel: 'noopener noreferrer', text: 'Terms of Service' },
			{ href: '/privacy', target: '_blank', rel: 'noopener noreferrer', text: 'Privacy Policy' },
		]);
	});

	it.each([
		['es', '(en inglés)', ['Términos del servicio', 'Política de privacidad']],
		['pt-BR', '(em inglês)', ['Termos de Serviço', 'Política de Privacidade']],
	] as const)('names each document in %s and says it is in English, with the links still going to the English documents', async (locale, note, names) => {
		await applyAccountLocale(locale);
		const { links, text } = await agreement();
		expect(links.map((link) => [link.href, link.text])).toEqual([
			['/terms', names[0]],
			['/privacy', names[1]],
		]);
		expect(text.split(note)).toHaveLength(3);
		for (const link of links) expect(link.target).toBe('_blank');
	});
});

describe('the heading above the form', () => {
	it('answers each view in each language', async () => {
		expect(authCopy('login').title).toBe('Welcome back');
		await applyAccountLocale('es');
		expect(authCopy('login')).toEqual({ title: 'Te damos la bienvenida de nuevo', description: 'Inicia sesión para seguir construyendo tu imperio en internet.' });
		expect(authCopy('register').title).toBe('Crea tu cuenta gratis');
		expect(authCopy('forgot').title).toBe('Restablece tu contraseña');
		await applyAccountLocale('pt-BR');
		expect(authCopy('register').title).toBe('Crie sua conta grátis');
		expect(authCopy('forgot').title).toBe('Redefina sua senha');
	});

	it('translates the whole sentence that says why sign-in was asked for, so word order can differ', async () => {
		const reason = msg('Sign in to star this app');
		expect(authCopy('login', reason).title).toBe('Sign in to star this app');
		await applyAccountLocale('es');
		expect(authCopy('login', reason)).toEqual({ title: 'Inicia sesión para destacar esta app', description: 'Inicia sesión o crea una cuenta gratis para continuar.' });
		await applyAccountLocale('pt-BR');
		expect(authCopy('login', reason).title).toBe('Entre para dar estrela neste app');
	});

	it('follows a language picked while the window is open, because the sentence is translated as it is shown', async () => {
		const reason = msg('Sign in to create applications');
		await applyAccountLocale('es');
		const before = authCopy('login', reason).title;
		await applyAccountLocale('pt-BR');
		expect(before).toBe('Inicia sesión para crear apps');
		expect(authCopy('login', reason).title).toBe('Entre para criar apps');
	});
});

describe('the photo and the password field', () => {
	it('caption the photo in the language', async () => {
		expect(renderToStaticMarkup(createElement(AuthPhoto, { view: 'register' }))).toContain('From first idea to first order.');
		await applyAccountLocale('es');
		expect(renderToStaticMarkup(createElement(AuthPhoto, { view: 'login' }))).toContain('Tus tiendas, estés donde estés.');
		await applyAccountLocale('pt-BR');
		expect(renderToStaticMarkup(createElement(AuthPhoto, { view: 'register' }))).toContain('Da primeira ideia ao primeiro pedido.');
	});

	it('name the show and hide button in the language', async () => {
		const field = (visible: boolean) => renderToStaticMarkup(createElement(PasswordField, { label: 'x', value: '', onChange: () => undefined, autoComplete: 'new-password', visible, onVisibleChange: () => undefined }));
		expect(field(false)).toContain('Show password');
		await applyAccountLocale('es');
		expect(field(false)).toContain('Mostrar contraseña');
		expect(field(true)).toContain('Ocultar contraseña');
		await applyAccountLocale('pt-BR');
		expect(field(false)).toContain('Mostrar senha');
	});
});

describe('the checks the form runs', () => {
	it('answer in English by default', () => {
		expect(emailError('')).toBe('Email is required');
		expect(emailError('nope')).toBe('Invalid email format');
		expect(passwordError('')).toBe('Password is required');
		expect(passwordError('short')).toBe('Password must be at least 8 characters');
		expect(newPasswordErrors('abcdefgh', 'x')).toEqual({
			password: 'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
			confirmPassword: 'Passwords do not match',
		});
	});

	it('answer in Spanish, with the length as a value', async () => {
		await applyAccountLocale('es');
		expect(emailError('')).toBe('El correo electrónico es obligatorio');
		expect(emailError('nope')).toBe('Formato de correo electrónico no válido');
		expect(passwordError('short')).toBe('La contraseña debe tener al menos 8 caracteres');
		expect(newPasswordErrors('Abcdefg1!', 'x')).toEqual({ confirmPassword: 'Las contraseñas no coinciden' });
		expect(newPasswordErrors('abcdefgh', 'abcdefgh').password).toContain('al menos una letra mayúscula');
	});

	it('answer in Portuguese', async () => {
		await applyAccountLocale('pt-BR');
		expect(emailError('')).toBe('O e-mail é obrigatório');
		expect(passwordError('')).toBe('A senha é obrigatória');
		expect(passwordError('short')).toBe('A senha deve ter pelo menos 8 caracteres');
		expect(newPasswordErrors('Abcdefg1!', 'x')).toEqual({ confirmPassword: 'As senhas não coincidem' });
	});
});

describe('the error a provider sign-in comes back with', () => {
	function Probe() {
		useOAuthErrorToast();
		return null;
	}

	async function arriveWith(code: string): Promise<string | undefined> {
		const router = createMemoryRouter([{ path: '/', Component: Probe }], { initialEntries: [`/?error=${code}`] });
		await mountElement(createElement(RouterProvider, { router }));
		const shown = vi.mocked(toast.error).mock.calls[0]?.[0];
		return typeof shown === 'string' ? shown : undefined;
	}

	it('is told in English by default', async () => {
		expect(await arriveWith('email_exists')).toContain('An account with this email already exists.');
	});

	it.each([
		['es', 'email_exists', 'Ya existe una cuenta con este correo electrónico.'],
		['es', 'oauth_failed', 'El proveedor de inicio de sesión informó un error. Inténtalo de nuevo.'],
		['es', 'auth_failed', 'No se pudo iniciar sesión. Inténtalo de nuevo.'],
		['es', 'something_new', 'No se pudo iniciar sesión. Inténtalo de nuevo.'],
		['es', SIGNUPS_PAUSED_ERROR_CODE, 'La creación de cuentas está en pausa por un momento. Inténtalo de nuevo pronto.'],
		['pt-BR', 'email_exists', 'Já existe uma conta com este e-mail.'],
		['pt-BR', 'oauth_failed', 'O provedor de login informou um erro. Tente novamente.'],
		['pt-BR', SIGNUPS_PAUSED_ERROR_CODE, 'A criação de contas está em pausa por um momento. Tente novamente em breve.'],
	] as const)('is told in %s for %s', async (locale, code, expected) => {
		await applyAccountLocale(locale);
		expect(await arriveWith(code)).toContain(expected);
	});
});
