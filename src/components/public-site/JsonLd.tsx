import { serializeJsonLd, type JsonLdNode } from '@/lib/seo';

/** Schema.org structured data for the page, as a script tag's plain text. */
export function JsonLd({ data }: { data: JsonLdNode }) {
	return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}
