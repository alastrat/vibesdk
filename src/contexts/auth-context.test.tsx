import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type { ApiResponse, AuthUser, ProfileResponseData } from '@/api-types';
import {
	clientFlagValues,
	defaultFlagValues,
} from '../../shared/types/feature-flags';
import { apiClient } from '@/lib/api-client';
import { applyAccountLocale, getLocale } from '@/lib/i18n';
import { queryKeys } from '@/lib/query-keys';
import {
	mountElement,
	silenceTestRendererDeprecation,
	unmountAll,
} from '@/test-support/mounted';
import { AuthProvider, useAuth } from './auth-context';

vi.mock('@/lib/api-client', () => ({
	ApiError: class ApiError extends Error {},
	apiClient: {
		getProfile: vi.fn(),
		getAuthProviders: vi.fn(),
		loginWithEmail: vi.fn(),
		logout: vi.fn(),
	},
}));
// Sentry sends browser telemetry; cache ownership is exercised by the real provider and QueryClient.
vi.mock('@/hooks/useSentryUser', () => ({ useSentryUser: () => {} }));

const sellerA: AuthUser = {
	id: 'seller-a',
	email: 'a@example.test',
	locale: 'en',
	theme: 'dark',
};
const sellerB: AuthUser = {
	id: 'seller-b',
	email: 'b@example.test',
	locale: 'en',
	theme: 'light',
};
const telemetry = {
	flags: clientFlagValues(defaultFlagValues()),
	analyticsOptOut: false,
};
const privateKeys = [
	queryKeys.billing(),
	queryKeys.account.shopperEmails.store('store-a'),
	queryKeys.account.storeTranslations.store('store-a'),
	queryKeys.account.apps.user('seller-a'),
	queryKeys.liveStore('store-a'),
	queryKeys.drafts('store-a'),
	queryKeys.apps.sitePage('store-a', 'seller-a'),
	['apps', 'user', 'legacy'],
];
const clients: QueryClient[] = [];
let auth: ReturnType<typeof useAuth>;
let observed: { userId: string | null; privateData: unknown[] }[];

function Probe({ client }: { client: QueryClient }) {
	auth = useAuth();
	observed.push({
		userId: auth.user?.id ?? null,
		privateData: privateKeys.map((key) => client.getQueryData(key)),
	});
	return <span>{auth.user?.id ?? 'signed out'}</span>;
}

function session(user: AuthUser) {
	return {
		user,
		sessionId: `session-${user.id}`,
		expiresAt: null,
		telemetry: null,
	};
}

async function settle() {
	for (let round = 0; round < 3; round++)
		await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: Infinity } },
	});
	clients.push(client);
	client.setQueryData(queryKeys.auth.session(), session(sellerA));
	privateKeys.forEach((key) =>
		client.setQueryData(key, 'seller-a private data'),
	);
	client.setQueryData(queryKeys.discoverCatalog.categories(), [
		'public category',
	]);
	client.setQueryData(queryKeys.apps.strip(), ['public store']);
	await mountElement(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<AuthProvider>
					<Probe client={client} />
				</AuthProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await settle();
	return client;
}

beforeAll(silenceTestRendererDeprecation);
beforeEach(() => {
	observed = [];
	vi.mocked(apiClient.getAuthProviders).mockResolvedValue({
		success: true,
		data: {
			providers: {
				google: false,
				github: false,
				cloudflare: false,
				email: true,
				emailSending: false,
			},
			hasOAuth: false,
			requiresEmailAuth: true,
		},
	});
	vi.mocked(apiClient.logout).mockResolvedValue({
		success: true,
		data: { message: 'Signed out' },
	});
	vi.stubGlobal('sessionStorage', {
		getItem: () => null,
		removeItem: () => {},
	});
});
afterEach(async () => {
	await unmountAll();
	clients.splice(0).forEach((client) => client.clear());
	await applyAccountLocale('en');
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('authenticated cache ownership', () => {
	it('removes prior private data before a profile refresh exposes another account, preserving public caches', async () => {
		const client = await mount();
		vi.mocked(apiClient.getProfile).mockResolvedValue({
			success: true,
			data: { user: sellerB, sessionId: 'session-b', telemetry },
		});
		await act(async () => auth.refreshUser());
		await settle();
		expect(auth.user?.id).toBe('seller-b');
		privateKeys.forEach((key) =>
			expect(client.getQueryData(key)).toBeUndefined(),
		);
		expect(
			observed
				.filter((entry) => entry.userId === 'seller-b')
				.every((entry) =>
					entry.privateData.every((data) => data === undefined),
				),
		).toBe(true);
		expect(
			client.getQueryData(queryKeys.discoverCatalog.categories()),
		).toEqual(['public category']);
		expect(client.getQueryData(queryKeys.apps.strip())).toEqual([
			'public store',
		]);
		expect(client.getQueryData(queryKeys.auth.providers())).toBeDefined();
	});

	it('cancels old account requests so late responses cannot restore private data after a switch', async () => {
		const client = await mount();
		let resolve!: (value: string) => void;
		let requestSignal!: AbortSignal;
		const request = client
			.fetchQuery({
				queryKey: queryKeys.liveStore('pending-store'),
				queryFn: ({ signal }) => {
					requestSignal = signal;
					return new Promise<string>((done) => {
						resolve = done;
					});
				},
			})
			.catch(() => undefined);
		vi.mocked(apiClient.getProfile).mockResolvedValue({
			success: true,
			data: { user: sellerB, sessionId: 'session-b', telemetry },
		});
		await act(async () => auth.refreshUser());
		expect(requestSignal.aborted).toBe(true);
		resolve('late seller-a store');
		await request;
		expect(
			client.getQueryData(queryKeys.liveStore('pending-store')),
		).toBeUndefined();
	});

	it('retains private caches on same-user profile refresh while applying updated theme and locale', async () => {
		const client = await mount();
		vi.mocked(apiClient.getProfile).mockResolvedValue({
			success: true,
			data: {
				user: {
					...sellerA,
					theme: 'light',
					locale: 'es',
					displayName: 'Updated name',
				},
				sessionId: 'session-a',
				telemetry,
			},
		});
		await act(async () => auth.refreshUser());
		await settle();
		privateKeys.forEach((key) =>
			expect(client.getQueryData(key)).toBe('seller-a private data'),
		);
		expect(auth.user?.theme).toBe('light');
		expect(auth.user?.displayName).toBe('Updated name');
		await vi.waitFor(() => expect(getLocale()).toBe('es'));
	});

	it('clears private data when background validation discovers the session expired', async () => {
		const client = await mount();
		vi.mocked(apiClient.getProfile).mockResolvedValue({
			success: false,
			error: { name: 'Unauthorized', message: 'Signed out' },
		});
		await act(async () => auth.refreshUser());
		await settle();
		expect(auth.user).toBeNull();
		privateKeys.forEach((key) =>
			expect(client.getQueryData(key)).toBeUndefined(),
		);
	});

	it('clears private data when an email login replaces a signed-in account', async () => {
		const client = await mount();
		vi.mocked(apiClient.loginWithEmail).mockResolvedValue({
			success: true,
			data: { user: sellerB, sessionId: 'session-b', expiresAt: null },
		});
		await act(async () =>
			auth.loginWithEmail({
				email: sellerB.email,
				password: 'test-only',
			}),
		);
		await settle();
		expect(auth.user?.id).toBe('seller-b');
		privateKeys.forEach((key) =>
			expect(client.getQueryData(key)).toBeUndefined(),
		);
	});

	it('ignores a canceled profile response after a newer account has signed in', async () => {
		const client = await mount();
		let resolveProfile!: (value: ApiResponse<ProfileResponseData>) => void;
		vi.mocked(apiClient.getProfile).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveProfile = resolve;
				}),
		);
		const refresh = auth.refreshUser();
		vi.mocked(apiClient.loginWithEmail).mockResolvedValue({
			success: true,
			data: { user: sellerB, sessionId: 'session-b', expiresAt: null },
		});
		await act(async () =>
			auth.loginWithEmail({
				email: sellerB.email,
				password: 'test-only',
			}),
		);
		client.setQueryData(queryKeys.billing(), 'seller-b billing');
		await act(async () => {
			resolveProfile({
				success: true,
				data: { user: sellerA, sessionId: 'old-session-a', telemetry },
			});
			await refresh;
		});
		await settle();
		expect(auth.user?.id).toBe('seller-b');
		expect(client.getQueryData(queryKeys.billing())).toBe(
			'seller-b billing',
		);
	});

	it('clears legacy store caches on explicit logout without resetting the chosen language', async () => {
		const client = await mount();
		await applyAccountLocale('es');
		await act(async () => auth.logout());
		await settle();
		expect(auth.user).toBeNull();
		privateKeys.forEach((key) =>
			expect(client.getQueryData(key)).toBeUndefined(),
		);
		expect(getLocale()).toBe('es');
	});
});
