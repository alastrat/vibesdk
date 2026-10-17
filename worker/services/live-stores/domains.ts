/**
 * Connecting a seller's own domain. Providers sit behind one interface, as suppliers do: Cloudflare for SaaS in
 * production, and a local stand-in in development that connects `.localhost` domains so the flow can be tried end to end.
 */

import type { StoreDomainProvider, StoreDomainRecord, StoreDomainStatus } from '../../../shared/types/live-stores';

export interface DomainState {
	status: StoreDomainStatus;
	/** What the seller adds at their DNS provider. */
	records: StoreDomainRecord[];
	/** The provider's reason, for a failed domain. */
	error: string | null;
}

export interface CustomHostnameProvider {
	readonly name: StoreDomainProvider;
	create(hostname: string): Promise<DomainState & { providerId: string | null }>;
	check(hostname: string, providerId: string | null): Promise<DomainState>;
	remove(hostname: string, providerId: string | null): Promise<void>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface CloudflareHostname {
	id: string;
	hostname: string;
	status: string;
	verification_errors?: string[];
	ownership_verification?: { type?: string; name?: string; value?: string };
	ssl?: { status?: string; validation_records?: Array<{ txt_name?: string; txt_value?: string }>; validation_errors?: Array<{ message?: string }> };
}

interface CloudflareAnswer<T> {
	success: boolean;
	errors?: Array<{ code?: number; message?: string }>;
	result?: T;
}

/** Cloudflare's code for a hostname already on the zone. */
const DUPLICATE_HOSTNAME = 1406;

/** Statuses after which a hostname won't become active without the seller starting over. */
const FAILED_HOSTNAME = ['blocked', 'moved', 'deleted', 'pending_deletion', 'test_blocked', 'test_failed'];

export class CustomHostnameApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: number | null = null,
	) {
		super(message);
		this.name = 'CustomHostnameApiError';
	}
}

export function cloudflareSaasProvider(config: { zoneId: string; apiToken: string; cnameTarget: string; fetcher?: Fetcher }): CustomHostnameProvider {
	const fetcher: Fetcher = config.fetcher ?? ((input, init) => fetch(input, init));
	const base = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames`;

	async function call<T = CloudflareHostname>(method: string, path: string, body?: unknown): Promise<T | null> {
		const response = await fetcher(`${base}${path}`, {
			method,
			headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const answer = (await response.json().catch(() => ({ success: false }))) as CloudflareAnswer<T>;
		if (!response.ok || !answer.success) {
			const error = answer.errors?.[0];
			throw new CustomHostnameApiError(error?.message ?? `Cloudflare answered ${response.status}`, response.status, error?.code ?? null);
		}
		return answer.result ?? null;
	}

	const createBody = (hostname: string) => ({ hostname, ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } } });

	function stateOf(hostname: CloudflareHostname): DomainState {
		const records: StoreDomainRecord[] = [{ type: 'CNAME', name: hostname.hostname, value: config.cnameTarget, purpose: 'routing' }];
		const ownership = hostname.ownership_verification;
		if (ownership?.name && ownership.value) records.push({ type: 'TXT', name: ownership.name, value: ownership.value, purpose: 'ownership' });
		for (const record of hostname.ssl?.validation_records ?? []) {
			if (record.txt_name && record.txt_value) records.push({ type: 'TXT', name: record.txt_name, value: record.txt_value, purpose: 'certificate' });
		}
		const sslStatus = hostname.ssl?.status ?? '';
		if (FAILED_HOSTNAME.includes(hostname.status) || sslStatus.endsWith('_timed_out')) {
			const reason = hostname.verification_errors?.[0] ?? hostname.ssl?.validation_errors?.[0]?.message ?? `Cloudflare reports ${hostname.status}`;
			return { status: 'failed', records, error: reason };
		}
		return { status: hostname.status === 'active' && sslStatus === 'active' ? 'active' : 'pending', records, error: null };
	}

	return {
		name: 'cloudflare',
		/**
		 * Estori asks only for a hostname no store holds, so one already on the zone is a leftover, such as a deleted
		 * store's: it's replaced, and the seller proves ownership again with new records.
		 */
		async create(hostname) {
			let created: CloudflareHostname | null;
			try {
				created = await call('POST', '', createBody(hostname));
			} catch (error) {
				if (!(error instanceof CustomHostnameApiError) || error.code !== DUPLICATE_HOSTNAME) throw error;
				const leftovers = (await call<CloudflareHostname[]>('GET', `?hostname=${encodeURIComponent(hostname)}`)) ?? [];
				for (const leftover of leftovers.filter((found) => found.hostname === hostname)) await call('DELETE', `/${encodeURIComponent(leftover.id)}`);
				created = await call('POST', '', createBody(hostname));
			}
			if (!created) throw new CustomHostnameApiError('Cloudflare returned no custom hostname', 502);
			return { providerId: created.id, ...stateOf(created) };
		},
		async check(_hostname, providerId) {
			if (!providerId) return { status: 'failed', records: [], error: 'This domain was never created at Cloudflare. Remove it and add it again.' };
			const found = await call('GET', `/${encodeURIComponent(providerId)}`);
			if (!found) throw new CustomHostnameApiError('Cloudflare returned no custom hostname', 502);
			return stateOf(found);
		},
		async remove(_hostname, providerId) {
			if (!providerId) return;
			try {
				await call('DELETE', `/${encodeURIComponent(providerId)}`);
			} catch (error) {
				// Already gone at Cloudflare: removing it here is all that's left.
				if (error instanceof CustomHostnameApiError && error.status === 404) return;
				throw error;
			}
		},
	};
}

/** Development only: `.localhost` names resolve to this machine, so they're connected on the first check. */
export function localDomainProvider(config: { cnameTarget: string }): CustomHostnameProvider {
	const records = (hostname: string): StoreDomainRecord[] => [
		{ type: 'CNAME', name: hostname, value: config.cnameTarget, purpose: 'routing' },
		{ type: 'TXT', name: `_estori-verify.${hostname}`, value: `estori-verify=${hostname.replace(/[^a-z0-9]/g, '')}`, purpose: 'ownership' },
	];
	return {
		name: 'local',
		async create(hostname) {
			return { providerId: null, status: 'pending', records: records(hostname), error: null };
		},
		async check(hostname) {
			if (!hostname.endsWith('.localhost')) return { status: 'failed', records: records(hostname), error: 'Local development can connect .localhost domains only.' };
			return { status: 'active', records: records(hostname), error: null };
		},
		async remove() {},
	};
}

/** Cloudflare for SaaS when it's configured, the local stand-in in development, and none otherwise. */
export function domainProviderFromEnv(env: Env): CustomHostnameProvider | null {
	const storesDomain = env.STORES_DOMAIN?.trim();
	if (!storesDomain) return null;
	if (env.CF_SAAS_ZONE_ID && env.CF_SAAS_API_TOKEN && env.STORES_CNAME_TARGET) {
		return cloudflareSaasProvider({ zoneId: env.CF_SAAS_ZONE_ID, apiToken: env.CF_SAAS_API_TOKEN, cnameTarget: env.STORES_CNAME_TARGET });
	}
	if (env.ENVIRONMENT === 'dev' || env.ENVIRONMENT === 'local') return localDomainProvider({ cnameTarget: env.STORES_CNAME_TARGET || storesDomain });
	return null;
}
