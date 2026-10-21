/** What each invoice of the billing history shows: its date, description, amount and status, in the order the page lists them. */

import { BILLING_HISTORY_LIMIT, type InvoiceView } from '@/api-types';

export const HISTORY_EMPTY_MESSAGE = 'No invoices yet.';

export interface HistoryStatus {
	label: string;
	tone: 'success' | 'warning' | 'secondary' | 'error';
}

export interface HistoryRow {
	id: string;
	date: string;
	description: string;
	amount: string;
	status: HistoryStatus;
}

const STATUSES: Record<InvoiceView['status'], HistoryStatus> = {
	paid: { label: 'Paid', tone: 'success' },
	open: { label: 'Payment due', tone: 'warning' },
	void: { label: 'Void', tone: 'secondary' },
	uncollectible: { label: 'Not collected', tone: 'error' },
};

const INVOICE_DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "$49" or "$249.50" in the invoice's own currency, written the way plan prices are: cents only when there are some. */
function amountLabelOf(cents: number, currency: string): string {
	const code = currency.toUpperCase();
	try {
		const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
		const amount = cents / 10 ** digits;
		const fraction = Number.isInteger(amount) ? 0 : digits;
		return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(amount);
	} catch {
		return `${(cents / 100).toFixed(2)} ${code}`;
	}
}

/** The newest invoices first, at most the 24 the server lists. */
export function historyRowsFor(invoices: readonly InvoiceView[]): HistoryRow[] {
	return [...invoices]
		.sort((a, b) => b.date - a.date)
		.slice(0, BILLING_HISTORY_LIMIT)
		.map((invoice) => ({
			id: invoice.id,
			date: INVOICE_DATE.format(invoice.date),
			description: invoice.description,
			amount: amountLabelOf(invoice.amountCents, invoice.currency),
			status: STATUSES[invoice.status],
		}));
}
