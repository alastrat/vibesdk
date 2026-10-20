import { describe, expect, it } from 'vitest';
import { describeCreditChange } from './credit-change';

describe('describeCreditChange', () => {
	it('describes a change between models in typical credits per step', () => {
		expect(describeCreditChange(16, 136)).toBe('about 136 credits per step instead of about 16 (about 8.5x)');
		expect(describeCreditChange(136, 16)).toBe('about 16 credits per step instead of about 136 (about 88% cheaper)');
		expect(describeCreditChange(136, 136)).toBe('about 136 credits per step');
	});
});
