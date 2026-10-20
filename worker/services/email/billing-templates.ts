/** Estori's own emails about plans, payments and AI credits. Stripe sends none of them. */

import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '../../../shared/types/legal';
import { PLAN_LIMITS, PLAN_PRICES_CENTS, formatBillingDate, formatCredits, formatUsd, planName } from '../../../shared/types/plans';
import type { BillingEmail } from '../billing/notices';
import { renderEmail } from './templates';
import type { OutgoingEmail } from './types';

/** Where the emails send the reader; null without a configured domain, which drops the button. */
export interface BillingLinks {
	billing: string | null;
	pricing: string | null;
}

type EmailOf<K extends BillingEmail['kind']> = Extract<BillingEmail, { kind: K }>;

const STORES_STAY_LIVE = "Your stores stay live whatever plan you're on.";

const RECEIPT_FOOTER = `Sold by ${LEGAL_ENTITY.name}, ${legalAddressLine()}. For help, email ${LEGAL_CONTACT.support}.`;

function action(label: string, link: string | null): { action?: { label: string; link: string } } {
	return link ? { action: { label, link } } : {};
}

function paid(cents: number, currency: string): string {
	return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

function dateWithYear(ms: number): string {
	return `${formatBillingDate(ms)}, ${new Date(ms).getUTCFullYear()}`;
}

/** "3 live stores", or "unlimited live stores" when the plan has no cap. */
function stores(limit: number | null, noun: string): string {
	if (limit === null) return `unlimited ${noun}s`;
	return `${limit} ${noun}${limit === 1 ? '' : 's'}`;
}

export function planStartedEmail(to: string, email: EmailOf<'plan_started'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	const limits = PLAN_LIMITS[email.plan];
	const more = email.plan === 'premium' ? ' When you need more, you can buy extra credits.' : '';
	return renderEmail({
		to,
		subject: `Welcome to Estori ${plan}`,
		heading: `Welcome to ${plan}`,
		body: `Your account now has ${formatCredits(limits.aiCredits)} AI credits a month, up to ${stores(limits.liveStores, 'live store')}, your own domains and the supplier catalog. ${plan} renews on ${formatBillingDate(email.renewsAt)} at ${formatUsd(PLAN_PRICES_CENTS[email.plan])} a month until you cancel.${more}`,
		...action('Manage billing', links.billing),
		footer: `Cancel any time in Estori; ${plan} then runs to the end of the month you paid for.`,
	});
}

export function planReceiptEmail(to: string, email: EmailOf<'receipt'>): OutgoingEmail {
	const plan = planName(email.plan);
	const amount = paid(email.amountCents, email.currency);
	return renderEmail({
		to,
		subject: `Your Estori receipt: ${amount}`,
		heading: 'Thanks for your payment',
		body: `We received ${amount} for Estori ${plan}, ${formatBillingDate(email.periodStart)} to ${formatBillingDate(email.periodEnd)}.`,
		...action('View invoice', email.invoiceUrl),
		details: [
			['Amount', amount],
			['Period', `${formatBillingDate(email.periodStart)} to ${formatBillingDate(email.periodEnd)}`],
			...(email.invoiceNumber ? [['Invoice number', email.invoiceNumber] as const] : []),
		],
		footer: RECEIPT_FOOTER,
	});
}

export function planUpgradedEmail(to: string, email: EmailOf<'plan_upgraded'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	return renderEmail({
		to,
		subject: `You're on ${plan} now`,
		heading: `You're on ${plan}`,
		body: `You now have ${formatCredits(PLAN_LIMITS[email.plan].aiCredits)} AI credits a month, and the credits you've used this month count against them. We charged the difference for the rest of this month; your receipt follows.`,
		...action('Manage billing', links.billing),
		footer: STORES_STAY_LIVE,
	});
}

/** Premium to Pro is the only downgrade, so the plan the account keeps until then is Premium. */
export function downgradeScheduledEmail(to: string, email: EmailOf<'downgrade_scheduled'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	return renderEmail({
		to,
		subject: `Your plan moves to ${plan} at renewal`,
		heading: `Your plan moves to ${plan}`,
		body: `On ${formatBillingDate(email.at)} your plan moves to ${plan}, with ${formatCredits(PLAN_LIMITS[email.plan].aiCredits)} AI credits a month at ${formatUsd(PLAN_PRICES_CENTS[email.plan])}. Until then you keep ${planName('premium')}. Extra credits you bought stay yours.`,
		...action('Manage billing', links.billing),
		footer: STORES_STAY_LIVE,
	});
}

/** The plan's features keep working through the grace period, but the new month's credits wait for the payment. */
export function paymentFailedEmail(to: string, email: EmailOf<'payment_failed'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	return renderEmail({
		to,
		subject: `Your ${plan} payment didn't go through`,
		heading: "Your payment didn't go through",
		body: `We couldn't charge your card for Estori ${plan}. Your stores and the features of ${plan} keep working until ${formatBillingDate(email.graceEndsAt)} while we retry. Your new month's AI credits start as soon as the payment goes through. Credits you bought still work. Update your card to keep ${plan}.`,
		...action('Update your card', links.billing),
		footer: STORES_STAY_LIVE,
	});
}

export function planEndingEmail(to: string, email: EmailOf<'plan_ending'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	const date = formatBillingDate(email.endsAt);
	return renderEmail({
		to,
		subject: `${plan} ends on ${date}`,
		heading: `${plan} ends on ${date}`,
		body: `You cancelled ${plan}. It stays on until ${date}, then your account moves to Basic. Your stores stay live.`,
		...action(`Keep ${plan}`, links.billing),
		footer: `Changed your mind? Keep ${plan} from your billing page before ${date}.`,
	});
}

export function planEndedEmail(to: string, email: EmailOf<'plan_ended'>, links: BillingLinks): OutgoingEmail {
	const plan = planName(email.plan);
	const ended = email.reason === 'cancelled' ? `${plan} has ended.` : `We couldn't collect the payment for ${plan}, so it has ended.`;
	return renderEmail({
		to,
		subject: 'Your account is on Basic now',
		heading: 'Your account is on Basic',
		body: `${ended} Your live stores and their domains keep working. To publish more stores or add catalog products, get Pro or Premium again.`,
		...action('See plans', links.pricing),
		footer: STORES_STAY_LIVE,
	});
}

export function creditsRenewedEmail(to: string, email: EmailOf<'credits_renewed'>, links: BillingLinks): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Your AI credits are renewed',
		heading: 'Your AI credits are renewed',
		body: `You have ${formatCredits(email.credits)} AI credits for this month. They last until ${formatBillingDate(email.renewsAt)}.`,
		...action('See your credits', links.billing),
		footer: 'We send this when your credits renew.',
	});
}

/** What a plan can do next when its credits run low. */
function nextStep(plan: EmailOf<'credits_20' | 'credits_5'>['plan']): string {
	switch (plan) {
		case 'basic':
			return `Get Pro for ${formatCredits(PLAN_LIMITS.pro.aiCredits)} a month.`;
		case 'pro':
			return `Move to Premium for ${formatCredits(PLAN_LIMITS.premium.aiCredits)} a month.`;
		case 'premium':
			return 'Buy extra credits any time.';
		case 'enterprise':
			return 'Talk to us if you need more.';
	}
}

export function creditsLowEmail(to: string, email: EmailOf<'credits_20' | 'credits_5'>, links: BillingLinks): OutgoingEmail {
	const percent = email.kind === 'credits_20' ? 20 : 5;
	return renderEmail({
		to,
		subject: `You have ${percent}% of your AI credits left`,
		heading: `${percent}% of your AI credits left`,
		body: `You have ${formatCredits(email.left)} AI credits left until ${formatBillingDate(email.renewsAt)}. ${nextStep(email.plan)}`,
		...action('See your credits', links.billing),
		footer: 'We send each of these once a month.',
	});
}

export function creditsReceiptEmail(to: string, email: EmailOf<'credits_receipt'>, links: BillingLinks): OutgoingEmail {
	const amount = paid(email.amountCents, 'usd');
	const credits = formatCredits(email.credits);
	return renderEmail({
		to,
		subject: `Your Estori receipt: ${credits} AI credits`,
		heading: 'Thanks for your purchase',
		body: `We received ${amount} for ${credits} extra AI credits. They're used after your monthly credits and expire on ${dateWithYear(email.expiresAt)}.`,
		...action('See your credits', links.billing),
		details: [
			['Amount', amount],
			['Credits', credits],
			['Expires', dateWithYear(email.expiresAt)],
			['Receipt number', email.receiptNumber],
		],
		footer: RECEIPT_FOOTER,
	});
}

export function creditsRefundedEmail(to: string, email: EmailOf<'credits_refunded'>, links: BillingLinks): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'We refunded your extra credits',
		heading: 'Your extra credits were refunded',
		body: `We refunded ${paid(email.amountCents, 'usd')} for extra AI credits, and removed ${formatCredits(email.credits)} unused credits from your account.`,
		...action('See your credits', links.billing),
		footer: 'Your bank may take 5 to 10 business days to show the refund.',
	});
}

export function enforcementNoticeEmail(to: string, email: EmailOf<'enforcement_notice'>, links: BillingLinks): OutgoingEmail {
	const date = formatBillingDate(email.startsOn);
	const { basic, pro, premium } = PLAN_LIMITS;
	const plans =
		`From ${date}, Basic includes ${formatCredits(basic.aiCredits)} AI credits a month, ${stores(basic.storesLifetime, 'store')} and ${stores(basic.liveStores, 'live store')}, without the supplier catalog. ` +
		`Pro, at ${formatUsd(PLAN_PRICES_CENTS.pro)} a month, adds ${formatCredits(pro.aiCredits)} credits, ${stores(pro.liveStores, 'live store')}, your own domains and the catalog. ` +
		`Premium, at ${formatUsd(PLAN_PRICES_CENTS.premium)} a month, adds ${formatCredits(premium.aiCredits)} credits, ${stores(premium.liveStores, 'live store')} and extra credits.`;
	return renderEmail({
		to,
		subject: `Plans and limits on Estori from ${date}`,
		heading: 'Plans and limits are changing',
		body: `${plans}${email.overLimits ? ' Your stores stay live; to publish more, get Pro or Premium.' : ' Your stores stay live.'}`,
		...action('See plans', links.pricing),
		footer: 'Building on Estori stays free.',
	});
}
