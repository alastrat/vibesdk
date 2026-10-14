import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from './config';
import { publicPlanFromSettings } from './public-plan';

function settings(overrides: Partial<RateLimitSettings>): RateLimitSettings {
	return { ...DEFAULT_RATE_LIMIT_SETTINGS, ...overrides };
}

describe('publicPlanFromSettings', () => {
	it('reports the default daily limits', () => {
		expect(publicPlanFromSettings(DEFAULT_RATE_LIMIT_SETTINGS)).toEqual({ newSitesPerDay: 3, aiCreditsPerDay: 200 });
	});

	it('follows an override of the daily limits', () => {
		const plan = publicPlanFromSettings(
			settings({
				appCreation: { ...DEFAULT_RATE_LIMIT_SETTINGS.appCreation, limit: 5, dailyLimit: 5 },
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, limit: 500 },
			}),
		);
		expect(plan).toEqual({ newSitesPerDay: 5, aiCreditsPerDay: 500 });
	});

	it('reports the tighter of two daily limits', () => {
		const plan = publicPlanFromSettings(
			settings({
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, limit: 200, calendarDaily: true, dailyLimit: 500 },
			}),
		);
		expect(plan.aiCreditsPerDay).toBe(200);
	});

	it('reports the daily limit when the main window is shorter than a day', () => {
		const plan = publicPlanFromSettings(
			settings({
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, limit: 20, period: 3600, calendarDaily: false, dailyLimit: 150 },
			}),
		);
		expect(plan.aiCreditsPerDay).toBe(150);
	});

	it('reports no number for a limit that is turned off or not counted per day', () => {
		const plan = publicPlanFromSettings(
			settings({
				appCreation: { ...DEFAULT_RATE_LIMIT_SETTINGS.appCreation, enabled: false },
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, period: 3600, calendarDaily: false },
			}),
		);
		expect(plan).toEqual({ newSitesPerDay: null, aiCreditsPerDay: null });
	});
});
