/** Adding, checking and removing a store's own domain, and the hourly check of domains still waiting for DNS. */

import { customHostnameProblem, normalizeHostname } from '../../../shared/types/live-stores';
import type { LiveStoreService, StoreDomainRow } from '../../database/services/LiveStoreService';
import type { CustomHostnameProvider } from './domains';

/** A domain still waiting for DNS this long is failed, so it stops being checked. */
export const DOMAIN_SETUP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DomainFlowDeps {
	provider: CustomHostnameProvider | null;
	stores: Pick<LiveStoreService, 'domainOfApp' | 'addDomain' | 'updateDomain' | 'removeDomain' | 'pendingDomains'>;
	/** Estori's own domains, which a seller can't connect. */
	own: { storesDomain: string | null; estoriDomains: readonly string[] };
	now(): Date;
}

export type DomainResult = { ok: true; domain: StoreDomainRow } | { ok: false; message: string };

const NOT_SET_UP = "Custom domains aren't set up yet.";
const FULL_DOMAIN = 'Enter a full domain, such as shop.yourstore.com.';

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function addStoreDomain(deps: DomainFlowDeps, appId: string, input: string): Promise<DomainResult> {
	if (!deps.provider) return { ok: false, message: NOT_SET_UP };
	const hostname = normalizeHostname(input);
	if (!hostname) return { ok: false, message: FULL_DOMAIN };
	const problem = customHostnameProblem(hostname, deps.own);
	if (problem) return { ok: false, message: problem };
	if (await deps.stores.domainOfApp(appId)) return { ok: false, message: 'This store already has a domain. Remove it to connect another.' };

	let created: Awaited<ReturnType<CustomHostnameProvider['create']>>;
	try {
		created = await deps.provider.create(hostname);
	} catch (error) {
		return { ok: false, message: `This domain couldn't be added: ${errorText(error)}` };
	}
	const now = deps.now();
	const added = await deps.stores.addDomain({ appId, hostname, provider: deps.provider.name, providerId: created.providerId, records: created.records, now });
	if (added !== 'added') {
		// Another store has it, or this store just got one: the provider's copy goes, so nothing is left behind.
		await deps.provider.remove(hostname, created.providerId).catch(() => undefined);
		return { ok: false, message: added === 'hostname-taken' ? 'That domain is connected to another store.' : 'This store already has a domain. Remove it to connect another.' };
	}
	await deps.stores.updateDomain(hostname, { status: created.status, records: created.records, lastError: created.error, checkedAt: now, verifiedAt: created.status === 'active' ? now : null });
	const domain = await deps.stores.domainOfApp(appId);
	return domain ? { ok: true, domain } : { ok: false, message: "This domain couldn't be added. Try again." };
}

async function check(deps: DomainFlowDeps & { provider: CustomHostnameProvider }, row: StoreDomainRow): Promise<void> {
	const now = deps.now();
	let state;
	try {
		state = await deps.provider.check(row.hostname, row.providerId);
	} catch (error) {
		// The provider couldn't answer: the domain stays as it was, with the reason, for the next check.
		await deps.stores.updateDomain(row.hostname, { status: row.status, records: row.records, lastError: errorText(error), checkedAt: now });
		return;
	}
	const expired = state.status === 'pending' && now.getTime() - row.createdAt.getTime() > DOMAIN_SETUP_DAYS * DAY_MS;
	const status = expired ? 'failed' : state.status;
	const lastError = expired ? `The DNS records weren't added within ${DOMAIN_SETUP_DAYS} days. Remove the domain and add it again.` : state.error;
	await deps.stores.updateDomain(row.hostname, {
		status,
		records: state.records.length > 0 ? state.records : row.records,
		lastError,
		checkedAt: now,
		...(status === 'active' && row.status !== 'active' ? { verifiedAt: now } : {}),
	});
}

export async function checkStoreDomain(deps: DomainFlowDeps, appId: string): Promise<DomainResult> {
	if (!deps.provider) return { ok: false, message: NOT_SET_UP };
	const row = await deps.stores.domainOfApp(appId);
	if (!row) return { ok: false, message: 'This store has no domain yet.' };
	await check({ ...deps, provider: deps.provider }, row);
	const domain = await deps.stores.domainOfApp(appId);
	return domain ? { ok: true, domain } : { ok: false, message: 'This store has no domain yet.' };
}

export async function removeStoreDomain(deps: DomainFlowDeps, appId: string): Promise<{ ok: true } | { ok: false; message: string }> {
	const row = await deps.stores.domainOfApp(appId);
	if (!row) return { ok: true };
	if (deps.provider) {
		try {
			await deps.provider.remove(row.hostname, row.providerId);
		} catch {
			// Kept here until the provider lets it go, so no hostname is left serving nothing at the provider.
			return { ok: false, message: "The domain couldn't be removed right now. Try again." };
		}
	}
	await deps.stores.removeDomain(appId);
	return { ok: true };
}

/** Checks every domain still waiting for DNS; one that fails to answer never stops the others. */
export async function sweepPendingDomains(deps: DomainFlowDeps): Promise<{ checked: number; connected: number; failed: number }> {
	if (!deps.provider) return { checked: 0, connected: 0, failed: 0 };
	const provider = deps.provider;
	const pending = await deps.stores.pendingDomains();
	let connected = 0;
	let failed = 0;
	for (const row of pending) {
		await check({ ...deps, provider }, row);
		const after = await deps.stores.domainOfApp(row.appId);
		if (after?.status === 'active') connected += 1;
		if (after?.status === 'failed') failed += 1;
	}
	return { checked: pending.length, connected, failed };
}
