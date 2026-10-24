import { INTL_LOCALE, type Locale } from '../../../shared/i18n/locales';
import { serverT } from '../i18n/server-t';
import { contactTopicLabel, type ContactRequestInput } from '../../../shared/types/contact';
import { escapeHtml } from '../../utils/html';
import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '../../../shared/types/legal';
import type { OutgoingEmail } from './types';
import type { PlatformAlert } from '../alerts/platform-alerts';

const BUTTON_STYLE =
	'display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;';

export interface EmailContent {
	locale?: Locale;
	to: string;
	subject: string;
	heading: string;
	body: string;
	/** A button and its link, for emails that ask the reader to act. */
	action?: { label: string; link: string };
	/** Label and value pairs shown as a table, such as the fields of a form. */
	details?: ReadonlyArray<readonly [string, string]>;
	footer: string;
}

function renderAction(action: EmailContent['action'], locale: Locale): string {
	if (!action) return '';
	const link = escapeHtml(action.link);
	return `<p style="margin:0 0 24px;"><a href="${link}" style="${BUTTON_STYLE}">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;">${escapeHtml(serverT(locale).t('Or paste this link into your browser:'))}</p>
<p style="margin:0 0 24px;font-size:14px;word-break:break-all;"><a href="${link}">${link}</a></p>
`;
}

function renderDetails(details: EmailContent['details']): string {
	if (!details || details.length === 0) return '';
	const rows = details
		.map(
			([label, value]) =>
				`<tr><td style="padding:6px 12px 6px 0;color:#555555;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;white-space:pre-wrap;">${escapeHtml(value)}</td></tr>`,
		)
		.join('');
	return `<table style="margin:0 0 24px;border-collapse:collapse;font-size:14px;">${rows}</table>
`;
}

export function renderEmail(content: EmailContent): OutgoingEmail {
	const locale = content.locale ?? 'en';
	const sentBy = serverT(locale).t('Sent to {email} by Estori.', { email: content.to });
	const html = `<!doctype html>
<html lang="${locale}">
<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;">
<div style="max-width:480px;margin:0 auto;">
<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 24px;">${escapeHtml(content.body)}</p>
${renderAction(content.action, locale)}${renderDetails(content.details)}<p style="margin:0;font-size:14px;color:#555555;">${escapeHtml(content.footer)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#777777;">${escapeHtml(sentBy)}</p>
</div>
</body>
</html>`;
	const text = [
		content.heading,
		'',
		content.body,
		'',
		...(content.action ? [`${content.action.label}: ${content.action.link}`, ''] : []),
		...(content.details && content.details.length > 0 ? [...content.details.map(([label, value]) => `${label}: ${value}`), ''] : []),
		content.footer,
		'',
		sentBy,
	].join('\n');
	return { to: content.to, subject: content.subject, html, text };
}

export function passwordResetEmail(to: string, link: string, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t('Reset your Estori password'),
		heading: t('Reset your password'),
		body: t('We received a request to reset the password for your Estori account. Use the button below to choose a new one.'),
		action: { label: t('Reset password'), link },
		footer: t("This link expires in 30 minutes. If you didn't ask to reset your password, ignore this email."),
	});
}

export function verifyEmailEmail(to: string, link: string, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t('Confirm your email for Estori'),
		heading: t('Confirm your email'),
		body: t('Confirm this address to finish setting up your Estori account.'),
		action: { label: t('Confirm email'), link },
		footer: t("This link expires in 24 hours. If you didn't create an Estori account, ignore this email."),
	});
}

/**
 * Tells the person who wrote to sales that we received it and will reply. Anyone can name any address, so it carries
 * nothing the sender typed: only the topic they picked from our list.
 */
export function contactReceivedEmail(request: Pick<ContactRequestInput, 'email' | 'topic'>, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to: request.email,
		subject: t('We got your message'),
		heading: t('Thanks for contacting Estori'),
		body: t("We received your message about {value1}. We'll be in touch by email soon.", { value1: t(contactTopicLabel(request.topic)) }),
		footer: t("If you didn't contact Estori, you can ignore this email."),
	});
}

/** Tells the team about a new contact-sales request. */
export function contactNotificationEmail(to: string, request: ContactRequestInput): OutgoingEmail {
	const details: Array<readonly [string, string]> = [
		['Name', `${request.firstName} ${request.lastName}`],
		['Email', request.email],
		['Company', request.company],
		['Company size', request.companySize],
		['About', contactTopicLabel(request.topic)],
	];
	if (request.premiumCredits !== null) details.push(['Premium credits', `${request.premiumCredits.toLocaleString('en-US')} credits a month`]);
	if (request.message) details.push(['Message', request.message]);
	return renderEmail({
		to,
		subject: `New contact request: ${request.company} (${contactTopicLabel(request.topic)})`,
		heading: 'New contact request',
		body: `${request.firstName} ${request.lastName} wrote from the contact page. Reply to them at ${request.email}.`,
		details,
		footer: 'Every request is also listed in the admin area.',
	});
}

/** An alert for the people who run Estori: what happened, to which order or product, and what's known. */
/** To the people who run Estori; `link` opens what the alert is about, such as a catalog order's admin page. */
export function platformAlertEmail(to: string, alert: PlatformAlert, label: string, link: string | null): OutgoingEmail {
	return renderEmail({
		to,
		subject: `Estori alert: ${label} (${alert.subject})`,
		heading: label,
		body: alert.message,
		...(link ? { action: { label: 'Open the order', link } } : {}),
		details: [['About', alert.subject], ...(alert.details ?? [])],
		footer: 'Each alert repeats at most once a day for the same order or product.',
	});
}

/** To a seller whose store reached its weekly sales cap. */
export function sellerLimitReachedEmail(to: string, weeklySalesCents: number, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t('Your store reached its weekly sales limit'),
		heading: t('Your store paused new orders'),
		body: t("Your store reached its limit of {amount} in sales over 7 days, so it isn't taking new orders until the oldest sales leave that window. Limits grow as your store builds a record of delivered orders.", { amount: dollars(weeklySalesCents, locale) }),
		footer: t('You can see your limits under Profile, Paid listings, Get paid with Stripe.'),
	});
}

export interface NewOrderEmailInput {
	storeTitle: string;
	orderNumber: number;
	test: boolean;
	totalCents: number;
	shareCents: number;
	items: ReadonlyArray<{ name: string; quantity: number; kind: 'own' | 'catalog'; productType?: 'physical' | 'digital' }>;
	shipTo: { name: string; city: string; region: string | null; countryCode: string } | null;
	note: string | null;
	link: string | null;
}

const dollars = (cents: number, locale: Locale): string => new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency: 'USD' }).format(cents / 100);

/** To a seller for each new order in their stores: what sold, where it ships, and what they ship themselves. */
export function sellerNewOrderEmail(to: string, order: NewOrderEmailInput, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const own = order.items.filter((item) => item.kind === 'own' && item.productType !== 'digital').map((item) => item.name);
	const catalog = order.items.filter((item) => item.kind === 'catalog').map((item) => item.name);
	// A test order ships nothing, so it gets no shipping steps.
	const steps = order.test
		? [t('This was a test order. No money was charged and nothing ships.')]
		: [
				...(own.length > 0 ? [t("Ship these items: {value1}. Mark the order shipped in Estori when they're on their way.", { value1: own.join(', ') })] : []),
				...(catalog.length > 0 ? [t("Estori ships {value1}. You don't need to do anything for these.", { value1: catalog.join(', ') })] : []),
			];
	const shipTo = order.shipTo ? [order.shipTo.name, order.shipTo.city, order.shipTo.region, order.shipTo.countryCode].filter(Boolean).join(', ') : t('No shipping address');
	return renderEmail({
		locale,
		to,
		subject: t("{value1}New order #{value2} at {value3}: {value4}", { value1: order.test ? t('[Test] ') : '', value2: order.orderNumber, value3: order.storeTitle, value4: dollars(order.totalCents, locale) }),
		heading: t('You have a new order'),
		body: steps.join(' '),
		...(order.link ? { action: { label: t('Open the order'), link: order.link } } : {}),
		details: [
			[t('Items'), order.items.map((item) => `${item.quantity} × ${item.name}`).join('\n')],
			[t('Total'), dollars(order.totalCents, locale)],
			[t('Your share'), dollars(order.shareCents, locale)],
			...(order.items.some(item => item.productType !== 'digital') ? [[t('Ship to'), shipTo] as const] : []),
			...(order.note ? [[t('Note'), order.note] as const] : []),
		],
		footer: t('You get this email for every order in your stores.'),
	});
}

/** To a seller whose connected domain's DNS records can no longer be seen; the store keeps answering on it. */
export function sellerDomainUnreachableEmail(to: string, hostname: string, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	return renderEmail({
		locale,
		to,
		subject: t("Check the DNS records for {value1}", { value1: hostname }),
		heading: t('Your store may be hard to reach'),
		body: t("We can't see the DNS records that point {value1} to your store. Your store still answers on it, but visitors may not reach it until the records are back where you manage your domain's DNS.", { value1: hostname }),
		footer: t('In Estori, open your store and choose Go live to see the records to add.'),
	});
}

/** To a seller whose order had items Estori refunded to the shopper. */
export function sellerItemsRefundedEmail(to: string, itemCount: number, reason: 'supplier' | 'risk', locale: Locale = 'en'): OutgoingEmail {
	const { t, tn } = serverT(locale);
	const why = reason === 'supplier' ? t('they could not be shipped') : t('the payment looked risky and could not be confirmed in time');
	return renderEmail({
		locale,
		to,
		subject: t('We refunded items from an order in your store'),
		heading: t('Items refunded'),
		body: tn("We refunded {count} item from an order in your store because {reason}. Your share of those items was taken back, and the shopper got their money for them.", "We refunded {count} items from an order in your store because {reason}. Your share of those items was taken back, and the shopper got their money for them.", itemCount, { reason: why }),
		footer: t('The order shows each item as refunded.'),
	});
}

export interface PurchaseReceipt {
	siteTitle: string | null;
	amountCents: number;
	currency: string;
	paidAt: Date;
	/** The Stripe payment, as the Stripe dashboard shows it. */
	receiptNumber: string;
	/** The site's page, where the buyer makes a copy; null without a configured domain. */
	siteLink: string | null;
	/** Estori's own address, for the policy links; null leaves them out. */
	baseUrl: string | null;
}

const RECEIPT_TITLE_MAX = 100;

function money(cents: number, currency: string, locale: Locale): string {
	const code = currency.toUpperCase();
	return `${new Intl.NumberFormat(INTL_LOCALE[locale], { style: 'currency', currency: code }).format(cents / 100)} ${code}`;
}

/** To the buyer of a paid site: Globalink sells paid sites, so the receipt names it as the seller. */
export function purchaseReceiptEmail(to: string, receipt: PurchaseReceipt, locale: Locale = 'en'): OutgoingEmail {
	const { t } = serverT(locale);
	const title = (receipt.siteTitle ?? '').replace(/\s+/g, ' ').trim().slice(0, RECEIPT_TITLE_MAX) || t('your site');
	const policies = receipt.baseUrl ? t(" See our Refund Policy ({value1}/refunds) and Privacy Policy ({value2}/privacy).", { value1: receipt.baseUrl, value2: receipt.baseUrl }) : '';
	return renderEmail({
		locale,
		to,
		subject: t("Your Estori receipt: {value1}", { value1: title }),
		heading: t('Thanks for your purchase'),
		body: t("You bought {value1}. You can now make copies of it in your Estori account and adapt them for your own business or personal projects. Copies are yours to use, but they can't be resold, shared or published as templates.", { value1: title }),
		action: receipt.siteLink ? { label: t('Make your copy'), link: receipt.siteLink } : undefined,
		details: [
			[t('Site'), title],
			[t('Amount paid'), money(receipt.amountCents, receipt.currency, locale)],
			[t('Date'), new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: 'long', timeZone: 'UTC' }).format(receipt.paidAt)],
			[t('Receipt number'), receipt.receiptNumber],
		],
		footer: t("Sold by {value1}, {value2}. For help, or a refund within 14 days, email {value3}.{value4}", { value1: LEGAL_ENTITY.name, value2: legalAddressLine(), value3: LEGAL_CONTACT.support, value4: policies }),
	});
}
