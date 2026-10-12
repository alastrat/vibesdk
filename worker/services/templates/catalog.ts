/**
 * Template catalog rules: submission input, slugs, eligibility, and review
 * and listing decisions. Pure, so each rule is unit-tested.
 */

import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type TemplateCategory,
	type TemplateShotKind,
	type TemplateVersionStatus,
} from '../../../shared/types/templates';

export const MIN_TEMPLATE_NAME_LENGTH = 3;
export const MAX_TEMPLATE_NAME_LENGTH = 60;
export const MIN_TEMPLATE_DESCRIPTION_LENGTH = 10;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 280;
export const MAX_REJECTION_REASON_LENGTH = 500;

export const NOT_THINK_REASON = 'Only apps built with the current builder can become templates';
export const NOT_DEPLOYED_REASON = 'Deploy your app before submitting it as a template';
export const VERSION_IN_REVIEW_ERROR = 'A version of this template is already in review';
export const RIGHTS_REQUIRED_ERROR = 'Confirm that you own the rights to this content';
export const TEMPLATE_UNAVAILABLE_MESSAGE = 'This template is no longer available';
export const PURCHASE_REQUIRED_ERROR = 'Buy this template before using it';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TemplateMetadata {
	name: string;
	description: string;
	category: TemplateCategory;
	priceCents: number;
}

export type ListingDecision = { ok: true } | { ok: false; status: 400 | 403; error: string };

export type PurchaseDecision = { ok: true; alreadyOwned: boolean } | { ok: false; status: 400; error: string };

interface UseInput {
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

/** The creator's rights confirmation, required on every submission. */
export function parseRightsConfirmation(body: unknown): Validation<true> {
	return field(body, 'rightsConfirmed') === true
		? { ok: true, value: true }
		: { ok: false, error: RIGHTS_REQUIRED_ERROR };
}

export function isTemplatePrice(value: unknown): value is number {
	return typeof value === 'number' && (TEMPLATE_PRICE_OPTIONS_CENTS as readonly number[]).includes(value);
}

/** Name, description, category and price, set by a template's first submission. A missing price is free. */
export function parseTemplateMetadata(body: unknown): Validation<TemplateMetadata> {
	const name = trimmedString(field(body, 'name'));
	const description = trimmedString(field(body, 'description'));
	const category = field(body, 'category');
	const rawPrice = field(body, 'priceCents');
	const priceCents = rawPrice === undefined ? 0 : rawPrice;
	if (name.length < MIN_TEMPLATE_NAME_LENGTH || name.length > MAX_TEMPLATE_NAME_LENGTH) {
		return { ok: false, error: `Name must be between ${MIN_TEMPLATE_NAME_LENGTH} and ${MAX_TEMPLATE_NAME_LENGTH} characters` };
	}
	if (description.length < MIN_TEMPLATE_DESCRIPTION_LENGTH || description.length > MAX_TEMPLATE_DESCRIPTION_LENGTH) {
		return {
			ok: false,
			error: `Description must be between ${MIN_TEMPLATE_DESCRIPTION_LENGTH} and ${MAX_TEMPLATE_DESCRIPTION_LENGTH} characters`,
		};
	}
	if (!isTemplateCategory(category)) {
		return { ok: false, error: 'Choose a category' };
	}
	if (!isTemplatePrice(priceCents)) {
		return { ok: false, error: 'Choose a price' };
	}
	return { ok: true, value: { name, description, category, priceCents } };
}

/** Free templates are open to everyone; paid ones to their creator and buyers. */
export function canUseTemplate(input: UseInput): boolean {
	return input.priceCents === 0 || input.isCreator || input.hasPurchase;
}

/** Whether a user can buy a template; buying one already owned succeeds without a new record. */
export function purchaseDecision(input: UseInput): PurchaseDecision {
	if (input.priceCents === 0) return { ok: false, status: 400, error: 'This template is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You created this template' };
	return { ok: true, alreadyOwned: input.hasPurchase };
}

/** Slug from a template name: lowercase ASCII words joined by hyphens, at most 48 characters. */
export function slugifyTemplateName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
	return slug || 'template';
}

const SLUG_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomSlugSuffix(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	return Array.from(bytes, (byte) => SLUG_SUFFIX_ALPHABET[byte % SLUG_SUFFIX_ALPHABET.length]).join('');
}

/** The name's slug, or the slug plus a 4-character suffix when it is taken. */
export async function uniqueTemplateSlug(
	name: string,
	isTaken: (slug: string) => Promise<boolean>,
	suffix: () => string = randomSlugSuffix,
): Promise<string> {
	const base = slugifyTemplateName(name);
	if (!(await isTaken(base))) return base;
	for (let attempt = 0; attempt < 5; attempt++) {
		const candidate = `${base}-${suffix()}`;
		if (!(await isTaken(candidate))) return candidate;
	}
	throw new Error('Could not find a free template slug');
}

export function isTemplateSlug(value: string): boolean {
	return value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Why an app cannot be submitted as a template, or null when it can. */
export function eligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null {
	if (behaviorType !== 'think') return NOT_THINK_REASON;
	return hasDeployedCommit ? null : NOT_DEPLOYED_REASON;
}

/** A template takes a new version only while none is in review. */
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
		return { ok: false, error: 'A reason is required to reject a template' };
	}
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: reason };
}

/** The version an approval supersedes: the template's current one, when it differs. */
export function supersededVersionId(currentVersionId: string | null, approvedVersionId: string): string | null {
	return currentVersionId && currentVersionId !== approvedVersionId ? currentVersionId : null;
}

export function parseListingRequest(body: unknown): Validation<boolean> {
	const listed = field(body, 'listed');
	return typeof listed === 'boolean'
		? { ok: true, value: listed }
		: { ok: false, error: 'listed must be true or false' };
}

/** Creators and admins can unlist; only admins can list, and only a template with an approved version. */
export function listingDecision(input: {
	isAdmin: boolean;
	isCreator: boolean;
	listed: boolean;
	hasApprovedVersion: boolean;
}): ListingDecision {
	if (!input.isAdmin && !input.isCreator) {
		return { ok: false, status: 403, error: 'You can only change your own templates' };
	}
	if (!input.listed) return { ok: true };
	if (!input.isAdmin) {
		return { ok: false, status: 403, error: 'Submit a new version to publish this template again' };
	}
	if (!input.hasApprovedVersion) {
		return { ok: false, status: 400, error: 'This template has no approved version to publish' };
	}
	return { ok: true };
}

export function isTemplateShotKind(value: string): value is TemplateShotKind {
	return value === 'desktop' || value === 'mobile';
}
