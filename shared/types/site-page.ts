import { msg } from '../i18n/translate';
/**
 * Page text for a Discover site's product page: its shape, limits and the one
 * validation the publish dialog, the drafting endpoint and publishing all use.
 */

export interface SitePageInclude {
	name: string;
	detail: string;
}

export interface SitePageCopy {
	tagline: string;
	/** One to three paragraphs. */
	about: string[];
	features: string[];
	/** Pages or sections of the site. */
	includes: SitePageInclude[];
	madeFor: string[];
}

export type SitePageField = keyof SitePageCopy;

export type PageCopyValidation =
	| { ok: true; value: SitePageCopy }
	| { ok: false; field: SitePageField | null; error: string };

export const SITE_PAGE_LIMITS = {
	tagline: 90,
	aboutParagraphs: { min: 1, max: 3 },
	aboutTotal: 1200,
	features: { min: 3, max: 8, each: 80 },
	includes: { min: 1, max: 12, name: 40, detail: 100 },
	madeFor: { min: 2, max: 5, each: 40 },
} as const;

export const SITE_PAGE_UNAVAILABLE_MESSAGE = msg("This site isn't available");
export const PAGE_DRAFT_FAILED_MESSAGE = msg("Couldn't draft this page; write it yourself or try again");

const MALFORMED = 'Page text is malformed';
// Control characters become spaces, then runs of whitespace collapse.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function normalizeText(value: string): string {
	return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

function textList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const items: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const text = normalizeText(item);
		if (text) items.push(text);
	}
	return items;
}

/** Normalized page text in its canonical key order, or null when the input isn't page text. */
export function normalizePageCopy(raw: unknown): SitePageCopy | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const about = textList(record.about);
	const features = textList(record.features);
	const madeFor = textList(record.madeFor);
	if (typeof record.tagline !== 'string' || !about || !features || !madeFor || !Array.isArray(record.includes)) {
		return null;
	}
	const includes: SitePageInclude[] = [];
	for (const item of record.includes) {
		if (typeof item !== 'object' || item === null) return null;
		const entry = item as Record<string, unknown>;
		if (typeof entry.name !== 'string' || typeof entry.detail !== 'string') return null;
		const name = normalizeText(entry.name);
		const detail = normalizeText(entry.detail);
		if (name || detail) includes.push({ name, detail });
	}
	return { tagline: normalizeText(record.tagline), about, features, includes, madeFor };
}

function within(count: number, range: { min: number; max: number }): boolean {
	return count >= range.min && count <= range.max;
}

export function validatePageCopy(raw: unknown): PageCopyValidation {
	const copy = normalizePageCopy(raw);
	if (!copy) return { ok: false, field: null, error: MALFORMED };
	const limits = SITE_PAGE_LIMITS;

	if (copy.tagline.length === 0) return { ok: false, field: 'tagline', error: 'Add a tagline' };
	if (copy.tagline.length > limits.tagline) {
		return { ok: false, field: 'tagline', error: 'Keep the tagline to 90 characters or fewer' };
	}
	if (!within(copy.about.length, limits.aboutParagraphs)) {
		return { ok: false, field: 'about', error: 'Write 1 to 3 paragraphs about the site' };
	}
	if (copy.about.reduce((total, paragraph) => total + paragraph.length, 0) > limits.aboutTotal) {
		return { ok: false, field: 'about', error: 'Keep About to 1,200 characters or fewer' };
	}
	if (!within(copy.features.length, limits.features)) {
		return { ok: false, field: 'features', error: 'List 3 to 8 features' };
	}
	if (copy.features.some((feature) => feature.length > limits.features.each)) {
		return { ok: false, field: 'features', error: 'Keep each feature to 80 characters or fewer' };
	}
	if (!within(copy.includes.length, limits.includes)) {
		return { ok: false, field: 'includes', error: 'List 1 to 12 pages or sections' };
	}
	const badInclude = copy.includes.some(
		(item) =>
			item.name.length === 0 ||
			item.detail.length === 0 ||
			item.name.length > limits.includes.name ||
			item.detail.length > limits.includes.detail,
	);
	if (badInclude) {
		return {
			ok: false,
			field: 'includes',
			error: 'Give each page or section a name of up to 40 characters and a line of up to 100',
		};
	}
	if (!within(copy.madeFor.length, limits.madeFor)) {
		return { ok: false, field: 'madeFor', error: 'List 2 to 5 kinds of people or businesses it is made for' };
	}
	if (copy.madeFor.some((item) => item.length > limits.madeFor.each)) {
		return { ok: false, field: 'madeFor', error: 'Keep each "Made for" item to 40 characters or fewer' };
	}
	return { ok: true, value: copy };
}

/** Whether two page texts read the same once normalized; two missing texts are the same. */
export function samePageCopy(a: SitePageCopy | null, b: SitePageCopy | null): boolean {
	const left = a ? normalizePageCopy(a) : null;
	const right = b ? normalizePageCopy(b) : null;
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Page text stored as JSON, or null when it is missing or unreadable. */
export function parseStoredPageCopy(json: string | null): SitePageCopy | null {
	if (!json) return null;
	try {
		return normalizePageCopy(JSON.parse(json));
	} catch {
		return null;
	}
}
