/** What analytics needs from a user's record. The analytics setting lives in `users.preferences` JSON. */

import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { AnalyticsOptOutSource } from '../../../shared/types/telemetry';

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
