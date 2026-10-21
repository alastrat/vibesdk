import { describe, expect, it } from 'vitest';
import { buildFinishedProperties, buildStartedProperties } from './build-events';

describe('build events', () => {
	it('start with the app, the model and whether it is the first build', () => {
		expect(buildStartedProperties({ appId: 'app_1', model: 'gemini-3.6-flash', firstBuild: true })).toEqual({ app_id: 'app_1', model: 'gemini-3.6-flash', first_build: true });
	});

	it('finish with the outcome, the steps, the credits billing charged for them and the duration', () => {
		const usage = { steps: 7, credits: 112 };
		expect(buildFinishedProperties({ appId: 'app_1', model: 'gemini-3.6-flash', firstBuild: false, completed: true, usage, startedAtMs: 1_000, nowMs: 61_000 })).toEqual({
			app_id: 'app_1',
			model: 'gemini-3.6-flash',
			first_build: false,
			outcome: 'completed',
			steps: 7,
			credits_used: 112,
			duration_ms: 60_000,
		});
	});

	it('record a failed turn with no usage as zero steps and credits', () => {
		expect(buildFinishedProperties({ appId: 'app_1', model: 'm', firstBuild: true, completed: false, usage: null, startedAtMs: 5, nowMs: 5 })).toMatchObject({
			outcome: 'failed',
			steps: 0,
			credits_used: 0,
			duration_ms: 0,
		});
	});
});
