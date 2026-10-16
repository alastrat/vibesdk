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
import type { PlatformAlertKind } from '../alerts/platform-alerts';
import type { SellerNotice } from '../alerts/seller-notices';

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
/** How long a payment Radar scores as risky waits for an admin before its catalog items are refunded. */
export const RISK_HOLD_MS = 24 * 60 * 60 * 1000;

export interface RunnerState {
	orderId: string;
	placement: 'due' | 'done' | 'needs-attention' | 'risk-hold';
	nextPlacementAt: number;
	refundFailures: number;
	nextRefundAt: number;
	/** When to read the supplier next; null when nothing is in transit. */
	nextSyncAt: number | null;
	startedAt: number;
	/** The payment's risk was read; states saved before risk checks lack it and read as unchecked. */
	riskChecked?: boolean;
	/** While held: when an unreviewed hold refunds the catalog items. */
	riskHoldUntil?: number | null;
}

export interface RunnerDeps {
	store: CatalogOrderStore;
	adapters: PlacementDeps['adapters'];
	stripe: RefundItemsDeps['stripe'] | null;
	/** Records each shopper refund on the store order. */
	recordRefund: RefundItemsDeps['recordRefund'];
	addShortfall: RefundItemsDeps['addShortfall'];
	supplierUpdates(supplierOrderId: string): Promise<readonly SupplierUpdate[]>;
	alert(alert: { kind: PlatformAlertKind; orderId: string; message: string }): Promise<void>;
	/** Radar's risk level for the payment; 'unknown' when Stripe gave none. */
	paymentRisk(paymentIntentId: string): Promise<'normal' | 'elevated' | 'highest' | 'unknown'>;
	notifySeller(notice: SellerNotice): Promise<void>;
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

/** An admin cleared a held order: place it now. */
export function releaseRiskHold(state: RunnerState, nowMs: number): RunnerState {
	if (state.placement !== 'risk-hold') return state;
	return { ...state, placement: 'due', riskChecked: true, riskHoldUntil: null, nextPlacementAt: nowMs };
}

/**
 * An admin retry, or placement restarted after a won dispute released held items: placement and refunds run again now.
 * A finished placement runs again too, since released items are pending; a risk hold waits for an admin's release.
 */
export function retryRunnerState(state: RunnerState, nowMs: number): RunnerState {
	const placement = state.placement === 'risk-hold' ? 'risk-hold' : 'due';
	return { ...state, placement, nextPlacementAt: nowMs, refundFailures: 0, nextRefundAt: nowMs, nextSyncAt: state.nextSyncAt ?? nowMs };
}

async function place(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	if (state.placement === 'risk-hold') return expireRiskHold(state, deps, nowMs);
	if (state.placement !== 'due' || nowMs < state.nextPlacementAt) return state;
	let current = state;
	if (!current.riskChecked) {
		// Once, before Estori pays a supplier: a payment Radar scores as risky waits for an admin.
		const order = await deps.store.getOrder(current.orderId);
		const risk = order ? await deps.paymentRisk(order.paymentIntentId) : 'unknown';
		if (order && (risk === 'elevated' || risk === 'highest')) {
			await deps.store.updateOrder(order.id, { status: 'risk-hold', placementAttempts: order.placementAttempts, lastError: `The payment's risk is ${risk}` });
			await deps.alert({ kind: 'risk-hold', orderId: current.orderId, message: `The payment's risk is ${risk}. Release the order within 24 hours, or its catalog items are refunded.` });
			return { ...current, placement: 'risk-hold', riskChecked: true, riskHoldUntil: nowMs + RISK_HOLD_MS };
		}
		current = { ...current, riskChecked: true };
	}
	const outcome = await placeCatalogOrder({ store: deps.store, adapters: deps.adapters }, current.orderId);
	switch (outcome.kind) {
		case 'retry':
			return { ...current, nextPlacementAt: nowMs + outcome.delayMs };
		case 'done':
			return { ...current, placement: 'done', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'needs-attention':
			await deps.alert({ kind: 'needs-attention', orderId: current.orderId, message: outcome.reason });
			return { ...current, placement: 'needs-attention', nextSyncAt: nowMs + RUNNER_SYNC_INTERVAL_MS };
		case 'not-found':
			await deps.alert({ kind: 'needs-attention', orderId: current.orderId, message: 'The catalog order does not exist' });
			return { ...current, placement: 'done', nextSyncAt: null };
	}
}

/** When the hold's time is up, i.e. no admin released it: refund what is still pending and tell the seller. */
async function expireRiskHold(state: RunnerState, deps: RunnerDeps, nowMs: number): Promise<RunnerState> {
	// A failed expiry pushes nextPlacementAt back, so it waits instead of trying again every minute.
	if (nowMs < Math.max(state.riskHoldUntil ?? 0, state.nextPlacementAt)) return state;
	const order = await deps.store.getOrder(state.orderId);
	// A dispute may already have withheld the items, and then there is nothing to refund here.
	const pending = order?.items.filter((item) => item.status === 'pending').map((item) => item.id) ?? [];
	if (order && pending.length > 0) {
		const refundDeps = refundDepsOf(deps);
		if (!refundDeps) return { ...state, nextPlacementAt: nowMs + STRIPE_MISSING_RETRY_MS };
		await refundCatalogItems(refundDeps, { orderId: order.id, itemIds: pending, reason: 'risk-declined' });
		await deps.notifySeller({ sellerUserId: order.sellerUserId, kind: 'items-refunded', orderId: order.id, itemCount: pending.length, reason: 'risk' });
	}
	if (order) await deps.store.updateOrder(order.id, { status: 'placement-done', placementAttempts: order.placementAttempts, lastError: 'Not released within 24 hours' });
	return { ...state, placement: 'done', riskHoldUntil: null, nextSyncAt: null };
}

/** Items still owed money back: rejected items not yet refunded, and refunded items whose seller share isn't reversed yet. */
function refundsDue(items: readonly CatalogOrderItemRow[]): { rejected: CatalogOrderItemRow[]; owed: CatalogOrderItemRow[] } {
	return {
		rejected: items.filter((item) => item.status === 'rejected'),
		owed: items.filter((item) => item.status === 'refunded' && item.sellerReversalDueCents > 0),
	};
}

/** The refund deps the runner's refunds use; null without Stripe. The runner never refunds for the seller, so it never reads their balance. */
function refundDepsOf(deps: RunnerDeps): RefundItemsDeps | null {
	if (!deps.stripe) return null;
	return {
		store: deps.store,
		stripe: deps.stripe,
		recordRefund: deps.recordRefund,
		addShortfall: deps.addShortfall,
		sellerBalance: async () => {
			throw new Error('Runner refunds never start from the seller');
		},
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
		const refundDeps = refundDepsOf(deps);
		if (!refundDeps) return { ...state, nextRefundAt: nowMs + STRIPE_MISSING_RETRY_MS };
		const totals = await refundCatalogItems(refundDeps, { orderId: order.id, itemIds: rejected.map((item) => item.id), reason: 'supplier-rejected' });
		if (totals.refundedItemIds.length > 0) {
			await deps.notifySeller({ sellerUserId: order.sellerUserId, kind: 'items-refunded', orderId: order.id, itemCount: totals.refundedItemIds.length, reason: 'supplier' });
		}
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
			if (update.kind === 'cancelled') await deps.alert({ kind: 'supplier-cancelled', orderId: state.orderId, message: update.reason });
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
	const times = [
		next.placement === 'due' ? next.nextPlacementAt : null,
		next.placement === 'risk-hold' ? Math.max(next.riskHoldUntil ?? 0, next.nextPlacementAt) : null,
		refundDue ? next.nextRefundAt : null,
		next.nextSyncAt,
	].filter((time): time is number => time !== null);
	return { state: next, nextAlarmAt: times.length > 0 ? Math.max(Math.min(...times), nowMs + MIN_ALARM_GAP_MS) : null };
}

/** Starts the runner of every paid catalog order whose hand-off from checkout was lost. Returns how many it started. */
export async function sweepUnstartedOrders(deps: { unstartedOrderIds(before: Date): Promise<readonly string[]>; start(orderId: string): Promise<void> }, nowMs: number): Promise<number> {
	const orderIds = await deps.unstartedOrderIds(new Date(nowMs - UNSTARTED_ORDER_AGE_MS));
	for (const orderId of orderIds) await deps.start(orderId);
	return orderIds.length;
}
