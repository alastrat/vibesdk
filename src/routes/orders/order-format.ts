import { SELLER_CARRIER_NAMES, type CatalogItemStatus, type SellerCarrier, type SellerOrderDetail, type SellerOrderRow, type StorePaymentStatus } from '@/api-types';

export const PAYMENT_LABELS: Readonly<Record<StorePaymentStatus, string>> = {
	paid: 'Paid',
	partially_refunded: 'Partly refunded',
	refunded: 'Refunded',
	disputed: 'Disputed',
	dispute_lost: 'Dispute lost',
};

export const CATALOG_PROGRESS_LABELS: Readonly<Record<CatalogItemStatus, string>> = {
	pending: 'Preparing',
	placed: 'Preparing',
	shipped: 'Shipped',
	delivered: 'Delivered',
	rejected: 'Refunded',
	refunded: 'Refunded',
	withheld: 'On hold',
};

type Counts = Pick<SellerOrderRow, 'units' | 'ownUnits' | 'catalogUnits' | 'fulfillmentStatus' | 'paymentStatus'>;

/** "To ship · Estori ships 1": the seller's part, then Estori's. */
export function shippingStatus(row: Counts): string {
	const parts = [...(row.ownUnits > 0 ? [row.fulfillmentStatus === 'fulfilled' ? 'Shipped' : 'To ship'] : []), ...(row.catalogUnits > 0 ? [`Estori ships ${row.catalogUnits}`] : [])];
	return parts.length > 0 ? parts.join(' · ') : 'Nothing to ship';
}

export function itemsSummary(row: Counts): string {
	const items = `${row.units} item${row.units === 1 ? '' : 's'}`;
	const payable = row.paymentStatus === 'paid' || row.paymentStatus === 'partially_refunded';
	return row.ownUnits > 0 && row.fulfillmentStatus === 'unfulfilled' && payable ? `${items}, ${row.ownUnits} to ship` : items;
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
	return title?.trim() || 'Deleted store';
}

export function customerLabel(name: string | null, email: string | null): string {
	return name?.trim() || email?.trim() || 'Unknown shopper';
}

export function shipToLines(shipTo: SellerOrderDetail['shipTo']): string[] {
	if (!shipTo) return ['No shipping address on this order'];
	const cityLine = [shipTo.city, [shipTo.region, shipTo.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return [shipTo.name, shipTo.line1, ...(shipTo.line2 ? [shipTo.line2] : []), cityLine, shipTo.countryCode].filter(Boolean);
}

/** The shipment form's carrier for a saved carrier name: a named carrier, or Other with the name typed. */
export function carrierChoice(saved: string | null): { carrier: SellerCarrier | ''; carrierName: string } {
	if (!saved) return { carrier: '', carrierName: '' };
	const named = (Object.entries(SELLER_CARRIER_NAMES) as Array<[Exclude<SellerCarrier, 'other'>, string]>).find(([, name]) => name === saved);
	return named ? { carrier: named[0], carrierName: '' } : { carrier: 'other', carrierName: saved };
}
