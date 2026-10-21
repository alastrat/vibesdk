/** What each invoice of the billing history shows: its date, description, amount and status, in the order the page lists them. */

import { BILLING_HISTORY_LIMIT, type InvoiceView } from '@/api-types';
import { getLocale, msg, t } from '@/lib/i18n';
import { perLocale } from '../../../shared/i18n/format';
import { INTL_LOCALE, type Locale } from '../../../shared/i18n/locales';

/** Shown where the invoices would be; translated where it is shown. */
export const HISTORY_EMPTY_MESSAGE = msg('No invoices yet.');

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
	paid: { label: msg('Paid'), tone: 'success' },
	open: { label: msg('Payment due'), tone: 'warning' },
	void: { label: msg('Void'), tone: 'secondary' },
	uncollectible: { label: msg('Not collected'), tone: 'error' },
};

const invoiceDate = perLocale((intl) => new Intl.DateTimeFormat(intl, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }));

/** "$49" or "$249.50" in the invoice's own currency, written the way plan prices are: cents only when there are some. */
function amountLabelOf(cents: number, currency: string, locale: Locale): string {
	const code = currency.toUpperCase();
	const intl = INTL_LOCALE[locale];
	try {
		const digits = new Intl.NumberFormat(intl, { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
		const amount = cents / 10 ** digits;
		const fraction = Number.isInteger(amount) ? 0 : digits;
		return new Intl.NumberFormat(intl, { style: 'currency', currency: code, minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(amount);
	} catch {
		return `${(cents / 100).toFixed(2)} ${code}`;
	}
}

/** The newest invoices first, at most the 24 the server lists. */
export function historyRowsFor(invoices: readonly InvoiceView[]): HistoryRow[] {
	const locale = getLocale();
	return [...invoices]
		.sort((a, b) => b.date - a.date)
		.slice(0, BILLING_HISTORY_LIMIT)
		.map((invoice) => ({
			id: invoice.id,
			date: invoiceDate(locale).format(invoice.date),
			description: invoice.description,
			amount: amountLabelOf(invoice.amountCents, invoice.currency, locale),
			status: { ...STATUSES[invoice.status], label: t(STATUSES[invoice.status].label) },
		}));
}
