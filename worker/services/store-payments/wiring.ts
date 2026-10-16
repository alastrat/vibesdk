/** D1 and Stripe wiring for recording store orders, shared by the webhook and the return page. */

import { CatalogOrderService, SellerChargeService, StoreCheckoutService, StoreDisputeService, StoreOrderService } from '../../database';
import { generateId } from '../../utils/idGenerator';
import { recordPaidCatalogOrder } from '../catalog/record';
import { restartCatalogPlacement, scheduleCatalogPlacement } from '../catalog/scheduler';
import { stripeFromEnv } from '../payments/config';
import { recordStoreOrder, type RecordStoreOrderDeps, type RecordStoreOrderResult } from './fulfill';
import { settleSale } from './settle';
import type { DisputeDeps } from './disputes';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';

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
		settleSale: async (orderId) => {
			const stripe = stripeFromEnv(env);
			const order = await orders.getOrder(orderId);
			if (!stripe || !order?.stripePaymentIntentId) return;
			const charges = new SellerChargeService(env);
			await settleSale(
				{
					stripe,
					feeAdjustment: (id) => orders.feeAdjustment(id),
					planFeeAdjustment: (plan) => orders.planFeeAdjustment(plan),
					completeFeeAdjustment: (id, reversalId) => orders.completeFeeAdjustment(id, reversalId),
					openCharges: (sellerUserId) => charges.open(sellerUserId),
					claims: (id) => charges.claims(id),
					claimCollection: (claim) => charges.claimCollection(claim),
					completeCollection: (done) => charges.completeCollection(done),
					releaseClaim: (release) => charges.releaseClaim(release),
					now: () => new Date(),
				},
				{ id: order.id, sellerUserId: order.sellerUserId, paymentIntentId: order.stripePaymentIntentId, totalCents: order.totalCents, applicationFeeCents: order.applicationFeeCents },
			);
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

/** Dispute handling's D1, Stripe and alert wiring, for one dispute event. */
export function disputeDepsFromEnv(env: Env): DisputeDeps {
	const stripe = stripeFromEnv(env);
	if (!stripe) throw new Error('Stripe is not configured');
	const orders = new StoreOrderService(env);
	const disputes = new StoreDisputeService(env);
	const charges = new SellerChargeService(env);
	let orderId: string | null = null;
	return {
		findOrder: async (paymentIntentId) => {
			const order = await orders.findByPaymentIntent(paymentIntentId);
			// Without the seller's account there is nothing to take back or return; such an order isn't a store sale.
			if (!order?.sellerStripeAccountId) return null;
			orderId = order.id;
			return { id: order.id, sellerUserId: order.sellerUserId, sellerStripeAccountId: order.sellerStripeAccountId, checkoutSessionId: order.stripeCheckoutSessionId };
		},
		stripe,
		storedDispute: (disputeId) => disputes.get(disputeId),
		saveDispute: (row) => disputes.save(row),
		addCharge: async (charge) => {
			await charges.add(charge);
		},
		setCharge: (charge) => charges.setCharge(charge),
		withholdCatalog: (checkoutSessionId) => new CatalogOrderService(env).withholdPending(checkoutSessionId),
		releaseCatalog: async (checkoutSessionId) => {
			const catalogOrderId = await new CatalogOrderService(env).releaseWithheld(checkoutSessionId);
			if (catalogOrderId) await restartCatalogPlacement(env, catalogOrderId);
		},
		withheldCatalogCents: (checkoutSessionId) => new CatalogOrderService(env).withheldCatalogCents(checkoutSessionId),
		setOrderStatus: async (status) => {
			if (orderId) await orders.setPaymentStatus(orderId, status, new Date());
		},
		recomputeOrderStatus: async () => {
			if (!orderId) return;
			await orders.setPaymentStatus(orderId, 'paid', new Date());
			await orders.applyRefunds(orderId, new Date());
		},
		alert: platformAlertsFromEnv(env),
		now: () => new Date(),
	};
}
