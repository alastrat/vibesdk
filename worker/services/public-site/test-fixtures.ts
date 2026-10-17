export const ORIGIN = 'https://estori.example';

// The Workers test pool loads .html as a text module; `?raw` is not resolvable there.
export const INDEX_HTML = Object.values(import.meta.glob<string>('/index.html', { import: 'default', eager: true }))[0] ?? '';

export interface HeadElement {
	tag: string;
	attributes: Record<string, string>;
	text: string;
}

const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function decode(value: string): string {
	return value.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** The head's elements as a browser would read them: attribute values and text with their entities decoded. */
export async function headElements(html: string): Promise<HeadElement[]> {
	const elements: HeadElement[] = [];
	await new HTMLRewriter()
		.on('head > *', {
			element(element) {
				const attributes = Object.fromEntries([...element.attributes].map(([name, value]) => [name, decode(value)]));
				elements.push({ tag: element.tagName, attributes, text: '' });
			},
			text(chunk) {
				const current = elements.at(-1);
				if (current) current.text += chunk.text;
			},
		})
		.transform(new Response(html))
		.text();
	return elements.map((element) => ({ ...element, text: decode(element.text) }));
}

export function htmlResponse(html: string = INDEX_HTML, headers: Readonly<Record<string, string>> = {}): Response {
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}
