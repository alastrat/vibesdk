/**
 * The Settings page, the profile and the small pieces of the billing pages in Spanish and Portuguese, rendered to markup
 * with their data stubbed. Effects don't run, so what is checked is the text a seller reads when each page first shows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackToBilling } from '@/components/billing/BackToBilling';
import { CreditsStepper } from '@/components/billing/CreditsStepper';
import { PaymentMethodCard } from '@/components/billing/PaymentMethodCard';
import { Stopped } from '@/components/billing/Stopped';
import { applyAccountLocale, t } from '@/lib/i18n';
import { capitalizeFirstLetter } from '@/lib/utils';
import { queryKeys } from '@/lib/query-keys';
import { CARD_EXPIRED_MESSAGE } from './card-state';
import Profile from '../profile';
import SettingsPage from './index';

vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({
		user: { id: 'u1', email: 'ana@example.test', displayName: 'Ana', username: '', bio: '', provider: 'email', emailVerified: true, createdAt: '2026-01-15T10:00:00Z', timezone: 'UTC' },
		authProviders: { email: true, google: true, github: true, cloudflare: true, emailSending: true },
		isAuthenticated: true,
	}),
}));
vi.mock('@/hooks/use-billing', () => ({ useBilling: () => ({ data: { enabled: true, plan: 'pro' } }) }));
vi.mock('@/contexts/limits-context', () => ({ useLimitsContext: () => ({ data: null, refetch: async () => undefined }) }));
vi.mock('@/hooks/use-telemetry', () => ({
	useAnalyticsPreference: () => ({ data: { optedOut: false, source: null, gpc: true } }),
	useSetAnalyticsPreference: () => ({ mutate: () => undefined, isPending: false }),
}));
const activities = vi.hoisted((): Array<{ type: string; title: string; timestamp: string }> => []);
vi.mock('@/hooks/use-stats', () => ({
	useUserStats: () => ({ stats: { appCount: 12, publicAppCount: 3, totalViewsReceived: 1_234, totalLikesReceived: 0, achievements: [] }, loading: false }),
	useUserActivity: () => ({ activities, loading: false }),
}));
vi.mock('@/hooks/use-profile', () => ({ useUpdateProfile: () => ({ mutateAsync: async () => undefined, isPending: false }) }));
vi.mock('@/hooks/use-apps', () => ({ useApps: () => ({ apps: [], loading: false }) }));
// Radix dialogs and selects load `react-remove-scroll`, which the Workers test pool can't resolve; plain wrappers keep their content.
vi.mock('@/components/ui/alert-dialog', async () => {
	const { createElement, Fragment } = await import('react');
	const wrapper = (props: { children?: React.ReactNode }) => createElement(Fragment, null, props.children);
	return { AlertDialog: wrapper, AlertDialogAction: wrapper, AlertDialogCancel: wrapper, AlertDialogContent: wrapper, AlertDialogDescription: wrapper, AlertDialogFooter: wrapper, AlertDialogHeader: wrapper, AlertDialogTitle: wrapper };
});
vi.mock('@/components/ui/select', async () => {
	const { createElement, Fragment } = await import('react');
	const wrapper = (props: { children?: React.ReactNode }) => createElement(Fragment, null, props.children);
	return { Select: wrapper, SelectContent: wrapper, SelectItem: wrapper, SelectTrigger: wrapper, SelectValue: wrapper };
});
vi.mock('@/components/shared/CloudflareLogoThemed', () => ({ CloudflareLogoThemed: () => null }));
vi.mock('@/components/payments/PayoutsCard', () => ({ PayoutsCard: () => null }));
vi.mock('@/components/publishing/PaidListingsList', () => ({ PaidListingsList: () => null }));

afterEach(async () => {
	await applyAccountLocale('en');
});

/** The API keys and sessions Settings has already loaded, so its tables and its empty state show. */
interface Loaded {
	keys: Array<{ id: string; name: string; keyPreview: string; createdAt: string; lastUsed: string | null; isActive: boolean }>;
}

/** Markup for a page inside the providers it reads from, with the no-break spaces `Intl` writes read as spaces. */
function markup(page: ReactElement, loaded: Loaded | null = null, path = '/'): string {
	const queries = new QueryClient();
	if (loaded) {
		queries.setQueryData(queryKeys.account.settings.apiKeys('u1'), { keys: loaded.keys });
		queries.setQueryData(queryKeys.account.settings.activeSessions('u1'), { sessions: [{ id: 's1', userAgent: null, ipAddress: '203.0.113.7', lastActivity: '2026-10-20T12:00:00Z', createdAt: '2026-10-20T12:00:00Z', isCurrent: true }] });
	}
	return renderToStaticMarkup(createElement(QueryClientProvider, { client: queries }, createElement(MemoryRouter, { initialEntries: [path] }, page))).replace(/[  ]/g, ' ');
}

const KEY = { id: 'k1', name: 'Production', keyPreview: 'vibe_abcd...', createdAt: '2026-10-01T12:00:00Z', lastUsed: null, isActive: true };

describe('Settings', () => {
	it('is in English by default', () => {
		const html = markup(createElement(SettingsPage), { keys: [] });
		for (const text of ['Manage your account settings and preferences', 'Email confirmed', 'Plan and billing', 'Create API key', 'No API keys yet', 'Active sessions', 'Current session', 'Danger zone', 'Delete account']) expect(html).toContain(text);
	});

	it('shows the table of keys in each language, with its dates the way the language writes them', async () => {
		await applyAccountLocale('es');
		const spanish = markup(createElement(SettingsPage), { keys: [KEY] });
		for (const text of ['Claves activas para usar el SDK', 'Nombre', 'Último uso', 'Estado', 'Acciones', 'Activo', 'Revocar', '1/10/2026', 'Sesión actual', '20/10/2026']) expect(spanish).toContain(text);
		await applyAccountLocale('pt-BR');
		const portuguese = markup(createElement(SettingsPage), { keys: [{ ...KEY, isActive: false }] });
		for (const text of ['Chaves ativas para uso do SDK', 'Nome', 'Último uso', 'Revogada', 'Sessão atual']) expect(portuguese).toContain(text);
	});

	it('names what is loading before the keys and sessions arrive', async () => {
		await applyAccountLocale('es');
		const html = markup(createElement(SettingsPage));
		expect(html).toContain('Cargando claves de API...');
		expect(html).toContain('Cargando sesiones activas...');
	});

	it('reads in Spanish, from the account to the danger zone', async () => {
		await applyAccountLocale('es');
		const html = markup(createElement(SettingsPage), { keys: [] });
		for (const text of [
			'Administra la configuración y las preferencias de tu cuenta',
			'Correo electrónico confirmado',
			'Compartir analíticas de uso con Estori',
			'La opción Global Privacy Control de tu navegador está activada',
			// What the analytics card says is recorded must cover everything written on the page, not only what is typed.
			'grabaciones de algunas sesiones que muestran diseños y clics pero no lo que está escrito',
			'Plan y facturación',
			'Tu plan',
			'Plan, créditos y facturación',
			'Claves de API de Estori',
			'Crear clave de API',
			'Aún no hay claves de API',
			'Crea una clave de API para usar el SDK de Estori desde tus propias apps.',
			'Seguridad',
			'Cuentas conectadas',
			'Cargando cuentas conectadas...',
			'Sesiones activas',
			'Zona de peligro',
			'Eliminar cuenta',
		]) {
			expect(html).toContain(text);
		}
		expect(html).not.toContain('Manage your account');
	});

	it('reads in Portuguese', async () => {
		await applyAccountLocale('pt-BR');
		const html = markup(createElement(SettingsPage), { keys: [] });
		for (const text of [
			'Gerencie as configurações e as preferências da sua conta',
			'E-mail confirmado',
			'Compartilhar análises de uso com o Estori',
			'gravações de algumas sessões que mostram layouts e cliques, mas não o que está escrito',
			'Plano e cobrança',
			'Seu plano',
			'Chaves de API do Estori',
			'Criar chave de API',
			'Ainda não há chaves de API',
			'Segurança',
			'Contas conectadas',
			'Zona de perigo',
			'Excluir conta',
		]) {
			expect(html).toContain(text);
		}
	});

	it('keeps the names of the sign-in providers as they are', async () => {
		await applyAccountLocale('es');
		const html = markup(createElement(SettingsPage));
		expect(html).toContain('Cloudflare AI Gateway');
	});
});

describe('the profile', () => {
	it('reads in Spanish', async () => {
		await applyAccountLocale('es');
		const html = markup(createElement(Profile));
		for (const text of ['Editar perfil', 'Configuración', 'Apps en total', 'Apps públicas', 'Total de vistas', 'Total de me gusta', 'Verificado', 'Información del perfil', 'Miembro desde', '15 de enero de 2026', 'Nombre para mostrar', 'Nombre de usuario', 'Sin definir', 'Aún no hay biografía']) {
			expect(html).toContain(text);
		}
		// A thousand and above is written in the language's own compact form.
		expect(html).toContain('1.2 K');
	});

	it('reads in Portuguese, with the member-since date and the stats', async () => {
		await applyAccountLocale('pt-BR');
		const html = markup(createElement(Profile));
		for (const text of ['Editar perfil', 'Configurações', 'Total de apps', 'Apps públicos', 'Total de visualizações', 'Total de curtidas', 'Membro desde', '15 de janeiro de 2026', 'Nome de exibição', 'Nome de usuário']) expect(html).toContain(text);
		expect(html).toContain('1,2 mil');
	});

	it('says what the seller did, in a sentence of its own in each language, with the app name as they wrote it', async () => {
		activities.splice(0, activities.length, { type: 'created', title: 'Lucia Candles', timestamp: new Date(2026, 9, 21, 15, 45).toISOString() }, { type: 'favorited', title: 'Open Shop', timestamp: new Date(2026, 9, 21, 9, 5).toISOString() });
		const verbs = (html: string) => [...html.matchAll(/<span class="font-medium">([^<]+)<\/span> <span class="text-kumo-subtle">([^<]+)<\/span>/g)].map((match) => `${match[1]} ${match[2]}`);
		expect(verbs(markup(createElement(Profile), null, '/?tab=activity'))).toEqual(['Created Lucia Candles', 'Favorited Open Shop']);
		await applyAccountLocale('es');
		const spanish = markup(createElement(Profile), null, '/?tab=activity');
		expect(verbs(spanish)).toEqual(['Creaste Lucia Candles', 'Agregaste a favoritos Open Shop']);
		expect(spanish).toContain('21 oct 2026 15:45');
		await applyAccountLocale('pt-BR');
		const portuguese = markup(createElement(Profile), null, '/?tab=activity');
		expect(verbs(portuguese)).toEqual(['Você criou Lucia Candles', 'Você favoritou Open Shop']);
		activities.splice(0, activities.length);
	});

	it('is in English, as before, by default', () => {
		const html = markup(createElement(Profile));
		for (const text of ['Edit profile', 'Total apps', 'Public apps', 'Total views', 'Member since', 'January 15, 2026', '1.2K']) expect(html).toContain(text);
	});
});

describe('the pieces the billing pages share', () => {
	it('names the way back to billing, and the card on file, in each language', async () => {
		await applyAccountLocale('es');
		expect(markup(createElement(BackToBilling))).toContain('Volver a la facturación');
		expect(markup(createElement(PaymentMethodCard, { card: null }))).toContain('No hay ninguna tarjeta guardada.');
		expect(markup(createElement(PaymentMethodCard, { card: null }))).toContain('Agregar tarjeta');
		expect(markup(createElement(PaymentMethodCard, { card: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 } }))).toContain('Visa terminada en 4242, vence el 08/28');
		await applyAccountLocale('pt-BR');
		expect(markup(createElement(PaymentMethodCard, { card: { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 } }))).toContain('Trocar cartão');
	});

	it("translates a stopped page's message where it is shown, whether the page's own or the server's", async () => {
		await applyAccountLocale('es');
		const html = markup(createElement(Stopped, { message: CARD_EXPIRED_MESSAGE, action: { label: 'Empezar de nuevo', onClick: () => undefined } }));
		expect(html).toContain('El formulario de la tarjeta caducó.');
		expect(html).toContain('Empezar de nuevo');
		expect(markup(createElement(Stopped, { message: 'Un mensaje del servidor', action: null }))).toContain('Un mensaje del servidor');
	});

	it('names the controls of the credits field, and writes the amount in the language', async () => {
		await applyAccountLocale('pt-BR');
		const html = markup(createElement(CreditsStepper, { value: 25_000, onChange: () => undefined }));
		expect(html).toContain('aria-label="Menos créditos"');
		expect(html).toContain('aria-label="Mais créditos"');
		expect(html).toContain('aria-label="Créditos extras"');
		expect(html).toContain('25.000');
	});
});

describe('the API key label and the dialog noun that share one message', () => {
	const source = import.meta.glob<string>('/src/routes/settings/index.tsx', { query: '?raw', import: 'default', eager: true })['/src/routes/settings/index.tsx'];

	it('starts the label with a capital in each language, while the noun in the delete dialog stays as the sentence needs it', async () => {
		expect(capitalizeFirstLetter(t('API key'))).toBe('API key');
		await applyAccountLocale('es');
		expect([t('API key'), capitalizeFirstLetter(t('API key'))]).toEqual(['clave de API', 'Clave de API']);
		await applyAccountLocale('pt-BR');
		expect([t('API key'), capitalizeFirstLetter(t('API key'))]).toEqual(['chave de API', 'Chave de API']);
	});

	it('shows the capitalized one above the key field, and the noun as it is in the dialog', () => {
		expect(source).toContain("{capitalizeFirstLetter(t('API key'))}");
		expect(source).toContain("resourceType={t('API key')}");
	});
});
