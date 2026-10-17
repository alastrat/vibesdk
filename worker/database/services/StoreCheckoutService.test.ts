import { describe, expect, it } from 'vitest';
import { StoreCheckoutService } from './StoreCheckoutService';
import { recordingD1 } from '../test-support/recording-d1';

describe('StoreCheckoutService.weeklyUsage', () => {
	it("sums the weight of the seller's paid, open and starting checkouts in this mode since the given time", async () => {
		const { d1, statements } = recordingD1([[12_500]]);
		const usage = await new StoreCheckoutService({ DB: d1 } as unknown as Env).weeklyUsage('u1', 'test', new Date(1_800_000_000_000));
		expect(usage).toBe(12_500);
		const select = statements[0];
		expect(select.sql).toContain('sum("weighted_cents")');
		expect(select.sql).toContain('"store_checkouts"."status" in');
		expect(select.params).toEqual(expect.arrayContaining(['u1', 'test', 'creating', 'open', 'completed']));
	});
});
