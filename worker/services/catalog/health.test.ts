import { describe, expect, it } from 'vitest';
import { runCatalogHealth, type CatalogHealthDeps } from './health';
import type { PlatformAlert } from '../alerts/platform-alerts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function fakeDeps(overrides: Partial<CatalogHealthDeps> = {}) {
	const alerts: PlatformAlert[] = [];
	const asked: Array<{ status: string; before: number }> = [];
	const deps: CatalogHealthDeps = {
		refreshHealth: async () => ({ activeProducts: 6, lastRefreshAt: new Date(NOW - 2 * 60 * 60 * 1000) }),
		lateItems: async (status, before) => {
			asked.push({ status, before: before.getTime() });
			return [];
		},
		alert: async (alert) => void alerts.push(alert),
		...overrides,
	};
	return { deps, alerts, asked };
}

describe('runCatalogHealth', () => {
	it('raises nothing for a healthy catalog, and looks back 5 days for shipping and 30 for delivery', async () => {
		const { deps, alerts, asked } = fakeDeps();
		expect(await runCatalogHealth(deps, NOW)).toBe(0);
		expect(alerts).toEqual([]);
		expect(asked).toEqual([
			{ status: 'placed', before: NOW - 5 * DAY },
			{ status: 'shipped', before: NOW - 30 * DAY },
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
});
