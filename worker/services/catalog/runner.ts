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
/** Alarms never come closer than this, so a failing step can't call the supplier in a loop. */
const MIN_ALARM_GAP_MS = 60 * 1000;
/** A step that throws waits this long before running again. */
const STEP_ERROR_BACKOFF_MS = 5 * 60 * 1000;
/** Refunds wait this long when Stripe isn't configured. */
const STRIPE_MISSING_RETRY_MS = 60 * 60 * 1000;
/** Paid orders whose runner never started (a lost hand-off) are swept after this long. */
export const UNSTARTED_ORDER_AGE_MS = 15 * 60 * 1000;

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

/** Items still owed money back: rejected items not yet refunded, and refunded items whose seller share isn't reversed yet. */
function refundsDue(items: readonly CatalogOrderItemRow[]): { rejected: CatalogOrderItemRow[]; owed: CatalogOrderItemRow[] } {
	return {
		rejected: items.filter((item) => item.status === 'rejected'),
		owed: items.filter((item) => item.status === 'refunded' && item.sellerReversalDueCents > 0),
	};
}

/** Rejected items are refunded from the store's state, so none is missed whichever attempt rejected it. */
async function refund(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (nowMs < state.nextRefundAt || state.refundFailures >= MAX_PLACEMENT_ATTEMPTS) return state;
	const order = await deps.store.getOrder(state.orderId);
	if (!order) return state;
	const { rejected, owed } = refundsDue(order.items);
	if (rejected.length === 0 && owed.length === 0) return state;
	if (!deps.stripe) {
		await deps.alert({ kind: 'refund-failed', orderId: order.id, message: 'Stripe is not configured, so rejected items wait for their refund' });
		return { ...state, nextRefundAt: nowMs + STRIPE_MISSING_RETRY_MS };
	}
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

type Step = (state: RunnerState, deps: RunnerDeps, nowMs: number) => Promise<RunnerState>;

/** Each step with the due time it pushes back when it throws, so a failure waits instead of repeating at once. */
const STEPS: ReadonlyArray<readonly [Step, 'nextPlacementAt' | 'nextRefundAt' | 'nextSyncAt']> = [
	[place, 'nextPlacementAt'],
	[refund, 'nextRefundAt'],
	[sync, 'nextSyncAt'],
	// Again, so items a cancellation just rejected are refunded in the same alarm.
	[refund, 'nextRefundAt'],
];

export async function runnerStep(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<{ state: RunnerState; nextAlarmAt: number | null }> {
	let next = state;
	for (const [step, dueField] of STEPS) {
		try {
			next = await step(next, deps, nowMs);
		} catch (error) {
			next = { ...next, [dueField]: nowMs + STEP_ERROR_BACKOFF_MS };
			await deps.alert({ kind: 'runner-step-failed', orderId: state.orderId, message: errorText(error) }).catch(() => undefined);
		}
	}
	let refundDue = false;
	try {
		const order = await deps.store.getOrder(state.orderId);
		const { rejected, owed } = refundsDue(order?.items ?? []);
		refundDue = rejected.length + owed.length > 0 && next.refundFailures < MAX_PLACEMENT_ATTEMPTS;
	} catch {
		// The store is unreachable: check again on the next alarm.
		refundDue = true;
	}
	const times = [next.placement === 'due' ? next.nextPlacementAt : null, refundDue ? next.nextRefundAt : null, next.nextSyncAt].filter((time): time is number => time !== null);
	return { state: next, nextAlarmAt: times.length > 0 ? Math.max(Math.min(...times), nowMs + MIN_ALARM_GAP_MS) : null };
}

/** Starts the runner of every paid catalog order whose hand-off from checkout was lost. Returns how many it started. */
export async function sweepUnstartedOrders(deps: { unstartedOrderIds(before: Date): Promise<readonly string[]>; start(orderId: string): Promise<void> }, nowMs: number): Promise<number> {
	const orderIds = await deps.unstartedOrderIds(new Date(nowMs - UNSTARTED_ORDER_AGE_MS));
	for (const orderId of orderIds) await deps.start(orderId);
	return orderIds.length;
}
