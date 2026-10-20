import type { ThinkModelOption } from '@/api-types';
import { useFeature } from '@/features';

/**
 * The builder's models and the typical credits per AI step of each, as the platform publishes them, with the model a new
 * build starts on. Empty until the platform answers.
 */
export function useModelRates(): { models: readonly ThinkModelOption[]; rates: readonly number[]; defaultModel: ThinkModelOption | null } {
	const { capabilities } = useFeature();
	const models = capabilities?.thinkModels ?? [];
	const defaultModel = models.find((model) => model.id === capabilities?.defaultThinkModel) ?? models[0] ?? null;
	return { models, rates: models.map((model) => model.creditsPerStep), defaultModel };
}
