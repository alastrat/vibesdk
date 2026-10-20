/** The 20% and 5% credit warnings, checked after each charged step. */

import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { createLogger } from '../../logger';
import type { PlanId } from '../../../shared/types/plans';
import { trackBilling, type BillingAnalyticsEvent } from '../posthog/billing-events';
import { alertsMayBeDue, creditAlertDue, creditAlertKey, type CreditAlert, type CreditBalance, type LedgerPeriod, type PeriodState } from './credit-ledger';
import { claimAndSendNotice, claimingMailFromEnv, type ClaimingMailDeps } from './notices';

/** A step just charged: the period it went to, and the period's state after it. */
export interface CreditUse {
	userId: string;
	plan: PlanId;
	period: LedgerPeriod;
	pool: number;
	state: PeriodState;
}

export interface CreditNoticeDeps {
	readBalance(userId: string, period: LedgerPeriod, pool: number): Promise<CreditBalance>;
	mail: ClaimingMailDeps;
	track(userId: string, events: readonly BillingAnalyticsEvent[]): Promise<void>;
}

const logger = createLogger('CreditNotices');

/** Sends the deepest warning the balance has reached, once a period each; answers the one sent, if any. Never throws. */
export async function noticeCreditUse(deps: CreditNoticeDeps, use: CreditUse): Promise<CreditAlert | null> {
	try {
		if (!alertsMayBeDue(use.state)) return null;
		const balance = await deps.readBalance(use.userId, use.period, use.pool);
		const alert = creditAlertDue(balance);
		if (!alert) return null;
		const email = { kind: alert, plan: use.plan, left: balance.left, renewsAt: use.period.endMs };
		const outcome = await claimAndSendNotice(deps.mail, use.userId, { key: creditAlertKey(alert, use.period.key), email });
		// The kept claim makes it once per period and threshold, whether or not the email went out.
		if (outcome === 'sent' || outcome === 'claimed') {
			await deps.track(use.userId, [{ name: 'credits_low', properties: { plan: use.plan, threshold: alert === 'credits_5' ? 5 : 20 } }]);
		}
		return outcome === 'sent' ? alert : null;
	} catch (error) {
		logger.error('Could not check the credit warnings', { userId: use.userId, error });
		return null;
	}
}

export function creditNoticeDepsFromEnv(env: Env): CreditNoticeDeps {
	const ledger = new CreditLedgerService(env);
	return {
		readBalance: (userId, period, pool) => ledger.readBalance(userId, period, pool),
		mail: claimingMailFromEnv(env),
		track: (userId, events) => trackBilling(env, userId, events),
	};
}
