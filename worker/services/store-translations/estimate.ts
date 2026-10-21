/** What translating a store's missing text costs, before the seller starts: tokens from characters, priced like any model call. */

import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID, TRANSLATION_BATCH_MAX_TEXTS } from '../../../shared/types/store-translations';
import { stepCredits } from '../billing/step-credits';

const CHARS_PER_TOKEN = 4;
/** The translation is about this much longer than its source. */
const TARGET_LANGUAGE_GROWTH = 1.3;
/** The instructions every batch's request starts with. */
const PROMPT_TOKENS_PER_BATCH = 600;

/** Credits for translating `chars` characters across `texts` texts into one language: zero for no text. */
export function estimateTranslationCredits(chars: number, texts: number): number {
	if (chars <= 0) return 0;
	const model = resolveThinkModel(TASK_MODEL_ID);
	const sourceTokens = Math.ceil(chars / CHARS_PER_TOKEN);
	const batches = Math.max(1, Math.ceil(texts / TRANSLATION_BATCH_MAX_TEXTS));
	return stepCredits(
		model.prices,
		{ inputTokens: sourceTokens + batches * PROMPT_TOKENS_PER_BATCH, outputTokens: Math.ceil(sourceTokens * TARGET_LANGUAGE_GROWTH) },
		model.creditsPerStep,
	);
}
