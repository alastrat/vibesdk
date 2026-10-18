import { describe, expect, it } from 'vitest';
import { addStoreDomain, checkStoreDomain, releaseDeletedStoreDomain, removeStoreDomain, sweepStoreDomains, CONNECTED_DOMAIN_CHECK_HOURS, DOMAIN_CLAIM_HOLD_HOURS, DOMAIN_SETUP_DAYS, type DomainFlowDeps } from './domain-checks';
import type { CustomHostnameProvider, DomainState } from './domains';
import type { StoreDomainRow } from '../../database/services/LiveStoreService';

const DAY = 24 * 60 * 60 * 1000;
const RECORDS = [{ type: 'CNAME' as const, name: 'shop.northwindtea.com', value: 'stores.estori.shop', purpose: 'routing' as const }];
const RENEWAL_RECORDS = [...RECORDS, { type: 'TXT' as const, name: '_acme-challenge.shop.northwindtea.com', value: 'renewal-token', purpose: 'certificate' as const }];
const ACTIVE: DomainState = { status: 'active', records: RECORDS, error: null };

function world(options: { checks?: Array<DomainState | Error>; createFails?: boolean; removeFails?: boolean; saveFails?: boolean; takenBy?: Record<string, string>; updateFailsFor?: string } = {}) {
	const rows = new Map<string, StoreDomainRow>();
	const removedAtProvider: string[] = [];
	const warned: string[] = [];
	const dueCutoffs: Date[] = [];
	let now = new Date(1_800_000_000_000);
	const provider: CustomHostnameProvider = {
		name: 'cloudflare',
		create: async (hostname) => {
			if (options.createFails) throw new Error('Duplicate custom hostname found.');
			return { providerId: `ch_${hostname}`, status: 'pending', records: RECORDS, error: null };
		},
		check: async () => {
			const next = options.checks?.shift();
			if (next instanceof Error) throw next;
			return next ?? { status: 'pending', records: RECORDS, error: null };
		},
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
			domainByHostname: async (hostname) => rows.get(hostname) ?? null,
			addDomain: async (input) => {
				if (options.saveFails) throw new Error('D1_ERROR: database is locked');
				if (options.takenBy?.[input.hostname] || rows.has(input.hostname)) return 'hostname-taken';
				if ([...rows.values()].some((row) => row.appId === input.appId)) return 'store-has-domain';
				rows.set(input.hostname, { hostname: input.hostname, appId: input.appId, status: 'pending', provider: input.provider, providerId: input.providerId, records: input.records, lastError: null, createdAt: input.now, checkedAt: null, verifiedAt: null });
				return 'added';
			},
			updateDomain: async (hostname, update) => {
				if (options.updateFailsFor === hostname) throw new Error('D1_ERROR: database is locked');
				const row = rows.get(hostname);
				if (row) rows.set(hostname, { ...row, ...update, verifiedAt: update.verifiedAt === undefined ? row.verifiedAt : update.verifiedAt });
			},
			removeDomain: async (appId) => {
				for (const [hostname, row] of rows) if (row.appId === appId) rows.delete(hostname);
			},
			domainsDue: async (connectedCheckedBefore) => {
				dueCutoffs.push(connectedCheckedBefore);
				return [...rows.values()].filter((row) => row.status === 'pending' || (row.status === 'active' && (row.lastError !== null || !row.checkedAt || row.checkedAt < connectedCheckedBefore)));
			},
		},
		warnSeller: async (domain) => void warned.push(domain.hostname),
	};
	return { deps, rows, removedAtProvider, warned, dueCutoffs, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
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

describe('a domain another store claimed', () => {
	it(`can be taken over once that claim failed, or waited for DNS over ${DOMAIN_CLAIM_HOLD_HOURS} hours, removing it at the provider first`, async () => {
		const { deps, rows, removedAtProvider, advance } = world();
		await addStoreDomain(deps, 'app_squatter', 'shop.northwindtea.com');
		expect(await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com')).toEqual({ ok: false, message: 'That domain is connected to another store.' });
		advance(DOMAIN_CLAIM_HOLD_HOURS * 60 * 60 * 1000 + 1);
		expect(await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com')).toMatchObject({ ok: true, domain: { appId: 'app_tea', status: 'pending' } });
		expect(removedAtProvider).toEqual(['shop.northwindtea.com']);
		expect([...rows.values()].map((row) => row.appId)).toEqual(['app_tea']);

		rows.set('www.northwindtea.com', { ...rows.get('shop.northwindtea.com')!, hostname: 'www.northwindtea.com', appId: 'app_failed', status: 'failed', createdAt: new Date(1_800_000_000_000 + DOMAIN_CLAIM_HOLD_HOURS * 3600 * 1000) });
		expect(await addStoreDomain(deps, 'app_lumen', 'www.northwindtea.com')).toMatchObject({ ok: true, domain: { appId: 'app_lumen' } });
	});

	it('is never taken from a store whose domain is connected', async () => {
		const { deps, advance } = world({ checks: [{ status: 'active', records: RECORDS, error: null }] });
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		await checkStoreDomain(deps, 'app_tea');
		advance(30 * DAY);
		expect(await addStoreDomain(deps, 'app_other', 'shop.northwindtea.com')).toEqual({ ok: false, message: 'That domain is connected to another store.' });
	});

	it("removes the provider's copy when saving the domain here fails, so retrying isn't blocked", async () => {
		const { deps, removedAtProvider } = world({ saveFails: true });
		expect(await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com')).toEqual({ ok: false, message: "This domain couldn't be added. Try again." });
		expect(removedAtProvider).toEqual(['shop.northwindtea.com']);
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

	it('keeps sweeping the other domains when one fails to save, and counts it failed for this run', async () => {
		const { deps, rows } = world({ checks: [{ status: 'active', records: RECORDS, error: null }, { status: 'active', records: RECORDS, error: null }], updateFailsFor: 'shop.northwindtea.com' });
		await addStoreDomain({ ...deps, stores: { ...deps.stores, updateDomain: async () => undefined } }, 'app_tea', 'shop.northwindtea.com');
		await addStoreDomain(deps, 'app_lumen', 'shop.lumenhome.com');
		expect(await sweepStoreDomains(deps)).toEqual({ checked: 2, connected: 1, failed: 1, warned: 0 });
		expect(rows.get('shop.lumenhome.com')?.status).toBe('active');
	});

	it('sweeps every pending domain, connecting the ones that are ready', async () => {
		const { deps, rows } = world({ checks: [{ status: 'active', records: RECORDS, error: null }] });
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		expect(await sweepStoreDomains(deps)).toEqual({ checked: 1, connected: 1, failed: 0, warned: 0 });
		expect(rows.get('shop.northwindtea.com')?.status).toBe('active');
	});
});

describe('a connected domain', () => {
	const connect = async (checks: Array<DomainState | Error>) => {
		const flow = world({ checks: [ACTIVE, ...checks] });
		await addStoreDomain(flow.deps, 'app_tea', 'shop.northwindtea.com');
		await checkStoreDomain(flow.deps, 'app_tea');
		return flow;
	};

	it('keeps serving when the provider stops seeing its records, shows the records to fix with a warning, and tells the seller once', async () => {
		const { deps, warned } = await connect([
			{ status: 'pending', records: RENEWAL_RECORDS, error: null },
			{ status: 'pending', records: RENEWAL_RECORDS, error: null },
		]);
		const checked = await checkStoreDomain(deps, 'app_tea');
		expect(checked).toMatchObject({ ok: true, domain: { status: 'active', records: RENEWAL_RECORDS, verifiedAt: new Date(1_800_000_000_000) } });
		expect(checked.ok && checked.domain.lastError).toBe(
			"We can't see this domain's DNS records right now. Your store still answers on it, but visitors may not reach it until the records below are back at your DNS provider.",
		);
		expect(warned).toEqual(['shop.northwindtea.com']);
		await checkStoreDomain(deps, 'app_tea');
		expect(warned).toEqual(['shop.northwindtea.com']);
	});

	it("adds the provider's reason to the warning when it gives one", async () => {
		const { deps } = await connect([{ status: 'failed', records: RECORDS, error: 'custom hostname does not CNAME to this zone.' }]);
		const checked = await checkStoreDomain(deps, 'app_tea');
		expect(checked).toMatchObject({ ok: true, domain: { status: 'active' } });
		expect(checked.ok && checked.domain.lastError).toMatch(/at your DNS provider\. The reason given: custom hostname does not CNAME to this zone\.$/);
	});

	it('clears the warning once the records are seen again, and warns again if they go a second time', async () => {
		const { deps, warned } = await connect([{ status: 'pending', records: RECORDS, error: null }, ACTIVE, { status: 'pending', records: RECORDS, error: null }]);
		await checkStoreDomain(deps, 'app_tea');
		expect(await checkStoreDomain(deps, 'app_tea')).toMatchObject({ ok: true, domain: { status: 'active', lastError: null } });
		await checkStoreDomain(deps, 'app_tea');
		expect(warned).toEqual(['shop.northwindtea.com', 'shop.northwindtea.com']);
	});

	it("stays as it was when the provider can't answer, since that says nothing about the seller's DNS", async () => {
		const { deps, warned, advance } = await connect([new Error('Cloudflare answered 503')]);
		advance(60_000);
		expect(await checkStoreDomain(deps, 'app_tea')).toMatchObject({ ok: true, domain: { status: 'active', lastError: null, records: RECORDS, checkedAt: new Date(1_800_000_060_000) } });
		expect(warned).toEqual([]);
	});

	it(`is swept again every ${CONNECTED_DOMAIN_CHECK_HOURS} hours, or every hour while it has a warning, counting only what changed`, async () => {
		const { deps, rows, warned, dueCutoffs, advance } = world({ checks: [ACTIVE, { status: 'pending', records: RECORDS, error: null }, ACTIVE] });
		await addStoreDomain(deps, 'app_lumen', 'shop.lumenhome.com');
		await checkStoreDomain(deps, 'app_lumen');
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		advance(CONNECTED_DOMAIN_CHECK_HOURS * 60 * 60 * 1000 + 1);
		expect(await sweepStoreDomains(deps)).toEqual({ checked: 2, connected: 1, failed: 0, warned: 1 });
		expect(dueCutoffs).toEqual([new Date(1_800_000_000_001)]);
		expect(rows.get('shop.northwindtea.com')?.status).toBe('active');
		expect(rows.get('shop.lumenhome.com')).toMatchObject({ status: 'active', lastError: expect.stringContaining('Your store still answers on it') });
		expect(warned).toEqual(['shop.lumenhome.com']);
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

describe('a deleted store', () => {
	it("lets its domain go at the provider, and a provider that can't answer leaves it to be replaced later", async () => {
		const { deps, rows, removedAtProvider } = world();
		await addStoreDomain(deps, 'app_tea', 'shop.northwindtea.com');
		const domain = rows.get('shop.northwindtea.com')!;
		await releaseDeletedStoreDomain(deps.provider, domain);
		expect(removedAtProvider).toEqual(['shop.northwindtea.com']);
		await expect(releaseDeletedStoreDomain(world({ removeFails: true }).deps.provider, domain)).resolves.toBeUndefined();
		await expect(releaseDeletedStoreDomain(null, domain)).resolves.toBeUndefined();
	});
});
