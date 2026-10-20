import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';

const captured = vi.hoisted((): Array<[string, string]> => []);
vi.mock('../posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string) => void captured.push([name, userId]) }),
}));

const { fulfillDepsFromEnv } = await import('./purchase-wiring');

afterEach(() => {
	captured.length = 0;
	vi.restoreAllMocks();
});

const PURCHASE = { listingId: 'l1', sourceAppId: 'app1', versionId: null, userId: 'buyer1', priceCents: 2900, platformFeeCents: 263, sellerAmountCents: 2637, currency: 'usd', checkoutSessionId: 'cs_1', paymentIntentId: 'pi_1', sellerStripeAccountId: 'acct_1' } satisfies StripePurchaseRecord;

describe('fulfillDepsFromEnv', () => {
	it('sends the receipt after the answer when given a way to, so the buyer returning from Stripe never waits on it', async () => {
		const sent: string[] = [];
		const later: Array<Promise<unknown>> = [];
		const env = { DB: recordingD1().d1, CUSTOM_DOMAIN: 'estori.app', EMAIL: { send: async (message: { to: string }) => (sent.push(message.to), { messageId: 'm1' }) } } as unknown as Env;
		await fulfillDepsFromEnv(env, (sending) => void later.push(sending)).sendReceipt(PURCHASE, 'checkout@example.com');
		expect(sent).toEqual([]);
		await Promise.all(later);
		expect(sent).toEqual(['checkout@example.com']);
		await fulfillDepsFromEnv(env).sendReceipt(PURCHASE, 'checkout@example.com');
		expect(sent).toHaveLength(2);
	});
});

describe('fulfillDepsFromEnv analytics', () => {
	/** The purchase inserts, then the seller's lookup fails. */
	const sellerLookupFails = () =>
		recordingD1((sql) => {
			const statement = sql.toLowerCase();
			if (statement.includes('insert into "template_purchases"')) return [['purchase_1']];
			if (statement.includes('"stripe_connect_accounts"')) throw new Error('D1 is unavailable');
			return [];
		}).d1;

	it("still records the purchase, and warns, when the listing's seller cannot be found", async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const env = { DB: sellerLookupFails() } as unknown as Env;
		expect(await fulfillDepsFromEnv(env).recordStripePurchase(PURCHASE)).toBe(true);
		expect(captured).toEqual([]);
		const logged = warn.mock.calls.map(([line]) => String(line));
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain('Could not find the seller of a template sale');
		expect(logged[0]).toContain('"sellerStripeAccountId":"acct_1"');
		expect(logged[0]).toContain('D1 is unavailable');
	});
});
