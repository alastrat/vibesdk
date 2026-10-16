/**
 * What one runner alarm does for a catalog order, in order: place pending items (with the catalog plan's retries),
 * refund rejected items, and read the supplier for tracking until everything arrived. Each step stands alone, so a
 * failure in one never blocks the next. Pure apart from its dependencies.
 */

import { MAX_PLACEMENT_ATTEMPTS, nextRetryDelayMs, placeCatalogOrder, type PlacementDeps } from './placement';
import { refundCatalogItems, type RefundItemsDeps } from './refund-items';
import type { CatalogOrderItemRow, CatalogOrderStore } from './store';
import type { SupplierUpdate } from './supplier';
import { applySupplierUpdate } from './updates';

export const RUNNER_SYNC_INTERVAL_MS = 30 * 60 * 1000;
export const RUNNER_SYNC_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface RunnerState {
	orderId: string;
	placement: 'due' | 'done' | 'needs-attention';
	nextPlacementAt: number;
	refundFailures: number;
	nextRefundAt: number;
	/** When to read the supplier next; null when nothing is in transit. */
	nextSyncAt: number | null;
	startedAt: number;
}

export interface RunnerDeps {
	store: CatalogOrderStore;
	adapters: PlacementDeps['adapters'];
	stripe: RefundItemsDeps['stripe'] | null;
	supplierUpdates(supplierOrderId: string): Promise<readonly SupplierUpdate[]>;
	alert(alert: { kind: string; orderId: string; message: string }): Promise<void>;
}

export function initialRunnerState(orderId: string, nowMs: number): RunnerState {
	return { orderId, placement: 'due', nextPlacementAt: nowMs, refundFailures: 0, nextRefundAt: nowMs, nextSyncAt: null, startedAt: nowMs };
}

function inTransit(items: readonly CatalogOrderItemRow[]): CatalogOrderItemRow[] {
	return items.filter((item) => (item.status === 'placed' || item.status === 'shipped') && item.supplierOrderId !== null);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function place(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.placement !== 'due' || nowMs < state.nextPlacementAt) return state;
	const outcome = await placeCatalogOrder({ store: deps.store, adapters: deps.adapters }, state.orderId);
	switch (outcome.kind) {
		case 'retry':
			return { ...state, nextPlacementAt: nowMs + outcome.delayMs };
		case 'done':
			return { ...state, placement: 'done', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'needs-attention':
			await deps.alert({ kind: 'needs-attention', orderId: state.orderId, message: outcome.reason });
			return { ...state, placement: 'needs-attention', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'not-found':
			await deps.alert({ kind: 'needs-attention', orderId: state.orderId, message: 'The catalog order does not exist' });
			return { ...state, placement: 'done', nextSyncAt: null };
	}
}

/** Rejected items are refunded from the store's state, so none is missed whichever attempt rejected it. */
async function refund(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	const order = await deps.store.getOrder(state.orderId);
	const rejected = order?.items.filter((item) => item.status === 'rejected') ?? [];
	if (!order || rejected.length === 0 || nowMs < state.nextRefundAt || !deps.stripe) return state;
	try {
		await refundCatalogItems({ store: deps.store, stripe: deps.stripe }, { orderId: order.id, itemIds: rejected.map((item) => item.id), reason: 'supplier-rejected' });
		return { ...state, refundFailures: 0, nextRefundAt: nowMs };
	} catch (error) {
		const refundFailures = state.refundFailures + 1;
		if (refundFailures >= MAX_PLACEMENT_ATTEMPTS) {
			await deps.store.updateOrder(order.id, { status: 'needs-attention', placementAttempts: order.placementAttempts, lastError: `Refund of rejected items failed: ${errorText(error)}` });
			await deps.alert({ kind: 'refund-failed', orderId: order.id, message: errorText(error) });
		}
		return { ...state, refundFailures, nextRefundAt: nowMs + nextRetryDelayMs(refundFailures) };
	}
}

async function sync(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.nextSyncAt === null || nowMs < state.nextSyncAt) return state;
	const order = await deps.store.getOrder(state.orderId);
	if (!order) return { ...state, nextSyncAt: null };
	let items = [...order.items];
	for (const supplierOrderId of new Set(inTransit(items).map((item) => item.supplierOrderId as string))) {
		for (const update of await deps.supplierUpdates(supplierOrderId)) {
			const patches = applySupplierUpdate(items, update);
			if (patches.length === 0) continue;
			await deps.store.patchItems(patches);
			items = items.map((item) => {
				const patch = patches.find((candidate) => candidate.itemId === item.id);
				if (!patch) return item;
				const { itemId: _itemId, ...fields } = patch;
				return { ...item, ...fields };
			});
		}
	}
	const stillOpen = inTransit(items).length > 0 && nowMs - state.startedAt < RUNNER_SYNC_MAX_AGE_MS;
	return { ...state, nextSyncAt: stillOpen ? nowMs + RUNNER_SYNC_INTERVAL_MS : null };
}

export async function runnerStep(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<{ state: RunnerState; nextAlarmAt: number | null }> {
	let next = state;
	for (const step of [place, refund, sync, refund]) {
		try {
			next = await step(next, deps, nowMs);
		} catch (error) {
			await deps.alert({ kind: 'runner-step-failed', orderId: state.orderId, message: errorText(error) });
		}
	}
	const order = await deps.store.getOrder(state.orderId);
	const refundDue = (order?.items.some((item) => item.status === 'rejected') ?? false) && next.refundFailures < MAX_PLACEMENT_ATTEMPTS;
	const times = [next.placement === 'due' ? next.nextPlacementAt : null, refundDue ? next.nextRefundAt : null, next.nextSyncAt].filter((time): time is number => time !== null);
	return { state: next, nextAlarmAt: times.length > 0 ? Math.max(Math.min(...times), nowMs + 1000) : null };
}
