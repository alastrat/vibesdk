/**
 * Records a paid store Checkout session as one store order and hands its catalog lines to placement. The webhook and the
 * return page both call it with the session as Stripe's API returns it.
 */

import { STORE_ORDER_KIND } from '../../../shared/types/store-payments';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { ShippingAddress } from '../catalog/supplier';
import type { StripeCheckoutSession } from '../payments/stripe-client';
import { toCheckoutCart } from './pricing';
import type { NewStoreOrder, StoreCheckoutRecord } from './store';

export interface RecordStoreOrderDeps {
	getCheckout(checkoutId: string): Promise<StoreCheckoutRecord | null>;
	recordOrder(order: NewStoreOrder): Promise<'recorded' | 'already-recorded'>;
	/** Idempotent per Checkout session, so a redelivery after a crash still hands the lines over. */
	handOffCatalogLines(paid: PaidCatalogCheckout): Promise<void>;
	now(): Date;
}

export type RecordStoreOrderResult =
	| { result: 'recorded' | 'already-recorded'; orderId: string; checkout: StoreCheckoutRecord }
	| { result: 'not-paid'; checkout: StoreCheckoutRecord }
	| { result: 'not-ours' };

/** The order id derives from the checkout id, so every retry writes the same order. */
export function storeOrderIdFor(checkoutId: string): string {
	return `ord_${checkoutId.replace(/^chk_/, '')}`;
}

export function shippingAddressOf(session: StripeCheckoutSession): ShippingAddress | null {
	const details = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
	const address = details?.address;
	if (!address?.line1 || !address.city || !address.postal_code || !address.country) return null;
	return {
		name: details?.name ?? session.customer_details?.name ?? '',
		line1: address.line1,
		line2: address.line2 || null,
		city: address.city,
		region: address.state || null,
		postalCode: address.postal_code,
		countryCode: address.country,
		phone: session.customer_details?.phone ?? null,
		email: session.customer_details?.email ?? null,
	};
}

export async function recordStoreOrder(deps: RecordStoreOrderDeps, session: StripeCheckoutSession): Promise<RecordStoreOrderResult> {
	const metadata = session.metadata ?? {};
	if (metadata.kind !== STORE_ORDER_KIND || !metadata.checkoutId) return { result: 'not-ours' };
	const checkout = await deps.getCheckout(metadata.checkoutId);
	if (!checkout) return { result: 'not-ours' };
	if (session.payment_status !== 'paid') return { result: 'not-paid', checkout };

	const address = shippingAddressOf(session);
	// Sessions Estori created can't differ from their checkout. If one does, money was taken, so it is recorded and flagged.
	const problems = [
		session.amount_total !== checkout.totalCents && `paid ${session.amount_total} cents, expected ${checkout.totalCents}`,
		(session.currency ?? '').toLowerCase() !== 'usd' && `paid in ${session.currency}`,
		metadata.storeAppId !== checkout.appId && 'paid for another store',
		address?.countryCode !== checkout.shipToCountry && `ships to ${address?.countryCode ?? 'no address'}, expected ${checkout.shipToCountry}`,
	].filter((problem): problem is string => typeof problem === 'string');

	const orderId = storeOrderIdFor(checkout.id);
	const result = await deps.recordOrder({
		id: orderId,
		checkoutId: checkout.id,
		mode: checkout.mode,
		appId: checkout.appId,
		sellerUserId: checkout.sellerUserId,
		sellerStripeAccountId: checkout.sellerStripeAccountId,
		storeVersionId: checkout.storeVersionId,
		stripeCheckoutSessionId: session.id,
		stripePaymentIntentId: session.payment_intent,
		subtotalCents: checkout.subtotalCents,
		shippingCents: checkout.shippingCents,
		totalCents: checkout.totalCents,
		applicationFeeCents: checkout.applicationFeeCents,
		customerEmail: session.customer_details?.email ?? null,
		customerName: session.customer_details?.name ?? address?.name ?? null,
		shippingAddress: address,
		note: checkout.note,
		needsAttention: problems.length > 0 ? problems.join('; ') : null,
		items: checkout.pricedCart.lines.map((line, index) => ({
			lineNo: index + 1,
			kind: line.kind,
			productId: line.productId,
			variantId: line.variantId,
			name: line.name,
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			catalogVariantId: line.kind === 'catalog' ? line.catalogVariantId : null,
			lockedCatalogPriceCents: line.kind === 'catalog' ? line.lockedCatalogPriceCents : null,
		})),
		createdAt: deps.now(),
	});

	// A flagged order waits for the owner instead of buying from the supplier.
	const hasCatalogLines = checkout.pricedCart.lines.some((line) => line.kind === 'catalog');
	if (hasCatalogLines && problems.length === 0 && address && session.payment_intent) {
		await deps.handOffCatalogLines({
			checkoutSessionId: session.id,
			paymentIntentId: session.payment_intent,
			sellerUserId: checkout.sellerUserId,
			storeAppId: checkout.appId,
			cart: toCheckoutCart(checkout.pricedCart),
			shippingAddress: address,
		});
	}
	return { result, orderId, checkout };
}
