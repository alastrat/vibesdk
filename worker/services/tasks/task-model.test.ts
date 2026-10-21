/** The model a task calls, against a stand-in for the gateway's chat completions endpoint. */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { THINK_MODELS } from '../../agents/think/model-config';
import { TASK_MODEL_ID } from '../../../shared/types/store-translations';
import { stepCredits } from '../billing/step-credits';
import { TASK_LEASE_MS } from '../../../shared/types/tasks';
import { createTaskModel, MODEL_CALL_TIMEOUT_MS } from './task-model';

const schema = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });
const ANSWER = { items: [{ id: '0', text: 'Hola' }] };

interface Seen {
	url: string;
	headers: Headers;
	body: { model: string; messages: { role: string; content: string }[]; max_tokens?: number; max_completion_tokens?: number; reasoning_effort?: string };
	raw: string;
}

function gateway(reply: (n: number) => Response = () => completion(JSON.stringify(ANSWER))) {
	const seen: Seen[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		seen.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)), raw: String(init?.body) });
		return reply(seen.length);
	};
	return { seen, fetchImpl };
}

function completion(content: string, usage: Record<string, number> | null = { prompt_tokens: 1_000, completion_tokens: 500, total_tokens: 1_500 }): Response {
	return Response.json({
		id: 'chatcmpl-1',
		object: 'chat.completion',
		created: 1,
		model: TASK_MODEL_ID,
		choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
		...(usage === null ? {} : { usage }),
	});
}

const storedKeys = { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_AI_GATEWAY: 'estori-gateway', CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-token-0123456789', CLOUDFLARE_AI_GATEWAY_URL: 'https://local.example/v1/x/y' } as unknown as Env;
const providerKey = { ...storedKeys, GOOGLE_AI_STUDIO_API_KEY: 'google-key-0123456789' } as unknown as Env;
const input = { system: 'Translate.', prompt: '[{"id":"0","text":"Hello"}]', schema, maxOutputTokens: 800 };

describe('the task model', () => {
	it("ends a call early enough that a step's two calls, a batch and its retry, fit inside the task's lease", () => {
		expect(2 * MODEL_CALL_TIMEOUT_MS).toBeLessThan(TASK_LEASE_MS);
	});

	it("is one of the agent's priced models, so every call is charged from its usage", () => {
		expect(THINK_MODELS.map((model) => model.id)).toContain(TASK_MODEL_ID);
	});

	it('asks the gateway for the structured answer and returns it with the call it made', async () => {
		const { seen, fetchImpl } = gateway();
		const result = await createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input);
		expect(result.object).toEqual(ANSWER);
		expect(result.call).toMatchObject({ model: TASK_MODEL_ID, usage: { inputTokens: 1_000, outputTokens: 500 } });
		expect(seen).toHaveLength(1);
		expect(seen[0].url).toBe('https://gateway.ai.cloudflare.com/v1/acct/estori-gateway/compat/chat/completions');
		expect(seen[0].body.model).toBe(TASK_MODEL_ID);
		expect(seen[0].body.messages).toEqual([
			{ role: 'system', content: 'Translate.' },
			{ role: 'user', content: '[{"id":"0","text":"Hello"}]' },
		]);
		expect(seen[0].body.max_completion_tokens ?? seen[0].body.max_tokens).toBe(800);
	});

	it('always asks for minimal reasoning, since the model otherwise thinks first: its thinking tokens would cut the answer off and go uncharged', async () => {
		const { seen, fetchImpl } = gateway();
		await createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input);
		await createTaskModel(providerKey, { fetch: fetchImpl }).generate({ ...input, maxOutputTokens: 4_000 });
		expect(seen).toHaveLength(2);
		for (const request of seen) {
			expect(request.raw).toContain('"reasoning_effort":"minimal"');
			expect(request.body.reasoning_effort).toBe('minimal');
		}
	});

	it("authorizes with the platform's gateway token alone when the gateway holds the provider keys", async () => {
		const { seen, fetchImpl } = gateway();
		await createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input);
		expect(seen[0].headers.get('cf-aig-authorization')).toBe('Bearer gateway-token-0123456789');
		expect(seen[0].headers.get('authorization')).toBeNull();
	});

	it("sends the platform's provider key when it holds one, and never a seller's", async () => {
		const { seen, fetchImpl } = gateway();
		await createTaskModel(providerKey, { fetch: fetchImpl }).generate(input);
		expect(seen[0].headers.get('authorization')).toBe('Bearer google-key-0123456789');
		expect(seen[0].headers.get('cf-aig-authorization')).toBe('Bearer gateway-token-0123456789');
	});

	it('reports no token usage in a way that charges the typical step', async () => {
		const { fetchImpl } = gateway(() => completion(JSON.stringify(ANSWER), null));
		const { call } = await createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input);
		const model = THINK_MODELS.find((candidate) => candidate.id === TASK_MODEL_ID);
		if (!model) throw new Error('Task model missing');
		expect(stepCredits(model.prices, call.usage, model.creditsPerStep)).toBe(model.creditsPerStep);
	});

	it('fails the step, once, when the gateway answers with an error', async () => {
		const { seen, fetchImpl } = gateway(() => Response.json({ error: { message: 'unavailable' } }, { status: 503 }));
		await expect(createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input)).rejects.toThrow();
		expect(seen).toHaveLength(1);
	});

	it('fails the step when the answer does not fit the schema', async () => {
		const { fetchImpl } = gateway(() => completion(JSON.stringify({ items: 'none' })));
		await expect(createTaskModel(storedKeys, { fetch: fetchImpl }).generate(input)).rejects.toThrow();
	});
});
