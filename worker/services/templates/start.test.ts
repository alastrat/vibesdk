import { describe, expect, it } from 'vitest';
import type { Template, TemplateVersion } from '../../database/schema';
import { resolveReuseStart, type ReuseLookup, type ReuseSourceApp } from './start';
import {
	SITE_NOT_REUSABLE_MESSAGE,
	SITE_NOT_YET_AVAILABLE_MESSAGE,
	SITE_PURCHASE_REQUIRED_MESSAGE,
	SITE_UNAVAILABLE_MESSAGE,
} from './reuse';
import type { TreeFile } from './snapshot';

const encoder = new TextEncoder();
const LIVE_FILES: TreeFile[] = [
	{ path: '/index.html', bytes: encoder.encode('<h1>Lumen</h1>') },
	{ path: '/.env', bytes: encoder.encode('TOKEN=abc') },
];
const SNAPSHOT_FILES: TreeFile[] = [{ path: 'index.html', bytes: encoder.encode('<h1>Approved</h1>') }];

const APP: ReuseSourceApp = {
	id: 'app1',
	userId: 'owner',
	title: 'Lumen Yoga',
	visibility: 'public',
	removedFromDiscoverAt: null,
};

function listing(overrides: Partial<Template> = {}): Template {
	return {
		id: 'l1',
		sourceAppId: 'app1',
		creatorUserId: 'owner',
		currentVersionId: 'v2',
		status: 'listed',
		priceCents: 2900,
		createdAt: null,
		updatedAt: null,
		...overrides,
	};
}

function version(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
	return {
		id: 'v2',
		templateId: 'l1',
		version: 2,
		sourceCommit: 'c2',
		snapshotKey: 'templates/l1/v2/files.json',
		fileCount: 1,
		totalBytes: 10,
		desktopShotKey: 'd',
		mobileShotKey: 'm',
		priceCents: 2900,
		status: 'approved',
		rightsConfirmedAt: new Date(0),
		reviewedBy: 'admin',
		reviewedAt: new Date(0),
		rejectionReason: null,
		createdAt: null,
		...overrides,
	};
}

interface Setup {
	app?: ReuseSourceApp | null;
	listing?: Template | null;
	version?: TemplateVersion | null;
	purchased?: boolean;
	behaviorType?: string;
	deployedCommit?: string | null;
	liveFiles?: TreeFile[];
}

function lookup(setup: Setup = {}) {
	const purchaseChecks: string[] = [];
	const value: ReuseLookup = {
		getSourceApp: async () => (setup.app === undefined ? APP : setup.app),
		getListingByApp: async () => setup.listing ?? null,
		getVersion: async () => (setup.version === undefined ? version() : setup.version),
		hasPurchase: async (listingId, userId) => {
			purchaseChecks.push(`${listingId}:${userId}`);
			return setup.purchased ?? false;
		},
		getAgentFacts: async () => ({
			behaviorType: setup.behaviorType ?? 'think',
			deployedCommit: setup.deployedCommit === undefined ? 'c9' : setup.deployedCommit,
		}),
		readLiveTree: async () => setup.liveFiles ?? LIVE_FILES,
		readSnapshot: async () => SNAPSHOT_FILES,
	};
	return { value, purchaseChecks };
}

describe('resolveReuseStart', () => {
	it('refuses a missing or malformed source', async () => {
		const unavailable = { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
		expect(await resolveReuseStart(lookup().value, undefined, 'buyer')).toEqual(unavailable);
		expect(await resolveReuseStart(lookup({ app: null }).value, 'app1', 'buyer')).toEqual(unavailable);
	});

	it('refuses a site an admin removed', async () => {
		const removed = lookup({ app: { ...APP, removedFromDiscoverAt: new Date(0) } });
		expect(await resolveReuseStart(removed.value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('copies the latest deploy of a free site', async () => {
		const result = await resolveReuseStart(lookup().value, 'app1', 'buyer');
		expect(result).toEqual({
			ok: true,
			seed: {
				sourceAppId: 'app1',
				sourceTitle: 'Lumen Yoga',
				versionId: null,
				files: [{ path: 'index.html', bytes: LIVE_FILES[0].bytes }],
			},
		});
	});

	it('drops env files from a free copy', async () => {
		const result = await resolveReuseStart(lookup().value, 'app1', 'buyer');
		if (!result.ok) throw new Error(result.error);
		expect(result.seed.files.map((file) => file.path)).toEqual(['index.html']);
	});

	it('refuses a free site whose files contain a secret', async () => {
		const secret = encoder.encode('const key = "sk-ant-' + 'a'.repeat(40) + '";');
		const result = await resolveReuseStart(
			lookup({ liveFiles: [{ path: '/app.js', bytes: secret }] }).value,
			'app1',
			'buyer',
		);
		expect(result).toEqual({ ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE });
	});

	it('refuses a free site that is not a deployed Think app', async () => {
		expect(await resolveReuseStart(lookup({ behaviorType: 'phasic' }).value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 400,
			error: SITE_NOT_REUSABLE_MESSAGE,
		});
	});

	it('refuses a paid site before its first approval, also for the owner', async () => {
		const pending = lookup({ listing: listing({ currentVersionId: null }) });
		expect(await resolveReuseStart(pending.value, 'app1', 'owner')).toEqual({
			ok: false,
			status: 409,
			error: SITE_NOT_YET_AVAILABLE_MESSAGE,
		});
	});

	it('asks a non-owner to buy an approved paid site', async () => {
		const paid = lookup({ listing: listing() });
		expect(await resolveReuseStart(paid.value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 402,
			error: SITE_PURCHASE_REQUIRED_MESSAGE,
		});
		expect(paid.purchaseChecks).toEqual(['l1:buyer']);
	});

	it('copies the approved snapshot for a buyer and for the owner', async () => {
		const expected = {
			ok: true,
			seed: { sourceAppId: 'app1', sourceTitle: 'Lumen Yoga', versionId: 'v2', files: SNAPSHOT_FILES },
		};
		expect(await resolveReuseStart(lookup({ listing: listing(), purchased: true }).value, 'app1', 'buyer')).toEqual(
			expected,
		);
		const owner = lookup({ listing: listing() });
		expect(await resolveReuseStart(owner.value, 'app1', 'owner')).toEqual(expected);
		expect(owner.purchaseChecks).toEqual([]);
	});

	it('refuses a paid site whose approved version is gone', async () => {
		expect(await resolveReuseStart(lookup({ listing: listing(), version: null }).value, 'app1', 'owner')).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});
});
