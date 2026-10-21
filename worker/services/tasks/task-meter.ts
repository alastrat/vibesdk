/**
 * How seller tasks pay for AI work, the way the Think agent's turns do. Billing on: the gate is the credit check and each
 * model call is charged to the ledger from its token usage. Billing off: calls count against the old daily allowance, and
 * a spent allowance holds the task until the next UTC day.
 */

import { resolveThinkModel } from '../../agents/think/model-config';
import { TaskService } from '../../database';
import { createLogger } from '../../logger';
import { countDailyCall, dailyCreditsLeft, loadDailyAllowance } from '../rate-limit/daily-allowance';
import { chargeStep, checkCreditsBeforeTurn, creditCheck, loadTurnAccount, meteringDepsFromEnv, type CreditCheck, type StepCharge, type TurnAccount } from '../billing/metering';
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
	/** Counts a step's calls, each at its model's flat cost, reading the user's limits once. */
	countDailyCalls(userId: string, creditCosts: readonly number[]): Promise<void>;
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
				await deps.countDailyCalls(userId, priced.map(({ model }) => model.config.creditCost));
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

export interface TaskMeterOptions {
	/** False for a check that isn't a step being refused, such as the daily resume: a refusal then sends no analytics. */
	trackRefusals?: boolean;
	now?: () => number;
}

/** Tasks run on Estori's own keys, so a seller's connected Cloudflare account never exempts them from the daily allowance. */
export function taskMeterFromEnv(env: Env, options: TaskMeterOptions = {}): TaskMeter {
	const metering = meteringDepsFromEnv(env);
	const now = options.now ?? Date.now;
	const check = options.trackRefusals === false ? creditCheck : checkCreditsBeforeTurn;
	const allowance = (userId: string) => loadDailyAllowance(env, userId, { ownAccountPays: false });
	return createTaskMeter({
		billingOn: (userId) => isFlagOn(env, 'billing', userId),
		checkCredits: (userId) => check(env, userId, now()),
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
		countDailyCalls: async (userId, creditCosts) => {
			try {
				const limits = await allowance(userId);
				for (const creditCost of creditCosts) await countDailyCall(env, limits, userId, creditCost, 'Task');
			} catch (error) {
				logger.warn('A task step was not counted against the daily allowance', { userId, error });
			}
		},
		now,
	});
}

export interface ResumeDeps {
	tasks: Pick<TaskService, 'pausedUserIds' | 'pausedTaskIds' | 'resume'>;
	meter: TaskMeter;
	wake(userId: string): Promise<void>;
	nowMs: number;
}

/**
 * Sellers whose tasks paused for credits and whose gate now passes (a new period, a purchase) get them back where they
 * stopped, and their runner is woken. Answers how many tasks resumed. One seller's or task's failure is logged and leaves
 * the rest alone; never throws.
 */
export async function resumePausedTasks(deps: ResumeDeps): Promise<number> {
	let resumed = 0;
	try {
		for (const userId of await deps.tasks.pausedUserIds('credits', CREDIT_PAUSED_SELLERS_PER_RUN)) {
			try {
				if (!(await deps.meter.gate(userId)).ok) continue;
				let sellerResumed = 0;
				for (const id of await deps.tasks.pausedTaskIds(userId, 'credits')) {
					try {
						if (await deps.tasks.resume(id, userId, deps.nowMs)) sellerResumed += 1;
					} catch (error) {
						logger.error('Could not resume a credit-paused task', { userId, taskId: id, error });
					}
				}
				if (sellerResumed > 0) await deps.wake(userId);
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

/** The daily resume with its production dependencies. Its gate sends no analytics: it is not a step being refused. */
export function resumeCreditPausedTasks(env: Env, nowMs: number = Date.now()): Promise<number> {
	return resumePausedTasks({
		tasks: new TaskService(env),
		meter: taskMeterFromEnv(env, { trackRefusals: false, now: () => nowMs }),
		wake: (userId) => wakeTaskRunner(env, userId),
		nowMs,
	});
}
