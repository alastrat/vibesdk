import type { SitePageCopy } from '@/api-types';

/** Page text as the publish dialog edits it: one item per line, About paragraphs separated by a blank line. */
export interface PageCopyForm {
	tagline: string;
	about: string;
	features: string;
	/** One `Name: line` per line. */
	includes: string;
	madeFor: string;
}

export const EMPTY_PAGE_COPY_FORM: PageCopyForm = { tagline: '', about: '', features: '', includes: '', madeFor: '' };

function lines(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function toPageCopyForm(copy: SitePageCopy | null): PageCopyForm {
	if (!copy) return EMPTY_PAGE_COPY_FORM;
	return {
		tagline: copy.tagline,
		about: copy.about.join('\n\n'),
		features: copy.features.join('\n'),
		includes: copy.includes.map((item) => `${item.name}: ${item.detail}`).join('\n'),
		madeFor: copy.madeFor.join('\n'),
	};
}

/** The page text the fields describe, before validation. */
export function fromPageCopyForm(form: PageCopyForm): SitePageCopy {
	return {
		tagline: form.tagline,
		about: form.about
			.split(/\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean),
		features: lines(form.features),
		includes: lines(form.includes).map((line) => {
			const colon = line.indexOf(':');
			return colon === -1
				? { name: line, detail: '' }
				: { name: line.slice(0, colon).trim(), detail: line.slice(colon + 1).trim() };
		}),
		madeFor: lines(form.madeFor),
	};
}

export function isEmptyPageCopyForm(form: PageCopyForm): boolean {
	return Object.values(form).every((value) => value.trim() === '');
}
