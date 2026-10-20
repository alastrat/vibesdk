/** D1 for admin plan overrides: each decision is a row, written with an audit entry naming the admin. */

import { desc, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { PlanId, PlanLimitOverrides } from '../../../shared/types/plans';

export interface PlanOverrideInput {
    userId: string;
    /** The plan to run the account on; null ends the override. */
    plan: PlanId | null;
    limits: PlanLimitOverrides;
    until: Date | null;
    adminUserId: string;
    reason: string;
    now: Date;
}

export class PlanAdminService extends BaseService {
    /** The newest override row, which rules even when it ends the override (plan null). */
    async latestOverride(userId: string): Promise<schema.PlanOverrideRecord | null> {
        const [latest] = await this.database
            .select()
            .from(schema.planOverrides)
            .where(eq(schema.planOverrides.userId, userId))
            .orderBy(desc(schema.planOverrides.createdAt))
            .limit(1);
        return latest ?? null;
    }

    async addOverride(input: PlanOverrideInput): Promise<void> {
        await this.database.batch([
            this.database.insert(schema.planOverrides).values({
                id: generateId(),
                userId: input.userId,
                plan: input.plan,
                limits: JSON.stringify(input.limits),
                until: input.until,
                adminUserId: input.adminUserId,
                reason: input.reason,
                createdAt: input.now,
            }),
            this.database.insert(schema.auditLogs).values({
                id: generateId(),
                userId: input.adminUserId,
                entityType: 'billing_plan',
                entityId: input.userId,
                action: 'plan_override',
                newValues: { plan: input.plan, limits: input.limits, until: input.until, reason: input.reason },
                createdAt: input.now,
            }),
        ]);
    }
}
