/**
 * Places a catalog order's pending items with their suppliers. The scheduler that calls it (supplier connection spec)
 * runs it after the webhook answers and again after each `retry` delay; rejected items go to refundCatalogItems.
 */

import { CATALOG_SUPPLIERS, type CatalogSupplier } from '../../../shared/types/catalog';
import type { CatalogOrderItemRow, CatalogOrderStore, ItemPatch } from './store';
import type { ShippingAddress, SupplierAdapter } from './supplier';

export const MAX_PLACEMENT_ATTEMPTS = 6;

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 10_800_000] as const;

/** The wait before the next attempt, after `failedAttempts` failures: a minute, rising to three hours. */
export function nextRetryDelayMs(failedAttempts: number): number {
	const index = Math.min(Math.max(failedAttempts, 1), RETRY_DELAYS_MS.length) - 1;
	return RETRY_DELAYS_MS[index];
}

/** `rejectedItemIds` lists every item rejected and not yet refunded, whatever attempt rejected it, so none is left unrefunded. */
export type PlacementOutcome =
	| { kind: 'done'; rejectedItemIds: readonly string[] }
	| { kind: 'retry'; delayMs: number; rejectedItemIds: readonly string[] }
	| { kind: 'needs-attention'; reason: string; rejectedItemIds: readonly string[] }
	| { kind: 'not-found' };

export interface PlacementDeps {
	store: CatalogOrderStore;
	adapters: Readonly<Record<CatalogSupplier, SupplierAdapter>>;
}

/** One supplier's pending lines: placed, rejected (then the rest tried once more), or left for a retry. */
async function placeWithSupplier(
	deps: PlacementDeps,
	orderId: string,
	address: ShippingAddress,
	pending: readonly CatalogOrderItemRow[],
	supplier: CatalogSupplier,
): Promise<{ rejectedItemIds: string[]; retryReason: string | null }> {
	let lines = pending;
	const rejectedItemIds: string[] = [];
	for (let call = 0; call < 2 && lines.length > 0; call += 1) {
		const result = await deps.adapters[supplier].placeOrder({
			orderReference: orderId,
			lines: lines.map((item) => ({ supplierVariantId: item.supplierVariantId, quantity: item.quantity })),
			address,
		});
		if (result.ok) {
			await deps.store.patchItems(lines.map((item): ItemPatch => ({ itemId: item.id, status: 'placed', supplierOrderId: result.supplierOrderId })));
			return { rejectedItemIds, retryReason: null };
		}
		if (result.kind === 'retryable') return { rejectedItemIds, retryReason: result.reason };
		const named = lines.filter((item) => result.rejectedVariantIds.includes(item.supplierVariantId));
		// A rejection that names none of the lines sent rejects them all, so nothing is silently left pending.
		const rejected = named.length > 0 ? named : lines;
		await deps.store.patchItems(rejected.map((item): ItemPatch => ({ itemId: item.id, status: 'rejected' })));
		rejectedItemIds.push(...rejected.map((item) => item.id));
		lines = lines.filter((item) => !rejected.includes(item));
	}
	return { rejectedItemIds, retryReason: lines.length > 0 ? 'Lines left after a partial rejection' : null };
}

export async function placeCatalogOrder(deps: PlacementDeps, orderId: string): Promise<PlacementOutcome> {
	const order = await deps.store.getOrder(orderId);
	if (!order) return { kind: 'not-found' };
	const rejectedItemIds = order.items.filter((item) => item.status === 'rejected').map((item) => item.id);
	const pending = order.items.filter((item) => item.status === 'pending');
	if (pending.length === 0) {
		// Every item was handled, possibly by an attempt that stopped before settling the order.
		if (order.status === 'awaiting-placement') {
			await deps.store.updateOrder(order.id, { status: 'placement-done', placementAttempts: order.placementAttempts, lastError: null });
		}
		return { kind: 'done', rejectedItemIds };
	}

	let retryReason: string | null = null;
	for (const supplier of CATALOG_SUPPLIERS) {
		const lines = pending.filter((item) => item.supplier === supplier);
		if (lines.length === 0) continue;
		const result = await placeWithSupplier(deps, order.id, order.shippingAddress, lines, supplier);
		rejectedItemIds.push(...result.rejectedItemIds);
		retryReason ??= result.retryReason;
	}

	const placementAttempts = order.placementAttempts + 1;
	if (retryReason === null) {
		await deps.store.updateOrder(order.id, { status: 'placement-done', placementAttempts, lastError: null });
		return { kind: 'done', rejectedItemIds };
	}
	if (placementAttempts >= MAX_PLACEMENT_ATTEMPTS) {
		await deps.store.updateOrder(order.id, { status: 'needs-attention', placementAttempts, lastError: retryReason });
		return { kind: 'needs-attention', reason: retryReason, rejectedItemIds };
	}
	await deps.store.updateOrder(order.id, { status: 'awaiting-placement', placementAttempts, lastError: retryReason });
	return { kind: 'retry', delayMs: nextRetryDelayMs(placementAttempts), rejectedItemIds };
}
