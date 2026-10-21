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
	it('is routed for signed-in users and opens from an Emails item in the sidebar, folded and open', () => {
		expect(source('/src/routes.tsx')).toMatch(/path: 'emails',\s*Component: protectedPage\(ShopperEmailsPage\)/);
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		expect(sidebar.match(/navigate\(SHOPPER_EMAILS_PATH\)/g) ?? []).toHaveLength(2);
		expect(sidebar).toContain('id="emails-link"');
		expect(sidebar.indexOf('id="orders-link"')).toBeLessThan(sidebar.indexOf('id="emails-link"'));
		// Each form lists Orders, Emails, then Translations.
		expect(sidebar.match(/id="emails-link"/g) ?? []).toHaveLength(2);
		expect(sidebar.indexOf('id="emails-link"')).toBeLessThan(sidebar.indexOf('id="translations-link"'));
		expect(sidebar.lastIndexOf('id="emails-link"')).toBeLessThan(sidebar.lastIndexOf('id="translations-link"'));
		expect(sidebar.indexOf('id="translations-link"')).toBeLessThan(sidebar.lastIndexOf('id="emails-link"'));
	});

	it('shows each email with its switch, Edit and where it came from, a store picker, and where replies go', () => {
		const page = source('/src/routes/emails/emails.tsx');
		for (const part of ['data.templates.map', '<Switch', 'Edit', 'templateOrigin(template)', 'stores.data.stores', 'Replies go to', 'Publish a store to set up its emails.', 'Recent emails', 'STATUS_LABELS', 'Shoppers get these emails from', 'data.senderEmail']) expect(page, part).toContain(part);
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
		expect(editor).toMatch(/<ConfirmButton[^>]*label="Reset to default"/);
		expect(editor).toContain('disabled={save.isPending}');
	});

	it('names no supplier or AI assistant', () => {
		for (const path of ['/src/routes/emails/emails.tsx', '/src/routes/emails/template-editor.tsx']) {
			const text = source(path).toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(text, `${path}: ${name}`).not.toContain(name);
		}
	});
});
