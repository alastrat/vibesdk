import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStripeWebhook } from './webhook';
import { recordingD1 } from '../../../database/test-support/recording-d1';

const SECRET = 'whsec_store_test';

async function signatureFor(payload: string, secret = SECRET): Promise<string> {
	const timestamp = Math.floor(Date.now() / 1000);
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
	return `t=${timestamp},v1=${Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

describe('store sessions in the Stripe webhook', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('re-reads a store session through the API and leaves template purchases alone', async () => {
		const metadata = { kind: 'store_order', checkoutId: 'chk_unknown', storeAppId: 'app_1' };
		const session = { id: 'cs_store', url: null, payment_status: 'paid', status: 'complete', client_reference_id: 'chk_unknown', metadata, amount_total: 4600, currency: 'usd', payment_intent: 'pi_1' };
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(session), { status: 200 }));
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env;
		const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_store', payment_status: 'paid', metadata } } });

		const response = await handleStripeWebhook(
			new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signatureFor(payload) }, body: payload }),
			env,
		);
		expect(response.status).toBe(200);
		expect(String(fetchSpy.mock.calls[0][0])).toBe('https://api.stripe.com/v1/checkout/sessions/cs_store');
		expect(statements.some((statement) => statement.sql.includes('"store_checkouts"'))).toBe(true);
		expect(statements.some((statement) => statement.sql.includes('template'))).toBe(false);
	});

	it('accepts a Connect event signed with the Connect secret, and charges nothing for an account it does not know', async () => {
		const connectSecret = 'whsec_connect_test';
		const payload = JSON.stringify({ id: 'evt_9', type: 'payout.paid', account: 'acct_unknown', data: { object: { id: 'po_1', amount: 100_000, arrival_date: 1_800_000_000 } } });
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_CONNECT_WEBHOOK_SECRET: connectSecret, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env;
		const request = (signature: string) => new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': signature }, body: payload });

		expect((await handleStripeWebhook(request(await signatureFor(payload, connectSecret)), env)).status).toBe(200);
		expect(statements.some((entry) => entry.sql.toLowerCase().startsWith('insert into "seller_charges"'))).toBe(false);
		expect((await handleStripeWebhook(request(await signatureFor(payload, 'whsec_other')), env)).status).toBe(400);
	});

	it("ignores a seller account's own checkout and dispute events, which aren't Estori's sales", async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env;
		for (const event of [
			{ id: 'evt_c1', type: 'charge.dispute.created', account: 'acct_seller', data: { object: { id: 'dp_1', object: 'dispute', amount: 1000, charge: 'ch_1', payment_intent: 'pi_1', reason: 'fraudulent', status: 'needs_response', balance_transactions: [] } } },
			{ id: 'evt_c2', type: 'checkout.session.completed', account: 'acct_seller', data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { kind: 'store_order', checkoutId: 'chk_1' } } } },
		]) {
			const payload = JSON.stringify(event);
			const response = await handleStripeWebhook(new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signatureFor(payload) }, body: payload }), env);
			expect(response.status).toBe(200);
		}
		expect(statements).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("settles a store sale when its charge gains the seller's transfer, looking the order up by its payment", async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_SECRET_KEY: 'sk_test_fake' } as unknown as Env;
		const payload = JSON.stringify({ id: 'evt_t1', type: 'charge.updated', data: { object: { id: 'ch_77', object: 'charge', payment_intent: 'pi_77', transfer: 'tr_77' } } });
		const response = await handleStripeWebhook(new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': await signatureFor(payload) }, body: payload }), env);
		expect(response.status).toBe(200);
		expect(statements.some((entry) => entry.sql.includes('"store_orders"') && entry.params.includes('pi_77'))).toBe(true);
		// No store order has that payment, so nothing is asked of Stripe.
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

