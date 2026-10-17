import { describe, expect, it } from 'vitest';
import { contactPath, contactPrefill } from './contact';
import { PREMIUM_TIERS } from './plans';

describe('contact links', () => {
	it('opens the contact page on a topic, with the Premium pool when there is one', () => {
		expect(contactPath('enterprise')).toBe('/contact?topic=enterprise');
		expect(contactPath('premium', 50_000)).toBe('/contact?topic=premium&credits=50000');
		expect(contactPath('enterprise', 50_000)).toBe('/contact?topic=enterprise');
	});

	it('reads back only topics and pools we offer', () => {
		expect(contactPrefill('?topic=premium&credits=50000')).toEqual({ topic: 'premium', premiumCredits: 50_000 });
		expect(contactPrefill('?topic=premium&credits=12345')).toEqual({ topic: 'premium', premiumCredits: null });
		expect(contactPrefill(`?topic=enterprise&credits=${PREMIUM_TIERS[0].credits}`)).toEqual({ topic: 'enterprise', premiumCredits: null });
		expect(contactPrefill('?topic=jobs')).toEqual({ topic: null, premiumCredits: null });
		expect(contactPrefill('')).toEqual({ topic: null, premiumCredits: null });
	});
});
