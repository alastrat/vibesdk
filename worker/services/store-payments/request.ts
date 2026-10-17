/** What a store may send to start a checkout: variant ids, quantities, a ship-to country, return paths and a note. Pure. */

import { STORE_CART_MAX_LINES, type StoreCheckoutRequest } from '../../../shared/types/store-payments';

const REQUEST_KEYS = ['items', 'shipTo', 'successPath', 'cancelPath', 'note', 'replaces'];
const CHECKOUT_ID = /^chk_[a-z0-9_]{1,64}$/;
const ITEM_KEYS = ['variantId', 'quantity'];
const MAX_PATH = 200;
const MAX_NOTE = 500;
const MAX_VARIANT_ID = 64;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const RESOLVE_BASE = 'https://store.invalid';

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}

/**
 * A path on the store, or the fallback: never `//host`, a scheme, a backslash or a control character. It comes back
 * normalized (dot segments resolved, no fragment, non-ASCII percent-encoded), so it is always a valid redirect.
 */
export function safeReturnPath(value: unknown, fallback: string): string {
	if (typeof value !== 'string' || value.length > MAX_PATH) return fallback;
	if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || CONTROL_CHARACTER.test(value)) return fallback;
	const url = new URL(value, RESOLVE_BASE);
	return url.origin === RESOLVE_BASE ? `${url.pathname}${url.search}` : fallback;
}

/** Null for any other shape, including one carrying an amount, price, fee or account: Estori derives those itself. */
export function parseCheckoutRequest(body: unknown): StoreCheckoutRequest | null {
	if (!isObject(body) || !hasOnly(body, REQUEST_KEYS)) return null;
	const { items, shipTo, successPath, cancelPath, note, replaces } = body;
	if (!Array.isArray(items) || items.length === 0 || items.length > STORE_CART_MAX_LINES) return null;
	const parsedItems: StoreCheckoutRequest['items'] = [];
	for (const item of items) {
		if (!isObject(item) || !hasOnly(item, ITEM_KEYS)) return null;
		const { variantId, quantity } = item;
		if (typeof variantId !== 'string' || variantId.length === 0 || variantId.length > MAX_VARIANT_ID) return null;
		if (typeof quantity !== 'number') return null;
		parsedItems.push({ variantId, quantity });
	}
	if (typeof shipTo !== 'string' || !/^[A-Za-z]{2}$/.test(shipTo)) return null;
	if (successPath !== undefined && typeof successPath !== 'string') return null;
	if (cancelPath !== undefined && typeof cancelPath !== 'string') return null;
	if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) return null;
	if (replaces !== undefined && (typeof replaces !== 'string' || !CHECKOUT_ID.test(replaces))) return null;
	return {
		items: parsedItems,
		shipTo: shipTo.toUpperCase(),
		...(successPath !== undefined && { successPath }),
		...(cancelPath !== undefined && { cancelPath }),
		...(note !== undefined && { note }),
		...(replaces !== undefined && { replaces }),
	};
}
