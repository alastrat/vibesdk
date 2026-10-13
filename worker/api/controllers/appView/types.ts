/**
 * Type definitions for AppView Controller responses
 * Following strict DRY principles by reusing existing database types
 */

import { AgentSummary, BehaviorType } from '../../../agents/core/types';
import { PublicAppDetailData } from '../../../database/types';

/**
 * Generated code file structure
 */
export interface GeneratedCodeFile {
    filePath: string;
    fileContents: string;
    explanation?: string;
}

/** What the viewer can do with a published site. */
export interface AppReuseView {
    /** The viewer can start a new app from this site now. */
    canUse: boolean;
    /** The site is paid and the viewer hasn't bought it. */
    needsPurchase: boolean;
    /** The approved price, or null for a free site. */
    priceCents: number | null;
    /** Why the site can't be used, shown to its owner; null when it can be or only needs a purchase. */
    unavailableReason: string | null;
}

/** The published site an app was copied from. */
export interface StartedFromView {
    appId: string;
    title: string;
    creatorName: string;
    /** The source is still public and in Discover. */
    available: boolean;
}

/**
 * Response data for getAppDetails - extends the safe public detail projection.
 * Adds only fields unique to app view response; owner-only fields (userId,
 * deploymentId) are optional and populated only when the viewer owns the app.
 */
export interface AppDetailsData extends PublicAppDetailData {
    cloudflareUrl: string | null;
    previewUrl: string | null;
    behaviorType: BehaviorType | null;
    /** Null for private apps. */
    reuse: AppReuseView | null;
    startedFrom: StartedFromView | null;
    /** The viewer is an admin and may remove the site from Discover. */
    canModerate: boolean;
    /** Shown to the owner and admins only. */
    removedFromDiscover: { reason: string | null } | null;
    user: {
        id: string;
        displayName: string;
        avatarUrl: string | null;
    };
    agentSummary: AgentSummary | null;
}

/**
 * Response data for toggleAppStar
 */
export interface AppStarToggleData {
    isStarred: boolean;
    starCount: number;
}

/**
 * Response data for git clone token generation
 */
export interface GitCloneTokenData {
    token: string;
    expiresIn: number;
    expiresAt: string;
    cloneUrl: string;
}

/**
 * Response data for owner-preview token generation. Lets the owner open a
 * private deployed app's URL on a preview subdomain.
 */
export interface PreviewTokenData {
    token: string;
    expiresIn: number;
    expiresAt: string;
    /** Deployment URL with the owner-preview token appended. */
    previewUrl: string;
}

// /**
//  * Response data for forkApp
//  */
// export interface ForkAppData {
//     forkedAppId: string;
//     message: string;
// }