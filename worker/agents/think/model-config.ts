import { ModelSize, type AIModelConfig } from '../inferutils/config.types';

export const THINK_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

export const THINK_MODEL_CONFIG: AIModelConfig = {
	name: 'Gemini 3.6 Flash',
	size: ModelSize.REGULAR,
	provider: 'google-ai-studio',
	creditCost: 2,
	contextSize: 1_048_576,
};

/** Used when the primary model is overloaded; enabled by `ENABLE_THINK_MODEL_FALLBACK`. */
export const THINK_FALLBACK_MODEL_ID = 'anthropic/claude-opus-5-5';

export const THINK_FALLBACK_MODEL_CONFIG: AIModelConfig = {
	name: 'Claude Opus 5.5',
	size: ModelSize.LARGE,
	provider: 'anthropic',
	creditCost: 16, // $4.00
	contextSize: 1_000_000,
};
