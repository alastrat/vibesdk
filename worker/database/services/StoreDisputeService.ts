/** Shoppers' disputes of store payments, and what Estori took back and returned for each. */

import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { DISPUTE_CLOSED_STATUSES, type DisputeReversalState } from '../../../shared/types/store-payments';
import type { StoredDispute } from '../../services/store-payments/disputes';

export class StoreDisputeService extends BaseService {
	async get(disputeId: string): Promise<StoredDispute | null> {
		const row = await this.database
			.select({
				status: schema.storeDisputes.status,
				reversalState: schema.storeDisputes.reversalState,
				reversedCents: schema.storeDisputes.reversedCents,
				feeCents: schema.storeDisputes.feeCents,
				returnedCents: schema.storeDisputes.returnedCents,
			})
			.from(schema.storeDisputes)
			.where(eq(schema.storeDisputes.id, disputeId))
			.get();
		return row ?? null;
	}

	/** Upserts by dispute id; a later save without a reversal keeps the stored one. */
	async save(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalState: DisputeReversalState; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void> {
		await this.database
			.insert(schema.storeDisputes)
			.values({ id: row.id, orderId: row.orderId, amountCents: row.amountCents, reason: row.reason, status: row.status, reversalState: row.reversalState, reversalId: row.reversalId, reversedCents: row.reversedCents, feeCents: row.feeCents, returnedCents: row.returnedCents, createdAt: row.now, closedAt: DISPUTE_CLOSED_STATUSES.includes(row.status) ? row.now : null, updatedAt: row.now })
			.onConflictDoUpdate({
				target: schema.storeDisputes.id,
				set: {
					status: row.status,
					reversalState: row.reversalState,
					reversalId: sql`COALESCE(excluded.reversal_id, ${schema.storeDisputes.reversalId})`,
					reversedCents: row.reversedCents,
					feeCents: row.feeCents,
					returnedCents: row.returnedCents,
					// The first close time stays, whatever is redelivered later.
					closedAt: sql`COALESCE(${schema.storeDisputes.closedAt}, excluded.closed_at)`,
					updatedAt: row.now,
				},
			})
			.run();
	}
}
