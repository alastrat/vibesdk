/** The billing endpoints on real SQL, with Stripe stood in by fetch. */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertBillingCustomer, insertPurchase, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { BillingController } from './controller';
import { CARD_READ_BUDGET_MS } from '../../../services/billing/view';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
const PRICES = JSON.stringify({ pro: 'price_pro', premium: 'price_premium', credits: 'price_credits' });
const NOW = Date.now();

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['u_basic', 'u_paying', 'u_off', 'u_card', 'u_cust']) await insertUser(db, id, { createdAt: new Date(NOW - 40 * 86_400_000) });
	await insertSubscription(db, { userId: 'u_paying', stripeSubscriptionId: 'sub_paying', status: 'active', plan: 'premium', currentPeriodStart: new Date(NOW - 86_400_000), currentPeriodEnd: new Date(NOW + 29 * 86_400_000) });
	await insertSubscription(db, { userId: 'u_card', stripeSubscriptionId: 'sub_card', status: 'active', plan: 'pro', currentPeriodStart: new Date(NOW - 86_400_000), currentPeriodEnd: new Date(NOW + 29 * 86_400_000) });
	await insertBillingCustomer(db, 'u_card', 'cus_card');
	await insertBillingCustomer(db, 'u_cust', 'cus_cust');
	await insertPurchase(db, { id: 'cp_1', userId: 'u_paying', credits: 5_000, purchasedAt: new Date(NOW - 86_400_000), expiresAt: new Date(NOW + 364 * 86_400_000) });
});

afterEach(() => vi.restoreAllMocks());

function env(extra: Record<string, unknown> = {}): Env {
	return envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PUBLISHABLE_KEY: 'pk_test_fake', STRIPE_PRICE_IDS: PRICES, CUSTOM_DOMAIN: 'estori.app', VibecoderStore: { get: async () => null }, ...extra });
}

function context(userId: string, request: { pathParams?: Record<string, string>; query?: string } = {}): RouteContext {
	return { user: { id: userId, email: `${userId}@example.test` }, sessionId: 's1', pathParams: request.pathParams ?? {}, queryParams: new URLSearchParams(request.query) } as unknown as RouteContext;
}

const post = (path: string, body: unknown = {}) => new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (path: string) => new Request(`https://estori.app${path}`);
const ctx = {} as ExecutionContext;

/** Stripe's API by path, each answering the object given for it; a path not listed is a 404. Answers the paths asked, in order. */
function stripeServes(objects: Record<string, unknown>): string[] {
	const asked: string[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = new URL(String(input));
		asked.push(url.pathname);
		const found = objects[url.pathname];
		return found === undefined ? Response.json({ error: { message: `No such object: ${url.pathname}`, type: 'invalid_request_error' } }, { status: 404 }) : found instanceof Response ? found : Response.json(found);
	});
	return asked;
}

const cardMethod = (id: string, brand: string, last4: string, expMonth: number, expYear: number) => ({ id, type: 'card', card: { brand, last4, exp_month: expMonth, exp_year: expYear } });

function invoice(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		customer: 'cus_card',
		status: 'paid',
		created: 1_760_000_000,
		amount_due: 4_900,
		amount_paid: 4_900,
		total: 4_900,
		currency: 'usd',
		hosted_invoice_url: 'https://invoice.stripe.com/i/acct/x',
		invoice_pdf: `https://pay.stripe.com/invoice/${id}/pdf`,
		number: 'ABCD-0001',
		description: null,
		lines: { data: [{ description: '1 x Estori Pro (at $49.00 / month)' }] },
		billing_reason: 'subscription_cycle',
		parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_card' } },
		...overrides,
	};
}

describe('the billing endpoints', () => {
	it("shows a Basic account its month's credits", async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toMatchObject({ enabled: true, plan: 'basic', source: 'free', status: null, credits: { pool: 5_000, used: 0, left: 5_000 }, alert: null, purchases: [], limits: { liveStores: 1 }, canManageBilling: false, canBuyCredits: false });
	});

	it('shows Premium its pool and purchases, and lets it buy more', async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env(), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({ plan: 'premium', credits: { pool: 100_000, left: 105_000, purchasedLeft: 5_000 }, purchases: [{ credits: 5_000, left: 5_000 }], canBuyCredits: true });
	});

	it('shows an account outside the flag that plans are off, without its credits', async () => {
		const response = await BillingController.get(new Request('https://estori.app/api/billing'), env({ BILLING: undefined }), {} as ExecutionContext, context('u_paying'));
		expect((await response.json()).data).toMatchObject({ enabled: false, plan: 'basic', status: null, credits: null, alert: null, purchases: [], canManageBilling: false, canBuyCredits: false });
	});

	it('starts a checkout, keeping the Stripe customer it made, and refuses a second subscription', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/v1/customers') return Response.json({ id: 'cus_basic', email: null, metadata: null });
			if (path === '/v1/checkout/sessions') return Response.json({ id: 'cs_9', url: null, client_secret: 'cs_9_secret_x', status: 'open', amount_total: 4_900, discounts: [] });
			if (path === '/v1/checkout/sessions/cs_9') return Response.json({ id: 'cs_9', url: null, status: 'open', amount_total: 4_900, discounts: [] });
			throw new Error(`unexpected ${path}`);
		});
		const response = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_basic'));
		expect((await response.json()).data).toMatchObject({
			clientSecret: 'cs_9_secret_x',
			publishableKey: 'pk_test_fake',
			sessionId: 'cs_9',
			order: { kind: 'plan', plan: 'pro', priceCents: 4_900 },
			terms: { buttonText: 'Subscribe: $49 a month', dueTodayCents: 4_900 },
		});
		// The customer, the session, and the session read back as it stands.
		expect(stripe).toHaveBeenCalledTimes(3);
		expect(await db.prepare("SELECT stripe_customer_id FROM billing_customers WHERE user_id = 'u_basic'").first()).toEqual({ stripe_customer_id: 'cus_basic' });
		expect((await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), {} as ExecutionContext, context('u_paying'))).status).toBe(409);
	});

	it("answers 503 that payments aren't set up when the publishable key is missing, before asking Stripe", async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe must not be asked'));
		const response = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env({ STRIPE_PUBLISHABLE_KEY: undefined }), {} as ExecutionContext, context('u_basic'));
		expect(response.status).toBe(503);
		expect((await response.json()).error.message).toBe("Payments aren't set up yet.");
		expect(stripe).not.toHaveBeenCalled();
	});

	it('answers 402 plan_limit when Basic tries to buy credits, and 403 when billing is off for the account', async () => {
		const refused = await BillingController.credits(post('/api/billing/credits', { credits: 5_000 }), env(), {} as ExecutionContext, context('u_basic'));
		expect(refused.status).toBe(402);
		expect((await refused.json()).error.planLimit).toMatchObject({ limit: 'extraCredits', upgradeTo: 'premium' });
		const off = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), {} as ExecutionContext, context('u_off'));
		expect(off.status).toBe(403);
		expect((await off.json()).error.message).toBe("Plans aren't open for your account yet.");
	});

	it('takes the bodiless actions without a body, and answers 401 without a session', async () => {
		const cancel = await BillingController.cancel(new Request('https://estori.app/api/billing/cancel', { method: 'POST' }), env(), {} as ExecutionContext, context('u_basic'));
		expect(cancel.status).toBe(404);
		const anonymous = { ...context('u_basic'), user: null } as RouteContext;
		expect((await BillingController.cancel(new Request('https://estori.app/api/billing/cancel', { method: 'POST' }), env(), {} as ExecutionContext, anonymous)).status).toBe(401);
	});
});

describe('the card on the billing view', () => {
	it('the billing view carries the card on file', async () => {
		// The subscription's own default is the card Stripe charges, so the customer is not asked.
		const asked = stripeServes({
			'/v1/subscriptions/sub_card': { id: 'sub_card', default_payment_method: 'pm_sub' },
			'/v1/payment_methods/pm_sub': cardMethod('pm_sub', 'visa', '4242', 8, 2028),
		});
		const response = await BillingController.get(get('/api/billing'), env(), ctx, context('u_card'));
		expect((await response.json()).data.card).toEqual({ brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 });
		expect(asked).toEqual(['/v1/subscriptions/sub_card', '/v1/payment_methods/pm_sub']);
	});

	it("names the unpaid subscription's own card, the one Pay now charges", async () => {
		await insertUser(db, 'u_unpaid', { createdAt: new Date(NOW - 40 * 86_400_000) });
		await insertSubscription(db, { userId: 'u_unpaid', stripeSubscriptionId: 'sub_unpaid', status: 'unpaid', plan: 'pro', currentPeriodStart: new Date(NOW - 86_400_000), currentPeriodEnd: new Date(NOW + 29 * 86_400_000) });
		await insertBillingCustomer(db, 'u_unpaid', 'cus_unpaid');
		const asked = stripeServes({
			'/v1/subscriptions/sub_unpaid': { id: 'sub_unpaid', default_payment_method: 'pm_unpaid' },
			'/v1/payment_methods/pm_unpaid': cardMethod('pm_unpaid', 'visa', '0341', 4, 2030),
		});
		const response = await BillingController.get(get('/api/billing'), env(), ctx, context('u_unpaid'));
		expect((await response.json()).data).toMatchObject({ paymentFailing: true, card: { brand: 'visa', last4: '0341' } });
		expect(asked).toEqual(['/v1/subscriptions/sub_unpaid', '/v1/payment_methods/pm_unpaid']);
	});

	it("shows the customer's own default card when there is no live subscription", async () => {
		const asked = stripeServes({
			'/v1/customers/cus_cust': { id: 'cus_cust', email: null, metadata: null, invoice_settings: { default_payment_method: 'pm_cust' } },
			'/v1/payment_methods/pm_cust': cardMethod('pm_cust', 'mastercard', '4444', 1, 2031),
		});
		const response = await BillingController.get(get('/api/billing'), env(), ctx, context('u_cust'));
		expect((await response.json()).data.card).toEqual({ brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2031 });
		expect(asked).toEqual(['/v1/customers/cus_cust', '/v1/payment_methods/pm_cust']);
	});

	it('has no card, and asks Stripe nothing, for an account with no Stripe customer or with billing off', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe must not be asked'));
		const noCustomer = await BillingController.get(get('/api/billing'), env(), ctx, context('u_paying'));
		expect((await noCustomer.json()).data.card).toBeNull();
		const off = await BillingController.get(get('/api/billing'), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), ctx, context('u_card'));
		expect((await off.json()).data).toMatchObject({ enabled: false, card: null });
		expect(stripe).not.toHaveBeenCalled();
	});

	it('still answers the page, with no card and a warning, when Stripe cannot say what the card is', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe is unreachable'));
		const response = await BillingController.get(get('/api/billing'), env(), ctx, context('u_card'));
		expect(response.status).toBe(200);
		expect((await response.json()).data).toMatchObject({ enabled: true, plan: 'pro', card: null });
		expect(warn).toHaveBeenCalled();
	});

	describe('when Stripe is slow to say what the card is', () => {
		afterEach(() => vi.useRealTimers());

		/** Stripe answers nothing until `fail` is called, which makes every read it was asked fail. */
		function stripeHangs(): { asked: Promise<void>; fail: (error: Error) => void } {
			let started!: () => void;
			const asked = new Promise<void>((resolve) => {
				started = resolve;
			});
			const failures: Array<(error: Error) => void> = [];
			vi.spyOn(globalThis, 'fetch').mockImplementation(
				() =>
					new Promise<Response>((_, reject) => {
						failures.push(reject);
						started();
					}),
			);
			return { asked, fail: (error) => failures.forEach((reject) => reject(error)) };
		}

		it('answers the page with no card and a warning once the reads have taken 1.5 seconds', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const stripe = stripeHangs();
			let answered = false;
			const response = BillingController.get(get('/api/billing'), env(), ctx, context('u_card')).then((answer) => {
				answered = true;
				return answer;
			});
			await stripe.asked;
			await vi.advanceTimersByTimeAsync(CARD_READ_BUDGET_MS - 1);
			expect(answered).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			const answer = await response;
			expect(answer.status).toBe(200);
			expect((await answer.json()).data).toMatchObject({ enabled: true, plan: 'pro', card: null });
			expect(CARD_READ_BUDGET_MS).toBe(1_500);
			expect(warn.mock.calls.flat().join(' ')).toContain('took too long');
		});

		it('records, and does not leave unhandled, a card read that fails after the page was answered', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
			const stripe = stripeHangs();
			const response = BillingController.get(get('/api/billing'), env(), ctx, context('u_card'));
			await stripe.asked;
			await vi.advanceTimersByTimeAsync(CARD_READ_BUDGET_MS);
			expect((await response).status).toBe(200);
			const warned = warn.mock.calls.length;
			stripe.fail(new Error('Stripe gave up after the page was answered'));
			await vi.advanceTimersByTimeAsync(0);
			expect(warn.mock.calls.length).toBeGreaterThan(warned);
			expect(warn.mock.calls.flat().join(' ')).toContain('Stripe gave up after the page was answered');
		});

		it('leaves no timer behind for a card that was read in time', async () => {
			vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
			vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
				const path = new URL(String(input)).pathname;
				return path === '/v1/payment_methods/pm_sub' ? Response.json(cardMethod('pm_sub', 'visa', '4242', 8, 2028)) : Response.json({ id: 'sub_card', default_payment_method: 'pm_sub' });
			});
			const answer = await BillingController.get(get('/api/billing'), env(), ctx, context('u_card'));
			expect((await answer.json()).data.card).toMatchObject({ last4: '4242' });
			expect(vi.getTimerCount()).toBe(0);
		});
	});
});

describe('the history, the checkout reads and the invoice PDF', () => {
	it("history answers the seller's invoices, newest first, without drafts, from Stripe's list for their own customer", async () => {
		const asked = stripeServes({
			'/v1/invoices': { data: [invoice('in_3', { status: 'draft' }), invoice('in_2', { status: 'open', amount_paid: 0, created: 1_759_000_000 }), invoice('in_1', { created: 1_758_000_000 })] },
		});
		const fetched = vi.mocked(globalThis.fetch);
		const response = await BillingController.history(get('/api/billing/history'), env(), ctx, context('u_card'));
		expect((await response.json()).data).toEqual([
			{ id: 'in_2', date: 1_759_000_000_000, description: '1 x Estori Pro (at $49.00 / month)', amountCents: 4_900, currency: 'usd', status: 'open' },
			{ id: 'in_1', date: 1_758_000_000_000, description: '1 x Estori Pro (at $49.00 / month)', amountCents: 4_900, currency: 'usd', status: 'paid' },
		]);
		expect(asked).toEqual(['/v1/invoices']);
		const url = new URL(String(fetched.mock.calls[0]?.[0]));
		expect([url.searchParams.get('customer'), url.searchParams.get('limit')]).toEqual(['cus_card', '24']);
	});

	it('history is empty for a seller with no billing details, and closed outside the billing flag', async () => {
		const stripe = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Stripe must not be asked'));
		const none = await BillingController.history(get('/api/billing/history'), env(), ctx, context('u_off'));
		expect((await none.json()).data).toEqual([]);
		expect(stripe).not.toHaveBeenCalled();
		const off = await BillingController.history(get('/api/billing/history'), env({ BILLING: undefined, BILLING_USER_IDS: 'someone-else' }), ctx, context('u_off'));
		expect(off.status).toBe(403);
	});

	it("a pdf request for another seller's invoice answers 404, and Stripe's PDF is never fetched", async () => {
		const asked = stripeServes({
			'/v1/invoices/in_theirs': invoice('in_theirs', { customer: 'cus_someone_else' }),
			'/invoice/in_theirs/pdf': new Response('%PDF-theirs'),
		});
		const response = await BillingController.invoicePdf(get('/api/billing/invoices/in_theirs/pdf'), env(), ctx, context('u_card', { pathParams: { id: 'in_theirs' } }));
		expect(response.status).toBe(404);
		expect((await response.json()).error.message).toBe("We couldn't find that invoice.");
		expect(asked).toEqual(['/v1/invoices/in_theirs']);
	});

	it("answers the seller's own invoice as the PDF itself, not as JSON", async () => {
		stripeServes({ '/v1/invoices/in_mine': invoice('in_mine'), '/invoice/in_mine/pdf': new Response('%PDF-mine', { headers: { 'Content-Type': 'application/pdf' } }) });
		const response = await BillingController.invoicePdf(get('/api/billing/invoices/in_mine/pdf'), env(), ctx, context('u_card', { pathParams: { id: 'in_mine' } }));
		expect(response.status).toBe(200);
		expect(response.headers.get('Content-Type')).toBe('application/pdf');
		expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="estori-invoice-ABCD-0001.pdf"');
		expect(await response.text()).toBe('%PDF-mine');
	});

	it('reads the checkout session of the terms and the status from the query, and answers a session Stripe does not have as missing', async () => {
		const asked = stripeServes({});
		const terms = await BillingController.checkoutTerms(get('/api/billing/checkout/terms?session_id=cs_gone'), env(), ctx, context('u_basic', { query: 'session_id=cs_gone' }));
		expect(terms.status).toBe(404);
		const status = await BillingController.checkoutStatus(get('/api/billing/checkout/status?session_id=cs_gone'), env(), ctx, context('u_basic', { query: 'session_id=cs_gone' }));
		expect(status.status).toBe(404);
		expect(asked).toEqual(['/v1/checkout/sessions/cs_gone', '/v1/checkout/sessions/cs_gone']);
		const noQuery = await BillingController.checkoutStatus(get('/api/billing/checkout/status'), env(), ctx, context('u_basic'));
		expect(noQuery.status).toBe(400);
	});

	it('takes the consent, the card setup and the card completion from their bodies, and refuses what the actions refuse', async () => {
		stripeServes({});
		const consent = await BillingController.checkoutConsent(post('/api/billing/checkout/consent', { sessionId: 'cs_x' }), env(), ctx, context('u_basic'));
		expect(consent.status).toBe(400);
		const setup = await BillingController.cardSetup(post('/api/billing/card', { mode: 'sideways' }), env(), ctx, context('u_card'));
		expect(setup.status).toBe(400);
		const complete = await BillingController.cardComplete(post('/api/billing/card/complete', { sessionId: 'cs_gone' }), env(), ctx, context('u_card'));
		expect(complete.status).toBe(404);
	});

	it('pays with the card on file, and says there is no plan to pay for when the seller has none', async () => {
		const none = await BillingController.payInvoice(new Request('https://estori.app/api/billing/invoices/pay', { method: 'POST' }), env(), ctx, context('u_cust'));
		expect(none.status).toBe(404);
		const asked = stripeServes({ '/v1/invoices': { data: [invoice('in_1', { status: 'open' })] }, '/v1/invoices/in_1/pay': invoice('in_1'), '/v1/subscriptions/sub_card': { id: 'sub_card', default_payment_method: 'pm_sub' } });
		const paid = await BillingController.payInvoice(new Request('https://estori.app/api/billing/invoices/pay', { method: 'POST' }), env(), ctx, context('u_card'));
		expect((await paid.json()).data).toEqual({ state: 'paid' });
		expect(asked).toContain('/v1/invoices/in_1/pay');
	});
});

describe("the checkout's wording follows the seller's language", () => {
	const PLAN_SESSION = { id: 'cs_9', url: null, client_secret: 'cs_9_secret_x', status: 'open', amount_total: 4_900, client_reference_id: 'u_basic', metadata: { estori_user_id: 'u_basic', plan: 'pro' }, mode: 'subscription', discounts: [] };

	/** The seller as authentication hands them over, with their saved language (or none). */
	const seller = (locale: string | null): RouteContext =>
		({ user: { id: 'u_basic', email: 'u_basic@example.test', locale }, sessionId: 's1', pathParams: {}, queryParams: new URLSearchParams('session_id=cs_9') }) as unknown as RouteContext;

	const consentFor = async (locale: string | null, acceptLanguage?: string) => {
		stripeServes({ '/v1/checkout/sessions/cs_9': PLAN_SESSION });
		const request = new Request('https://estori.app/api/billing/checkout/terms?session_id=cs_9', { headers: acceptLanguage ? { 'Accept-Language': acceptLanguage } : {} });
		const response = await BillingController.checkoutTerms(request, env(), ctx, seller(locale));
		return ((await response.json()).data as { consentText: string }).consentText.replace(/ /g, ' ');
	};

	it("words the terms in the seller's saved language", async () => {
		expect(await consentFor('es')).toBe('Acepto los Términos (en inglés) y que Estori Pro se renueva por USD 49 al mes hasta que yo cancele.');
		expect(await consentFor('pt-BR')).toBe('Concordo com os Termos (em inglês) e com o fato de que o Estori Pro é renovado por US$ 49 por mês até que eu cancele.');
		expect(await consentFor('en')).toBe('I agree to the Terms, and that Estori Pro renews at $49 a month until I cancel.');
	});

	it("falls back to the browser's language for a seller who has not chosen one, and to English without either", async () => {
		expect(await consentFor(null, 'pt-BR,pt;q=0.9,en;q=0.8')).toContain('Concordo com os Termos');
		expect(await consentFor(null, 'fr-FR,fr;q=0.9')).toContain('I agree to the Terms');
		expect(await consentFor(null)).toContain('I agree to the Terms');
	});

	it("prefers the saved language to the browser's", async () => {
		expect(await consentFor('es', 'pt-BR')).toContain('Acepto los Términos');
	});

	it('words the plan checkout it opens, its order and terms, in the same language', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path === '/v1/customers') return Response.json({ id: 'cus_basic', email: null, metadata: null });
			return Response.json(PLAN_SESSION);
		});
		const response = await BillingController.checkout(post('/api/billing/checkout', { plan: 'pro' }), env(), ctx, seller('es'));
		const data = (await response.json()).data as { order: { includes: string[] }; terms: { buttonText: string } };
		expect(data.order.includes[0]).toBe('20,000 créditos de IA al mes');
		expect(data.terms.buttonText.replace(/ /g, ' ')).toBe('Suscribirse: USD 49 al mes');
	});
});
