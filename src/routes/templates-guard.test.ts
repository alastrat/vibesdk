import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/home.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/templates/detail.tsx',
		'/src/components/layout/app-sidebar.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: gallery and use', () => {
	it('registers the gallery and template pages', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'templates'");
		expect(routes).toContain("path: 'templates/:slug'");
	});

	it('offers templates under the home prompt and in the sidebar', () => {
		expect(source('/src/routes/home.tsx')).toContain('<TemplateStrip />');
		expect(source('/src/components/layout/app-sidebar.tsx')).toContain("navigate('/templates')");
	});

	it('starts a chat session from the template in the URL', () => {
		expect(source('/src/routes/chat/chat.tsx')).toContain("searchParams.get('template')");
		const useChat = source('/src/routes/chat/hooks/use-chat.ts');
		expect(useChat).toContain('if (!userQuery && !templateId)');
		expect(useChat).toContain('templateId,');
	});

	it('surfaces a failed template start and finishes an exact copy without generating', () => {
		const useChat = source('/src/routes/chat/hooks/use-chat.ts');
		expect(useChat).toContain('if (obj.error)');
		expect(useChat).toContain('disableGenerate: Boolean(templateId) && query.length === 0');
	});

	it('asks for a purchase before a paid template can be used, in test mode', () => {
		const detail = source('/src/routes/templates/detail.tsx');
		expect(detail).toContain('viewer.canUse');
		expect(detail).toContain("Payments are in test mode. You won't be charged.");
	});
});
