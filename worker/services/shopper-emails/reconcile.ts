/**
 * Refund and catalog shipment emails, built from what the order's records say happened rather than from the event
 * that raised them. An email a crash kept from being queued is still sent, by the order's next event or the sweep.
 */

import type { ShopperEmailService } from '../../database/services/ShopperEmailService';
import { createLogger } from '../../logger';
import type { ShopperEmailEvent } from './outbox';

export interface ReconcileDeps {
	emails: Pick<ShopperEmailService, 'refundsToEmail' | 'catalogShipmentsToEmail' | 'ordersWithRefundsToEmail' | 'ordersWithShipmentsToEmail'>;
	/** Queues an event's email once and sends it; never throws. */
	queue(event: ShopperEmailEvent): Promise<void>;
	now(): Date;
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** A refund this recent may still be emailing from the request that made it, so the sweep leaves it alone. */
const REFUND_SETTLE_MS = 10 * MINUTE;
const SWEEP_LOOKBACK_MS = 7 * DAY;
const SWEEP_ORDERS = 50;

const logger = createLogger('ShopperEmailReconcile');

/** One email naming every refunded line no refund email has named yet. Its lines key it, so racing callers send one. Never throws. */
export async function emailNewRefunds(deps: ReconcileDeps, orderId: string): Promise<void> {
	try {
		const lines = await deps.emails.refundsToEmail(orderId);
		if (lines.length === 0) return;
		const lineNos = lines.map((line) => line.lineNo);
		const amountCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
		await deps.queue({ orderId, kind: 'refund_issued', eventKey: `lines:${lineNos.join(',')}`, payload: { lineNos, amountCents } });
	} catch (error) {
		logger.error('Could not check the refund emails an order owes', { orderId, error });
	}
}

/** One email per catalog shipment with tracking that no shipped email covers yet. Never throws. */
export async function emailNewCatalogShipments(deps: ReconcileDeps, orderId: string): Promise<void> {
	try {
		for (const shipment of await deps.emails.catalogShipmentsToEmail(orderId)) {
			await deps.queue({
				orderId,
				kind: 'order_shipped',
				eventKey: `catalog:${shipment.supplierOrderId}`,
				payload: { catalogVariantIds: shipment.catalogVariantIds, carrier: shipment.carrier, trackingNumber: shipment.trackingNumber },
			});
		}
	} catch (error) {
		logger.error('Could not check the shipped emails an order owes', { orderId, error });
	}
}

/** Every 15 minutes: the refund and shipment emails of the last week that no event queued. Returns the orders it checked. */
export async function sweepMissedShopperEmails(deps: ReconcileDeps): Promise<number> {
	const now = deps.now().getTime();
	const since = new Date(now - SWEEP_LOOKBACK_MS);
	const [refunded, shipped] = await Promise.all([
		deps.emails.ordersWithRefundsToEmail(since, new Date(now - REFUND_SETTLE_MS), SWEEP_ORDERS),
		deps.emails.ordersWithShipmentsToEmail(since, SWEEP_ORDERS),
	]);
	const orders = [...new Set([...refunded, ...shipped])];
	for (const orderId of orders) {
		await emailNewCatalogShipments(deps, orderId);
		await emailNewRefunds(deps, orderId);
	}
	return orders.length;
}
