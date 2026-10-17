import { describe, expect, it } from 'vitest';
import { addStoreDomain, checkStoreDomain, removeStoreDomain, sweepPendingDomains, DOMAIN_SETUP_DAYS, type DomainFlowDeps } from './domain-checks';
import type { CustomHostnameProvider, DomainState } from './domains';
import type { StoreDomainRow } from '../../database/services/LiveStoreService';

const DAY = 24 * 60 * 60 * 1000;
const RECORDS = [{ type: 'CNAME' as const, name: 'shop.northwindtea.com', value: 'stores.estori.shop', purpose: 'routing' as const }];

function world(options: { checks?: DomainState[]; createFails?: boolean; removeFails?: boolean; takenBy?: Record<string, string> } = {}) {
	const rows = new Map<string, StoreDomainRow>();
	const removedAtProvider: string[] = [];
	let now = new Date(1_800_000_000_000);
	const provider: CustomHostnameProvider = {
		name: 'cloudflare',
		create: async (hostname) => {
			if (options.createFails) throw new Error('Duplicate custom hostname found.');
			return { providerId: `ch_${hostname}`, status: 'pending', records: RECORDS, error: null };
		},
		check: async () => options.checks?.shift() ?? { status: 'pending', records: RECORDS, error: null },
		remove: async (hostname) => {
			if (options.removeFails) throw new Error('Cloudflare is unreachable');
			removedAtProvider.push(hostname);
		},
	};
	const deps: DomainFlowDeps = {
		provider,
		own: { storesDomain: 'estori.shop', estoriDomains: ['estori.app'] },
		now: () => now,
		stores: {
			domainOfApp: async (appId) => [...rows.values()].find((row) => row.appId === appId) ?? null,
			addDomain: async (input) => {
				if (options.takenBy?.[input.hostname] || rows.has(input.hostname)) return 'hostname-taken';
				if ([...rows.values()].some((row) => row.appId === input.appId)) return 'store-has-domain';
				rows.set(input.hostname, { hostname: input.hostname, appId: input.appId, status: 'pending', provider: input.provider, providerId: input.providerId, records: input.records, lastError: null, createdAt: input.now, checkedAt: null, verifiedAt: null });
				return 'added';
			},
			updateDomain: async (hostname, update) => {
				const row = rows.get(hostname);
				if (row) rows.set(hostname, { ...row, ...update, verifiedAt: update.verifiedAt === undefined ? row.verifiedAt : update.verifiedAt });
			},
			removeDomain: async (appId) => {
				for (const [hostname, row] of rows) if (row.appId === appId) rows.delete(hostname);
			},
			pendingDomains: async () => [...rows.values()].filter((row) => row.status === 'pending'),
		},
	};
	return { deps, rows, removedAtProvider, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('adding a domain', () => {
	it("creates it at the provider and keeps the records to show, however the seller typed it", async () => {
		const { deps, rows } = world();
		const added = await addStoreDomain(deps, 'app_tea', ' https://Shop.NorthwindTea.com/ ');
		expect(added).toMatchObject({ ok: true, domain: { hostname: 'shop.northwindtea.com', status: 'pending', providerId: 'ch_shop.northwindtea.com', records: RECORDS } });
		expect([...rows.keys()]).toEqual(['shop.northwindtea.com']);
	});

	it("refuses bad domains, Estori's own, a second domain, and one another store has, removing what it created", async () => {
		const { deps, removedAtProvider } = world({ takenBy: { 'shop.taken.com': 'app_other' } });
		expect(await addStoreDomain(deps, 'app_tea', 'not a domain')).toEqual({ ok: false, message: 'Enter a full domain, such as shop.yourstore.com.' });
		expect(await addStoreDomain(deps, 'app_tea', 'tea.estori.shop')).toEqual({ ok: false, message: "That's an Estori address. Enter a domain you own." });
		expect(await addStoreDomain(deps, 'app_tea', 'shop.taken.com')).toEqual({ ok: false, message: 'That domain is connected to another store.' });
		expect(removedAtProvider).toEqual(['shop.taken.com']);
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		expect(await addStoreDomain(deps, 'app_tea', 'www.northwindtea.com')).toEqual({ ok: false, message: 'This store already has a domain. Remove it to connect another.' });
	});

	it("says so when the provider refuses, and when custom domains aren't set up", async () => {
		expect(await addStoreDomain(world({ createFails: true }).deps, 'app_tea', 'shop.northwindtea.com')).toEqual({ ok: false, message: "This domain couldn't be added: Duplicate custom hostname found." });
		expect(await addStoreDomain({ ...world().deps, provider: null }, 'app_tea', 'shop.northwindtea.com')).toEqual({ ok: false, message: "Custom domains aren't set up yet." });
	});
});

describe('checking a domain', () => {
	it('connects it once the provider says it is active, noting when', async () => {
		const { deps } = world({ checks: [{ status: 'pending', records: RECORDS, error: null }, { status: 'active', records: RECORDS, error: null }] });
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		expect(await checkStoreDomain(deps, 'app_tea')).toMatchObject({ ok: true, domain: { status: 'pending', verifiedAt: null } });
		expect(await checkStoreDomain(deps, 'app_tea')).toMatchObject({ ok: true, domain: { status: 'active', verifiedAt: new Date(1_800_000_000_000) } });
	});

	it(`fails a domain still waiting for DNS after ${DOMAIN_SETUP_DAYS} days`, async () => {
		const { deps, advance } = world();
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		advance(DOMAIN_SETUP_DAYS * DAY + 1);
		expect(await checkStoreDomain(deps, 'app_tea')).toMatchObject({ ok: true, domain: { status: 'failed', lastError: "The DNS records weren't added within 7 days. Remove the domain and add it again." } });
	});

	it('sweeps every pending domain, connecting the ones that are ready', async () => {
		const { deps, rows } = world({ checks: [{ status: 'active', records: RECORDS, error: null }] });
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		expect(await sweepPendingDomains(deps)).toEqual({ checked: 1, connected: 1, failed: 0 });
		expect(rows.get('shop.northwindtea.com')?.status).toBe('active');
	});
});

describe('removing a domain', () => {
	it('removes it at the provider, then here, and keeps it when the provider fails, so nothing is left behind', async () => {
		const failing = world({ removeFails: true });
		await addStoreDomain(failing.deps, 'app_tea', 'shop.northwindtea.com');
		expect(await removeStoreDomain(failing.deps, 'app_tea')).toEqual({ ok: false, message: "The domain couldn't be removed right now. Try again." });
		expect(failing.rows.size).toBe(1);

		const { deps, rows, removedAtProvider } = world();
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		expect(await removeStoreDomain(deps, 'app_tea')).toEqual({ ok: true });
		expect(removedAtProvider).toEqual(['shop.northwindtea.com']);
		expect(rows.size).toBe(0);
	});
});
