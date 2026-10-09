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

	it('is an expression a page can evaluate', () => {
		expect(REFERENCE_EXTRACT_SCRIPT.trim().startsWith('(() => {')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT.trim().endsWith('})()')).toBe(true);
		expect(REFERENCE_EXTRACT_SCRIPT).toContain('getComputedStyle');
	});
});
