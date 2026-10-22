import { msg } from '../../../shared/i18n/translate';
import { INTL_LOCALE, type Locale } from '../../../shared/i18n/locales';
import { serverT } from '../i18n/server-t';
/** Estori's own emails about plans, payments and AI credits. Stripe sends none of them. */

import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '../../../shared/types/legal';
import { PLAN_LIMITS, PLAN_PRICES_CENTS, planPriceCents, formatBillingDate, formatCredits, formatUsd, planName } from '../../../shared/types/plans';
import type { BillingEmail } from '../billing/notices';
import { renderEmail } from './templates';
import type { OutgoingEmail } from './types';

/** Where the emails send the reader; null without a configured domain, which drops the button. */
export interface BillingLinks {
	billing: string | null;
	pricing: string | null;
}

type EmailOf<K extends BillingEmail['kind']> = Extract<BillingEmail, { kind: K }>;

const STORES_STAY_LIVE = msg("Your stores stay live whatever plan you're on.");

function receiptFooter(locale: Locale): string {
 return serverT(locale).t('Sold by {name}, {address}. For help, email {email}.', { name: LEGAL_ENTITY.name, address: legalAddressLine(), email: LEGAL_CONTACT.support });
}

function action(label: string, link: string | null): { action?: { label: string; link: string } } {
	return link ? { action: { label, link } } : {};
}

function paid(cents: number, currency: string, locale: Locale): string {
	return new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

function dateWithYear(ms: number, locale: Locale): string {
	return new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: 'long', timeZone: 'UTC' }).format(ms);
}

/** "3 live stores", or "unlimited live stores" when the plan has no cap. */
function stores(limit: number | null, noun: 'store' | 'live store', locale: Locale): string {
 const {t,tn}=serverT(locale);
 if(limit===null)return noun==='store'?t('unlimited stores'):t('unlimited live stores');
 return noun==='store'?tn('{count} store','{count} stores',limit):tn('{count} live store','{count} live stores',limit);
}

export function planStartedEmail(to: string, email: EmailOf<'plan_started'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	const limits = PLAN_LIMITS[email.plan];
	const more = t(' When you need more, you can buy extra credits.');
	return renderEmail({
		locale,
		to,
		subject: t("Welcome to Estori {value1}", { value1: plan }),
		heading: t("Welcome to {value1}", { value1: plan }),
		body: email.billingInterval === 'year' ? t('Your account now has {credits} AI credits each month. {plan} renews on {date} at {amount} a year until you cancel.', { credits: formatCredits(email.monthlyCredits ?? limits.aiCredits, locale), plan, date: formatBillingDate(email.renewsAt, locale), amount: formatUsd(planPriceCents(email.plan, 'year', email.monthlyCredits), locale) }) : t("Your account now has {value1} AI credits a month, up to {value2}, your own domains and the supplier catalog. {value3} renews on {value4} at {value5} a month until you cancel.{value6}", { value1: formatCredits(email.monthlyCredits ?? limits.aiCredits, locale), value2: stores(limits.liveStores, 'live store', locale), value3: plan, value4: formatBillingDate(email.renewsAt, locale), value5: formatUsd(planPriceCents(email.plan, 'month', email.monthlyCredits), locale), value6: more }),
		...action(t('Open billing'), links.billing),
		footer: email.billingInterval === 'year' ? t('Cancel any time in Estori; your plan runs to the end of the year you paid for.') : t("Cancel any time in Estori; {value1} then runs to the end of the month you paid for.", { value1: plan }),
	});
}

export function planReceiptEmail(to: string, email: EmailOf<'receipt'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	const amount = paid(email.amountCents, email.currency, locale);
	return renderEmail({
		locale,
		to,
		subject: t("Your Estori receipt: {value1}", { value1: amount }),
		heading: t('Thanks for your payment'),
		body: t("We received {value1} for Estori {value2}, {value3} to {value4}.", { value1: amount, value2: plan, value3: formatBillingDate(email.periodStart, locale), value4: formatBillingDate(email.periodEnd, locale) }),
		...action(t('View invoice'), links.billing && `${links.billing}#history`),
		details: [
			[t('Amount'), amount],
			[t('Period'), t("{value1} to {value2}", { value1: formatBillingDate(email.periodStart, locale), value2: formatBillingDate(email.periodEnd, locale) })],
			...(email.invoiceNumber ? [[t('Invoice number'), email.invoiceNumber] as const] : []),
		],
		footer: receiptFooter(locale),
	});
}

export function planUpgradedEmail(to: string, email: EmailOf<'plan_upgraded'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	return renderEmail({
		locale,
		to,
		subject: t("You're on {value1} now", { value1: plan }),
		heading: t("You're on {value1}", { value1: plan }),
		body: email.billingInterval === 'year' ? t('You now have {credits} AI credits a month. This month’s usage counts against them. We charged the difference for the rest of your paid year; your receipt follows.', { credits: formatCredits(email.monthlyCredits ?? PLAN_LIMITS[email.plan].aiCredits, locale) }) : t("You now have {value1} AI credits a month, and the credits you've used this month count against them. We charged the difference for the rest of this month; your receipt follows.", { value1: formatCredits(email.monthlyCredits ?? PLAN_LIMITS[email.plan].aiCredits, locale) }),
		...action(t('Open billing'), links.billing),
		footer: t(STORES_STAY_LIVE),
	});
}

/** Premium to Pro is the only downgrade, so the plan the account keeps until then is Premium. */
export function downgradeScheduledEmail(to: string, email: EmailOf<'downgrade_scheduled'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	return renderEmail({
		locale,
		to,
		subject: t("Your plan moves to {value1} at renewal", { value1: plan }),
		heading: t("Your plan moves to {value1}", { value1: plan }),
		body: email.billingInterval === 'year' ? t('On {date} your plan moves to {plan}, at {amount} a year with {credits} AI credits each month. Your extra credits stay yours.', { date: formatBillingDate(email.at, locale), plan, amount: formatUsd(planPriceCents(email.plan, 'year', email.monthlyCredits), locale), credits: formatCredits(email.monthlyCredits ?? PLAN_LIMITS[email.plan].aiCredits, locale) }) : t("On {value1} your plan moves to {value2}, with {value3} AI credits a month at {value4}. Until then you keep {value5}. Extra credits you bought stay yours.", { value1: formatBillingDate(email.at, locale), value2: plan, value3: formatCredits(email.monthlyCredits ?? PLAN_LIMITS[email.plan].aiCredits, locale), value4: formatUsd(planPriceCents(email.plan, 'month', email.monthlyCredits), locale), value5: planName('premium') }),
		...action(t('Open billing'), links.billing),
		footer: t(STORES_STAY_LIVE),
	});
}

/** The plan's features keep working through the grace period, but the new month's credits wait for the payment. */
export function paymentFailedEmail(to: string, email: EmailOf<'payment_failed'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	const next = email.needsConfirmation
		? t('Your bank asked you to confirm this payment. Open billing and choose Pay now.')
		: t('Your card was declined. Open billing to pay with this card again or a new one.');
	return renderEmail({
		locale,
		to,
		subject: t("Your {value1} payment didn't go through", { value1: plan }),
		heading: t("Your payment didn't go through"),
		body: t("We couldn't charge your card for Estori {value1}. Your stores and the features of {value2} keep working until {value3} while we retry. Your new month's AI credits start as soon as the payment goes through. Credits you bought still work. {value4}", { value1: plan, value2: plan, value3: formatBillingDate(email.graceEndsAt, locale), value4: next }),
		...action(t('Open billing'), links.billing),
		footer: t(STORES_STAY_LIVE),
	});
}

export function planEndingEmail(to: string, email: EmailOf<'plan_ending'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	const date = formatBillingDate(email.endsAt, locale);
	return renderEmail({
		locale,
		to,
		subject: t("{value1} ends on {value2}", { value1: plan, value2: date }),
		heading: t("{value1} ends on {value2}", { value1: plan, value2: date }),
		body: t("You cancelled {value1}. It stays on until {value2}, then your account moves to Basic. Your stores stay live.", { value1: plan, value2: date }),
		...action(t("Keep {value1}", { value1: plan }), links.billing),
		footer: t("Changed your mind? Keep {value1} from your billing page before {value2}.", { value1: plan, value2: date }),
	});
}

export function planEndedEmail(to: string, email: EmailOf<'plan_ended'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const plan = planName(email.plan);
	const ended = email.reason === 'cancelled' ? t("{value1} has ended.", { value1: plan }) : t("We couldn't collect the payment for {value1}, so it has ended.", { value1: plan });
	return renderEmail({
		locale,
		to,
		subject: t('Your account is on Basic now'),
		heading: t('Your account is on Basic'),
		body: t("{value1} Your live stores and their domains keep working. To publish more stores or add catalog products, get Pro or Premium again.", { value1: ended }),
		...action(t('See plans'), links.pricing),
		footer: t(STORES_STAY_LIVE),
	});
}

export function creditsRenewedEmail(to: string, email: EmailOf<'credits_renewed'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t('Your AI credits are renewed'),
		heading: t('Your AI credits are renewed'),
		body: t("You have {value1} AI credits for this month. They last until {value2}.", { value1: formatCredits(email.credits, locale), value2: formatBillingDate(email.renewsAt, locale) }),
		...action(t('See your credits'), links.billing),
		footer: t('We send this when your credits renew.'),
	});
}

/** What a plan can do next when its credits run low. */
function nextStep(plan: EmailOf<'credits_20' | 'credits_5'>['plan'], locale: Locale): string {
 const { t } = serverT(locale);
	switch (plan) {
		case 'basic':
			return t('Get Pro for {credits} a month.', { credits: formatCredits(PLAN_LIMITS.pro.aiCredits, locale) });
		case 'pro':
			return t('Move to Premium for {credits} a month.', { credits: formatCredits(PLAN_LIMITS.premium.aiCredits, locale) });
		case 'premium':
			return t('Buy extra credits any time.');
		case 'enterprise':
			return t('Talk to us if you need more.');
	}
}

export function creditsLowEmail(to: string, email: EmailOf<'credits_20' | 'credits_5'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const percent = email.kind === 'credits_20' ? 20 : 5;
	return renderEmail({
		locale,
		to,
		subject: t("You have {value1}% of your AI credits left", { value1: percent }),
		heading: t("{value1}% of your AI credits left", { value1: percent }),
		body: t("You have {value1} AI credits left until {value2}. {value3}", { value1: formatCredits(email.left, locale), value2: formatBillingDate(email.renewsAt, locale), value3: nextStep(email.plan, locale) }),
		...action(t('See your credits'), links.billing),
		footer: t('We send each of these once a month.'),
	});
}

export function creditsReceiptEmail(to: string, email: EmailOf<'credits_receipt'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const amount = paid(email.amountCents, 'usd', locale);
	const credits = formatCredits(email.credits, locale);
	return renderEmail({
		locale,
		to,
		subject: t("Your Estori receipt: {value1} AI credits", { value1: credits }),
		heading: t('Thanks for your purchase'),
		body: t("We received {value1} for {value2} extra AI credits. They're used after your monthly credits and expire on {value3}.", { value1: amount, value2: credits, value3: dateWithYear(email.expiresAt, locale) }),
		...action(t('See your credits'), links.billing),
		details: [
			[t('Amount'), amount],
			[t('Credits'), credits],
			[t('Expires'), dateWithYear(email.expiresAt, locale)],
			[t('Receipt number'), email.receiptNumber],
		],
		footer: receiptFooter(locale),
	});
}

export function creditsRefundedEmail(to: string, email: EmailOf<'credits_refunded'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t('We refunded your extra credits'),
		heading: t('Your extra credits were refunded'),
		body: t("We refunded {value1} for extra AI credits, and removed {value2} unused credits from your account.", { value1: paid(email.amountCents, 'usd', locale), value2: formatCredits(email.credits, locale) }),
		...action(t('See your credits'), links.billing),
		footer: t('Your bank may take 5 to 10 business days to show the refund.'),
	});
}

export function enforcementNoticeEmail(to: string, email: EmailOf<'enforcement_notice'>, links: BillingLinks, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const date = formatBillingDate(email.startsOn, locale);
	const { basic, pro, premium } = PLAN_LIMITS;
	const plans =
		t("From {value1}, Basic includes {value2} AI credits a month, {value3} and {value4}, without the supplier catalog. ", { value1: date, value2: formatCredits(basic.aiCredits, locale), value3: stores(basic.storesLifetime, 'store', locale), value4: stores(basic.liveStores, 'live store', locale) }) +
		t("Pro, at {value1} a month, adds {value2} credits, {value3}, your own domains and the catalog. ", { value1: formatUsd(PLAN_PRICES_CENTS.pro, locale), value2: formatCredits(pro.aiCredits, locale), value3: stores(pro.liveStores, 'live store', locale) }) +
		t("Premium, at {value1} a month, adds {value2} credits and {value3}.", { value1: formatUsd(PLAN_PRICES_CENTS.premium, locale), value2: formatCredits(premium.aiCredits, locale), value3: stores(premium.liveStores, 'live store', locale) });
	return renderEmail({
		locale,
		to,
		subject: t("Plans and limits on Estori from {value1}", { value1: date }),
		heading: t('Plans and limits are changing'),
		body: `${plans}${email.overLimits ? t(' Your stores stay live; to publish more, get Pro or Premium.') : t(' Your stores stay live.')}`,
		...action(t('See plans'), links.pricing),
		footer: t('Building on Estori stays free.'),
	});
}
