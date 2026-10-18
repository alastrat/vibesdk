/** A seller's shipment as the API takes it: a known carrier or a typed one, and an optional tracking number. Pure. */

import { SELLER_CARRIER_NAMES, SELLER_CARRIERS, type SellerCarrier } from '../../../../shared/types/store-payments';
import { hasControlCharacter } from '../../../services/store-payments/request';

export type ParsedShipment = { shipped: true; carrier: string | null; trackingNumber: string | null } | { shipped: false };

const TRACKING = /^[A-Za-z0-9 -]{1,64}$/;
const CARRIER_NAME_MAX = 40;

function isCarrier(value: unknown): value is SellerCarrier {
	return typeof value === 'string' && (SELLER_CARRIERS as readonly string[]).includes(value);
}

export function parseSellerShipmentRequest(body: unknown): ParsedShipment | null {
	if (!body || typeof body !== 'object') return null;
	const { shipped, carrier, carrierName, trackingNumber } = body as Record<string, unknown>;
	if (shipped === false) return { shipped: false };
	if (shipped !== true) return null;
	if (carrier !== null && carrier !== undefined && !isCarrier(carrier)) return null;
	let carrierText: string | null = null;
	if (carrier === 'other') {
		const name = typeof carrierName === 'string' ? carrierName.trim() : '';
		if (!name || name.length > CARRIER_NAME_MAX || hasControlCharacter(name)) return null;
		carrierText = name;
	} else if (isCarrier(carrier)) {
		carrierText = SELLER_CARRIER_NAMES[carrier];
	}
	if (trackingNumber !== undefined && trackingNumber !== null && typeof trackingNumber !== 'string') return null;
	const tracking = typeof trackingNumber === 'string' ? trackingNumber.trim() : '';
	if (tracking && !TRACKING.test(tracking)) return null;
	return { shipped: true, carrier: carrierText, trackingNumber: tracking || null };
}
