/** The properties of store and money events, from the records the payment flows already hold. */

import { amountBand, type ServerEventProperties } from '../../../shared/types/analytics-events';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { SellerFlags } from '../payments/stripe-client';
import type { NewStoreOrder } from '../store-payments/store';

/** A seller's sales are their business data: the total goes as a band, Estori's own fee exact. */
export function saleCompletedProperties(order: NewStoreOrder, firstSale: boolean): ServerEventProperties<'sale_completed'> {
	return {
		app_id: order.appId,
		mode: order.mode,
		total_band: amountBand(order.totalCents),
		application_fee_cents: order.applicationFeeCents,
		has_catalog_items: order.items.some((item) => item.kind === 'catalog'),
		first_sale: firstSale,
	};
}

export function catalogOrderPlacedProperties(paid: PaidCatalogCheckout): ServerEventProperties<'catalog_order_placed'> {
	const units = paid.cart.lines.filter((line) => line.kind === 'catalog').reduce((total, line) => total + line.quantity, 0);
	return { app_id: paid.storeAppId, item_count: units };
}

/** Listing prices are public, so they go exact. */
export function templateSoldProperties(record: StripePurchaseRecord): ServerEventProperties<'template_sold'> {
	return { listing_id: record.listingId, price_cents: record.priceCents, platform_fee_cents: record.platformFeeCents };
}

/** Stripe's side of payments setup is done: the account can take store payments and be paid out. The selling terms are separate. */
export function stripeReady(flags: Pick<SellerFlags, 'detailsSubmitted' | 'cardPaymentsActive' | 'transfersActive' | 'payoutsEnabled'>): boolean {
	return flags.detailsSubmitted && flags.cardPaymentsActive && flags.transfersActive && flags.payoutsEnabled;
}
