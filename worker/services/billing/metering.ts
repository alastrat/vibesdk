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

/** Where a billed turn's steps go: the account's plan, credit period and pool. */
export interface TurnAccount {
	plan: PlanId;
	period: LedgerPeriod;
	pool: number;
}

/** A passing D1 error shouldn't lose a charge, so each billing read or write is tried this many times. */
const TRIES = 3;

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

async function withTries<T>(attempt: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
	let error: unknown = null;
	for (let tries = 0; tries < TRIES; tries += 1) {
		try {
			return { ok: true, value: await attempt() };
		} catch (caught) {
			error = caught;
		}
	}
	return { ok: false, error };
}

/** Records a charged step with the same key up to three times, then checks the warnings. Never throws. */
export async function chargeStep(deps: MeteringDeps, charge: StepCharge): Promise<PeriodState | null> {
	const recorded = await withTries(() => deps.ledger.recordUse({ ...charge, now: deps.now() }));
	if (!recorded.ok) {
		logger.error('A charged step could not be recorded', { userId: charge.userId, useKey: charge.useKey, credits: charge.credits, error: recorded.error });
		return null;
	}
	await noticeCreditUse(deps.notices, { userId: charge.userId, plan: charge.plan, period: charge.period, pool: charge.pool, state: recorded.value });
	return recorded.value;
}

/**
 * The account a billed turn or call charges, loaded up to three times so a passing D1 error doesn't make it free. Null,
 * logged with the user, only when every try failed; a turn tries again at its next step. Never throws.
 */
export async function loadTurnAccount(env: Env, userId: string, load: typeof loadAccount = loadAccount): Promise<TurnAccount | null> {
	const loaded = await withTries(() => load(env, userId));
	if (!loaded.ok) {
		logger.error('Could not load the account to charge AI credits to', { userId, error: loaded.error });
		return null;
	}
	const account = loaded.value;
	return { plan: account.plan, period: account.period, pool: account.limits.aiCredits };
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
	const account = await loadTurnAccount(env, input.userId);
	if (!account) {
		logger.error('An AI call was not charged', { userId: input.userId, model: input.model, credits });
		return true;
	}
	await chargeStep(meteringDepsFromEnv(env), {
		userId: input.userId,
		...account,
		useKey: `infer:${input.userId}:${crypto.randomUUID()}`,
		credits,
		source: 'infer',
		model: input.model,
		usage: null,
	});
	return true;
}
