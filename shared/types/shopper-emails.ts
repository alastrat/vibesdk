/** Emails Estori sends shoppers on a store's behalf, one template per order event (spec 2026-10-18). Transactional only: Cloudflare Email Service allows no marketing email. */

export const SHOPPER_EMAIL_KINDS = ['order_confirmation', 'order_shipped', 'refund_issued'] as const;
export type ShopperEmailKind = (typeof SHOPPER_EMAIL_KINDS)[number];

export function isShopperEmailKind(value: string): value is ShopperEmailKind {
	return (SHOPPER_EMAIL_KINDS as readonly string[]).includes(value);
}

export const SHOPPER_EMAIL_LABELS: Readonly<Record<ShopperEmailKind, { name: string; when: string }>> = {
	order_confirmation: { name: 'Order confirmation', when: 'When a shopper pays for an order.' },
	order_shipped: { name: 'Order shipped', when: 'When you mark an order shipped, and when Estori ships catalog items.' },
	refund_issued: { name: 'Refund issued', when: 'When you or Estori refund items.' },
};

const COMMON_PLACEHOLDERS = ['store_name', 'customer_name', 'customer_first_name', 'order_number', 'order_total'] as const;

export const SHOPPER_EMAIL_PLACEHOLDERS: Readonly<Record<ShopperEmailKind, readonly string[]>> = {
	order_confirmation: COMMON_PLACEHOLDERS,
	order_shipped: [...COMMON_PLACEHOLDERS, 'carrier', 'tracking_number'],
	refund_issued: [...COMMON_PLACEHOLDERS, 'refund_amount'],
};

export const SHOPPER_EMAIL_LIMITS = { subject: 150, heading: 120, body: 2000 } as const;

export interface ShopperEmailTemplateFields {
	subject: string;
	heading: string;
	/** Plain text; a blank line starts a new paragraph. */
	body: string;
}

export interface ShopperEmailTemplate extends ShopperEmailTemplateFields {
	enabled: boolean;
}

export const DEFAULT_SHOPPER_EMAIL_TEMPLATES: Readonly<Record<ShopperEmailKind, ShopperEmailTemplateFields>> = {
	order_confirmation: {
		subject: 'Your {{store_name}} order #{{order_number}}',
		heading: 'Thanks for your order, {{customer_first_name}}',
		body: "We've received your order and we're getting it ready. We'll email you again when it ships.",
	},
	order_shipped: {
		subject: 'Your {{store_name}} order #{{order_number}} is on its way',
		heading: 'Your order is on its way',
		body: 'Good news, {{customer_first_name}}: part or all of your order has shipped. Follow it with the tracking details below.',
	},
	refund_issued: {
		subject: 'A refund for your {{store_name}} order #{{order_number}}',
		heading: "We've refunded {{refund_amount}}",
		body: 'We refunded {{refund_amount}} to the card you paid with. Banks usually show it within 5 to 10 business days.',
	},
};

export interface ShopperEmailTemplateView extends ShopperEmailTemplate {
	kind: ShopperEmailKind;
	/** The seller saved their own version; otherwise this is Estori's default. */
	edited: boolean;
}

export const SHOPPER_EMAIL_STATUSES = ['queued', 'sent', 'failed', 'suppressed', 'disabled', 'capped'] as const;
export type ShopperEmailStatus = (typeof SHOPPER_EMAIL_STATUSES)[number];

export interface RecentShopperEmail {
	id: string;
	kind: ShopperEmailKind;
	orderNumber: number | null;
	/** Masked, such as a***@example.com. */
	recipient: string | null;
	status: ShopperEmailStatus;
	test: boolean;
	createdAt: string;
	sentAt: string | null;
}

export interface ShopperEmailsData {
	templates: ShopperEmailTemplateView[];
	placeholders: Readonly<Record<ShopperEmailKind, readonly string[]>>;
	/** Where shoppers' replies go; null means the seller's account email. */
	replyTo: string | null;
	sellerEmail: string | null;
	recent: RecentShopperEmail[];
}

export interface ShopperEmailStoreOption {
	appId: string;
	title: string;
}

export interface ShopperEmailPreview {
	subject: string;
	html: string;
	text: string;
}

/** The Emails page in the main menu. */
export const SHOPPER_EMAILS_PATH = '/emails';
