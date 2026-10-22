/** A week's notice before limits apply: once per account, with a line for accounts already over Basic. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { BillingService } from '../../database/services/BillingService';
import { enforcementDepsFromEnv, enforcementStartsOn, sellsCatalogProducts, sendEnforcementNotices, type EnforcementDeps } from './enforcement-notice';

let db: D1Database;
const STARTS = Date.parse('2026-11-01T00:00:00Z');
const NOW = Date.parse('2026-10-25T10:05:00Z');
const CATALOG = JSON.stringify({ products: [{ id: 'lamp', name: 'Lamp', variants: [{ id: 'v', name: 'Black', priceCents: 3500, catalogVariantId: '5e0c1d64-8f1e-4a7b-9b55-2f7f6c1d9a10' }] }] });

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_small', 'u_big', 'u_catalog']) await insertUser(db, id, { emailVerified: true });
	// Accounts that can't be emailed: each is skipped for a different reason.
	await insertUser(db, 'u_unverified');
	for (const [id, column] of [['u_suspended', 'is_suspended = 1'], ['u_inactive', 'is_active = 0'], ['u_deleted', 'deleted_at = 1790000000']] as const) {
		await insertUser(db, id, { emailVerified: true });
		await db.prepare(`UPDATE users SET ${column} WHERE id = ?`).bind(id).run();
	}
	for (const [id, userId] of [['app_s', 'u_small'], ['app_b1', 'u_big'], ['app_b2', 'u_big'], ['app_b3', 'u_big'], ['app_c', 'u_catalog']] as const) await insertApp(db, { id, userId });
	const stores = new LiveStoreService(envWith(db));
	for (const appId of ['app_s', 'app_b1', 'app_b2', 'app_b3', 'app_c']) await stores.publish({ appId, slug: appId.replace('_', '-'), commit: 'c1', now: new Date(NOW) });
	await new BillingService(envWith(db)).reserveStore('u_small', null, new Date(NOW));
});

afterEach(() => {
	vi.restoreAllMocks();
});

function env(sent: Array<{ to: string; text: string }>, options: { failManifestFor?: string; email?: boolean; sendFails?: boolean } = {}): Env {
	const namespace = {
		idFromName: (name: string) => name,
		get: (appId: string) => ({
			getStoreManifest: async () => {
				if (appId === options.failManifestFor) throw new Error('SpaceDO is unreachable');
				return { commitHash: 'c1', manifest: appId === 'app_c' ? CATALOG : null };
			},
		}),
	};
	return envWith(db, {
		ENVIRONMENT: 'prod',
		CUSTOM_DOMAIN: 'estori.app',
		SPACE_DO: namespace,
		...(options.email === false
			? {}
			: {
					EMAIL: {
						send: async (message: { to: string; text: string }) => {
							if (options.sendFails) throw new Error('Email Service unavailable');
							sent.push({ to: message.to, text: message.text });
							return { messageId: 'm1' };
						},
					},
				}),
	});
}

const OVER_LINE = 'to publish more, get Pro or Premium';

describe('the enforcement notice', () => {
	it('reads the start date, and finds catalog products in a live version', () => {
		expect(enforcementStartsOn('2026-11-01')).toBe(STARTS);
		for (const bad of [undefined, '', 'November 1', '2026-13-01', '2026-02-30']) expect(enforcementStartsOn(bad)).toBeNull();
		expect(sellsCatalogProducts(CATALOG)).toBe(true);
		expect(sellsCatalogProducts(null)).toBe(false);
		expect(sellsCatalogProducts('{')).toBe(false);
		expect(sellsCatalogProducts(JSON.stringify({ products: [{ id: 'mug', name: 'Mug', variants: [{ id: 'v', name: 'White', priceCents: 1500 }] }] }))).toBe(false);
	});

	it('tells every account once, adding a line for those over Basic, and stops when limits start', async () => {
		const sent: Array<{ to: string; text: string }> = [];
		const deps = enforcementDepsFromEnv(env(sent));
		expect(await sendEnforcementNotices(deps, STARTS, NOW)).toBe(3);
		expect(await sendEnforcementNotices(deps, STARTS, NOW + 3_600_000)).toBe(0);
		const over = (userId: string) => sent.find((email) => email.to.startsWith(userId))?.text.includes(OVER_LINE);
		expect([over('u_small'), over('u_big'), over('u_catalog')]).toEqual([false, true, true]);
		expect(await sendEnforcementNotices(deps, STARTS, STARTS)).toBe(0);
	});

	it('leaves an account whose live version could not be read for the next run, and the others still go', async () => {
		const starts = Date.parse('2026-12-01T00:00:00Z');
		const sent: Array<{ to: string; text: string }> = [];
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent, { failManifestFor: 'app_s' })), starts, NOW)).toBe(2);
		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(sent.map((email) => email.to.split('@')[0]).sort()).toEqual(['u_big', 'u_catalog']);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent)), starts, NOW + 3_600_000)).toBe(1);
		expect(sent.at(-1)?.to).toBe('u_small@example.test');
	});

	it('tells an account again on the next run when its email could not be sent', async () => {
		const starts = Date.parse('2027-02-01T00:00:00Z');
		const sent: Array<{ to: string; text: string }> = [];
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent, { sendFails: true })), starts, NOW)).toBe(0);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM billing_notices WHERE notice_key = 'enforcement_notice:2027-02-01'").first('n')).toBe(0);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent)), starts, NOW + 3_600_000)).toBe(3);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent)), starts, NOW + 7_200_000)).toBe(0);
	});

	it('skips accounts that are suspended, inactive, unverified or deleted', async () => {
		const waiting = await new BillingService(envWith(db)).accountsWithoutNotice('enforcement_notice:2099-01-01', 100);
		expect(waiting).toEqual(['u_big', 'u_catalog', 'u_small']);
	});

	it('claims nothing while no email can go out, so a later run with a sender still tells everyone', async () => {
		const starts = Date.parse('2027-01-01T00:00:00Z');
		const sent: Array<{ to: string; text: string }> = [];
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent, { email: false })), starts, NOW)).toBe(0);
		expect(await db.prepare("SELECT COUNT(*) AS n FROM billing_notices WHERE notice_key = 'enforcement_notice:2027-01-01'").first('n')).toBe(0);
		expect(await sendEnforcementNotices(enforcementDepsFromEnv(env(sent)), starts, NOW)).toBe(3);
	});
});

describe('who is over Basic', () => {
	function depsFor(account: { live: number; started: number; catalog?: boolean }): { deps: EnforcementDeps; sent: boolean[] } {
		const sent: boolean[] = [];
		const live = Array.from({ length: account.live }, (_, index) => `app_${index}`);
		const deps: EnforcementDeps = {
			accounts: async () => ['u_one'],
			liveStores: async () => live,
			storesStarted: async () => account.started,
			liveManifest: async (appId) => (account.catalog && appId === live[0] ? CATALOG : null),
			mail: {
				sender: {
					send: async (email) => {
						sent.push(email.text.includes(OVER_LINE));
						return { messageId: 'm' };
					},
				},
				userEmail: async () => 'one@example.test',
				baseUrl: null,
				claim: async () => true,
				release: async () => undefined,
			},
		};
		return { deps, sent };
	}

	it.each([
		{ account: { live: 2, started: 2 }, over: false },
		{ account: { live: 0, started: 0 }, over: false },
		{ account: { live: 3, started: 2 }, over: true },
		{ account: { live: 1, started: 4 }, over: true },
		{ account: { live: 1, started: 1, catalog: true }, over: true },
	])('answers $over for $account', async ({ account, over }) => {
		const { deps, sent } = depsFor(account);
		expect(await sendEnforcementNotices(deps, STARTS, NOW)).toBe(1);
		expect(sent).toEqual([over]);
	});
});
