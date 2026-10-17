/** The daily catalog health check: a stalled refresh, and orders late to ship or to arrive. */

import type { PlatformAlert } from '../alerts/platform-alerts';

export const CATALOG_HEALTH_CRON = '35 6 * * *';
const DAY_MS = 24 * 60 * 60 * 1000;
/** A seller charge later sales haven't covered by now is raised with Estori. */
export const SELLER_CHARGE_UNPAID_AFTER_MS = 60 * DAY_MS;
export const REFRESH_STALLED_AFTER_MS = DAY_MS;
export const NOT_SHIPPED_AFTER_MS = 5 * DAY_MS;
export const NOT_DELIVERED_AFTER_MS = 30 * DAY_MS;

export interface CatalogHealthDeps {
	refreshHealth(): Promise<{ activeProducts: number; lastRefreshAt: Date | null }>;
	/** Distinct catalog order ids with an item in this status since before this time. */
	lateItems(status: 'placed' | 'shipped', before: Date): Promise<string[]>;
	alert(alert: PlatformAlert): Promise<void>;
	/** What each seller still owes on charges added before this time. */
	unpaidCharges(before: Date): Promise<Array<{ sellerUserId: string; owedCents: number }>>;
}

/** Returns how many alerts it raised; the alert service throttles repeats to one a day each. */
export async function runCatalogHealth(deps: CatalogHealthDeps, nowMs: number): Promise<number> {
	const alerts: PlatformAlert[] = [];
	const refresh = await deps.refreshHealth();
	if (refresh.activeProducts > 0 && (refresh.lastRefreshAt === null || nowMs - refresh.lastRefreshAt.getTime() > REFRESH_STALLED_AFTER_MS)) {
		alerts.push({ kind: 'refresh-stalled', subject: 'catalog', message: 'No catalog product refreshed in the last 24 hours, so offers will stop selling after 72.' });
	}
	for (const orderId of await deps.lateItems('placed', new Date(nowMs - NOT_SHIPPED_AFTER_MS))) {
		alerts.push({ kind: 'not-shipped', subject: orderId, message: 'An item was placed with the supplier more than 5 days ago and has no tracking yet.' });
	}
	for (const orderId of await deps.lateItems('shipped', new Date(nowMs - NOT_DELIVERED_AFTER_MS))) {
		alerts.push({ kind: 'not-delivered', subject: orderId, message: 'An item shipped more than 30 days ago and hasn\'t been delivered.' });
	}
	for (const unpaid of await deps.unpaidCharges(new Date(nowMs - SELLER_CHARGE_UNPAID_AFTER_MS))) {
		alerts.push({ kind: 'seller-charge-unpaid', subject: unpaid.sellerUserId, message: `The seller has owed $${(unpaid.owedCents / 100).toFixed(2)} for more than 60 days.` });
	}
	for (const alert of alerts) await deps.alert(alert);
	return alerts.length;
}
