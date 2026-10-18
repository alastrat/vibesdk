import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { fulfillDepsFromEnv } from './purchase-wiring';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';

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
