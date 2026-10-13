import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/components/publishing/UseSiteButton.tsx',
		'/src/components/publishing/UseSiteDialog.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('using a published site', () => {
	it('offers Use or Buy on the app page and opens the dialog from ?use=1', () => {
		const app = source('/src/routes/app/index.tsx');
		expect(app).toContain('<UseSiteButton');
		expect(app).toContain("searchParams.get('use') === '1'");
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('reuse.needsPurchase');
		expect(button).toContain('Use this site');
		expect(button).toContain('Secure checkout with Stripe');
		expect(button).toContain('requireAuth(');
	});

	it('hides the code and clone from viewers who may not read the source', () => {
		const app = source('/src/routes/app/index.tsx');
		expect(app).toContain('app.codeVisible');
		expect(app).toContain('app.cloneNeedsToken');
	});

	it('starts a chat session from the site in the URL', () => {
		expect(source('/src/components/publishing/UseSiteDialog.tsx')).toContain('reuseStartPath(');
		expect(source('/src/routes/chat/chat.tsx')).toContain("searchParams.get('source')");
		const useChat = source('/src/routes/chat/hooks/use-chat.ts');
		expect(useChat).toContain('if (!userQuery && !sourceAppId)');
		expect(useChat).toContain('sourceAppId,');
		expect(useChat).toContain('disableGenerate: Boolean(sourceAppId) && query.length === 0');
		expect(useChat).toContain('if (obj.error)');
		expect(useChat).not.toContain('templateId');
	});
});
