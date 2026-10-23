import { act, createElement } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiResponse, MyEarlyAccessData } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { applyAccountLocale, t } from '@/lib/i18n';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import { toast } from 'sonner';
import { EARLY_ACCESS_CONFIRMATION, useEarlyAccessFromUrl } from './use-early-access';

const navigation = vi.hoisted(() => vi.fn());
vi.mock('react-router', () => ({ useLocation: () => ({ pathname: '/solutions/digital', search: '?request=digital-products', hash: '' }), useNavigate: () => navigation }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'seller-a' } }) }));
vi.mock('@/lib/api-client', () => ({ apiClient: { requestEarlyAccess: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const clients: QueryClient[] = [];
function Probe() { useEarlyAccessFromUrl(); return null; }
async function mount() {
 const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
 clients.push(client);
 return mountElement(createElement(QueryClientProvider, { client }, createElement(Probe)));
}

beforeAll(silenceTestRendererDeprecation);
afterEach(async () => {
 await unmountAll();
 clients.splice(0).forEach(client => client.clear());
 await applyAccountLocale('en');
 vi.clearAllMocks();
});

it('uses the language selected when the sign-in return request completes', async () => {
 let finish!: (response: ApiResponse<MyEarlyAccessData>) => void;
 vi.mocked(apiClient.requestEarlyAccess).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 await applyAccountLocale('es');
 await mount();
 expect(apiClient.requestEarlyAccess).toHaveBeenCalledWith('digital-products');
 expect(navigation).toHaveBeenCalledWith({ pathname: '/solutions/digital', hash: '' }, { replace: true });
 await act(async () => {
  await applyAccountLocale('pt-BR');
  finish({ success: true, data: { capabilities: ['digital-products'] } });
  // TanStack batches mutation notifications on its next timer tick.
  await new Promise(resolve => setTimeout(resolve, 10));
 });
 expect(toast.success).toHaveBeenCalledWith(t(EARLY_ACCESS_CONFIRMATION));
 expect(t(EARLY_ACCESS_CONFIRMATION)).not.toBe(EARLY_ACCESS_CONFIRMATION);
 expect(apiClient.requestEarlyAccess).toHaveBeenCalledTimes(1);
});

it('translates known failures and preserves unknown error text', async () => {
 await applyAccountLocale('es');
 vi.mocked(apiClient.requestEarlyAccess).mockRejectedValueOnce(new Error("Couldn't save your request"));
 await mount();
 expect(toast.error).toHaveBeenLastCalledWith(t("Couldn't save your request"));
 await unmountAll();
 const unknown = 'Unexpected <b>response</b> {detail}';
 vi.mocked(apiClient.requestEarlyAccess).mockRejectedValueOnce(new Error(unknown));
 await mount();
 expect(toast.error).toHaveBeenLastCalledWith(unknown);
});
