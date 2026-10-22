import { marketingCopy } from '@/content/marketing-copy';
import { describe, expect, it } from 'vitest';
import publicCss from '../../styles/public-site.css?raw';

const sources = import.meta.glob<string>(
	[
		'/src/components/layout/AnnouncementBar.tsx',
		'/src/components/layout/PublicUtilityBar.tsx',
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
	it('keeps the gold announcement above the utility and main navigation rows', () => {
		const announcement = source(ANNOUNCE);
		expect(announcement).toContain('bg-public-gold');
		expect(announcement).toContain('PLATFORM_FEE_LABEL');
		expect(announcement).toContain('to={blogPostPath(ANNOUNCEMENT_POST)}');
		const utility = source('/src/components/layout/PublicUtilityBar.tsx');
		expect(utility).toContain('<PublicLanguageMenu />');
		expect(utility).toContain('aria-label={marketingCopy.navigation.accessibility.utility}');
		const top = source(TOP);
		expect(top.indexOf('<AnnouncementBar />')).toBeLessThan(top.indexOf('<PublicUtilityBar />'));
		expect(top.indexOf('<PublicUtilityBar />')).toBeLessThan(top.indexOf('<nav aria-label={marketingCopy.navigation.accessibility.main}'));
	});

	it('animates the phone menu: the burger turns into a cross, the sheet fades in and out, and its rows arrive in turn', () => {
		const top = source(TOP);
		expect(top).toContain("menuOpen && 'top-[7px] rotate-45'");
		expect(top).toContain("menuOpen && 'top-[7px] -rotate-45'");
		// Opening and closing both animate, in CSS, from the dialog's open state.
		expect(top).toContain('transition-discrete');
		expect(top).toContain('starting:open:opacity-0');
		expect(top).toContain('motion-safe:animate-public-menu-item');
		expect(top).toContain('const ROW_STAGGER_MS = 40;');
		expect(top).toContain('animationDelay: `${index * ROW_STAGGER_MS}ms`');
		expect(publicCss).toMatch(/@keyframes public-menu-item \{\s*from \{\s*opacity: 0;/);
	});

	it('draws link underlines that fill from left to right on hover, and stay still for reduced motion', () => {
		expect(source(PRIMITIVES)).toContain('export const UNDERLINE_FILL =');
		expect(source(PRIMITIVES)).toMatch(/UNDERLINE_FILL = `[^`]*hover:animate-public-underline/);
		expect(publicCss).toMatch(/@keyframes public-underline-fill \{\s*from \{\s*background-size: 0% 1px;/);
		// The reduced-motion rule turns off every animate-public-* class.
		expect(publicCss).toContain(".public-site [class*='animate-public-']");
	});

	it('shows the utility row above a white top bar with the blue build action and a phone menu', () => {
		const top = source(TOP);
		expect(top).toContain('<AnnouncementBar />');
		expect(top).toContain('hidden lg:flex');
		expect(top).toContain('<StartBuildingButton className="hidden sm:inline-flex" />');
		expect(top).toContain('aria-expanded={menuOpen}');
		expect(top).toContain('aria-controls="public-menu"');
		expect(top).toContain('<MobileMenuSection id={mobileSection} />');
		expect(top).toContain('}, [pathname, hash, key]);');
	});

	it('offers Sign in in the utility bar, Talk to sales beside the build action, and sign-up from Start building free', () => {
		const top = source(TOP);
		const utility = source('/src/components/layout/PublicUtilityBar.tsx');
		expect(utility).toContain('onClick={() => showAuthModal()}');
		expect(utility).toContain('{marketingCopy.navigation.signIn}');
		expect(utility).not.toContain('marketingCopy.navigation.contactUs');
		expect(utility).not.toContain('marketingCopy.navigation.support');
		expect(top).toContain("<Link to={SALES_LINK.to} className={cn('text-[15px] text-public-charcoal', UNDERLINE_GROW)}>");
		expect(top).toContain('{PAGE_LINKS.map((link) => (');
		expect(top).not.toContain('[...PAGE_LINKS, SALES_LINK]');
		expect(top).toContain("const PAGE_LINKS = [\n\t{ to: '/discover', label: marketingCopy.common.discover },\n\t{ to: '/pricing', label: marketingCopy.common.pricing },\n] as const;");
		expect(top).toContain("const SALES_LINK = { to: '/contact', label: marketingCopy.common.talkToSales } as const;");
		// Sign in lives in the utility row; neither the main bar nor phone footer duplicates it.
		expect(top).not.toContain('marketingCopy.navigation.signIn');
		expect(top.match(/<StartBuildingButton /g)).toHaveLength(2);
		expect(top).not.toContain('startBuilding');
	});

	it('keeps the bar on one line: the menus and links move to the menu below lg, and nothing in the bar wraps', () => {
		const top = source(TOP);
		expect(top).toMatch(/<nav aria-label=\{marketingCopy\.navigation\.accessibility\.main\} className="hidden lg:flex [^"]*whitespace-nowrap/);
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
		expect(nav).toContain('label: marketingCopy.navigation.menuFooter.start.label');
		expect(marketingCopy.navigation.menuFooter.start.label).toBe('Compare plans');
		expect(nav).toContain('divide-x divide-public-line');
		expect(nav).toContain('motion-safe:animate-public-menu-in');
	});

	it('draws menu underlines in from the left, like the announcement link, and keeps the open trigger underlined', () => {
		const primitives = source(PRIMITIVES);
		// No line at rest, and no animation for reduced motion; hover draws the full line.
		expect(primitives).toMatch(/const UNDERLINE_GROW_BASE = `[^`]*bg-\[length:0%_1px\][^`]*motion-reduce:transition-none`;/);
		expect(primitives).toContain('export const UNDERLINE_GROW = `${UNDERLINE_GROW_BASE} hover:bg-[length:100%_1px]');
		expect(primitives).toContain('export const GROUP_UNDERLINE_GROW = `${UNDERLINE_GROW_BASE} group-hover:bg-[length:100%_1px]');
		expect(primitives).toMatch(/export const GROUP_UNDERLINE_FILL = `[^`]*group-hover:animate-public-underline/);
		const nav = source(NAV);
		expect(nav).toContain('const HOVER_TEXT = `group-hover:text-public-blue ${GROUP_UNDERLINE_GROW}`;');
		expect(nav).toMatch(/className=\{cn\('mt-4 inline-block text-\[15px\]', GROUP_UNDERLINE_FILL\)\}>\{feature\.link\.label\}/);
		expect(nav).not.toContain('group-hover:underline');
		expect(nav).not.toContain('border-b border-white');
		const top = source(TOP);
		expect(top).toMatch(/const NAV_ITEM =\s*'[^']*bg-\[length:0%_2px\][^']*\bhover:bg-\[length:100%_2px\][^']*motion-reduce:transition-none/);
		// The open menu's trigger is underlined, like a hovered one.
		expect(top).toContain('aria-expanded:bg-[length:100%_2px]');
		expect(top).not.toContain('border-b-2');
		expect(top).not.toContain('hover:underline');
	});

	it("turns the phone menu into 1Password's full-screen sheet, with a page per menu and the actions at the foot", () => {
		const top = source(TOP);
		expect(top).toContain('<dialog');
		expect(top).toContain('dialog.showModal()');
		expect(top).toContain('aria-label={marketingCopy.navigation.accessibility.back}');
		expect(top).toContain('aria-label={marketingCopy.navigation.accessibility.close}');
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

	it("uses the system's own scrollbar, so pages reach the window's edge instead of stopping at a custom 8px track", () => {
		// A standard scrollbar property switches off the app's ::-webkit-scrollbar styling for the public site, so a Mac
		// floats its scrollbar over the page, and the light color scheme keeps it light when the app is dark.
		const site = publicCss.slice(publicCss.indexOf('.public-site {'), publicCss.indexOf('}', publicCss.indexOf('.public-site {')));
		expect(site).toContain('color-scheme: light;');
		expect(site).toContain('scrollbar-width: thin;');
	});
});
