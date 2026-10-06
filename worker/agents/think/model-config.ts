import { ModelSize, type AIModelConfig } from '../inferutils/config.types';
import type { ThinkModelOption } from '../core/features/types';

/** A model users can pick to build a think app. Ids are AI Gateway `provider/model` slugs. */
export interface ThinkModel {
	id: string;
	config: AIModelConfig;
}

// Credits: $0.25 per 1M input tokens = 1 credit. Gemini Flash input is $0.75 through 2026-12-31.
export const THINK_MODELS: readonly ThinkModel[] = [
	{
		id: 'google-ai-studio/gemini-3.6-flash',
		config: { name: 'Gemini 3.6 Flash', size: ModelSize.REGULAR, provider: 'google-ai-studio', creditCost: 3, contextSize: 1_048_576 },
	},
	{
		id: 'google-ai-studio/gemini-3.8-flash',
		config: { name: 'Gemini 3.8 Flash', size: ModelSize.REGULAR, provider: 'google-ai-studio', creditCost: 3, contextSize: 1_048_576 },
	},
	{
		id: 'anthropic/claude-sonnet-5-5',
		config: { name: 'Claude Sonnet 5.5', size: ModelSize.LARGE, provider: 'anthropic', creditCost: 8, contextSize: 1_000_000 },
	},
	{
		id: 'anthropic/claude-opus-5-5',
		config: { name: 'Claude Opus 5.5', size: ModelSize.LARGE, provider: 'anthropic', creditCost: 16, contextSize: 1_000_000 },
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
		creditCost: model.config.creditCost,
	}));
}

function requireThinkModel(id: string): ThinkModel {
	const model = THINK_MODELS.find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Think model ${id} is missing from THINK_MODELS`);
	return model;
}

export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'Gemini 3.6 Flash',
	size: ModelSize.REGULAR,
	provider: 'google-ai-studio',
	creditCost: 2,
	contextSize: 1_048_576,
};

/** Used when the primary model is overloaded; enabled by `ENABLE_THINK_MODEL_FALLBACK`. */
export const THINK_FALLBACK_MODEL_ID = 'anthropic/claude-sonnet-5-5';

export const THINK_FALLBACK_MODEL_CONFIG: AIModelConfig = {
	name: 'Claude Sonnet 5.5',
	size: ModelSize.LARGE,
	provider: 'anthropic',
	creditCost: 8, // $2.00
	contextSize: 1_000_000,
};
