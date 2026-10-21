/** The properties of a build's start and finish; the Think host sends them (core/behaviors/think.ts). */

import type { ServerEventProperties } from '../../../shared/types/analytics-events';

/**
 * One turn's usage, from ThinkAgent: its steps, and the credits billing charged for them (real token cost × 1.5, at
 * $0.001 a credit). Think always runs on Estori's gateway (behaviors/think.ts configureThinkAgent), so Estori's cost is
 * credits / 1.5 × $0.001.
 */
export interface BuildTurnUsage {
	steps: number;
	credits: number;
}

export function buildStartedProperties(input: { appId: string; model: string; firstBuild: boolean }): ServerEventProperties<'build_started'> {
	return { app_id: input.appId, model: input.model, first_build: input.firstBuild };
}

export function buildFinishedProperties(input: {
	appId: string;
	model: string;
	firstBuild: boolean;
	completed: boolean;
	usage: BuildTurnUsage | null;
	startedAtMs: number;
	nowMs: number;
}): ServerEventProperties<'build_finished'> {
	return {
		app_id: input.appId,
		model: input.model,
		first_build: input.firstBuild,
		outcome: input.completed ? 'completed' : 'failed',
		steps: input.usage?.steps ?? 0,
		credits_used: input.usage?.credits ?? 0,
		duration_ms: Math.max(0, input.nowMs - input.startedAtMs),
	};
}
