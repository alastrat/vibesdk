/** D1 and Stripe wiring for recording store orders, shared by the webhook and the return page. */

import { CatalogOrderService, SellerChargeService, StoreCheckoutService, StoreDisputeService, StoreOrderService, StoreRefundService } from '../../database';
import { generateId } from '../../utils/idGenerator';
import { recordPaidCatalogOrder } from '../catalog/record';
import { catalogRefundRecords } from '../catalog/refund-records';
import { catalogRefundSellerCents, refundCatalogItems, type RefundItemsDeps } from '../catalog/refund-items';
import { CATALOG_SWEEP_CRON, restartCatalogPlacement, scheduleCatalogPlacement } from '../catalog/scheduler';
import { stripeFromEnv } from '../payments/config';
import type { StripeClient } from '../payments/stripe-client';
import { recordStoreOrder, type RecordStoreOrderDeps, type RecordStoreOrderResult } from './fulfill';
import { newOrderNotifierFromEnv } from './order-emails';
import { settleSale, sweepUnsettledSales } from './settle';
import type { DisputeDeps } from './disputes';
import type { RefundLinesDeps } from './refund-lines';
import type { StoreOrderView } from './store';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';
import { createLogger } from '../../logger';
import { STORE_ORDER_KIND } from '../../../shared/types/store-payments';
import { syncSellerLevelFromEnv } from '../payments/seller-level-sync';

const logger = createLogger('StorePaymentsWiring');

export function recordStoreOrderDeps(env: Env): RecordStoreOrderDeps {
	const checkouts = new StoreCheckoutService(env);
	const orders = new StoreOrderService(env);
	return {
		getCheckout: (checkoutId) => checkouts.get(checkoutId),
		recordOrder: (order) => orders.recordOrder(order),
		notifyNewOrder: newOrderNotifierFromEnv(env),
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
			await syncSellerLevelFromEnv(env, order.sellerUserId);
		},
		now: () => new Date(),
	};
}

/** The shopper's return page records the order too, but the webhook always follows and settles the sale, so here a settling failure is only logged. */
export function returnPageRecordDeps(env: Env): RecordStoreOrderDeps {
	const deps = recordStoreOrderDeps(env);
	return {
		...deps,
		settleSale: async (orderId) => {
			try {
				await deps.settleSale(orderId);
			} catch (error) {
				logger.warn('Store sale not settled on the return page; the webhook settles it', { orderId, error });
			}
		},
	};
}

/** Scheduled store payments work: hourly, the sales no transfer event settled. */
export async function runStorePaymentsSchedule(cron: string, env: Env): Promise<void> {
	if (cron !== CATALOG_SWEEP_CRON) return;
	try {
		const result = await sweepUnsettledSales(
			{ unsettledOrderIds: (after, before) => new StoreOrderService(env).unsettledOrderIds(after, before), settleSale: recordStoreOrderDeps(env).settleSale },
			Date.now(),
		);
		if (result.settled + result.failed > 0) logger.warn('Settled store sales that no transfer event settled', result);
	} catch (error) {
		logger.error('Store sale settle sweep failed', { error });
	}
}

/** Settles a store sale when Stripe adds the seller's transfer to its charge. */
export function settleOnTransferDeps(env: Env): { orderIdForPaymentIntent(paymentIntentId: string): Promise<string | null>; settleSale(orderId: string): Promise<void> } {
	return {
		orderIdForPaymentIntent: async (paymentIntentId) => (await new StoreOrderService(env).findByPaymentIntent(paymentIntentId))?.id ?? null,
		settleSale: recordStoreOrderDeps(env).settleSale,
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
		recordMissingOrder: async (paymentIntentId) => {
			// Stripe can send a dispute before the checkout's own event; the payment says which store checkout it paid.
			const metadata = (await stripe.retrievePaymentIntent(paymentIntentId)).metadata;
			if (metadata?.kind !== STORE_ORDER_KIND || !metadata.checkoutId) return;
			const sessionId = await new StoreCheckoutService(env).sessionIdOf(metadata.checkoutId);
			if (sessionId) await recordStoreSession(env, sessionId);
		},
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
		catalogTracking: async (checkoutSessionId) => {
			const items = (await new CatalogOrderService(env).progressForSessions([checkoutSessionId])).get(checkoutSessionId) ?? [];
			return items.flatMap((item) => (item.trackingNumber ? [{ carrier: item.carrier, trackingNumber: item.trackingNumber }] : []));
		},
		setOrderStatus: async (status) => {
			if (orderId) await orders.setPaymentStatus(orderId, status, new Date());
		},
		recomputeOrderStatus: async () => {
			if (!orderId) return;
			await orders.setPaymentStatus(orderId, 'paid', new Date());
			await orders.applyRefunds(orderId, new Date());
		},
		alert: platformAlertsFromEnv(env),
		// A lost dispute can take a seller down a level.
		recheckSellerLevel: (sellerUserId) => syncSellerLevelFromEnv(env, sellerUserId),
		now: () => new Date(),
	};
}

/** A seller's refund of store order lines: D1 and Stripe wiring, with catalog lines handed to the catalog refund. */
export function storeRefundDeps(env: Env, stripe: StripeClient, input: { order: StoreOrderView; sellerAccountId: string; requestId: string }): RefundLinesDeps {
	const { order } = input;
	const orders = new StoreOrderService(env);
	const refunds = new StoreRefundService(env);
	const catalog = new CatalogOrderService(env);
	const sellerBalance = () => stripe.retrieveBalance(input.sellerAccountId);
	const catalogDeps: RefundItemsDeps = { store: catalog, stripe, sellerBalance, ...catalogRefundRecords(env, input.requestId) };
	/** The catalog order's items sold on these lines. A paid order's catalog lines always have one, so a missing one is a fault. */
	const catalogItems = async (lineNos: readonly number[]): Promise<{ orderId: string; itemIds: string[] }> => {
		const catalogOrder = order.stripeCheckoutSessionId ? await catalog.getOrderBySession(order.stripeCheckoutSessionId) : null;
		if (!catalogOrder) throw new Error(`Store order ${order.id} has catalog lines but no catalog order`);
		const variants = new Set(order.items.filter((item) => lineNos.includes(item.lineNo)).map((item) => item.catalogVariantId));
		return { orderId: catalogOrder.id, itemIds: catalogOrder.items.filter((item) => variants.has(item.catalogVariantId)).map((item) => item.id) };
	};
	const now = () => new Date();
	return {
		stripe,
		sellerBalance,
		refundRows: (orderId) => refunds.refundRows(orderId),
		catalogSellerCents: async (lineNos) => catalogRefundSellerCents(catalogDeps, { ...(await catalogItems(lineNos)), reason: 'seller-refund' }),
		refundCatalogLines: async (lineNos) => {
			const items = await catalogItems(lineNos);
			const totals = await refundCatalogItems(catalogDeps, { ...items, reason: 'seller-refund', balanceChecked: true });
			return { refundedCents: totals.shopperCents };
		},
		claimRefund: (claim) => refunds.claimRefund(claim),
		completeRefund: (done) => refunds.completeRefund(done),
		completeReversal: (done) => refunds.completeReversal(done),
		addShortfall: async (shortfall) => {
			await new SellerChargeService(env).add({ sellerUserId: order.sellerUserId, kind: 'refund-shortfall', sourceId: `refund-${shortfall.orderId}-${shortfall.lineNo}`, amountCents: shortfall.amountCents, now: now() });
		},
		applyRefunds: (orderId) => orders.applyRefunds(orderId, now()),
		now,
	};
}
