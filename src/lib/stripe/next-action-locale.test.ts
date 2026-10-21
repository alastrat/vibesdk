/** The bank's confirmation step opens Stripe.js in the seller's language and words its own failure in it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvoicePaymentResult } from '@/api-types';
import { applyAccountLocale, t } from '@/lib/i18n';
import { describePaymentResult } from '@/routes/settings/billing-view';
import { NEXT_ACTION_FAILED_MESSAGE, settlePayment } from './next-action';
import { loadStripe } from './stripe-js';

vi.mock('./stripe-js', () => ({
	loadStripe: vi.fn(async () => ({ handleNextAction: async () => ({ paymentIntent: { status: 'succeeded' } }) })),
}));

const NEEDS_BANK: InvoicePaymentResult = { state: 'requires_action', clientSecret: 'pi_1_secret_x', publishableKey: 'pk_test_1' };

afterEach(async () => {
	vi.mocked(loadStripe).mockClear();
	await applyAccountLocale('en');
});

describe("the bank's confirmation", () => {
	it('opens Stripe.js in the active language, whatever the language is when it runs', async () => {
		await settlePayment(NEEDS_BANK);
		await applyAccountLocale('es');
		await settlePayment(NEEDS_BANK);
		await applyAccountLocale('pt-BR');
		await settlePayment(NEEDS_BANK);
		expect(vi.mocked(loadStripe).mock.calls).toEqual([
			['pk_test_1', 'en'],
			['pk_test_1', 'es'],
			['pk_test_1', 'pt-BR'],
		]);
	});

	it('words its own failure in the seller\'s language where the page shows it', async () => {
		const declined = { state: 'declined', message: NEXT_ACTION_FAILED_MESSAGE } as const;
		expect(describePaymentResult(declined).message).toBe("Your bank didn't confirm the payment. Try again, or update your card.");
		await applyAccountLocale('es');
		expect(describePaymentResult(declined).message).toBe('Tu banco no confirmó el pago. Inténtalo de nuevo o actualiza tu tarjeta.');
		await applyAccountLocale('pt-BR');
		expect(t(NEXT_ACTION_FAILED_MESSAGE)).toBe('Seu banco não confirmou o pagamento. Tente novamente ou atualize seu cartão.');
	});
});
