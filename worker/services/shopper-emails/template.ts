/**
 * Shopper emails from a seller's plain-text template: placeholders filled and escaped, around fixed blocks that keep
 * every email about its order (the items, tracking or refund, and a footer naming the store). Pure.
 */

import { SHOPPER_EMAIL_LABELS, SHOPPER_EMAIL_LIMITS, SHOPPER_EMAIL_PLACEHOLDERS, type ShopperEmailKind, type ShopperEmailTemplateFields } from '../../../shared/types/shopper-emails';
import { escapeHtml } from '../../utils/html';

export interface ShopperEmailContent {
	kind: ShopperEmailKind;
	storeName: string;
	orderNumber: number;
	customerName: string | null;
	totalCents: number;
	/** What this email is about: the whole order, one shipment, or the refunded lines. */
	items: ReadonlyArray<{ name: string; quantity: number; unitPriceCents: number }>;
	/** City, region and country, never the street. */
	shipTo: string | null;
	carrier: string | null;
	trackingNumber: string | null;
	refundCents: number | null;
	/** The live store's address, for the Visit button. */
	storeUrl: string | null;
	/** For a test order: the masked shopper whose email came to the seller instead. */
	testFor: string | null;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const FIELD_LABELS: Readonly<Record<keyof ShopperEmailTemplateFields, string>> = { subject: 'subject', heading: 'heading', body: 'message' };

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** A character no template may hold: C0 controls and DEL, apart from line breaks and tabs in the message. */
function hasControl(value: string, allowLines: boolean): boolean {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (allowLines && (code === 10 || code === 13 || code === 9)) continue;
		if (code < 32 || code === 127) return true;
	}
	return false;
}

/** Why a seller's template can't be saved, or null. */
export function templateProblem(kind: ShopperEmailKind, fields: ShopperEmailTemplateFields): string | null {
	if (!fields.subject.trim()) return 'Add a subject.';
	if (!fields.heading.trim()) return 'Add a heading.';
	for (const field of ['subject', 'heading', 'body'] as const) {
		if (fields[field].length > SHOPPER_EMAIL_LIMITS[field]) return `The ${FIELD_LABELS[field]} is longer than ${SHOPPER_EMAIL_LIMITS[field]} characters.`;
	}
	if (/[\r\n]/.test(fields.subject) || /[\r\n]/.test(fields.heading)) return `The subject and heading must each be one line.`;
	if (hasControl(fields.subject, false) || hasControl(fields.heading, false) || hasControl(fields.body, true)) return 'Remove the hidden control characters.';
	const allowed = SHOPPER_EMAIL_PLACEHOLDERS[kind];
	for (const field of ['subject', 'heading', 'body'] as const) {
		const text = fields[field];
		const matches = [...text.matchAll(PLACEHOLDER)];
		const opened = text.split('{{').length - 1;
		if (opened !== matches.length) return `A placeholder in the ${FIELD_LABELS[field]} isn't closed with }}.`;
		const unknown = matches.map((match) => match[1]).find((name) => !allowed.includes(name));
		if (unknown) return `{{${unknown}}} isn't a placeholder the ${SHOPPER_EMAIL_LABELS[kind].name.toLowerCase()} email can use. Use ${allowed.map((name) => `{{${name}}}`).join(', ')}.`;
	}
	return null;
}

export function fillPlaceholders(text: string, values: Readonly<Record<string, string>>): string {
	return text.replace(PLACEHOLDER, (whole, name: string) => values[name] ?? whole);
}

function valuesOf(content: ShopperEmailContent): Record<string, string> {
	const name = content.customerName?.trim() || '';
	return {
		store_name: content.storeName,
		customer_name: name || 'there',
		customer_first_name: name.split(/\s+/)[0] || 'there',
		order_number: String(content.orderNumber),
		order_total: dollars(content.totalCents),
		carrier: content.carrier ?? '',
		tracking_number: content.trackingNumber ?? '',
		refund_amount: dollars(content.refundCents ?? 0),
	};
}

/** The carrier's own tracking page for USPS, UPS, FedEx and DHL numbers; null for others. */
export function trackingUrl(carrier: string | null, trackingNumber: string | null): string | null {
	if (!carrier || !trackingNumber) return null;
	const number = encodeURIComponent(trackingNumber.replace(/\s+/g, ''));
	const name = carrier.toLowerCase();
	if (name.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}`;
	if (/\bups\b/.test(name)) return `https://www.ups.com/track?tracknum=${number}`;
	if (name.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${number}`;
	if (name.includes('dhl')) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${number}`;
	return null;
}

/** a***@example.com: enough for a seller to recognise a shopper, no more. */
export function maskEmail(email: string | null): string | null {
	if (!email) return null;
	const at = email.lastIndexOf('@');
	if (at < 1) return '***';
	return `${email[0]}***${email.slice(at)}`;
}

/** The facts a sample order shows in a preview or test email. */
export function sampleContent(kind: ShopperEmailKind, storeName: string, storeUrl: string | null): ShopperEmailContent {
	return {
		kind,
		storeName,
		orderNumber: 1042,
		customerName: 'Ana Ruiz',
		totalCents: 4599,
		items: kind === 'refund_issued' ? [{ name: 'Sample product', quantity: 1, unitPriceCents: 1500 }] : [
			{ name: 'Sample product', quantity: 2, unitPriceCents: 1500 },
			{ name: 'Another product', quantity: 1, unitPriceCents: 1599 },
		],
		shipTo: 'Austin, TX, US',
		carrier: kind === 'order_shipped' ? 'USPS' : null,
		trackingNumber: kind === 'order_shipped' ? '9400 1000 0000 0000 0000 00' : null,
		refundCents: kind === 'refund_issued' ? 1500 : null,
		storeUrl,
		testFor: null,
	};
}

const BUTTON = 'display:inline-block;padding:12px 20px;background:#1a1a1a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;';

interface Block {
	html: string;
	text: string[];
}

function eventBlock(content: ShopperEmailContent): Block {
	const items = content.items.map((item) => ({ line: `${item.quantity} × ${item.name}`, total: dollars(item.quantity * item.unitPriceCents) }));
	const rows = items.map((item) => `<tr><td style="padding:6px 12px 6px 0;">${escapeHtml(item.line)}</td><td style="padding:6px 0;text-align:right;">${escapeHtml(item.total)}</td></tr>`).join('');
	const facts: Array<[string, string, string | null]> = [];
	if (content.kind === 'order_confirmation') {
		facts.push(['Total', dollars(content.totalCents), null]);
		if (content.shipTo) facts.push(['Ships to', content.shipTo, null]);
	}
	if (content.kind === 'order_shipped') {
		if (content.carrier) facts.push(['Carrier', content.carrier, null]);
		if (content.trackingNumber) facts.push(['Tracking', content.trackingNumber, trackingUrl(content.carrier, content.trackingNumber)]);
	}
	if (content.kind === 'refund_issued') facts.push(['Refunded', dollars(content.refundCents ?? 0), null]);
	const factRows = facts
		.map(([label, value, link]) => {
			const shown = link ? `<a href="${escapeHtml(link)}">${escapeHtml(value)}</a>` : escapeHtml(value);
			return `<tr><td style="padding:6px 12px 6px 0;color:#555555;">${escapeHtml(label)}</td><td style="padding:6px 0;text-align:right;">${shown}</td></tr>`;
		})
		.join('');
	return {
		html: `<table style="width:100%;margin:0 0 24px;border-collapse:collapse;font-size:14px;border-top:1px solid #e5e5e5;">${rows}${factRows}</table>\n`,
		text: [...items.map((item) => `${item.line}: ${item.total}`), ...facts.map(([label, value, link]) => `${label}: ${value}${link ? ` (${link})` : ''}`)],
	};
}

/** Subject, HTML and text for one shopper email. */
export function renderShopperEmail(template: ShopperEmailTemplateFields, content: ShopperEmailContent): { subject: string; html: string; text: string } {
	const values = valuesOf(content);
	const subject = `${content.testFor ? '[Test] ' : ''}${fillPlaceholders(template.subject, values).replace(/[\r\n]+/g, ' ').trim()}`;
	const heading = fillPlaceholders(template.heading, values).replace(/[\r\n]+/g, ' ').trim();
	const paragraphs = fillPlaceholders(template.body, values)
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean);
	const block = eventBlock(content);
	const footer = `${content.storeName} sent you this email about your order #${content.orderNumber}. Reply to this email to reach the store.`;
	const testNote = content.testFor ? `This test order's email came to you instead of the shopper (${content.testFor}).` : null;

	const html = `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#ffffff;color:#1a1a1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.5;">
<div style="max-width:520px;margin:0 auto;">
<p style="margin:0 0 24px;font-size:16px;font-weight:600;">${escapeHtml(content.storeName)}</p>
${testNote ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fff7e6;border-radius:6px;font-size:14px;">${escapeHtml(testNote)}</p>\n` : ''}<h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(heading)}</h1>
${paragraphs.map((paragraph) => `<p style="margin:0 0 16px;">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('\n')}
${block.html}${content.storeUrl ? `<p style="margin:0 0 24px;"><a href="${escapeHtml(content.storeUrl)}" style="${BUTTON}">Visit ${escapeHtml(content.storeName)}</a></p>\n` : ''}<p style="margin:24px 0 0;font-size:13px;color:#555555;">${escapeHtml(footer)}</p>
<p style="margin:8px 0 0;font-size:12px;color:#777777;">Sent with Estori.</p>
</div>
</body>
</html>`;
	const text = [
		content.storeName,
		'',
		...(testNote ? [testNote, ''] : []),
		heading,
		'',
		...paragraphs.flatMap((paragraph) => [paragraph, '']),
		...block.text,
		'',
		...(content.storeUrl ? [`Visit ${content.storeName}: ${content.storeUrl}`, ''] : []),
		footer,
		'Sent with Estori.',
	].join('\n');
	return { subject, html, text };
}
