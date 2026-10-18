/** What admins see of a catalog order beyond its rows: when items count as late, and where its runner stands. */

import type { AdminCatalogOrderRunner } from '../../../shared/types/catalog';
import type { LateCutoffs } from '../../database/services/CatalogOrderAdminService';
import { NOT_DELIVERED_AFTER_MS, NOT_SHIPPED_AFTER_MS } from './health';
import type { RunnerState } from './runner';

/** The same thresholds the late-order alerts use. */
export function lateCutoffs(nowMs: number): LateCutoffs {
	return { placedBefore: new Date(nowMs - NOT_SHIPPED_AFTER_MS), shippedBefore: new Date(nowMs - NOT_DELIVERED_AFTER_MS) };
}

function isoOrNull(ms: number | null | undefined): string | null {
	return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : null;
}

export function runnerView(state: RunnerState | null): AdminCatalogOrderRunner | null {
	if (!state) return null;
	return {
		placement: state.placement,
		nextPlacementAt: state.placement === 'due' ? isoOrNull(state.nextPlacementAt) : null,
		nextSyncAt: isoOrNull(state.nextSyncAt),
		riskHoldUntil: isoOrNull(state.riskHoldUntil),
		refundFailures: state.refundFailures,
		raw: JSON.stringify(state, null, 2),
	};
}
