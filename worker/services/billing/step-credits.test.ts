import { describe, expect, it } from 'vitest';
import { legacyCallCredits, stepCredits, stepUsageFrom } from './step-credits';

const SONNET = { inputUsd: 2, outputUsd: 10, cacheReadUsd: 0.2, cacheWriteUsd: 2.5 };
const OPUS = { inputUsd: 4, outputUsd: 20, cacheReadUsd: 0.4, cacheWriteUsd: 5 };
const FLASH = { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 };

describe('stepCredits', () => {
	it("charges a step's list-price cost times 1.5, in credits of $0.001, rounded up", () => {
		// $0.08 + $0.03 = $0.11, × 1.5 = $0.165: exactly 165 credits, not 166.
		expect(stepCredits(SONNET, { inputTokens: 40_000, outputTokens: 3_000 }, 136)).toBe(165);
		// $0.015 + $0.00375 = $0.01875, × 1.5 = $0.028125: 29 credits.
		expect(stepCredits(FLASH, { inputTokens: 20_000, outputTokens: 1_000 }, 16)).toBe(29);
		expect(stepCredits(SONNET, { inputTokens: 1, outputTokens: 0 }, 136)).toBe(1);
	});

	it('prices cache reads and writes apart from fresh input, and counts reasoning as output', () => {
		// 10k fresh × $4 + 50k read × $0.40 + 2k written × $5 + 4k out × $20 = $0.15, × 1.5 = 225 credits.
		expect(stepCredits(OPUS, { inputTokens: 62_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000, outputTokens: 4_000 }, 445)).toBe(225);
		expect(
			stepCredits(
				OPUS,
				{ inputTokens: 62_000, noCacheInputTokens: 10_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000, textTokens: 1_000, reasoningTokens: 3_000 },
				445,
			),
		).toBe(225);
	});

	it("charges the model's typical step when the provider reports no usage", () => {
		expect(stepCredits(SONNET, null, 136)).toBe(136);
		expect(stepCredits(SONNET, {}, 136)).toBe(136);
	});

	it("reads the AI SDK's step usage", () => {
		expect(
			stepUsageFrom({
				inputTokens: 62_000,
				inputTokenDetails: { noCacheTokens: 10_000, cacheReadTokens: 50_000, cacheWriteTokens: 2_000 },
				outputTokens: 4_000,
				outputTokenDetails: { textTokens: 1_000, reasoningTokens: 3_000 },
				totalTokens: 66_000,
			}),
		).toEqual({
			inputTokens: 62_000,
			noCacheInputTokens: 10_000,
			cacheReadTokens: 50_000,
			cacheWriteTokens: 2_000,
			outputTokens: 4_000,
			textTokens: 1_000,
			reasoningTokens: 3_000,
		});
		expect(stepUsageFrom(undefined)).toBeNull();
	});

	it("converts an older call's flat cost to the new unit, as Sonnet's 8 became its typical 136", () => {
		expect(legacyCallCredits(8)).toBe(136);
		expect(legacyCallCredits(1.2)).toBe(21);
		expect(legacyCallCredits(0)).toBe(0);
	});
});
