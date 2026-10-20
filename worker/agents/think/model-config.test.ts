import { describe, expect, it } from 'vitest';
import {
	DEFAULT_THINK_MODEL_ID,
	THINK_MODELS,
	fallbackModelFor,
	isThinkModelId,
	modelUnavailableNotice,
	resolveThinkModel,
	thinkModelOptions,
} from './model-config';

describe('think model catalog', () => {
	it('offers the four build models in order', () => {
		expect(THINK_MODELS.map((model) => model.id)).toEqual([
			'google-ai-studio/gemini-3.6-flash',
			'google-ai-studio/gemini-3.8-flash',
			'anthropic/claude-sonnet-5-5',
			'anthropic/claude-opus-5-5',
		]);
	});

	it('charges each model its credit cost', () => {
		expect(Object.fromEntries(THINK_MODELS.map((model) => [model.id, model.config.creditCost]))).toEqual({
			'google-ai-studio/gemini-3.6-flash': 3,
			'google-ai-studio/gemini-3.8-flash': 3,
			'anthropic/claude-sonnet-5-5': 8,
			'anthropic/claude-opus-5-5': 16,
		});
	});

	it('defaults to Claude Sonnet 5.5', () => {
		expect(DEFAULT_THINK_MODEL_ID).toBe('anthropic/claude-sonnet-5-5');
		expect(isThinkModelId(DEFAULT_THINK_MODEL_ID)).toBe(true);
	});

	it('resolves known ids and falls back to the default for anything else', () => {
		expect(resolveThinkModel('anthropic/claude-opus-5-5').id).toBe('anthropic/claude-opus-5-5');
		expect(resolveThinkModel('foo').id).toBe(DEFAULT_THINK_MODEL_ID);
		expect(resolveThinkModel(undefined).id).toBe(DEFAULT_THINK_MODEL_ID);
		expect(resolveThinkModel(42).id).toBe(DEFAULT_THINK_MODEL_ID);
	});

	it('recognises only catalog ids', () => {
		expect(isThinkModelId('google-ai-studio/gemini-3.8-flash')).toBe(true);
		expect(isThinkModelId('google-ai-studio/gemini-2.5-flash')).toBe(false);
		expect(isThinkModelId(undefined)).toBe(false);
	});

	it('offers an alternative from the other provider', () => {
		expect(THINK_MODELS.map((model) => [model.id, fallbackModelFor(model).id])).toEqual([
			['google-ai-studio/gemini-3.6-flash', 'anthropic/claude-sonnet-5-5'],
			['google-ai-studio/gemini-3.8-flash', 'anthropic/claude-sonnet-5-5'],
			['anthropic/claude-sonnet-5-5', 'google-ai-studio/gemini-3.6-flash'],
			['anthropic/claude-opus-5-5', 'google-ai-studio/gemini-3.6-flash'],
		]);
	});

	it('exposes id, label, provider and credits for the picker', () => {
		expect(thinkModelOptions()[2]).toEqual({
			id: 'anthropic/claude-sonnet-5-5',
			label: 'Claude Sonnet 5.5',
			provider: 'anthropic',
			creditsPerStep: 136,
		});
	});

	it('pins each model to its list prices per 1M tokens and its typical credits per step', () => {
		expect(THINK_MODELS.map((model) => [model.id, model.prices, model.creditsPerStep, model.pricesReviewBy])).toEqual([
			['google-ai-studio/gemini-3.6-flash', { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 }, 16, '2026-12-31'],
			['google-ai-studio/gemini-3.8-flash', { inputUsd: 0.75, outputUsd: 3.75, cacheReadUsd: 0.1875, cacheWriteUsd: 0.75 }, 16, '2026-12-31'],
			['anthropic/claude-sonnet-5-5', { inputUsd: 2, outputUsd: 10, cacheReadUsd: 0.2, cacheWriteUsd: 2.5 }, 136, null],
			['anthropic/claude-opus-5-5', { inputUsd: 4, outputUsd: 20, cacheReadUsd: 0.4, cacheWriteUsd: 5 }, 445, null],
		]);
	});

	it('publishes the typical credits per step to the pricing page and the model picker', () => {
		expect(thinkModelOptions().map((option) => [option.id, option.creditsPerStep])).toEqual(THINK_MODELS.map((model) => [model.id, model.creditsPerStep]));
	});
});

describe('modelUnavailableNotice', () => {
	const failure = { modelId: 'google-ai-studio/gemini-3.6-flash', reason: 'overloaded' as const, status: 503, detail: 'high demand' };

	it('offers the other provider when switching is enabled', () => {
		expect(modelUnavailableNotice(failure, true)).toEqual({
			modelId: 'google-ai-studio/gemini-3.6-flash',
			reason: 'overloaded',
			status: 503,
			detail: 'high demand',
			alternativeModelId: 'anthropic/claude-sonnet-5-5',
		});
	});

	it('offers no alternative when switching is disabled', () => {
		expect(modelUnavailableNotice(failure, false)).not.toHaveProperty('alternativeModelId');
	});

	it('offers Gemini when a Claude model fails', () => {
		const claude = { modelId: 'anthropic/claude-opus-5-5', reason: 'timeout' as const };
		expect(modelUnavailableNotice(claude, true)).toEqual({
			modelId: 'anthropic/claude-opus-5-5',
			reason: 'timeout',
			alternativeModelId: 'google-ai-studio/gemini-3.6-flash',
		});
	});
});
