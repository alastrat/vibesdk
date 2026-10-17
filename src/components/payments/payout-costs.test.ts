import { describe, expect, it } from 'vitest';
import { stripeFeesText } from './payout-costs';

describe('stripeFeesText', () => {
	it("states Stripe's account and payout fees from the configured rates", () => {
		expect(stripeFeesText({ monthlyActiveCents: 200, payoutPercent: 0.25, payoutFixedCents: 25 })).toBe("$2.00 a month in Stripe fees, plus 0.25% and 25¢ per payout, once you're paid");
		expect(stripeFeesText({ monthlyActiveCents: 300, payoutPercent: 0.5, payoutFixedCents: 130 })).toBe("$3.00 a month in Stripe fees, plus 0.5% and $1.30 per payout, once you're paid");
	});
});
