import { describe, expect, it } from 'vitest';
import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import { stepCredits } from '../billing/step-credits';
import { estimateTranslationCredits } from './estimate';

const model = resolveThinkModel(TASK_MODEL_ID);

describe('estimateTranslationCredits', () => {
	it('estimates zero for zero characters', () => {
		expect(estimateTranslationCredits(0, 0)).toBe(0);
		expect(estimateTranslationCredits(0, 12)).toBe(0);
	});

	it('grows with characters and batches', () => {
		expect(estimateTranslationCredits(40_000, 10)).toBeGreaterThan(estimateTranslationCredits(8_000, 10));
		// The same text in more batches repeats the instructions in each.
		expect(estimateTranslationCredits(40_000, 400)).toBeGreaterThan(estimateTranslationCredits(40_000, 40));
	});

	it('matches stepCredits for a single batch of known size', () => {
		// 4,000 characters are 1,000 tokens in, 1,300 out with 30% more for the target language, and 600 more in for the instructions.
		expect(estimateTranslationCredits(4_000, 10)).toBe(stepCredits(model.prices, { inputTokens: 1_600, outputTokens: 1_300 }, model.creditsPerStep));
		expect(estimateTranslationCredits(4_000, 10)).toBe(10);
	});

	it('counts a batch for every 40 texts', () => {
		// 41 texts need two batches, so two sets of instructions.
		expect(estimateTranslationCredits(4_000, 41)).toBe(stepCredits(model.prices, { inputTokens: 1_000 + 2 * 600, outputTokens: 1_300 }, model.creditsPerStep));
	});
});
