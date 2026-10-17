/** A paid store checkout becomes one catalog order: its catalog lines, prices locked, the fee Estori took. */

import { applicationFeeCents, cartTotalCents, catalogTotalCents, type CatalogCartLine, type CheckoutCart } from '../../../shared/types/catalog';
import type { CatalogOrderStore } from './store';
import type { ShippingAddress } from './supplier';

export interface PaidCatalogCheckout {
	checkoutSessionId: string;
	paymentIntentId: string;
	sellerUserId: string;
	storeAppId: string;
	cart: CheckoutCart;
	shippingAddress: ShippingAddress;
}

export interface RecordDeps {
	store: CatalogOrderStore;
	newId: () => string;
	now: () => Date;
}

export type RecordResult = 'recorded' | 'already-recorded' | 'no-catalog-items';

/** Bring-your-own lines are the seller's to order, so only catalog lines become items. */
export async function recordPaidCatalogOrder(deps: RecordDeps, paid: PaidCatalogCheckout): Promise<{ result: RecordResult; orderId: string | null }> {
	const catalogLines = paid.cart.lines.filter((line): line is CatalogCartLine => line.kind === 'catalog');
	if (catalogLines.length === 0) return { result: 'no-catalog-items', orderId: null };
	const orderId = deps.newId();
	const recorded = await deps.store.insertPaidOrder({
		id: orderId,
		sellerUserId: paid.sellerUserId,
		storeAppId: paid.storeAppId,
		checkoutSessionId: paid.checkoutSessionId,
		paymentIntentId: paid.paymentIntentId,
		totalCents: cartTotalCents(paid.cart),
		catalogTotalCents: catalogTotalCents(paid.cart),
		applicationFeeCents: applicationFeeCents(paid.cart),
		destinationCountry: paid.cart.shipToCountry,
		shippingAddress: paid.shippingAddress,
		items: catalogLines.map((line) => ({
			id: deps.newId(),
			catalogVariantId: line.catalogVariantId,
			supplier: line.supplier,
			supplierVariantId: line.supplierVariantId,
			quantity: line.quantity,
			unitPriceCents: line.unitPriceCents,
			catalogPriceCents: line.lockedCatalogPriceCents,
		})),
		createdAt: deps.now(),
	});
	return recorded ? { result: 'recorded', orderId } : { result: 'already-recorded', orderId: null };
}
