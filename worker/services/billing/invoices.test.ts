import { describe, expect, it } from 'vitest';
import type { StripeClient, StripeInvoice, StripePaymentMethod } from '../payments/stripe-client';
import { cardOnFile, historyOf, invoiceSubscriptionId, invoiceView, setDefaultCard } from './invoices';

function invoice(overrides: Partial<StripeInvoice> = {}): StripeInvoice {
	return {
		id: 'in_1',
		customer: 'cus_1',
		status: 'paid',
		created: 1_760_000_000,
		amount_due: 4_900,
		amount_paid: 2_450,
		total: 4_900,
		currency: 'usd',
		hosted_invoice_url: 'https://invoice.stripe.com/i/acct/x',
		invoice_pdf: 'https://pay.stripe.com/invoice/x/pdf',
		number: 'ABCD-0001',
		description: null,
		lines: { data: [{ description: '1 x Estori Pro (at $49.00 / month)' }, { description: 'Another line' }] },
		billing_reason: 'subscription_cycle',
		parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_1' } },
		...overrides,
	};
}

describe('the billing history row of a stripe invoice', () => {
	it('maps a stripe invoice to the history row', () => {
		expect(invoiceView(invoice())).toEqual({ id: 'in_1', date: 1_760_000_000_000, description: '1 x Estori Pro (at $49.00 / month)', amountCents: 2_450, currency: 'usd', status: 'paid' });
		expect(invoiceView(invoice({ status: 'open', amount_paid: 0, amount_due: 4_900 }))).toMatchObject({ amountCents: 4_900, status: 'open' });
		expect(invoiceView(invoice({ status: 'void', amount_paid: 0 }))).toMatchObject({ amountCents: 4_900, status: 'void' });
		expect(invoiceView(invoice({ status: 'uncollectible', amount_paid: 0 }))).toMatchObject({ status: 'uncollectible' });
	});

	it("describes an invoice with no line by the invoice's own description, else by its owner", () => {
		expect(invoiceView(invoice({ lines: { data: [] }, description: 'Extra credits' }))).toMatchObject({ description: 'Extra credits' });
		expect(invoiceView(invoice({ lines: undefined, description: null }))).toMatchObject({ description: 'Estori invoice' });
		expect(invoiceView(invoice({ lines: { data: [{ description: null }] }, description: null }))).toMatchObject({ description: 'Estori invoice' });
	});

	it('drafts are left out', () => {
		expect(invoiceView(invoice({ status: 'draft' }))).toBeNull();
		const rows = historyOf([invoice({ id: 'in_3', status: 'draft' }), invoice({ id: 'in_2', status: 'open' }), invoice({ id: 'in_1' })]);
		expect(rows.map((row) => row.id)).toEqual(['in_2', 'in_1']);
	});

	it('keeps the order Stripe lists them in', () => {
		const rows = historyOf([invoice({ id: 'in_3', created: 3 }), invoice({ id: 'in_2', created: 2 }), invoice({ id: 'in_1', created: 1 })]);
		expect(rows.map((row) => row.id)).toEqual(['in_3', 'in_2', 'in_1']);
	});
});

describe('the subscription an invoice belongs to', () => {
	it("reads it from the invoice's parent, and is null for an invoice outside a subscription", () => {
		expect(invoiceSubscriptionId(invoice())).toBe('sub_1');
		expect(invoiceSubscriptionId(invoice({ parent: null }))).toBeNull();
		expect(invoiceSubscriptionId(invoice({ parent: { type: 'quote_details' } }))).toBeNull();
	});
});

type CardReads = Pick<StripeClient, 'retrieveCustomer' | 'retrievePaymentMethod'>;

function cardReads(customerDefault: string | { id: string } | null | undefined, method: StripePaymentMethod | null): { stripe: CardReads; calls: string[] } {
	const calls: string[] = [];
	const stripe: CardReads = {
		retrieveCustomer: async (id) => {
			calls.push(`customer:${id}`);
			return { id, email: null, metadata: null, invoice_settings: customerDefault === undefined ? undefined : { default_payment_method: customerDefault } };
		},
		retrievePaymentMethod: async (id) => {
			calls.push(`method:${id}`);
			return method ?? { id, card: null };
		},
	};
	return { stripe, calls };
}

describe('the card on file', () => {
	it('reads the card on file from the default payment method', async () => {
		const { stripe, calls } = cardReads('pm_1', { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 } });
		expect(await cardOnFile(stripe, 'cus_1')).toEqual({ brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 });
		expect(calls).toEqual(['customer:cus_1', 'method:pm_1']);
	});

	it('reads a default payment method that Stripe sent as an object', async () => {
		const { stripe, calls } = cardReads({ id: 'pm_2' }, { id: 'pm_2', card: { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2030 } });
		expect(await cardOnFile(stripe, 'cus_1')).toMatchObject({ brand: 'mastercard', last4: '4444' });
		expect(calls).toEqual(['customer:cus_1', 'method:pm_2']);
	});

	it('is null without a default payment method, and for one that is not a card', async () => {
		const none = cardReads(null, null);
		expect(await cardOnFile(none.stripe, 'cus_1')).toBeNull();
		expect(none.calls).toEqual(['customer:cus_1']);
		expect(await cardOnFile(cardReads(undefined, null).stripe, 'cus_1')).toBeNull();
		expect(await cardOnFile(cardReads('pm_3', { id: 'pm_3', card: null }).stripe, 'cus_1')).toBeNull();
	});
});

describe('the default card', () => {
	it("is set on the customer and the subscription through one call, or the customer alone with no subscription", async () => {
		const sent: unknown[] = [];
		const stripe: Pick<StripeClient, 'setDefaultPaymentMethod'> = { setDefaultPaymentMethod: async (input) => void sent.push(input) };
		await setDefaultCard(stripe, 'cus_1', 'sub_1', 'pm_9');
		await setDefaultCard(stripe, 'cus_1', null, 'pm_9');
		expect(sent).toEqual([
			{ customerId: 'cus_1', subscriptionId: 'sub_1', paymentMethodId: 'pm_9' },
			{ customerId: 'cus_1', subscriptionId: null, paymentMethodId: 'pm_9' },
		]);
	});
});
