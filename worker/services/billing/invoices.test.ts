import { describe, expect, it } from 'vitest';
import type { StripeClient, StripeInvoice, StripePaymentMethod } from '../payments/stripe-client';
import { cardOnFile, chargedPaymentMethod, historyOf, invoiceSubscriptionId, invoiceView, setDefaultCard } from './invoices';

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

type CardReads = Pick<StripeClient, 'retrieveCustomer' | 'retrieveSubscription' | 'retrievePaymentMethod'>;

type CardRef = string | { id: string } | null;

/** Stripe as `cardOnFile` reads it: the customer's and the subscription's default cards, and the cards each payment method id names. */
function cardReads(state: { customer?: CardRef; subscription?: CardRef; cards?: Record<string, NonNullable<StripePaymentMethod['card']>> }): { stripe: CardReads; calls: string[] } {
	const calls: string[] = [];
	const stripe: CardReads = {
		retrieveCustomer: async (id) => {
			calls.push(`customer:${id}`);
			return { id, email: null, metadata: null, invoice_settings: state.customer === undefined ? undefined : { default_payment_method: state.customer } };
		},
		retrieveSubscription: async (id) => {
			calls.push(`subscription:${id}`);
			return {
				id,
				customer: 'cus_1',
				status: 'active',
				created: 1,
				cancel_at_period_end: false,
				cancel_at: null,
				metadata: null,
				items: { data: [] },
				schedule: null,
				default_payment_method: state.subscription ?? null,
			};
		},
		retrievePaymentMethod: async (id) => {
			calls.push(`method:${id}`);
			return { id, card: state.cards?.[id] ?? null };
		},
	};
	return { stripe, calls };
}

const VISA = { brand: 'visa', last4: '4242', exp_month: 8, exp_year: 2028 };
const MASTERCARD = { brand: 'mastercard', last4: '4444', exp_month: 1, exp_year: 2030 };

describe('the card on file', () => {
	it("reads the card on file from the customer's default payment method when there is no subscription", async () => {
		const { stripe, calls } = cardReads({ customer: 'pm_1', cards: { pm_1: VISA } });
		expect(await cardOnFile(stripe, 'cus_1', null)).toEqual({ brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 });
		expect(calls).toEqual(['customer:cus_1', 'method:pm_1']);
	});

	it("the card on file comes from the subscription's default when the customer has none", async () => {
		const { stripe, calls } = cardReads({ customer: null, subscription: 'pm_sub', cards: { pm_sub: MASTERCARD } });
		expect(await cardOnFile(stripe, 'cus_1', 'sub_1')).toEqual({ brand: 'mastercard', last4: '4444', expMonth: 1, expYear: 2030 });
		expect(calls).toEqual(['subscription:sub_1', 'method:pm_sub']);
	});

	it("the customer's default is used when the subscription has none", async () => {
		const { stripe, calls } = cardReads({ customer: 'pm_cus', subscription: null, cards: { pm_cus: VISA } });
		expect(await cardOnFile(stripe, 'cus_1', 'sub_1')).toMatchObject({ brand: 'visa', last4: '4242' });
		expect(calls).toEqual(['subscription:sub_1', 'customer:cus_1', 'method:pm_cus']);
	});

	it("prefers the subscription's own card, the one Stripe charges, over the customer's", async () => {
		const { stripe, calls } = cardReads({ customer: 'pm_cus', subscription: 'pm_sub', cards: { pm_cus: VISA, pm_sub: MASTERCARD } });
		expect(await cardOnFile(stripe, 'cus_1', 'sub_1')).toMatchObject({ brand: 'mastercard' });
		expect(calls).toEqual(['subscription:sub_1', 'method:pm_sub']);
	});

	it('reads defaults that Stripe sent as objects', async () => {
		const fromSubscription = cardReads({ subscription: { id: 'pm_a' }, cards: { pm_a: MASTERCARD } });
		expect(await cardOnFile(fromSubscription.stripe, 'cus_1', 'sub_1')).toMatchObject({ last4: '4444' });
		const fromCustomer = cardReads({ customer: { id: 'pm_b' }, cards: { pm_b: VISA } });
		expect(await cardOnFile(fromCustomer.stripe, 'cus_1', null)).toMatchObject({ last4: '4242' });
		expect(fromCustomer.calls).toEqual(['customer:cus_1', 'method:pm_b']);
	});

	it('is null with no default anywhere, and for one that is not a card', async () => {
		const none = cardReads({ customer: null, subscription: null });
		expect(await cardOnFile(none.stripe, 'cus_1', 'sub_1')).toBeNull();
		expect(none.calls).toEqual(['subscription:sub_1', 'customer:cus_1']);
		expect(await cardOnFile(cardReads({}).stripe, 'cus_1', null)).toBeNull();
		expect(await cardOnFile(cardReads({ customer: 'pm_3' }).stripe, 'cus_1', null)).toBeNull();
	});
});

describe('the card Stripe charges', () => {
	it("is the subscription's own default, else the customer's, else none", async () => {
		const both = cardReads({ customer: 'pm_cus' });
		expect(await chargedPaymentMethod(both.stripe, 'cus_1', { default_payment_method: 'pm_sub' })).toBe('pm_sub');
		expect(both.calls).toEqual([]);
		expect(await chargedPaymentMethod(both.stripe, 'cus_1', { default_payment_method: null })).toBe('pm_cus');
		expect(await chargedPaymentMethod(both.stripe, 'cus_1', null)).toBe('pm_cus');
		expect(await chargedPaymentMethod(cardReads({}).stripe, 'cus_1', null)).toBeNull();
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
