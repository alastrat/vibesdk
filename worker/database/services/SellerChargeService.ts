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

	/** Per seller, what is still owed on charges added before this time; for the daily unpaid-charge alert. */
	async unpaidSince(before: Date): Promise<Array<{ sellerUserId: string; owedCents: number }>> {
		return this.database
			.select({ sellerUserId: schema.sellerCharges.sellerUserId, owedCents: sql<number>`sum(${schema.sellerCharges.amountCents} - ${schema.sellerCharges.collectedCents})` })
			.from(schema.sellerCharges)
			.where(and(lt(schema.sellerCharges.createdAt, before), lt(schema.sellerCharges.collectedCents, schema.sellerCharges.amountCents)))
			.groupBy(schema.sellerCharges.sellerUserId)
			.limit(100)
			.all();
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

	/** This order's collections, finished (a reversal id) or only claimed. */
	async claims(orderId: string): Promise<Array<{ chargeId: string; amountCents: number; reversalId: string | null }>> {
		return this.database
			.select({ chargeId: schema.sellerChargeCollections.chargeId, amountCents: schema.sellerChargeCollections.amountCents, reversalId: schema.sellerChargeCollections.reversalId })
			.from(schema.sellerChargeCollections)
			.where(eq(schema.sellerChargeCollections.orderId, orderId))
			.all();
	}

	/**
	 * Claims an amount of a charge for one sale before Stripe is called. One statement, so it only inserts while that much
	 * is still owed: two sales collecting at once can't both claim it. Answers the amount this sale holds, which is what
	 * was stored first when another run of the same sale claimed it, or null when the claim went to another sale.
	 */
	async claimCollection(claim: { chargeId: string; orderId: string; amountCents: number; now: Date }): Promise<number | null> {
		const at = Math.floor(claim.now.getTime() / 1000);
		await this.database.run(sql`INSERT INTO seller_charge_collections (charge_id, order_id, reversal_id, amount_cents, created_at)
			SELECT ${claim.chargeId}, ${claim.orderId}, NULL, ${claim.amountCents}, ${at} FROM seller_charges c
			WHERE c.id = ${claim.chargeId}
				AND c.amount_cents - (SELECT COALESCE(SUM(amount_cents), 0) FROM seller_charge_collections WHERE charge_id = ${claim.chargeId}) >= ${claim.amountCents}
			ON CONFLICT (charge_id, order_id) DO NOTHING`);
		await this.refreshCollected(claim.chargeId, claim.now);
		const row = await this.database
			.select({ amountCents: schema.sellerChargeCollections.amountCents })
			.from(schema.sellerChargeCollections)
			.where(and(eq(schema.sellerChargeCollections.chargeId, claim.chargeId), eq(schema.sellerChargeCollections.orderId, claim.orderId)))
			.get();
		return row?.amountCents ?? null;
	}

	async completeCollection(done: { chargeId: string; orderId: string; reversalId: string }): Promise<void> {
		await this.database
			.update(schema.sellerChargeCollections)
			.set({ reversalId: done.reversalId })
			.where(and(eq(schema.sellerChargeCollections.chargeId, done.chargeId), eq(schema.sellerChargeCollections.orderId, done.orderId)))
			.run();
	}

	/** Stripe refused the reversal: the claim goes back, so a later sale can collect the charge. */
	async releaseClaim(release: { chargeId: string; orderId: string }): Promise<void> {
		await this.database
			.delete(schema.sellerChargeCollections)
			.where(and(eq(schema.sellerChargeCollections.chargeId, release.chargeId), eq(schema.sellerChargeCollections.orderId, release.orderId)))
			.run();
		await this.refreshCollected(release.chargeId, new Date());
	}

	private async refreshCollected(chargeId: string, now: Date): Promise<void> {
		const at = Math.floor(now.getTime() / 1000);
		await this.database.run(sql`UPDATE seller_charges SET collected_cents = (SELECT COALESCE(SUM(amount_cents), 0) FROM seller_charge_collections WHERE charge_id = ${chargeId}), updated_at = ${at} WHERE id = ${chargeId}`);
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
