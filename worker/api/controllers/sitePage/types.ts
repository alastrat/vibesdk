/** API types for Discover product pages and AI-drafted page text. */

import type { SitePageCopy } from '../../../../shared/types/site-page';
import type { TemplateCategory } from '../../../../shared/types/templates';

/** What the page's main button does for this viewer. */
export type SitePageOffer =
    | { kind: 'free' }
    | { kind: 'paid'; priceCents: number }
    | { kind: 'owned' }
    | { kind: 'own'; canUse: boolean }
    | { kind: 'not-yet-available' };

export interface SitePageCard {
    id: string;
    title: string;
    screenshotUrl: string | null;
    /** The site has a listed paid listing, approved or not. */
    paid: boolean;
    /** The approved price of a paid site; null for a free site or one not approved yet. */
    priceCents: number | null;
}

export interface SitePageData {
    id: string;
    title: string;
    category: TemplateCategory | null;
    /** The site's original description; About falls back to it when there is no page text. */
    description: string | null;
    copy: SitePageCopy | null;
    offer: SitePageOffer;
    /** The site has a listed paid listing, approved or not. */
    paid: boolean;
    /** The approved price of a paid site; null when the site is free or not yet approved. */
    priceCents: number | null;
    creator: { displayName: string; avatarUrl: string | null };
    stats: { uses: number; views: number; likes: number };
    publishedAt: string | null;
    updatedAt: string | null;
    /** A fresh signed preview of the deployed site, or null when none can be produced. */
    previewUrl: string | null;
    screenshotUrl: string | null;
    /** The approved version's screenshots, for paid sites. */
    approvedShots: { desktop: string; mobile: string } | null;
    moreFromCreator: SitePageCard[];
}

export interface PageCopyDraftData {
    copy: SitePageCopy;
}
