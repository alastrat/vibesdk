/** What sellers owe Estori outside a single sale, and what each later sale collected. */

import { and, asc, eq, lt, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { SellerChargeKind } from '../../../shared/types/store-payments';

export interface OpenSellerCharge {
	id: string;
	amountCents: number;
	collectedCents: number;
}

export class SellerChargeService extends BaseService {
	/** 'exists' when this kind and source were already charged, as on a redelivered event. */
	async add(input: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<'added' | 'exists'> {
		const rows = await this.database
			.insert(schema.sellerCharges)
			.values({ id: `sc_${generateId()}`, sellerUserId: input.sellerUserId, kind: input.kind, sourceId: input.sourceId, amountCents: input.amountCents, createdAt: input.now, updatedAt: input.now })
			.onConflictDoNothing()
			.returning({ id: schema.sellerCharges.id });
		return rows.length > 0 ? 'added' : 'exists';
	}

	async open(sellerUserId: string): Promise<OpenSellerCharge[]> {
		return this.database
			.select({ id: schema.sellerCharges.id, amountCents: schema.sellerCharges.amountCents, collectedCents: schema.sellerCharges.collectedCents })
			.from(schema.sellerCharges)
			.where(and(eq(schema.sellerCharges.sellerUserId, sellerUserId), lt(schema.sellerCharges.collectedCents, schema.sellerCharges.amountCents)))
			.orderBy(asc(schema.sellerCharges.createdAt))
			.limit(50)
			.all();
	}

	/** Records what one sale collected for one charge; repeated for the same charge and order, it changes nothing. */
	async recordCollection(input: { chargeId: string; orderId: string; reversalId: string; amountCents: number; now: Date }): Promise<void> {
		await this.database.batch([
			this.database
				.insert(schema.sellerChargeCollections)
				.values({ chargeId: input.chargeId, orderId: input.orderId, reversalId: input.reversalId, amountCents: input.amountCents, createdAt: input.now })
				.onConflictDoNothing(),
			this.database
				.update(schema.sellerCharges)
				.set({
					collectedCents: sql`(SELECT COALESCE(SUM(${schema.sellerChargeCollections.amountCents}), 0) FROM ${schema.sellerChargeCollections} WHERE ${schema.sellerChargeCollections.chargeId} = ${input.chargeId})`,
					updatedAt: input.now,
				})
				.where(eq(schema.sellerCharges.id, input.chargeId)),
		]);
	}

	/** Sets a charge's amount, creating it when missing, and returns what was already collected for it. */
	async setCharge(input: { sellerUserId: string; kind: SellerChargeKind; sourceId: string; amountCents: number; now: Date }): Promise<number> {
		await this.database
			.insert(schema.sellerCharges)
			.values({ id: `sc_${generateId()}`, sellerUserId: input.sellerUserId, kind: input.kind, sourceId: input.sourceId, amountCents: input.amountCents, createdAt: input.now, updatedAt: input.now })
			.onConflictDoUpdate({ target: [schema.sellerCharges.kind, schema.sellerCharges.sourceId], set: { amountCents: input.amountCents, updatedAt: input.now } })
			.run();
		return (await this.findBySource(input.kind, input.sourceId))?.collectedCents ?? 0;
	}

	async findBySource(kind: SellerChargeKind, sourceId: string): Promise<(OpenSellerCharge & { sellerUserId: string }) | null> {
		const row = await this.database
			.select({ id: schema.sellerCharges.id, amountCents: schema.sellerCharges.amountCents, collectedCents: schema.sellerCharges.collectedCents, sellerUserId: schema.sellerCharges.sellerUserId })
			.from(schema.sellerCharges)
			.where(and(eq(schema.sellerCharges.kind, kind), eq(schema.sellerCharges.sourceId, sourceId)))
			.get();
		return row ?? null;
	}
}
