import { describe, expect, it } from 'vitest';
import { approvedShotKey, pageCopyFor, siteOffer, toSitePageData, type SitePageSource } from './sitePageDto';
import type { SitePageCopy } from '../../../../shared/types/site-page';

const COPY: SitePageCopy = {
	tagline: 'Approved text',
	about: ['About it.'],
	features: ['a', 'b', 'c'],
	includes: [{ name: 'Home', detail: 'The one page' }],
	madeFor: ['Studios', 'Teachers'],
};
const SAVED: SitePageCopy = { ...COPY, tagline: 'Newer saved text' };
const LISTED = { status: 'listed' as const, currentVersionId: 'v2', priceCents: 2900 };
const VERSION = { id: 'v2', status: 'approved' as const, pageCopy: JSON.stringify(COPY), reviewedAt: new Date('2026-10-13T00:00:00Z'), desktopShotKey: 'd.jpg', mobileShotKey: 'm.jpg' };

describe('siteOffer', () => {
	const base = { isOwner: false, hasPurchase: false, reusable: true, listing: null };

	it('offers a free reusable site for use, and an undeployed one as not available yet', () => {
		expect(siteOffer(base)).toEqual({ kind: 'free' });
		expect(siteOffer({ ...base, reusable: false })).toEqual({ kind: 'not-yet-available' });
	});

	it('sells an approved paid site, and lets a buyer use it', () => {
		expect(siteOffer({ ...base, listing: LISTED })).toEqual({ kind: 'paid', priceCents: 2900 });
		expect(siteOffer({ ...base, listing: LISTED, hasPurchase: true })).toEqual({ kind: 'owned' });
	});

	it('holds a paid site whose first price is not approved yet', () => {
		expect(siteOffer({ ...base, listing: { ...LISTED, currentVersionId: null } })).toEqual({ kind: 'not-yet-available' });
	});

	it('gives the owner their own controls, usable only when the site can be copied', () => {
		expect(siteOffer({ ...base, isOwner: true })).toEqual({ kind: 'own', canUse: true });
		expect(siteOffer({ ...base, isOwner: true, listing: { ...LISTED, currentVersionId: null } })).toEqual({ kind: 'own', canUse: false });
		expect(siteOffer({ ...base, isOwner: true, reusable: false })).toEqual({ kind: 'own', canUse: false });
	});

	it('treats an unlisted listing as a free site', () => {
		expect(siteOffer({ ...base, listing: { ...LISTED, status: 'unlisted' } })).toEqual({ kind: 'free' });
	});
});

describe('pageCopyFor', () => {
	it("shows a paid site's approved text even when newer text is saved or in review", () => {
		expect(pageCopyFor(LISTED, VERSION, SAVED)).toEqual(COPY);
	});

	it('shows no text for a paid site before its first approval', () => {
		expect(pageCopyFor({ ...LISTED, currentVersionId: null }, null, SAVED)).toBeNull();
	});

	it('shows the saved text for a free site', () => {
		expect(pageCopyFor(null, null, SAVED)).toEqual(SAVED);
		expect(pageCopyFor({ ...LISTED, status: 'unlisted' }, VERSION, SAVED)).toEqual(SAVED);
	});
});

describe('approvedShotKey', () => {
	it("serves only the current approved version's screenshots", () => {
		expect(approvedShotKey(LISTED, VERSION, 'desktop')).toBe('d.jpg');
		expect(approvedShotKey(LISTED, VERSION, 'mobile')).toBe('m.jpg');
		expect(approvedShotKey(LISTED, { ...VERSION, status: 'pending' }, 'desktop')).toBeNull();
		expect(approvedShotKey(LISTED, { ...VERSION, id: 'v3' }, 'desktop')).toBeNull();
		expect(approvedShotKey({ ...LISTED, status: 'unlisted' }, VERSION, 'desktop')).toBeNull();
		expect(approvedShotKey(null, VERSION, 'desktop')).toBeNull();
	});
});

describe('toSitePageData', () => {
	const source: SitePageSource = {
		app: {
			id: 'app1',
			title: 'North Ridge',
			description: 'A small coffee store.\n\nSix coffees with tasting notes.',
			category: 'store',
			screenshotUrl: 'https://shots.test/app1.png',
			createdAt: new Date('2026-10-01T00:00:00Z'),
			reuseConsentAt: new Date('2026-10-02T00:00:00Z'),
			lastDeployedAt: new Date('2026-10-05T00:00:00Z'),
			userName: 'Template Creator',
			userAvatar: null,
			viewCount: 15,
			starCount: 2,
			forkCount: 3,
		},
		isOwner: false,
		hasPurchase: false,
		reusable: true,
		listing: LISTED,
		approvedVersion: VERSION,
		savedCopy: SAVED,
		previewUrl: 'https://preview.test/?t=1',
		moreFromCreator: [{ id: 'app2', title: 'Lumen', screenshotUrl: null, priceCents: null }],
	};

	it('assembles a paid page with the approved text, price, screenshots and stats', () => {
		expect(toSitePageData(source)).toEqual({
			id: 'app1',
			title: 'North Ridge',
			category: 'store',
			description: 'A small coffee store.\n\nSix coffees with tasting notes.',
			copy: COPY,
			offer: { kind: 'paid', priceCents: 2900 },
			priceCents: 2900,
			creator: { displayName: 'Template Creator', avatarUrl: null },
			stats: { uses: 3, views: 15, likes: 2 },
			publishedAt: '2026-10-02T00:00:00.000Z',
			updatedAt: '2026-10-13T00:00:00.000Z',
			previewUrl: 'https://preview.test/?t=1',
			screenshotUrl: 'https://shots.test/app1.png',
			approvedShots: {
				desktop: '/api/discover/app1/screenshots/desktop?v=v2',
				mobile: '/api/discover/app1/screenshots/mobile?v=v2',
			},
			moreFromCreator: [{ id: 'app2', title: 'Lumen', screenshotUrl: null, priceCents: null }],
		});
	});

	it('assembles a free page that has no preview, falling back to the description', () => {
		const page = toSitePageData({
			...source,
			listing: null,
			approvedVersion: null,
			savedCopy: null,
			previewUrl: null,
			reusable: false,
			app: { ...source.app, reuseConsentAt: null, viewCount: undefined, starCount: 0, forkCount: undefined },
		});
		expect(page.copy).toBeNull();
		expect(page.offer).toEqual({ kind: 'not-yet-available' });
		expect(page.priceCents).toBeNull();
		expect(page.approvedShots).toBeNull();
		expect(page.previewUrl).toBeNull();
		expect(page.publishedAt).toBe('2026-10-01T00:00:00.000Z');
		expect(page.updatedAt).toBe('2026-10-05T00:00:00.000Z');
		expect(page.stats).toEqual({ uses: 0, views: 0, likes: 0 });
	});
});
