import { contactTopicLabel, type ContactRequestInput } from '../../../shared/types/contact';
import { escapeHtml } from '../../utils/html';
import type { OutgoingEmail } from './types';
import type { PlatformAlert } from '../alerts/platform-alerts';

const BUTTON_STYLE =
	'display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;';

interface EmailContent {
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

function renderAction(action: EmailContent['action']): string {
	if (!action) return '';
	const link = escapeHtml(action.link);
	return `<p style="margin:0 0 24px;"><a href="${link}" style="${BUTTON_STYLE}">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 8px;font-size:14px;">Or paste this link into your browser:</p>
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

function renderEmail(content: EmailContent): OutgoingEmail {
	const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;">
<div style="max-width:480px;margin:0 auto;">
<h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(content.heading)}</h1>
<p style="margin:0 0 24px;">${escapeHtml(content.body)}</p>
${renderAction(content.action)}${renderDetails(content.details)}<p style="margin:0;font-size:14px;color:#555555;">${escapeHtml(content.footer)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#777777;">Sent to ${escapeHtml(content.to)} by Estori.</p>
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
		`Sent to ${content.to} by Estori.`,
	].join('\n');
	return { to: content.to, subject: content.subject, html, text };
}

export function passwordResetEmail(to: string, link: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Reset your Estori password',
		heading: 'Reset your password',
		body: 'We received a request to reset the password for your Estori account. Use the button below to choose a new one.',
		action: { label: 'Reset password', link },
		footer: "This link expires in 30 minutes. If you didn't ask to reset your password, ignore this email.",
	});
}

export function verifyEmailEmail(to: string, link: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Confirm your email for Estori',
		heading: 'Confirm your email',
		body: 'Confirm this address to finish setting up your Estori account.',
		action: { label: 'Confirm email', link },
		footer: "This link expires in 24 hours. If you didn't create an Estori account, ignore this email.",
	});
}

/**
 * Tells the person who wrote to sales that we received it and will reply. Anyone can name any address, so it carries
 * nothing the sender typed: only the topic they picked from our list.
 */
export function contactReceivedEmail(request: Pick<ContactRequestInput, 'email' | 'topic'>): OutgoingEmail {
	return renderEmail({
		to: request.email,
		subject: 'We got your message',
		heading: 'Thanks for contacting Estori',
		body: `We received your message about ${contactTopicLabel(request.topic)}. We'll be in touch by email soon.`,
		footer: "If you didn't contact Estori, you can ignore this email.",
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
export function sellerLimitReachedEmail(to: string, weeklySalesCents: number): OutgoingEmail {
	return renderEmail({
		to,
		subject: 'Your store reached its weekly sales limit',
		heading: 'Your store paused new orders',
		body: `Your store reached its limit of $${(weeklySalesCents / 100).toFixed(2)} in sales over 7 days, so it isn't taking new orders until the oldest sales leave that window. Limits grow as your store builds a record of delivered orders.`,
		footer: 'You can see your limits under Profile, Paid listings, Get paid with Stripe.',
	});
}

export interface NewOrderEmailInput {
	storeTitle: string;
	orderNumber: number;
	test: boolean;
	totalCents: number;
	shareCents: number;
	items: ReadonlyArray<{ name: string; quantity: number; kind: 'own' | 'catalog' }>;
	shipTo: { name: string; city: string; region: string | null; countryCode: string } | null;
	note: string | null;
	link: string | null;
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** To a seller for each new order in their stores: what sold, where it ships, and what they ship themselves. */
export function sellerNewOrderEmail(to: string, order: NewOrderEmailInput): OutgoingEmail {
	const own = order.items.filter((item) => item.kind === 'own').map((item) => item.name);
	const catalog = order.items.filter((item) => item.kind === 'catalog').map((item) => item.name);
	// A test order ships nothing, so it gets no shipping steps.
	const steps = order.test
		? ['This was a test order. No money was charged and nothing ships.']
		: [
				...(own.length > 0 ? [`Ship these items: ${own.join(', ')}. Mark the order shipped in Estori when they're on their way.`] : []),
				...(catalog.length > 0 ? [`Estori ships ${catalog.join(', ')}. You don't need to do anything for these.`] : []),
			];
	const shipTo = order.shipTo ? [order.shipTo.name, order.shipTo.city, order.shipTo.region, order.shipTo.countryCode].filter(Boolean).join(', ') : 'No shipping address';
	return renderEmail({
		to,
		subject: `${order.test ? '[Test] ' : ''}New order #${order.orderNumber} at ${order.storeTitle}: ${dollars(order.totalCents)}`,
		heading: 'You have a new order',
		body: steps.join(' '),
		...(order.link ? { action: { label: 'Open the order', link: order.link } } : {}),
		details: [
			['Items', order.items.map((item) => `${item.quantity} × ${item.name}`).join('\n')],
			['Total', dollars(order.totalCents)],
			['Your share', dollars(order.shareCents)],
			['Ship to', shipTo],
			...(order.note ? [['Note', order.note] as const] : []),
		],
		footer: 'You get this email for every order in your stores.',
	});
}

/** To a seller whose connected domain's DNS records can no longer be seen; the store keeps answering on it. */
export function sellerDomainUnreachableEmail(to: string, hostname: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: `Check the DNS records for ${hostname}`,
		heading: 'Your store may be hard to reach',
		body: `We can't see the DNS records that point ${hostname} to your store. Your store still answers on it, but visitors may not reach it until the records are back where you manage your domain's DNS.`,
		footer: 'In Estori, open your store and choose Go live to see the records to add.',
	});
}

/** To a seller whose order had items Estori refunded to the shopper. */
export function sellerItemsRefundedEmail(to: string, itemCount: number, reason: 'supplier' | 'risk'): OutgoingEmail {
	const why = reason === 'supplier' ? 'they could not be shipped' : 'the payment looked risky and could not be confirmed in time';
	return renderEmail({
		to,
		subject: 'We refunded items from an order in your store',
		heading: 'Items refunded',
		body: `We refunded ${itemCount} item${itemCount === 1 ? '' : 's'} from an order in your store because ${why}. Your share of those items was taken back, and the shopper got their money for them.`,
		footer: 'The order shows each item as refunded.',
	});
}
