import { describe, expect, it } from 'vitest';
import { showcaseRefreshMessage } from './showcase-refresh-message';

describe('showcaseRefreshMessage', () => {
	it('says so when every store already has an image', () => {
		expect(showcaseRefreshMessage({ attempted: 0, captured: 0, failed: 0, remaining: 0 })).toBe(
			'Every Discover store has a showcase image.',
		);
	});

	it('reports a complete batch', () => {
		expect(showcaseRefreshMessage({ attempted: 10, captured: 10, failed: 0, remaining: 0 })).toBe(
			'Captured 10 of 10. None left to capture.',
		);
	});

	it('reports failures and asks for another round while stores still need one', () => {
		expect(showcaseRefreshMessage({ attempted: 10, captured: 8, failed: 2, remaining: 5 })).toBe(
			'Captured 8 of 10. 2 failed. 5 still need one; refresh again.',
		);
	});
});
