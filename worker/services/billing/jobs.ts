/** Billing's scheduled runs: daily repair and settling, and the hourly renewal emails for accounts without a subscription. */

import { BillingService } from '../../database/services/BillingService';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { createLogger } from '../../logger';
import { heldPeriodKey, loadAccount } from './account';
import { applySubscription } from './events';
import { billingAudience } from './flag';
import { claimAndSendNotice, claimingMailFromEnv } from './notices';
import { DAY_MS, renewalDaysOf } from './periods';
import { billingEventDepsFromEnv } from './wiring';

const logger = createLogger('BillingJobs');

const SETTLE_PER_RUN = 500;
const RENEWALS_PER_RUN = 100;
const KEEP_USES_MS = 90 * DAY_MS;

/** Daily: re-read suspicious subscriptions, settle and close credit periods, expire purchases, forget old usage. */
export async function runDailyBilling(env: Env, nowMs: number): Promise<void> {
	const deps = { ...billingEventDepsFromEnv(env), nowMs: () => nowMs };
	const day = new Date(nowMs).toISOString().slice(0, 10);
	for (const row of await new BillingService(env).subscriptionsToRepair(nowMs)) {
		try {
			await applySubscription(deps, { eventId: `repair:${row.stripeSubscriptionId}:${day}`, eventType: 'repair', subscriptionId: row.stripeSubscriptionId, expectedUserId: row.userId, invoice: null });
		} catch (error) {
			logger.error('Could not repair a subscription', { subscriptionId: row.stripeSubscriptionId, error });
		}
	}
	const ledger = new CreditLedgerService(env);
	for (const userId of await ledger.usersToSettle(nowMs, SETTLE_PER_RUN)) {
		try {
			// A purchase pays for usage up to its expiry before it goes; a raced settle waits for tomorrow's run.
			const holdPeriodKey = heldPeriodKey(await loadAccount(env, userId, nowMs));
			if ((await ledger.settle(userId, nowMs, { holdPeriodKey })) !== 'raced') await ledger.expirePurchases(userId, nowMs);
		} catch (error) {
			logger.error('Could not settle credits', { userId, error });
		}
	}
	await ledger.pruneUses(nowMs - KEEP_USES_MS);
}

/** Hourly: tells accounts without a subscription that their monthly credits renewed today, once each. */
export async function runHourlyBilling(env: Env, nowMs: number): Promise<void> {
	const audience = billingAudience(env);
	if (audience !== 'everyone' && audience.length === 0) return;
	const now = new Date(nowMs);
	const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const renewing = await new BillingService(env).accountsRenewing({
		dayStartMs,
		days: renewalDaysOf(nowMs),
		userIds: audience === 'everyone' ? null : audience,
		limit: RENEWALS_PER_RUN,
	});
	const mail = claimingMailFromEnv(env);
	for (const userId of renewing) {
		try {
			const account = await loadAccount(env, userId, nowMs);
			if (account.source === 'subscription' || account.period.startMs !== dayStartMs) continue;
			await claimAndSendNotice(mail, userId, {
				key: `credits_renewed:${account.period.key}`,
				email: { kind: 'credits_renewed', credits: account.limits.aiCredits, renewsAt: account.period.endMs },
			});
		} catch (error) {
			logger.error('Could not send a credits renewal email', { userId, error });
		}
	}
}
