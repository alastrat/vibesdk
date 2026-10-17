/** The shopper's receipt cookie: a signed list of their latest orders at one store, so an order id alone reads nothing. */

import type { StoreReceipt } from '../../../shared/types/store-payments';
import { JWTUtils } from '../../utils/jwtUtils';
import type { StoreOrderView } from './store';

export const RECEIPT_COOKIE_NAME = '__estori_orders';
const RECEIPT_PURPOSE = 'store_receipts';
const RECEIPT_MAX_ORDERS = 20;
const RECEIPT_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface ReceiptClaims {
	appId: string;
	orderIds: string[];
}

export function addReceiptOrder(claims: ReceiptClaims | null, appId: string, orderId: string): ReceiptClaims {
	const previous = claims?.appId === appId ? claims.orderIds.filter((id) => id !== orderId) : [];
	return { appId, orderIds: [orderId, ...previous].slice(0, RECEIPT_MAX_ORDERS) };
}

export function receiptAllows(claims: ReceiptClaims | null, appId: string, orderId: string): boolean {
	return claims !== null && claims.appId === appId && claims.orderIds.includes(orderId);
}

export function receiptCookieHeader(token: string, path: string, secure: boolean): string {
	return `${RECEIPT_COOKIE_NAME}=${token}; Path=${path}; Max-Age=${RECEIPT_TTL_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function readReceiptCookie(request: Request): string | null {
	for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
		const [name, ...value] = part.trim().split('=');
		if (name === RECEIPT_COOKIE_NAME) return value.join('=') || null;
	}
	return null;
}

export async function signReceipt(env: { JWT_SECRET: string }, claims: ReceiptClaims): Promise<string> {
	return JWTUtils.getInstance(env).signPayload({ ...claims, purpose: RECEIPT_PURPOSE }, RECEIPT_TTL_SECONDS);
}

export async function verifyReceipt(env: { JWT_SECRET: string }, token: string | null): Promise<ReceiptClaims | null> {
	if (!token) return null;
	const payload = await JWTUtils.getInstance(env).verifyPayload(token);
	if (!payload || payload.purpose !== RECEIPT_PURPOSE || typeof payload.appId !== 'string' || !Array.isArray(payload.orderIds)) return null;
	return { appId: payload.appId, orderIds: payload.orderIds.filter((id): id is string => typeof id === 'string') };
}

export function receiptOf(order: StoreOrderView): StoreReceipt {
	return {
		orderId: order.id,
		orderNumber: order.orderNumber,
		createdAt: order.createdAt.toISOString(),
		mode: order.mode,
		paymentStatus: order.paymentStatus,
		items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents })),
		subtotalCents: order.subtotalCents,
		shippingCents: order.shippingCents,
		totalCents: order.totalCents,
		shipCity: order.shippingAddress?.city ?? null,
		shipCountry: order.shippingAddress?.countryCode ?? null,
		customerEmail: order.customerEmail,
	};
}
