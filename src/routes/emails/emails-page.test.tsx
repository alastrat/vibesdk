import { act, createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHOPPER_EMAIL_TEMPLATES, SHOPPER_EMAIL_KINDS, type ApiResponse, type ShopperEmailsData } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import ShopperEmailsPage, { StoreEmailsPanel } from './emails';

vi.mock('@/lib/api-client', () => ({ apiClient: {
	getShopperEmailStores: vi.fn(),
	getShopperEmails: vi.fn(),
	saveShopperEmailSettings: vi.fn(),
	saveShopperEmail: vi.fn(),
	previewShopperEmail: vi.fn(),
} }));
vi.mock('@/hooks/use-billing', () => ({ useBilling: () => ({ data: { enabled: false }, isError: false }) }));
// The Workers renderer has no DOM for dialog portals; this preserves the editor's real fields and actions.
vi.mock('@/components/ui/dialog', async () => {
	const { createElement, Fragment } = await import('react');
	const wrapper = (props: { children?: ReactNode }) => createElement(Fragment, null, props.children);
	return {
		Dialog: (props: { open: boolean; children?: ReactNode }) => props.open ? createElement('div', { role: 'dialog' }, props.children) : null,
		DialogContent: wrapper, DialogDescription: wrapper, DialogFooter: wrapper, DialogHeader: wrapper, DialogTitle: wrapper,
	};
});

const STORES = { stores: [{ appId: 'tea', title: 'Tea shop' }, { appId: 'candles', title: 'Candle shop' }] };
function data(sender = 'tea@orders.estori.app'): ShopperEmailsData {
	return {
		templates: SHOPPER_EMAIL_KINDS.map((kind) => ({ kind, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES[kind], enabled: true, edited: false })),
		placeholders: { order_confirmation: ['store_name'], order_shipped: ['store_name'], refund_issued: ['store_name'] },
		replyTo: null, sellerEmail: 'seller@example.com', senderEmail: sender, recent: [],
	};
}
function ok<T>(value: T): ApiResponse<T> { return { success: true, data: value }; }
async function settle() {
	for (let round = 0; round < 3; round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function mount(launcher = false, appId = 'tea') {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const content = (id: string) => createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, launcher ? createElement(ShopperEmailsPage) : createElement(StoreEmailsPanel, { appId: id })));
	const renderer = await mountElement(content(appId));
	await settle();
	return { renderer, client, content };
}

beforeAll(silenceTestRendererDeprecation);
beforeEach(() => {
	vi.mocked(apiClient.getShopperEmailStores).mockResolvedValue(ok(STORES));
	vi.mocked(apiClient.getShopperEmails).mockResolvedValue(ok(data()));
});
afterEach(async () => {
	await unmountAll();
	vi.clearAllMocks();
});

describe('store email tools', () => {
	it('requires explicit selection on the legacy route without opening the first store', async () => {
		const { renderer } = await mount(true);
		expect(renderer.root.findAllByType('a').map((link) => link.props.href)).toEqual(['/stores/tea?section=emails', '/stores/candles?section=emails']);
		expect(textOf(renderer)).toContain('Tea shop');
		expect(textOf(renderer)).toContain('Candle shop');
		expect(apiClient.getShopperEmails).not.toHaveBeenCalled();
	});

	it('loads only the workspace store and preserves template controls and recent emails', async () => {
		const { renderer } = await mount();
		expect(apiClient.getShopperEmails).toHaveBeenCalledWith('tea');
		expect(apiClient.getShopperEmailStores).not.toHaveBeenCalled();
		expect(renderer.root.findAllByType('select')).toHaveLength(0);
		expect(renderer.root.findAllByType('h1')).toHaveLength(0);
		for (const label of ['Order confirmation', 'Order shipped', 'Refund issued', 'Replies go to', 'Recent emails', 'tea@orders.estori.app']) expect(textOf(renderer)).toContain(label);
	});

	it('saves replies to the workspace store and updates its shared query', async () => {
		vi.mocked(apiClient.saveShopperEmailSettings).mockResolvedValue(ok({ replyTo: 'support@example.com' }));
		const { renderer, client } = await mount();
		const email = renderer.root.find((node) => node.type === 'input' && node.props.type === 'email');
		await act(async () => email.props.onChange({ target: { value: 'support@example.com' } }));
		await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
		await settle();
		expect(apiClient.saveShopperEmailSettings).toHaveBeenCalledWith('tea', { replyTo: 'support@example.com' });
		expect(client.getQueryData<ShopperEmailsData>(queryKeys.account.shopperEmails.store('tea'))?.replyTo).toBe('support@example.com');
		expect(renderer.root.find((node) => node.type === 'input' && node.props.type === 'email').props.value).toBe('support@example.com');
	});

	it('discards unsaved replies when the workspace changes store', async () => {
		const { renderer, content } = await mount();
		const email = renderer.root.find((node) => node.type === 'input' && node.props.type === 'email');
		await act(async () => email.props.onChange({ target: { value: 'draft@example.com' } }));
		vi.mocked(apiClient.getShopperEmails).mockResolvedValue(ok({ ...data('candles@orders.estori.app'), replyTo: 'candles@example.com' }));
		await act(async () => renderer.update(content('candles')));
		await settle();
		expect(apiClient.getShopperEmails).toHaveBeenLastCalledWith('candles');
		expect(renderer.root.find((node) => node.type === 'input' && node.props.type === 'email').props.value).toBe('candles@example.com');
		expect(textOf(renderer)).toContain('candles@orders.estori.app');
		expect(textOf(renderer)).not.toContain('tea@orders.estori.app');
	});

	it('retries a failed store read in the same workspace', async () => {
		vi.mocked(apiClient.getShopperEmails).mockResolvedValueOnce({ success: false, error: { message: 'Email service unavailable', name: 'Error' } });
		const { renderer } = await mount();
		expect(textOf(renderer)).toContain('Email service unavailable');
		const retry = renderer.root.findByType('button');
		await act(async () => retry.props.onClick());
		await settle();
		expect(textOf(renderer)).toContain('Recent emails');
		expect(apiClient.getShopperEmails).toHaveBeenLastCalledWith('tea');
	});
});
