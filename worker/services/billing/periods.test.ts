import { describe, expect, it } from 'vitest';
import { accountPeriod, addMonths, anniversaryPeriod, renewalDaysOf, subscriptionPeriod } from './periods';

const utc = (iso: string) => Date.parse(iso);

describe('periods', () => {
	it("renews Basic monthly from the sign-up date, clamping the day to a short month's last day", () => {
		const signup = utc('2026-01-31T10:00:00Z');
		expect(anniversaryPeriod(signup, utc('2026-02-15T00:00:00Z'))).toEqual({ startMs: utc('2026-01-31T00:00:00Z'), endMs: utc('2026-02-28T00:00:00Z') });
		expect(anniversaryPeriod(signup, utc('2026-02-28T12:00:00Z'))).toEqual({ startMs: utc('2026-02-28T00:00:00Z'), endMs: utc('2026-03-31T00:00:00Z') });
		expect(anniversaryPeriod(signup, utc('2026-04-01T00:00:00Z'))).toEqual({ startMs: utc('2026-03-31T00:00:00Z'), endMs: utc('2026-04-30T00:00:00Z') });
		expect(anniversaryPeriod(utc('2028-01-29T00:00:00Z'), utc('2028-03-01T00:00:00Z'))).toEqual({ startMs: utc('2028-02-29T00:00:00Z'), endMs: utc('2028-03-29T00:00:00Z') });
		expect(anniversaryPeriod(utc('2026-03-15T08:00:00Z'), utc('2026-03-20T00:00:00Z'))).toEqual({ startMs: utc('2026-03-15T00:00:00Z'), endMs: utc('2026-04-15T00:00:00Z') });
	});

	it('renews on the 1st without a readable sign-up date', () => {
		expect(anniversaryPeriod(null, utc('2026-10-19T15:00:00Z'))).toEqual({ startMs: utc('2026-10-01T00:00:00Z'), endMs: utc('2026-11-01T00:00:00Z') });
		expect(anniversaryPeriod(Number.NaN, utc('2026-10-19T15:00:00Z')).startMs).toBe(utc('2026-10-01T00:00:00Z'));
	});

	it('keys a Basic month and a Stripe period apart, even when they start on the same second', () => {
		const start = utc('2026-10-05T00:00:00Z');
		expect(accountPeriod(start, start + 1).key).toBe(`acct:${start / 1000}`);
		expect(subscriptionPeriod({ stripeSubscriptionId: 'sub_1', currentPeriodStart: new Date(start), currentPeriodEnd: new Date(utc('2026-11-05T00:00:00Z')) })).toEqual({ key: `sub:sub_1:${start / 1000}`, startMs: start, endMs: utc('2026-11-05T00:00:00Z') });
	});

	it("adds months on the same day and time, clamping the day to a short month's last day", () => {
		expect(addMonths(utc('2026-10-19T15:30:00Z'), 12)).toBe(utc('2027-10-19T15:30:00Z'));
		expect(addMonths(utc('2026-01-31T10:00:00Z'), 1)).toBe(utc('2026-02-28T10:00:00Z'));
		expect(addMonths(utc('2028-02-29T00:00:00Z'), 12)).toBe(utc('2029-02-28T00:00:00Z'));
		expect(addMonths(utc('2026-11-30T08:00:00Z'), 3)).toBe(utc('2027-02-28T08:00:00Z'));
	});

	it("renews today's sign-up day, and on a month's last day every later day too", () => {
		expect(renewalDaysOf(utc('2026-10-19T10:05:00Z'))).toEqual([19]);
		expect(renewalDaysOf(utc('2026-09-30T10:05:00Z'))).toEqual([30, 31]);
		expect(renewalDaysOf(utc('2026-02-28T00:05:00Z'))).toEqual([28, 29, 30, 31]);
		expect(renewalDaysOf(utc('2026-10-31T23:05:00Z'))).toEqual([31]);
	});
});
