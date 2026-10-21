/**
 * Billing end to end in Stripe test mode against a deployed Estori (staging), using test clocks to move time.
 * After each step it reads Estori's billing view through the admin API and checks the plan and credits.
 * Usage: STRIPE_SECRET_KEY=sk_test_... ESTORI_BASE_URL=https://staging.estori.app ESTORI_ADMIN_COOKIE='...'
 *        ESTORI_STAGING_KEY=... ESTORI_TEST_USER_ID=... bun scripts/stripe-billing-scenarios.ts [--only 1,2]
 */

import { BILLING_CHECKOUT_PATH, BILLING_CHECKOUT_RETURN_PATH, CHECKOUT_KIND_CREDITS, type AdminBillingView } from '../shared/types/billing';
import { EXTRA_CREDITS, GRACE_PERIOD_DAYS, PLAN_LIMITS, type PaidPlanId } from '../shared/types/plans';
import { DAY_MS } from '../worker/services/billing/periods';
import type { StripePriceIds } from '../worker/services/billing/prices';
import { cancelAtPeriodEndReleasingSchedule } from '../worker/services/billing/schedules';
import { createStripeClient, type StripeClient, type StripeCustomer, type StripeSubscription } from '../worker/services/payments/stripe-client';
import { modeOfKey, stripeCaller, type StripeCall } from './stripe-api';
import { BILLING_LOOKUP_KEYS } from './stripe-billing-setup';

const DAY_SECONDS = DAY_MS / 1000;
/** A clock advances at most two billing intervals at a time, so longer jumps are made in steps well inside that. */
const MAX_ADVANCE_DAYS = 28;
/** A renewal's invoice is finalized an hour after the period ends, then paid; this lands after both. */
const AFTER_RENEWAL_SECONDS = 2 * 3600;

const VISA = 'pm_card_visa';
/** 4000 0000 0000 0341: attaches to a customer, then every charge fails. */
const FAILING_CARD = 'pm_card_chargeCustomerFail';
const REFUND_NOTE = { source: 'estori-billing-scenarios' };

export interface ScenarioConfig {
	stripeKey: string;
	baseUrl: string;
	adminCookie: string;
	/** The CSRF cookie's token, sent back as X-CSRF-Token on every write (the app checks the two match). */
	csrfToken: string;
	stagingKey: string | null;
	userId: string;
}

export interface WaitOptions {
	tries: number;
	delayMs: number;
}

const DEFAULT_WAIT: WaitOptions = { tries: 15, delayMs: 2_000 };

/** How long each wait lasts. */
export interface Timing {
	/** The webhook follows Stripe's own work by a few seconds. */
	view: WaitOptions;
	/** A clock's advance can take a while to settle. */
	clock: WaitOptions;
	/** A person buys the credits on the billing page. */
	purchase: WaitOptions;
	/** How long to watch for something that must not happen. */
	quietMs: number;
}

const DEFAULT_TIMING: Timing = {
	view: { tries: 30, delayMs: 2_000 },
	clock: { tries: 60, delayMs: 2_000 },
	purchase: { tries: 150, delayMs: 2_000 },
	quietMs: 8_000,
};

function required(env: Record<string, string | undefined>, name: string): string {
	const value = env[name];
	if (!value) throw new Error(`Set ${name}.`);
	return value;
}

/** The token in a Cookie header's csrf-token cookie: the app stores it as JSON with its issue time, an older one as itself. */
function csrfTokenOf(cookieHeader: string): string | null {
	for (const pair of cookieHeader.split(';')) {
		const separator = pair.indexOf('=');
		if (separator < 0 || pair.slice(0, separator).trim() !== 'csrf-token') continue;
		const value = decodeURIComponent(pair.slice(separator + 1).trim());
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === 'object' && parsed !== null && 'token' in parsed && typeof parsed.token === 'string') return parsed.token;
		} catch {
			// Not JSON: the older plain format.
		}
		return value || null;
	}
	return null;
}

/** The run's settings from the environment; a live Stripe key is refused before anything else. */
export function readScenarioConfig(env: Record<string, string | undefined>): ScenarioConfig {
	const stripeKey = required(env, 'STRIPE_SECRET_KEY');
	if (modeOfKey(stripeKey) !== 'test') throw new Error('Run the scenarios with a test key only.');
	const adminCookie = required(env, 'ESTORI_ADMIN_COOKIE');
	const csrfToken = csrfTokenOf(adminCookie);
	if (!csrfToken) throw new Error('ESTORI_ADMIN_COOKIE has no csrf-token cookie. Copy the Cookie header again from a signed-in admin page.');
	return {
		stripeKey,
		baseUrl: required(env, 'ESTORI_BASE_URL').replace(/\/+$/, ''),
		adminCookie,
		csrfToken,
		stagingKey: env.ESTORI_STAGING_KEY || null,
		userId: required(env, 'ESTORI_TEST_USER_ID'),
	};
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Estori's own checkout page for a plan or an amount of extra credits. Stripe confirms an Elements Checkout Session
 * only through Stripe.js, with no server-side call, so a step that pays one needs a person at this address.
 */
export function checkoutPageUrl(baseUrl: string, request: { plan: PaidPlanId } | { credits: number }): string {
	const query = 'plan' in request ? `plan=${request.plan}` : `credits=${request.credits}`;
	return `${baseUrl}${BILLING_CHECKOUT_PATH}?${query}`;
}

/** Reads until `done` accepts a value and answers it; gives up after `tries` reads, `delayMs` apart. */
export async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, options: WaitOptions = DEFAULT_WAIT): Promise<T> {
	for (let attempt = 1; attempt <= options.tries; attempt += 1) {
		const value = await read();
		if (done(value)) return value;
		if (attempt < options.tries) await sleep(options.delayMs);
	}
	throw new Error(`Gave up after ${options.tries} tries`);
}

type Say = (message: string) => void;

interface EstoriBody<T> {
	success?: boolean;
	data?: T;
	error?: { message?: string };
}

async function estoriCall<T>(config: ScenarioConfig, method: 'GET' | 'PUT', path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${config.baseUrl}${path}`, {
		method,
		headers: {
			Cookie: config.adminCookie,
			...(method === 'GET' ? {} : { 'X-CSRF-Token': config.csrfToken }),
			...(config.stagingKey ? { 'x-estori-staging-key': config.stagingKey } : {}),
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = (await response.json().catch(() => null)) as EstoriBody<T> | null;
	if (!response.ok || !json?.success || json.data === undefined) {
		throw new Error(`Estori ${method} ${path} answered ${response.status}${json?.error?.message ? `: ${json.error.message}` : ''}`);
	}
	return json.data;
}

interface TestClock {
	id: string;
	status: 'ready' | 'advancing' | 'internal_failure';
}

interface Context {
	config: ScenarioConfig;
	stripe: StripeCall;
	/** The app's own Stripe calls, so the scenarios exercise the code that runs in production. */
	client: StripeClient;
	say: Say;
	timing: Timing;
	runId: string;
	clockId: string;
	customerId: string;
	prices: StripePriceIds;
	/** The clock's time in Stripe, in seconds. */
	frozenTime: number;
	subscriptionId: string | null;
	calls: number;
}

type Runner = (ctx: Context) => Promise<void>;

/** A key no other call in any run shares. */
function keyFor(ctx: Context, action: string): string {
	ctx.calls += 1;
	return `scenarios-${ctx.runId}-${action}-${ctx.calls}`;
}

const viewOf = (ctx: Context): Promise<AdminBillingView> => estoriCall<AdminBillingView>(ctx.config, 'GET', `/api/admin/users/${encodeURIComponent(ctx.config.userId)}/billing`);

type Expectation = ReadonlyArray<readonly [name: string, actual: unknown, expected: unknown]>;

/** What differs from what was expected, or null when everything matches. */
function differences(expectation: Expectation): string | null {
	const wrong = expectation.filter(([, actual, expected]) => actual !== expected).map(([name, actual, expected]) => `${name} is ${String(actual)}, expected ${String(expected)}`);
	return wrong.length === 0 ? null : wrong.join('; ');
}

/** Waits for Estori's view to pass `check` (a problem message, or null once it is right) and answers that view. */
async function expectView(ctx: Context, check: (view: AdminBillingView) => string | null): Promise<AdminBillingView> {
	const seen: { view: AdminBillingView | null } = { view: null };
	try {
		return await waitFor(
			async () => {
				seen.view = await viewOf(ctx);
				return seen.view;
			},
			(view) => check(view) === null,
			ctx.timing.view,
		);
	} catch (error) {
		throw new Error((seen.view && check(seen.view)) || (error instanceof Error ? error.message : String(error)));
	}
}

const iso = (ms: number): string => new Date(ms).toISOString();

async function advanceClock(ctx: Context, toSeconds: number): Promise<void> {
	while (ctx.frozenTime < toSeconds) {
		const next = Math.min(toSeconds, ctx.frozenTime + MAX_ADVANCE_DAYS * DAY_SECONDS);
		await ctx.stripe('POST', `/test_helpers/test_clocks/${ctx.clockId}/advance`, { frozen_time: next });
		const clock = await waitFor(() => ctx.stripe<TestClock>('GET', `/test_helpers/test_clocks/${ctx.clockId}`), (read) => read.status !== 'advancing', ctx.timing.clock);
		if (clock.status !== 'ready') throw new Error(`Stripe could not advance the test clock to ${iso(next * 1000)}`);
		ctx.frozenTime = next;
	}
}

/** Moves the clock a little past the end of the period `view` shows, where the renewal has been invoiced and paid or failed. */
function advancePastPeriodEnd(ctx: Context, view: AdminBillingView): Promise<void> {
	return advanceClock(ctx, Math.floor(view.periodEnd / 1000) + AFTER_RENEWAL_SECONDS);
}

function subscriptionIdOf(ctx: Context): string {
	if (ctx.subscriptionId === null) throw new Error('The account has no subscription yet');
	return ctx.subscriptionId;
}

async function attachCard(ctx: Context, token: string): Promise<string> {
	const method = await ctx.stripe<{ id: string }>('POST', `/payment_methods/${token}/attach`, { customer: ctx.customerId });
	return method.id;
}

async function useCard(ctx: Context, paymentMethodId: string): Promise<void> {
	await ctx.stripe('POST', `/customers/${ctx.customerId}`, { invoice_settings: { default_payment_method: paymentMethodId } });
}

async function subscribeToPro(ctx: Context): Promise<void> {
	const subscription = await ctx.stripe<StripeSubscription>(
		'POST',
		'/subscriptions',
		{ customer: ctx.customerId, items: [{ price: ctx.prices.pro }], metadata: { estori_user_id: ctx.config.userId } },
		keyFor(ctx, 'subscribe'),
	);
	ctx.subscriptionId = subscription.id;
	await expectView(ctx, (view) =>
		differences([
			['plan', view.plan, 'pro'],
			['status', view.status, 'active'],
			['credits', view.credits?.pool, PLAN_LIMITS.pro.aiCredits],
		]),
	);
}

/** Scenarios that start from a subscription subscribe to Pro first when run alone. */
async function ensureSubscribed(ctx: Context): Promise<void> {
	if (ctx.subscriptionId === null) await subscribeToPro(ctx);
}

/** Pro to Premium, mid-period: from the middle of the period on, so the proration is a real one. */
async function moveToPremium(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	const before = await viewOf(ctx);
	await advanceClock(ctx, Math.floor((before.periodStart + before.periodEnd) / 2000));
	const subscription = await ctx.client.retrieveSubscription(subscriptionIdOf(ctx));
	await ctx.client.changeSubscriptionPrice({ subscription, priceId: ctx.prices.premium, idempotencyKey: keyFor(ctx, 'premium') });
	await expectView(ctx, (view) =>
		differences([
			['plan', view.plan, 'premium'],
			['status', view.status, 'active'],
			['credits', view.credits?.pool, PLAN_LIMITS.premium.aiCredits],
		]),
	);
}

async function ensurePremium(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	if ((await viewOf(ctx)).plan !== 'premium') await moveToPremium(ctx);
}

async function renewMonthLater(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	const before = await viewOf(ctx);
	await advancePastPeriodEnd(ctx, before);
	await expectView(
		ctx,
		(view) =>
			differences([
				['plan', view.plan, before.plan],
				['status', view.status, 'active'],
				['credits used', view.credits?.used, 0],
			]) ?? (view.periodStart > before.periodStart ? null : `periodStart is still ${iso(view.periodStart)}`),
	);
}

async function premiumToProAtRenewal(ctx: Context): Promise<void> {
	await ensurePremium(ctx);
	const subscription = await ctx.client.retrieveSubscription(subscriptionIdOf(ctx));
	await ctx.client.scheduleSubscriptionPrice({ subscription, priceId: ctx.prices.pro, idempotencyKey: keyFor(ctx, 'schedule-pro') });
	const scheduled = await expectView(ctx, (view) =>
		differences([
			['plan', view.plan, 'premium'],
			['pendingPlan', view.pendingPlan, 'pro'],
		]),
	);
	await advancePastPeriodEnd(ctx, scheduled);
	await expectView(ctx, (view) =>
		differences([
			['plan', view.plan, 'pro'],
			['pendingPlan', view.pendingPlan, null],
			['status', view.status, 'active'],
			['credits', view.credits?.pool, PLAN_LIMITS.pro.aiCredits],
		]),
	);
}

/**
 * Test clocks move Stripe's time, not Estori's, so the day-8 fall to Basic is left to the real-D1 grace tests; this
 * checks the grace Estori computed from the failed renewal, and the recovery once the invoice is paid.
 */
async function failedRenewal(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	const before = await viewOf(ctx);
	await useCard(ctx, await attachCard(ctx, FAILING_CARD));
	await advancePastPeriodEnd(ctx, before);
	await expectView(
		ctx,
		(view) =>
			differences([
				['status', view.status, 'past_due'],
				['plan', view.plan, before.plan],
				['paymentFailing', view.paymentFailing, true],
				['credits held', view.credits?.pool, 0],
				['graceEndsAt', view.graceEndsAt, view.periodStart + GRACE_PERIOD_DAYS * DAY_MS],
			]),
	);
	await advanceClock(ctx, ctx.frozenTime + (GRACE_PERIOD_DAYS + 1) * DAY_SECONDS);
	const card = await attachCard(ctx, VISA);
	await useCard(ctx, card);
	const invoices = await ctx.stripe<{ data: Array<{ id: string }> }>('GET', '/invoices', { subscription: subscriptionIdOf(ctx), status: 'open', limit: 1 });
	const open = invoices.data[0];
	if (!open) throw new Error('The subscription has no open invoice to pay; Stripe may have given up on the renewal');
	await ctx.stripe('POST', `/invoices/${open.id}/pay`, { payment_method: card }, keyFor(ctx, 'pay-invoice'));
	await expectView(ctx, (view) =>
		differences([
			['status', view.status, 'active'],
			['plan', view.plan, before.plan],
			['graceEndsAt', view.graceEndsAt, null],
			['credits', view.credits?.pool, PLAN_LIMITS[before.plan].aiCredits],
		]),
	);
}

/** Cancels as the billing page does, releasing a schedule Stripe still has on the subscription first. */
async function requestCancel(ctx: Context): Promise<AdminBillingView> {
	if (!(await cancelAtPeriodEndReleasingSchedule(ctx.client, subscriptionIdOf(ctx), keyFor(ctx, 'cancel')))) {
		throw new Error('A subscription schedule is still on the subscription after its release');
	}
	return expectView(ctx, (view) => differences([['cancelAtPeriodEnd', view.cancelAtPeriodEnd, true]]));
}

async function cancelAtPeriodEnd(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	const before = await viewOf(ctx);
	const after = await requestCancel(ctx);
	const problem = differences([
		['plan', after.plan, before.plan],
		['status', after.status, 'active'],
	]);
	if (problem) throw new Error(problem);
}

/** Premium to Pro at renewal, then a cancel while the schedule that made the move is still on the subscription. */
async function cancelAfterMoveToPro(ctx: Context): Promise<void> {
	await premiumToProAtRenewal(ctx);
	const after = await requestCancel(ctx);
	const problem = differences([
		['plan', after.plan, 'pro'],
		['status', after.status, 'active'],
	]);
	if (problem) throw new Error(problem);
}

async function resumeBeforeEnd(ctx: Context): Promise<void> {
	await ensureSubscribed(ctx);
	if (!(await viewOf(ctx)).cancelAtPeriodEnd) await requestCancel(ctx);
	const subscription = await ctx.client.retrieveSubscription(subscriptionIdOf(ctx));
	await ctx.client.resumeSubscription(subscription, keyFor(ctx, 'resume'));
	await expectView(ctx, (view) => differences([['cancelAtPeriodEnd', view.cancelAtPeriodEnd, false]]));
}

async function expiredCheckout(ctx: Context): Promise<void> {
	const before = await viewOf(ctx);
	const session = await ctx.client.createCreditsCheckoutSession({
		customerId: ctx.customerId,
		priceId: ctx.prices.credits,
		userId: ctx.config.userId,
		credits: EXTRA_CREDITS.minCredits,
		returnUrl: `${ctx.config.baseUrl}${BILLING_CHECKOUT_RETURN_PATH}?session_id={CHECKOUT_SESSION_ID}`,
		nowMs: Date.now(),
		idempotencyKey: keyFor(ctx, 'expired-checkout'),
	});
	await ctx.client.expireCheckoutSession(session.id);
	const expired = await ctx.client.retrieveCheckoutSession(session.id);
	if (expired.status !== 'expired') throw new Error(`The checkout session is ${expired.status}, expected expired`);
	await sleep(ctx.timing.quietMs);
	const after = await viewOf(ctx);
	const problem = differences([
		['purchases', after.purchases.length, before.purchases.length],
		['purchasedLeft', after.credits?.purchasedLeft, before.credits?.purchasedLeft],
	]);
	if (problem) throw new Error(problem);
}

async function extraCredits(ctx: Context): Promise<void> {
	await ensurePremium(ctx);
	const base = (await viewOf(ctx)).credits?.purchasedLeft ?? 0;
	const bought = base + EXTRA_CREDITS.minCredits;
	const checkoutUrl = checkoutPageUrl(ctx.config.baseUrl, { credits: EXTRA_CREDITS.minCredits });
	ctx.say(`Sign in as the test account, open ${checkoutUrl} and pay with 4242 4242 4242 4242. Stripe confirms an Elements session only from Stripe.js, so this step needs a browser. Waiting up to 5 minutes.`);
	try {
		await waitFor(() => viewOf(ctx), (view) => (view.credits?.purchasedLeft ?? 0) >= bought, ctx.timing.purchase);
	} catch {
		throw new Error('No purchase of extra credits showed up');
	}
	await expectView(ctx, (view) => differences([['purchasedLeft', view.credits?.purchasedLeft, bought]]));
	const intents = await ctx.stripe<{ data: Array<{ id: string; amount: number; status: string; metadata: Record<string, string> | null }> }>('GET', '/payment_intents', { customer: ctx.customerId, limit: 20 });
	const payment = intents.data.find((intent) => intent.status === 'succeeded' && intent.metadata?.kind === CHECKOUT_KIND_CREDITS);
	if (!payment) throw new Error('Stripe has no paid extra-credits payment for the test customer');
	await ctx.client.createRefund({ paymentIntentId: payment.id, amountCents: payment.amount, idempotencyKey: keyFor(ctx, 'refund'), metadata: REFUND_NOTE });
	await expectView(ctx, (view) => differences([['purchasedLeft', view.credits?.purchasedLeft, base]]));
}

type ScenarioDefinition = { id: number; name: string } & (
	| { byEye: false; run: Runner }
	/** What a person checks for a scenario that can't be scripted, written for the Estori at `baseUrl`. */
	| { byEye: true; reminder: (baseUrl: string) => string }
);

const DEFINITIONS: readonly ScenarioDefinition[] = [
	{ id: 1, name: 'Subscribe to Pro', byEye: false, run: subscribeToPro },
	{ id: 2, name: 'Renew a month later', byEye: false, run: renewMonthLater },
	{ id: 3, name: 'Pro to Premium mid-period', byEye: false, run: moveToPremium },
	{ id: 4, name: 'Premium to Pro at renewal', byEye: false, run: premiumToProAtRenewal },
	{ id: 5, name: 'Failed renewal, grace, new card', byEye: false, run: failedRenewal },
	{
		id: 6,
		name: '3-D Secure at checkout',
		byEye: true,
		reminder: (baseUrl) => `after the run, sign in as the test account, open ${checkoutPageUrl(baseUrl, { plan: 'pro' })}, pay with 4000 0025 0000 3155 and complete the 3-D Secure challenge.`,
	},
	{ id: 7, name: 'Cancel at the period end', byEye: false, run: cancelAtPeriodEnd },
	{ id: 8, name: 'Resume before the end', byEye: false, run: resumeBeforeEnd },
	{ id: 9, name: 'An expired checkout', byEye: false, run: expiredCheckout },
	{ id: 10, name: 'Extra credits bought, then refunded', byEye: false, run: extraCredits },
	{ id: 11, name: 'Cancel after a scheduled move to Pro', byEye: false, run: cancelAfterMoveToPro },
];

export const SCENARIOS: ReadonlyArray<{ id: number; name: string; byEye: boolean }> = DEFINITIONS.map(({ id, name, byEye }) => ({ id, name, byEye }));

async function findPrices(stripe: StripeCall): Promise<StripePriceIds> {
	const { data } = await stripe<{ data: Array<{ id: string; lookup_key: string | null }> }>('GET', '/prices', { lookup_keys: Object.values(BILLING_LOOKUP_KEYS), active: true });
	const idOf = (plan: keyof StripePriceIds): string => {
		const price = data.find((candidate) => candidate.lookup_key === BILLING_LOOKUP_KEYS[plan]);
		if (!price) throw new Error(`No price for ${BILLING_LOOKUP_KEYS[plan]}. Run scripts/stripe-billing-setup.ts --mode test first.`);
		return price.id;
	};
	return { pro: idOf('pro'), premium: idOf('premium'), credits: idOf('credits') };
}

/** One test clock with a customer on it, a card on file, and the customer linked to the test account with its override ended. */
async function startAccount(config: ScenarioConfig, say: Say, timing: Timing): Promise<Context> {
	const stripe = stripeCaller(config.stripeKey);
	const runId = Date.now().toString(36);
	const prices = await findPrices(stripe);
	const frozenTime = Math.floor(Date.now() / 1000);
	const clock = await stripe<TestClock>('POST', '/test_helpers/test_clocks', { frozen_time: frozenTime, name: `Estori billing scenarios ${runId}` }, `scenarios-${runId}-clock`);
	const ctx: Context = { config, stripe, client: createStripeClient(config.stripeKey), say, timing, runId, clockId: clock.id, customerId: '', prices, frozenTime, subscriptionId: null, calls: 0 };
	try {
		const customer = await stripe<StripeCustomer>(
			'POST',
			'/customers',
			{ name: 'Estori billing scenarios', test_clock: clock.id, metadata: { estori_user_id: config.userId } },
			`scenarios-${runId}-customer`,
		);
		ctx.customerId = customer.id;
		await useCard(ctx, await attachCard(ctx, VISA));
		await estoriCall(config, 'PUT', `/api/admin/users/${encodeURIComponent(config.userId)}/stripe-customer`, { stripeCustomerId: customer.id });
		const view = await estoriCall<AdminBillingView>(config, 'PUT', `/api/admin/users/${encodeURIComponent(config.userId)}/plan`, { plan: null, reason: 'Billing scenarios' });
		if (!view.enabled) throw new Error("Billing isn't on for the test account. Add it to BILLING_USER_IDS, or set BILLING=on.");
		return ctx;
	} catch (error) {
		await deleteClock(ctx);
		throw error;
	}
}

async function deleteClock(ctx: Context): Promise<void> {
	try {
		await ctx.stripe('DELETE', `/test_helpers/test_clocks/${ctx.clockId}`);
	} catch (error) {
		ctx.say(`Could not delete test clock ${ctx.clockId}; delete it in the Stripe dashboard. ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Ends the subscription first so Estori's account is free to link again, then deletes the clock with its customer. */
async function cleanUp(ctx: Context): Promise<void> {
	if (ctx.subscriptionId !== null) {
		try {
			await ctx.stripe('DELETE', `/subscriptions/${ctx.subscriptionId}`);
			await waitFor(() => viewOf(ctx), (view) => view.source !== 'subscription', ctx.timing.view);
		} catch (error) {
			ctx.say(`The test account may still show its subscription; cancel it before the next run. ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	await deleteClock(ctx);
}

/** Runs the chosen scenarios in order; answers whether every one that can be scripted passed. */
export async function runScenarios(config: ScenarioConfig, only: ReadonlySet<number> | null, say: Say, timing: Timing = DEFAULT_TIMING): Promise<boolean> {
	const ctx = await startAccount(config, say, timing);
	let passed = true;
	try {
		for (const scenario of DEFINITIONS) {
			if (only && !only.has(scenario.id)) continue;
			if (scenario.byEye) {
				say(`BY EYE ${scenario.id} ${scenario.name}: ${scenario.reminder(config.baseUrl)}`);
				continue;
			}
			try {
				await scenario.run(ctx);
				say(`PASS ${scenario.id} ${scenario.name}`);
			} catch (error) {
				passed = false;
				say(`FAIL ${scenario.id} ${scenario.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	} finally {
		await cleanUp(ctx);
	}
	return passed;
}

function onlyFromArgs(args: readonly string[]): ReadonlySet<number> | null {
	const flag = args.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
	if (flag < 0) return null;
	const list = args[flag].startsWith('--only=') ? args[flag].slice('--only='.length) : args[flag + 1];
	const ids = (list ?? '').split(',').map((id) => Number(id.trim()));
	const unknown = ids.filter((id) => !SCENARIOS.some((scenario) => scenario.id === id));
	if (ids.length === 0 || unknown.length > 0) throw new Error(`Pass --only with scenario numbers from 1 to ${SCENARIOS.length}, such as --only 1,2.`);
	return new Set(ids);
}

async function main(): Promise<void> {
	const config = readScenarioConfig(process.env);
	const passed = await runScenarios(config, onlyFromArgs(process.argv.slice(2)), (message) => console.log(message));
	if (!passed) process.exit(1);
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
