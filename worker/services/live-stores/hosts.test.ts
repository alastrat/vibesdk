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

	it('answers repeat requests from a 30-second cache, misses included, then asks again', async () => {
		const { resolve, asked, advance } = resolverWith({ slugs: { 'northwind-tea': TEA } });
		await resolve('northwind-tea.estori.shop', PROD);
		await resolve('northwind-tea.estori.shop', PROD);
		await resolve('nobody.estori.shop', PROD);
		await resolve('nobody.estori.shop', PROD);
		expect(asked).toEqual(['slug:northwind-tea', 'slug:nobody']);
		advance(30_001);
		await resolve('northwind-tea.estori.shop', PROD);
		expect(asked).toEqual(['slug:northwind-tea', 'slug:nobody', 'slug:northwind-tea']);
	});

	it('has no stores without a stores domain', async () => {
		const { resolve, asked } = resolverWith({ slugs: { 'northwind-tea': TEA } });
		expect(await resolve('northwind-tea.estori.shop', { ...PROD, storesDomain: null })).toBeNull();
		expect(asked).toEqual([]);
	});
});
