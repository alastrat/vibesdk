/** D1 reads and writes for early-access requests. */

import { desc, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { isEarlyAccessCapability, type EarlyAccessCapability } from '../../../shared/types/early-access';

export interface EarlyAccessRequestRow {
	capability: EarlyAccessCapability;
	email: string;
	displayName: string;
	createdAt: Date;
}

export class EarlyAccessService extends BaseService {
	/** Records the request once; asking again changes nothing. */
	async request(userId: string, capability: EarlyAccessCapability): Promise<void> {
		await this.database
			.insert(schema.earlyAccessRequests)
			.values({ id: generateId(), userId, capability, createdAt: new Date() })
			.onConflictDoNothing({ target: [schema.earlyAccessRequests.userId, schema.earlyAccessRequests.capability] });
	}

	async listForUser(userId: string): Promise<EarlyAccessCapability[]> {
		const rows = await this.database
			.select({ capability: schema.earlyAccessRequests.capability })
			.from(schema.earlyAccessRequests)
			.where(eq(schema.earlyAccessRequests.userId, userId))
			.all();
		return rows.map((row) => row.capability).filter(isEarlyAccessCapability);
	}

	/** Every request with who asked, newest first; requests for retired programs are left out. */
	async listAll(): Promise<EarlyAccessRequestRow[]> {
		const rows = await this.database
			.select({
				capability: schema.earlyAccessRequests.capability,
				email: schema.users.email,
				displayName: schema.users.displayName,
				createdAt: schema.earlyAccessRequests.createdAt,
			})
			.from(schema.earlyAccessRequests)
			.innerJoin(schema.users, eq(schema.users.id, schema.earlyAccessRequests.userId))
			.orderBy(desc(schema.earlyAccessRequests.createdAt))
			.all();
		return rows.flatMap((row) => (isEarlyAccessCapability(row.capability) ? [{ ...row, capability: row.capability }] : []));
	}
}
