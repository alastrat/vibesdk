import { t } from '@/lib/i18n';
import { MAIN_DRAFT_ID, type DraftSummary, type DraftsSnapshot } from '@/api-types';

export interface DraftBadge {
	label: string;
	variant: 'success' | 'secondary' | 'outline';
}

/** What the switcher says about a draft against the live store. */
export function draftBadges(draft: Pick<DraftSummary, 'live' | 'unpublishedChanges' | 'behindLive' | 'bringingInLiveChanges'>): DraftBadge[] {
	if (draft.bringingInLiveChanges) return [{ label: t("Bringing in live changes"), variant: 'secondary' }];
	if (draft.live) return [{ label: t("Live"), variant: 'success' }];
	const badges: DraftBadge[] = [];
	if (draft.unpublishedChanges) badges.push({ label: t("Unpublished changes"), variant: 'secondary' });
	if (draft.behindLive) badges.push({ label: t("Behind the live store"), variant: 'outline' });
	return badges;
}

/** Delete isn't offered for Main, the draft being edited, or the one the live store came from. */
export function canDeleteDraft(draft: Pick<DraftSummary, 'id' | 'active' | 'publishedFromHere'>): boolean {
	return draft.id !== MAIN_DRAFT_ID && !draft.active && !draft.publishedFromHere;
}

/** The chat request the "Bring in live changes" buttons send. */
export function bringInRequest(draftName: string): string {
	return t("Bring the live store's changes into '{value1}'.", { value1: draftName });
}

/** Main's banner: Main is being edited and lacks a fix that went live from another draft. */
export function showsLiveFixBanner(snapshot: DraftsSnapshot): boolean {
	const main = snapshot.drafts.find((draft) => draft.id === MAIN_DRAFT_ID);
	const source = snapshot.drafts.find((draft) => draft.publishedFromHere);
	return !!main && main.active && main.behindLive && !!source && source.id !== MAIN_DRAFT_ID;
}
