import { describe, expect, it } from 'vitest';
import { runCatalogHealth, type CatalogHealthDeps } from './health';
import type { PlatformAlert } from '../alerts/platform-alerts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function fakeDeps(overrides: Partial<CatalogHealthDeps> = {}) {
	const alerts: PlatformAlert[] = [];
	const asked: Array<{ status: string; before: number; since: number }> = [];
	const deps: CatalogHealthDeps = {
		refreshHealth: async () => ({ activeProducts: 6, lastRefreshAt: new Date(NOW - 2 * 60 * 60 * 1000) }),
		lateItems: async (status, before, since) => {
			asked.push({ status, before: before.getTime(), since: since.getTime() });
			return [];
		},
		alert: async (alert) => void alerts.push(alert),
		unpaidCharges: async () => [],
		...overrides,
	};
	return { deps, alerts, asked };
}

describe('runCatalogHealth', () => {
	it('raises nothing for a healthy catalog, and looks back 5 days for shipping and 30 for delivery, for 30 days each', async () => {
		const { deps, alerts, asked } = fakeDeps();
		expect(await runCatalogHealth(deps, NOW)).toBe(0);
		expect(alerts).toEqual([]);
		// An item stays on the daily alert for 30 days after it becomes late, then it stops repeating.
		expect(asked).toEqual([
			{ status: 'placed', before: NOW - 5 * DAY, since: NOW - 35 * DAY },
			{ status: 'shipped', before: NOW - 30 * DAY, since: NOW - 60 * DAY },
		]);
	});

	it('alerts when no product refreshed in 24 hours, or never', async () => {
		for (const lastRefreshAt of [new Date(NOW - DAY - 1), null]) {
			const { deps, alerts } = fakeDeps({ refreshHealth: async () => ({ activeProducts: 6, lastRefreshAt }) });
			await runCatalogHealth(deps, NOW);
			expect(alerts.map((alert) => [alert.kind, alert.subject])).toEqual([['refresh-stalled', 'catalog']]);
		}
	});

	it('stays quiet about refreshes while the catalog has no active products', async () => {
		const { deps, alerts } = fakeDeps({ refreshHealth: async () => ({ activeProducts: 0, lastRefreshAt: null }) });
		await runCatalogHealth(deps, NOW);
		expect(alerts).toEqual([]);
	});

	it('alerts once per late order, for shipping and for delivery', async () => {
		const { deps, alerts } = fakeDeps({ lateItems: async (status) => (status === 'placed' ? ['co_1', 'co_2'] : ['co_3']) });
		expect(await runCatalogHealth(deps, NOW)).toBe(3);
		expect(alerts.map((alert) => [alert.kind, alert.subject])).toEqual([
			['not-shipped', 'co_1'],
			['not-shipped', 'co_2'],
			['not-delivered', 'co_3'],
		]);
	});

	it('alerts once per seller whose charges are unpaid after 60 days', async () => {
		const asked: number[] = [];
		const { deps, alerts } = fakeDeps({
			unpaidCharges: async (before) => {
				asked.push(before.getTime());
				return [{ sellerUserId: 'u1', owedCents: 1500 }];
			},
		});
		await runCatalogHealth(deps, NOW);
		expect(asked).toEqual([NOW - 60 * DAY]);
		expect(alerts.filter((alert) => alert.kind === 'seller-charge-unpaid').map((alert) => [alert.subject, alert.message])).toEqual([['u1', 'The seller has owed $15.00 for more than 60 days.']]);
	});
});
