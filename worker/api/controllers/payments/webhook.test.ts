import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleStripeWebhook } from './webhook';

/** An env that holds only the webhook secret; touching the database fails the test. */
function envWithoutDatabase(secret: string | undefined): { env: Env; databaseReads: () => number } {
	let reads = 0;
	const stub = {
		STRIPE_WEBHOOK_SECRET: secret,
		get DB(): never {
			reads += 1;
			throw new Error('The webhook touched the database before verifying the signature');
		},
	};
	return { env: stub as unknown as Env, databaseReads: () => reads };
}

function webhookRequest(signature: string | null): Request {
	const headers = new Headers({ 'Content-Type': 'application/json' });
	if (signature) headers.set('Stripe-Signature', signature);
	const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid' } } });
	return new Request('https://estori.test/api/stripe/webhook', { method: 'POST', headers, body: payload });
}

describe('handleStripeWebhook', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('rejects a bad signature with 400 before touching the database', async () => {
		const { env, databaseReads } = envWithoutDatabase('whsec_fake');
		const now = Math.floor(Date.now() / 1000);
		const response = await handleStripeWebhook(webhookRequest(`t=${now},v1=${'0'.repeat(64)}`), env);
		expect(response.status).toBe(400);
		expect(databaseReads()).toBe(0);
	});

	it('rejects a missing signature header with 400 before touching the database', async () => {
		const { env, databaseReads } = envWithoutDatabase('whsec_fake');
		const response = await handleStripeWebhook(webhookRequest(null), env);
		expect(response.status).toBe(400);
		expect(databaseReads()).toBe(0);
	});

	it('returns 400 and logs an error when no webhook secret is configured', async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { env, databaseReads } = envWithoutDatabase(undefined);
		const now = Math.floor(Date.now() / 1000);
		const response = await handleStripeWebhook(webhookRequest(`t=${now},v1=${'0'.repeat(64)}`), env);
		expect(response.status).toBe(400);
		expect(databaseReads()).toBe(0);
		expect(errorLog).toHaveBeenCalledTimes(1);
		expect(String(errorLog.mock.calls[0][0])).toContain('STRIPE_WEBHOOK_SECRET is not set');
	});
});
