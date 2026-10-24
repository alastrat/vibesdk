import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/components/layout/app-sidebar.tsx', '/src/routes/emails/emails.tsx', '/src/routes/emails/template-editor.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the Emails page', () => {
	it('keeps legacy links behind sign-in', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'emails',\s*Component: protectedPage\(ShopperEmailsPage\)/);
	});

	it('shows each email with its switch, Edit and where it came from, and where replies go', () => {
		const page = source('/src/routes/emails/emails.tsx');
		for (const part of ['data.templates.map', '<Switch', 'Edit', 'templateOrigin(template)', 'Replies go to', 'Publish a store to set up its emails.', 'Recent emails', 'STATUS_LABELS', 'Shoppers get these emails from', 'data.senderEmail']) expect(page, part).toContain(part);
	});

	it("says Estori sends order emails only, since Cloudflare doesn't allow marketing email", () => {
		expect(source('/src/routes/emails/emails.tsx')).toContain("Estori sends order emails only. Cloudflare, which delivers them, doesn't allow marketing email such as newsletters or promotions.");
	});

	it('edits with the placeholder chips from the data, a sandboxed preview, a test send, and a reset that asks first', () => {
		const editor = source('/src/routes/emails/template-editor.tsx');
		expect(editor).toContain('placeholders.map');
		expect(editor).toContain('sandbox=""');
		expect(editor).toContain('srcDoc={preview.data.html}');
		// A new frame per preview: Chromium can drop a srcdoc change that lands while the last one still loads.
		expect(editor).toContain('key={preview.dataUpdatedAt}');
		expect(editor).toContain('Send me a test');
		expect(editor).toMatch(/<ConfirmButton[^>]*label=\{t\(["']Reset to default["']\)\}/);
		expect(editor).toContain('disabled={save.isPending}');
	});

	it('names no supplier or AI assistant', () => {
		for (const path of ['/src/routes/emails/emails.tsx', '/src/routes/emails/template-editor.tsx']) {
			const text = source(path).toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(text, `${path}: ${name}`).not.toContain(name);
		}
	});
});
