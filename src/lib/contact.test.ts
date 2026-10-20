import { describe, expect, it } from 'vitest';
import { contactPath, contactPrefill } from './contact';

describe('contact links', () => {
	it('opens the contact page on a topic, with the credits a month Premium needs when there are some', () => {
		expect(contactPath('enterprise')).toBe('/contact?topic=enterprise');
		expect(contactPath('pro')).toBe('/contact?topic=pro');
		expect(contactPath('premium', 150_000)).toBe('/contact?topic=premium&credits=150000');
		expect(contactPath('enterprise', 150_000)).toBe('/contact?topic=enterprise');
	});

	it('reads back a known topic, and for Premium any whole number of credits in range', () => {
		expect(contactPrefill('?topic=premium&credits=150000')).toEqual({ topic: 'premium', premiumCredits: 150_000 });
		expect(contactPrefill('?topic=premium&credits=12345')).toEqual({ topic: 'premium', premiumCredits: 12_345 });
		expect(contactPrefill('?topic=premium&credits=10000000')).toEqual({ topic: 'premium', premiumCredits: 10_000_000 });
		for (const credits of ['0', '-5', '1.5', '10000001', 'many', '']) {
			expect(contactPrefill(`?topic=premium&credits=${credits}`), credits).toEqual({ topic: 'premium', premiumCredits: null });
		}
		expect(contactPrefill('?topic=enterprise&credits=150000')).toEqual({ topic: 'enterprise', premiumCredits: null });
		expect(contactPrefill('?topic=pro&credits=150000')).toEqual({ topic: 'pro', premiumCredits: null });
		expect(contactPrefill('?topic=jobs')).toEqual({ topic: null, premiumCredits: null });
		expect(contactPrefill('')).toEqual({ topic: null, premiumCredits: null });
	});
});
