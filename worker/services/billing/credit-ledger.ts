/** The credit ledger's arithmetic, pure: what's left, what an overrun takes from purchases, and when alerts fall due. */

/** Which period a credit use belongs to, keyed so every writer for one account agrees. */
export interface LedgerPeriod {
	key: string;
	startMs: number;
	endMs: number;
}

/** One period as the ledger stores it: the pool and grants, every credit used, and the part of the overrun purchases paid. */
export interface PeriodState {
	key: string;
	startMs: number;
	endMs: number;
	pool: number;
	granted: number;
	used: number;
	settled: number;
	closed: boolean;
}

/** One extra-credits purchase: `used` is what settled overruns took from it, `removed` what a refund took away. */
export interface PurchaseState {
	id: string;
	credits: number;
	used: number;
	removed: number;
	purchasedAtMs: number;
	expiresAtMs: number;
}

export interface CreditBalance {
	pool: number;
	granted: number;
	used: number;
	/** What's left of this period's pool and grants. */
	poolLeft: number;
	/** Purchased credits left once every unsettled overrun is paid; negative when the overruns are more than the purchases. */
	purchasedLeft: number;
	left: number;
	/** Everything this period had to spend: what's used plus what's left. */
	available: number;
}

/** What settling writes: each period's settled total (and whether it closes), and each purchase's used total. */
export interface Settlement {
	periods: Array<{ key: string; settledBefore: number; settledAfter: number; close: boolean; forgiven: number }>;
	purchases: Array<{ id: string; usedBefore: number; usedAfter: number }>;
}

export type CreditAlert = 'credits_20' | 'credits_5';

export function purchaseLeft(purchase: Pick<PurchaseState, 'credits' | 'used' | 'removed'>): number {
	return Math.max(0, purchase.credits - purchase.used - purchase.removed);
}

/** Credits used past the pool and grants that no purchase has paid for yet; a closed period's rest was forgiven. */
export function unsettledOverrun(period: PeriodState): number {
	if (period.closed) return 0;
	return Math.max(0, Math.max(0, period.used - period.pool - period.granted) - period.settled);
}

/** The balance of `current`, with `open` (the account's other unclosed periods) owing their overruns to purchases too. */
export function creditBalance(input: { current: PeriodState; open: readonly PeriodState[]; purchases: readonly PurchaseState[] }): CreditBalance {
	const { current } = input;
	const poolLeft = Math.max(0, current.pool + current.granted - current.used);
	const owed = [current, ...input.open].reduce((sum, period) => sum + unsettledOverrun(period), 0);
	const purchasedLeft = input.purchases.reduce((sum, purchase) => sum + purchaseLeft(purchase), 0) - owed;
	const left = poolLeft + Math.max(0, purchasedLeft);
	return { pool: current.pool, granted: current.granted, used: current.used, poolLeft, purchasedLeft, left, available: current.used + left };
}

/**
 * Takes each unclosed period's new overrun from the purchases, oldest period and oldest purchase first, and closes the
 * periods that ended by `nowMs`, forgiving what no purchase covered. A held period (a renewal still unpaid, whose pool
 * is 0 until it is) gives nothing until it ends: once paid, its pool covers that usage.
 */
export function planSettlement(input: { periods: readonly PeriodState[]; purchases: readonly PurchaseState[]; nowMs: number; holdPeriodKey?: string | null }): Settlement {
	const lots = [...input.purchases].sort((a, b) => a.purchasedAtMs - b.purchasedAtMs || a.id.localeCompare(b.id)).map((lot) => ({ lot, used: lot.used }));
	const periods: Settlement['periods'] = [];
	for (const period of [...input.periods].sort((a, b) => a.startMs - b.startMs)) {
		if (period.key === input.holdPeriodKey && period.endMs > input.nowMs) continue;
		let want = unsettledOverrun(period);
		let taken = 0;
		for (const entry of lots) {
			if (want === 0) break;
			const take = Math.min(want, purchaseLeft({ ...entry.lot, used: entry.used }));
			entry.used += take;
			taken += take;
			want -= take;
		}
		const close = period.endMs <= input.nowMs;
		if (taken > 0 || close) periods.push({ key: period.key, settledBefore: period.settled, settledAfter: period.settled + taken, close, forgiven: close ? want : 0 });
	}
	const purchases = lots.filter((entry) => entry.used !== entry.lot.used).map((entry) => ({ id: entry.lot.id, usedBefore: entry.lot.used, usedAfter: entry.used }));
	return { periods, purchases };
}

/** The deepest alert the balance has reached, as a share of everything available this period. */
export function creditAlertDue(balance: CreditBalance): CreditAlert | null {
	if (balance.available <= 0) return null;
	if (balance.left * 100 <= 5 * balance.available) return 'credits_5';
	if (balance.left * 100 <= 20 * balance.available) return 'credits_20';
	return null;
}

/**
 * False when the pool alone still has more than 20% left. What's left over what's available can't be lower than the
 * pool's own share, so such a period needs no purchase read to rule alerts out.
 */
export function alertsMayBeDue(period: PeriodState): boolean {
	const total = period.pool + period.granted;
	return total <= 0 || (total - period.used) * 100 <= 20 * total;
}

/** The notice key that sends each alert once per period. */
export function creditAlertKey(alert: CreditAlert, periodKey: string): string {
	return `${alert}:${periodKey}`;
}
