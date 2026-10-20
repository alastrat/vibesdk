import { describe, expect, it } from 'vitest';
import { alertsMayBeDue, creditAlertDue, creditBalance, planSettlement, type PeriodState, type PurchaseState } from './credit-ledger';

const DAY = 86_400_000;

function period(overrides: Partial<PeriodState> = {}): PeriodState {
	return { key: 'acct:1', startMs: 0, endMs: 30 * DAY, pool: 5_000, granted: 1_000, used: 0, settled: 0, closed: false, ...overrides };
}

function purchase(id: string, credits: number, purchasedAtMs: number, overrides: Partial<PurchaseState> = {}): PurchaseState {
	return { id, credits, used: 0, removed: 0, purchasedAtMs, expiresAtMs: purchasedAtMs + 365 * DAY, ...overrides };
}

describe('creditBalance', () => {
	it('spends the pool and grants first, then purchases', () => {
		expect(creditBalance({ current: period({ used: 2_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toEqual({ pool: 5_000, granted: 1_000, used: 2_000, poolLeft: 4_000, purchasedLeft: 5_000, left: 9_000, available: 11_000 });
		expect(creditBalance({ current: period({ used: 8_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toMatchObject({ poolLeft: 0, purchasedLeft: 3_000, left: 3_000 });
	});

	it('counts an older unclosed overrun against purchases, and never goes below nothing left', () => {
		const older = period({ key: 'acct:0', used: 9_000, settled: 1_000 });
		expect(creditBalance({ current: period({ key: 'acct:1', used: 1_000 }), open: [older], purchases: [purchase('a', 5_000, 1, { used: 1_000 })] })).toMatchObject({ poolLeft: 5_000, purchasedLeft: 2_000, left: 7_000 });
		expect(creditBalance({ current: period({ used: 20_000 }), open: [], purchases: [purchase('a', 5_000, 1)] })).toMatchObject({ purchasedLeft: -9_000, left: 0 });
	});

	it('owes nothing for a closed period, whose rest was forgiven', () => {
		expect(creditBalance({ current: period({ used: 9_000, settled: 1_000, closed: true }), open: [], purchases: [purchase('a', 5_000, 1)] })).toMatchObject({ poolLeft: 0, purchasedLeft: 5_000, left: 5_000 });
	});

	it("leaves out a refund's removed credits", () => {
		expect(creditBalance({ current: period(), open: [], purchases: [purchase('a', 5_000, 1, { used: 1_000, removed: 4_000 })] }).purchasedLeft).toBe(0);
	});
});

describe('planSettlement', () => {
	it('takes each overrun from the oldest purchase first, and only what is new', () => {
		const plan = planSettlement({
			periods: [period({ used: 9_000, settled: 1_000 })],
			purchases: [purchase('new', 5_000, 20), purchase('old', 2_000, 10, { used: 1_000 })],
			nowMs: 5 * DAY,
		});
		expect(plan).toEqual({
			periods: [{ key: 'acct:1', settledBefore: 1_000, settledAfter: 3_000, close: false, forgiven: 0 }],
			purchases: [
				{ id: 'old', usedBefore: 1_000, usedAfter: 2_000 },
				{ id: 'new', usedBefore: 0, usedAfter: 1_000 },
			],
		});
		expect(planSettlement({ periods: [period({ used: 9_000, settled: 3_000 })], purchases: [], nowMs: 5 * DAY })).toEqual({ periods: [], purchases: [] });
	});

	it('closes an ended period and forgives what no purchase covers', () => {
		const plan = planSettlement({ periods: [period({ used: 13_000 })], purchases: [purchase('a', 5_000, 1)], nowMs: 31 * DAY });
		expect(plan.periods).toEqual([{ key: 'acct:1', settledBefore: 0, settledAfter: 5_000, close: true, forgiven: 2_000 }]);
		expect(planSettlement({ periods: [period({ used: 100 })], purchases: [], nowMs: 31 * DAY }).periods).toEqual([{ key: 'acct:1', settledBefore: 0, settledAfter: 0, close: true, forgiven: 0 }]);
	});
});

describe('credit alerts', () => {
	it('fall due at 20% and 5% of everything available this period, the deeper one first', () => {
		const at = (used: number) => creditAlertDue(creditBalance({ current: period({ pool: 10_000, granted: 0, used }), open: [], purchases: [] }));
		expect(at(7_999)).toBeNull();
		expect(at(8_000)).toBe('credits_20');
		expect(at(9_500)).toBe('credits_5');
		expect(at(10_000)).toBe('credits_5');
		expect(alertsMayBeDue(period({ pool: 10_000, granted: 0, used: 7_000 }))).toBe(false);
		expect(alertsMayBeDue(period({ pool: 10_000, granted: 0, used: 8_000 }))).toBe(true);
	});
});
