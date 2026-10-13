import { describe, expect, it } from 'vitest';
import type { TemplateSource } from '../../agents/core/types';
import { NOT_DEPLOYED_REASON, NOT_THINK_REASON, type ListingState, type PublishRequest } from './reuse';
import { VERSION_IN_REVIEW_ERROR } from './catalog';
import type { SitePageCopy } from '../../../shared/types/site-page';
import { publishSite, type PublishDeps } from './publish';
import { SCREENSHOT_FAILED_MESSAGE, TemplateSubmissionError } from './submit';
import type { TreeFile } from './snapshot';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, SELLER_NOT_ONBOARDED_MESSAGE } from '../payments/config';

const SOURCE: TemplateSource = { commit: 'c1', previewUrl: 'https://preview.test/' };
const FILES: TreeFile[] = [{ path: '/index.html', bytes: new TextEncoder().encode('<h1>Hi</h1>') }];
const FREE: PublishRequest = { visibility: 'public', category: 'landing', priceCents: 0 };
const PAID: PublishRequest = { visibility: 'public', category: 'store', priceCents: 2900 };

interface Setup {
	listing?: { id: string; state: ListingState; reviewedCopy?: SitePageCopy | null } | null;
	savedCopy?: SitePageCopy | null;
	behaviorType?: string;
	source?: TemplateSource | null;
	files?: TreeFile[];
	submitError?: Error;
	sellerPayouts?: 'ready' | 'not-configured' | 'not-onboarded';
}

function harness(setup: Setup = {}) {
	const calls: string[] = [];
	const saved: Array<SitePageCopy | null> = [];
	const versionCopies: Array<SitePageCopy | null> = [];
	const deps: PublishDeps = {
		loadListing: async () => (setup.listing ? { reviewedCopy: null, ...setup.listing } : null),
		loadSource: async () => ({
			behaviorType: setup.behaviorType ?? 'think',
			source: setup.source === undefined ? SOURCE : setup.source,
		}),
		readTree: async () => setup.files ?? FILES,
		createListing: async () => {
			calls.push('createListing');
			return 'new-listing';
		},
		setListingStatus: async (listingId, status) => {
			calls.push(`setListingStatus:${listingId}:${status}`);
		},
		submitVersion: async (listingId, _source, priceCents, pageCopy) => {
			calls.push(`submitVersion:${listingId}:${priceCents}`);
			versionCopies.push(pageCopy);
			if (setup.submitError) throw setup.submitError;
		},
		loadSavedCopy: async () => setup.savedCopy ?? null,
		savePageCopy: async (copy) => {
			saved.push(copy);
		},
		applyVisibility: async (request) => {
			calls.push(`applyVisibility:${request.visibility}`);
		},
		sellerPayouts: async () => setup.sellerPayouts ?? 'ready',
	};
	return { deps, calls, saved, versionCopies };
}

const APPROVED: { id: string; state: ListingState } = {
	id: 'l1',
	state: { status: 'listed', currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null },
};

describe('publishSite', () => {
	it('makes an app private without touching its listing', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, { visibility: 'private' })).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:private']);
	});

	it('refuses apps that are not deployed Think apps', async () => {
		const legacy = harness({ behaviorType: 'phasic', source: null });
		expect(await publishSite(legacy.deps, FREE)).toEqual({ ok: false, status: 400, error: NOT_THINK_REASON });
		const undeployed = harness({ source: null });
		expect(await publishSite(undeployed.deps, FREE)).toEqual({ ok: false, status: 400, error: NOT_DEPLOYED_REASON });
		expect([...legacy.calls, ...undeployed.calls]).toEqual([]);
	});

	it('publishes a free site after checking its files', async () => {
		const { deps, calls } = harness();
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:public']);
	});

	it('refuses a free site whose files contain a secret', async () => {
		const secret = new TextEncoder().encode('const key = "sk-ant-' + 'a'.repeat(40) + '";');
		const { deps, calls } = harness({ files: [{ path: '/src/app.js', bytes: secret }] });
		expect(await publishSite(deps, FREE)).toEqual({
			ok: false,
			status: 400,
			error: 'src/app.js looks like it contains a secret key; remove it and redeploy',
		});
		expect(calls).toEqual([]);
	});

	it('unlists the paid listing when the owner switches to free', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['setListingStatus:l1:unlisted', 'applyVisibility:public']);
	});

	it('submits, lists and publishes on the first paid publish', async () => {
		const { deps, calls } = harness();
		expect(await publishSite(deps, PAID)).toEqual({ ok: true, inReview: true });
		expect(calls).toEqual([
			'createListing',
			'submitVersion:new-listing:2900',
			'setListingStatus:new-listing:listed',
			'applyVisibility:public',
		]);
	});

	it('keeps a free public site reusable when the paid submission fails', async () => {
		const { deps, calls } = harness({ submitError: new TemplateSubmissionError(SCREENSHOT_FAILED_MESSAGE, 400) });
		expect(await publishSite(deps, PAID)).toEqual({ ok: false, status: 400, error: SCREENSHOT_FAILED_MESSAGE });
		expect(calls).toEqual(['createListing', 'submitVersion:new-listing:2900']);
	});

	it('saves settings without a new review when the approved price stays', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, PAID)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:public']);
	});

	it('refuses a new price while another one is in review', async () => {
		const inReview = { id: 'l1', state: { ...APPROVED.state, pendingPriceCents: 4900 } };
		const { deps, calls } = harness({ listing: inReview });
		expect(await publishSite(deps, PAID)).toEqual({ ok: false, status: 409, error: VERSION_IN_REVIEW_ERROR });
		expect(calls).toEqual([]);
	});

	it('lets errors other than submission errors reach the caller', async () => {
		const { deps } = harness({ submitError: new Error('R2 down') });
		await expect(publishSite(deps, PAID)).rejects.toThrow('R2 down');
	});

	it('refuses a paid publish until the seller can receive payments', async () => {
		const notOnboarded = harness({ sellerPayouts: 'not-onboarded' });
		expect(await publishSite(notOnboarded.deps, PAID)).toEqual({ ok: false, status: 400, error: SELLER_NOT_ONBOARDED_MESSAGE });
		const notConfigured = harness({ sellerPayouts: 'not-configured' });
		expect(await publishSite(notConfigured.deps, PAID)).toEqual({ ok: false, status: 400, error: PAYMENTS_NOT_CONFIGURED_MESSAGE });
		expect([...notOnboarded.calls, ...notConfigured.calls]).toEqual([]);
	});

	it('publishes a free site without asking about payouts', async () => {
		const { deps } = harness({ sellerPayouts: 'not-configured' });
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
	});

	const COPY: SitePageCopy = {
		tagline: 'A calm site',
		about: ['About it.'],
		features: ['a', 'b', 'c'],
		includes: [{ name: 'Home', detail: 'The one page' }],
		madeFor: ['Studios', 'Teachers'],
	};

	it('saves a free site text with the publish and leaves it alone when the request has none', async () => {
		const withText = harness();
		expect(await publishSite(withText.deps, { ...FREE, pageCopy: COPY })).toEqual({ ok: true, inReview: false });
		expect(withText.saved).toEqual([COPY]);
		const without = harness();
		await publishSite(without.deps, FREE);
		expect(without.saved).toEqual([]);
	});

	it('sends changed text on an approved paid site for review, with the text attached', async () => {
		const { deps, calls, versionCopies, saved } = harness({ listing: { ...APPROVED, reviewedCopy: null } });
		expect(await publishSite(deps, { ...PAID, pageCopy: COPY })).toEqual({ ok: true, inReview: true });
		expect(calls).toEqual(['submitVersion:l1:2900', 'applyVisibility:public']);
		expect(versionCopies).toEqual([COPY]);
		expect(saved).toEqual([COPY]);
	});

	it('keeps an approved paid site out of review when its text is unchanged or omitted', async () => {
		const same = harness({ listing: { ...APPROVED, reviewedCopy: COPY } });
		expect(await publishSite(same.deps, { ...PAID, pageCopy: COPY })).toEqual({ ok: true, inReview: false });
		const omitted = harness({ listing: { ...APPROVED, reviewedCopy: COPY } });
		expect(await publishSite(omitted.deps, PAID)).toEqual({ ok: true, inReview: false });
		expect([...same.calls, ...omitted.calls]).toEqual(['applyVisibility:public', 'applyVisibility:public']);
	});

	it('attaches the saved text to a first paid version when the request has none', async () => {
		const { deps, versionCopies } = harness({ savedCopy: COPY });
		await publishSite(deps, PAID);
		expect(versionCopies).toEqual([COPY]);
	});
});
