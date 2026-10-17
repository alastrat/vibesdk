/**
 * Which live store a request's host is, decided in platform code before any generated code runs: a store's subdomain
 * under the stores domain, or a seller's connected domain. Estori's own hosts are never looked up.
 */

import { storeSubdomainSlug } from '../../../shared/types/live-stores';
import { LiveStoreService, type LiveStoreTarget } from '../../database/services/LiveStoreService';
import { getPreviewDomain } from '../../utils/urls';

export interface StoreHostConfig {
	/** Live stores are off when it's null. */
	storesDomain: string | null;
	customDomain: string;
	previewDomain: string;
	/** In development, `.localhost` hosts may be custom domains, so the flow can be tried on a laptop. */
	dev: boolean;
}

export interface StoreHostLookup {
	storeForSlug(slug: string): Promise<LiveStoreTarget | null>;
	storeForHostname(hostname: string): Promise<LiveStoreTarget | null>;
}

export type StoreHost = { kind: 'subdomain' | 'custom'; store: LiveStoreTarget };

/** How long a host's answer is reused, so a store page doesn't read D1 on every request. */
export const STORE_HOST_CACHE_MS = 30_000;
const CACHE_MAX_ENTRIES = 1_000;

export function storeHostConfig(env: Env): StoreHostConfig {
	return {
		storesDomain: env.STORES_DOMAIN?.trim().toLowerCase() || null,
		customDomain: (env.CUSTOM_DOMAIN ?? '').toLowerCase(),
		previewDomain: getPreviewDomain(env).toLowerCase(),
		dev: env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'local',
	};
}

function isUnder(hostname: string, domain: string): boolean {
	return Boolean(domain) && (hostname === domain || hostname.endsWith(`.${domain}`));
}

/** A host that could be a seller's own domain: not Estori's, and in production not a preview subdomain. */
function isCustomDomainCandidate(hostname: string, config: StoreHostConfig): boolean {
	if (hostname === 'localhost' || !hostname.includes('.')) return false;
	if (config.storesDomain && isUnder(hostname, config.storesDomain)) return false;
	if (hostname === config.customDomain || hostname === config.previewDomain) return false;
	if (hostname.endsWith('.localhost')) return config.dev;
	return !isUnder(hostname, config.customDomain) && !isUnder(hostname, config.previewDomain);
}

/** A resolver with its own cache; the lookup is per call, so each request reads D1 through its own environment. */
export function createStoreHostResolver(nowMs: () => number = Date.now) {
	const cache = new Map<string, { host: StoreHost | null; expiresAt: number }>();
	return async (rawHostname: string, config: StoreHostConfig, lookup: StoreHostLookup): Promise<StoreHost | null> => {
		if (!config.storesDomain) return null;
		const hostname = rawHostname.toLowerCase();
		const slug = storeSubdomainSlug(hostname, config.storesDomain);
		if (!slug && !isCustomDomainCandidate(hostname, config)) return null;
		const cached = cache.get(hostname);
		if (cached && cached.expiresAt > nowMs()) return cached.host;
		const store = slug ? await lookup.storeForSlug(slug) : await lookup.storeForHostname(hostname);
		const host: StoreHost | null = store ? { kind: slug ? 'subdomain' : 'custom', store } : null;
		cache.set(hostname, { host, expiresAt: nowMs() + STORE_HOST_CACHE_MS });
		if (cache.size > CACHE_MAX_ENTRIES) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		return host;
	};
}

const sharedResolver = createStoreHostResolver();

/** The live store this request's host serves, if any, cached per isolate. */
export function resolveStoreHost(env: Env, hostname: string): Promise<StoreHost | null> {
	const stores = new LiveStoreService(env);
	return sharedResolver(hostname, storeHostConfig(env), {
		storeForSlug: (slug) => stores.storeForSlug(slug),
		storeForHostname: (host) => stores.storeForHostname(host),
	});
}
