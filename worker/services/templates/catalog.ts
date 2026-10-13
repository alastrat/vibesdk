/**
 * Paid-listing review and purchase rules. Pure, so each rule is unit-tested.
 * Publishing and reuse rules live in reuse.ts.
 */

import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type TemplateCategory,
	type TemplateShotKind,
	type TemplateVersionStatus,
} from '../../../shared/types/templates';

export const MAX_REJECTION_REASON_LENGTH = 500;
export const VERSION_IN_REVIEW_ERROR = 'An update is already in review; withdraw it first';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export type PurchaseDecision = { ok: true; alreadyOwned: boolean } | { ok: false; status: 400; error: string };

interface PurchaseInput {
	/** The approved price; 0 for a free site. */
	priceCents: number;
	isCreator: boolean;
	hasPurchase: boolean;
}

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

function trimmedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function isTemplateCategory(value: unknown): value is TemplateCategory {
	return typeof value === 'string' && (TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

export function isTemplatePrice(value: unknown): value is number {
	return typeof value === 'number' && (TEMPLATE_PRICE_OPTIONS_CENTS as readonly number[]).includes(value);
}

/** Whether a user can buy a site; buying one already owned succeeds without a new record. */
export function purchaseDecision(input: PurchaseInput): PurchaseDecision {
	if (input.priceCents === 0) return { ok: false, status: 400, error: 'This site is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You published this site' };
	return { ok: true, alreadyOwned: input.hasPurchase };
}

/** A listing takes a new version only while none is in review. */
export function canSubmitNewVersion(statuses: readonly TemplateVersionStatus[]): boolean {
	return !statuses.includes('pending');
}

export function canWithdraw(status: TemplateVersionStatus): boolean {
	return status === 'pending';
}

export function canReview(status: TemplateVersionStatus): boolean {
	return status === 'pending';
}

export function parseRejectionReason(body: unknown): Validation<string> {
	const reason = trimmedString(field(body, 'reason'));
	if (reason.length === 0) {
		return { ok: false, error: 'A reason is required to reject this version' };
	}
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: reason };
}

/**
 * The price a paid update asks for: the approved price once there is one, so a
 * rejected higher price is never resubmitted; before that, the newest asked price.
 * `versions` is newest first.
 */
export function paidUpdatePrice(
	listing: { currentVersionId: string | null; priceCents: number },
	versions: Array<{ status: TemplateVersionStatus; priceCents: number }>,
): number {
	if (listing.currentVersionId !== null) return listing.priceCents;
	return versions[0]?.priceCents ?? listing.priceCents;
}

/** The version an approval supersedes: the listing's current one, when it differs. */
export function supersededVersionId(currentVersionId: string | null, approvedVersionId: string): string | null {
	return currentVersionId && currentVersionId !== approvedVersionId ? currentVersionId : null;
}

export function isTemplateShotKind(value: string): value is TemplateShotKind {
	return value === 'desktop' || value === 'mobile';
}
