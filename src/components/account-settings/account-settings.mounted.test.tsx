/** The real provider, auth query and profile mutation mounted without browser portals. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	act,
	type ButtonHTMLAttributes,
	type InputHTMLAttributes,
	type ReactNode,
} from 'react';
import { MemoryRouter } from 'react-router';
import { DialogRoot } from '@cloudflare/kumo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { AuthUser } from '@/api-types';
import {
	clientFlagValues,
	defaultFlagValues,
} from '../../../shared/types/feature-flags';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { ThemeProvider } from '@/contexts/theme-context';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { applyAccountLocale } from '@/lib/i18n';
import {
	mountElement,
	silenceTestRendererDeprecation,
	textOf,
	unmountAll,
} from '@/test-support/mounted';
import { toast } from 'sonner';
import { AccountSettingsProvider, useAccountSettings } from './index';

// The Workers pool has no DOM. Replace only Kumo's portal/DOM controls with native
// controls; account state, queries, mutations, form handlers and errors stay real.
vi.mock('@cloudflare/kumo', () => ({
	DialogRoot: ({ open, children }: { open: boolean; children: ReactNode }) =>
		open ? <div role="dialog">{children}</div> : null,
	Dialog: ({ children }: { children: ReactNode }) => (
		<section>{children}</section>
	),
	DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
	DialogDescription: ({ children }: { children: ReactNode }) => (
		<p>{children}</p>
	),
	Input: ({
		label,
		...props
	}: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode }) => (
		<input
			aria-label={typeof label === 'string' ? label : undefined}
			{...props}
		/>
	),
	Button: ({
		children,
		icon,
		loading: _loading,
		variant: _variant,
		size: _size,
		shape: _shape,
		...props
	}: ButtonHTMLAttributes<HTMLButtonElement> & {
		icon?: ReactNode;
		loading?: boolean;
		variant?: string;
		size?: string;
		shape?: string;
	}) => (
		<button {...props}>
			{icon}
			{children}
		</button>
	),
	Select: ({
		value,
		items,
		onValueChange,
		...props
	}: {
		value: string;
		items: Record<string, string>;
		onValueChange: (value: string) => void;
		'aria-label'?: string;
	}) => (
		<select
			{...props}
			value={value}
			onChange={(event) => onValueChange(event.target.value)}
		>
			{Object.entries(items).map(([key, label]) => (
				<option key={key} value={key}>
					{label}
				</option>
			))}
		</select>
	),
	Switch: () => null,
	buttonVariants: () => '',
}));
vi.mock('@/hooks/useSentryUser', () => ({ useSentryUser: () => undefined }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sellerA: AuthUser = {
	id: 'seller-a',
	email: 'a@example.test',
	displayName: 'Seller A',
	username: 'seller_a',
	bio: 'Biography A',
	timezone: 'UTC',
	theme: 'light',
	locale: null,
};
const sellerB: AuthUser = {
	id: 'seller-b',
	email: 'b@example.test',
	displayName: 'Seller B',
	username: 'seller_b',
	bio: 'Biography B',
	timezone: 'America/Bogota',
	theme: 'light',
	locale: null,
};
let currentUser: AuthUser | null;
let html: {
	dataset: Record<string, string>;
	style: { colorScheme: string };
	lang: string;
};
const clients: QueryClient[] = [];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 15));

function AccountControls() {
	const settings = useAccountSettings();
	const { user } = useAuth();
	return (
		<>
			<output aria-label="Signed-in name">
				{user?.displayName ?? 'Signed out'}
			</output>
			<button onClick={() => settings.openSettings()}>
				Open profile
			</button>
			<button onClick={() => settings.openSettings('appearance')}>
				Open appearance
			</button>
		</>
	);
}

async function mount() {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity },
			mutations: { retry: false },
		},
	});
	clients.push(client);
	const renderer = await mountElement(
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<ThemeProvider>
					<AuthProvider>
						<AccountSettingsProvider>
							<AccountControls />
						</AccountSettingsProvider>
					</AuthProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	await act(flush);
	return { renderer, client };
}
function visibleText(node: ReactTestInstance | string): string {
	return typeof node === 'string'
		? node
		: node.children.map(visibleText).join('');
}
function button(renderer: ReactTestRenderer, text: string) {
	return renderer.root
		.findAllByType('button')
		.find((node) => visibleText(node) === text)!;
}
function field(renderer: ReactTestRenderer, label: string) {
	return renderer.root
		.findAllByType('input')
		.find((node) => node.props['aria-label'] === label)!;
}
async function click(renderer: ReactTestRenderer, text: string) {
	await act(async () => {
		button(renderer, text).props.onClick();
		await flush();
	});
}
async function type(renderer: ReactTestRenderer, label: string, value: string) {
	await act(async () => {
		field(renderer, label).props.onChange({ target: { value } });
	});
}
async function submit(renderer: ReactTestRenderer) {
	await act(async () => {
		renderer.root
			.findByType('form')
			.props.onSubmit({ preventDefault: () => undefined });
		await flush();
	});
}
async function switchAccount(client: QueryClient, user: AuthUser | null) {
	currentUser = user;
	await act(async () => {
		await client.invalidateQueries({ queryKey: queryKeys.auth.session() });
		await flush();
	});
}

beforeEach(() => {
	silenceTestRendererDeprecation();
	currentUser = { ...sellerA };
	html = { dataset: {}, style: { colorScheme: '' }, lang: 'en' };
	const document = {
		documentElement: html,
		activeElement: null,
		querySelectorAll: () => [],
		getElementById: () => null,
	};
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		callback(0);
		return 1;
	});
	vi.stubGlobal('document', document);
	vi.stubGlobal('window', {
		document,
		matchMedia: () => ({
			matches: false,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
		}),
	});
	vi.stubGlobal('localStorage', {
		getItem: () => null,
		setItem: () => undefined,
	});
	vi.spyOn(apiClient, 'getProfile').mockImplementation(async () =>
		currentUser
			? {
					success: true,
					data: {
						user: { ...currentUser },
						sessionId: currentUser.id,
						telemetry: {
							flags: clientFlagValues(defaultFlagValues()),
							analyticsOptOut: false,
						},
					},
				}
			: { success: false },
	);
	vi.spyOn(apiClient, 'getAuthProviders').mockResolvedValue({
		success: true,
		data: {
			providers: {
				email: true,
				emailSending: false,
				google: false,
				github: false,
				cloudflare: false,
			},
			hasOAuth: false,
			requiresEmailAuth: true,
		},
	});
	vi.spyOn(apiClient, 'updateProfile').mockResolvedValue({
		success: true,
		data: { success: true, message: 'Profile updated successfully' },
	});
});
afterEach(async () => {
	await unmountAll();
	clients.splice(0).forEach((client) => client.clear());
	await applyAccountLocale('en');
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe('account settings user flows', () => {
	it('returns focus to the account menu trigger after Escape closes a dialog opened from a removed menu item', async () => {
		const { renderer } = await mount();
		const trigger = {
			isConnected: true,
			focus: vi.fn(),
			getAttribute: () => 'menu',
		};
		const menu = {
			id: 'account-popup',
			getAttribute: () => 'account-trigger',
		};
		const item = { isConnected: true, focus: vi.fn(), closest: () => menu };
		vi.stubGlobal('document', {
			documentElement: html,
			activeElement: item,
			getElementById: (id: string) =>
				id === 'account-trigger' ? trigger : null,
			querySelectorAll: () => [],
		});
		await click(renderer, 'Open profile');
		item.isConnected = false;
		expect(trigger.focus).not.toHaveBeenCalled();
		await act(async () =>
			renderer.root
				.findByType(DialogRoot)
				.props.onOpenChange(false, { reason: 'escape-key' }),
		);
		expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(
			0,
		);
		await act(async () =>
			renderer.root
				.findByType(DialogRoot)
				.props.onOpenChangeComplete(false),
		);
		expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
		expect(item.focus).not.toHaveBeenCalled();
	});

	it('falls back to a visible account trigger if the original opener has been removed', async () => {
		const { renderer } = await mount();
		const opener = {
			isConnected: true,
			focus: vi.fn(),
			closest: () => null,
			matches: () => true,
		};
		const hiddenTrigger = {
			isConnected: true,
			focus: vi.fn(),
			getClientRects: () => [],
		};
		const visibleTrigger = {
			isConnected: true,
			focus: vi.fn(),
			getClientRects: () => [{}],
		};
		vi.stubGlobal('document', {
			documentElement: html,
			activeElement: opener,
			querySelectorAll: () => [hiddenTrigger, visibleTrigger],
			getElementById: () => null,
		});
		await click(renderer, 'Open profile');
		opener.isConnected = false;
		await act(async () =>
			renderer.root
				.findByType(DialogRoot)
				.props.onOpenChange(false, { reason: 'escape-key' }),
		);
		await act(async () =>
			renderer.root
				.findByType(DialogRoot)
				.props.onOpenChangeComplete(false),
		);
		expect(visibleTrigger.focus).toHaveBeenCalledWith({
			preventScroll: true,
		});
		expect(hiddenTrigger.focus).not.toHaveBeenCalled();
		expect(opener.focus).not.toHaveBeenCalled();
	});

	it('closes on an account switch and gives the next account a fresh form', async () => {
		const { renderer, client } = await mount();
		await click(renderer, 'Open profile');
		await type(renderer, 'Full name', 'Private unsaved draft');
		await switchAccount(client, sellerB);
		expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(
			0,
		);
		expect(textOf(renderer)).not.toContain('Private unsaved draft');
		await click(renderer, 'Open profile');
		expect(field(renderer, 'Full name').props.value).toBe('Seller B');
		expect(renderer.root.findByType('textarea').props.value).toBe(
			'Biography B',
		);
	});

	it('stays closed after signing out and returning to the same account', async () => {
		const { renderer, client } = await mount();
		await click(renderer, 'Open profile');
		await type(renderer, 'Full name', 'Private unsaved draft');
		await switchAccount(client, null);
		expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(
			0,
		);
		await switchAccount(client, sellerA);
		expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(
			0,
		);
		await click(renderer, 'Open profile');
		expect(field(renderer, 'Full name').props.value).toBe('Seller A');
	});

	it('keeps entered profile data and shows the API error when saving fails', async () => {
		vi.mocked(apiClient.updateProfile).mockResolvedValueOnce({
			success: false,
			error: {
				name: 'ValidationError',
				message: 'This username is already taken',
			},
		});
		const { renderer } = await mount();
		await click(renderer, 'Open profile');
		await type(renderer, 'Username', 'taken_username');
		await type(renderer, 'Full name', 'My edited name');
		await submit(renderer);
		expect(field(renderer, 'Username').props.value).toBe('taken_username');
		expect(field(renderer, 'Full name').props.value).toBe('My edited name');
		expect(textOf(renderer)).toContain('This username is already taken');
		expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(1);
		expect(button(renderer, 'Save changes').props.disabled).toBe(false);
		expect(toast.success).not.toHaveBeenCalled();
		expect(apiClient.getProfile).toHaveBeenCalledTimes(1);
	});

	it('refreshes the real auth session so other account UI sees the saved profile', async () => {
		vi.mocked(apiClient.updateProfile).mockImplementation(async (data) => {
			currentUser = { ...sellerA, ...data };
			return {
				success: true,
				data: {
					success: true,
					message: 'Profile updated successfully',
				},
			};
		});
		const { renderer } = await mount();
		await click(renderer, 'Open profile');
		await type(renderer, 'Full name', 'Updated seller');
		await submit(renderer);
		await act(flush);
		expect(apiClient.updateProfile).toHaveBeenCalledWith(
			expect.objectContaining({ displayName: 'Updated seller' }),
		);
		expect(apiClient.getProfile).toHaveBeenCalledTimes(2);
		expect(
			renderer.root.findByProps({ 'aria-label': 'Signed-in name' })
				.children,
		).toEqual(['Updated seller']);
		expect(button(renderer, 'Save changes').props.disabled).toBe(true);
		expect(toast.success).toHaveBeenCalledWith(
			'Profile updated successfully',
		);
	});

	it('keeps the applied theme when saving an appearance change fails', async () => {
		vi.mocked(apiClient.updateProfile).mockRejectedValueOnce(
			new Error('Theme could not be saved'),
		);
		const { renderer } = await mount();
		await click(renderer, 'Open appearance');
		expect(html.dataset.mode).toBe('light');
		await click(renderer, 'Dark');
		expect(apiClient.updateProfile).toHaveBeenCalledWith({ theme: 'dark' });
		expect(html.dataset.mode).toBe('light');
		expect(button(renderer, 'Light').props['aria-pressed']).toBe(true);
		expect(button(renderer, 'Dark').props['aria-pressed']).toBe(false);
		expect(textOf(renderer)).toContain('Theme could not be saved');
		expect(toast.success).not.toHaveBeenCalled();
	});
});
