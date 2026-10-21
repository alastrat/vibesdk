import { describe, expect, it, vi } from 'vitest';
import type { InvoicePaymentResult } from '@/api-types';
import { NEXT_ACTION_FAILED_MESSAGE, settlePayment } from './next-action';
import type { StripeJs, StripeNextActionResult } from './stripe-js';

const NEEDS_BANK: InvoicePaymentResult = { state: 'requires_action', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_1' };

/** A loader whose Stripe instance answers the bank's confirmation with `outcome`. */
function bank(outcome: StripeNextActionResult | Error) {
	const handleNextAction = vi.fn(async (_options: { clientSecret: string }) => {
		if (outcome instanceof Error) throw outcome;
		return outcome;
	});
	const load = vi.fn(async (_publishableKey: string): Promise<Pick<StripeJs, 'handleNextAction'>> => ({ handleNextAction }));
	return { load, handleNextAction };
}

describe('finishing a payment the bank asked the seller to confirm', () => {
	it('hands every answer that needs nothing more straight back, without opening Stripe.js', async () => {
		const { load } = bank({ error: { message: 'unused' } });
		for (const result of [{ state: 'paid' }, { state: 'saved' }, { state: 'nothing_due' }, { state: 'declined', message: 'No funds.' }] as const) {
			expect(await settlePayment(result, load)).toEqual(result);
		}
		expect(load).not.toHaveBeenCalled();
	});

	it("opens Stripe.js with the answer's key and hands the bank the answer's secret", async () => {
		const { load, handleNextAction } = bank({ paymentIntent: { status: 'succeeded' } });
		expect(await settlePayment(NEEDS_BANK, load)).toEqual({ state: 'paid' });
		expect(load).toHaveBeenCalledWith('pk_test_1');
		expect(handleNextAction).toHaveBeenCalledWith({ clientSecret: 'pi_1_secret_x' });
	});

	it('counts a payment the bank accepted and Stripe is still settling as paid', async () => {
		expect(await settlePayment(NEEDS_BANK, bank({ paymentIntent: { status: 'processing' } }).load)).toEqual({ state: 'paid' });
	});

	it("shows the bank's own words when the seller fails or leaves the confirmation", async () => {
		const failed = bank({ error: { message: 'We are unable to authenticate your payment method.', code: 'payment_intent_authentication_failure' } });
		expect(await settlePayment(NEEDS_BANK, failed.load)).toEqual({ state: 'declined', message: 'We are unable to authenticate your payment method.' });
		const wordless = bank({ error: {} });
		expect(await settlePayment(NEEDS_BANK, wordless.load)).toEqual({ state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE });
	});

	it('says the payment is not done when the intent is back in any state but paid', async () => {
		for (const status of ['requires_payment_method', 'requires_action', 'requires_confirmation', 'canceled']) {
			expect(await settlePayment(NEEDS_BANK, bank({ paymentIntent: { status } }).load), status).toEqual({ state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE });
		}
	});

	it('shows the plain failure when Stripe.js will not load or the call throws, never a thrown error', async () => {
		const offline = vi.fn(async (): Promise<Pick<StripeJs, 'handleNextAction'>> => {
			throw new Error('Stripe could not load');
		});
		expect(await settlePayment(NEEDS_BANK, offline)).toEqual({ state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE });
		expect(await settlePayment(NEEDS_BANK, bank(new Error('socket closed')).load)).toEqual({ state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE });
	});
});
