/**
 * The model a seller task calls: the platform's own gateway and keys, never a seller's, answering with an object that
 * fits a schema. It reports the call's token usage, so the meter charges what the call cost.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import type { ZodType } from 'zod';
import { resolveThinkGateway } from '../../agents/think/gateway-auth';
import { getConfigurationForModel } from '../../agents/inferutils/core';
import { resolveThinkModel } from '../../agents/think/model-config';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import { stepUsageFrom } from '../billing/step-credits';
import type { ModelCall } from './kinds';

/** One call must end well inside a task's lease (TASK_LEASE_MS), or another alarm could claim the task mid-call. */
const MODEL_CALL_TIMEOUT_MS = 90_000;

export interface TaskModel {
	generate<T>(input: { system: string; prompt: string; schema: ZodType<T>; maxOutputTokens: number }): Promise<{ object: T; call: ModelCall }>;
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
			const gatewayFetch: typeof fetch = async (input, init) => {
				const headers = new Headers(init?.headers);
				// With the gateway holding the provider keys, a forwarded Authorization would override its stored key.
				if (gateway.useStoredKeys) headers.delete('authorization');
				return (options.fetch ?? fetch)(input, { ...(init ?? {}), headers });
			};
			const provider = createOpenAI({ baseURL: gateway.baseURL, apiKey: gateway.apiKey, headers: gateway.headers, fetch: gatewayFetch });
			// Chat Completions, as the Think agent does: the gateway's Responses path rejects these models' auth.
			const result = await generateObject({
				model: provider.chat(model.id),
				system,
				prompt,
				schema,
				maxOutputTokens,
				// A failed call is the task's to retry with backoff, so it is not retried here.
				maxRetries: 0,
				abortSignal: AbortSignal.timeout(MODEL_CALL_TIMEOUT_MS),
			});
			return { object: result.object, call: { model: model.id, usage: stepUsageFrom(result.usage) } };
		},
	};
}
