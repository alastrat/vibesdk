/** How tasks pay: the gate before each step and the charge for its model calls, with billing's pieces stood in by fakes. */

import { describe, expect, it, vi } from 'vitest';
import { THINK_MODELS } from '../../agents/think/model-config';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import type { PlanLimitRefusal } from '../../../shared/types/plans';
import type { CreditCheck, StepCharge, TurnAccount } from '../billing/metering';
import type { ModelCall } from './kinds';
import type { TaskMeter } from './meter';
import { createTaskMeter, resumePausedTasks, type ResumeDeps, type TaskMeterDeps } from './task-meter';

const NOW = Date.parse('2026-10-21T15:30:00Z');
const MIDNIGHT = Date.parse('2026-10-22T00:00:00Z');
const ACCOUNT: TurnAccount = { plan: 'pro', period: { key: 'sub:s1:1', startMs: NOW - 86_400_000, endMs: NOW + 86_400_000 }, pool: 20_000 };
const REFUSAL: PlanLimitRefusal = { code: 'plan_limit', limit: 'aiCredits', plan: 'basic', upgradeTo: 'pro', message: 'Out of credits.' };

function fakes(overrides: Partial<TaskMeterDeps> = {}) {
	const charges: StepCharge[] = [];
	const counted: { userId: string; creditCosts: readonly number[] }[] = [];
	const deps: TaskMeterDeps = {
		billingOn: async () => true,
		checkCredits: async (): Promise<CreditCheck> => ({ billing: true, refusal: null }),
		loadAccount: async () => ACCOUNT,
		chargeStep: async (charge) => {
			charges.push(charge);
			return null;
		},
		dailyCreditsLeft: async () => 100,
		countDailyCalls: async (userId, creditCosts) => {
			counted.push({ userId, creditCosts });
		},
		now: () => NOW,
		...overrides,
	};
	return { deps, charges, counted };
}

const call = (usage: ModelCall['usage']): ModelCall => ({ model: TASK_MODEL_ID, usage });
const FLASH = THINK_MODELS.find((model) => model.id === TASK_MODEL_ID);

describe('the task meter', () => {
	describe('with billing on', () => {
		it('gate refuses with credits when checkCreditsBeforeTurn refuses', async () => {
			const { deps } = fakes({ checkCredits: async () => ({ billing: true, refusal: REFUSAL }) });
			expect(await createTaskMeter(deps).gate('seller_1')).toEqual({ ok: false, reason: 'credits', resumeAt: null });
		});

		it('gate lets a step run while credits are left, and never looks at the daily allowance', async () => {
			const dailyCreditsLeft = vi.fn(async () => 0);
			const { deps } = fakes({ dailyCreditsLeft });
			expect(await createTaskMeter(deps).gate('seller_1')).toEqual({ ok: true });
			expect(dailyCreditsLeft).not.toHaveBeenCalled();
		});

		it('charge records one use per call with key task:<id>:<step>:<n> and source task', async () => {
			const { deps, charges, counted } = fakes();
			const usage = { inputTokens: 1_000, outputTokens: 500 };
			await createTaskMeter(deps).charge({ userId: 'seller_1', taskId: 'task_9', step: 3, calls: [call(usage), call(usage)] });
			expect(charges).toEqual([
				{ userId: 'seller_1', ...ACCOUNT, useKey: 'task:task_9:3:0', credits: 4, source: 'task', model: TASK_MODEL_ID, usage },
				{ userId: 'seller_1', ...ACCOUNT, useKey: 'task:task_9:3:1', credits: 4, source: 'task', model: TASK_MODEL_ID, usage },
			]);
			expect(counted).toEqual([]);
		});

		it('charge sums stepCredits for the model prices, and charges a call with no usage the typical step', async () => {
			const { deps, charges } = fakes();
			const credits = await createTaskMeter(deps).charge({ userId: 'seller_1', taskId: 't', step: 0, calls: [call({ inputTokens: 1_000, outputTokens: 500 }), call(null)] });
			// 1,000 input and 500 output tokens at $0.75 and $3.75 per 1M cost 3.9375 credits at 1.5x, which is 4; no usage is the model's 16.
			expect(credits).toBe(20);
			expect(charges.map((charge) => charge.credits)).toEqual([4, 16]);
		});

		it('charge records the same keys when a step is repeated, so the ledger counts it once', async () => {
			const { deps, charges } = fakes();
			const meter = createTaskMeter(deps);
			const input = { userId: 'seller_1', taskId: 't', step: 2, calls: [call({ inputTokens: 100, outputTokens: 100 })] };
			await meter.charge(input);
			await meter.charge(input);
			expect(charges.map((charge) => charge.useKey)).toEqual(['task:t:2:0', 'task:t:2:0']);
		});

		it('charge still answers its credits when the account cannot be loaded, without recording', async () => {
			const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { deps, charges } = fakes({ loadAccount: async () => null });
			expect(await createTaskMeter(deps).charge({ userId: 'seller_1', taskId: 't', step: 0, calls: [call(null)] })).toBe(16);
			expect(charges).toEqual([]);
			errorLog.mockRestore();
		});

		it('charge for a step with no calls costs nothing and loads nothing', async () => {
			const loadAccount = vi.fn(async () => ACCOUNT);
			const { deps, charges } = fakes({ loadAccount });
			expect(await createTaskMeter(deps).charge({ userId: 'seller_1', taskId: 't', step: 0, calls: [] })).toBe(0);
			expect(loadAccount).not.toHaveBeenCalled();
			expect(charges).toEqual([]);
		});
	});

	describe('with billing off', () => {
		const off: Partial<TaskMeterDeps> = { billingOn: async () => false, checkCredits: async () => ({ billing: false }) };

		it('gate lets a step run while the daily allowance has credits left', async () => {
			expect(await createTaskMeter(fakes({ ...off, dailyCreditsLeft: async () => 1 }).deps).gate('seller_1')).toEqual({ ok: true });
		});

		it('gate lets a step run when no daily limit applies', async () => {
			expect(await createTaskMeter(fakes({ ...off, dailyCreditsLeft: async () => null }).deps).gate('seller_1')).toEqual({ ok: true });
		});

		it('gate refuses with daily-limit and resumeAt at the next UTC midnight when the daily allowance is spent', async () => {
			const meter = createTaskMeter(fakes({ ...off, dailyCreditsLeft: async () => 0 }).deps);
			expect(await meter.gate('seller_1')).toEqual({ ok: false, reason: 'daily-limit', resumeAt: MIDNIGHT });
		});

		it('gate refuses until the day after when it is checked at the very start of a UTC day', async () => {
			const meter = createTaskMeter(fakes({ ...off, dailyCreditsLeft: async () => 0, now: () => Date.parse('2026-10-22T00:00:00Z') }).deps);
			expect(await meter.gate('seller_1')).toEqual({ ok: false, reason: 'daily-limit', resumeAt: Date.parse('2026-10-23T00:00:00Z') });
		});

		it("charge counts calls against the daily allowance the way the Think agent's daily mode does", async () => {
			const { deps, charges, counted } = fakes(off);
			const credits = await createTaskMeter(deps).charge({ userId: 'seller_1', taskId: 't', step: 0, calls: [call({ inputTokens: 1_000, outputTokens: 500 }), call(null)] });
			// Each call counts the model's flat cost (3 for Gemini Flash), as the agent's daily mode does per step, in one go.
			expect(counted).toEqual([{ userId: 'seller_1', creditCosts: [3, 3] }]);
			expect(FLASH?.config.creditCost).toBe(3);
			expect(charges).toEqual([]);
			// The task still shows what its calls cost at the model's prices.
			expect(credits).toBe(20);
		});
	});
});

describe('resumePausedTasks', () => {
	it('a purchase resumes only the paying seller without scanning every paused seller', async () => {
		const { deps, resumed, woken, asked } = resumeFakes({ listFails: true });
		Object.assign(deps, { userId: 'seller_b' });
		expect(await resumePausedTasks(deps)).toBe(1);
		expect(resumed).toEqual(['b1']);
		expect(asked).toEqual(['seller_b']);
		expect(woken).toEqual(['seller_b']);
	});
	function resumeFakes(options: { paused?: Record<string, string[]>; gates?: Record<string, 'ok' | 'refused' | 'throws'>; listFails?: boolean; resumeFails?: string[] } = {}) {
		const paused = options.paused ?? { seller_a: ['a1', 'a2'], seller_b: ['b1'] };
		const resumed: string[] = [];
		const resumedAt: (number | undefined)[] = [];
		const woken: string[] = [];
		const asked: string[] = [];
		const meter: TaskMeter = {
			gate: async (userId) => {
				asked.push(userId);
				const gate = options.gates?.[userId] ?? 'ok';
				if (gate === 'throws') throw new Error('The ledger is unavailable');
				return gate === 'ok' ? { ok: true } : { ok: false, reason: 'credits', resumeAt: null };
			},
			charge: async () => 0,
		};
		const deps: ResumeDeps = {
			tasks: {
				pausedUserIds: async () => {
					if (options.listFails) throw new Error('D1 is unavailable');
					return Object.keys(paused);
				},
				pausedTaskIds: async (userId) => paused[userId] ?? [],
				resume: async (id, _userId, now) => {
					if (options.resumeFails?.includes(id)) throw new Error('D1 is unavailable');
					resumed.push(id);
					resumedAt.push(now);
					return {} as never;
				},
			},
			meter,
			wake: async (userId) => {
				woken.push(userId);
			},
			nowMs: NOW,
		};
		return { deps, resumed, resumedAt, woken, asked };
	}

	it("resumes every credit-paused task of a seller whose gate passes and wakes their runner once, and leaves the others", async () => {
		const { deps, resumed, resumedAt, woken } = resumeFakes({ gates: { seller_b: 'refused' } });
		expect(await resumePausedTasks(deps)).toBe(2);
		expect(resumed).toEqual(['a1', 'a2']);
		expect(resumedAt).toEqual([NOW, NOW]);
		expect(woken).toEqual(['seller_a']);
	});

	it("one seller's gate throwing doesn't stop another seller's resume, and nothing is thrown", async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps, resumed, woken, asked } = resumeFakes({ gates: { seller_a: 'throws' } });
		await expect(resumePausedTasks(deps)).resolves.toBe(1);
		expect(asked).toEqual(['seller_a', 'seller_b']);
		expect(resumed).toEqual(['b1']);
		expect(woken).toEqual(['seller_b']);
		expect(errorLog).toHaveBeenCalled();
		errorLog.mockRestore();
	});

	it("a failing resume write for one task doesn't stop the rest, and a failing list answers zero", async () => {
		const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
		const writes = resumeFakes({ resumeFails: ['a1'] });
		await expect(resumePausedTasks(writes.deps)).resolves.toBe(2);
		expect(writes.resumed).toEqual(['a2', 'b1']);
		expect(writes.woken).toEqual(['seller_a', 'seller_b']);
		await expect(resumePausedTasks(resumeFakes({ listFails: true }).deps)).resolves.toBe(0);
		errorLog.mockRestore();
	});
});
