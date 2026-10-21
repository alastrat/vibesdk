import { describe, expect, it } from 'vitest';
import type { InvoiceView } from '@/api-types';
import { HISTORY_EMPTY_MESSAGE, historyRowsFor } from './history-rows';

const OCT_20 = Date.UTC(2026, 9, 20, 10);

function invoice(id: string, overrides: Partial<InvoiceView> = {}): InvoiceView {
	return { id, date: OCT_20, description: 'Estori Pro', amountCents: 4_900, currency: 'usd', status: 'paid', ...overrides };
}

describe('the billing history rows', () => {
	it('shows the date with its year, the description, the amount and a status', () => {
		expect(historyRowsFor([invoice('in_1')])).toEqual([{ id: 'in_1', date: 'Oct 20, 2026', description: 'Estori Pro', amount: '$49', status: { label: 'Paid', tone: 'success' } }]);
	});

	it('words every status for the seller', () => {
		const rows = historyRowsFor([invoice('a', { status: 'paid' }), invoice('b', { status: 'open' }), invoice('c', { status: 'void' }), invoice('d', { status: 'uncollectible' })]);
		expect(rows.map((row) => [row.status.label, row.status.tone])).toEqual([
			['Paid', 'success'],
			['Payment due', 'warning'],
			['Void', 'secondary'],
			['Not collected', 'error'],
		]);
	});

	it('shows cents when an amount has them, and the invoice own currency', () => {
		expect(historyRowsFor([invoice('a', { amountCents: 24_950 })])[0]?.amount).toBe('$249.50');
		expect(historyRowsFor([invoice('b', { amountCents: 0 })])[0]?.amount).toBe('$0');
		expect(historyRowsFor([invoice('c', { amountCents: 4_900, currency: 'eur' })])[0]?.amount).toBe('€49');
		expect(historyRowsFor([invoice('d', { amountCents: 4_900, currency: 'jpy' })])[0]?.amount).toBe('¥4,900');
	});

	it('lists at most 24, newest first, whatever order they arrive in', () => {
		const invoices = Array.from({ length: 30 }, (_, index) => invoice(`in_${index}`, { date: OCT_20 - index * 86_400_000 }));
		const shuffled = [...invoices].reverse();
		const rows = historyRowsFor(shuffled);
		expect(rows).toHaveLength(24);
		expect(rows.map((row) => row.id)).toEqual(invoices.slice(0, 24).map((entry) => entry.id));
	});

	it('keeps the order it was given for invoices made at the same moment', () => {
		expect(historyRowsFor([invoice('first'), invoice('second'), invoice('third')]).map((row) => row.id)).toEqual(['first', 'second', 'third']);
	});

	it('is empty with a message of its own', () => {
		expect(historyRowsFor([])).toEqual([]);
		expect(HISTORY_EMPTY_MESSAGE).toBe('No invoices yet.');
	});
});
