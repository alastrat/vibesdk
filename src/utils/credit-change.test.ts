import { describe, expect, it } from 'vitest';
import { describeCreditChange } from './credit-change';

describe('describeCreditChange', () => {
	it('shows how many times more a step costs', () => {
		expect(describeCreditChange(3, 8)).toBe('8 credits per step instead of 3 (about 2.7x)');
		expect(describeCreditChange(3, 16)).toBe('16 credits per step instead of 3 (about 5.3x)');
	});

	it('shows the saving when the alternative is cheaper', () => {
		expect(describeCreditChange(8, 3)).toBe('3 credits per step instead of 8 (about 63% cheaper)');
		expect(describeCreditChange(16, 3)).toBe('3 credits per step instead of 16 (about 81% cheaper)');
	});

	it('states equal costs plainly', () => {
		expect(describeCreditChange(3, 3)).toBe('3 credits per step instead of 3');
	});
});
