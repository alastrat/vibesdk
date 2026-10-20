import { describe, expect, it } from 'vitest';
import { graceEndsAt, resolvePlan } from './account';
import { isBillingOn } from './flag';
import type { PlanOverrideRecord, SubscriptionRecord } from '../../database/schema';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const SIGNUP = Date.parse('2026-03-12T09:00:00Z');

function sub(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return {
		userId: 'u1',
		stripeSubscriptionId: 'sub_1',
		status: 'active',
		plan: 'pro',
		currentPeriodStart: new Date('2026-10-05T10:00:00Z'),
		currentPeriodEnd: new Date('2026-11-05T10:00:00Z'),
		cancelAtPeriodEnd: false,
		pendingPlan: null,
		pendingPlanAt: null,
		stripeScheduleId: null,
		stripeCreatedAt: new Date('2026-09-05T10:00:00Z'),
		updatedAt: new Date('2026-10-05T10:00:00Z'),
		...overrides,
	};
}

function override(overrides: Partial<PlanOverrideRecord> = {}): PlanOverrideRecord {
	return { id: 'po_1', userId: 'u1', plan: 'enterprise', limits: '{"aiCredits":500000}', until: null, adminUserId: 'u_admin', reason: 'Contract', createdAt: new Date('2026-10-01T00:00:00Z'), ...overrides };
}

const SUB_PERIOD = { key: `sub:sub_1:${Date.parse('2026-10-05T10:00:00Z') / 1000}`, startMs: Date.parse('2026-10-05T10:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') };
const BASIC_PERIOD = { key: `acct:${Date.parse('2026-10-12T00:00:00Z') / 1000}`, startMs: Date.parse('2026-10-12T00:00:00Z'), endMs: Date.parse('2026-11-12T00:00:00Z') };

describe('resolvePlan', () => {
	it('is Basic on its sign-up month without a subscription', () => {
		expect(resolvePlan({ subscription: null, override: null, signupMs: SIGNUP, nowMs: NOW })).toEqual({ plan: 'basic', source: 'free', period: BASIC_PERIOD, graceEndsAtMs: null, overrideLimits: null });
	});

	it("is the subscription's plan over the Stripe period while active or trialing", () => {
		for (const status of ['active', 'trialing'] as const) {
			expect(resolvePlan({ subscription: sub({ status, plan: 'premium' }), override: null, signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'premium', source: 'subscription', period: SUB_PERIOD });
		}
	});

	it('keeps the plan for 7 days of a failed renewal, then Basic on its sign-up month', () => {
		const pastDue = sub({ status: 'past_due', currentPeriodStart: new Date('2026-10-12T15:00:00Z') });
		expect(graceEndsAt(pastDue)).toBe(Date.parse('2026-10-19T15:00:00Z'));
		expect(resolvePlan({ subscription: pastDue, override: null, signupMs: SIGNUP, nowMs: NOW - 1 })).toMatchObject({ plan: 'pro', graceEndsAtMs: NOW });
		expect(resolvePlan({ subscription: pastDue, override: null, signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'basic', source: 'free', period: BASIC_PERIOD });
		for (const status of ['unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'] as const) {
			expect(resolvePlan({ subscription: sub({ status }), override: null, signupMs: SIGNUP, nowMs: NOW }).plan).toBe('basic');
		}
	});

	it('lets an admin override win until it ends or is cleared, on the Stripe period when there is one', () => {
		expect(resolvePlan({ subscription: sub(), override: override(), signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'enterprise', source: 'override', overrideLimits: { aiCredits: 500_000 }, period: SUB_PERIOD });
		expect(resolvePlan({ subscription: null, override: override({ plan: 'premium' }), signupMs: SIGNUP, nowMs: NOW })).toMatchObject({ plan: 'premium', period: BASIC_PERIOD });
		expect(resolvePlan({ subscription: sub(), override: override({ until: new Date(NOW - 1) }), signupMs: SIGNUP, nowMs: NOW }).source).toBe('subscription');
		expect(resolvePlan({ subscription: null, override: override({ plan: null }), signupMs: SIGNUP, nowMs: NOW }).plan).toBe('basic');
	});
});

describe('the billing flag', () => {
	it('is on for everyone with BILLING=on, or only for the listed accounts', () => {
		expect(isBillingOn({ BILLING: 'on' }, null)).toBe(true);
		expect(isBillingOn({ BILLING: ' ON ' }, 'u1')).toBe(true);
		expect(isBillingOn({ BILLING: 'off', BILLING_USER_IDS: 'u1, u2 ,,' }, 'u2')).toBe(true);
		expect(isBillingOn({ BILLING_USER_IDS: 'u1,u2' }, 'u3')).toBe(false);
		expect(isBillingOn({ BILLING_USER_IDS: 'u1' }, null)).toBe(false);
		expect(isBillingOn({ BILLING_USER_IDS: '' }, '')).toBe(false);
		expect(isBillingOn({}, 'u1')).toBe(false);
	});
});
