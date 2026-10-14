import { describe, expect, it } from 'vitest';
import capabilities from '../lib/capabilities.ts?raw';
import publicCss from './public-site.css?raw';
import indexCss from '../index.css?raw';

const sources = import.meta.glob<string>(
	['/src/components/layout/PublicLayout.tsx', '/src/components/layout/app-layout.tsx', '/src/components/marketing/ComingSoon.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2';

describe('public site styles', () => {
	it('self-hosts DM Sans with swap, across its weight range', () => {
		expect(publicCss).toContain("font-family: 'DM Sans'");
		expect(publicCss).toContain(`url('${FONT_URL}')`);
		expect(publicCss).toContain('font-display: swap');
		expect(publicCss).toContain('font-weight: 100 1000');
	});

	it('defines the 1Password palette as public-only tokens', () => {
		expect(publicCss).toContain('--color-public-charcoal: #1d1d21');
		expect(publicCss).toContain('--color-public-blue: #145fe4');
		expect(publicCss).toContain('--color-public-gold: #cbb88e');
		expect(publicCss).toContain('--color-public-muted: #5b5b66');
		expect(publicCss).toContain('--color-public-line: #e5e5e5');
		expect(publicCss).toContain('--color-public-brand: #11295a');
	});

	it('scopes the font and a fixed light scheme to .public-site', () => {
		const start = publicCss.indexOf('.public-site {');
		expect(start).toBeGreaterThan(-1);
		const rule = publicCss.slice(start, publicCss.indexOf('}', start));
		expect(rule).toContain('color-scheme: light');
		expect(rule).toContain('font-family: var(--font-public)');
		expect(rule).toContain("font-variation-settings: 'opsz' 14");
	});

	it('is loaded by the app stylesheet', () => {
		expect(indexCss).toContain("@import './styles/public-site.css';");
	});

	it('applies the scope and preloads the font only in the public layout', () => {
		const layout = source('/src/components/layout/PublicLayout.tsx');
		expect(layout).toMatch(/className="public-site\b/);
		expect(layout).toContain("import { preload } from 'react-dom'");
		expect(layout).toContain('preload(PUBLIC_FONT_URL');
		expect(layout).toContain(FONT_URL);
		expect(source('/src/components/layout/app-layout.tsx')).not.toContain('dm-sans');
	});

	it('styles Coming soon with fixed colors, not app tokens that follow the app theme', () => {
		const badge = source('/src/components/marketing/ComingSoon.tsx');
		expect(badge).not.toContain('kumo-');
		expect(badge).toContain('STATUS_LABELS[status]');
		expect(capabilities).toContain("'coming-soon': 'Coming soon'");
	});

	it('lets app components embedded in a public page keep the app theme', () => {
		expect(publicCss).toContain(":root[data-mode='dark'] .public-site .app-theme-scope {");
		const start = publicCss.indexOf(":root[data-mode='dark'] .public-site .app-theme-scope {");
		expect(publicCss.slice(start, publicCss.indexOf('}', start))).toContain('color-scheme: dark');
	});
});
