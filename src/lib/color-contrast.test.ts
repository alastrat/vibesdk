import { describe, expect, it } from 'vitest';
import { contrastRatio } from './color-contrast';

describe('contrastRatio', () => {
	it('measures the WCAG contrast between two #rrggbb colors, whichever is lighter', () => {
		expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
		expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
		expect(contrastRatio('#777777', '#777777')).toBe(1);
		expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(4.54, 2);
	});
});
