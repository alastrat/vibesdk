import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import { billingEmail, type BillingEmail } from '../billing/notices';

const TO = 'ana@example.test';
const BASE = 'https://estori.app';
const NOV_5 = Date.UTC(2026, 10, 5, 10);

const text = (email: BillingEmail) => billingEmail(TO, email, BASE);

describe('billing emails', () => {
	it('welcomes a new plan with its credits, renewal date and price', () => {
		const started = text({ kind: 'plan_started', plan: 'pro', renewsAt: NOV_5 });
		expect(started.subject).toBe('Welcome to Estori Pro');
		expect(started.text).toContain('Your account now has 20,000 AI credits a month, up to 3 live stores, your own domains and the supplier catalog. Pro renews on November 5 at $49 a month until you cancel.');
		expect(started.text).toContain('Manage billing: https://estori.app/settings/billing');
		expect(started.text).not.toContain('buy extra credits');
		expect(text({ kind: 'plan_started', plan: 'premium', renewsAt: NOV_5 }).text).toContain('Premium renews on November 5 at $199 a month until you cancel. When you need more, you can buy extra credits.');
	});

	it('sends receipts with the amount, the period, the invoice and the seller of record', () => {
		const receipt = text({ kind: 'receipt', plan: 'premium', amountCents: 15_000, currency: 'usd', periodStart: Date.UTC(2026, 9, 5), periodEnd: NOV_5, invoiceNumber: 'EST-0002', invoiceUrl: 'https://invoice.stripe.com/i/in_1' });
		expect(receipt.subject).toBe('Your Estori receipt: $150.00');
		expect(receipt.text).toContain('We received $150.00 for Estori Premium, October 5 to November 5.');
		expect(receipt.text).toContain('View invoice: https://invoice.stripe.com/i/in_1');
		expect(receipt.text).toContain('Invoice number: EST-0002');
		expect(receipt.text).toContain('Sold by Globalink Commerce Technologies LLC');
		const credits = text({ kind: 'credits_receipt', credits: 12_000, amountCents: 1_800, expiresAt: Date.UTC(2027, 9, 19), receiptNumber: 'pi_1' });
		expect(credits.subject).toBe('Your Estori receipt: 12,000 AI credits');
		expect(credits.text).toContain("We received $18.00 for 12,000 extra AI credits. They're used after your monthly credits and expire on October 19, 2027.");
		expect(credits.text).toContain('Receipt number: pi_1');
	});

	it('drops the invoice link and number a receipt does not have', () => {
		const receipt = text({ kind: 'receipt', plan: 'pro', amountCents: 4_900, currency: 'usd', periodStart: Date.UTC(2026, 9, 5), periodEnd: NOV_5, invoiceNumber: null, invoiceUrl: null });
		expect(receipt.text).not.toContain('View invoice');
		expect(receipt.text).not.toContain('Invoice number');
		expect(receipt.text).toContain('Amount: $49.00');
	});

	it('explains each plan change in plain words', () => {
		expect(text({ kind: 'plan_upgraded', plan: 'premium' })).toMatchObject({ subject: "You're on Premium now" });
		expect(text({ kind: 'plan_upgraded', plan: 'premium' }).text).toContain("You now have 100,000 AI credits a month, and the credits you've used this month count against them. We charged the difference for the rest of this month; your receipt follows.");
		expect(text({ kind: 'downgrade_scheduled', plan: 'pro', at: NOV_5 })).toMatchObject({ subject: 'Your plan moves to Pro at renewal' });
		expect(text({ kind: 'downgrade_scheduled', plan: 'pro', at: NOV_5 }).text).toContain('On November 5 your plan moves to Pro, with 20,000 AI credits a month at $49. Until then you keep Premium. Extra credits you bought stay yours.');
		expect(text({ kind: 'plan_ending', plan: 'premium', endsAt: NOV_5 })).toMatchObject({ subject: 'Premium ends on November 5' });
		expect(text({ kind: 'plan_ending', plan: 'premium', endsAt: NOV_5 }).text).toContain('You cancelled Premium. It stays on until November 5, then your account moves to Basic. Your stores stay live.');
		expect(text({ kind: 'plan_ended', plan: 'premium', reason: 'payment-failed' }).text).toContain("We couldn't collect the payment for Premium, so it has ended. Your live stores and their domains keep working.");
		expect(text({ kind: 'plan_ended', plan: 'premium', reason: 'cancelled' }).text).toContain('Premium has ended. Your live stores and their domains keep working. To publish more stores or add catalog products, get Pro or Premium again.');
	});

	it("says a failed payment keeps the plan's features but holds the new month's credits until it goes through", () => {
		const failed = text({ kind: 'payment_failed', plan: 'pro', graceEndsAt: NOV_5 });
		expect(failed.subject).toBe("Your Pro payment didn't go through");
		expect(failed.text).toContain("We couldn't charge your card for Estori Pro.");
		expect(failed.text).toContain('Your stores and the features of Pro keep working until November 5 while we retry.');
		expect(failed.text).toContain("Your new month's AI credits start as soon as the payment goes through. Credits you bought still work.");
		expect(failed.text).toContain('Update your card to keep Pro.');
		expect(failed.text).toContain('Update your card: https://estori.app/settings/billing');
		expect(failed.text).not.toContain('Pro continues');
	});

	it('tells every plan its credits renewed, and warns at 20% and 5% left with the next step for the plan', () => {
		expect(text({ kind: 'credits_renewed', credits: 5_000, renewsAt: NOV_5 })).toMatchObject({ subject: 'Your AI credits are renewed' });
		expect(text({ kind: 'credits_renewed', credits: 5_000, renewsAt: NOV_5 }).text).toContain('You have 5,000 AI credits for this month. They last until November 5.');
		expect(text({ kind: 'credits_20', plan: 'basic', left: 1_000, renewsAt: NOV_5 })).toMatchObject({ subject: 'You have 20% of your AI credits left' });
		expect(text({ kind: 'credits_20', plan: 'basic', left: 1_000, renewsAt: NOV_5 }).text).toContain('You have 1,000 AI credits left until November 5. Get Pro for 20,000 a month.');
		expect(text({ kind: 'credits_5', plan: 'pro', left: 1_000, renewsAt: NOV_5 })).toMatchObject({ subject: 'You have 5% of your AI credits left' });
		expect(text({ kind: 'credits_5', plan: 'pro', left: 1_000, renewsAt: NOV_5 }).text).toContain('Move to Premium for 100,000 a month.');
		expect(text({ kind: 'credits_5', plan: 'premium', left: 5_000, renewsAt: NOV_5 }).text).toContain('You have 5,000 AI credits left until November 5. Buy extra credits any time.');
		expect(text({ kind: 'credits_5', plan: 'enterprise', left: 5_000, renewsAt: NOV_5 }).text).toContain('Talk to us if you need more.');
		expect(text({ kind: 'credits_refunded', credits: 3_000, amountCents: 750 }).text).toContain('We refunded $7.50 for extra AI credits, and removed 3,000 unused credits from your account.');
	});

	it('gives every seller a week of notice of the new plans, and tells those over them that their stores stay live', () => {
		const notice = text({ kind: 'enforcement_notice', startsOn: Date.UTC(2026, 10, 1), overLimits: true });
		expect(notice.subject).toBe('Plans and limits on Estori from November 1');
		expect(notice.text).toContain('From November 1, Basic includes 5,000 AI credits a month, 3 stores and 1 live store, without the supplier catalog.');
		expect(notice.text).toContain('Pro, at $49 a month, adds 20,000 credits, 3 live stores, your own domains and the catalog. Premium, at $199 a month, adds 100,000 credits, 10 live stores and extra credits.');
		expect(notice.text).toContain('Your stores stay live; to publish more, get Pro or Premium.');
		expect(notice.text).toContain('See plans: https://estori.app/pricing');
		expect(text({ kind: 'enforcement_notice', startsOn: Date.UTC(2026, 10, 1), overLimits: false }).text).not.toContain('to publish more');
	});

	it('leaves the links out when the deployment has no address', () => {
		expect(billingEmail(TO, { kind: 'plan_started', plan: 'pro', renewsAt: NOV_5 }, null).text).not.toContain('Manage billing');
		expect(billingEmail(TO, { kind: 'enforcement_notice', startsOn: NOV_5, overLimits: false }, null).text).not.toContain('See plans');
	});

	it('names no supplier and no AI assistant', () => {
		const all: BillingEmail[] = [
			{ kind: 'plan_started', plan: 'premium', renewsAt: NOV_5 },
			{ kind: 'credits_5', plan: 'pro', left: 10, renewsAt: NOV_5 },
			{ kind: 'enforcement_notice', startsOn: NOV_5, overLimits: true },
			{ kind: 'payment_failed', plan: 'pro', graceEndsAt: NOV_5 },
			{ kind: 'credits_renewed', credits: 5_000, renewsAt: NOV_5 },
		];
		for (const email of all.map(text)) {
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(`${email.subject} ${email.text}`.toLowerCase(), name).not.toContain(name);
		}
	});
});
