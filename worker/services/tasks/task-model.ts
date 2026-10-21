/**
 * The model a seller task calls: the platform's own gateway and keys, never a seller's, answering with an object that
 * fits a schema. It reports the call's token usage, so the meter charges what the call cost.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateText, JSONParseError, NoObjectGeneratedError, Output, TypeValidationError } from 'ai';
import type { ZodType } from 'zod';
import { resolveThinkGateway, storedKeysFetch } from '../../agents/think/gateway-auth';
import { getConfigurationForModel } from '../../agents/inferutils/core';
import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import { stepUsageFrom } from '../billing/step-credits';
import type { ModelCall } from './kinds';

/**
 * A step can make two calls, a batch and its retry, and both must end inside a task's lease (TASK_LEASE_MS), or another
 * alarm could claim the task mid-step. Two of these fit in the lease's 120 s with time left to save the step.
 */
export const MODEL_CALL_TIMEOUT_MS = 45_000;

export interface TaskModel {
	generate<T>(input: { system: string; prompt: string; schema: ZodType<T>; maxOutputTokens: number }): Promise<{ object: T; call: ModelCall }>;
}

/** The model finished without an answer to use: cut off by the token limit, or refused or filtered. */
class UnusableAnswerError extends Error {
	constructor(readonly finishReason: 'length' | 'content-filter') {
		super(finishReason === 'length' ? 'The model ran out of output tokens before it finished' : 'The model refused or filtered its answer');
	}
}

/**
 * Whether a failed call is about the model's answer to these texts, which a smaller try may then set aside: JSON that
 * can't be read or doesn't fit the schema, an answer cut off by the token limit, or a refusal or content filter. Anything
 * else is about reaching the model, such as a timeout, a network failure, a 429 or a 5xx, or is unknown, and waits for
 * the task's backoff.
 */
export function isAnswerProblem(error: unknown): boolean {
	return error instanceof UnusableAnswerError || NoObjectGeneratedError.isInstance(error) || JSONParseError.isInstance(error) || TypeValidationError.isInstance(error);
}

export interface TaskModelOptions {
	/** The fetch the call goes through; the platform's fetch when left out. */
	fetch?: typeof fetch;
}

export function createTaskModel(env: Env, options: TaskModelOptions = {}): TaskModel {
	const model = resolveThinkModel(TASK_MODEL_ID);
	return {
		async generate({ system, prompt, schema, maxOutputTokens }) {
			// Platform keys only: no seller key, gateway or token is passed.
			const conf = await getConfigurationForModel(model.config, env, '', undefined, false, null, null);
			const gateway = resolveThinkGateway(conf, env);
			const provider = createOpenAI({
				baseURL: gateway.baseURL,
				apiKey: gateway.apiKey,
				headers: gateway.headers,
				fetch: storedKeysFetch(gateway.useStoredKeys, options.fetch ?? ((input, init) => fetch(input, init))),
			});
			// Chat Completions, as the Think agent does: the gateway's Responses path rejects these models' auth.
			const result = await generateText({
				model: provider.chat(model.id),
				system,
				prompt,
				output: Output.object({ schema }),
				maxOutputTokens,
				// Without it the model thinks first: its thinking tokens eat the output limit and are missing from the usage.
				providerOptions: { openai: { reasoningEffort: 'minimal' } },
				// A failed call is the task's to retry with backoff, so it is not retried here.
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
			});
			// The SDK reads an answer only when the model stopped by itself; the other endings have no output to read.
			if (result.finishReason === 'length' || result.finishReason === 'content-filter') throw new UnusableAnswerError(result.finishReason);
			return { object: result.output, call: { model: model.id, usage: stepUsageFrom(result.totalUsage) } };
		},
	};
}
