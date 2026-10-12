import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/routes/admin/templates.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: admin review', () => {
	it('registers the review page behind sign-in', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'admin/templates'");
		expect(routes).toContain('<AdminTemplatesPage />');
	});

	it('approves, and rejects only with a reason', () => {
		const page = source('/src/routes/admin/templates.tsx');
		expect(page).toContain("decision: 'approve'");
		expect(page).toContain("decision: 'reject', reason");
		expect(page).toContain('disabled={!reason.trim()}');
	});

	it('lets admins unlist published templates', () => {
		const page = source('/src/routes/admin/templates.tsx');
		expect(page).toContain('Published templates');
		expect(page).toContain("useTemplateGallery({ category: null, search: '', limit: 24 })");
		expect(page).toContain('listed: false');
	});

	it('keeps the queue on screen when a refresh fails, and surfaces read errors', () => {
		const page = source('/src/routes/admin/templates.tsx');
		expect(page).toContain("Couldn't load the review queue");
		expect(page).toContain('file.isError');
		expect(page).not.toContain('dangerouslySetInnerHTML');
	});
});
