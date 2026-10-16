/** Shoppers' disputes of store payments, and what Estori took back and returned for each. */

import { eq, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';

export class StoreDisputeService extends BaseService {
	async get(disputeId: string): Promise<{ reversedCents: number; feeCents: number } | null> {
		const row = await this.database.select({ reversedCents: schema.storeDisputes.reversedCents, feeCents: schema.storeDisputes.feeCents }).from(schema.storeDisputes).where(eq(schema.storeDisputes.id, disputeId)).get();
		return row ?? null;
	}

	/** Upserts by dispute id; a later save without a reversal keeps the stored one. */
	async save(row: { id: string; orderId: string; amountCents: number; reason: string; status: string; reversalId: string | null; reversedCents: number; feeCents: number; returnedCents: number; now: Date }): Promise<void> {
		await this.database
			.insert(schema.storeDisputes)
			.values({ id: row.id, orderId: row.orderId, amountCents: row.amountCents, reason: row.reason, status: row.status, reversalId: row.reversalId, reversedCents: row.reversedCents, feeCents: row.feeCents, returnedCents: row.returnedCents, createdAt: row.now, updatedAt: row.now })
			.onConflictDoUpdate({
				target: schema.storeDisputes.id,
				set: {
					status: row.status,
					reversalId: sql`COALESCE(excluded.reversal_id, ${schema.storeDisputes.reversalId})`,
					reversedCents: row.reversedCents,
					feeCents: row.feeCents,
					returnedCents: row.returnedCents,
					updatedAt: row.now,
				},
			})
			.run();
	}
}
