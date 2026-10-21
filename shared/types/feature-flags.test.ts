import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, FLAG_KEYS, clientFlagValues, defaultFlagValues, isFlagKey } from './feature-flags';

const ALL_KEYS = [
	'billing',
	'store-drafts-paused',
	'live-store-payments-paused',
	'catalog-paused',
	'session-replay-paused',
	'ai-builds-paused',
	'signups-paused',
	'store-publishing-paused',
	'custom-domains-paused',
	'template-sales-paused',
	'billing-checkout-paused',
] as const;

describe('the flag registry', () => {
	it('holds the eleven flags the production project has, keys in kebab case', () => {
		expect(FLAG_KEYS).toEqual([...ALL_KEYS]);
		for (const key of FLAG_KEYS) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});

	it('names every pause flag for what it pauses, and only those', () => {
		for (const key of FLAG_KEYS) expect(FEATURE_FLAGS[key].kind === 'pause', key).toBe(key.endsWith('-paused'));
		expect(FEATURE_FLAGS.billing.kind).toBe('rollout');
	});

	it('defaults every flag off, so a missing, disabled or errored flag changes nothing', () => {
		expect(defaultFlagValues()).toEqual(Object.fromEntries(ALL_KEYS.map((key) => [key, false])));
	});

	it('sends the browser only the flags it shows or hides something for', () => {
		const all = Object.fromEntries(ALL_KEYS.map((key) => [key, true])) as Record<(typeof ALL_KEYS)[number], boolean>;
		expect(Object.keys(clientFlagValues(all))).toEqual([
			'billing',
			'store-drafts-paused',
			'catalog-paused',
			'session-replay-paused',
			'store-publishing-paused',
			'custom-domains-paused',
		]);
	});

	it('recognizes registry keys only', () => {
		expect(isFlagKey('billing')).toBe(true);
		expect(isFlagKey('catalog')).toBe(false);
		expect(isFlagKey('toString')).toBe(false);
	});
});
