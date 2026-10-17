/** CJ's failures, and what each means for the caller. */

export class CjApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: number | null,
		readonly requestId: string | null,
	) {
		super(message);
		this.name = 'CjApiError';
	}
}

export type CjErrorClass =
	| 'auth-token'
	| 'account'
	| 'throttled'
	| 'temporary'
	| 'bad-request'
	| 'item-unavailable'
	| 'undeliverable'
	| 'duplicate-order'
	| 'insufficient-balance'
	| 'payment-blocked';

const CODE_CLASSES: ReadonlyArray<readonly [readonly number[], CjErrorClass]> = [
	[[1600001, 1600002], 'auth-token'],
	[[1600003, 1600004, 1600005, 1600006, 1600007, 1600008], 'account'],
	[[1600200, 16900500, 429], 'throttled'],
	[[1600000, 1600301, 1608002, 1610001, 1600100, 1600101], 'temporary'],
	[[1600300, 16900202, 16900203, 16900204, 16900205, 16900403], 'bad-request'],
	[[1602000, 1602001, 1602002, 1602003, 10063, 1603102], 'item-unavailable'],
	[[1605000, 1605001, 1605002], 'undeliverable'],
	[[1603003], 'duplicate-order'],
	[[1604000], 'insufficient-balance'],
	[[1604001, 1603101], 'payment-blocked'],
];

/** Network errors and timeouts are temporary, as is any code CJ hasn't documented. */
export function classifyCjError(error: unknown): CjErrorClass {
	if (!(error instanceof CjApiError)) return 'temporary';
	if (error.status === 429 || /one ip limit/i.test(error.message)) return 'throttled';
	const code = error.code;
	if (code === null) return 'temporary';
	return CODE_CLASSES.find(([codes]) => codes.includes(code))?.[1] ?? 'temporary';
}
