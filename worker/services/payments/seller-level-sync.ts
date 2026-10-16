/** Re-evaluates a seller's level from their record, and sets Stripe's payout delay to match when it changes. */

import { limitsFor, sellerLevelOf, type SellerLevel, type SellerLimitsSettings, type SellerRecord } from '../../../shared/types/seller-levels';
import type { PayoutInterval } from '../../../shared/types/store-payments';
import type { PayoutSchedule } from './stripe-client';
import { scheduleOf } from './payout-schedule';
import { platformAlertsFromEnv, type PlatformAlert } from '../alerts/platform-alerts';
import { stripeFromEnv, stripeModeOf } from './config';
import { StoreOrderService, StripeConnectService } from '../../database';
import { getUserConfigurableSettings } from '../../config';
import { createLogger } from '../../logger';

const logger = createLogger('SellerLevelSync');

export interface LevelSyncDeps {
	record(): Promise<SellerRecord>;
	settings(): Promise<SellerLimitsSettings>;
	stored(): Promise<{ stripeAccountId: string; level: SellerLevel; payoutDelayDays: number | null; payoutInterval: PayoutInterval; payoutAnchor: string } | null>;
	updateSchedule(stripeAccountId: string, schedule: PayoutSchedule): Promise<void>;
	saveLevel(level: SellerLevel, payoutDelayDays: number): Promise<void>;
	alert(alert: PlatformAlert): Promise<void>;
}

export async function syncSellerLevel(deps: LevelSyncDeps, sellerUserId: string, nowMs: number): Promise<'unchanged' | 'changed' | 'failed' | 'no-account'> {
	const stored = await deps.stored();
	if (!stored) return 'no-account';
	const settings = await deps.settings();
	const level = sellerLevelOf(await deps.record(), settings, nowMs);
	const delay = limitsFor(level, settings).payoutDelayDays;
	if (level === stored.level && delay === stored.payoutDelayDays) return 'unchanged';
	try {
		await deps.updateSchedule(stored.stripeAccountId, { ...scheduleOf({ interval: stored.payoutInterval, anchor: stored.payoutAnchor }), delayDays: delay });
	} catch (error) {
		await deps.alert({ kind: 'seller-level-sync-failed', subject: sellerUserId, message: `Stripe refused a payout delay of ${delay} days: ${error instanceof Error ? error.message : String(error)}` });
		return 'failed';
	}
	await deps.saveLevel(level, delay);
	if (level !== stored.level) await deps.alert({ kind: 'seller-level-changed', subject: sellerUserId, message: `The seller is now ${level}, with payouts after ${delay} business days.` });
	return 'changed';
}

/** Syncs a seller's level after a sale, a lost dispute or the daily check; never throws, so it can't fail what called it. */
export async function syncSellerLevelFromEnv(env: Env, sellerUserId: string): Promise<void> {
	const stripe = stripeFromEnv(env);
	if (!stripe) return;
	const mode = stripeModeOf(env) === 'live' ? 'live' : 'test';
	const accounts = new StripeConnectService(env);
	try {
		await syncSellerLevel(
			{
				record: () => new StoreOrderService(env).sellerRecord(sellerUserId, mode, Date.now()),
				settings: async () => (await getUserConfigurableSettings(env, sellerUserId)).sellerLimits,
				stored: async () => {
					const row = await accounts.getByUser(sellerUserId);
					return row ? { stripeAccountId: row.stripeAccountId, level: row.sellerLevel, payoutDelayDays: row.payoutDelayDays, payoutInterval: row.payoutInterval, payoutAnchor: row.payoutAnchor } : null;
				},
				updateSchedule: async (stripeAccountId, schedule) => {
					await stripe.updatePayoutSchedule(stripeAccountId, schedule);
				},
				saveLevel: (level, payoutDelayDays) => accounts.saveLevel(sellerUserId, level, payoutDelayDays),
				alert: platformAlertsFromEnv(env),
			},
			sellerUserId,
			Date.now(),
		);
	} catch (error) {
		logger.error('Could not sync the seller level', { sellerUserId, error });
	}
}
