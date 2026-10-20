import { describe, expect, it } from 'vitest';

/** Billing's events come from billing's own code points; this finds each by what it sends. */
const billing = import.meta.glob<string>(['/worker/services/billing/**/*.ts', '!/worker/services/billing/**/*.test.ts'], { query: '?raw', import: 'default', eager: true });

/** The billing sources that contain `marker`, joined; fails when none does. */
function sourcesSending(marker: string): string {
	const found = Object.values(billing).filter((text) => text.includes(marker));
	expect(found.length, marker).toBeGreaterThan(0);
	return found.join('\n');
}

describe("billing's events, at billing's code points", () => {
	it('the subscription event handler builds its events from the stored and rebuilt rows', () => {
		expect(sourcesSending('subscriptionEventsFor(')).toContain('deps.track(');
	});

	it('the credit top-up handler sends credits_purchased', () => {
		expect(sourcesSending("name: 'credits_purchased'")).toContain('deps.track(');
	});

	it('the credit notices send credits_low only for a claim that is new and kept', () => {
		const notices = sourcesSending("name: 'credits_low'");
		// A claim given back during an email outage is tried again on the next step, so it must not count each time.
		expect(notices).toContain("outcome === 'sent' || outcome === 'claimed'");
		expect(notices).not.toContain("!== 'already-sent'");
	});

	it('the prompt gate sends credits_limit_reached when it refuses for credits', () => {
		expect(sourcesSending("name: 'credits_limit_reached'")).toContain('trackBilling(');
	});

	it('the env wiring sends through trackBilling', () => {
		sourcesSending('track: (userId, events) => trackBilling(env, userId, events)');
	});
});
