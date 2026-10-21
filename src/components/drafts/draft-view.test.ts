import { describe, expect, it } from 'vitest';
import type { DraftSummary, DraftsSnapshot } from '@/api-types';
import { bringInRequest, canDeleteDraft, draftBadges, showsLiveFixBanner } from './draft-view';

const DRAFT: DraftSummary = { id: 'k3x9q2mf', name: 'Typo fix', startedFrom: 'live', updatedAt: 1, active: false, live: false, publishedFromHere: false, unpublishedChanges: false, behindLive: false, bringingInLiveChanges: false };

describe('draftBadges', () => {
	it('says Live, Unpublished changes, Behind the live store, or both', () => {
		expect(draftBadges({ ...DRAFT, live: true })).toEqual([{ label: 'Live', variant: 'success' }]);
		expect(draftBadges({ ...DRAFT, unpublishedChanges: true })).toEqual([{ label: 'Unpublished changes', variant: 'secondary' }]);
		expect(draftBadges({ ...DRAFT, behindLive: true })).toEqual([{ label: 'Behind the live store', variant: 'outline' }]);
		expect(draftBadges({ ...DRAFT, unpublishedChanges: true, behindLive: true }).map((b) => b.label)).toEqual(['Unpublished changes', 'Behind the live store']);
		expect(draftBadges({ ...DRAFT, behindLive: true, bringingInLiveChanges: true })).toEqual([{ label: 'Bringing in live changes', variant: 'secondary' }]);
		expect(draftBadges(DRAFT)).toEqual([]);
	});
});

describe('canDeleteDraft', () => {
	it("isn't offered for Main, the draft being edited, or the one the live store came from", () => {
		expect(canDeleteDraft(DRAFT)).toBe(true);
		expect(canDeleteDraft({ ...DRAFT, id: 'main' })).toBe(false);
		expect(canDeleteDraft({ ...DRAFT, active: true })).toBe(false);
		expect(canDeleteDraft({ ...DRAFT, publishedFromHere: true })).toBe(false);
	});
});

describe("Main's banner and the bring-in request", () => {
	const main: DraftSummary = { ...DRAFT, id: 'main', name: 'Main', startedFrom: 'main', active: true, unpublishedChanges: true, behindLive: true };
	const fix: DraftSummary = { ...DRAFT, live: true, publishedFromHere: true };
	const snapshot = (drafts: DraftSummary[]): DraftsSnapshot => ({ drafts, activeDraftId: drafts.find((d) => d.active)?.id ?? 'main', published: true, limit: 5 });

	it('shows on Main while a fix published from another draft is missing from it', () => {
		expect(showsLiveFixBanner(snapshot([main, fix]))).toBe(true);
		expect(showsLiveFixBanner(snapshot([{ ...main, behindLive: false }, fix]))).toBe(false);
		expect(showsLiveFixBanner(snapshot([{ ...main, active: false }, { ...fix, active: true }]))).toBe(false);
		expect(showsLiveFixBanner(snapshot([{ ...main, publishedFromHere: true }]))).toBe(false);
	});

	it('asks the AI in plain words', () => {
		expect(bringInRequest('Main')).toBe("Bring the live store's changes into 'Main'.");
	});
});
