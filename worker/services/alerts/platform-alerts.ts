/** Alerts for the people who run Estori: logged always, emailed once a day per kind and subject. */

import { createLogger } from '../../logger';
import { createEmailSender } from '../email/sender';
import { platformAlertEmail } from '../email/templates';
import { adminCatalogOrderLink, configuredBaseUrl } from '../email/links';
import type { EmailSender } from '../email/types';

/** Who receives alerts; apart from the admin list, so an admin email change doesn't move them. */
export const PLATFORM_ALERT_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

/** Under a day, so a daily job that runs a little earlier than yesterday still alerts again. */
export const ALERT_THROTTLE_SECONDS = 20 * 60 * 60;

export const PLATFORM_ALERT_KINDS = [
	'needs-attention',
	'refund-failed',
	'runner-step-failed',
	'held-order',
	'low-balance',
	'supplier-account',
	'lines-mismatch',
	'supplier-cancelled',
	'refresh-stalled',
	'not-shipped',
	'not-delivered',
	'dispute-opened',
	'dispute-closed',
	'risk-hold',
	'seller-limit-reached',
	'seller-level-changed',
	'seller-level-sync-failed',
	'seller-charge-unpaid',
	'shopper-email-failed',
	'shopper-email-capped',
	'billing-mismatch',
	'billing-second-subscription',
	'billing-unknown-price',
] as const;
export type PlatformAlertKind = (typeof PLATFORM_ALERT_KINDS)[number];

/** Alerts whose subject is a catalog order id, so their email links to the order's admin page. */
const CATALOG_ORDER_ALERT_KINDS: ReadonlySet<PlatformAlertKind> = new Set<PlatformAlertKind>([
	'needs-attention',
	'refund-failed',
	'runner-step-failed',
	'held-order',
	'low-balance',
	'supplier-account',
	'lines-mismatch',
	'supplier-cancelled',
	'not-shipped',
	'not-delivered',
	'risk-hold',
]);

const ALERT_LABELS: Readonly<Record<PlatformAlertKind, string>> = {
	'needs-attention': 'A catalog order needs you',
	'refund-failed': 'A refund failed',
	'runner-step-failed': 'A catalog order step failed',
	'held-order': 'The supplier is holding an order',
	'low-balance': 'The supplier balance is low',
	'supplier-account': 'The supplier account needs attention',
	'lines-mismatch': "A supplier order doesn't match what was sold",
	'supplier-cancelled': 'The supplier cancelled an order',
	'refresh-stalled': 'The catalog stopped refreshing',
	'not-shipped': "An order hasn't shipped",
	'not-delivered': "An order hasn't been delivered",
	'dispute-opened': 'A shopper disputed a payment',
	'dispute-closed': 'A dispute was decided',
	'risk-hold': 'A payment looks risky',
	'seller-limit-reached': 'A store reached its weekly limit',
	'seller-level-changed': "A seller's level changed",
	'seller-level-sync-failed': "A seller's payout delay couldn't be set",
	'seller-charge-unpaid': 'A seller owes Estori',
	'shopper-email-failed': "A shopper email couldn't be sent",
	'shopper-email-capped': 'A store reached its daily email limit',
	'billing-mismatch': "A billing event didn't match its account",
	'billing-second-subscription': 'An account pays through two subscriptions',
	'billing-unknown-price': 'A subscription has an unknown price',
};

export interface PlatformAlert {
	kind: PlatformAlertKind;
	/** What the alert is about, such as an order or product id; one email a day per kind and subject. */
	subject: string;
	message: string;
	details?: ReadonlyArray<readonly [string, string]>;
}

export interface PlatformAlertDeps {
	throttle: {
		get(key: string): Promise<string | null>;
		put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
	};
	sender: EmailSender | null;
	recipients: readonly string[];
	/** Estori's own address, for links in alerts; null leaves them out. */
	adminBaseUrl: string | null;
	log(alert: PlatformAlert): void;
}

export async function sendPlatformAlert(deps: PlatformAlertDeps, alert: PlatformAlert): Promise<'sent' | 'throttled' | 'not-sent'> {
	deps.log(alert);
	const key = `alert:${alert.kind}:${alert.subject}`;
	if (await deps.throttle.get(key)) return 'throttled';
	if (!deps.sender || deps.recipients.length === 0) return 'not-sent';
	const link = deps.adminBaseUrl && CATALOG_ORDER_ALERT_KINDS.has(alert.kind) ? adminCatalogOrderLink(deps.adminBaseUrl, alert.subject) : null;
	for (const to of deps.recipients) await deps.sender.send(platformAlertEmail(to, alert, ALERT_LABELS[alert.kind], link));
	await deps.throttle.put(key, '1', { expirationTtl: ALERT_THROTTLE_SECONDS });
	return 'sent';
}

const logger = createLogger('PlatformAlerts');

/** Never throws: an alert that can't be emailed is still logged, and the caller carries on. */
export function platformAlertsFromEnv(env: Env): (alert: PlatformAlert) => Promise<void> {
	const deps: PlatformAlertDeps = {
		throttle: env.VibecoderStore,
		sender: createEmailSender(env),
		recipients: PLATFORM_ALERT_EMAILS,
		adminBaseUrl: configuredBaseUrl(env),
		log: (alert) => logger.error('Platform alert', alert),
	};
	return async (alert) => {
		try {
			await sendPlatformAlert(deps, alert);
		} catch (error) {
			logger.error('Could not email a platform alert', { alert, error });
		}
	};
}
