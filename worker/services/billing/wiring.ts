/** Billing's webhook handling and scheduled runs with their production dependencies. */

import { BillingService } from '../../database/services/BillingService';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { createLogger } from '../../logger';
import { platformAlertsFromEnv } from '../alerts/platform-alerts';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { stripeFromEnv } from '../payments/config';
import { loadAccount, loadAccountWith } from './account';
import type { BillingEventDeps } from './events';
import { runDailyBilling, runHourlyBilling } from './jobs';
import { billingMailFromEnv, sendBillingEmails } from './notices';
import { stripePriceIds } from './prices';

const logger = createLogger('BillingWiring');

const stripeNotConfigured = (): Promise<never> => Promise.reject(new Error('Stripe is not configured'));

export function billingEventDepsFromEnv(env: Env): BillingEventDeps {
	const mail = billingMailFromEnv(env);
	return {
		stripe: stripeFromEnv(env) ?? { retrieveSubscription: stripeNotConfigured, retrieveCheckoutSession: stripeNotConfigured },
		store: new BillingService(env),
		ledger: new CreditLedgerService(env),
		priceIds: stripePriceIds(env.STRIPE_PRICE_IDS),
		account: (userId, nowMs) => loadAccount(env, userId, nowMs),
		accountWith: (userId, row, nowMs) => loadAccountWith(env, userId, row, nowMs),
		notify: async (userId, notices) => {
			await sendBillingEmails(mail, userId, notices);
		},
		alert: platformAlertsFromEnv(env),
		nowMs: () => Date.now(),
	};
}

/** Daily: repair, settle, expire and prune. Hourly: the notice before limits start, and renewal emails for accounts without a subscription. Never throws. */
export async function runBillingSchedule(cron: string, env: Env): Promise<void> {
	try {
		if (cron === CATALOG_HEALTH_CRON) await runDailyBilling(env, Date.now());
		else if (cron === CATALOG_SWEEP_CRON) await runHourlyBilling(env, Date.now());
	} catch (error) {
		logger.error('Billing schedule failed', { cron, error });
	}
}
