import { describe, expect, it } from 'vitest';
import { REFERENCE_EXTRACT_SCRIPT, normalizeReferenceDesign } from './reference-extract';

const VALID = {
	title: 'Stripe | Financial infrastructure',
	palette: ['#0a2540', '#635bff', '#FFFFFF', 'rgb(1,2,3)', '#abc'],
	fonts: { body: 'Sohne', headings: 'Sohne', buttons: 'Sohne' },
	headings: [{ tag: 'h1', size: '56px', weight: '700' }],
	button: { background: '#635bff', color: '#ffffff', radius: '4px' },
	nav: ['Products', 'Pricing'],
	sections: [{ heading: 'Grow your revenue', columns: 2, hasImage: true }],
	copy: 'Financial infrastructure to grow your revenue.',
	images: ['https://images.example.com/hero.png', 'data:image/png;base64,AAAA'],
};

interface FakeElement {
	style: Record<string, string>;
	children: FakeElement[];
	getBoundingClientRect(): { width: number; height: number };
	querySelector(selector: string): null;
	querySelectorAll(selector: string): FakeElement[];
}

const RGBA: Record<string, number[]> = {
	'#000': [0, 0, 0, 255],
	'rgb(0, 0, 0)': [0, 0, 0, 255],
	'rgb(255, 255, 255)': [255, 255, 255, 255],
	'rgb(17, 24, 39)': [17, 24, 39, 255],
	'rgba(0, 0, 0, 0)': [0, 0, 0, 0],
};

function box(colors: { color?: string; backgroundColor?: string } = {}): FakeElement {
	return {
		style: {
			visibility: 'visible',
			display: 'block',
			opacity: '1',
			fontFamily: 'Inter, sans-serif',
			color: colors.color ?? 'rgb(0, 0, 0)',
			backgroundColor: colors.backgroundColor ?? 'rgba(0, 0, 0, 0)',
		},
		children: [],
		getBoundingClientRect: () => ({ width: 100, height: 40 }),
		querySelector: () => null,
		querySelectorAll: () => [],
	};
}

/** Runs the extraction script against a minimal DOM whose canvas resolves a fixed set of color strings. */
function extractPalette(html: FakeElement, body: FakeElement, descendants: FakeElement[]): string[] {
	const canvas = {
		rgba: RGBA['#000'],
		clearRect: () => undefined,
		fillRect: () => undefined,
		getImageData: () => ({ data: canvas.rgba }),
		set fillStyle(value: string) {
			if (RGBA[value]) canvas.rgba = RGBA[value];
		},
	};
	body.querySelectorAll = (selector) => (selector === '*' ? descendants : []);
	const fakeDocument = {
		documentElement: html,
		body,
		title: 'Fixture',
		images: [] as FakeElement[],
		createElement: () => ({ getContext: () => canvas }),
		querySelector: () => null,
		querySelectorAll: () => [] as FakeElement[],
	};
	const run = new Function('document', 'getComputedStyle', `return ${REFERENCE_EXTRACT_SCRIPT}`);
	const result: unknown = run(fakeDocument, (el: FakeElement) => el.style);
	return normalizeReferenceDesign(result).palette;
}

describe('normalizeReferenceDesign', () => {
	it('keeps valid fields and drops invalid colors and non-http images', () => {
		const design = normalizeReferenceDesign(VALID);
		expect(design.title).toBe('Stripe | Financial infrastructure');
		expect(design.palette).toEqual(['#0a2540', '#635bff', '#ffffff']);
		expect(design.fonts).toEqual({ body: 'Sohne', headings: 'Sohne', buttons: 'Sohne' });
		expect(design.headings).toEqual([{ tag: 'h1', size: '56px', weight: '700' }]);
		expect(design.button).toEqual({ background: '#635bff', color: '#ffffff', radius: '4px' });
		expect(design.nav).toEqual(['Products', 'Pricing']);
		expect(design.sections).toEqual([{ heading: 'Grow your revenue', columns: 2, hasImage: true }]);
		expect(design.images).toEqual(['https://images.example.com/hero.png']);
	});

	it('returns an empty design for garbage', () => {
		expect(normalizeReferenceDesign(null)).toEqual({
			title: '',
			palette: [],
			fonts: { body: '', headings: '', buttons: '' },
			headings: [],
			button: null,
			nav: [],
			sections: [],
			copy: '',
			images: [],
		});
	});

	it('caps lists, text and column counts', () => {
		const design = normalizeReferenceDesign({
			...VALID,
			palette: Array.from({ length: 20 }, (_, i) => `#0000${String(i).padStart(2, '0')}`),
			nav: Array.from({ length: 20 }, (_, i) => `Item ${i}`),
			sections: Array.from({ length: 20 }, () => ({ heading: 'x'.repeat(300), columns: 40, hasImage: false })),
			copy: 'y'.repeat(10_000),
			images: Array.from({ length: 20 }, (_, i) => `https://img.example.com/${i}.png`),
		});
		expect(design.palette).toHaveLength(8);
		expect(design.nav).toHaveLength(12);
		expect(design.sections).toHaveLength(15);
		expect(design.sections[0].heading).toHaveLength(120);
		expect(design.sections[0].columns).toBe(6);
		expect(design.copy).toHaveLength(6000);
		expect(design.images).toHaveLength(12);
	});

	it('rejects hex colors with an alpha channel instead of truncating them', () => {
		const design = normalizeReferenceDesign({ palette: ['#aabbccdd', ' #AABBCC ', '#aabbc'] });
		expect(design.palette).toEqual(['#aabbcc']);
	});

	it('drops image URLs over 2000 characters instead of clipping them', () => {
		const long = `https://img.example.com/${'a'.repeat(2000)}.png`;
		const design = normalizeReferenceDesign({ images: [long, 'https://img.example.com/ok.png'] });
		expect(design.images).toEqual(['https://img.example.com/ok.png']);
	});

	it('builds a button only from an object', () => {
		expect(normalizeReferenceDesign({ button: 'yes' }).button).toBeNull();
		expect(normalizeReferenceDesign({ button: ['x'] }).button).toBeNull();
		expect(normalizeReferenceDesign({ button: null }).button).toBeNull();
		expect(normalizeReferenceDesign({ button: {} }).button).toEqual({ background: '', color: '', radius: '' });
	});

	it('is an expression a page can evaluate', () => {
		expect(REFERENCE_EXTRACT_SCRIPT.trim().startsWith('(() => {')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT.trim().endsWith('})()')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT).toContain('getComputedStyle');
		expect(() => new Function(`return ${REFERENCE_EXTRACT_SCRIPT}`)).not.toThrow();
	});

	it('keeps single backslashes in the evaluated regexes', () => {
		expect(REFERENCE_EXTRACT_SCRIPT).toContain('/\\s+/g');
		expect(REFERENCE_EXTRACT_SCRIPT).not.toContain('\\\\');
	});

	it('resolves colors through a canvas rather than parsing rgb() strings', () => {
		expect(REFERENCE_EXTRACT_SCRIPT).toContain('getImageData');
		expect(REFERENCE_EXTRACT_SCRIPT).not.toContain('rgba?\\(');
	});
});

describe('REFERENCE_EXTRACT_SCRIPT palette', () => {
	const WHITE = 'rgb(255, 255, 255)';
	const DARK = 'rgb(17, 24, 39)';
	const busyPage = () => Array.from({ length: 6 }, () => box({ color: WHITE, backgroundColor: WHITE }));

	it('counts the body background and ranks it above element colors', () => {
		const palette = extractPalette(box(), box({ backgroundColor: DARK }), busyPage());
		expect(palette[0]).toBe('#111827');
		expect(palette).toContain('#ffffff');
	});

	it('counts the html background when the body is transparent', () => {
		const palette = extractPalette(box({ backgroundColor: DARK }), box(), busyPage());
		expect(palette[0]).toBe('#111827');
	});

	it('adds no background color when the page sets none', () => {
		const palette = extractPalette(box(), box(), busyPage());
		expect(palette).toEqual(['#ffffff', '#000000']);
	});
});
