import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StoreWorkspace from './index';

const state = vi.hoisted(() => ({
	user: { id: 'owner' } as { id: string } | null,
	ownerId: 'owner' as string | undefined,
}));
vi.mock('@/contexts/auth-context', () => ({
	useAuth: () => ({ user: state.user, isLoading: false }),
}));
vi.mock('@/hooks/use-app', () => ({
	useApp: () => ({
		app: { id: 'tea', title: 'Tea shop', userId: state.ownerId },
		loading: false,
		error: null,
		refetch: () => {},
	}),
}));

vi.mock('@/hooks/use-flag', () => ({ useFlag: () => false }));

function render(section = 'products') {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[`/stores/tea?section=${section}`]}>
				<Routes>
					<Route path="/stores/:id" element={<StoreWorkspace />} />
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	state.user = { id: 'owner' };
	state.ownerId = 'owner';
});

describe('store workspace access', () => {
	it('does not mount the private workspace for a signed-out viewer', () => {
		state.user = null;
		const html = render();
		expect(html).toContain('Sign in to manage your store');
		expect(html).not.toContain('Store navigation');
		expect(html).not.toContain('/chat/tea');
	});
	it.each([undefined, 'another-owner'])(
		'refuses access when the app ownership is %s',
		(ownerId) => {
			state.ownerId = ownerId;
			const html = render();
			expect(html).toContain('only available to its owner');
			expect(html).not.toContain('Store navigation');
			expect(html).not.toContain('/chat/tea');
		},
	);
	it('gives the owner product management and the existing preview route', () => {
		const html = render();
		expect(html).toContain('Store navigation');
		expect(html).toContain('href="/app/tea"');
		expect(html).toContain('Add from catalog');
		expect(html).toContain('Create product');
		expect(html.match(/<h[12][^>]*>Products<\/h[12]>/g)).toHaveLength(1);
		expect(html).not.toContain('Your published collection, in one place.');
		expect(html).not.toContain('A product inventory is not available');
		expect(html).toContain('section=emails');
		expect(html).toContain('section=translations');
	});
});
