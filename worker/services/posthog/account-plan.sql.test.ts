/** The plan flags and person properties use: billing's own resolution, on real SQL. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { planOf } from './person';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['plan_1', 'plan_2', 'plan_admin']) await insertUser(db, id);
});

describe("an account's plan", () => {
	it('is Basic with no subscription or override, and what billing resolves otherwise', async () => {
		expect(await planOf(envWith(db), 'plan_1')).toBe('basic');
		// Billing's override writer, as its admin page uses it.
		await new PlanAdminService(envWith(db)).addOverride({ userId: 'plan_2', plan: 'enterprise', limits: {}, until: null, adminUserId: 'plan_admin', reason: 'Partner', now: new Date() });
		expect(await planOf(envWith(db), 'plan_2')).toBe('enterprise');
	});

	it("is Basic when billing's tables can't be read", async () => {
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database);
		expect(await planOf(broken, 'plan_1')).toBe('basic');
	});
});
