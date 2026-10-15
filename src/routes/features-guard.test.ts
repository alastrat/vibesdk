import { describe, expect, it } from 'vitest';
import { STORE_FEATURES } from '@/content/positioning';

const sources = import.meta.glob<string>(['/src/routes/landing/Features.tsx', '/src/components/public-site/feature-art.tsx', '/src/components/public-site/art-kit.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

const PREVIEW_FILES = import.meta.glob('/public/marketing/preview-*.webp', { query: '?url', import: 'default', eager: true });
const DISCOVER_FILES = import.meta.glob('/public/marketing/discover-*.webp', { query: '?url', import: 'default', eager: true });
const STYLES = import.meta.glob<string>('/src/components/public-site/art-styles.ts', { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const SECTION = '/src/routes/landing/Features.tsx';
const ART = '/src/components/public-site/feature-art.tsx';

describe('store builder features', () => {
	it('lists six things every store has today, three to a row, each with a hover tab', () => {
		expect(STORE_FEATURES.map((feature) => feature.id)).toEqual(['catalog', 'checkout', 'orders', 'chat', 'preview', 'discover']);
		for (const feature of STORE_FEATURES) expect(feature.tag.length, feature.id).toBeGreaterThan(0);
		const section = source(SECTION);
		expect(section).toContain('STORE_FEATURES.map');
		expect(section).toContain('grid-cols-1 gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3');
	});

	it("never lets a picture's drawing width widen its column, so phones don't scroll sideways", () => {
		// Inline-size containment keeps the zoomed drawing out of the grid's minimum column width.
		expect(source('/src/components/public-site/art-kit.tsx')).toContain("cn('overflow-hidden [contain:inline-size]', className)");
	});

	it('uses the Vori layout: the heading on the left and the action on the right, on white or on charcoal', () => {
		const section = source(SECTION);
		expect(section).toContain("light: { section: 'border-t border-public-line bg-white'");
		expect(section).toContain("dark: { section: 'bg-public-charcoal'");
		expect(section).toContain("export function Features({ tone = 'light' }: { tone?: SectionTone })");
		expect(section).toContain('<StartBuildingButton variant={colors.action} />');
		expect(section).toContain('What your store comes with today');
	});

	it('draws each card as on Vori: light gray, a thin border, the picture at the bottom', () => {
		const section = source(SECTION);
		expect(section).toContain('rounded-[16px] border border-public-line bg-[#fafafa]');
		expect(section).toContain('<FeatureArt id={feature.id} />');
	});

	it('raises a tab behind the card, adds a soft shadow and fills the arrow on hover or keyboard focus', () => {
		const section = source(SECTION);
		expect(section).toContain('-translate-y-[40%]');
		expect(section).toContain('opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none');
		expect(section).toContain('hover:shadow-[0_4px_12px_2px_rgba(0,0,0,0.08)]');
		expect(section).toContain('group-hover:bg-public-blue group-hover:text-white');
		// The whole card opens the link.
		expect(section).toContain('after:absolute after:inset-0');
	});

	it('previews a real store on desktop and phone, from bundled screenshots', () => {
		const styles = STYLES['/src/components/public-site/art-styles.ts'] ?? '';
		expect(styles).toContain("desktop: '/marketing/preview-desktop.webp'");
		expect(styles).toContain("phone: '/marketing/preview-phone.webp'");
		expect(Object.keys(PREVIEW_FILES).sort()).toEqual(['/public/marketing/preview-desktop.webp', '/public/marketing/preview-phone.webp']);
		const preview = source(ART).slice(source(ART).indexOf('function PreviewArt'), source(ART).indexOf('function DiscoverArt'));
		expect(preview).toContain('src={PREVIEW_SHOTS.desktop}');
		expect(preview).toContain('src={PREVIEW_SHOTS.phone}');
	});

	it('puts the device switch on the link row, so the preview pictures sit higher, in step with the switch', () => {
		const section = source(SECTION);
		expect(section).toContain('<div className="mt-3 flex min-h-6 w-full items-center justify-between gap-3">');
		expect(section).toContain('aside={<DeviceSwitch phone={phone} />}');
		expect(section).toContain('art={<PreviewArt phone={phone} />}');
		// One story drives both, so they never drift apart.
		expect(source(ART)).toContain('export function PreviewStory(');
		expect(source(ART)).toContain('useStory<HTMLElement>(PREVIEW_BEATS)');
	});

	it('calls the Discover card Start with a Template', () => {
		const discover = STORE_FEATURES.find((feature) => feature.id === 'discover');
		expect(discover?.title).toBe('Start with a Template');
		expect(discover?.tag).toBe('Templates');
		expect(discover?.link?.to).toBe('/discover');
	});

	it('starts from the community garden store in Discover', () => {
		const art = source(ART);
		const discover = art.slice(art.indexOf('function DiscoverArt'));
		expect(discover).toContain('src={DISCOVER_SHOT}');
		expect(discover).toContain('Seed Sun Sprout');
		expect(Object.keys(DISCOVER_FILES)).toEqual(['/public/marketing/discover-garden.webp']);
	});

	it('ends with the cards: no payments note, and no Start building link on the preview card', () => {
		const section = source(SECTION);
		expect(section).not.toContain('Accept payments');
		expect(section).not.toContain('ComingSoon');
		const preview = STORE_FEATURES.find((feature) => feature.id === 'preview');
		expect(preview?.link).toBeUndefined();
		// Without a link, the card shows the switch where the others show theirs.
		expect(section).toContain('{feature.link && (');
	});

	it('draws a small moving picture for each feature with the shared art kit', () => {
		const art = source(ART);
		expect(art).toContain('export function FeatureArt(');
		expect(art.match(/useStory<HTML(Div)?Element>\(/g)).toHaveLength(6);
		expect(art).toContain('<ArtCanvas');
		expect(art).toContain("from './art-kit'");
		expect(art).toContain('PHOTOS.');
		expect(art).not.toMatch(/framer/);
		// The checkout picture never shows a payment, which stores can't take yet.
		const checkout = art.slice(art.indexOf('function CheckoutArt'), art.indexOf('function OrdersArt'));
		expect(checkout).not.toMatch(/pay|card ending|charged/i);
	});
});
