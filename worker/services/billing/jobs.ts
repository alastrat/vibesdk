/** Billing's scheduled runs: daily repair and settling, and the hourly notice before limits start and renewal emails for accounts without a subscription. */

import { BillingService } from '../../database/services/BillingService';
import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { createLogger } from '../../logger';
import { heldPeriodKey, loadAccount } from './account';
import { applySubscription } from './events';
import { enforcementDepsFromEnv, enforcementStartsOn, sendEnforcementNotices } from './enforcement-notice';
import { billingAudience } from './flag';
import { claimAndSendNotice, claimingMailFromEnv } from './notices';
import { DAY_MS, renewalDaysOf } from './periods';
import { billingEventDepsFromEnv } from './wiring';
import { posthogConfig } from '../posthog/config';
import { flagOverridesOf } from '../posthog/flags';

const logger = createLogger('BillingJobs');

const SETTLE_PER_RUN = 500;
const RENEWALS_PER_RUN = 100;
/** Renewing accounts read per run: more than are emailed, so accounts whose billing flag is off don't crowd out the rest. */
const RENEWALS_SCANNED_PER_RUN = 1_000;
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

/** The week's notice before limits start. It goes out whatever the billing flag says, since it comes before the flag turns on. */
async function runEnforcementNotices(env: Env, nowMs: number): Promise<void> {
	const startsOn = enforcementStartsOn(env.BILLING_ENFORCEMENT_FROM);
	if (startsOn === null) return;
	try {
		await sendEnforcementNotices(enforcementDepsFromEnv(env), startsOn, nowMs);
	} catch (error) {
		logger.error('Could not send the enforcement notices', { error });
	}
}

/**
 * The accounts billing's switches name, while the switches are the whole billing flag; null when PostHog or an
 * override can put more accounts on billing (or BILLING=on puts everyone on it), so each account's flag decides.
 */
function renewalAudience(env: Env): readonly string[] | null {
	if (posthogConfig(env) || flagOverridesOf(env).billing) return null;
	const audience = billingAudience(env);
	return audience === 'everyone' ? null : audience;
}

/** Hourly: the notice before limits start, then tells accounts without a subscription that their monthly credits renewed today, once each. */
export async function runHourlyBilling(env: Env, nowMs: number): Promise<void> {
	await runEnforcementNotices(env, nowMs);
	const userIds = renewalAudience(env);
	if (userIds?.length === 0) return;
	const now = new Date(nowMs);
	const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const renewing = await new BillingService(env).accountsRenewing({
		dayStartMs,
		days: renewalDaysOf(nowMs),
		userIds,
		limit: RENEWALS_SCANNED_PER_RUN,
	});
	const mail = claimingMailFromEnv(env);
	let attempted = 0;
	for (const userId of renewing) {
		if (attempted >= RENEWALS_PER_RUN) break;
		try {
			const account = await loadAccount(env, userId, nowMs);
			if (!account.billing || account.source === 'subscription' || account.period.startMs !== dayStartMs) continue;
			attempted += 1;
			await claimAndSendNotice(mail, userId, {
				key: `credits_renewed:${account.period.key}`,
				email: { kind: 'credits_renewed', credits: account.limits.aiCredits, renewsAt: account.period.endMs },
			});
		} catch (error) {
			logger.error('Could not send a credits renewal email', { userId, error });
		}
	}
}
