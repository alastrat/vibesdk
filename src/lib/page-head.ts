import { pageTitle } from '@/brand/page-title';
import { absoluteUrl } from './seo';

/** What a page tells search engines and shared links about itself. */
export interface PageHead {
	/** The page's name, before the brand; a page without one is named by the brand alone. */
	title?: string;
	description: string;
	/** The page's own address, which it names as canonical. */
	path?: string;
	/** A picture that shared links show large. */
	image?: { src: string; alt: string };
}

/** A meta or link tag for the document head, as its attributes. */
export interface HeadTag {
	name: 'meta' | 'link';
	attributes: Readonly<Record<string, string>>;
}

/**
 * The tags that follow the page's title and description: Open Graph and X cards, and the canonical address when the
 * page names its path. The page renders them and the worker writes them into the HTML, so both say the same.
 */
export function pageHeadTags({ title, description, path, image }: PageHead, origin: string): readonly HeadTag[] {
	const tags: HeadTag[] = [
		{ name: 'meta', attributes: { property: 'og:type', content: 'website' } },
		{ name: 'meta', attributes: { property: 'og:title', content: pageTitle(title) } },
		{ name: 'meta', attributes: { property: 'og:description', content: description } },
		{ name: 'meta', attributes: { name: 'twitter:card', content: image ? 'summary_large_image' : 'summary' } },
	];
	if (path !== undefined) {
		const url = absoluteUrl(path, origin);
		tags.push({ name: 'link', attributes: { rel: 'canonical', href: url } }, { name: 'meta', attributes: { property: 'og:url', content: url } });
	}
	if (image) {
		tags.push(
			{ name: 'meta', attributes: { property: 'og:image', content: absoluteUrl(image.src, origin) } },
			{ name: 'meta', attributes: { property: 'og:image:alt', content: image.alt } },
		);
	}
	return tags;
}
