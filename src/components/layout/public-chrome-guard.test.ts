import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/layout/AnnouncementBar.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/components/layout/PublicLayout.tsx',
		'/src/components/layout/NavMenu.tsx',
		'/src/components/public-site/primitives.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const ANNOUNCE = '/src/components/layout/AnnouncementBar.tsx';
const TOP = '/src/components/layout/PublicTopBar.tsx';
const FOOTER = '/src/components/layout/SiteFooter.tsx';
const LAYOUT = '/src/components/layout/PublicLayout.tsx';
const PRIMITIVES = '/src/components/public-site/primitives.tsx';
const NAV = '/src/components/layout/NavMenu.tsx';

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public chrome', () => {
	it('announces Discover with the fee from the code and links to the developers page', () => {
		const bar = source(ANNOUNCE);
		expect(bar).toContain('PLATFORM_FEE_LABEL');
		expect(bar).not.toMatch(/7% \+ \$0\.60/);
		expect(bar).toContain('to="/creators/developers"');
		expect(bar).toContain('bg-public-gold');
		expect(bar).toContain('truncate');
		expect(bar).toMatch(/className="hidden shrink-0[^"]*sm:inline/);
		expect(bar).toMatch(/<span className="truncate">Estori Discover is open/);
		expect(bar).toContain('className="shrink-0 underline');
	});

	it('shows the announcement above a white top bar with the blue build action and a phone menu', () => {
		const top = source(TOP);
		expect(top).toContain('<AnnouncementBar />');
		expect(top).toContain('hidden lg:flex');
		expect(top).toContain('Start building free');
		expect(top).toContain("pillClass('blue'");
		expect(top).toContain('aria-expanded={menuOpen}');
		expect(top).toContain('aria-controls="public-menu"');
		expect(top).toContain('<MobileMenuGroups />');
		expect(top).toContain('}, [pathname, hash, key]);');
	});

	it('offers Talk to sales in the bar, keeps Sign in reachable on every screen, and sends Start building free to signup', () => {
		const top = source(TOP);
		expect(top).toMatch(/<Link to="\/contact" className="text-\[15px\] text-public-charcoal underline-offset-4 hover:underline">\s*Talk to sales/);
		// The announcement's Sign in hides below sm, so the phone menu carries one.
		expect(source(ANNOUNCE)).toMatch(/className="hidden shrink-0[^"]*sm:inline/);
		expect(top).toMatch(/<button type="button" onClick=\{\(\) => showAuthModal\(\)\} className="[^"]*sm:hidden[^"]*">\s*Sign in/);
		expect(top).toContain("const buildPath = isAuthenticated ? '/' : '/signup';");
		expect(top.match(/to=\{buildPath\}/g)).toHaveLength(2);
		expect(top).not.toContain('startBuilding');
	});

	it('keeps the bar on one line: the menus and links move to the menu below lg, and nothing in the bar wraps', () => {
		const top = source(TOP);
		expect(top).toMatch(/<nav aria-label="Main" className="hidden lg:flex [^"]*whitespace-nowrap/);
		expect(top).toContain('<div className="flex items-center gap-4 whitespace-nowrap">');
		expect(top).toContain('rounded-full p-2 text-public-charcoal lg:hidden');
		expect(top).toMatch(/id="public-menu"[^>]*lg:hidden/);
		expect(top).toContain("pillClass('blue', 'mt-3 w-full sm:hidden')");
	});

	it('opens one menu panel at a time, closes it on Escape, a click outside or navigation, and returns focus', () => {
		const top = source(TOP);
		expect(top).toContain('aria-expanded={openPanel === menu.id}');
		expect(top).toContain('aria-controls={`menu-${menu.id}`}');
		expect(top).toContain("event.key !== 'Escape'");
		expect(top).toContain('triggerRefs.current[openPanel]?.focus();');
		expect(top).toContain("document.addEventListener('pointerdown', onPointerDown);");
		expect(top).toMatch(/setOpenPanel\(null\);\s*\}, \[pathname, hash, key\]\);/);
	});

	it('puts each open panel right after its trigger, and closes it when keyboard focus leaves both', () => {
		const top = source(TOP);
		expect(top).toMatch(/<\/button>\s*\{openPanel === menu\.id && <MenuPanel id=\{menu\.id\} \/>\}/);
		expect(top).toContain('event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)');
		expect(source(NAV)).toContain('export function MenuPanel(');
		expect(source(NAV)).toMatch(/const PANEL = '[^']*whitespace-normal/);
	});

	it('builds the menus from the registry, so a launch removes its tag everywhere', () => {
		const nav = source(NAV);
		expect(nav).toContain('PLATFORM_CAPABILITIES.map');
		expect(nav).toContain('<CapabilityTag');
		expect(nav).toContain('AUDIENCES.map');
		expect(nav).toContain('CREATOR_ITEMS.map');
		expect(nav).not.toContain('<ComingSoon');
	});

	it('wraps long contact emails instead of scrolling a narrow phone sideways', () => {
		expect(source(FOOTER)).toMatch(/href=\{`mailto:\$\{address\}`\} className="[^"]*\[overflow-wrap:anywhere\]/);
	});

	it('ends every public page with the dark footer: link columns, contacts, wordmark and legal line', () => {
		const footer = source(FOOTER);
		for (const text of ['bg-public-charcoal', 'LEGAL_LINKS.map', 'LEGAL_CONTACT', 'legalAddressLine()', 'LEGAL_ENTITY.name', '<EstoriLogo', "to: '/creators/developers'"]) {
			expect(footer).toContain(text);
		}
	});

	it('uses fixed public colors, never app tokens that follow the app theme', () => {
		for (const path of [ANNOUNCE, TOP, FOOTER, PRIMITIVES]) expect(source(path)).not.toContain('kumo-');
	});

	it('scrolls to the anchor a link names, else to the top', () => {
		const layout = source(LAYOUT);
		expect(layout).toContain('const { pathname, hash, key } = useLocation();');
		expect(layout).toContain('}, [pathname, hash, key]);');
		expect(layout).toContain('scrollIntoView(');
		expect(layout).toContain('scrollTo({ top: 0 })');
	});

	it('keeps an anchor in place while late content and the web font change the height above it', () => {
		const layout = source(LAYOUT);
		expect(layout).toContain('<main ref={mainRef}>');
		expect(layout).toContain('new ResizeObserver(');
		expect(layout).toMatch(/observer\.observe\(main\)/);
		// Re-anchoring jumps; only the first scroll animates.
		expect(layout).toContain("target.scrollIntoView({ block: 'start' })");
		expect(layout).toContain('ANCHOR_HOLD_MS = 2000');
		// The visitor scrolling takes over at once.
		for (const event of ["'wheel'", "'touchstart'", "'keydown'"]) expect(layout).toContain(event);
		expect(layout).toContain('container.addEventListener(event, release');
		expect(layout).toContain('container.removeEventListener(event, release');
		expect(layout).toContain('observer.disconnect()');
		expect(layout).toContain('clearTimeout(');
	});

	it('sets the 1Password type scale and pill buttons in one place', () => {
		const primitives = source(PRIMITIVES);
		expect(primitives).toContain("export const HEADING_HERO = 'text-[44px] leading-[1.1] font-light tracking-[-0.02em] sm:text-[88px]';");
		expect(primitives).toContain("export const HEADING_SECTION = 'text-4xl leading-[1.1] font-light tracking-[-0.02em] sm:text-[64px]';");
		expect(primitives).toContain('rounded-full px-6 py-2.5 text-base font-normal');
	});

	it('scrolls without animation for people who asked for reduced motion', () => {
		expect(source(PRIMITIVES)).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'");
		expect(source(LAYOUT)).toContain('behavior: preferredScrollBehavior()');
		expect(source(LAYOUT)).not.toContain("behavior: 'smooth'");
		expect(source(TOP)).not.toContain("behavior: 'smooth'");
	});
});
