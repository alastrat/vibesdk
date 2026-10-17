/**
 * Live store addresses and custom domains on real SQL: each slug and each domain belongs to one store, and routing
 * finds the store and its seller by either. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { LiveStoreService } from './LiveStoreService';

const NOW = new Date(1_800_000_000_000);
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertUser(db, 'seller_2');
	await insertApp(db, { id: 'app_tea', userId: 'seller_1', title: 'Northwind Tea' });
	await insertApp(db, { id: 'app_home', userId: 'seller_2', title: 'Lumen Home' });
});

describe('live stores on real SQL', () => {
	it('publishes a store at its address, finds it with its seller, and takes it offline', async () => {
		const stores = new LiveStoreService(envWith(db));
		expect(await stores.publish({ appId: 'app_tea', slug: 'northwind-tea', commit: 'c1', now: NOW })).toBe('published');
		expect(await stores.storeForSlug('northwind-tea')).toEqual({ appId: 'app_tea', slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' });
		await stores.setOffline('app_tea', NOW);
		expect(await stores.storeForSlug('northwind-tea')).toMatchObject({ status: 'offline' });
		// Publishing again reopens it with the new version, and may move it to a new address.
		expect(await stores.publish({ appId: 'app_tea', slug: 'northwind', commit: 'c2', now: NOW })).toBe('published');
		expect(await stores.getByApp('app_tea')).toMatchObject({ slug: 'northwind', status: 'live', publishedCommit: 'c2' });
		expect(await stores.storeForSlug('northwind-tea')).toBeNull();
	});

	it('gives an address to one store only', async () => {
		const stores = new LiveStoreService(envWith(db));
		expect(await stores.publish({ appId: 'app_tea', slug: 'northwind-tea', commit: 'c1', now: NOW })).toBe('published');
		expect(await stores.publish({ appId: 'app_home', slug: 'northwind-tea', commit: 'c9', now: NOW })).toBe('slug-taken');
		expect(await stores.getByApp('app_home')).toBeNull();
	});

	it('connects a domain to one store only, finds the store by it once it is active, and removes it', async () => {
		const stores = new LiveStoreService(envWith(db));
		await stores.publish({ appId: 'app_tea', slug: 'northwind-tea', commit: 'c1', now: NOW });
		const records = [{ type: 'CNAME' as const, name: 'shop.northwindtea.com', value: 'stores.estori.shop', purpose: 'routing' as const }];
		expect(await stores.addDomain({ appId: 'app_tea', hostname: 'shop.northwindtea.com', provider: 'cloudflare', providerId: 'ch_1', records, now: NOW })).toBe('added');
		expect(await stores.addDomain({ appId: 'app_home', hostname: 'shop.northwindtea.com', provider: 'cloudflare', providerId: 'ch_2', records, now: NOW })).toBe('hostname-taken');
		expect(await stores.addDomain({ appId: 'app_tea', hostname: 'www.northwindtea.com', provider: 'cloudflare', providerId: 'ch_3', records, now: NOW })).toBe('store-has-domain');
		// Whoever holds a hostname, in any state, so a stale claim can be weighed before it's replaced.
		expect(await stores.domainByHostname('shop.northwindtea.com')).toMatchObject({ appId: 'app_tea', status: 'pending', providerId: 'ch_1' });
		expect(await stores.domainByHostname('www.northwindtea.com')).toBeNull();
		// Pending domains don't route yet.
		expect(await stores.storeForHostname('shop.northwindtea.com')).toBeNull();
		expect((await stores.pendingDomains()).map((domain) => domain.hostname)).toEqual(['shop.northwindtea.com']);

		await stores.updateDomain('shop.northwindtea.com', { status: 'active', records, lastError: null, checkedAt: NOW, verifiedAt: NOW });
		expect(await stores.storeForHostname('shop.northwindtea.com')).toEqual({ appId: 'app_tea', slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' });
		expect(await stores.domainOfApp('app_tea')).toMatchObject({ hostname: 'shop.northwindtea.com', status: 'active', providerId: 'ch_1', records });
		expect(await stores.pendingDomains()).toEqual([]);

		await stores.removeDomain('app_tea');
		expect(await stores.storeForHostname('shop.northwindtea.com')).toBeNull();
		expect(await stores.domainOfApp('app_tea')).toBeNull();
	});
});
