/**
 * How seller tasks pay for AI work, the way the Think agent's turns do. Billing on: the gate is the credit check and each
 * model call is charged to the ledger from its token usage. Billing off: calls count against the old daily allowance, and
 * a spent allowance holds the task until the next UTC day.
 */

import { resolveThinkModel } from '../../agents/think/model-config';
import { TaskService } from '../../database';
import { createLogger } from '../../logger';
import { dailyCreditsLeft, countDailyCall, loadDailyAllowance } from '../rate-limit/daily-allowance';
import { chargeStep, checkCreditsBeforeTurn, loadTurnAccount, meteringDepsFromEnv, type CreditCheck, type StepCharge, type TurnAccount } from '../billing/metering';
import { DAY_MS } from '../billing/periods';
import { stepCredits } from '../billing/step-credits';
import { isFlagOn } from '../posthog/flags';
import type { TaskMeter } from './meter';
import { wakeTaskRunner } from './scheduler';

const logger = createLogger('TaskMeter');
/** Sellers with credit-paused tasks checked per daily run; the rest are checked the next day. */
const CREDIT_PAUSED_SELLERS_PER_RUN = 1_000;

export interface TaskMeterDeps {
	billingOn(userId: string): Promise<boolean>;
	checkCredits(userId: string): Promise<CreditCheck>;
	loadAccount(userId: string): Promise<TurnAccount | null>;
	chargeStep(charge: StepCharge): Promise<unknown>;
	/** What's left of today's allowance; null when no limit applies. */
	dailyCreditsLeft(userId: string): Promise<number | null>;
	countDailyCall(userId: string, creditCost: number): Promise<void>;
	now(): number;
}

const nextUtcMidnight = (nowMs: number): number => (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;

export function createTaskMeter(deps: TaskMeterDeps): TaskMeter {
	return {
		async gate(userId) {
			const check = await deps.checkCredits(userId);
			if (check.billing) return check.refusal ? { ok: false, reason: 'credits', resumeAt: null } : { ok: true };
			const left = await deps.dailyCreditsLeft(userId);
			if (left !== null && left <= 0) return { ok: false, reason: 'daily-limit', resumeAt: nextUtcMidnight(deps.now()) };
			return { ok: true };
		},

		async charge({ userId, taskId, step, calls }) {
			if (calls.length === 0) return 0;
			const priced = calls.map((call) => {
				const model = resolveThinkModel(call.model);
				return { call, model, credits: stepCredits(model.prices, call.usage, model.creditsPerStep) };
			});
			const total = priced.reduce((sum, { credits }) => sum + credits, 0);

			if (!(await deps.billingOn(userId))) {
				// The old counter keeps no per-call key: a step repeated after a lost save counts again, which costs the seller no credits.
				for (const { model } of priced) await deps.countDailyCall(userId, model.config.creditCost);
				return total;
			}
			const account = await deps.loadAccount(userId);
			if (!account) {
				logger.error('A task step was not charged: its account could not be loaded', { userId, taskId, step, credits: total });
				return total;
			}
			for (const [index, { call, model, credits }] of priced.entries()) {
				await deps.chargeStep({ userId, ...account, useKey: `task:${taskId}:${step}:${index}`, credits, source: 'task', model: model.id, usage: call.usage });
			}
			return total;
		},
	};
}

/** Tasks run on Estori's own keys, so a seller's connected Cloudflare account never exempts them from the daily allowance. */
export function taskMeterFromEnv(env: Env): TaskMeter {
	const metering = meteringDepsFromEnv(env);
	const allowance = (userId: string) => loadDailyAllowance(env, userId, { ownAccountPays: false });
	return createTaskMeter({
		billingOn: (userId) => isFlagOn(env, 'billing', userId),
		checkCredits: (userId) => checkCreditsBeforeTurn(env, userId),
		loadAccount: (userId) => loadTurnAccount(env, userId),
		chargeStep: (charge) => chargeStep(metering, charge),
		// A lookup that fails lets the step run and go uncounted, as the agent's does.
		dailyCreditsLeft: async (userId) => {
			try {
				return await dailyCreditsLeft(env, await allowance(userId), userId);
			} catch (error) {
				logger.warn('Could not read the daily allowance; letting the task step run', { userId, error });
				return null;
			}
		},
		countDailyCall: async (userId, creditCost) => {
			try {
				await countDailyCall(env, await allowance(userId), userId, creditCost);
			} catch (error) {
				logger.warn('A task call was not counted against the daily allowance', { userId, error });
			}
		},
		now: () => Date.now(),
	});
}

/**
 * Daily: sellers whose tasks paused for credits and whose gate now passes (a new period, a purchase) get them back where
 * they stopped, and their runner is woken. Answers how many tasks resumed. Never throws.
 */
export async function resumeCreditPausedTasks(env: Env): Promise<number> {
	let resumed = 0;
	try {
		const tasks = new TaskService(env);
		const meter = taskMeterFromEnv(env);
		for (const userId of await tasks.pausedUserIds('credits', CREDIT_PAUSED_SELLERS_PER_RUN)) {
			try {
				if (!(await meter.gate(userId)).ok) continue;
				let sellerResumed = 0;
				for (const id of await tasks.pausedTaskIds(userId, 'credits')) {
					if (await tasks.resume(id, userId)) sellerResumed += 1;
				}
				if (sellerResumed > 0) await wakeTaskRunner(env, userId);
				resumed += sellerResumed;
			} catch (error) {
				logger.error("Could not resume a seller's credit-paused tasks", { userId, error });
			}
		}
	} catch (error) {
		logger.error('Could not look for credit-paused tasks', { error });
	}
	return resumed;
}
