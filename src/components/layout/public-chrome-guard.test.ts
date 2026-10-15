import { describe, expect, it } from 'vitest';
import publicCss from '../../styles/public-site.css?raw';

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
	it('announces Discover with the fee from the code, and links to its blog post on the right', () => {
		const bar = source(ANNOUNCE);
		expect(bar).toContain('PLATFORM_FEE_LABEL');
		expect(bar).not.toMatch(/7% \+ \$0\.60/);
		expect(bar).toContain('bg-public-gold');
		expect(bar).toMatch(/<span className="truncate">Estori Discover is open/);
		// Learn more takes the right-hand spot; signing in lives in the top bar.
		expect(bar).not.toContain('Sign in');
		expect(bar).toContain('to={blogPostPath(ANNOUNCEMENT_POST)}');
		expect(bar).toMatch(/className=\{cn\('shrink-0', UNDERLINE_FILL\)\}/);
	});

	it('draws link underlines that fill from left to right on hover, and stay still for reduced motion', () => {
		expect(source(PRIMITIVES)).toContain('export const UNDERLINE_FILL =');
		expect(source(PRIMITIVES)).toMatch(/UNDERLINE_FILL =\s*'[^']*hover:animate-public-underline/);
		expect(publicCss).toMatch(/@keyframes public-underline-fill \{\s*from \{\s*background-size: 0% 1px;/);
		// The reduced-motion rule turns off every animate-public-* class.
		expect(publicCss).toContain(".public-site [class*='animate-public-']");
	});

	it('shows the announcement above a white top bar with the blue build action and a phone menu', () => {
		const top = source(TOP);
		expect(top).toContain('<AnnouncementBar />');
		expect(top).toContain('hidden lg:flex');
		expect(top).toContain('<StartBuildingButton className="hidden sm:inline-flex" />');
		expect(top).toContain('aria-expanded={menuOpen}');
		expect(top).toContain('aria-controls="public-menu"');
		expect(top).toContain('<MobileMenuSection id={mobileSection} />');
		expect(top).toContain('}, [pathname, hash, key]);');
	});

	it('offers Sign in in the bar on every screen, Talk to sales beside Pricing, and sign-up from Start building free', () => {
		const top = source(TOP);
		expect(top).toMatch(/<button type="button" onClick=\{\(\) => showAuthModal\(\)\} className="text-\[15px\] text-public-charcoal underline-offset-4 hover:underline">\s*Sign in/);
		expect(top).toContain("const PAGE_LINKS = [\n\t{ to: '/discover', label: 'Discover' },\n\t{ to: '/pricing', label: 'Pricing' },\n] as const;");
		expect(top).toContain("const SALES_LINK = { to: '/contact', label: 'Talk to sales' } as const;");
		// Once in the bar, once at the foot of the phone menu, as on 1Password.
		expect(top.match(/>\s*Sign in\s*</g)).toHaveLength(2);
		expect(top.match(/<StartBuildingButton /g)).toHaveLength(2);
		expect(top).not.toContain('startBuilding');
	});

	it('keeps the bar on one line: the menus and links move to the menu below lg, and nothing in the bar wraps', () => {
		const top = source(TOP);
		expect(top).toMatch(/<nav aria-label="Main" className="hidden lg:flex [^"]*whitespace-nowrap/);
		expect(top).toContain('<div className="flex items-center gap-4 whitespace-nowrap">');
		expect(top).toContain('rounded-full p-2 text-public-charcoal lg:hidden');
		expect(top).toMatch(/<dialog[\s\S]*?id="public-menu"[\s\S]*?className="[^"]*lg:hidden[^"]*"/);
		expect(top).toContain('<StartBuildingButton className="w-full px-3 text-[15px]" />');
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

	it("opens 1Password's menu panels: icon items that turn blue on hover, a photo card and a link bar", () => {
		const nav = source(NAV);
		expect(nav).toContain('const NAV_ICONS: Readonly<Record<NavIcon, Icon>> = {');
		expect(nav).toContain('group-hover:text-public-blue');
		expect(nav).toContain('function FeatureCard(');
		expect(nav).toContain("label: 'Compare plans'");
		expect(nav).toContain('divide-x divide-public-line');
		expect(nav).toContain('motion-safe:animate-public-menu-in');
		// The open menu's trigger is underlined, like a hovered one.
		expect(source(TOP)).toContain('aria-expanded:border-public-ink');
	});

	it("turns the phone menu into 1Password's full-screen sheet, with a page per menu and the actions at the foot", () => {
		const top = source(TOP);
		expect(top).toContain('<dialog');
		expect(top).toContain('dialog.showModal()');
		expect(top).toContain('aria-label="Back to menu"');
		expect(top).toContain('aria-label="Close menu"');
		expect(top).toContain('setMobileSection(menu.id)');
		// A modal sheet left open while the window widens would keep the page inert, so it closes past lg.
		expect(top).toContain("window.matchMedia('(min-width: 1024px)')");
		expect(source(NAV)).toContain('export function MobileMenuSection(');
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
