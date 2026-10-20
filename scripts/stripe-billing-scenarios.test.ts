import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAN_LIMITS } from '../shared/types/plans';
import { BILLING_LOOKUP_KEYS } from './stripe-billing-setup';
import { SCENARIOS, readScenarioConfig, runScenarios, waitFor, type Timing } from './stripe-billing-scenarios';

const ENV = { STRIPE_SECRET_KEY: 'sk_test_fake', ESTORI_BASE_URL: 'https://staging.estori.app', ESTORI_ADMIN_COOKIE: 'session=abc', ESTORI_STAGING_KEY: 'gate', ESTORI_TEST_USER_ID: 'u_test' };

describe('the Stripe billing scenarios', () => {
	it('runs only in test mode, against the account it is given', () => {
		expect(readScenarioConfig(ENV)).toEqual({ stripeKey: 'sk_test_fake', baseUrl: 'https://staging.estori.app', adminCookie: 'session=abc', stagingKey: 'gate', userId: 'u_test' });
		expect(() => readScenarioConfig({ ...ENV, STRIPE_SECRET_KEY: 'sk_live_fake' })).toThrow('Run the scenarios with a test key only.');
		expect(() => readScenarioConfig({ ...ENV, ESTORI_TEST_USER_ID: undefined })).toThrow('Set ESTORI_TEST_USER_ID');
	});

	it('takes a restricted test key, leaves the staging key out when there is none, and drops a trailing slash from the address', () => {
		expect(readScenarioConfig({ ...ENV, STRIPE_SECRET_KEY: 'rk_test_fake', ESTORI_STAGING_KEY: undefined, ESTORI_BASE_URL: 'https://staging.estori.app/' })).toMatchObject({
			stripeKey: 'rk_test_fake',
			stagingKey: null,
			baseUrl: 'https://staging.estori.app',
		});
		expect(() => readScenarioConfig({ ...ENV, STRIPE_SECRET_KEY: undefined })).toThrow('Set STRIPE_SECRET_KEY');
		expect(() => readScenarioConfig({ ...ENV, ESTORI_ADMIN_COOKIE: '' })).toThrow('Set ESTORI_ADMIN_COOKIE');
	});

	it("covers the spec's ten scenarios and a cancel after a scheduled move, with 3-D Secure by eye", () => {
		expect(SCENARIOS.map((scenario) => scenario.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
		expect(SCENARIOS.filter((scenario) => scenario.byEye).map((scenario) => scenario.id)).toEqual([6]);
	});

	it('waits for the webhook to land, and gives up after its tries', async () => {
		let reads = 0;
		expect(await waitFor(async () => ++reads, (value) => value >= 3, { tries: 5, delayMs: 0 })).toBe(3);
		await expect(waitFor(async () => 0, (value) => value > 0, { tries: 2, delayMs: 0 })).rejects.toThrow('Gave up after 2 tries');
	});
});

const DAY = 86_400_000;
const FAST: Timing = { view: { tries: 2, delayMs: 0 }, clock: { tries: 2, delayMs: 0 }, purchase: { tries: 2, delayMs: 0 }, quietMs: 0 };

type PlanName = 'basic' | 'pro' | 'premium';

/** A Stripe error answer. */
class Refusal {
	constructor(readonly message: string) {}
}

/** Stripe's test clocks and Estori's admin billing view, reduced to what the scenarios read and change. */
class FakeWorld {
	calls: string[] = [];
	plan: PlanName = 'basic';
	status: 'active' | 'past_due' | null = null;
	periodStart = 0;
	periodEnd = 0;
	cancelAtPeriodEnd = false;
	pendingPlan: 'pro' | null = null;
	/** A schedule on the subscription: it stays through its last phase, after the move it made, and releases at the renewal after. */
	scheduled = false;
	card = 'pm_visa';
	subscribed = false;
	clockDeleted = false;
	/** When set, Estori never learns of a subscription, as if the webhook were not reaching it. */
	webhookDown = false;
	private clock = 0;

	view() {
		const held = this.status === 'past_due';
		return {
			enabled: true,
			plan: this.webhookDown ? 'basic' : this.plan,
			source: this.subscribed ? 'subscription' : 'free',
			status: this.webhookDown ? null : this.status,
			periodStart: this.periodStart,
			periodEnd: this.periodEnd,
			cancelAtPeriodEnd: this.cancelAtPeriodEnd,
			pendingPlan: this.pendingPlan,
			graceEndsAt: held ? this.periodStart + 7 * DAY : null,
			paymentFailing: held,
			credits: { pool: held ? 0 : PLAN_LIMITS[this.plan].aiCredits, used: 0, purchasedLeft: 0 },
			purchases: [],
		};
	}

	private schedule() {
		const phase = { start_date: this.periodStart / 1000, end_date: this.periodEnd / 1000, items: [{ price: `price_${this.plan}` }] };
		return { id: 'sched_1', status: 'active', subscription: 'sub_1', current_phase: phase, phases: [phase] };
	}

	private subscription() {
		const price = { id: `price_${this.plan}`, metadata: null };
		return {
			id: 'sub_1',
			customer: 'cus_1',
			status: this.status,
			created: 1,
			cancel_at_period_end: this.cancelAtPeriodEnd,
			cancel_at: null,
			metadata: {},
			schedule: this.scheduled ? this.schedule() : null,
			items: { data: [{ id: 'si_1', price, current_period_start: this.periodStart / 1000, current_period_end: this.periodEnd / 1000 }] },
		};
	}

	private renew(): void {
		this.periodStart = this.periodEnd;
		this.periodEnd += 30 * DAY;
		if (this.pendingPlan) this.plan = this.pendingPlan;
		else this.scheduled = false;
		this.pendingPlan = null;
		this.status = this.card === 'pm_fail' ? 'past_due' : 'active';
	}

	stripe(method: string, path: string, params: URLSearchParams): unknown {
		this.calls.push(`${method} ${path}`);
		const planOfPrice = (id: string | null): PlanName => (id === 'price_premium' ? 'premium' : 'pro');
		if (method === 'GET' && path === '/prices') {
			return { data: Object.entries(BILLING_LOOKUP_KEYS).map(([plan, lookup_key]) => ({ id: `price_${plan}`, lookup_key })) };
		}
		if (path === '/test_helpers/test_clocks' && method === 'POST') {
			this.clock = Number(params.get('frozen_time'));
			this.periodStart = this.clock * 1000;
			this.periodEnd = this.periodStart + 30 * DAY;
			return { id: 'clock_1', status: 'ready' };
		}
		if (path === '/test_helpers/test_clocks/clock_1/advance') {
			this.clock = Number(params.get('frozen_time'));
			if (this.subscribed && this.clock * 1000 >= this.periodEnd) this.renew();
			return { id: 'clock_1', status: 'advancing' };
		}
		if (path === '/test_helpers/test_clocks/clock_1') {
			if (method === 'DELETE') this.clockDeleted = true;
			return { id: 'clock_1', status: 'ready' };
		}
		if (path === '/customers') return { id: 'cus_1' };
		if (path === '/customers/cus_1') {
			this.card = params.get('invoice_settings[default_payment_method]') ?? this.card;
			return { id: 'cus_1' };
		}
		if (path.startsWith('/payment_methods/')) return { id: path.includes('chargeCustomerFail') ? 'pm_fail' : 'pm_visa' };
		if (path === '/subscriptions' && method === 'POST') {
			this.subscribed = true;
			this.plan = planOfPrice(params.get('items[0][price]'));
			this.status = 'active';
			return this.subscription();
		}
		if (path === '/subscriptions/sub_1' && method === 'GET') return this.subscription();
		if (path === '/subscriptions/sub_1' && method === 'DELETE') {
			this.subscribed = false;
			this.scheduled = false;
			return this.subscription();
		}
		if (path === '/subscriptions/sub_1') {
			if (params.has('cancel_at_period_end') && this.scheduled) {
				return new Refusal('The subscription is managed by the subscription schedule `sched_1`, and updating any cancelation behavior directly is not allowed. Please update the schedule instead.');
			}
			if (params.has('items[0][price]')) this.plan = planOfPrice(params.get('items[0][price]'));
			if (params.has('cancel_at_period_end')) this.cancelAtPeriodEnd = params.get('cancel_at_period_end') === 'true';
			return this.subscription();
		}
		if (path === '/subscription_schedules') {
			this.scheduled = true;
			return this.schedule();
		}
		if (path === '/subscription_schedules/sched_1/release') {
			this.scheduled = false;
			this.pendingPlan = null;
			return this.schedule();
		}
		if (path === '/subscription_schedules/sched_1') {
			if (method === 'POST') this.pendingPlan = 'pro';
			return this.schedule();
		}
		if (path === '/invoices') return { data: this.status === 'past_due' ? [{ id: 'in_1' }] : [] };
		if (path === '/invoices/in_1/pay') {
			this.status = 'active';
			return { id: 'in_1' };
		}
		throw new Error(`The fake Stripe has no ${method} ${path}`);
	}
}

function serve(world: FakeWorld): { estoriCalls: Array<{ method: string; path: string; headers: Headers; body: string }> } {
	const estoriCalls: Array<{ method: string; path: string; headers: Headers; body: string }> = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		const headers = new Headers(init?.headers);
		if (url.host === 'api.stripe.com') {
			expect(headers.get('Stripe-Version')).toBeTruthy();
			const params = new URLSearchParams(method === 'GET' ? url.search : String(init?.body ?? ''));
			const answer = world.stripe(method, url.pathname.replace('/v1', ''), params);
			if (answer instanceof Refusal) return Response.json({ error: { message: answer.message, type: 'invalid_request_error' } }, { status: 400 });
			return Response.json(answer);
		}
		estoriCalls.push({ method, path: url.pathname, headers, body: String(init?.body ?? '') });
		return Response.json({ success: true, data: world.view() });
	});
	return { estoriCalls };
}

const CONFIG = readScenarioConfig(ENV);

describe('running the scenarios', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('prepares the test account, runs each scenario against the view, and cleans up', async () => {
		const world = new FakeWorld();
		const { estoriCalls } = serve(world);
		const lines: string[] = [];
		expect(await runScenarios(CONFIG, new Set([1, 2, 3, 4, 5, 6, 7, 8]), (line) => lines.push(line), FAST)).toBe(true);
		expect(lines.map((line) => line.split(':')[0])).toEqual([
			'PASS 1 Subscribe to Pro',
			'PASS 2 Renew a month later',
			'PASS 3 Pro to Premium mid-period',
			'PASS 4 Premium to Pro at renewal',
			'PASS 5 Failed renewal, grace, new card',
			'BY EYE 6 3-D Secure at checkout',
			'PASS 7 Cancel at the period end',
			'PASS 8 Resume before the end',
		]);
		const preparing = estoriCalls.slice(0, 2);
		expect(preparing.map((call) => `${call.method} ${call.path}`)).toEqual(['PUT /api/admin/users/u_test/stripe-customer', 'PUT /api/admin/users/u_test/plan']);
		expect(JSON.parse(preparing[0].body)).toEqual({ stripeCustomerId: 'cus_1' });
		expect(JSON.parse(preparing[1].body)).toEqual({ plan: null, reason: 'Billing scenarios' });
		expect(estoriCalls.every((call) => call.headers.get('Cookie') === 'session=abc' && call.headers.get('x-estori-staging-key') === 'gate')).toBe(true);
		expect(world.calls.at(-2)).toBe('DELETE /subscriptions/sub_1');
		expect(world.clockDeleted).toBe(true);
	});

	it('sets up what a scenario needs when it is run alone', async () => {
		const world = new FakeWorld();
		serve(world);
		const lines: string[] = [];
		expect(await runScenarios(CONFIG, new Set([4]), (line) => lines.push(line), FAST)).toBe(true);
		expect(lines).toEqual(['PASS 4 Premium to Pro at renewal']);
		expect(world.calls).toContain('POST /subscriptions');
	});

	it('cancels after a scheduled move to Pro took effect, releasing the schedule Stripe keeps on the subscription first', async () => {
		const world = new FakeWorld();
		serve(world);
		const lines: string[] = [];
		const passed = await runScenarios(CONFIG, new Set([11]), (line) => lines.push(line), FAST);
		expect(lines).toEqual(['PASS 11 Cancel after a scheduled move to Pro']);
		expect(passed).toBe(true);
		const release = world.calls.indexOf('POST /subscription_schedules/sched_1/release');
		expect(release).toBeGreaterThan(world.calls.indexOf('POST /subscription_schedules/sched_1'));
		expect(world.calls.slice(release)).toContain('POST /subscriptions/sub_1');
		expect(world.plan).toBe('pro');
		expect(world.cancelAtPeriodEnd).toBe(true);
	});

	it('reports what Estori showed instead of what was expected, still cleans up, and fails the run', async () => {
		const world = new FakeWorld();
		world.webhookDown = true;
		serve(world);
		const lines: string[] = [];
		expect(await runScenarios(CONFIG, new Set([1]), (line) => lines.push(line), FAST)).toBe(false);
		expect(lines[0]).toBe('FAIL 1 Subscribe to Pro: plan is basic, expected pro; status is null, expected active');
		expect(world.clockDeleted).toBe(true);
	});
});
