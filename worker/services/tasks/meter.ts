/** How a task's AI work is paid for: a gate before each step, and a charge for the step's model calls. */

import type { ModelCall } from './kinds';

/** Refused with `resumeAt`, a time to come, the task waits until then; refused without one it pauses until resumed. */
export type MeterGate = { ok: true } | { ok: false; reason: 'credits' | 'daily-limit'; resumeAt: number | null };

export interface TaskMeter {
	gate(userId: string): Promise<MeterGate>;
	/** Charges a step's calls and answers its credits; a step charged before is not charged again. */
	charge(input: { userId: string; taskId: string; step: number; calls: ModelCall[] }): Promise<number>;
}

/** Lets every step run and charges nothing. */
export const unmeteredTaskMeter: TaskMeter = {
	gate: async () => ({ ok: true }),
	charge: async () => 0,
};
