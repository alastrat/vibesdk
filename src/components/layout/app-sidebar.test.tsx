import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { SidebarProvider } from '@cloudflare/kumo';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './app-sidebar';

const state = vi.hoisted(() => ({ user: { id: 'owner' } as { id: string } | null, paused: false }));
vi.mock('@/brand', () => ({ EstoriLogo: () => <span>Estori</span> }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/hooks/use-apps', () => ({
 useApps: () => ({ apps: [] }),
 useFavoriteApps: () => ({ apps: [{ id: 'tea', title: 'Tea shop', userId: 'owner' }] }),
 useRecentApps: () => ({ apps: [{ id: 'tea', title: 'Tea shop', userId: 'owner' }] }),
}));
vi.mock('@/hooks/use-flag', () => ({ useFlag: () => state.paused }));
vi.mock('@/components/shared/AppActionsDropdown', () => ({ AppActionsDropdown: () => null }));
vi.mock('@/components/usage-limits-badge', () => ({ useUsageLimitsBadgeState: () => ({ hidden: true }) }));
vi.mock('@/lib/cloudflare-connect', () => ({ startCloudflareConnect: vi.fn() }));
const render = (open = true) => renderToStaticMarkup(<MemoryRouter initialEntries={['/apps']}><SidebarProvider defaultOpen={open}><AppSidebar /></SidebarProvider></MemoryRouter>);
beforeEach(() => { state.user = { id: 'owner' }; state.paused = false; });
describe('authenticated workspace navigation', () => {
 it('provides the approved global navigation and keeps store tools out of it', () => {
  const html = render();
  for (const href of ['/apps', '/build', '/catalog', '/orders', '/discover', '/profile', '/settings']) expect(html).toContain(`href="${href}"`);
  expect(html).not.toContain('href="/emails"'); expect(html).not.toContain('href="/translations"');
  expect(html).toContain('Build &amp; manage'); expect(html).toContain('Your workspace');
 });
 it('preserves favorite store access without repeating recent stores', () => {
  const html = render(); expect(html.match(/href="\/stores\/tea"/g)).toHaveLength(1);
 });
 it('honors catalog availability and removes cached private store labels on sign-out', () => {
  state.paused = true; state.user = null; const html = render();
  expect(html).not.toContain('href="/catalog"'); expect(html).not.toContain('Tea shop'); expect(html).not.toContain('href="/profile"');
 });
 it('keeps named navigation links accessible in collapsed mode', () => {
  const html = render(false); expect(html).toMatch(/href="\/apps"[^]*?<span>My stores<\/span>/); expect(html).toContain('aria-label="Expand navigation"');
 });
});
