import { describe, expect, it } from 'vitest';
import { SERVER_EVENTS, SERVER_EVENT_NAMES, amountBand } from './analytics-events';

describe('the server event catalog', () => {
	it('names every event in snake_case and describes it', () => {
		for (const name of SERVER_EVENT_NAMES) {
			expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
			expect(SERVER_EVENTS[name].description.length, name).toBeGreaterThan(10);
		}
	});

	it('holds the seven billing events by the names the billing spec uses', () => {
		expect(SERVER_EVENT_NAMES).toEqual(
			expect.arrayContaining([
				'subscription_started',
				'subscription_changed',
				'subscription_cancelled',
				'subscription_payment_failed',
				'credits_purchased',
				'credits_low',
				'credits_limit_reached',
			]),
		);
	});

	it('ties every event to a person except the heartbeat', () => {
		expect(SERVER_EVENT_NAMES.filter((name) => SERVER_EVENTS[name].subject === 'system')).toEqual(['heartbeat']);
	});

	it("keeps only a build's credits for people who turned analytics off", () => {
		expect(SERVER_EVENT_NAMES.filter((name) => SERVER_EVENTS[name].costFields !== undefined)).toEqual(['build_finished']);
		expect(SERVER_EVENTS.build_finished.costFields).toEqual(['credits_used']);
	});
});

describe('amount bands', () => {
	it('puts a total in its band in US dollars, a lower edge in the band above', () => {
		expect(amountBand(0)).toBe('under_25');
		expect(amountBand(2_499)).toBe('under_25');
		expect(amountBand(2_500)).toBe('25_to_100');
		expect(amountBand(9_999)).toBe('25_to_100');
		expect(amountBand(10_000)).toBe('100_to_250');
		expect(amountBand(25_000)).toBe('250_to_1000');
		expect(amountBand(100_000)).toBe('1000_plus');
	});
});
