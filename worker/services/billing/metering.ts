/** Credits before and after AI work: the check before a turn or a new store, and charging each step to the ledger. */

import { CreditLedgerService } from '../../database/services/CreditLedgerService';
import { createLogger } from '../../logger';
import { assertWithinLimit, type PlanId, type PlanLimitRefusal } from '../../../shared/types/plans';
import type { CreditUseSource } from '../../../shared/types/billing';
import { loadAccount, loadCredits, type BillingAccount } from './account';
import { creditNoticeDepsFromEnv, noticeCreditUse, type CreditNoticeDeps } from './credit-notices';
import type { CreditBalance, LedgerPeriod, PeriodState } from './credit-ledger';
import { isBillingOn } from './flag';
import { legacyCallCredits, type StepUsage } from './step-credits';

export type CreditCheck = { billing: false } | { billing: true; refusal: PlanLimitRefusal | null };

/** One charged step, keyed so a retried write charges it once. */
export interface StepCharge {
	userId: string;
	period: LedgerPeriod;
	pool: number;
	plan: PlanId;
	useKey: string;
	credits: number;
	source: CreditUseSource;
	model: string;
	usage: StepUsage | null;
}

export interface MeteringDeps {
	ledger: Pick<CreditLedgerService, 'recordUse'>;
	notices: CreditNoticeDeps;
	now(): Date;
}

const RECORD_TRIES = 3;

/** While a renewal is unpaid its pool is 0, so running out means the card needs fixing, not a bigger plan. */
const PAYMENT_FAILED_MESSAGE = "Your last payment didn't go through, so this month's AI credits haven't started. Update your card in Manage billing to keep building.";

const logger = createLogger('CreditMetering');

/** Refused once nothing is left of the pool, grants and purchases. */
export function creditRefusal(account: BillingAccount, balance: CreditBalance): PlanLimitRefusal | null {
	const refusal = assertWithinLimit(account, 'aiCredits', account.limits.aiCredits - balance.left);
	// The unpaid-renewal hold zeroes only a subscription's own pool; an admin's override keeps its limits.
	if (refusal && account.source === 'subscription' && account.graceEndsAtMs !== null) {
		return { ...refusal, upgradeTo: null, paymentFailed: true, message: PAYMENT_FAILED_MESSAGE };
	}
	return refusal;
}

/** Before a turn: some credit must be left. A started turn always finishes; its overrun is settled later. */
export async function checkCreditsBeforeTurn(env: Env, userId: string, nowMs = Date.now()): Promise<CreditCheck> {
	if (!isBillingOn(env, userId)) return { billing: false };
	const account = await loadAccount(env, userId, nowMs);
	return { billing: true, refusal: creditRefusal(account, await loadCredits(env, account)) };
}

/** Records a charged step with the same key up to three times, then checks the warnings. Never throws. */
export async function chargeStep(deps: MeteringDeps, charge: StepCharge): Promise<PeriodState | null> {
	let failure: unknown = null;
	for (let attempt = 0; attempt < RECORD_TRIES; attempt += 1) {
		let state: PeriodState;
		try {
			state = await deps.ledger.recordUse({ ...charge, now: deps.now() });
		} catch (error) {
			failure = error;
			continue;
		}
		await noticeCreditUse(deps.notices, { userId: charge.userId, plan: charge.plan, period: charge.period, pool: charge.pool, state });
		return state;
	}
	logger.error('A charged step could not be recorded', { userId: charge.userId, useKey: charge.useKey, credits: charge.credits, error: failure });
	return null;
}

export function meteringDepsFromEnv(env: Env): MeteringDeps {
	return { ledger: new CreditLedgerService(env), notices: creditNoticeDepsFromEnv(env), now: () => new Date() };
}

/**
 * Charges an older AI call (one that streams without usage) its flat cost in today's unit. Answers false while billing
 * is off, leaving the call to the daily counter. It never refuses: the turn's check came first.
 */
export async function chargeLegacyCall(env: Env, input: { userId: string; model: string; creditCost: number }): Promise<boolean> {
	if (!isBillingOn(env, input.userId)) return false;
	const credits = legacyCallCredits(input.creditCost);
	if (credits <= 0) return true;
	try {
		const account = await loadAccount(env, input.userId);
		await chargeStep(meteringDepsFromEnv(env), {
			userId: input.userId,
			period: account.period,
			pool: account.limits.aiCredits,
			plan: account.plan,
			useKey: `infer:${input.userId}:${crypto.randomUUID()}`,
			credits,
			source: 'infer',
			model: input.model,
			usage: null,
		});
	} catch (error) {
		logger.error('Could not charge an AI call', { userId: input.userId, model: input.model, credits, error });
	}
	return true;
}
