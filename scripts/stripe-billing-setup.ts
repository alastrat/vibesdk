/**
 * Creates Estori's billing products in Stripe: Pro and Premium with monthly and yearly prices each, and AI credits with a
 * one-time price per 1,000. Rerunning reuses what exists. Prints the STRIPE_PRICE_IDS value for the environment.
 * Usage: STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-billing-setup.ts --mode test
 */

import { EXTRA_CREDITS, PLAN_PRICES_CENTS, PLAN_YEARLY_PRICES_CENTS } from '../shared/types/plans';
import type { StripePriceIds } from '../worker/services/billing/prices';
import { StripeApiError, type FormValue } from '../worker/services/payments/stripe-client';
import { modeOfKey, stripeCaller, type StripeMode } from './stripe-api';

export const BILLING_PRODUCTS = [
	{ id: 'estori_pro', name: 'Estori Pro' },
	{ id: 'estori_premium', name: 'Estori Premium' },
	{ id: 'estori_credits', name: 'Estori AI credits' },
] as const;

export const BILLING_LOOKUP_KEYS: Record<keyof StripePriceIds, string> = {
	pro: 'estori_pro_monthly',
	premium: 'estori_premium_monthly',
	credits: 'estori_credits_1000',
	proYearly: 'estori_pro_yearly',
	premiumYearly: 'estori_premium_yearly',
};

interface PriceSpec {
	plan: keyof StripePriceIds;
	product: (typeof BILLING_PRODUCTS)[number]['id'];
	unitAmount: number;
	/** What sets the price apart: its billing interval, its tag, its name. */
	details: Record<string, FormValue>;
}

const PRICE_SPECS: readonly PriceSpec[] = [
	{ plan: 'pro', product: 'estori_pro', unitAmount: PLAN_PRICES_CENTS.pro, details: { recurring: { interval: 'month' }, metadata: { estori_plan: 'pro' } } },
	{ plan: 'premium', product: 'estori_premium', unitAmount: PLAN_PRICES_CENTS.premium, details: { recurring: { interval: 'month' }, metadata: { estori_plan: 'premium' } } },
	{ plan: 'proYearly', product: 'estori_pro', unitAmount: PLAN_YEARLY_PRICES_CENTS.pro, details: { recurring: { interval: 'year' }, metadata: { estori_plan: 'pro', estori_billing_interval: 'year' } } },
	{ plan: 'premiumYearly', product: 'estori_premium', unitAmount: PLAN_YEARLY_PRICES_CENTS.premium, details: { recurring: { interval: 'year' }, metadata: { estori_plan: 'premium', estori_billing_interval: 'year' } } },
	{ plan: 'credits', product: 'estori_credits', unitAmount: EXTRA_CREDITS.unitPriceCents, details: { metadata: { estori_kind: 'credits' }, nickname: '1,000 AI credits' } },
];

interface ExistingPrice {
	id: string;
	lookup_key: string | null;
	unit_amount: number | null;
	active: boolean;
	currency: string;
	recurring: { interval: string; interval_count: number } | null;
}

export async function setUpBilling(input: {
	secretKey: string;
	mode: StripeMode;
	fetchImpl: typeof fetch;
}): Promise<{ mode: StripeMode; priceIds: StripePriceIds }> {
	const keyMode = modeOfKey(input.secretKey);
	if (keyMode !== input.mode) throw new Error(`The key is a ${keyMode} key, but --mode ${input.mode} was asked for.`);
	const call = stripeCaller(input.secretKey, input.fetchImpl);

	for (const product of BILLING_PRODUCTS) {
		try {
			await call('GET', `/products/${encodeURIComponent(product.id)}`);
		} catch (error) {
			if (!(error instanceof StripeApiError && error.status === 404)) throw error;
			await call('POST', '/products', { id: product.id, name: product.name });
		}
	}

	const { data: existing } = await call<{ data: ExistingPrice[] }>('GET', '/prices', {
		lookup_keys: Object.values(BILLING_LOOKUP_KEYS),
		active: true,
	});
	const priceIds: Partial<StripePriceIds> = {};
	for (const spec of PRICE_SPECS) {
		const lookupKey = BILLING_LOOKUP_KEYS[spec.plan];
		const expectedInterval = spec.plan === 'credits' ? null : spec.plan.endsWith('Yearly') ? 'year' : 'month';
		const reusable = existing.find((price) => price.active && price.lookup_key === lookupKey && price.unit_amount === spec.unitAmount && price.currency === 'usd' && (price.recurring?.interval ?? null) === expectedInterval && (price.recurring?.interval_count ?? 1) === 1);
		if (reusable) {
			priceIds[spec.plan] = reusable.id;
			continue;
		}
		// transfer_lookup_key moves the key off a price with another amount, so the key always names the current one.
		const created = await call<{ id: string }>('POST', '/prices', {
			product: spec.product,
			currency: 'usd',
			unit_amount: spec.unitAmount,
			lookup_key: lookupKey,
			transfer_lookup_key: true,
			...spec.details,
		});
		priceIds[spec.plan] = created.id;
	}

	// Every spec above set its plan's id.
	return { mode: input.mode, priceIds: priceIds as StripePriceIds };
}

function modeFromArgs(args: readonly string[]): StripeMode {
	const flag = args.findIndex((arg) => arg === '--mode' || arg.startsWith('--mode='));
	const value = flag < 0 ? undefined : args[flag].startsWith('--mode=') ? args[flag].slice('--mode='.length) : args[flag + 1];
	if (value !== 'test' && value !== 'live') throw new Error('Pass --mode test or --mode live.');
	return value;
}

async function main(): Promise<void> {
	const secretKey = process.env.STRIPE_SECRET_KEY;
	if (!secretKey) throw new Error('Set STRIPE_SECRET_KEY.');
	const result = await setUpBilling({ secretKey, mode: modeFromArgs(process.argv.slice(2)), fetchImpl: (url, init) => fetch(url, init) });
	console.log(`Stripe mode: ${result.mode}`);
	console.log(`STRIPE_PRICE_IDS=${JSON.stringify(result.priceIds)}`);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
