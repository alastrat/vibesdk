/** Each store's own sender address on the shopper email domain, such as northwind-tea@orders.estori.app. */

import { EMAIL_FROM } from '../email/types';

/** Mailbox names that belong to the domain itself, never to a store. */
const RESERVED_MAILBOXES = new Set(['abuse', 'admin', 'administrator', 'billing', 'hostmaster', 'info', 'legal', 'mailer-daemon', 'no-reply', 'noreply', 'postmaster', 'privacy', 'root', 'sales', 'security', 'support', 'webmaster']);
/** A slug that's a valid mailbox name: lowercase letters, digits and inner hyphens, at most 64 characters. */
const MAILBOX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const RESERVED_SUFFIX = '-store';

/**
 * The store's slug on the domain of `shopperFrom` (the SHOPPER_EMAIL_FROM address); `shopperFrom` itself for a store
 * with no usable slug. Without a shopper email domain every store sends from Estori's no-reply address.
 */
export function storeSenderAddress(slug: string | null, shopperFrom: string | null): string {
	if (!shopperFrom) return EMAIL_FROM.email;
	const domain = shopperFrom.slice(shopperFrom.lastIndexOf('@') + 1);
	if (!slug || !MAILBOX.test(slug) || !domain) return shopperFrom;
	const mailbox = RESERVED_MAILBOXES.has(slug) ? `${slug}${RESERVED_SUFFIX}` : slug;
	return `${mailbox}@${domain}`;
}
