import { describe, expect, it } from 'vitest';
import { CjApiError, classifyCjError } from './errors';

function cj(code: number | null, status = 200, message = 'failed'): CjApiError {
	return new CjApiError(message, status, code, 'req_1');
}

describe('classifyCjError', () => {
	it('sorts every documented code into its class', () => {
		const cases: Array<[number, string]> = [
			[1600001, 'auth-token'],
			[1600002, 'auth-token'],
			[1600003, 'account'],
			[1600008, 'account'],
			[1600200, 'throttled'],
			[16900500, 'throttled'],
			[1600000, 'temporary'],
			[1600101, 'temporary'],
			[1600300, 'bad-request'],
			[16900403, 'bad-request'],
			[1602001, 'item-unavailable'],
			[10063, 'item-unavailable'],
			[1603102, 'item-unavailable'],
			[1605002, 'undeliverable'],
			[1603003, 'duplicate-order'],
			[1604000, 'insufficient-balance'],
			[1604001, 'payment-blocked'],
			[1603101, 'payment-blocked'],
		];
		for (const [code, kind] of cases) expect([code, classifyCjError(cj(code))]).toEqual([code, kind]);
	});

	it('treats HTTP 429 and the per-IP limit as throttling, and anything unknown as temporary', () => {
		expect(classifyCjError(cj(null, 429))).toBe('throttled');
		expect(classifyCjError(cj(1600000, 200, 'one ip limit reached'))).toBe('throttled');
		expect(classifyCjError(cj(999, 500))).toBe('temporary');
		expect(classifyCjError(new TypeError('fetch failed'))).toBe('temporary');
	});
});
