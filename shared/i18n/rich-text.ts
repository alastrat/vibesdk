/** A piece of rich text: plain text, or a tag around more pieces. */
export type RichPart = string | { tag: string; children: RichPart[] };

interface OpenTag {
	tag: string;
	children: RichPart[];
}

/** Only bare tags count; `<a href>`, `<br/>`, `<3` and `1 < 2` stay text, so translated copy can't smuggle in markup. */
const TAG = /<(\/?)([A-Za-z][\w-]*)>/g;

function append(parts: RichPart[], part: RichPart): void {
	if (typeof part === 'string') {
		if (part === '') return;
		const last = parts.length - 1;
		const before = parts[last];
		if (typeof before === 'string') {
			parts[last] = before + part;
			return;
		}
	}
	parts.push(part);
}

/**
 * Splits translated text around its `<tag>…</tag>` pairs, which nest. A tag with no partner, whether an opener left
 * open or a closer with nothing to close, stays in the text as written.
 */
export function parseRichText(text: string): RichPart[] {
	const root: RichPart[] = [];
	const open: OpenTag[] = [];
	const into = (): RichPart[] => open[open.length - 1]?.children ?? root;

	/** Gives up on an opener that never closed: its tag becomes text and its content joins the surrounding parts. */
	const unwrap = (node: OpenTag): void => {
		const parent = into();
		append(parent, `<${node.tag}>`);
		for (const child of node.children) append(parent, child);
	};

	let from = 0;
	for (const match of text.matchAll(TAG)) {
		const [raw, slash, tag] = match;
		append(into(), text.slice(from, match.index));
		from = match.index + raw.length;
		if (slash === '') {
			open.push({ tag, children: [] });
			continue;
		}
		const opener = open.map((node) => node.tag).lastIndexOf(tag);
		if (opener === -1) {
			append(into(), raw);
			continue;
		}
		while (open.length - 1 > opener) {
			const unclosed = open.pop();
			if (unclosed) unwrap(unclosed);
		}
		const closed = open.pop();
		if (closed) into().push(closed);
	}
	append(into(), text.slice(from));
	for (let node = open.pop(); node; node = open.pop()) unwrap(node);
	return root;
}
