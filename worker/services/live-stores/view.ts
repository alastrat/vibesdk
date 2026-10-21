/** What a store's owner sees in the Go live panel: its address, its published version, and its own domain. */

import { getDomain } from 'tldts';
import { slugFromTitle, type LiveStoreView, type StoreDomainView } from '../../../shared/types/live-stores';
import type { LiveStoreRow, StoreDomainRow } from '../../database/services/LiveStoreService';
import { parseStoreManifest } from '../store-payments/manifest';

/** A store's address: https, except a local `.localhost` one, which is served by the dev server on its port. */
export function storeUrl(host: string, devPort: string | null): string {
	if (host === 'localhost' || host.endsWith('.localhost')) return `http://${host}${devPort ? `:${devPort}` : ''}`;
	return `https://${host}`;
}

/** The dev server's port, from a local main domain such as `localhost:8100`. */
export function devPortOf(customDomain: string | undefined): string | null {
	return customDomain?.match(/^localhost:(\d+)$/)?.[1] ?? null;
}

function domainView(domain: StoreDomainRow, devPort: string | null): StoreDomainView {
	return {
		hostname: domain.hostname,
		rootDomain: getDomain(domain.hostname),
		url: storeUrl(domain.hostname, devPort),
		status: domain.status,
		records: domain.records,
		lastError: domain.lastError,
		checkedAt: domain.checkedAt?.toISOString() ?? null,
		verifiedAt: domain.verifiedAt?.toISOString() ?? null,
	};
}

export function liveStoreView(input: {
	appId: string;
	title: string;
	storesDomain: string | null;
	devPort: string | null;
	domainsAvailable: boolean;
	record: LiveStoreRow | null;
	/** The latest version of the draft being edited; null before it has one. */
	previewCommit: string | null;
	/** The draft being edited, which Publish sends live. */
	draft: { id: string; name: string } | null;
	/** The draft the live store was published from. */
	publishedDraft: { id: string; name: string } | null;
	/** The published version's store file. */
	publishedManifest: string | null;
	domain: StoreDomainRow | null;
}): LiveStoreView {
	const { record } = input;
	const parsed = input.publishedManifest ? parseStoreManifest(input.publishedManifest) : null;
	return {
		available: input.storesDomain !== null,
		storesDomain: input.storesDomain,
		status: record ? record.status : 'unpublished',
		slug: record?.slug ?? null,
		suggestedSlug: record?.slug ?? slugFromTitle(input.title, input.appId),
		url: record && input.storesDomain ? storeUrl(`${record.slug}.${input.storesDomain}`, input.devPort) : null,
		publishedAt: record?.publishedAt.toISOString() ?? null,
		hasChanges: !record || (input.previewCommit !== null && input.previewCommit !== record.publishedCommit),
		checkoutConnected: Boolean(parsed?.ok && parsed.manifest.products.length > 0),
		domain: input.domain ? domainView(input.domain, input.devPort) : null,
		domainsAvailable: input.domainsAvailable,
		draft: input.draft,
		publishedDraft: input.publishedDraft,
	};
}
