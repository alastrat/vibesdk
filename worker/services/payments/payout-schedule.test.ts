import { describe, expect, it } from 'vitest';
import { parsePayoutRequest, scheduleOf } from './payout-schedule';

describe('parsePayoutRequest', () => {
	it('accepts daily, weekly on a weekday, and monthly on a day from 1 to 28', () => {
		expect(parsePayoutRequest({ interval: 'daily', anchor: '' })).toEqual({ interval: 'daily', anchor: '' });
		expect(parsePayoutRequest({ interval: 'weekly', anchor: 'friday' })).toEqual({ interval: 'weekly', anchor: 'friday' });
		expect(parsePayoutRequest({ interval: 'monthly', anchor: '15' })).toEqual({ interval: 'monthly', anchor: '15' });
	});

	it('refuses manual payouts, weekends and impossible days', () => {
		for (const body of [{ interval: 'manual', anchor: '' }, { interval: 'weekly', anchor: 'sunday' }, { interval: 'monthly', anchor: '31' }, { interval: 'monthly', anchor: 'x' }, null]) {
			expect(parsePayoutRequest(body)).toBeNull();
		}
	});

	it('turns the choice into the schedule Stripe expects, leaving the delay alone', () => {
		expect(scheduleOf({ interval: 'weekly', anchor: 'friday' })).toEqual({ interval: 'weekly', weeklyAnchor: 'friday', monthlyAnchor: null, delayDays: null });
		expect(scheduleOf({ interval: 'monthly', anchor: '15' })).toEqual({ interval: 'monthly', weeklyAnchor: null, monthlyAnchor: 15, delayDays: null });
	});
});
