import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { mountElement, silenceTestRendererDeprecation, textOf, unmountAll } from '@/test-support/mounted';
import BillingCardReturnPage from './billing-card-return';

vi.mock('@/lib/api-client', () => ({ ApiError: class extends Error {}, apiClient: { completeCardSetup: vi.fn() } }));
beforeAll(silenceTestRendererDeprecation);
afterEach(unmountAll);
describe('declined card recovery', () => {
	it('renders a labelled primary link to try another card and a way back to billing', async () => {
		vi.mocked(apiClient.completeCardSetup).mockResolvedValue({ success: true, data: { state: 'declined', message: 'Your card has insufficient funds.' } });
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const renderer = await mountElement(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/settings/billing/card/return?session_id=cs_test']}><BillingCardReturnPage /></MemoryRouter></QueryClientProvider>);
		for (let round = 0; round < 3; round++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
		expect(textOf(renderer)).toContain('Your card has insufficient funds.');
		expect(textOf(renderer)).toContain('Try another card');
		const links = renderer.root.findAllByType('a');
		expect(links.some((link) => link.props.href === '/settings/billing/card?mode=pay')).toBe(true);
		expect(links.some((link) => link.props.href === '/settings/billing')).toBe(true);
	});
});
