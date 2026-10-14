/** Legal pages are Markdown with a small header and {{named}} fields filled from shared constants. */

export interface LegalDocument {
	title: string;
	version: string;
	updated: string;
	body: string;
}

const HEADER = /^---\n([\s\S]*?)\n---\n?/;
const FIELD = /\{\{\s*([a-z.]+)\s*\}\}/g;

export function parseLegalDocument(raw: string, fields: Readonly<Record<string, string>>): LegalDocument {
	const text = raw.replace(/\r\n/g, '\n');
	const header = HEADER.exec(text);
	if (!header) throw new Error('Legal document is missing its header');

	const meta = new Map<string, string>();
	for (const line of header[1].split('\n')) {
		const separator = line.indexOf(':');
		if (separator > 0) meta.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	const title = meta.get('title');
	const version = meta.get('version');
	const updated = meta.get('updated');
	if (!title || !version || !updated) throw new Error('Legal document header needs title, version and updated');

	const body = text.slice(header[0].length).replace(FIELD, (_match, name: string) => {
		const value = fields[name];
		if (value === undefined) throw new Error(`Unknown legal field: ${name}`);
		return value;
	});
	return { title, version, updated, body: body.trim() };
}
