import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { renderToStaticMarkup } from 'react-dom/server';
import { mountElement, silenceTestRendererDeprecation, unmountAll } from '@/test-support/mounted';
import PublicDiscoverPage from './public';
import { applyAccountLocale, useLocale } from '@/lib/i18n';
import { catalogFilters, discoverPrice } from '@/components/public-site/discover/catalog-utils';
import DiscoverRoute from './route';

const state = vi.hoisted(() => ({ auth: { isLoading: false, isAuthenticated: false, user: null as { id: string; isAnonymous: boolean } | null }, filters: {} as Record<string, unknown>, categoryCount: 6 }));
vi.mock('@/contexts/auth-context', () => ({ useAuth: () => state.auth }));
vi.mock('./index', () => ({ default: () => <div>Signed-in marketplace</div> }));
vi.mock('@/components/public-site/discover/DiscoverDialog', () => ({ DiscoverDialog: () => null }));
vi.mock('@/components/public-site/discover/DiscoverCard', () => ({ DiscoverCard: () => <div>Preview card</div> }));
vi.mock('@/components/public-site/solution-page', () => ({ PageMeta: () => null }));
vi.mock('@/hooks/use-public-discover', () => ({
 useDiscoverCatalog: (filters: Record<string, unknown>) => { state.filters = filters; return { data: { entries: [], total: 0 }, isPending: false, isError: false }; },
 useDiscoverCategories: () => ({ data: [{ id: 'food', slug: 'food-drink', title: 'Food & Drink', color: '#fff', count: state.categoryCount, coverUrl: null }], isPending: false }),
}));
vi.mock('@/lib/i18n/catalog-loader', () => ({
 loadCatalog: async (locale: string) => locale === 'en' ? null : locale === 'es' ? {
  'Good ideas start here.': 'Las buenas ideas empiezan aquí.',
  'Store templates': 'Plantillas de tiendas',
  'Free': 'Gratis',
  '{count} idea to make your own|{count} ideas to make your own': { one: '{count} idea para hacerla tuya', other: '{count} ideas para hacerlas tuyas' },
 } : {
  'Good ideas start here.': 'Boas ideias começam aqui.',
  'Store templates': 'Templates de lojas',
  'Free': 'Grátis',
  '{count} idea to make your own|{count} ideas to make your own': { one: '{count} ideia para deixar do seu jeito', other: '{count} ideias para deixar do seu jeito' },
 },
}));
// Routes subscribe to the language in production; mirror that boundary in this focused test.
function LocalizedDiscover() { useLocale(); return <PublicDiscoverPage />; }
beforeAll(silenceTestRendererDeprecation);
afterEach(async () => { await unmountAll(); await applyAccountLocale('en'); state.categoryCount = 6; state.auth = { isLoading: false, isAuthenticated: false, user: null }; });
describe('public catalog URL and session behavior', () => {
 it('accepts bounded search and known kind/tier without treating modal state as a filter', () => {
  expect(catalogFilters(new URLSearchParams('q=coffee&kind=store&tier=premium&category=food-drink&item=origin-coffee'))).toEqual({ search: 'coffee', kind: 'store', tier: 'premium', category: 'food-drink', limit: 48, offset: 0 });
  const invalid = catalogFilters(new URLSearchParams({ kind: 'evil', tier: 'paid', q: 'a'.repeat(500) }));
  expect(invalid.kind).toBeUndefined(); expect(invalid.tier).toBeUndefined(); expect(invalid.search).toHaveLength(120);
 });
 it('keeps fully signed-in users in their existing marketplace', () => {
  state.auth = { isLoading: false, isAuthenticated: true, user: { id: 'owner', isAnonymous: false } };
  expect(renderToStaticMarkup(<MemoryRouter><DiscoverRoute /></MemoryRouter>)).toContain('Signed-in marketplace');
 });
 it('renders public content for signed-out and anonymous sessions and neutral loading while resolving auth', () => {
  for (const auth of [{ isLoading: false, isAuthenticated: false, user: null }, { isLoading: false, isAuthenticated: true, user: { id: 'anon', isAnonymous: true } }]) {
   state.auth = auth;
   const html = renderToStaticMarkup(<MemoryRouter><DiscoverRoute /></MemoryRouter>);
   expect(html).toContain('Good ideas start here.'); expect(html).not.toContain('Signed-in marketplace');
  }
  state.auth.isLoading = true;
  const loading = renderToStaticMarkup(<MemoryRouter><DiscoverRoute /></MemoryRouter>);
  expect(loading).toContain('Loading Discover'); expect(loading).not.toContain('Good ideas');
 });
 it('applies user type selection without dropping existing search or topic', async () => {
  const renderer = await mountElement(<MemoryRouter initialEntries={['/discover?q=coffee&category=food-drink']}><PublicDiscoverPage /></MemoryRouter>);
  const button = renderer.root.findAllByType('button').find((node) => node.children.includes('Animated components'))!;
  await act(async () => button.props.onClick());
  expect(state.filters).toMatchObject({ search: 'coffee', category: 'food-drink', kind: 'component' });
 });
 it('shows a useful empty result and resets all filters', async () => {
  const renderer = await mountElement(<MemoryRouter initialEntries={['/discover?q=nothing&tier=premium']}><PublicDiscoverPage /></MemoryRouter>);
  const reset = renderer.root.findAllByType('button').find((node) => node.children.includes('Explore everything'))!;
  await act(async () => reset.props.onClick());
  expect(state.filters).toMatchObject({ search: '', category: '', tier: undefined });
 });
});

describe('Discover language changes', () => {
 it('updates a mounted page and uses each language’s plural rules', async () => {
  state.categoryCount = 0;
  const renderer = await mountElement(<MemoryRouter><LocalizedDiscover /></MemoryRouter>);
  await act(async () => { await applyAccountLocale('es'); });
  expect(renderer.root.findByType('h1').children).toEqual(['Las buenas ideas empiezan aquí.']);
  expect(renderer.root.findAllByType('button').some((node) => node.children.includes('Plantillas de tiendas'))).toBe(true);
  expect(renderer.root.findByProps({ className: 'discover-topic-meta' }).children).toContain('0 ideas para hacerlas tuyas');
  await act(async () => { await applyAccountLocale('pt-BR'); });
  expect(renderer.root.findByType('h1').children).toEqual(['Boas ideias começam aqui.']);
  expect(renderer.root.findAllByType('button').some((node) => node.children.includes('Templates de lojas'))).toBe(true);
  expect(renderer.root.findByProps({ className: 'discover-topic-meta' }).children).toContain('0 ideia para deixar do seu jeito');
 });
 it('formats USD prices in the active locale without rounding cents away', async () => {
  const premium = { tier: 'premium' as const, priceCents: 2950 };
  expect(discoverPrice(premium)).toBe('$29.50');
  await applyAccountLocale('es');
  expect(discoverPrice(premium).replace(/\s/g, ' ')).toBe('USD 29.50');
  expect(discoverPrice({ tier: 'free', priceCents: 0 })).toBe('Gratis');
  await applyAccountLocale('pt-BR');
  expect(discoverPrice(premium).replace(/\s/g, ' ')).toBe('US$ 29,50');
  expect(discoverPrice({ tier: 'free', priceCents: 0 })).toBe('Grátis');
 });
});
