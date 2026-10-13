/** Resolve the site a user asked to start from into the files the new app copies. */

import type { ReuseSeed } from '../../agents/core/types';
import type { Template, TemplateVersion } from '../../database/schema';
import { buildSnapshot, bundleToFiles, type TreeFile } from './snapshot';
import { SITE_NOT_REUSABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE, reuseDecision } from './reuse';

export const SITE_READ_FAILED_MESSAGE = "Couldn't read this site's files; try again";

export interface ReuseSourceApp {
	id: string;
	userId: string | null;
	title: string;
	visibility: 'private' | 'public';
	removedFromDiscoverAt: Date | null;
}

export interface ReuseLookup {
	getSourceApp(appId: string): Promise<ReuseSourceApp | null>;
	getListingByApp(appId: string): Promise<Template | null>;
	getVersion(versionId: string): Promise<TemplateVersion | null>;
	hasPurchase(listingId: string, userId: string): Promise<boolean>;
	/** The source's builder and deployed commit; `unknown` and null when its agent can't be reached. */
	getAgentFacts(appId: string): Promise<{ behaviorType: string; deployedCommit: string | null }>;
	readLiveTree(appId: string, commit: string): Promise<TreeFile[]>;
	readSnapshot(snapshotKey: string): Promise<TreeFile[]>;
}

export type ReuseStartResult =
	| { ok: true; seed: ReuseSeed }
	| { ok: false; status: 400 | 402 | 404 | 409 | 500; error: string };

const UNAVAILABLE: ReuseStartResult = { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };

export async function resolveReuseStart(
	lookup: ReuseLookup,
	sourceAppId: unknown,
	userId: string,
): Promise<ReuseStartResult> {
	if (typeof sourceAppId !== 'string' || sourceAppId.length === 0) return UNAVAILABLE;
	const app = await lookup.getSourceApp(sourceAppId);
	if (!app) return UNAVAILABLE;

	const isOwner = app.userId === userId;
	const listing = await lookup.getListingByApp(app.id);
	const paidInEffect = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
	const [facts, hasPurchase] = await Promise.all([
		lookup.getAgentFacts(app.id),
		paidInEffect && !isOwner ? lookup.hasPurchase(listing.id, userId) : Promise.resolve(false),
	]);

	const decision = reuseDecision({
		visibility: app.visibility,
		removedFromDiscover: app.removedFromDiscoverAt !== null,
		isThink: facts.behaviorType === 'think',
		deployedCommit: facts.deployedCommit,
		listing: listing ? { status: listing.status, currentVersionId: listing.currentVersionId } : null,
		isOwner,
		hasPurchase,
	});
	if (!decision.ok) return decision;

	if (decision.source === 'snapshot') {
		const version = await lookup.getVersion(decision.versionId);
		if (!version || version.status !== 'approved') return UNAVAILABLE;
		let files: TreeFile[];
		try {
			files = await lookup.readSnapshot(version.snapshotKey);
		} catch {
			return { ok: false, status: 500, error: SITE_READ_FAILED_MESSAGE };
		}
		return { ok: true, seed: { sourceAppId: app.id, sourceTitle: app.title, versionId: version.id, files } };
	}

	let tree: TreeFile[];
	try {
		tree = await lookup.readLiveTree(app.id, decision.commit);
	} catch {
		return { ok: false, status: 500, error: SITE_READ_FAILED_MESSAGE };
	}
	const snapshot = buildSnapshot(tree);
	if (!snapshot.ok) return { ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE };
	return {
		ok: true,
		seed: { sourceAppId: app.id, sourceTitle: app.title, versionId: null, files: bundleToFiles(snapshot.bundle) },
	};
}
