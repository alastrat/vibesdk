import { describe, expect, it } from 'vitest';
import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID, TRANSLATION_BATCH_MAX_CHARS, TRANSLATION_BATCH_MAX_TEXTS } from '../../../shared/types/store-translations';
import { stepCredits } from '../billing/step-credits';
import { estimateTranslationCredits } from './estimate';

const model = resolveThinkModel(TASK_MODEL_ID);
const price = (inputTokens: number, outputTokens: number) => stepCredits(model.prices, { inputTokens, outputTokens }, model.creditsPerStep);

/**
 * What a task spends when its steps send batches of the sizes it uses: each batch is up to 40 texts or 12,000
 * characters, with 600 tokens of instructions and 10 tokens of JSON wrapper per text on each side, and each call priced
 * and rounded up on its own.
 */
function perBatchSum(texts: { chars: number }[]): number {
	let total = 0;
	for (let start = 0; start < texts.length; ) {
		let chars = 0;
		let count = 0;
		while (start + count < texts.length && count < TRANSLATION_BATCH_MAX_TEXTS && chars + texts[start + count].chars <= TRANSLATION_BATCH_MAX_CHARS) {
			chars += texts[start + count].chars;
			count += 1;
		}
		const source = Math.ceil(chars / 4);
		total += price(source + 600 + 10 * count, Math.ceil(source * 1.3) + 10 * count);
		start += count;
	}
	return total;
}

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
		// 4,000 characters are 1,000 tokens in and 1,300 out with 30% more for the target language; 10 texts add 10 tokens
		// each on both sides for the JSON wrapper, and the instructions add 600 in.
		expect(estimateTranslationCredits(4_000, 10)).toBe(price(1_000 + 600 + 100, 1_300 + 100));
		expect(estimateTranslationCredits(4_000, 10)).toBe(10);
	});

	it('counts a batch for every 40 texts, pricing each as a call does', () => {
		// 41 texts need two batches of about 21 texts and 2,000 characters.
		expect(estimateTranslationCredits(4_000, 41)).toBe(2 * price(500 + 600 + 210, 650 + 210));
	});

	it('counts a batch for every 12,000 characters when texts are long', () => {
		// 100 texts of 5,000 characters need about 42 batches by size: 3 texts, about 11,905 characters each.
		expect(estimateTranslationCredits(500_000, 100)).toBe(42 * price(2_977 + 600 + 30, 3_871 + 30));
	});

	it('lands within 15% of the sum over real batches for a store of many short texts', () => {
		const texts = Array.from({ length: 5_000 }, () => ({ chars: 50 }));
		const actual = perBatchSum(texts);
		const estimate = estimateTranslationCredits(5_000 * 50, 5_000);
		expect(Math.abs(estimate - actual) / actual).toBeLessThan(0.15);
	});

	it('lands within 15% of the sum over real batches for a store of mixed lengths', () => {
		const texts = Array.from({ length: 1_200 }, (_, index) => ({ chars: 20 + ((index * 37) % 300) }));
		const actual = perBatchSum(texts);
		const estimate = estimateTranslationCredits(
			texts.reduce((sum, text) => sum + text.chars, 0),
			texts.length,
		);
		expect(Math.abs(estimate - actual) / actual).toBeLessThan(0.15);
	});
});
