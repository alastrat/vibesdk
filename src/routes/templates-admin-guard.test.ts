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
});
