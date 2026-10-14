import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/layout/AnnouncementBar.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/components/layout/PublicLayout.tsx',
		'/src/components/public-site/primitives.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const ANNOUNCE = '/src/components/layout/AnnouncementBar.tsx';
const TOP = '/src/components/layout/PublicTopBar.tsx';
const FOOTER = '/src/components/layout/SiteFooter.tsx';
const LAYOUT = '/src/components/layout/PublicLayout.tsx';
const PRIMITIVES = '/src/components/public-site/primitives.tsx';

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public chrome', () => {
	it('announces Discover with the fee from the code and links to the creators panel', () => {
		const bar = source(ANNOUNCE);
		expect(bar).toContain('PLATFORM_FEE_LABEL');
		expect(bar).not.toMatch(/7% \+ \$0\.60/);
		expect(bar).toContain('to="/#creators"');
		expect(bar).toContain('bg-public-gold');
		expect(bar).toContain('truncate');
		expect(bar).toMatch(/className="hidden shrink-0[^"]*sm:inline/);
	});

	it('shows the announcement above a white top bar with the blue build action and a phone menu', () => {
		const top = source(TOP);
		expect(top).toContain('<AnnouncementBar />');
		expect(top).toContain('hidden sm:flex');
		expect(top).toContain('Start building free');
		expect(top).toContain("pillClass('blue'");
		expect(top).toContain('aria-expanded={menuOpen}');
		expect(top).toContain('aria-controls="public-menu"');
		expect(top).toContain("to: '/#creators'");
		expect(top).toContain('}, [pathname, hash]);');
	});

	it('ends every public page with the dark footer: link columns, contacts, wordmark and legal line', () => {
		const footer = source(FOOTER);
		for (const text of ['bg-public-charcoal', 'LEGAL_LINKS.map', 'LEGAL_CONTACT', 'legalAddressLine()', 'LEGAL_ENTITY.name', '<EstoriLogo', "to: '/#creators'"]) {
			expect(footer).toContain(text);
		}
	});

	it('uses fixed public colors, never app tokens that follow the app theme', () => {
		for (const path of [ANNOUNCE, TOP, FOOTER, PRIMITIVES]) expect(source(path)).not.toContain('kumo-');
	});

	it('scrolls to the anchor a link names, else to the top', () => {
		const layout = source(LAYOUT);
		expect(layout).toContain('const { pathname, hash } = useLocation();');
		expect(layout).toContain('scrollIntoView(');
		expect(layout).toContain('scrollTo({ top: 0 })');
	});

	it('sets the 1Password type scale and pill buttons in one place', () => {
		const primitives = source(PRIMITIVES);
		expect(primitives).toContain("export const HEADING_HERO = 'text-[44px] leading-[1.1] font-light tracking-[-0.02em] sm:text-[88px]';");
		expect(primitives).toContain("export const HEADING_SECTION = 'text-4xl leading-[1.1] font-light tracking-[-0.02em] sm:text-[64px]';");
		expect(primitives).toContain('rounded-full px-6 py-2.5 text-base font-normal');
	});
});
