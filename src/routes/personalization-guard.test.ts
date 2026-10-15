import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/public-site/capability-sections.tsx',
		'/src/components/public-site/shopper-mocks.tsx',
		'/src/hooks/use-story.ts',
		'/src/lib/motion.ts',
		'/src/styles/public-site.css',
		'/src/content/positioning.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const SECTION = '/src/components/public-site/capability-sections.tsx';
const MOCKS = '/src/components/public-site/shopper-mocks.tsx';

function personalizationSection(): string {
	const text = source(SECTION);
	return text.slice(text.indexOf('export function PersonalizationSection'));
}

describe('personalized shopping cards', () => {
	it('shows four cards on a light gray panel, two by two, in the 1Password layout', () => {
		const section = personalizationSection();
		expect(section).toContain('PERSONALIZATION_CARDS.map');
		expect(section).toContain('rounded-[25px] bg-[#f2f2f3]');
		expect(section).toContain('md:grid-cols-2');
		// Titles, text and pictures line up across a row, as on 1Password.
		expect(section).toContain('md:row-span-3 md:grid md:grid-rows-subgrid');
		expect(section).toContain('overflow-hidden rounded-[25px] bg-white');
		expect(section).toContain('<CapabilityTag id="personalized-shopping" />');
		expect(section).not.toContain('<CardSection');
	});

	it('draws each picture in code on a white-to-cream fade, cut off by the card, and hides it from screen readers', () => {
		const section = personalizationSection();
		expect(section).toMatch(/aria-hidden\s+className="[^"]*bg-\[linear-gradient\(180deg,#ffffff_0%,#fbf6ec_100%\)\]/);
		expect(section).toContain('<ShopperMock id={card.id} />');
		expect(source(MOCKS)).toContain('export function ShopperMock(');
	});

	it('has the approved copy, with bundles folded into the cart card', () => {
		const copy = source('/src/content/positioning.ts');
		for (const text of [
			"id: 'picks', title: 'Products picked for each shopper'",
			"id: 'cart', title: 'A cart that suggests what goes with it'",
			"id: 'offer', title: 'An offer right after checkout'",
			"id: 'search', title: 'Search that understands shoppers'",
		]) {
			expect(copy).toContain(text);
		}
	});

	it('tells each card its own story', () => {
		const mocks = source(MOCKS);
		for (const text of ['Picked for you', 'Browsing:', 'Goes well with', 'Bundle saves 10%', 'Order confirmed', 'Ethiopia Guji', 'a gift for my dad who loves hiking']) {
			expect(mocks, text).toContain(text);
		}
		expect(mocks.match(/useStory<HTMLDivElement>\(/g)).toHaveLength(4);
		expect(mocks).not.toMatch(/framer/);
	});

	it('plays a story only while it is on screen, and shows the finished picture for reduced motion', () => {
		const hook = source('/src/hooks/use-story.ts');
		expect(hook).toContain('new IntersectionObserver(');
		expect(hook).toContain('useState(prefersReducedMotion)');
		expect(hook).toContain('if (!visible) return;');
		expect(hook).toContain('return () => clearTimeout(timer);');
		expect(hook).toContain('reduced ? beats.length - 1 : beat');
		expect(source('/src/lib/motion.ts')).toContain("export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';");
	});

	it('defines the animations once for the public pages, and stops them all for reduced motion', () => {
		const css = source('/src/styles/public-site.css');
		for (const name of ['public-rise', 'public-blink', 'public-draw', 'public-drain', 'public-build', 'public-drift', 'public-float']) {
			expect(css, name).toContain(`--animate-${name}:`);
			expect(css, name).toContain(`@keyframes ${name} {`);
		}
		expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.public-site \[class\*='animate-public-'\] \{\s*animation: none;/);
	});
});
