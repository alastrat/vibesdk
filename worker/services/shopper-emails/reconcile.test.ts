import { describe, expect, it } from 'vitest';
import { emailNewCatalogShipments, emailNewRefunds, sweepMissedShopperEmails, type ReconcileDeps } from './reconcile';
import type { ShopperEmailEvent } from './outbox';

const NOW = new Date('2026-10-18T12:00:00Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

function world(input: { refunds?: Array<{ lineNo: number; amountCents: number }>; shipments?: Array<{ supplierOrderId: string; carrier: string | null; trackingNumber: string; catalogVariantIds: string[] }>; failing?: boolean } = {}) {
	const queued: ShopperEmailEvent[] = [];
	const asked: string[] = [];
	const deps: ReconcileDeps = {
		emails: {
			refundsToEmail: async () => {
				if (input.failing) throw new Error('D1_ERROR: database is locked');
				return input.refunds ?? [];
			},
			catalogShipmentsToEmail: async () => input.shipments ?? [],
			ordersWithRefundsToEmail: async (since, before, limit) => {
				asked.push(`refunds ${since.toISOString()} ${before.toISOString()} ${limit}`);
				return ['ord_1'];
			},
			ordersWithShipmentsToEmail: async (since, limit) => {
				asked.push(`shipments ${since.toISOString()} ${limit}`);
				return ['ord_1', 'ord_2'];
			},
		},
		queue: async (event) => void queued.push(event),
		now: () => NOW,
	};
	return { deps, queued, asked };
}

describe('shopper emails from the order records', () => {
	it('names every refunded line no email named yet in one email, keyed by its lines, with their total', async () => {
		const { deps, queued } = world({ refunds: [{ lineNo: 1, amountCents: 1500 }, { lineNo: 2, amountCents: 1000 }] });
		await emailNewRefunds(deps, 'ord_1');
		expect(queued).toEqual([{ orderId: 'ord_1', kind: 'refund_issued', eventKey: 'lines:1,2', payload: { lineNos: [1, 2], amountCents: 2500 } }]);
	});

	it('sends nothing when every refund was already emailed, and never throws', async () => {
		const done = world();
		await emailNewRefunds(done.deps, 'ord_1');
		expect(done.queued).toEqual([]);
		const failing = world({ failing: true });
		await expect(emailNewRefunds(failing.deps, 'ord_1')).resolves.toBeUndefined();
	});

	it('sends one shipped email per supplier shipment, keyed by it, with its items and tracking', async () => {
		const { deps, queued } = world({
			shipments: [
				{ supplierOrderId: 'SD1', carrier: 'USPS', trackingNumber: 'T1', catalogVariantIds: ['cv_lamp', 'cv_mug'] },
				{ supplierOrderId: 'SD3', carrier: null, trackingNumber: 'T3', catalogVariantIds: ['cv_hat'] },
			],
		});
		await emailNewCatalogShipments(deps, 'ord_1');
		expect(queued).toEqual([
			{ orderId: 'ord_1', kind: 'order_shipped', eventKey: 'catalog:SD1', payload: { catalogVariantIds: ['cv_lamp', 'cv_mug'], carrier: 'USPS', trackingNumber: 'T1' } },
			{ orderId: 'ord_1', kind: 'order_shipped', eventKey: 'catalog:SD3', payload: { catalogVariantIds: ['cv_hat'], carrier: null, trackingNumber: 'T3' } },
		]);
	});

	it('sweeps the last week for refunds settled 10 minutes ago and shipments no email covered, checking each order once', async () => {
		const { deps, queued, asked } = world({ refunds: [{ lineNo: 2, amountCents: 1000 }] });
		expect(await sweepMissedShopperEmails(deps)).toBe(2);
		expect(asked).toEqual([`refunds ${new Date(NOW.getTime() - 7 * DAY).toISOString()} ${new Date(NOW.getTime() - 10 * MINUTE).toISOString()} 50`, `shipments ${new Date(NOW.getTime() - 7 * DAY).toISOString()} 50`]);
		expect(queued.map((event) => `${event.orderId} ${event.eventKey}`)).toEqual(['ord_1 lines:2', 'ord_2 lines:2']);
	});
});
