/** The seller's refund request: line numbers and a client-made id, never an amount. */

import type { StoreRefundRequest } from '../../../../shared/types/store-payments';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function parseStoreRefundRequest(body: unknown): StoreRefundRequest | null {
	if (typeof body !== 'object' || body === null) return null;
	const { lineNos, requestId, ...rest } = body as Record<string, unknown>;
	if (Object.keys(rest).length > 0) return null;
	if (!Array.isArray(lineNos) || lineNos.length === 0 || lineNos.length > 50) return null;
	if (!lineNos.every((line) => Number.isInteger(line) && (line as number) > 0)) return null;
	if (typeof requestId !== 'string' || !REQUEST_ID.test(requestId)) return null;
	return { lineNos: lineNos as number[], requestId };
}

export function shortBalanceMessage(shortCents: number): string {
	return `Your Stripe balance is $${(shortCents / 100).toFixed(2)} short for this refund. It can go through once more sales come in.`;
}
