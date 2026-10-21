/** What translating a store's missing text costs, before the seller starts: tokens from characters, priced like any model call. */

import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID, TRANSLATION_BATCH_MAX_CHARS, TRANSLATION_BATCH_MAX_TEXTS } from '../../../shared/types/store-translations';
import { stepCredits } from '../billing/step-credits';

export const CHARS_PER_TOKEN = 4;
/** The translation is about this much longer than its source. */
const TARGET_LANGUAGE_GROWTH = 1.3;
/** The instructions every batch's request starts with. */
const PROMPT_TOKENS_PER_BATCH = 600;
/** The JSON wrapper around each text, in the request and in the answer. */
const WRAPPER_TOKENS_PER_TEXT = 10;

/**
 * Credits for translating `chars` characters across `texts` texts into one language: zero for no text. A step sends one
 * batch of at most 40 texts or 12,000 characters, so the estimate prices one average batch the way a call is charged,
 * rounded up, and multiplies by the number of batches.
 */
export function estimateTranslationCredits(chars: number, texts: number): number {
	if (chars <= 0) return 0;
	const model = resolveThinkModel(TASK_MODEL_ID);
	const batches = Math.max(1, Math.ceil(texts / TRANSLATION_BATCH_MAX_TEXTS), Math.ceil(chars / TRANSLATION_BATCH_MAX_CHARS));
	const sourceTokens = Math.ceil(chars / batches / CHARS_PER_TOKEN);
	const wrapperTokens = Math.ceil(texts / batches) * WRAPPER_TOKENS_PER_TEXT;
	const perBatch = stepCredits(
		model.prices,
		{ inputTokens: sourceTokens + PROMPT_TOKENS_PER_BATCH + wrapperTokens, outputTokens: Math.ceil(sourceTokens * TARGET_LANGUAGE_GROWTH) + wrapperTokens },
		model.creditsPerStep,
	);
	return batches * perBatch;
}
