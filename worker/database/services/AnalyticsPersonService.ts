/** What analytics needs from a user's record. The analytics setting lives in `users.preferences` JSON. */

import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { AnalyticsOptOutSource } from '../../../shared/types/telemetry';
import type { SellerLevel } from '../../../shared/types/seller-levels';

/** D1 binds at most 100 values per statement. */
const ID_CHUNK = 50;
const OPT_OUT = sql`json_extract(${schema.users.preferences}, '$.analyticsOptOut')`;
const OPT_OUT_SOURCE = sql`json_extract(${schema.users.preferences}, '$.analyticsOptOutSource')`;

export class AnalyticsPersonService extends BaseService {
	async optedOutAmong(userIds: readonly string[]): Promise<Set<string>> {
		const found = new Set<string>();
		for (let start = 0; start < userIds.length; start += ID_CHUNK) {
			const rows = await this.database
				.select({ id: schema.users.id })
				.from(schema.users)
				.where(and(inArray(schema.users.id, userIds.slice(start, start + ID_CHUNK)), sql`${OPT_OUT} = 1`))
				.all();
			for (const row of rows) found.add(row.id);
		}
		return found;
	}

	async preference(userId: string): Promise<{ optedOut: boolean; source: AnalyticsOptOutSource | null }> {
		const row = await this.database
			.select({ optedOut: sql<number | null>`${OPT_OUT}`, source: sql<string | null>`${OPT_OUT_SOURCE}` })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.get();
		const optedOut = row?.optedOut === 1;
		const source = row?.source === 'settings' || row?.source === 'gpc' ? row.source : null;
		return { optedOut, source: optedOut ? source : null };
	}

	/** What person properties are built from; null when the user doesn't exist. */
	async personFacts(userId: string): Promise<{ createdAt: Date | null; sellerLevel: SellerLevel | null; hasLiveStore: boolean } | null> {
		const user = await this.database.select({ createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, userId)).get();
		if (!user) return null;
		const seller = await this.database
			.select({ level: schema.stripeConnectAccounts.sellerLevel })
			.from(schema.stripeConnectAccounts)
			.where(eq(schema.stripeConnectAccounts.userId, userId))
			.get();
		const live = await this.database
			.select({ appId: schema.liveStores.appId })
			.from(schema.liveStores)
			.innerJoin(schema.apps, eq(schema.apps.id, schema.liveStores.appId))
			.where(and(eq(schema.apps.userId, userId), eq(schema.liveStores.status, 'live')))
			.limit(1)
			.get();
		// Rows created with the column's text default read as an invalid date.
		const createdAt = user.createdAt && !Number.isNaN(user.createdAt.getTime()) ? user.createdAt : null;
		return { createdAt, sellerLevel: seller?.level ?? null, hasLiveStore: live !== undefined };
	}

	/** Keeps every other preference; turning analytics on clears the source. */
	async setPreference(userId: string, optedOut: boolean, source: AnalyticsOptOutSource, now: Date): Promise<void> {
		await this.database
			.update(schema.users)
			.set({
				preferences: sql`json_set(coalesce(${schema.users.preferences}, '{}'), '$.analyticsOptOut', json(${optedOut ? 'true' : 'false'}), '$.analyticsOptOutSource', ${optedOut ? source : null})`,
				updatedAt: now,
			})
			.where(eq(schema.users.id, userId))
			.run();
	}
}
