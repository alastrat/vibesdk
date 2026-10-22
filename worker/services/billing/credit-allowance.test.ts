import { recurringPriceId } from './plan-price';
import { subscriptionRowFrom } from './subscription-row';
import { resolvePlan, planLimitsOf } from './account';
import type { StripePrice } from '../payments/stripe-client';
import { describe, expect, it } from 'vitest';
import {
	isPlanCreditAmount,
	planCreditOptions,
	planPriceCents,
} from '../../../shared/types/plans';
import { ENGLISH } from '../../../shared/i18n/translate';
import { planOrder } from './checkout-session';
import { subscriptionConsentText } from '../../../shared/types/billing';

describe('recurring plan credits', () => {
	it('adds $1.50 per extra1,000 and discounts and rounds the yearly monthly rate down', () => {
		expect(planPriceCents('pro', 'month', 30000)).toBe(6400);
		expect(planPriceCents('pro', 'year', 30000)).toBe(61200);
		expect(planPriceCents('premium', 'month', 200000)).toBe(34900);
		expect(planPriceCents('premium', 'year', 200000)).toBe(334800);
	});
	it('rejects below-base, fractional, nonfinite, oversized or nonnumeric allowances', () => {
		for (const value of [
			19000,
			20500,
			1000001,
			Infinity,
			NaN,
			'30000',
			null,
		])
			expect(isPlanCreditAmount('pro', value)).toBe(false);
		expect(isPlanCreditAmount('pro', 30000)).toBe(true);
		expect(isPlanCreditAmount('premium', 50000)).toBe(false);
		expect(planCreditOptions('premium')[0]).toBe(100000);
	});
	it('uses the selected amount for checkout, recurring consent and the included monthly allowance', () => {
		expect(planOrder('pro', ENGLISH, 'year', 30000)).toMatchObject({
			monthlyCredits: 30000,
			priceCents: 61200,
			includes: expect.arrayContaining(['30,000 AI credits a month']),
		});
		expect(
			subscriptionConsentText('pro', null, ENGLISH, 'year', 30000),
		).toContain('$612 a year');
	});
});

it('reuses the same recurring Stripe price and reconstructs the paid monthly allowance from its verified metadata', async () => {
	const ids = {
		pro: 'price_pro',
		premium: 'price_premium',
		credits: 'price_credits',
	};
	let created: StripePrice | null = null;
	let writes = 0;
	const stripe = {
		retrievePrice: async () => ({
			id: 'price_pro',
			product: 'prod_pro',
			currency: 'usd',
			unit_amount: 4900,
			recurring: { interval: 'month', interval_count: 1 },
		}),
		findPlanPrice: async () => created,
		createPlanPrice: async (input: {
			plan: string;
			monthlyCredits: number;
			priceCents: number;
			interval: string;
		}) => {
			writes++;
			created = {
				id: 'price_recurring',
				product: 'prod_pro',
				currency: 'usd',
				unit_amount: input.priceCents,
				recurring: { interval: input.interval, interval_count: 1 },
				metadata: {
					estori_plan: input.plan,
					estori_monthly_credits: String(input.monthlyCredits),
				},
			};
			return created;
		},
	};
	expect(await recurringPriceId(stripe, ids, 'pro', 'month', 30000)).toBe(
		'price_recurring',
	);
	expect(await recurringPriceId(stripe, ids, 'pro', 'month', 30000)).toBe(
		'price_recurring',
	);
	expect(writes).toBe(1);
	const sub = {
		id: 'sub_custom',
		customer: 'cus_1',
		status: 'active' as const,
		created: 1,
		cancel_at_period_end: false,
		cancel_at: null,
		metadata: null,
		schedule: null,
		items: {
			data: [
				{
					id: 'si_1',
					price: created!,
					current_period_start: 100,
					current_period_end: 2678500,
				},
			],
		},
	};
	const row = subscriptionRowFrom(sub, 'u1', ids, 101000)!;
	expect(row.monthlyCredits).toBe(30000);
	const plan = resolvePlan({
		subscription: row,
		override: null,
		signupMs: null,
		nowMs: 101000,
	});
	expect(planLimitsOf(plan).aiCredits).toBe(30000);
	expect(
		subscriptionRowFrom(
			{
				...sub,
				items: {
					data: [
						{
							...sub.items.data[0],
							price: { ...created!, unit_amount: 1 },
						},
					],
				},
			},
			'u1',
			ids,
			101000,
		),
	).toBeNull();
});

it('refuses a recurring price belonging to a replaced plan product', async () => {
	const old: StripePrice = {
		id: 'price_old',
		product: 'prod_old',
		currency: 'usd',
		unit_amount: 6400,
		recurring: { interval: 'month', interval_count: 1 },
		metadata: { estori_plan: 'pro', estori_monthly_credits: '30000' },
	};
	const stripe = {
		retrievePrice: async () => ({
			...old,
			id: 'price_base',
			product: 'prod_new',
			unit_amount: 4900,
			metadata: null,
		}),
		findPlanPrice: async () => old,
		createPlanPrice: async () => old,
	};
	expect(
		await recurringPriceId(
			stripe,
			{
				pro: 'price_base',
				premium: 'price_prem',
				credits: 'price_credit',
			},
			'pro',
			'month',
			30000,
		),
	).toBeNull();
});
