import { t, tn, msg } from '@/lib/i18n';
import { SELLER_CARRIER_NAMES, type CatalogItemStatus, type SellerCarrier, type SellerOrderDetail, type SellerOrderRow, type StorePaymentStatus } from '@/api-types';

export const PAYMENT_LABELS: Readonly<Record<StorePaymentStatus, string>> = {
	paid: msg('Paid'),
	partially_refunded: msg("Partly refunded"),
	refunded: msg('Refunded'),
	disputed: msg('Disputed'),
	dispute_lost: msg("Dispute lost"),
};

export const CATALOG_PROGRESS_LABELS: Readonly<Record<CatalogItemStatus, string>> = {
	pending: msg('Preparing'),
	placed: msg('Preparing'),
	shipped: msg('Shipped'),
	delivered: msg('Delivered'),
	rejected: msg('Refunded'),
	refunded: msg('Refunded'),
	withheld: msg("On hold"),
};

type Counts = Pick<SellerOrderRow, 'units' | 'ownUnits' | 'catalogUnits' | 'fulfillmentStatus' | 'paymentStatus'>;

/** "To ship · Estori ships 1": the seller's part, then Estori's. */
export function shippingStatus(row: Counts): string {
	const parts = [...(row.ownUnits > 0 ? [row.fulfillmentStatus === 'fulfilled' ? t('Shipped') : t("To ship")] : []), ...(row.catalogUnits > 0 ? [t("Estori ships {value1}", { value1: row.catalogUnits })] : [])];
	return parts.length > 0 ? parts.join(' · ') : t("Nothing to ship");
}

export function itemsSummary(row: Counts): string {
	const items = tn('{count} item', '{count} items', row.units);
	const payable = row.paymentStatus === 'paid' || row.paymentStatus === 'partially_refunded';
	return row.ownUnits > 0 && row.fulfillmentStatus === 'unfulfilled' && payable ? t('{items}, {count} to ship', { items, count: row.ownUnits }) : items;
}

export function moneySplit(order: Pick<SellerOrderDetail, 'totalCents' | 'applicationFeeCents' | 'refundedCents'>) {
	return {
		paidCents: order.totalCents,
		feeCents: order.applicationFeeCents,
		refundedCents: order.refundedCents,
		shareCents: order.totalCents - order.applicationFeeCents - order.refundedCents,
	};
}

export function storeLabel(title: string | null): string {
	return title?.trim() || t("Deleted store");
}

export function customerLabel(name: string | null, email: string | null): string {
	return name?.trim() || email?.trim() || t("Unknown shopper");
}

export function shipToLines(shipTo: SellerOrderDetail['shipTo']): string[] {
	if (!shipTo) return [t("No shipping address on this order")];
	const cityLine = [shipTo.city, [shipTo.region, shipTo.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return [shipTo.name, shipTo.line1, ...(shipTo.line2 ? [shipTo.line2] : []), cityLine, shipTo.countryCode].filter(Boolean);
}

/** The shipment form's carrier for a saved carrier name: a named carrier, or Other with the name typed. */
export function carrierChoice(saved: string | null): { carrier: SellerCarrier | ''; carrierName: string } {
	if (!saved) return { carrier: '', carrierName: '' };
	const named = (Object.entries(SELLER_CARRIER_NAMES) as Array<[Exclude<SellerCarrier, 'other'>, string]>).find(([, name]) => name === saved);
	return named ? { carrier: named[0], carrierName: '' } : { carrier: 'other', carrierName: saved };
}
