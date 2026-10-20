import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/handlers/store-platform.ts'], { query: '?raw', import: 'default', eager: true });
const platform = sources['/worker/api/handlers/store-platform.ts'] ?? '';

describe('real payments on live stores', () => {
	it('need LIVE_STORE_PAYMENTS on and the pause flag off, checked for the seller', () => {
		expect(platform).toContain("env.LIVE_STORE_PAYMENTS === 'on' && !(await isFlagOn(env, 'live-store-payments-paused', sellerUserId))");
		expect(platform).toContain('livePayments: await livePaymentsOn(env, sellerIdOf(target))');
	});

	it('are checked the same way for the store info, the pay page and checkout itself', () => {
		expect(platform.match(/livePayments: await livePaymentsOn\(env, sellerIdOf\(target\)\)/g)).toHaveLength(2);
		expect(platform.match(/livePayments:/g)).toHaveLength(2);
	});

	it("lock catalog prices for the store's seller", () => {
		expect(platform).toContain('lockCatalogPricesFor(env, ids, country, sellerIdOf(target))');
	});
});
