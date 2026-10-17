import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/App.tsx',
		'/src/components/layout/PublicLayout.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/components/layout/app-sidebar.tsx',
		'/src/routes/legal/LegalPage.tsx',
		'/src/routes/root-index.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public pages', () => {
	it('serves the legal pages in the public layout, open to everyone', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		for (const path of ["path: 'terms'", "path: 'privacy'", "path: 'refunds'", "path: 'copyright'"]) {
			expect(publicBlock).toContain(path);
		}
		expect(publicBlock.slice(0, publicBlock.indexOf('],'))).not.toContain('ProtectedRoute');
	});

	it('keeps the app sidebar only for app routes', () => {
		expect(source('/src/App.tsx')).not.toContain('<AppLayout>');
		expect(source('/src/routes.tsx')).toContain('Component: AppShell');
	});

	it('serves the builder home and the app routes from one app layout, so the sidebar persists between them', () => {
		const routes = source('/src/routes.tsx');
		const appBlock = routes.slice(routes.indexOf('Component: AppShell'), routes.indexOf('Component: PublicShell'));
		expect(appBlock).toContain('{ index: true, Component: RootIndex }');
		expect(appBlock).toContain("path: 'chat/:chatId'");
		expect(appBlock).toContain("path: 'apps'");
		const root = source('/src/routes/root-index.tsx');
		expect(root.match(/<AppLayout\b/g)).toHaveLength(1);
		expect(root).not.toContain('<AppLayout>');
		expect(root).toContain("pathname !== '/'");
		expect(root).toContain('<PublicLayout />');
	});

	it('links every legal page from the footer and the sidebar', () => {
		expect(source('/src/components/layout/SiteFooter.tsx')).toContain('LEGAL_LINKS');
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		expect(sidebar).toContain('LEGAL_LINKS');
		expect(sidebar).toContain("'/pricing'");
	});

	it('starts each public page at the top of its own scroll container', () => {
		const layout = source('/src/components/layout/PublicLayout.tsx');
		expect(layout).toContain('useLocation');
		expect(layout).toContain('scrollTo(');
	});

	it('keeps the top bar usable on phones and the legal pages in the fixed light style', () => {
		expect(source('/src/components/layout/PublicTopBar.tsx')).toContain('hidden lg:flex');
		const legal = source('/src/routes/legal/LegalPage.tsx');
		expect(legal).not.toContain('dark:');
		expect(legal).not.toContain('kumo-');
		expect(legal).toContain('<PageMeta {...legalPage(slug)} />');
		expect(legal).toContain('document.version');
		expect(legal).toContain('max-w-[720px]');
	});

	it('gives the legal lists bullets readable on white, in the muted text color', () => {
		expect(source('/src/routes/legal/LegalPage.tsx')).toContain('prose-li:marker:text-public-muted');
	});
});
