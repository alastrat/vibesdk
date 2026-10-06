# Think Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every Estori user pick the model that builds their app, on the home prompt and in the chat. When that model's provider fails, ask the user whether to switch, showing the price change.

**Architecture:**
- One catalog of build models in `worker/agents/think/model-config.ts` drives:
  - the capabilities response;
  - each app's configured model;
  - a `set_model` WebSocket request;
  - the alternative offered on failure.
- The ThinkAgent's fetch transport records provider failures instead of switching models on its own. When a turn fails, the host turns that record into a `model_unavailable` message. The chat shows it as a card with "Switch" (which changes the app's model and resumes) and "Try again".

**Tech Stack:**
- Cloudflare Workers and Durable Objects.
- `@cloudflare/think`, with the AI SDK's OpenAI-compatible provider over AI Gateway.
- React 19, React Router 7, Radix Select.
- Vitest in `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-06-think-model-picker-design.md`

## Global Constraints

- Catalog, in this order:

  | Id | Label | Provider | Credits |
  |---|---|---|---|
  | `google-ai-studio/gemini-3.6-flash` | Gemini 3.6 Flash | google-ai-studio | 3 |
  | `google-ai-studio/gemini-3.8-flash` | Gemini 3.8 Flash | google-ai-studio | 3 |
  | `anthropic/claude-sonnet-5-5` | Claude Sonnet 5.5 | anthropic | 8 |
  | `anthropic/claude-opus-5-5` | Claude Opus 5.5 | anthropic | 16 |

- Default model: `anthropic/claude-sonnet-5-5`.
- Alternatives: Google models offer `anthropic/claude-sonnet-5-5`; Anthropic models offer `google-ai-studio/gemini-3.6-flash`.
- Provider failure reasons:
  - `overloaded` for 503 and 529;
  - `rate_limited` for 429;
  - `unavailable` for other 5xx responses;
  - `timeout` when no response arrives within 60 seconds. The transport then returns a 504.
- Turn retries: `maxRetries: 2`. Response timeout: `60_000` ms.
- WebSocket:
  - Request: `{ "type": "set_model", "modelId": "<id>", "resume"?: true }`.
  - Response type: `model_unavailable`.
  - Error strings, used verbatim:
    - `Unknown model`
    - `Model selection is not supported for this app`
    - `Could not switch model: <message>`
- Resume message: `Continue where you left off.`, exported as `RESUME_BUILD_MESSAGE` from `shared/think.ts`.
- Credit wording:
  - `"<next> credits per step instead of <current>"`;
  - `" (about <ratio>x)"` when more expensive, with the ratio rounded to one decimal;
  - `" (about <n>% cheaper)"` when cheaper.
- Picker placeholder: `Select model`.
- No `any`. No emojis. Frontend imports types from `@/api-types`. React components are `PascalCase.tsx`; utilities are kebab-case.
- Test command: `bun run test <path> [<path>...]`. Run the task's own files, not the whole suite. On macOS the full suite leaves orphaned `workerd` processes that exhaust ports; the CI gate runs the full suite on Linux.
- `bun run typecheck` locally reports 4 pre-existing errors in `packages/artifacts-viewer`; any other error is a failure.
- Commit subjects are lowercase, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Stage by explicit path.

## Review Focus

1. **The provider fails mid-build, after several files are written.** "Switch" must resume from where the build stopped: the history is kept, and a Gemini resume after Claude steps carries signature placeholders. Task 2 pins the placeholders; Task 10 checks a real resume live.
2. **An app created before this change** (no `thinkModelId`). Its chat picker shows `Select model`, and picking a model works. Task 8's guard pins the empty-string sync.
3. **Two tabs on the same app.** A switch in one tab, including through the card, updates the picker in the other through `cf_agent_state`. Task 8's guard pins the sync.
4. **The alternative fails too, or the fallback flag is off.** The card appears again offering the next alternative, or shows only "Try again". Task 4 pins the flag; Task 9's component renders without an alternative.
5. **Capabilities fail to load** (`capabilities` is null). The home prompt creates apps without `model`, the pickers render nothing, and the card falls back to raw model ids. Tasks 6 and 9 pin these.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/agents/think/model-config.ts` (rewrite) | Catalog, default, alternatives, capability options, failure notice builder |
| `worker/agents/think/model-config.test.ts` (new) | Catalog and notice tests |
| `worker/agents/think/model-transport.ts` (new, replaces `model-fallback.ts`) | Body hook, response timeout, provider failure records |
| `worker/agents/think/model-transport.test.ts` (new, replaces `model-fallback.test.ts`) | Transport tests |
| `worker/agents/think/thought-signatures.ts` (modify) | Inject signatures only into Google-bound bodies |
| `worker/agents/think/ThinkAgent.ts` (modify) | Transport wiring, failure record and RPC, 2 retries, per-model credits |
| `worker/agents/core/features/types.ts` (modify) | `ThinkModelOption`; capabilities fields |
| `worker/agents/core/state.ts`, `worker/agents/core/types.ts` (modify) | `thinkModelId` in state and init args |
| `worker/api/controllers/agent/types.ts`, `worker/api/controllers/agent/controller.ts` (modify) | `modelId` on create |
| `worker/agents/core/behaviors/think.ts` (modify) | Configure from the selected model; `setModel`; report failed turns |
| `worker/agents/think/model-wiring.test.ts` (new) | Server wiring guards |
| `worker/api/websocketTypes.ts`, `worker/agents/constants.ts` (modify) | `model_unavailable`, `set_model` |
| `worker/agents/core/websocket.ts` (modify) | `set_model` with `resume`; shared usage check |
| `worker/agents/core/websocket.test.ts` (new) | `set_model` tests |
| `shared/think.ts` (new) | `RESUME_BUILD_MESSAGE` |
| `worker/api/controllers/capabilities/*` (modify) | Catalog in capabilities |
| `src/api-types.ts` (modify) | Re-export `ThinkModelOption`, `ModelUnavailableNotice` |
| `src/components/ThinkModelPicker.tsx` (new) | Compact model select |
| `src/components/ModelUnavailableNotice.tsx` (new) | Failure card |
| `src/utils/credit-change.ts` and `.test.ts` (new) | Credit wording |
| `src/routes/home.tsx` (modify) | Home picker; `model` parameter |
| `src/routes/chat/*` (modify) | Chat picker, session `modelId`, switching, failure card |
| `src/routes/model-picker-guard.test.ts` (new) | Frontend guards |
| `docs/estori/provisioning.md`, `wrangler.estori.jsonc` (modify) | Describe the confirmed switch |

---

### Task 1: Model catalog

**Files:**
- Modify: `worker/agents/think/model-config.ts`. Add the catalog; the old constants stay until Tasks 2 and 3.
- Modify: `worker/agents/core/features/types.ts`. Add `ThinkModelOption`.
- Create: `worker/agents/think/model-config.test.ts`

**Interfaces:**
- Produces:
  - `interface ThinkModel { id: string; config: AIModelConfig }`
  - `THINK_MODELS: readonly ThinkModel[]`
  - `DEFAULT_THINK_MODEL_ID: string`
  - `isThinkModelId(id: unknown): id is string`
  - `resolveThinkModel(id: unknown): ThinkModel`
  - `fallbackModelFor(model: ThinkModel): ThinkModel`
  - `thinkModelOptions(): ThinkModelOption[]`
  - In `features/types.ts`: `interface ThinkModelOption { id: string; label: string; provider: string; creditCost: number }`

- [ ] **Step 1: Write the failing test**

Create `worker/agents/think/model-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_THINK_MODEL_ID,
	THINK_MODELS,
	fallbackModelFor,
	isThinkModelId,
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
			creditCost: 8,
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/think/model-config.test.ts`

Expected: FAIL. `THINK_MODELS` and the helpers are not exported.

- [ ] **Step 3: Add `ThinkModelOption`**

In `worker/agents/core/features/types.ts`, add directly above `export interface PlatformCapabilities {`:

```ts
/** A model users can pick to build a think app. */
export interface ThinkModelOption {
	/** AI Gateway model id, for example `anthropic/claude-sonnet-5-5`. */
	id: string;
	label: string;
	provider: string;
	/** Credits charged per build step ($0.25 per 1M input tokens = 1 credit). */
	creditCost: number;
}

```

- [ ] **Step 4: Add the catalog**

In `worker/agents/think/model-config.ts`, replace the first line:

```ts
import { ModelSize, type AIModelConfig } from '../inferutils/config.types';
```

with:

```ts
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
```

Leave the existing `THINK_MODEL_ID`, `THINK_MODEL_CONFIG`, `THINK_FALLBACK_MODEL_ID` and `THINK_FALLBACK_MODEL_CONFIG` below this block.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test worker/agents/think/model-config.test.ts`

Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/think/model-config.ts worker/agents/think/model-config.test.ts worker/agents/core/features/types.ts
git commit -m "feat(think): add the build model catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Record provider failures instead of switching models

**Files:**
- Create: `worker/agents/think/model-transport.ts`, `worker/agents/think/model-transport.test.ts`
- Delete: `worker/agents/think/model-fallback.ts`, `worker/agents/think/model-fallback.test.ts`
- Modify: `worker/agents/think/thought-signatures.ts`, `worker/agents/think/thought-signatures.test.ts`
- Modify: `worker/agents/think/ThinkAgent.ts`
- Modify: `worker/agents/core/behaviors/think.ts` (drop the automatic fallback)
- Modify: `worker/agents/think/model-config.ts` (drop `THINK_FALLBACK_MODEL_ID` and `THINK_FALLBACK_MODEL_CONFIG`)

**Interfaces:**
- Produces:
  - `type ProviderFailureReason = 'overloaded' | 'rate_limited' | 'unavailable' | 'timeout'`
  - `interface ProviderFailure { modelId: string; reason: ProviderFailureReason; status?: number; detail?: string }`
  - `classifyProviderStatus(status: number): ProviderFailureReason | null`
  - `createModelTransport({ timeoutMs, prepareBody?, onProviderStatus?, fetchImpl? }): typeof fetch`
  - `ThinkAgent.getProviderFailure(): Promise<ProviderFailure | null>` (RPC)
  - `ThinkAgentConfig.model` no longer has `fallback`.

- [ ] **Step 1: Write the failing transport and signature tests**

Create `worker/agents/think/model-transport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyProviderStatus, createModelTransport, type ProviderFailure } from './model-transport';

const URL = 'https://gateway.ai.cloudflare.com/v1/acct/estori-gateway/compat/chat/completions';

function init(model = 'google-ai-studio/gemini-3.6-flash'): RequestInit {
	return {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }] }),
	};
}

function recorder() {
	const statuses: Array<ProviderFailure | null> = [];
	return { statuses, onProviderStatus: (failure: ProviderFailure | null) => statuses.push(failure) };
}

/** Never resolves until the request's signal aborts, like a provider that hangs. */
function hang(_input: RequestInfo | URL, request?: RequestInit): Promise<Response> {
	return new Promise((_resolve, reject) => {
		request?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
	});
}

describe('classifyProviderStatus', () => {
	it.each([
		[429, 'rate_limited'],
		[503, 'overloaded'],
		[529, 'overloaded'],
		[500, 'unavailable'],
		[502, 'unavailable'],
		[504, 'unavailable'],
		[400, null],
		[200, null],
	])('maps %i to %s', (status, reason) => {
		expect(classifyProviderStatus(status)).toBe(reason);
	});
});

describe('createModelTransport', () => {
	it('passes a successful response through and clears the failure record', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: async () => new Response('ok') });
		const res = await transport(URL, init());
		expect(await res.text()).toBe('ok');
		expect(statuses).toEqual([null]);
	});

	it('runs the body hook on the outgoing body', async () => {
		let sent = '';
		const transport = createModelTransport({
			timeoutMs: 1000,
			prepareBody: (body) => body.replace('"hi"', '"hello"'),
			fetchImpl: async (_input, request) => {
				sent = String(request?.body);
				return new Response('ok');
			},
		});
		await transport(URL, init());
		expect(JSON.parse(sent).messages[0].content).toBe('hello');
	});

	it('records an overloaded provider with its own message and returns the response for retrying', async () => {
		const { statuses, onProviderStatus } = recorder();
		const googleError = JSON.stringify([{ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }]);
		const transport = createModelTransport({
			timeoutMs: 1000,
			onProviderStatus,
			fetchImpl: async () => new Response(googleError, { status: 503 }),
		});
		const res = await transport(URL, init());
		expect(res.status).toBe(503);
		expect(await res.text()).toBe(googleError);
		expect(statuses).toEqual([
			{ modelId: 'google-ai-studio/gemini-3.6-flash', reason: 'overloaded', status: 503, detail: 'This model is currently experiencing high demand.' },
		]);
	});

	it('reads the message from an Anthropic-style error body', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({
			timeoutMs: 1000,
			onProviderStatus,
			fetchImpl: async () => Response.json({ error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 }),
		});
		await transport(URL, init('anthropic/claude-sonnet-5-5'));
		expect(statuses).toEqual([{ modelId: 'anthropic/claude-sonnet-5-5', reason: 'overloaded', status: 529, detail: 'Overloaded' }]);
	});

	it('does not treat a bad request as a provider failure', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: async () => new Response('bad', { status: 400 }) });
		const res = await transport(URL, init());
		expect(res.status).toBe(400);
		expect(statuses).toEqual([null]);
	});

	it('turns a provider that never answers into a retryable 504', async () => {
		const { statuses, onProviderStatus } = recorder();
		const transport = createModelTransport({ timeoutMs: 20, onProviderStatus, fetchImpl: hang });
		const res = await transport(URL, init());
		expect(res.status).toBe(504);
		expect(statuses).toEqual([{ modelId: 'google-ai-studio/gemini-3.6-flash', reason: 'timeout' }]);
	});

	it('rethrows a caller abort without recording a failure', async () => {
		const { statuses, onProviderStatus } = recorder();
		const controller = new AbortController();
		const pending = createModelTransport({ timeoutMs: 1000, onProviderStatus, fetchImpl: hang })(URL, { ...init(), signal: controller.signal });
		controller.abort();
		await expect(pending).rejects.toThrow();
		expect(statuses).toEqual([]);
	});
});
```

In `worker/agents/think/thought-signatures.test.ts`, add inside the `describe` block, after `returns non-JSON bodies unchanged`:

```ts
	it('leaves requests to other providers unchanged', () => {
		const claudeBody = body(call('toolu_1')).replace('google-ai-studio/gemini-3.6-flash', 'anthropic/claude-sonnet-5-5');
		expect(injectThoughtSignatures(claudeBody, new Map([['toolu_1', 'sig-1']]))).toBe(claudeBody);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test worker/agents/think/model-transport.test.ts worker/agents/think/thought-signatures.test.ts`

Expected:
- The transport file fails to load: `./model-transport` does not exist.
- `leaves requests to other providers unchanged` FAILS.

- [ ] **Step 3: Create the transport**

Create `worker/agents/think/model-transport.ts`:

```ts
/**
 * Fetch transport for the build model. It rewrites each body for its target
 * model, ends requests a provider never answers, and records provider failures
 * so the host can offer the user a switch.
 */

export type ProviderFailureReason = 'overloaded' | 'rate_limited' | 'unavailable' | 'timeout';

export interface ProviderFailure {
	/** Gateway model id from the request body. */
	modelId: string;
	reason: ProviderFailureReason;
	status?: number;
	/** The provider's own message, when it sent one. */
	detail?: string;
}

export interface ModelTransportOptions {
	/** How long to wait for response headers before treating the provider as failed. */
	timeoutMs: number;
	/** Rewrites each outgoing body for its target model. */
	prepareBody?: (body: string) => string;
	/** Called after every answered request: the failure, or null when the provider responded normally. */
	onProviderStatus?: (failure: ProviderFailure | null) => void;
	fetchImpl?: typeof fetch;
}

export function classifyProviderStatus(status: number): ProviderFailureReason | null {
	if (status === 429) return 'rate_limited';
	if (status === 503 || status === 529) return 'overloaded';
	if (status >= 500) return 'unavailable';
	return null;
}

export function createModelTransport(options: ModelTransportOptions): typeof fetch {
	const { timeoutMs, prepareBody, onProviderStatus } = options;
	const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init));

	return async (input, init) => {
		const body = init?.body;
		const modelId = (typeof body === 'string' ? modelOf(body) : undefined) ?? 'unknown';
		const prepared: RequestInit = {
			...(init ?? {}),
			body: typeof body === 'string' && prepareBody ? prepareBody(body) : body,
		};

		const attempt = await fetchWithTimeout(fetchImpl, input, prepared, timeoutMs);
		if (attempt.kind === 'timeout') {
			onProviderStatus?.({ modelId, reason: 'timeout' });
			return Response.json(
				{ error: { message: `The model did not respond within ${Math.round(timeoutMs / 1000)} seconds` } },
				{ status: 504 },
			);
		}

		const reason = classifyProviderStatus(attempt.response.status);
		if (!reason) {
			onProviderStatus?.(null);
			return attempt.response;
		}
		const detail = await providerMessage(attempt.response.clone());
		onProviderStatus?.({ modelId, reason, status: attempt.response.status, ...(detail ? { detail } : {}) });
		return attempt.response;
	};
}

type Attempt = { kind: 'response'; response: Response } | { kind: 'timeout' };

/**
 * Runs the request, aborting it if no response headers arrive in time.
 * A caller abort is rethrown; only the timeout becomes a failure.
 */
async function fetchWithTimeout(
	fetchImpl: typeof fetch,
	input: RequestInfo | URL,
	init: RequestInit,
	timeoutMs: number,
): Promise<Attempt> {
	const controller = new AbortController();
	const callerSignal = init.signal;
	const forwardAbort = () => controller.abort(callerSignal?.reason);
	if (callerSignal?.aborted) forwardAbort();
	callerSignal?.addEventListener('abort', forwardAbort, { once: true });

	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	try {
		const response = await fetchImpl(input, { ...init, signal: controller.signal });
		return { kind: 'response', response };
	} catch (error) {
		if (timedOut && !callerSignal?.aborted) return { kind: 'timeout' };
		throw error;
	} finally {
		// The abort forwarding stays attached: it must keep cancelling the response stream.
		clearTimeout(timer);
	}
}

function modelOf(body: string): string | undefined {
	try {
		const model = (JSON.parse(body) as { model?: unknown }).model;
		return typeof model === 'string' ? model : undefined;
	} catch {
		return undefined;
	}
}

/** The `error.message` a provider sent (Google wraps it in an array), shortened for display. */
async function providerMessage(response: Response): Promise<string | undefined> {
	let parsed: unknown;
	try {
		parsed = await response.json();
	} catch {
		return undefined;
	}
	const root: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
	const message = (root as { error?: { message?: unknown } } | undefined)?.error?.message;
	return typeof message === 'string' ? message.slice(0, 300) : undefined;
}
```

Delete the old module and its test:

```bash
git rm -q worker/agents/think/model-fallback.ts worker/agents/think/model-fallback.test.ts
```

- [ ] **Step 4: Make signature injection Google-only**

In `worker/agents/think/thought-signatures.ts`, replace:

```ts
	let json: { messages?: unknown };
	try {
		json = JSON.parse(bodyText);
	} catch {
		return bodyText;
	}
	const messages = json.messages;
```

with:

```ts
	let json: { model?: unknown; messages?: unknown };
	try {
		json = JSON.parse(bodyText);
	} catch {
		return bodyText;
	}
	if (typeof json.model !== 'string' || !json.model.startsWith('google-ai-studio/')) return bodyText;
	const messages = json.messages;
```

In the doc comment of `injectThoughtSignatures`, replace `Bodies that are not chat-completions JSON` with `Bodies that are not chat-completions JSON for a Google model`.

- [ ] **Step 5: Wire the transport into ThinkAgent**

In `worker/agents/think/ThinkAgent.ts`:

Replace:

```ts
import { createFallbackFetch, FallbackLatch, type ModelFallback } from './model-fallback';
```

with:

```ts
import { createModelTransport, type ProviderFailure } from './model-transport';
```

Replace:

```ts
/** How long the primary model may take to start responding before the fallback takes over. */
const PRIMARY_RESPONSE_TIMEOUT_MS = 60_000;

/** Retries per turn after the first attempt; covers overload spikes when no fallback answers. */
const TURN_MAX_RETRIES = 4;
```

with:

```ts
/** How long a provider may take to start responding before the request counts as failed. */
const MODEL_RESPONSE_TIMEOUT_MS = 60_000;

/** Retries per turn after the first attempt (about 6 seconds of backoff) before the user is asked. */
const TURN_MAX_RETRIES = 2;
```

In `ThinkAgentConfig.model`, delete:

```ts
		/** Second model on the same gateway, used when the primary is overloaded or unresponsive. */
		fallback?: ModelFallback;
```

Replace:

```ts
	/** Once the primary model fails in a turn, the rest of that turn stays on the fallback. */
	private readonly fallbackLatch = new FallbackLatch();
```

with:

```ts
	/** Last provider failure in the current turn; the host reads it when a turn fails. */
	private providerFailure: ProviderFailure | null = null;
```

Replace:

```ts
		// (4) re-send to the fallback model when the primary is overloaded. The
		// signatures are Gemini-only, so the fallback request goes without them.
		const transport = createFallbackFetch({
			fallback: model.fallback,
			latch: this.fallbackLatch,
			primaryTimeoutMs: PRIMARY_RESPONSE_TIMEOUT_MS,
			preparePrimaryBody: (body) => injectThoughtSignatures(body, this.thoughtSignatures),
			onFallback: (reason) =>
				console.warn('Think model fallback', { from: model.modelName, to: model.fallback?.modelName, reason }),
		});
```

with:

```ts
		// (4) end requests a provider never answers and record provider
		// failures, so the host can offer the user a switch.
		const transport = createModelTransport({
			timeoutMs: MODEL_RESPONSE_TIMEOUT_MS,
			prepareBody: (body) => injectThoughtSignatures(body, this.thoughtSignatures),
			onProviderStatus: (failure) => {
				this.providerFailure = failure;
			},
		});
```

In `beforeTurn`, replace:

```ts
		this.fallbackLatch.reset();
```

with:

```ts
		this.providerFailure = null;
```

Directly after the closing brace of `async configureVibe(config: ThinkAgentConfig): Promise<void> { ... }`, add:

```ts

	/** RPC for the host: the provider failure behind the last failed turn, if any. */
	async getProviderFailure(): Promise<ProviderFailure | null> {
		return this.providerFailure;
	}
```

- [ ] **Step 6: Drop the automatic fallback from the host and the catalog**

In `worker/agents/core/behaviors/think.ts`:

Replace:

```ts
import {
	THINK_FALLBACK_MODEL_CONFIG,
	THINK_FALLBACK_MODEL_ID,
	THINK_MODEL_CONFIG,
	THINK_MODEL_ID,
} from '../../think/model-config';
```

with:

```ts
import { THINK_MODEL_CONFIG, THINK_MODEL_ID } from '../../think/model-config';
```

Delete the two import lines:

```ts
import type { ModelFallback } from '../../think/model-fallback';
import type { InferenceContext } from '../../inferutils/config.types';
```

In `configureThinkAgent`, delete the line:

```ts
				fallback: await this.resolveThinkFallback(userId, inf, gatewayToken),
```

Delete the whole `resolveThinkFallback` method, including its doc comment, which starts "Claude fallback for turns the primary model can't serve".

In `worker/agents/think/model-config.ts`, delete the doc comment `/** Used when the primary model is overloaded; enabled by \`ENABLE_THINK_MODEL_FALLBACK\`. */`, `THINK_FALLBACK_MODEL_ID`, and `THINK_FALLBACK_MODEL_CONFIG`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun run test worker/agents/think/model-transport.test.ts worker/agents/think/thought-signatures.test.ts worker/agents/think/model-config.test.ts`

Expected: 15 + 7 + 7 tests PASS. The transport count is 8 `classifyProviderStatus` cases plus 7 transport tests.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

Run: `grep -rn "model-fallback\|FallbackLatch\|createFallbackFetch\|THINK_FALLBACK_MODEL" worker src; echo "exit=$?"`

Expected: no matches, `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add worker/agents/think/model-transport.ts worker/agents/think/model-transport.test.ts worker/agents/think/thought-signatures.ts worker/agents/think/thought-signatures.test.ts worker/agents/think/ThinkAgent.ts worker/agents/core/behaviors/think.ts worker/agents/think/model-config.ts
git commit -m "feat(think): record provider failures instead of switching models silently" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The `git rm` from Step 3 is already staged.

---

### Task 3: Each app builds with its selected model

**Files:**
- Modify: `worker/agents/think/model-config.ts` (remove `THINK_MODEL_ID`, `THINK_MODEL_CONFIG`)
- Modify: `worker/agents/core/state.ts`, `worker/agents/core/types.ts`
- Modify: `worker/api/controllers/agent/types.ts`, `worker/api/controllers/agent/controller.ts`
- Modify: `worker/agents/core/behaviors/think.ts`
- Modify: `worker/agents/think/ThinkAgent.ts`
- Create: `worker/agents/think/model-wiring.test.ts`

**Interfaces:**
- Consumes: `resolveThinkModel`, `isThinkModelId` (Task 1).
- Produces:
  - `ThinkState.thinkModelId?: string`
  - `ThinkAgentInitArgs.thinkModelId?: string`
  - `CodeGenArgs.modelId?: string`
  - `ThinkCodingBehavior.setModel(modelId: string): Promise<void>`. On failure it restores the previous id and rejects.

- [ ] **Step 1: Write the failing guard test**

Create `worker/agents/think/model-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/think/ThinkAgent.ts',
		'/worker/agents/think/model-config.ts',
		'/worker/api/controllers/agent/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('think model wiring', () => {
	it("configures the agent from the app's selected model", () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		expect(behavior).toContain('resolveThinkModel(this.state.thinkModelId)');
		expect(behavior).not.toMatch(/THINK_MODEL_ID|THINK_MODEL_CONFIG/);
	});

	it('stores the requested model when a think app is created', () => {
		const controller = source('/worker/api/controllers/agent/controller.ts');
		expect(controller).toContain('resolveThinkModel(body.modelId)');
		expect(controller).toContain('thinkModelId: thinkModel.id');
	});

	it("charges the configured model's credit cost per step", () => {
		expect(source('/worker/agents/think/ThinkAgent.ts')).toContain('resolveThinkModel(config.model.modelName).config.creditCost');
	});

	it('keeps the catalog as the only model list', () => {
		expect(source('/worker/agents/think/model-config.ts')).not.toMatch(/THINK_MODEL_ID|THINK_MODEL_CONFIG/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/think/model-wiring.test.ts`

Expected: 4 tests FAIL.

- [ ] **Step 3: Remove the old constants**

In `worker/agents/think/model-config.ts`, delete the `THINK_MODEL_ID` and `THINK_MODEL_CONFIG` declarations below `requireThinkModel`.

- [ ] **Step 4: Add the state, init-arg and request fields**

In `worker/agents/core/state.ts`, inside `export interface ThinkState extends BaseProjectState {`, add after `thinkAgentName: string;`:

```ts
    /** Build model chosen for this app (a THINK_MODELS id); absent for apps created before model selection. */
    thinkModelId?: string;
```

In `worker/agents/core/types.ts`, replace:

```ts
/** Think agent initialization arguments — same shape as agentic */
interface ThinkAgentInitArgs extends BaseAgentInitArgs {
    templateInfo?: {
        templateDetails: TemplateDetails;
        selection: TemplateSelection;
    };
}
```

with:

```ts
/** Think agent initialization arguments — agentic shape plus the chosen build model */
interface ThinkAgentInitArgs extends BaseAgentInitArgs {
    templateInfo?: {
        templateDetails: TemplateDetails;
        selection: TemplateSelection;
    };
    /** Catalog id of the build model (already resolved by the caller). */
    thinkModelId?: string;
}
```

In `worker/api/controllers/agent/types.ts`, inside `export interface CodeGenArgs {`, add after `images?: ImageAttachment[];`:

```ts
    /** Build model for think apps (a THINK_MODELS id); unknown values use the default. */
    modelId?: string;
```

- [ ] **Step 5: Resolve the model in the controller**

In `worker/api/controllers/agent/controller.ts`, add to the imports:

```ts
import { isThinkModelId, resolveThinkModel } from '../../../agents/think/model-config';
```

Replace:

```ts
            const initArgs = isThink
                ? baseInitArgs
                : { ...baseInitArgs, templateInfo: { templateDetails: templateResult!.templateDetails, selection: templateResult!.selection } };
```

with:

```ts
            const thinkModel = resolveThinkModel(body.modelId);
            if (isThink && body.modelId !== undefined && !isThinkModelId(body.modelId)) {
                this.logger.warn('Unknown build model requested; using the default', { requested: body.modelId, used: thinkModel.id });
            }

            const initArgs = isThink
                ? { ...baseInitArgs, thinkModelId: thinkModel.id }
                : { ...baseInitArgs, templateInfo: { templateDetails: templateResult!.templateDetails, selection: templateResult!.selection } };
```

- [ ] **Step 6: Configure the agent from the selected model, and add `setModel`**

In `worker/agents/core/behaviors/think.ts`:

Replace:

```ts
import { THINK_MODEL_CONFIG, THINK_MODEL_ID } from '../../think/model-config';
```

with:

```ts
import { resolveThinkModel } from '../../think/model-config';
```

In `initialize`, replace:

```ts
		const { query, hostname, inferenceContext, sandboxSessionId } = initArgs;
```

with:

```ts
		const { query, hostname, inferenceContext, sandboxSessionId, thinkModelId } = initArgs;
```

and in its `this.setState({` call replace:

```ts
			thinkAgentName: agentName,
			currentBranch: 'main',
		});
```

with:

```ts
			thinkAgentName: agentName,
			thinkModelId,
			currentBranch: 'main',
		});
```

Replace the start of `configureThinkAgent`:

```ts
	private async configureThinkAgent(): Promise<void> {
		const inf = this.getInferenceContext();
		const userId = this.state.metadata.userId;

		const modelName = THINK_MODEL_ID;
		const aiModelConfig = THINK_MODEL_CONFIG;
```

with:

```ts
	/** Pushes the app's selected model to the ThinkAgent; returns whether it was applied. */
	private async configureThinkAgent(): Promise<boolean> {
		const inf = this.getInferenceContext();
		const userId = this.state.metadata.userId;

		const selected = resolveThinkModel(this.state.thinkModelId);
		const modelName = selected.id;
		const aiModelConfig = selected.config;
```

In the same method, replace:

```ts
			this.logger.warn('Failed to resolve model gateway config for ThinkAgent', e);
			return;
		}
```

with:

```ts
			this.logger.warn('Failed to resolve model gateway config for ThinkAgent', e);
			return false;
		}
```

and replace:

```ts
		try {
			const stub = await this.getThinkStub();
			await stub.configureVibe(config);
		} catch (e) {
			this.logger.warn('ThinkAgent.configureVibe failed (continuing)', e);
		}
	}
```

with:

```ts
		try {
			const stub = await this.getThinkStub();
			await stub.configureVibe(config);
			return true;
		} catch (e) {
			this.logger.warn('ThinkAgent.configureVibe failed (continuing)', e);
			return false;
		}
	}

	/**
	 * Switches the build model for this app's next turns. The caller validates
	 * the id; if the agent cannot be reconfigured the previous choice is kept.
	 */
	async setModel(modelId: string): Promise<void> {
		const previous = this.state.thinkModelId;
		this.setState({ ...this.state, thinkModelId: modelId });
		if (!(await this.configureThinkAgent())) {
			this.setState({ ...this.state, thinkModelId: previous });
			throw new Error('the agent could not be reconfigured');
		}
	}
```

- [ ] **Step 7: Charge the configured model's credit cost**

In `worker/agents/think/ThinkAgent.ts`, replace:

```ts
import { THINK_MODEL_CONFIG } from './model-config';
```

with:

```ts
import { resolveThinkModel } from './model-config';
```

and replace:

```ts
				{ creditCost: THINK_MODEL_CONFIG.creditCost, throwOnExceeded: false },
```

with:

```ts
				{ creditCost: resolveThinkModel(config.model.modelName).config.creditCost, throwOnExceeded: false },
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `bun run test worker/agents/think/model-wiring.test.ts worker/agents/think/model-config.test.ts`

Expected: 4 + 7 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

- [ ] **Step 9: Commit**

```bash
git add worker/agents/think/model-config.ts worker/agents/core/state.ts worker/agents/core/types.ts worker/api/controllers/agent/types.ts worker/api/controllers/agent/controller.ts worker/agents/core/behaviors/think.ts worker/agents/think/ThinkAgent.ts worker/agents/think/model-wiring.test.ts
git commit -m "feat(think): build each app with its selected model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Report provider failures to the chat

**Files:**
- Modify: `worker/agents/think/model-config.ts` (notice type and builder)
- Modify: `worker/agents/think/model-config.test.ts`
- Modify: `worker/api/websocketTypes.ts`, `worker/agents/constants.ts`
- Modify: `worker/agents/core/behaviors/think.ts` (stub type, `runPrompt`, build loop, `reportTurnError`)
- Modify: `worker/agents/think/model-wiring.test.ts`
- Modify: `wrangler.estori.jsonc` (the comment only), `docs/estori/provisioning.md`

**Interfaces:**
- Consumes:
  - `ProviderFailure` and `ThinkAgent.getProviderFailure()` (Task 2).
  - `fallbackModelFor`, `resolveThinkModel` (Task 1).
- Produces:
  - `interface ModelUnavailableNotice { modelId: string; reason: ProviderFailureReason; status?: number; detail?: string; alternativeModelId?: string }`
  - `modelUnavailableNotice(failure: ProviderFailure, offerAlternative: boolean): ModelUnavailableNotice`
  - The WebSocket message `{ type: 'model_unavailable' } & ModelUnavailableNotice`.
  - `WebSocketMessageResponses.MODEL_UNAVAILABLE`.

- [ ] **Step 1: Write the failing tests**

In `worker/agents/think/model-config.test.ts`, add `modelUnavailableNotice` to the import list and append:

```ts
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
```

In `worker/agents/think/model-wiring.test.ts`, append inside the `describe` block:

```ts
	it('reports failed turns through the provider failure check', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		expect(behavior).toContain('stub.getProviderFailure()');
		expect(behavior).toContain('WebSocketMessageResponses.MODEL_UNAVAILABLE');
		expect(behavior.match(/await this\.reportTurnError\(/g) ?? []).toHaveLength(2);
	});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test worker/agents/think/model-config.test.ts worker/agents/think/model-wiring.test.ts`

Expected: the 3 notice tests FAIL (`modelUnavailableNotice` is not exported), and `reports failed turns through the provider failure check` FAILS.

- [ ] **Step 3: Add the notice builder**

In `worker/agents/think/model-config.ts`, add after the existing imports:

```ts
import type { ProviderFailure, ProviderFailureReason } from './model-transport';
```

and append at the end of the file:

```ts
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
```

- [ ] **Step 4: Declare the message**

In `worker/agents/constants.ts`, inside `WebSocketMessageResponses`, replace:

```ts
    // Vault messages
    VAULT_REQUIRED: 'vault_required',
```

with:

```ts
    // Vault messages
    VAULT_REQUIRED: 'vault_required',

    // Build model provider failure (think only)
    MODEL_UNAVAILABLE: 'model_unavailable',
```

In `worker/api/websocketTypes.ts`, add to the imports at the top:

```ts
import type { ModelUnavailableNotice } from '../agents/think/model-config';
```

Add after the `type VaultRequiredMessage = { ... };` declaration:

```ts

type ModelUnavailableMessage = { type: 'model_unavailable' } & ModelUnavailableNotice;
```

and in the `export type WebSocketMessage =` union, replace:

```ts
	| VaultRequiredMessage;
```

with:

```ts
	| VaultRequiredMessage
	| ModelUnavailableMessage;
```

- [ ] **Step 5: Report failed turns in the host**

In `worker/agents/core/behaviors/think.ts`:

Replace:

```ts
import { resolveThinkModel } from '../../think/model-config';
```

with:

```ts
import { modelUnavailableNotice, resolveThinkModel } from '../../think/model-config';
import type { ProviderFailure } from '../../think/model-transport';
```

In `type ThinkAgentStub = {`, replace:

```ts
	clearMessages: () => Promise<void>;
};
```

with:

```ts
	clearMessages: () => Promise<void>;
	getProviderFailure: () => Promise<ProviderFailure | null>;
};
```

In `build()`, replace:

```ts
			} catch (e) {
				this.logger.error('Think prompt failed', e);
				this.broadcast(WebSocketMessageResponses.ERROR, {
					error: e instanceof Error ? e.message : String(e),
				});
				break;
			}
```

with:

```ts
			} catch (e) {
				this.logger.error('Think prompt failed', e);
				await this.reportTurnError(e instanceof Error ? e.message : String(e));
				break;
			}
```

In `runPrompt`, replace:

```ts
		const forwarder = new ThinkStreamForwarder(
```

with:

```ts
		let turnError: string | undefined;
		const forwarder = new ThinkStreamForwarder(
```

and replace:

```ts
			(err) => this.broadcast(WebSocketMessageResponses.ERROR, { error: err }),
		);
```

with:

```ts
			(err) => {
				turnError = err;
			},
		);
```

At the end of `runPrompt`, replace:

```ts
			if (accumulated.text) {
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
					message: accumulated.text,
					conversationId,
					isStreaming: false,
				});
			}
		}
	}
```

with:

```ts
			if (accumulated.text) {
				this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
					message: accumulated.text,
					conversationId,
					isStreaming: false,
				});
			}
		}
		if (turnError !== undefined) {
			await this.reportTurnError(turnError);
		}
	}

	/**
	 * Reports a failed turn. A provider failure becomes a `model_unavailable`
	 * card that can offer a switch; anything else stays a plain error.
	 */
	private async reportTurnError(error: string): Promise<void> {
		const failure = await this.getThinkStub()
			.then((stub) => stub.getProviderFailure())
			.catch(() => null);
		if (!failure) {
			this.broadcast(WebSocketMessageResponses.ERROR, { error });
			return;
		}
		const flags = this.env as unknown as { ENABLE_THINK_MODEL_FALLBACK?: string };
		this.broadcast(
			WebSocketMessageResponses.MODEL_UNAVAILABLE,
			modelUnavailableNotice(failure, flags.ENABLE_THINK_MODEL_FALLBACK === 'true'),
		);
	}
```

- [ ] **Step 6: Update the config comment and the runbook**

In `wrangler.estori.jsonc`, replace:

```jsonc
		// Re-send overloaded Gemini requests to Claude through the gateway (provider keys stored in the gateway).
```

with:

```jsonc
		// Offer switching to the other provider's model when the build model's provider fails (keys stored in the gateway).
```

In `docs/estori/provisioning.md`, replace the paragraph starting `The build agent falls back from Gemini to Claude Sonnet 5.5` with:

```markdown
Users pick the build model (Gemini 3.6 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5 or Claude Opus 5.5). When its provider fails, the chat offers switching to the other provider's model, with the credits per step (`ENABLE_THINK_MODEL_FALLBACK` in `wrangler.estori.jsonc`). Both provider keys live only in the gateway: AI Gateway → `estori-gateway` → Provider Keys. If either stored key is removed, set `ENABLE_THINK_MODEL_FALLBACK` to `"false"` so the chat stops offering a model that would fail with 401.
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `bun run test worker/agents/think/model-config.test.ts worker/agents/think/model-wiring.test.ts scripts/estori-config.test.ts`

Expected: 10 + 5 + 6 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

- [ ] **Step 8: Commit**

```bash
git add worker/agents/think/model-config.ts worker/agents/think/model-config.test.ts worker/api/websocketTypes.ts worker/agents/constants.ts worker/agents/core/behaviors/think.ts worker/agents/think/model-wiring.test.ts wrangler.estori.jsonc docs/estori/provisioning.md
git commit -m "feat(think): report provider failures to the chat with a switch offer" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `set_model` over the agent WebSocket, with resume

**Files:**
- Create: `shared/think.ts`
- Modify: `worker/agents/constants.ts`, `worker/agents/core/websocket.ts`
- Create: `worker/agents/core/websocket.test.ts`

**Interfaces:**
- Consumes: `isThinkModelId` (Task 1); `ThinkCodingBehavior.setModel` (Task 3).
- Produces:
  - `RESUME_BUILD_MESSAGE` from `shared/think.ts`.
  - `WebSocketMessageRequests.SET_MODEL`.
  - `handleWebSocketMessage(agent, connection, message, usageCheck = checkUsageAndBalance)`. The fourth parameter exists for tests.

- [ ] **Step 1: Write the failing test**

Create `worker/agents/core/websocket.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Connection } from 'agents';
import { handleWebSocketMessage } from './websocket';
import type { CodeGeneratorAgent } from './codingAgent';
import type { checkUsageAndBalance } from '../../services/rate-limit';
import { RESUME_BUILD_MESSAGE } from '../../../shared/think';

interface FakeBehavior {
	setModel?: (modelId: string) => Promise<void>;
}

const allowAll = (async () => ({ allowed: true })) as unknown as typeof checkUsageAndBalance;

function fakes(behavior: FakeBehavior) {
	const sent: Array<{ type: string; error?: string }> = [];
	const calls: string[] = [];
	const connection = { id: 'c1', url: 'wss://estori.app/ws', send: (data: string) => sent.push(JSON.parse(data)) } as unknown as Connection;
	const agent = {
		getBehavior: () => behavior,
		state: { metadata: { userId: 'u1' } },
		env: {},
		setState: () => undefined,
		handleUserInput: async (message: string) => void calls.push(`input:${message}`),
	} as unknown as CodeGeneratorAgent;
	return { sent, calls, connection, agent };
}

function setModel(modelId: string | undefined, resume?: boolean): string {
	return JSON.stringify({ type: 'set_model', ...(modelId ? { modelId } : {}), ...(resume ? { resume } : {}) });
}

describe('set_model', () => {
	it('switches the app to a catalog model', async () => {
		const switched: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async (id) => void switched.push(id) });
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5'), allowAll);
		expect(switched).toEqual(['anthropic/claude-opus-5-5']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('resumes the build after switching when asked', async () => {
		const order: string[] = [];
		const { agent, connection, calls } = fakes({ setModel: async (id) => void order.push(`model:${id}`) });
		await handleWebSocketMessage(agent, connection, setModel('google-ai-studio/gemini-3.6-flash', true), allowAll);
		expect([...order, ...calls]).toEqual(['model:google-ai-studio/gemini-3.6-flash', `input:${RESUME_BUILD_MESSAGE}`]);
	});

	it('rejects ids outside the catalog', async () => {
		const switched: string[] = [];
		const { agent, connection, sent } = fakes({ setModel: async (id) => void switched.push(id) });
		await handleWebSocketMessage(agent, connection, setModel('openai/gpt-9'), allowAll);
		await handleWebSocketMessage(agent, connection, setModel(undefined), allowAll);
		expect(switched).toEqual([]);
		expect(sent).toEqual([
			{ type: 'error', error: 'Unknown model' },
			{ type: 'error', error: 'Unknown model' },
		]);
	});

	it('reports apps that cannot change models', async () => {
		const { agent, connection, sent } = fakes({});
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5'), allowAll);
		expect(sent).toEqual([{ type: 'error', error: 'Model selection is not supported for this app' }]);
	});

	it('reports a failed switch and does not resume', async () => {
		const { agent, connection, sent, calls } = fakes({
			setModel: async () => {
				throw new Error('the agent could not be reconfigured');
			},
		});
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), allowAll);
		expect(sent).toEqual([{ type: 'error', error: 'Could not switch model: the agent could not be reconfigured' }]);
		expect(calls).toEqual([]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/core/websocket.test.ts`

Expected: FAIL. `../../../shared/think` does not exist.

If the file fails to load for any other reason (an import-time error in a module the handler imports), stop and report NEEDS_CONTEXT with the error.

- [ ] **Step 3: Add the resume message**

Create `shared/think.ts`:

```ts
/** Sent as a user message to continue a build after a provider failure. */
export const RESUME_BUILD_MESSAGE = 'Continue where you left off.';
```

- [ ] **Step 4: Add the request type**

In `worker/agents/constants.ts`, inside `WebSocketMessageRequests`, replace:

```ts
    // Restore a prior commit (think/SpaceDO only)
    ROLLBACK_TO_COMMIT: 'rollback_to_commit',
```

with:

```ts
    // Restore a prior commit (think/SpaceDO only)
    ROLLBACK_TO_COMMIT: 'rollback_to_commit',

    // Switch the build model, optionally resuming the build (think only)
    SET_MODEL: 'set_model',
```

- [ ] **Step 5: Extract the usage check and handle `set_model`**

In `worker/agents/core/websocket.ts`:

Add to the imports:

```ts
import { isThinkModelId } from '../think/model-config';
import { RESUME_BUILD_MESSAGE } from '../../../shared/think';
```

In `interface IncomingWebSocketMessage {`, add after `commitHash?: string;`:

```ts
    modelId?: string;
    resume?: boolean;
```

Replace the signature:

```ts
export async function handleWebSocketMessage(
    agent: CodeGeneratorAgent, 
    connection: Connection, 
    message: string
): Promise<void> {
```

with:

```ts
export async function handleWebSocketMessage(
    agent: CodeGeneratorAgent, 
    connection: Connection, 
    message: string,
    usageCheck: typeof checkUsageAndBalance = checkUsageAndBalance,
): Promise<void> {
```

In `case WebSocketMessageRequests.USER_SUGGESTION:`, replace the whole block from the comment `// Check usage limits before processing user suggestion` through the closing brace of its `catch` (the one ending with `showAsPopup: true,` / `});` / `return;` / `}`) with:

```ts
                if (!(await ensureCanPrompt(agent, connection, usageCheck))) {
                    return;
                }
```

Add this case directly after the closing `}` of `case WebSocketMessageRequests.ROLLBACK_TO_COMMIT: { ... }`:

```ts
            case WebSocketMessageRequests.SET_MODEL: {
                const modelId = parsedMessage.modelId;
                if (!isThinkModelId(modelId)) {
                    sendError(connection, 'Unknown model');
                    return;
                }
                const behavior = agent.getBehavior() as unknown as {
                    setModel?: (modelId: string) => Promise<void>;
                };
                if (typeof behavior.setModel !== 'function') {
                    sendError(connection, 'Model selection is not supported for this app');
                    return;
                }
                logger.info('Switching build model', { modelId, resume: parsedMessage.resume === true });
                try {
                    await behavior.setModel(modelId);
                } catch (error) {
                    sendError(connection, `Could not switch model: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                }
                if (parsedMessage.resume === true) {
                    if (!(await ensureCanPrompt(agent, connection, usageCheck))) {
                        return;
                    }
                    agent.handleUserInput(RESUME_BUILD_MESSAGE).catch((error: unknown) => {
                        logger.error('Error resuming after model switch:', error);
                        sendError(connection, `Error processing user suggestion: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
                break;
            }
```

Add this function directly before `export function handleWebSocketClose(`. Its body is the block removed from `USER_SUGGESTION`, with `return;` changed to `return false;`, `checkUsageAndBalance` changed to `usageCheck`, and `return true;` at the end:

```ts
/**
 * Runs the usage check for a new prompt. Sends the limit popup or error and
 * returns false when the user may not prompt.
 */
async function ensureCanPrompt(
    agent: CodeGeneratorAgent,
    connection: Connection,
    usageCheck: typeof checkUsageAndBalance,
): Promise<boolean> {
    try {
        const env = agent.env;
        const userId = agent.state.metadata.userId;

        // The encrypted blob was captured from the HttpOnly cookie at WS
        // upgrade time (see codingAgent.onConnect) and stored in DO state.
        // WS frames do not carry cookies, so we rely on that snapshot.
        const userToken = agent.state.cloudflareToken || null;

        // Check limits and balance (this may transparently refresh the token).
        const wsOrigin = agent.state.wsOrigin || undefined;
        const limitResult = await usageCheck(env, userId, undefined, userToken, wsOrigin);

        // If a refresh occurred, keep the DO-cached blob fresh so subsequent
        // user_suggestion messages pick up the new access token.
        if (limitResult.refreshedBlob) {
            agent.setState({ ...agent.state, cloudflareToken: limitResult.refreshedBlob });
        }

        if (!limitResult.allowed) {
            logger.warn('User suggestion blocked by usage check', {
                userId,
                reason: limitResult.reason,
                withinLimits: limitResult.withinLimits,
                remaining: limitResult.remaining,
                hasUserToken: limitResult.hasUserToken,
                balance: limitResult.balance,
            });

            // Send structured error for frontend to show as popup
            sendToConnection(connection, WebSocketMessageResponses.ERROR, {
                error: limitResult.reason,
                code: 'USAGE_LIMIT_EXCEEDED',
                showAsPopup: true,
            });
            return false;
        }
    } catch (error) {
        logger.error('Failed to check usage:', error);
        sendToConnection(connection, WebSocketMessageResponses.ERROR, {
            error: `Error processing request: ${error instanceof Error ? error.message : String(error)}`,
            showAsPopup: true,
        });
        return false;
    }
    return true;
}

```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun run test worker/agents/core/websocket.test.ts`

Expected: 5 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"` and `bun run lint 2>&1 | tail -3`

Expected: no TypeScript lines, `exit=1`; lint reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add shared/think.ts worker/agents/constants.ts worker/agents/core/websocket.ts worker/agents/core/websocket.test.ts
git commit -m "feat(think): switch the build model over the agent websocket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Capabilities expose the catalog

**Files:**
- Modify: `worker/agents/core/features/types.ts`
- Modify: `worker/api/controllers/capabilities/controller.ts`, `worker/api/controllers/capabilities/controller.test.ts`
- Modify: `src/api-types.ts`

**Interfaces:**
- Consumes: `thinkModelOptions()`, `DEFAULT_THINK_MODEL_ID`, `ThinkModelOption` (Task 1); `ModelUnavailableNotice` (Task 4).
- Produces:
  - `PlatformCapabilities.thinkModels: ThinkModelOption[]` and `PlatformCapabilities.defaultThinkModel: string`.
  - `ThinkModelOption` and `ModelUnavailableNotice` exported from `@/api-types`.

- [ ] **Step 1: Write the failing test**

In `worker/api/controllers/capabilities/controller.test.ts`, add inside the `describe` block:

```ts
	it('offers the build models, their credits and the default', async () => {
		const capabilities = await capabilitiesFor({});
		expect(capabilities.thinkModels.map((model) => model.id)).toEqual([
			'google-ai-studio/gemini-3.6-flash',
			'google-ai-studio/gemini-3.8-flash',
			'anthropic/claude-sonnet-5-5',
			'anthropic/claude-opus-5-5',
		]);
		expect(capabilities.thinkModels[3]).toEqual({ id: 'anthropic/claude-opus-5-5', label: 'Claude Opus 5.5', provider: 'anthropic', creditCost: 16 });
		expect(capabilities.defaultThinkModel).toBe('anthropic/claude-sonnet-5-5');
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts`

Expected: FAIL. `capabilities.thinkModels` is undefined, so `.map` throws a TypeError.

- [ ] **Step 3: Add and return the fields**

In `worker/agents/core/features/types.ts`, inside `export interface PlatformCapabilities {`, add after the `artifacts: boolean;` member:

```ts

	/** Models users can pick to build think apps, in display order. */
	thinkModels: ThinkModelOption[];

	/** Model preselected for a new build (one of `thinkModels`). */
	defaultThinkModel: string;
```

In `worker/api/controllers/capabilities/controller.ts`, add to the imports:

```ts
import { DEFAULT_THINK_MODEL_ID, thinkModelOptions } from '../../../agents/think/model-config';
```

and replace:

```ts
			artifacts: env.ENABLE_ARTIFACTS === 'true',
		};
```

with:

```ts
			artifacts: env.ENABLE_ARTIFACTS === 'true',
			thinkModels: thinkModelOptions(),
			defaultThinkModel: DEFAULT_THINK_MODEL_ID,
		};
```

In `src/api-types.ts`, replace:

```ts
  PlatformCapabilities,
  PlatformCapabilitiesConfig,
} from 'worker/agents/core/features/types';
```

with:

```ts
  PlatformCapabilities,
  PlatformCapabilitiesConfig,
  ThinkModelOption,
} from 'worker/agents/core/features/types';

export type { ModelUnavailableNotice } from 'worker/agents/think/model-config';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts`

Expected: 4 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/core/features/types.ts worker/api/controllers/capabilities/controller.ts worker/api/controllers/capabilities/controller.test.ts src/api-types.ts
git commit -m "feat(think): expose the build models in platform capabilities" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Picker component and the home prompt

**Files:**
- Create: `src/components/ThinkModelPicker.tsx`
- Modify: `src/routes/home.tsx`
- Create: `src/routes/model-picker-guard.test.ts`

**Interfaces:**
- Consumes:
  - `capabilities.thinkModels`, `capabilities.defaultThinkModel`, `ThinkModelOption` (Task 6).
  - `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select`.
  - `cn` from `@cloudflare/kumo`.
- Produces: `ThinkModelPicker({ options, value, onChange, disabled?, className? })`, and the `&model=<id>` parameter on `/chat/new`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/model-picker-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/ThinkModelPicker.tsx',
		'/src/routes/home.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('model picker: component', () => {
	it('renders nothing when no models are offered', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('if (options.length === 0) return null;');
	});

	it('shows the placeholder when no model is selected', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('placeholder="Select model"');
	});
});

describe('model picker: home prompt', () => {
	it('renders the picker on the home prompt', () => {
		expect(source('/src/routes/home.tsx')).toMatch(/<ThinkModelPicker\b/);
	});

	it('sends the chosen model only when one is set', () => {
		expect(source('/src/routes/home.tsx')).toContain(
			"const modelParam = mode === 'app' && modelId ? `&model=${encodeURIComponent(modelId)}` : '';",
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/routes/model-picker-guard.test.ts`

Expected: FAIL with `Source not found: /src/components/ThinkModelPicker.tsx`.

- [ ] **Step 3: Create the picker**

Create `src/components/ThinkModelPicker.tsx`:

```tsx
import { cn } from '@cloudflare/kumo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ThinkModelOption } from '@/api-types';

interface ThinkModelPickerProps {
	options: ThinkModelOption[];
	/** Selected model id; an empty string shows the placeholder. */
	value: string;
	onChange: (modelId: string) => void;
	disabled?: boolean;
	className?: string;
}

/** Compact choice of the model that builds the app. */
export function ThinkModelPicker({ options, value, onChange, disabled = false, className }: ThinkModelPickerProps) {
	if (options.length === 0) return null;

	return (
		<Select value={value} onValueChange={onChange} disabled={disabled}>
			<SelectTrigger
				aria-label="Model"
				className={cn('h-8 w-auto gap-1.5 border-none bg-transparent px-2 text-sm shadow-none', className)}
			>
				<SelectValue placeholder="Select model" />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option.id} value={option.id}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
```

- [ ] **Step 4: Add the picker to the home prompt**

In `src/routes/home.tsx`, add to the imports:

```ts
import { ThinkModelPicker } from '@/components/ThinkModelPicker';
```

Replace:

```ts
	const [query, setQuery] = useState('');
```

with:

```ts
	const [query, setQuery] = useState('');
	const [modelId, setModelId] = useState('');
```

Directly after the statement `const { isLoadingCapabilities, capabilities, getEnabledFeatures } = useFeature();`, add:

```ts
	useEffect(() => {
		if (!modelId && capabilities?.defaultThinkModel) {
			setModelId(capabilities.defaultThinkModel);
		}
	}, [capabilities, modelId]);
```

In `handleCreateApp`, replace:

```ts
		const intendedUrl = `/chat/new?query=${encodedQuery}&projectType=${encodedMode}${behaviorParam}${imageParam}`;
```

with:

```ts
		const modelParam = mode === 'app' && modelId ? `&model=${encodeURIComponent(modelId)}` : '';
		const intendedUrl = `/chat/new?query=${encodedQuery}&projectType=${encodedMode}${behaviorParam}${modelParam}${imageParam}`;
```

Replace the home `PromptBox` `leftActions` prop:

```tsx
							leftActions={
								showModeSelector ? (
									<ProjectModeSelector
										value={projectMode}
										onChange={setProjectMode}
										modes={modeOptions}
									/>
								) : undefined
							}
```

with:

```tsx
							leftActions={
								<div className="flex items-center gap-2">
									{showModeSelector && (
										<ProjectModeSelector
											value={projectMode}
											onChange={setProjectMode}
											modes={modeOptions}
										/>
									)}
									<ThinkModelPicker
										options={capabilities?.thinkModels ?? []}
										value={modelId}
										onChange={setModelId}
									/>
								</div>
							}
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `bun run test src/routes/model-picker-guard.test.ts`

Expected: 4 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"` and `bun run lint 2>&1 | tail -3`

Expected: no TypeScript lines, `exit=1`; lint reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/ThinkModelPicker.tsx src/routes/home.tsx src/routes/model-picker-guard.test.ts
git commit -m "feat(think): pick the build model on the home prompt" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Picker in the chat, session creation and switching

**Files:**
- Modify: `src/routes/chat/components/chat-input.tsx`
- Modify: `src/routes/chat/hooks/use-chat.ts`
- Modify: `src/routes/chat/utils/handle-websocket-message.ts`
- Modify: `src/routes/chat/chat.tsx`
- Modify: `src/routes/model-picker-guard.test.ts`

**Interfaces:**
- Consumes:
  - `ThinkModelPicker` (Task 7).
  - `capabilities.thinkModels` (Task 6).
  - `CodeGenArgs.modelId` and `ThinkState.thinkModelId` (Task 3).
  - The `set_model` request (Task 5).
- Produces:
  - `useChat({ modelId })`.
  - `useChat().thinkModelId: string` and `useChat().selectThinkModel(modelId: string): void`.
  - `HandleMessageDeps.setThinkModelId`.
  - `ChatInput` prop `leftActions?: ReactNode`.

- [ ] **Step 1: Extend the failing guard test**

In `src/routes/model-picker-guard.test.ts`, replace the glob list:

```ts
	[
		'/src/components/ThinkModelPicker.tsx',
		'/src/routes/home.tsx',
	],
```

with:

```ts
	[
		'/src/components/ThinkModelPicker.tsx',
		'/src/routes/home.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/chat-input.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
	],
```

and append:

```ts
describe('model picker: chat', () => {
	it('renders the picker in the chat input for think apps', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toMatch(/<ThinkModelPicker\b/);
		expect(chat).toContain("searchParams.get('model')");
		expect(source('/src/routes/chat/components/chat-input.tsx')).toContain('leftActions={leftActions}');
	});

	it('creates the session with the chosen model', () => {
		expect(source('/src/routes/chat/hooks/use-chat.ts')).toMatch(/createAgentSession\(\{[^}]*\bmodelId\b/);
	});

	it('switches models over the agent websocket', () => {
		expect(source('/src/routes/chat/hooks/use-chat.ts')).toContain("sendWebSocketMessage(websocket, 'set_model', { modelId })");
	});

	it('syncs the selected model from agent state, including apps without one', () => {
		const handler = source('/src/routes/chat/utils/handle-websocket-message.ts');
		expect(handler.match(/setThinkModelId\(state\.thinkModelId \?\? ''\)/g) ?? []).toHaveLength(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/routes/model-picker-guard.test.ts`

Expected: the 4 new tests FAIL; the 4 from Task 7 PASS.

- [ ] **Step 3: Let the chat input take left actions**

In `src/routes/chat/components/chat-input.tsx`, in `interface ChatInputProps`, add after `aboveContent?: ReactNode;`:

```ts
	/** Controls shown at the left of the input, such as the model picker. */
	leftActions?: ReactNode;
```

In the `ChatInput` parameter destructuring, replace:

```ts
	aboveContent,
}: ChatInputProps) {
```

with:

```ts
	aboveContent,
	leftActions,
}: ChatInputProps) {
```

In the returned `PromptBox`, replace:

```tsx
			rightActions={stopButton}
```

with:

```tsx
			leftActions={leftActions}
			rightActions={stopButton}
```

- [ ] **Step 4: Track and switch the model in `useChat`**

In `src/routes/chat/hooks/use-chat.ts`:

Replace:

```ts
	behaviorType: explicitBehaviorType,
	autoStart = true,
```

with:

```ts
	behaviorType: explicitBehaviorType,
	modelId,
	autoStart = true,
```

Replace:

```ts
	behaviorType?: BehaviorType;
	/**
	 * Whether a brand-new session may be created automatically on mount.
```

with:

```ts
	behaviorType?: BehaviorType;
	/** Build model for a new think session (a capabilities `thinkModels` id). */
	modelId?: string;
	/**
	 * Whether a brand-new session may be created automatically on mount.
```

Replace:

```ts
	const [cloudflareDeploymentUrl, setCloudflareDeploymentUrl] = useState<string>('');
```

with:

```ts
	const [cloudflareDeploymentUrl, setCloudflareDeploymentUrl] = useState<string>('');
	const [thinkModelId, setThinkModelId] = useState<string>('');
```

In the `createWebSocketMessageHandler({` deps object, replace:

```ts
			setCloudflareDeploymentUrl,
			setDeploymentError,
```

with:

```ts
			setCloudflareDeploymentUrl,
			setThinkModelId,
			setDeploymentError,
```

Replace:

```ts
						behaviorType: explicitBehaviorType,
						images: userImages, // Pass images from URL params for multi-modal blueprint
```

with:

```ts
						behaviorType: explicitBehaviorType,
						modelId,
						images: userImages, // Pass images from URL params for multi-modal blueprint
```

In that effect's dependency array, replace:

```ts
	}, [
		projectType,
		explicitBehaviorType,
```

with:

```ts
	}, [
		projectType,
		explicitBehaviorType,
		modelId,
```

Directly before `const submitClarifyingAnswers = useCallback(`, add:

```ts
	const selectThinkModel = useCallback((modelId: string) => {
		if (sendWebSocketMessage(websocket, 'set_model', { modelId })) {
			setThinkModelId(modelId);
		}
	}, [websocket]);

```

In the returned object, replace:

```ts
		cloudflareDeploymentUrl,
		deploymentError,
```

with:

```ts
		cloudflareDeploymentUrl,
		thinkModelId,
		selectThinkModel,
		deploymentError,
```

- [ ] **Step 5: Sync the model from agent state**

In `src/routes/chat/utils/handle-websocket-message.ts`:

In `export interface HandleMessageDeps`, replace:

```ts
    setCloudflareDeploymentUrl: React.Dispatch<React.SetStateAction<string>>;
```

with:

```ts
    setCloudflareDeploymentUrl: React.Dispatch<React.SetStateAction<string>>;
    setThinkModelId: React.Dispatch<React.SetStateAction<string>>;
```

In the destructuring of `deps` inside `createWebSocketMessageHandler`, replace:

```ts
            setCloudflareDeploymentUrl,
            setDeploymentError,
```

with:

```ts
            setCloudflareDeploymentUrl,
            setThinkModelId,
            setDeploymentError,
```

In `case 'agent_connected': {`, replace:

```ts
                const { state, templateDetails, previewUrl } = message;
```

with:

```ts
                const { state, templateDetails, previewUrl } = message;
                if (state.behaviorType === 'think') {
                    setThinkModelId(state.thinkModelId ?? '');
                }
```

In `case 'cf_agent_state': {`, replace:

```ts
                if (state.behaviorType === 'think' && state.cloudflareDeploymentUrl) {
                    setCloudflareDeploymentUrl(state.cloudflareDeploymentUrl);
                }
```

with:

```ts
                if (state.behaviorType === 'think' && state.cloudflareDeploymentUrl) {
                    setCloudflareDeploymentUrl(state.cloudflareDeploymentUrl);
                }
                if (state.behaviorType === 'think') {
                    setThinkModelId(state.thinkModelId ?? '');
                }
```

- [ ] **Step 6: Wire the chat route**

In `src/routes/chat/chat.tsx`, add to the imports:

```ts
import { ThinkModelPicker } from '@/components/ThinkModelPicker';
```

Replace:

```ts
	const urlBehaviorType = searchParams.get(
		'behaviorType',
	) as BehaviorType | null;
```

with:

```ts
	const urlBehaviorType = searchParams.get(
		'behaviorType',
	) as BehaviorType | null;
	const urlModelId = searchParams.get('model') ?? undefined;
```

In the `useChat({` call arguments, replace:

```ts
		behaviorType: urlBehaviorType ?? undefined,
		autoStart,
```

with:

```ts
		behaviorType: urlBehaviorType ?? undefined,
		modelId: urlModelId,
		autoStart,
```

In the `const { ... } = useChat({` destructuring, add `thinkModelId,` and `selectThinkModel,` directly after `dismissClarifyingQuestions,`.

In the `<ChatInput` element, replace:

```tsx
							aboveContent={
								<ClarifyingQuestionsPopup
```

with:

```tsx
							leftActions={
								behaviorType === 'think' ? (
									<ThinkModelPicker
										options={capabilities?.thinkModels ?? []}
										value={thinkModelId}
										onChange={selectThinkModel}
										disabled={!websocket}
									/>
								) : undefined
							}
							aboveContent={
								<ClarifyingQuestionsPopup
```

`capabilities` is already in scope in `ChatSession` as `const { capabilities } = useFeature();`.

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `bun run test src/routes/model-picker-guard.test.ts src/brand/brand-guard.test.ts`

Expected: 8 guard tests PASS, and the brand guard passes.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"` and `bun run lint 2>&1 | tail -3`

Expected: no TypeScript lines, `exit=1`; lint reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/chat/components/chat-input.tsx src/routes/chat/hooks/use-chat.ts src/routes/chat/utils/handle-websocket-message.ts src/routes/chat/chat.tsx src/routes/model-picker-guard.test.ts
git commit -m "feat(think): pick and switch the build model in the chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The provider failure card

**Files:**
- Create: `src/utils/credit-change.ts`, `src/utils/credit-change.test.ts`
- Create: `src/components/ModelUnavailableNotice.tsx`
- Modify: `src/routes/chat/hooks/use-chat.ts`
- Modify: `src/routes/chat/utils/handle-websocket-message.ts`
- Modify: `src/routes/chat/chat.tsx`
- Modify: `src/routes/model-picker-guard.test.ts`

**Interfaces:**
- Consumes:
  - `ModelUnavailableNotice` and `ThinkModelOption` from `@/api-types` (Task 6).
  - `model_unavailable` messages (Task 4).
  - `set_model` with `resume` (Task 5).
  - `RESUME_BUILD_MESSAGE` (Task 5).
  - `thinkModelId`/`setThinkModelId` (Task 8).
- Produces:
  - `describeCreditChange(current: number, next: number): string`.
  - The `ModelUnavailableNotice` component (the file's default-free named export `ModelUnavailableNotice`).
  - `useChat()` returns `modelUnavailable`, `switchModelAndResume`, `retryModel` and `dismissModelUnavailable`.

- [ ] **Step 1: Write the failing tests**

Create `src/utils/credit-change.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeCreditChange } from './credit-change';

describe('describeCreditChange', () => {
	it('shows how many times more a step costs', () => {
		expect(describeCreditChange(3, 8)).toBe('8 credits per step instead of 3 (about 2.7x)');
		expect(describeCreditChange(3, 16)).toBe('16 credits per step instead of 3 (about 5.3x)');
	});

	it('shows the saving when the alternative is cheaper', () => {
		expect(describeCreditChange(8, 3)).toBe('3 credits per step instead of 8 (about 63% cheaper)');
		expect(describeCreditChange(16, 3)).toBe('3 credits per step instead of 16 (about 81% cheaper)');
	});

	it('states equal costs plainly', () => {
		expect(describeCreditChange(3, 3)).toBe('3 credits per step instead of 3');
	});
});
```

In `src/routes/model-picker-guard.test.ts`, add `'/src/components/ModelUnavailableNotice.tsx',` to the glob list after `'/src/components/ThinkModelPicker.tsx',`, and append:

```ts
describe('model picker: provider failure card', () => {
	it('stores model_unavailable messages for the card', () => {
		expect(source('/src/routes/chat/utils/handle-websocket-message.ts')).toContain("case 'model_unavailable':");
	});

	it('switches with resume and retries with the resume message', () => {
		const hook = source('/src/routes/chat/hooks/use-chat.ts');
		expect(hook).toContain("sendWebSocketMessage(websocket, 'set_model', { modelId, resume: true })");
		expect(hook).toContain("sendWebSocketMessage(websocket, 'user_suggestion', { message: RESUME_BUILD_MESSAGE })");
	});

	it('shows the card above the chat input', () => {
		expect(source('/src/routes/chat/chat.tsx')).toMatch(/<ModelUnavailableNotice\b/);
	});

	it('names the price change when offering a switch', () => {
		expect(source('/src/components/ModelUnavailableNotice.tsx')).toContain('describeCreditChange(failed.creditCost, alternative.creditCost)');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test src/utils/credit-change.test.ts src/routes/model-picker-guard.test.ts`

Expected:
- `credit-change.test.ts` fails to load: `./credit-change` does not exist.
- The guard fails with `Source not found: /src/components/ModelUnavailableNotice.tsx`.

- [ ] **Step 3: Add the credit wording**

Create `src/utils/credit-change.ts`:

```ts
/** Describes a per-step credit change, for example "8 credits per step instead of 3 (about 2.7x)". */
export function describeCreditChange(current: number, next: number): string {
	const base = `${next} credits per step instead of ${current}`;
	if (current <= 0 || next === current) return base;
	if (next > current) return `${base} (about ${Math.round((next / current) * 10) / 10}x)`;
	return `${base} (about ${Math.round((1 - next / current) * 100)}% cheaper)`;
}
```

- [ ] **Step 4: Create the card**

Create `src/components/ModelUnavailableNotice.tsx`:

```tsx
import { Button } from '@/components/ui/button';
import type { ModelUnavailableNotice as Notice, ThinkModelOption } from '@/api-types';
import { describeCreditChange } from '@/utils/credit-change';

const PROVIDER_NAMES: Record<string, string> = {
	'google-ai-studio': 'Google',
	anthropic: 'Anthropic',
};

function reasonText(reason: Notice['reason'], provider: string): string {
	switch (reason) {
		case 'overloaded':
			return `${provider} reports high demand`;
		case 'rate_limited':
			return `${provider} rate limit or quota was reached`;
		case 'unavailable':
			return `${provider} returned an error`;
		case 'timeout':
			return `${provider} did not respond within 60 seconds`;
	}
}

interface ModelUnavailableNoticeProps {
	notice: Notice | null;
	options: ThinkModelOption[];
	onSwitch: (modelId: string) => void;
	onRetry: () => void;
	onDismiss: () => void;
}

/** Explains a build model provider failure and offers to switch or retry. */
export function ModelUnavailableNotice({ notice, options, onSwitch, onRetry, onDismiss }: ModelUnavailableNoticeProps) {
	if (!notice) return null;

	const failed = options.find((option) => option.id === notice.modelId);
	const alternative = options.find((option) => option.id === notice.alternativeModelId);
	const provider = PROVIDER_NAMES[failed?.provider ?? ''] ?? 'The provider';
	const status = notice.status ? ` (${notice.status})` : '';

	return (
		<div role="alert" className="mb-2 rounded-lg border border-kumo-line bg-kumo-elevated p-3 text-sm">
			<p className="font-medium text-kumo-strong">{failed?.label ?? notice.modelId} is unavailable</p>
			<p className="mt-1 text-kumo-subtle">
				{reasonText(notice.reason, provider)}
				{status}.
			</p>
			{notice.detail && <p className="mt-1 text-xs text-kumo-subtle">{notice.detail}</p>}
			<div className="mt-3 flex flex-wrap items-center gap-2">
				{alternative && (
					<Button size="sm" onClick={() => onSwitch(alternative.id)}>
						Switch to {alternative.label}
					</Button>
				)}
				<Button size="sm" variant="outline" onClick={onRetry}>
					Try again
				</Button>
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</Button>
			</div>
			{alternative && failed && (
				<p className="mt-2 text-xs text-kumo-subtle">
					{alternative.label} uses {describeCreditChange(failed.creditCost, alternative.creditCost)}.
				</p>
			)}
		</div>
	);
}
```

- [ ] **Step 5: Store the notice and add the actions in `useChat`**

In `src/routes/chat/hooks/use-chat.ts`:

Add to the imports:

```ts
import type { ModelUnavailableNotice } from '@/api-types';
import { RESUME_BUILD_MESSAGE } from '../../../../shared/think';
```

Replace:

```ts
	const [thinkModelId, setThinkModelId] = useState<string>('');
```

with:

```ts
	const [thinkModelId, setThinkModelId] = useState<string>('');
	const [modelUnavailable, setModelUnavailable] = useState<ModelUnavailableNotice | null>(null);
```

In the `createWebSocketMessageHandler({` deps object, replace:

```ts
			setThinkModelId,
			setDeploymentError,
```

with:

```ts
			setThinkModelId,
			setModelUnavailable,
			setDeploymentError,
```

Directly before `const submitClarifyingAnswers = useCallback(`, after `selectThinkModel`, add:

```ts
	const switchModelAndResume = useCallback((modelId: string) => {
		if (sendWebSocketMessage(websocket, 'set_model', { modelId, resume: true })) {
			setThinkModelId(modelId);
			sendUserMessage(RESUME_BUILD_MESSAGE);
			setModelUnavailable(null);
		}
	}, [websocket, sendUserMessage]);

	const retryModel = useCallback(() => {
		if (sendWebSocketMessage(websocket, 'user_suggestion', { message: RESUME_BUILD_MESSAGE })) {
			sendUserMessage(RESUME_BUILD_MESSAGE);
			setModelUnavailable(null);
		}
	}, [websocket, sendUserMessage]);

	const dismissModelUnavailable = useCallback(() => {
		setModelUnavailable(null);
	}, []);

```

In the returned object, replace:

```ts
		thinkModelId,
		selectThinkModel,
```

with:

```ts
		thinkModelId,
		selectThinkModel,
		modelUnavailable,
		switchModelAndResume,
		retryModel,
		dismissModelUnavailable,
```

- [ ] **Step 6: Handle `model_unavailable`**

In `src/routes/chat/utils/handle-websocket-message.ts`:

Add to the imports from `@/api-types` (or add an import if there is none):

```ts
import type { ModelUnavailableNotice } from '@/api-types';
```

In `export interface HandleMessageDeps`, replace:

```ts
    setThinkModelId: React.Dispatch<React.SetStateAction<string>>;
```

with:

```ts
    setThinkModelId: React.Dispatch<React.SetStateAction<string>>;
    setModelUnavailable: React.Dispatch<React.SetStateAction<ModelUnavailableNotice | null>>;
```

In the deps destructuring, replace:

```ts
            setThinkModelId,
            setDeploymentError,
```

with:

```ts
            setThinkModelId,
            setModelUnavailable,
            setDeploymentError,
```

Add this case directly before `case 'error': {`:

```ts
            case 'model_unavailable': {
                setModelUnavailable({
                    modelId: message.modelId,
                    reason: message.reason,
                    status: message.status,
                    detail: message.detail,
                    alternativeModelId: message.alternativeModelId,
                });
                break;
            }
```

- [ ] **Step 7: Show the card in the chat**

In `src/routes/chat/chat.tsx`, add to the imports:

```ts
import { ModelUnavailableNotice } from '@/components/ModelUnavailableNotice';
```

In the `const { ... } = useChat({` destructuring, add after `selectThinkModel,`:

```ts
		modelUnavailable,
		switchModelAndResume,
		retryModel,
		dismissModelUnavailable,
```

In the `<ChatInput` element, replace:

```tsx
							aboveContent={
								<ClarifyingQuestionsPopup
									questions={clarifyingQuestions ?? []}
									open={
										clarifyingQuestions !== null &&
										clarifyingQuestions.length > 0
									}
									onSubmit={submitClarifyingAnswers}
									onDismiss={dismissClarifyingQuestions}
								/>
							}
```

with:

```tsx
							aboveContent={
								<>
									<ModelUnavailableNotice
										notice={modelUnavailable}
										options={capabilities?.thinkModels ?? []}
										onSwitch={switchModelAndResume}
										onRetry={retryModel}
										onDismiss={dismissModelUnavailable}
									/>
									<ClarifyingQuestionsPopup
										questions={clarifyingQuestions ?? []}
										open={
											clarifyingQuestions !== null &&
											clarifyingQuestions.length > 0
										}
										onSubmit={submitClarifyingAnswers}
										onDismiss={dismissClarifyingQuestions}
									/>
								</>
							}
```

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `bun run test src/utils/credit-change.test.ts src/routes/model-picker-guard.test.ts src/brand/brand-guard.test.ts`

Expected: 3 + 12 tests PASS, and the brand guard passes.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"` and `bun run lint 2>&1 | tail -3`

Expected: no TypeScript lines, `exit=1`; lint reports 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/utils/credit-change.ts src/utils/credit-change.test.ts src/components/ModelUnavailableNotice.tsx src/routes/chat/hooks/use-chat.ts src/routes/chat/utils/handle-websocket-message.ts src/routes/chat/chat.tsx src/routes/model-picker-guard.test.ts
git commit -m "feat(think): ask before switching models when a provider fails" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Deploy and live checks (owner approves)

**Files:** none, unless a check fails. Fixes then follow TDD in their own commits.

**Interfaces:**
- Consumes: Tasks 1–9 committed.
- Produces: the picker and the failure card live on estori.app.

- [ ] **Step 1: Release (owner go-ahead to push)**

Run:

```bash
git push origin claude/project-analysis-local-setup-dfd834
git push origin HEAD:refs/heads/estori-live
```

The owner approves the `production` environment on the run (Review deployments → `production` → Approve and deploy).

Expected: the gate is green, the deploy succeeds, and the smoke test passes `health`, `capabilities` and `preview-host`.

- [ ] **Step 2: Capabilities in production**

Using the Access service token headers (`CF-Access-Client-Id`, `CF-Access-Client-Secret`, the bare values), fetch `https://estori.app/api/capabilities` and read `data.thinkModels` and `data.defaultThinkModel`.

Expected:
- Four models in catalog order, with credits 3, 3, 8 and 16.
- Default `anthropic/claude-sonnet-5-5`.

- [ ] **Step 3: Owner checks in the browser (Review Focus 1–5)**

The owner, signed in on estori.app:
- Sees Claude Sonnet 5.5 preselected on the home prompt, picks Gemini 3.6 Flash, and starts a build.
- If Gemini fails, sees the card. It names Google's reason, offers "Switch to Claude Sonnet 5.5" with "8 credits per step instead of 3 (about 2.7x)", and offers "Try again". The owner switches, and the build continues on Sonnet.
- Opens an app created before this deploy. Its picker shows `Select model`.
- Opens one app in two tabs, switches to Claude Opus 5.5 in one, and sees the other tab update.

- [ ] **Step 4: Confirm in the AI Gateway log**

Read the latest `estori-gateway` log entries, using the read-only logs API with the deploy token.

Expected:
- Requests use the models picked in Step 3.
- After a switch, the resumed turn's requests use the new model, and there is no 400 `thought_signature` error.
- The model is never switched without the owner pressing Switch.

Record each check as pass or fail in the ledger.
