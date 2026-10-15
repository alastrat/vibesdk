/** A value in schema.org structured data. */
export type JsonLdValue = string | number | boolean | null | readonly JsonLdValue[] | JsonLdNode;

export interface JsonLdNode {
	readonly [key: string]: JsonLdValue;
}

/** One step of a breadcrumb trail. */
export interface Crumb {
	name: string;
	path: string;
}

export const SCHEMA_CONTEXT = 'https://schema.org';

/** A site path as a full address; the origin is the one serving the page, so links match the domain people use. */
export function absoluteUrl(path: string, origin: string): string {
	return new URL(path, origin).href;
}

export function breadcrumbList(crumbs: readonly Crumb[], origin: string): JsonLdNode {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: crumbs.map((crumb, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: crumb.name,
			item: absoluteUrl(crumb.path, origin),
		})),
	};
}

export function faqPage(items: readonly { question: string; answer: string }[]): JsonLdNode {
	return {
		'@type': 'FAQPage',
		mainEntity: items.map((item) => ({
			'@type': 'Question',
			name: item.question,
			acceptedAnswer: { '@type': 'Answer', text: item.answer },
		})),
	};
}

/** For a script tag's text: "<" is escaped so no value can close the tag. */
export function serializeJsonLd(data: JsonLdNode): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}
