import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreRail } from './store-rail';
import { storeWorkspaceLocation } from './store-workspace-location';

const state = vi.hoisted(() => ({
	userId: 'owner' as string | null,
	apps: [
		{ id: 'tea', title: 'Tea shop', userId: 'owner' },
		{ id: 'candles', title: 'Candle shop', userId: 'owner' },
		{ id: 'foreign', title: 'Other seller', userId: 'someone-else' },
	],
}));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null }) }));
vi.mock('@/hooks/use-apps', () => ({ useApps: () => ({ apps: state.apps, loading: false, error: null, refetch() {} }) }));
vi.mock('@/components/usage-limits-badge', () => ({ useUsageLimitsBadgeState: () => ({ hidden: true }) }));

function render(appId = 'tea') {
	return renderToStaticMarkup(<MemoryRouter><StoreRail appId={appId} section="translations" /></MemoryRouter>);
}
beforeEach(() => { state.userId = 'owner'; });

describe('store workspace navigation', () => {
	it('keeps a valid tool section and drops parameters that belong to another store', () => {
		expect(storeWorkspaceLocation('/stores/tea', '?section=translations&product=old-product')).toEqual({ appId: 'tea', section: 'translations' });
		expect(storeWorkspaceLocation('/stores/tea', '?section=unknown')).toEqual({ appId: 'tea', section: 'home' });
	});
	it('keeps the store rail on nested order detail and switches other stores to their payments', () => {
		expect(storeWorkspaceLocation('/stores/tea/orders/order-1', '')).toEqual({ appId: 'tea', section: 'payments' });
		expect(storeWorkspaceLocation('/orders/order-1', '')).toBeNull();
		expect(storeWorkspaceLocation('/chat/tea', '')).toBeNull();
	});
	it('links only owned stores and preserves the selected section when switching', () => {
		const html = render();
		expect(html).toContain('href="/stores/candles?section=translations"');
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('href="/chat/tea"');
		expect(html).toContain('href="/apps"');
		expect(html).toContain('href="/build"');
		expect(html).not.toContain('Other seller');
		expect(html).not.toContain('/stores/foreign');
	});
	it('does not offer a builder link for a store that is not owned', () => {
		expect(render('foreign')).not.toContain('/chat/foreign');
	});
	it('does not render cached store names after sign-out', () => {
		state.userId = null;
		const html = render();
		expect(html).not.toContain('Tea shop');
		expect(html).not.toContain('Candle shop');
	});
});
