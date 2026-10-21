/**
 * Live store addresses and custom domains on real SQL: each slug and each domain belongs to one store, and routing
 * finds the store and its seller by either. Each test's writes are rolled back after it.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../test-support/real-d1';
import { LiveStoreService } from './LiveStoreService';

const NOW = new Date(1_800_000_000_000);
const HOUR = 60 * 60 * 1000;
const DAY_AGO = new Date(NOW.getTime() - 24 * HOUR);
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

	it('names the live store published last, for the heartbeat, and nothing when none is live', async () => {
		const stores = new LiveStoreService(envWith(db));
		expect(await stores.newestLiveSlug()).toBeNull();
		await stores.publish({ appId: 'app_tea', slug: 'northwind-tea', commit: 'c1', now: DAY_AGO });
		await stores.publish({ appId: 'app_home', slug: 'lumen-home', commit: 'c2', now: NOW });
		expect(await stores.newestLiveSlug()).toBe('lumen-home');
		await stores.setOffline('app_home', NOW);
		expect(await stores.newestLiveSlug()).toBe('northwind-tea');
		await stores.setOffline('app_tea', NOW);
		expect(await stores.newestLiveSlug()).toBeNull();
		// An offline store published later than a live one never counts.
		await stores.publish({ appId: 'app_tea', slug: 'northwind-tea', commit: 'c3', now: DAY_AGO });
		await stores.publish({ appId: 'app_home', slug: 'lumen-home', commit: 'c4', now: NOW });
		await stores.setOffline('app_home', NOW);
		expect(await stores.newestLiveSlug()).toBe('northwind-tea');
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
		expect((await stores.domainsDue(DAY_AGO)).map((domain) => domain.hostname)).toEqual(['shop.northwindtea.com']);

		await stores.updateDomain('shop.northwindtea.com', { status: 'active', records, lastError: null, checkedAt: NOW, verifiedAt: NOW });
		expect(await stores.storeForHostname('shop.northwindtea.com')).toEqual({ appId: 'app_tea', slug: 'northwind-tea', status: 'live', sellerUserId: 'seller_1' });
		expect(await stores.domainOfApp('app_tea')).toMatchObject({ hostname: 'shop.northwindtea.com', status: 'active', providerId: 'ch_1', records });
		expect(await stores.domainsDue(DAY_AGO)).toEqual([]);

		await stores.removeDomain('app_tea');
		expect(await stores.storeForHostname('shop.northwindtea.com')).toBeNull();
		expect(await stores.domainOfApp('app_tea')).toBeNull();
	});

	it('gives the sweep domains waiting for DNS, connected ones with a warning, and connected ones last checked before the cutoff, oldest check first', async () => {
		const stores = new LiveStoreService(envWith(db));
		const records = [{ type: 'CNAME' as const, name: 'shop.example.com', value: 'stores.estori.shop', purpose: 'routing' as const }];
		const domains = [
			{ hostname: 'shop.pending.com', status: 'pending' as const, lastError: null, checkedHoursAgo: 1 },
			{ hostname: 'shop.warned.com', status: 'active' as const, lastError: 'We can no longer see this domain.', checkedHoursAgo: 0.5 },
			{ hostname: 'shop.stale.com', status: 'active' as const, lastError: null, checkedHoursAgo: 25 },
			{ hostname: 'shop.fresh.com', status: 'active' as const, lastError: null, checkedHoursAgo: 2 },
			{ hostname: 'shop.failed.com', status: 'failed' as const, lastError: 'Gave up.', checkedHoursAgo: 48 },
		];
		for (const [index, domain] of domains.entries()) {
			const appId = `app_due_${index}`;
			await insertApp(db, { id: appId, userId: 'seller_1' });
			await stores.addDomain({ appId, hostname: domain.hostname, provider: 'cloudflare', providerId: `ch_${index}`, records, now: NOW });
			await stores.updateDomain(domain.hostname, { status: domain.status, records, lastError: domain.lastError, checkedAt: new Date(NOW.getTime() - domain.checkedHoursAgo * HOUR) });
		}
		expect((await stores.domainsDue(DAY_AGO)).map((domain) => domain.hostname)).toEqual(['shop.stale.com', 'shop.pending.com', 'shop.warned.com']);
		expect((await stores.domainsDue(DAY_AGO, 2)).map((domain) => domain.hostname)).toEqual(['shop.stale.com', 'shop.pending.com']);
	});
});
