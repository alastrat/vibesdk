/** Live stores: a store's own address under the stores domain, and the seller's own domain (spec 2026-10-17). */

export const LIVE_STORE_STATUSES = ['live', 'offline'] as const;
export type LiveStoreStatus = (typeof LIVE_STORE_STATUSES)[number];

export const STORE_DOMAIN_STATUSES = ['pending', 'active', 'failed'] as const;
export type StoreDomainStatus = (typeof STORE_DOMAIN_STATUSES)[number];

/** Where a custom domain is connected: Cloudflare for SaaS in production, or the local stand-in in development. */
export const STORE_DOMAIN_PROVIDERS = ['cloudflare', 'local'] as const;
export type StoreDomainProvider = (typeof STORE_DOMAIN_PROVIDERS)[number];

/** A DNS record the seller adds at their domain's provider. */
export interface StoreDomainRecord {
	type: 'CNAME' | 'TXT';
	name: string;
	value: string;
	/** Sends the domain to Estori, proves the seller owns it, or lets the certificate be issued. */
	purpose: 'routing' | 'ownership' | 'certificate';
}

/** Names that stay Estori's, so no store can look like a part of Estori. */
export const RESERVED_SLUGS: readonly string[] = [
	'www',
	'api',
	'admin',
	'app',
	'mail',
	'shop',
	'store',
	'stores',
	'estori',
	'preview',
	'status',
	'help',
	'support',
	'checkout',
	'pay',
	'cdn',
	'assets',
];

export const SLUG_MAX_LENGTH = 40;
const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/;
const SLUG_FORMAT = 'Use 3 to 40 lowercase letters, numbers or hyphens.';
const SLUG_RESERVED = 'That address is reserved. Try another.';

export function slugProblem(slug: string): string | null {
	if (!SLUG.test(slug)) return SLUG_FORMAT;
	if (RESERVED_SLUGS.includes(slug)) return SLUG_RESERVED;
	return null;
}

/** A suggested address from the store's title; the app id fills in when the title has nothing usable. */
export function slugFromTitle(title: string, appId = ''): string {
	const base = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX_LENGTH)
		.replace(/-+$/, '');
	const suffix = appId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
	if (slugProblem(base) === SLUG_FORMAT) return suffix ? `store-${suffix}` : 'my-store';
	if (slugProblem(base) === SLUG_RESERVED) return suffix ? `${base}-${suffix}` : `my-${base}`;
	return base;
}

/** The slug of a host exactly one label under the stores domain; null for any other host, or with no stores domain. */
export function storeSubdomainSlug(hostname: string, storesDomain: string | null | undefined): string | null {
	if (!storesDomain) return null;
	const host = hostname.toLowerCase();
	const suffix = `.${storesDomain.toLowerCase()}`;
	if (!host.endsWith(suffix)) return null;
	const label = host.slice(0, -suffix.length);
	return label && !label.includes('.') ? label : null;
}

/** A domain as the seller may paste it (with a scheme, path, port or final dot), reduced to its host name. */
export function normalizeHostname(input: string): string | null {
	let host = input.trim().toLowerCase();
	host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
	host = host.split(/[/?#]/)[0] ?? '';
	host = host.replace(/:\d+$/, '').replace(/\.$/, '');
	if (!host || /[^a-z0-9.-]/.test(host)) return null;
	return host;
}

const FULL_DOMAIN = 'Enter a full domain, such as shop.yourstore.com.';
const ESTORI_DOMAIN = "That's an Estori address. Enter a domain you own.";
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function customHostnameProblem(hostname: string, own: { storesDomain: string | null; estoriDomains: readonly string[] }): string | null {
	const labels = hostname.split('.');
	if (hostname.length > 253 || labels.length < 2 || !labels.every((label) => LABEL.test(label)) || /^\d+$/.test(labels[labels.length - 1] ?? '')) {
		return FULL_DOMAIN;
	}
	const estori = [own.storesDomain, ...own.estoriDomains].filter((domain): domain is string => Boolean(domain)).map((domain) => domain.toLowerCase());
	if (estori.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return ESTORI_DOMAIN;
	return null;
}
