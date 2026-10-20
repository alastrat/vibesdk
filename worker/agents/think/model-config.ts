import { ModelSize, type AIModelConfig } from '../inferutils/config.types';
import type { ThinkModelOption } from '../core/features/types';
import type { ProviderFailure, ProviderFailureReason } from './model-transport';

/** Prices in US dollars per 1M tokens. */
export interface TokenPrices {
	inputUsd: number;
	outputUsd: number;
	cacheReadUsd: number;
	cacheWriteUsd: number;
}

/** A model users can pick to build a think app. Ids are AI Gateway `provider/model` slugs. */
export interface ThinkModel {
	id: string;
	config: AIModelConfig;
	prices: TokenPrices;
	/** Typical credits per step, from measured usage; each step is charged from its real cost. */
	creditsPerStep: number;
	/** The day to re-check `prices` (a promotional price ends), or null when they have no end date. */
	pricesReviewBy: string | null;
}

/**
 * List prices per 1M tokens, from 589 AI Gateway log rows (2026-10-19). Cache reads cost 10% of input on Anthropic and
 * 25% on Gemini; Anthropic cache writes cost 125%. Gemini Flash input is promotional through 2026-12-31: review its
 * prices then. `config.creditCost` is the older flat cost per call, which billing-off metering still uses.
 */
export const THINK_MODELS: readonly ThinkModel[] = [
	{
		id: 'google-ai-studio/gemini-3.6-flash',
		config: { name: 'Gemini 3.6 Flash', size: ModelSize.REGULAR, provider: 'google-ai-studio', creditCost: 3, contextSize: 1_048_576 },
		prices: { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 },
		creditsPerStep: 16,
		pricesReviewBy: '2026-12-31',
	},
	{
		id: 'google-ai-studio/gemini-3.8-flash',
		config: { name: 'Gemini 3.8 Flash', size: ModelSize.REGULAR, provider: 'google-ai-studio', creditCost: 3, contextSize: 1_048_576 },
		prices: { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 },
		creditsPerStep: 16,
		pricesReviewBy: '2026-12-31',
	},
	{
		id: 'anthropic/claude-sonnet-5-5',
		config: { name: 'Claude Sonnet 5.5', size: ModelSize.LARGE, provider: 'anthropic', creditCost: 8, contextSize: 1_000_000 },
		prices: { inputUsd: 2, outputUsd: 10, cacheReadUsd: 0.2, cacheWriteUsd: 2.5 },
		creditsPerStep: 136,
		pricesReviewBy: null,
	},
	{
		id: 'anthropic/claude-opus-5-5',
		config: { name: 'Claude Opus 5.5', size: ModelSize.LARGE, provider: 'anthropic', creditCost: 16, contextSize: 1_000_000 },
		prices: { inputUsd: 4, outputUsd: 20, cacheReadUsd: 0.4, cacheWriteUsd: 5 },
		creditsPerStep: 445,
		pricesReviewBy: null,
	},
];

export const DEFAULT_THINK_MODEL_ID = 'anthropic/claude-sonnet-5-5';

/** The alternative crosses providers so one provider's outage has a way out. */
const FALLBACK_BY_PROVIDER: Record<string, string> = {
	'google-ai-studio': 'anthropic/claude-sonnet-5-5',
	anthropic: 'google-ai-studio/gemini-3.6-flash',
};

export function isThinkModelId(id: unknown): id is string {
	return typeof id === 'string' && THINK_MODELS.some((model) => model.id === id);
}

/** The catalog entry for `id`, or the default model when `id` is missing or unknown. */
export function resolveThinkModel(id: unknown): ThinkModel {
	return THINK_MODELS.find((model) => model.id === id) ?? requireThinkModel(DEFAULT_THINK_MODEL_ID);
}

export function fallbackModelFor(model: ThinkModel): ThinkModel {
	return requireThinkModel(FALLBACK_BY_PROVIDER[model.config.provider] ?? DEFAULT_THINK_MODEL_ID);
}

export function thinkModelOptions(): ThinkModelOption[] {
	return THINK_MODELS.map((model) => ({
		id: model.id,
		label: model.config.name,
		provider: model.config.provider,
		creditsPerStep: model.creditsPerStep,
	}));
}

function requireThinkModel(id: string): ThinkModel {
	const model = THINK_MODELS.find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Think model ${id} is missing from THINK_MODELS`);
	return model;
}

/** What the chat needs to explain a provider failure and offer a switch. */
export interface ModelUnavailableNotice {
	modelId: string;
	reason: ProviderFailureReason;
	status?: number;
	detail?: string;
	/** The other provider's model, when switching is offered. */
	alternativeModelId?: string;
}

export function modelUnavailableNotice(failure: ProviderFailure, offerAlternative: boolean): ModelUnavailableNotice {
	return {
		modelId: failure.modelId,
		reason: failure.reason,
		...(failure.status !== undefined ? { status: failure.status } : {}),
		...(failure.detail !== undefined ? { detail: failure.detail } : {}),
		...(offerAlternative ? { alternativeModelId: fallbackModelFor(resolveThinkModel(failure.modelId)).id } : {}),
	};
}
