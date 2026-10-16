/** D1 and Stripe wiring for recording store orders, shared by the webhook and the return page. */

import { CatalogOrderService, StoreCheckoutService, StoreOrderService } from '../../database';
import { generateId } from '../../utils/idGenerator';
import { recordPaidCatalogOrder } from '../catalog/record';
import { scheduleCatalogPlacement } from '../catalog/scheduler';
import { stripeFromEnv } from '../payments/config';
import { recordStoreOrder, type RecordStoreOrderDeps, type RecordStoreOrderResult } from './fulfill';

export function recordStoreOrderDeps(env: Env): RecordStoreOrderDeps {
	const checkouts = new StoreCheckoutService(env);
	const orders = new StoreOrderService(env);
	return {
		getCheckout: (checkoutId) => checkouts.get(checkoutId),
		recordOrder: (order) => orders.recordOrder(order),
		handOffCatalogLines: async (paid) => {
			const recorded = await recordPaidCatalogOrder({ store: new CatalogOrderService(env), newId: generateId, now: () => new Date() }, paid);
			if (recorded.result === 'recorded' && recorded.orderId) await scheduleCatalogPlacement(env, recorded.orderId);
		},
		now: () => new Date(),
	};
}

/** Records from the session as Stripe's API returns it, never from an event payload. */
export async function recordStoreSession(env: Env, sessionId: string): Promise<RecordStoreOrderResult> {
	const stripe = stripeFromEnv(env);
	if (!stripe) throw new Error('Stripe is not configured');
	return recordStoreOrder(recordStoreOrderDeps(env), await stripe.retrieveCheckoutSession(sessionId));
}
