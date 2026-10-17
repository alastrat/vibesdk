import { describe, expect, it } from 'vitest';
import { createStoreHostResolver, type StoreHostConfig } from './hosts';
import type { LiveStoreTarget } from '../../database/services/LiveStoreService';

const TEA: LiveStoreTarget = { appId: 'app_tea', slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' };
const PROD: StoreHostConfig = { storesDomain: 'estori.shop', customDomain: 'estori.app', previewDomain: 'preview.estori.app', dev: false };
const DEV: StoreHostConfig = { storesDomain: 'stores.localhost', customDomain: 'localhost', previewDomain: 'localhost', dev: true };

function resolverWith(stores: { slugs?: Record<string, LiveStoreTarget>; hosts?: Record<string, LiveStoreTarget> }) {
	const asked: string[] = [];
	let now = 1_000;
	const resolver = createStoreHostResolver(() => now);
	const lookup = {
		storeForSlug: async (slug: string) => (asked.push(`slug:${slug}`), stores.slugs?.[slug] ?? null),
		storeForHostname: async (hostname: string) => (asked.push(`host:${hostname}`), stores.hosts?.[hostname] ?? null),
	};
	const resolve = (hostname: string, config: StoreHostConfig) => resolver(hostname, config, lookup);
	return { resolve, asked, advance: (ms: number) => (now += ms) };
}

describe('resolving a store from its host', () => {
	it('finds a store by its subdomain, and by its connected domain', async () => {
		const { resolve } = resolverWith({ slugs: { 'northwind-tea': TEA }, hosts: { 'shop.northwindtea.com': TEA } });
		expect(await resolve('northwind-tea.estori.shop', PROD)).toEqual({ kind: 'subdomain', store: TEA });
		expect(await resolve('shop.northwindtea.com', PROD)).toEqual({ kind: 'custom', store: TEA });
		expect(await resolve('unknown.estori.shop', PROD)).toBeNull();
	});

	it("never looks up Estori's own hosts as stores", async () => {
		const { resolve, asked } = resolverWith({});
		for (const host of ['estori.app', 'preview.estori.app', 'b-agent-token.preview.estori.app', 'estori.shop', 'deep.label.estori.shop']) {
			expect(await resolve(host, PROD), host).toBeNull();
		}
		expect(asked).toEqual([]);
	});

	it('looks up local .localhost domains in development only', async () => {
		const { resolve, asked } = resolverWith({ hosts: { 'shop.northwindtea.localhost': TEA } });
		expect(await resolve('northwind-tea.stores.localhost', DEV)).toBeNull();
		expect(await resolve('shop.northwindtea.localhost', DEV)).toEqual({ kind: 'custom', store: TEA });
		expect(await resolve('localhost', DEV)).toBeNull();
		expect(await resolve('shop.northwindtea.localhost', { ...DEV, dev: false })).toBeNull();
		expect(asked).toEqual(['slug:northwind-tea', 'host:shop.northwindtea.localhost']);
	});

	it("keeps a live store's answer 30 seconds, then asks again", async () => {
		const { resolve, asked, advance } = resolverWith({ slugs: { 'northwind-tea': TEA } });
		await resolve('northwind-tea.estori.shop', PROD);
		advance(29_000);
		await resolve('northwind-tea.estori.shop', PROD);
		expect(asked).toEqual(['slug:northwind-tea']);
		advance(1_001);
		await resolve('northwind-tea.estori.shop', PROD);
		expect(asked).toEqual(['slug:northwind-tea', 'slug:northwind-tea']);
	});

	it('keeps a missing or offline store only 5 seconds, so a store that opens is seen quickly', async () => {
		const closed: LiveStoreTarget = { ...TEA, slug: 'lumen-home', status: 'offline' };
		const { resolve, asked, advance } = resolverWith({ slugs: { 'lumen-home': closed } });
		await resolve('nobody.estori.shop', PROD);
		await resolve('lumen-home.estori.shop', PROD);
		advance(4_000);
		await resolve('nobody.estori.shop', PROD);
		await resolve('lumen-home.estori.shop', PROD);
		expect(asked).toEqual(['slug:nobody', 'slug:lumen-home']);
		advance(1_001);
		await resolve('nobody.estori.shop', PROD);
		await resolve('lumen-home.estori.shop', PROD);
		expect(asked).toEqual(['slug:nobody', 'slug:lumen-home', 'slug:nobody', 'slug:lumen-home']);
	});

	it('has no stores without a stores domain', async () => {
		const { resolve, asked } = resolverWith({ slugs: { 'northwind-tea': TEA } });
		expect(await resolve('northwind-tea.estori.shop', { ...PROD, storesDomain: null })).toBeNull();
		expect(asked).toEqual([]);
	});
});
