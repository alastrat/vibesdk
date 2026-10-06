# Think Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every Estori user pick the model that builds their app, on the home prompt for a new build and from the chat input for later messages.

**Architecture:**
- One catalog of build models in `worker/agents/think/model-config.ts` drives four things:
  - the capabilities response the frontend reads;
  - the model a new app is configured with;
  - a new `set_model` WebSocket request that reconfigures an existing app;
  - the cross-provider fallback.
- Gemini thought signatures are added to whichever request goes to a Google model, so either provider can be primary or fallback.
- The frontend adds one compact `ThinkModelPicker` component, used by the home prompt and the chat input.

**Tech Stack:**
- Cloudflare Workers and Durable Objects.
- `@cloudflare/think`, with the AI SDK's OpenAI-compatible provider over AI Gateway.
- React 19, React Router 7, Radix Select.
- Vitest in `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-06-think-model-picker-design.md`

## Global Constraints

- Catalog ids, labels and credits:

  | Id | Label | Credits |
  |---|---|---|
  | `google-ai-studio/gemini-3.6-flash` | Gemini 3.6 Flash | 3 |
  | `google-ai-studio/gemini-3.8-flash` | Gemini 3.8 Flash | 3 |
  | `anthropic/claude-sonnet-5-5` | Claude Sonnet 5.5 | 8 |
  | `anthropic/claude-opus-5-5` | Claude Opus 5.5 | 16 |

- Default model: `anthropic/claude-sonnet-5-5`.
- Fallback pairing: Google models fall back to `anthropic/claude-sonnet-5-5`; Anthropic models fall back to `google-ai-studio/gemini-3.6-flash`.
- WebSocket request: `{ "type": "set_model", "modelId": "<id>" }`.
- WebSocket error strings, used verbatim:
  - `Unknown model`
  - `Model selection is not supported for this app`
  - `Could not switch model: <message>`
- The picker placeholder text is `Select model`.
- No `any`. No emojis. Frontend imports types from `@/api-types`. React components are `PascalCase.tsx`.
- Test command for files: `bun run test <path> [<path>...]`.
- `bun run typecheck` locally reports 4 pre-existing errors in `packages/artifacts-viewer`; any other error is a failure.
- Commit subjects are lowercase, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Stage by explicit path.
- Running many test files at once on macOS can leave orphaned `workerd` processes that exhaust ports (EADDRNOTAVAIL). Run the task's own test files, not the whole suite. The CI gate runs the full suite on Linux.

## Review Focus

1. **An app created before this change** (no `thinkModelId` in state) is opened in the chat. Its picker must show the `Select model` placeholder, not a model it isn't using. Picking a model must work. Task 7's guard pins the empty-string sync.
2. **A model is switched while a build turn is running.** The running turn finishes on its model, and the next message uses the new one. This is not unit-testable; Task 8 checks it live in the AI Gateway logs.
3. **Two tabs on the same app.** Switching in one tab updates the picker in the other, through the `cf_agent_state` broadcast. Task 7's guard pins the `cf_agent_state` sync.
4. **Capabilities fail to load** (`capabilities` is null). The home prompt still creates apps without a `model` parameter, so the server uses the default. The pickers render nothing. Task 6 pins both.
5. **An unknown or tampered `model` URL parameter**, for example `?model=foo`. The server builds with the default and logs a warning. Task 1 pins the resolution and Task 3 pins the controller wiring.

---

## File Structure

| File | Responsibility |
|---|---|
| `worker/agents/think/model-config.ts` (rewrite) | Catalog of build models, default, fallback pairing, capability options |
| `worker/agents/think/model-config.test.ts` (new) | Catalog tests |
| `worker/agents/core/features/types.ts` (modify) | `ThinkModelOption`; `PlatformCapabilities.thinkModels` and `defaultThinkModel` |
| `worker/agents/think/thought-signatures.ts` (modify) | Inject signatures only into Google-bound requests |
| `worker/agents/think/model-fallback.ts` (modify) | `prepareBody` runs on primary and fallback requests |
| `worker/agents/think/ThinkAgent.ts` (modify) | Wire `prepareBody`; per-model credit cost |
| `worker/agents/core/state.ts` (modify) | `ThinkState.thinkModelId` |
| `worker/agents/core/types.ts` (modify) | `ThinkAgentInitArgs.thinkModelId` |
| `worker/api/controllers/agent/types.ts` (modify) | `CodeGenArgs.modelId` |
| `worker/api/controllers/agent/controller.ts` (modify) | Resolve the requested model for think apps |
| `worker/agents/core/behaviors/think.ts` (modify) | Configure from the selected model; cross-provider fallback; `setModel` |
| `worker/agents/think/model-wiring.test.ts` (new) | Source guards for the server wiring |
| `worker/agents/constants.ts` (modify) | `SET_MODEL` request |
| `worker/agents/core/websocket.ts` (modify) | Handle `set_model` |
| `worker/agents/core/websocket.test.ts` (new) | `set_model` handler tests |
| `worker/api/controllers/capabilities/controller.ts` (modify) | Return the catalog and default |
| `worker/api/controllers/capabilities/controller.test.ts` (modify) | Capabilities test |
| `src/api-types.ts` (modify) | Re-export `ThinkModelOption` |
| `src/components/ThinkModelPicker.tsx` (new) | Compact model select |
| `src/routes/home.tsx` (modify) | Picker on the home prompt; `model` URL parameter |
| `src/routes/chat/chat.tsx` (modify) | Read `model`; picker in the chat input |
| `src/routes/chat/components/chat-input.tsx` (modify) | `leftActions` prop |
| `src/routes/chat/hooks/use-chat.ts` (modify) | `modelId` on create; `thinkModelId` state; `selectThinkModel` |
| `src/routes/chat/utils/handle-websocket-message.ts` (modify) | Sync `thinkModelId` from agent state |
| `src/routes/model-picker-guard.test.ts` (new) | Frontend source guards |

---

### Task 1: Model catalog

**Files:**
- Modify: `worker/agents/think/model-config.ts` (add the catalog; the old constants stay until Task 3)
- Modify: `worker/agents/core/features/types.ts` (add `ThinkModelOption`)
- Create: `worker/agents/think/model-config.test.ts`

**Interfaces:**
- Consumes: `AIModelConfig`, `ModelSize` from `worker/agents/inferutils/config.types.ts`.
- Produces:
  - `interface ThinkModel { id: string; config: AIModelConfig }`
  - `THINK_MODELS: readonly ThinkModel[]`
  - `DEFAULT_THINK_MODEL_ID: string`
  - `isThinkModelId(id: unknown): id is string`
  - `resolveThinkModel(id: unknown): ThinkModel`
  - `fallbackModelFor(model: ThinkModel): ThinkModel`
  - `thinkModelOptions(): ThinkModelOption[]`
  - In `features/types.ts`: `interface ThinkModelOption { id: string; label: string; provider: string }`

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

	it('falls back across providers and never to the selected model', () => {
		const pairs = THINK_MODELS.map((model) => [model.id, fallbackModelFor(model).id]);
		expect(pairs).toEqual([
			['google-ai-studio/gemini-3.6-flash', 'anthropic/claude-sonnet-5-5'],
			['google-ai-studio/gemini-3.8-flash', 'anthropic/claude-sonnet-5-5'],
			['anthropic/claude-sonnet-5-5', 'google-ai-studio/gemini-3.6-flash'],
			['anthropic/claude-opus-5-5', 'google-ai-studio/gemini-3.6-flash'],
		]);
	});

	it('exposes id, label and provider for the picker', () => {
		expect(thinkModelOptions()[2]).toEqual({
			id: 'anthropic/claude-sonnet-5-5',
			label: 'Claude Sonnet 5.5',
			provider: 'anthropic',
		});
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/think/model-config.test.ts`

Expected: FAIL. The module does not export `THINK_MODELS`, `DEFAULT_THINK_MODEL_ID`, `fallbackModelFor`, `isThinkModelId`, `resolveThinkModel` or `thinkModelOptions`.

- [ ] **Step 3: Add `ThinkModelOption`**

In `worker/agents/core/features/types.ts`, add directly above `export interface PlatformCapabilities {`:

```ts
/** A model users can pick to build a think app. */
export interface ThinkModelOption {
	/** AI Gateway model id, for example `anthropic/claude-sonnet-5-5`. */
	id: string;
	label: string;
	provider: string;
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

/** Fallback crosses providers so one provider's overload does not stall a build. */
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
	return THINK_MODELS.map((model) => ({ id: model.id, label: model.config.name, provider: model.config.provider }));
}

function requireThinkModel(id: string): ThinkModel {
	const model = THINK_MODELS.find((candidate) => candidate.id === id);
	if (!model) throw new Error(`Think model ${id} is missing from THINK_MODELS`);
	return model;
}
```

Leave `THINK_MODEL_ID`, `THINK_MODEL_CONFIG`, `THINK_FALLBACK_MODEL_ID` and `THINK_FALLBACK_MODEL_CONFIG` in place below this block. Task 3 removes them.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test worker/agents/think/model-config.test.ts`

Expected: 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/think/model-config.ts worker/agents/think/model-config.test.ts worker/agents/core/features/types.ts
git commit -m "feat(think): add the build model catalog" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Gemini signatures on whichever request goes to Google

**Files:**
- Modify: `worker/agents/think/thought-signatures.ts`
- Modify: `worker/agents/think/thought-signatures.test.ts`
- Modify: `worker/agents/think/model-fallback.ts`
- Modify: `worker/agents/think/model-fallback.test.ts`
- Modify: `worker/agents/think/ThinkAgent.ts` (the `createFallbackFetch` call in `getModel()`)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `FallbackFetchOptions.prepareBody?: (body: string) => string`. It runs on the primary body and on the fallback body after its `model` is set. It replaces `preparePrimaryBody`.
  - `injectThoughtSignatures(bodyText, signatures)` returns the body unchanged unless its `model` starts with `google-ai-studio/`.

- [ ] **Step 1: Write the failing tests**

In `worker/agents/think/thought-signatures.test.ts`, add this test inside the `describe` block, after `returns non-JSON bodies unchanged`:

```ts
	it('leaves requests to other providers unchanged', () => {
		const claudeBody = body(call('toolu_1')).replace('google-ai-studio/gemini-3.6-flash', 'anthropic/claude-sonnet-5-5');
		expect(injectThoughtSignatures(claudeBody, new Map([['toolu_1', 'sig-1']]))).toBe(claudeBody);
	});
```

In `worker/agents/think/model-fallback.test.ts`, replace the whole test `applies primary-only body changes to the primary request but not to the fallback` (the `it(...)` block that defines `preparePrimaryBody` returning `extra_content`) with:

```ts
	it('runs the body hook on both requests, each with its own model', async () => {
		const { impl, seen } = fakeFetch([
			() => new Response('overloaded', { status: 503 }),
			() => new Response('fallback', { status: 200 }),
		]);
		const hookModels: string[] = [];
		const prepareBody = (body: string) => {
			const json = JSON.parse(body) as { model: string };
			hookModels.push(json.model);
			return JSON.stringify({ ...json, prepared_for: json.model });
		};
		await createFallbackFetch({ fallback: FALLBACK, primaryTimeoutMs: 1000, prepareBody, fetchImpl: impl })(URL, primaryInit());
		expect(hookModels).toEqual(['google-ai-studio/gemini-3.6-flash', 'anthropic/claude-opus-5-5']);
		expect(seen[0].body).toHaveProperty('prepared_for', 'google-ai-studio/gemini-3.6-flash');
		expect(seen[1].body).toHaveProperty('prepared_for', 'anthropic/claude-opus-5-5');
	});
```

In the same file, in the test `changes nothing about the request when no fallback is configured`, rename both occurrences of `preparePrimaryBody` to `prepareBody`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test worker/agents/think/thought-signatures.test.ts worker/agents/think/model-fallback.test.ts`

Expected:
- `leaves requests to other providers unchanged` FAILS, because the placeholder is injected.
- `runs the body hook on both requests, each with its own model` FAILS, because the hook is never called: `prepareBody` is not an option yet.
- `changes nothing about the request when no fallback is configured` FAILS, because the body is not rewritten.

- [ ] **Step 3: Make signature injection Google-only**

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

Then, in the doc comment of `injectThoughtSignatures`, replace `Bodies that are not chat-completions JSON` with `Bodies that are not chat-completions JSON for a Google model`.

- [ ] **Step 4: Run the body hook on both requests**

In `worker/agents/think/model-fallback.ts`, replace:

```ts
	/** Rewrites the body of the primary request only, for provider-specific fields. */
	preparePrimaryBody?: (body: string) => string;
```

with:

```ts
	/** Rewrites each outgoing body for its target model; the fallback body already carries the fallback model. */
	prepareBody?: (body: string) => string;
```

Replace:

```ts
	const { fallback, latch, primaryTimeoutMs, preparePrimaryBody, onFallback } = options;
```

with:

```ts
	const { fallback, latch, primaryTimeoutMs, prepareBody, onFallback } = options;
```

Replace:

```ts
		const primaryBody = typeof body === 'string' && preparePrimaryBody ? preparePrimaryBody(body) : body;
		const primaryInit: RequestInit = { ...(init ?? {}), body: primaryBody };
		const fallbackBody = typeof body === 'string' && fallback ? withModel(body, fallback.modelName) : null;
```

with:

```ts
		const primaryBody = typeof body === 'string' && prepareBody ? prepareBody(body) : body;
		const primaryInit: RequestInit = { ...(init ?? {}), body: primaryBody };
		const fallbackJson = typeof body === 'string' && fallback ? withModel(body, fallback.modelName) : null;
		const fallbackBody = fallbackJson !== null && prepareBody ? prepareBody(fallbackJson) : fallbackJson;
```

- [ ] **Step 5: Wire the hook in ThinkAgent**

In `worker/agents/think/ThinkAgent.ts`, replace:

```ts
			preparePrimaryBody: (body) => injectThoughtSignatures(body, this.thoughtSignatures),
```

with:

```ts
			prepareBody: (body) => injectThoughtSignatures(body, this.thoughtSignatures),
```

In the comment above `const transport = createFallbackFetch({`, replace:

```ts
		// (4) re-send to the fallback model when the primary is overloaded. The
		// signatures are Gemini-only, so the fallback request goes without them.
```

with:

```ts
		// (4) re-send to the fallback model when the primary is overloaded. The
		// signatures are Gemini-only, so only Google-bound requests carry them.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test worker/agents/think/thought-signatures.test.ts worker/agents/think/model-fallback.test.ts`

Expected: 7 + 18 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/think/thought-signatures.ts worker/agents/think/thought-signatures.test.ts worker/agents/think/model-fallback.ts worker/agents/think/model-fallback.test.ts worker/agents/think/ThinkAgent.ts
git commit -m "feat(think): add gemini signatures to whichever request goes to google" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The selected model drives the agent

**Files:**
- Modify: `worker/agents/think/model-config.ts` (remove the four old constants)
- Modify: `worker/agents/core/state.ts` (`ThinkState`)
- Modify: `worker/agents/core/types.ts` (`ThinkAgentInitArgs`)
- Modify: `worker/api/controllers/agent/types.ts` (`CodeGenArgs`)
- Modify: `worker/api/controllers/agent/controller.ts` (`startCodeGeneration`)
- Modify: `worker/agents/core/behaviors/think.ts` (imports, `initialize`, `configureThinkAgent`, `resolveThinkFallback`, new `setModel`)
- Modify: `worker/agents/think/ThinkAgent.ts` (import, `beforeStep` credit cost)
- Create: `worker/agents/think/model-wiring.test.ts`

**Interfaces:**
- Consumes: `resolveThinkModel`, `isThinkModelId`, `fallbackModelFor`, `ThinkModel` (Task 1).
- Produces:
  - `ThinkState.thinkModelId?: string`
  - `ThinkAgentInitArgs.thinkModelId?: string`
  - `CodeGenArgs.modelId?: string`
  - `ThinkCodingBehavior.setModel(modelId: string): Promise<void>`. It rejects when the agent could not be reconfigured, and restores the previous `thinkModelId` first.

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
	it('configures the agent from the app\'s selected model', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		expect(behavior).toContain('resolveThinkModel(this.state.thinkModelId)');
		expect(behavior).toContain('fallbackModelFor(selected)');
		expect(behavior).not.toMatch(/THINK_MODEL_ID|THINK_MODEL_CONFIG|THINK_FALLBACK_MODEL/);
	});

	it('stores the requested model when a think app is created', () => {
		const controller = source('/worker/api/controllers/agent/controller.ts');
		expect(controller).toContain('resolveThinkModel(body.modelId)');
		expect(controller).toContain('thinkModelId: thinkModel.id');
	});

	it('charges the configured model\'s credit cost per step', () => {
		expect(source('/worker/agents/think/ThinkAgent.ts')).toContain(
			'resolveThinkModel(config.model.modelName).config.creditCost',
		);
	});

	it('keeps the catalog as the only model list', () => {
		expect(source('/worker/agents/think/model-config.ts')).not.toMatch(/THINK_MODEL_ID|THINK_FALLBACK_MODEL/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/think/model-wiring.test.ts`

Expected: 4 tests FAIL, because each string is absent and the old constants are still present.

- [ ] **Step 3: Remove the old constants**

In `worker/agents/think/model-config.ts`, delete everything after the `requireThinkModel` function: the `THINK_MODEL_ID` and `THINK_MODEL_CONFIG` declarations, the fallback doc comment, `THINK_FALLBACK_MODEL_ID` and `THINK_FALLBACK_MODEL_CONFIG`.

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

- [ ] **Step 6: Configure the agent from the selected model**

In `worker/agents/core/behaviors/think.ts`, replace:

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
import { fallbackModelFor, resolveThinkModel, type ThinkModel } from '../../think/model-config';
```

In `initialize`, replace:

```ts
		const { query, hostname, inferenceContext, sandboxSessionId } = initArgs;
```

with:

```ts
		const { query, hostname, inferenceContext, sandboxSessionId, thinkModelId } = initArgs;
```

and in the `this.setState({` call of `initialize`, replace:

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
		} catch (e) {
			this.logger.warn('Failed to resolve model gateway config for ThinkAgent', e);
			return;
		}
```

with:

```ts
		} catch (e) {
			this.logger.warn('Failed to resolve model gateway config for ThinkAgent', e);
			return false;
		}
```

Replace:

```ts
				fallback: await this.resolveThinkFallback(userId, inf, gatewayToken),
```

with:

```ts
				fallback: await this.resolveThinkFallback(selected, userId, inf, gatewayToken),
```

Replace:

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

Replace the `resolveThinkFallback` doc comment, signature and model lookup:

```ts
	/**
	 * Claude fallback for turns the primary model can't serve, when
	 * `ENABLE_THINK_MODEL_FALLBACK` is on. Uses the platform Anthropic key if
	 * one is set, otherwise the key stored in the AI Gateway.
	 */
	private async resolveThinkFallback(
		userId: string,
		inf: InferenceContext,
		gatewayToken: string | undefined,
	): Promise<ModelFallback | undefined> {
		const flags = this.env as unknown as { ENABLE_THINK_MODEL_FALLBACK?: string };
		if (flags.ENABLE_THINK_MODEL_FALLBACK !== 'true') return undefined;
		try {
			const conf = await getConfigurationForModel(
				THINK_FALLBACK_MODEL_CONFIG,
```

with:

```ts
	/**
	 * Cross-provider fallback for turns the selected model can't serve, when
	 * `ENABLE_THINK_MODEL_FALLBACK` is on. Uses the platform provider key if
	 * one is set, otherwise the key stored in the AI Gateway.
	 */
	private async resolveThinkFallback(
		selected: ThinkModel,
		userId: string,
		inf: InferenceContext,
		gatewayToken: string | undefined,
	): Promise<ModelFallback | undefined> {
		const flags = this.env as unknown as { ENABLE_THINK_MODEL_FALLBACK?: string };
		if (flags.ENABLE_THINK_MODEL_FALLBACK !== 'true') return undefined;
		const fallbackModel = fallbackModelFor(selected);
		try {
			const conf = await getConfigurationForModel(
				fallbackModel.config,
```

and in the same method replace:

```ts
				modelName: THINK_FALLBACK_MODEL_ID,
```

with:

```ts
				modelName: fallbackModel.id,
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

Run: `grep -rn "THINK_MODEL_ID\|THINK_MODEL_CONFIG\|THINK_FALLBACK_MODEL" worker src; echo "exit=$?"`

Expected: only matches in `worker/agents/think/model-wiring.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add worker/agents/think/model-config.ts worker/agents/core/state.ts worker/agents/core/types.ts worker/api/controllers/agent/types.ts worker/api/controllers/agent/controller.ts worker/agents/core/behaviors/think.ts worker/agents/think/ThinkAgent.ts worker/agents/think/model-wiring.test.ts
git commit -m "feat(think): build each app with its selected model" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `set_model` over the agent WebSocket

**Files:**
- Modify: `worker/agents/constants.ts` (`WebSocketMessageRequests`)
- Modify: `worker/agents/core/websocket.ts` (`IncomingWebSocketMessage`, new `case`)
- Create: `worker/agents/core/websocket.test.ts`

**Interfaces:**
- Consumes: `isThinkModelId` (Task 1); `ThinkCodingBehavior.setModel(modelId: string): Promise<void>` (Task 3).
- Produces: `WebSocketMessageRequests.SET_MODEL = 'set_model'`, and handling of `{ type: 'set_model', modelId }`.

- [ ] **Step 1: Write the failing test**

Create `worker/agents/core/websocket.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Connection } from 'agents';
import { handleWebSocketMessage } from './websocket';
import type { CodeGeneratorAgent } from './codingAgent';

interface FakeBehavior {
	setModel?: (modelId: string) => Promise<void>;
}

function fakes(behavior: FakeBehavior) {
	const sent: Array<{ type: string; error?: string }> = [];
	const connection = { id: 'c1', url: 'wss://estori.app/ws', send: (data: string) => sent.push(JSON.parse(data)) } as unknown as Connection;
	const agent = { getBehavior: () => behavior, state: {}, setState: () => undefined } as unknown as CodeGeneratorAgent;
	return { sent, connection, agent };
}

describe('set_model', () => {
	it('switches the app to a catalog model', async () => {
		const calls: string[] = [];
		const { agent, connection, sent } = fakes({ setModel: async (id) => void calls.push(id) });
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type: 'set_model', modelId: 'anthropic/claude-opus-5-5' }));
		expect(calls).toEqual(['anthropic/claude-opus-5-5']);
		expect(sent).toEqual([]);
	});

	it('rejects ids outside the catalog', async () => {
		const calls: string[] = [];
		const { agent, connection, sent } = fakes({ setModel: async (id) => void calls.push(id) });
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type: 'set_model', modelId: 'openai/gpt-9' }));
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type: 'set_model' }));
		expect(calls).toEqual([]);
		expect(sent).toEqual([
			{ type: 'error', error: 'Unknown model' },
			{ type: 'error', error: 'Unknown model' },
		]);
	});

	it('reports apps that cannot change models', async () => {
		const { agent, connection, sent } = fakes({});
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type: 'set_model', modelId: 'anthropic/claude-opus-5-5' }));
		expect(sent).toEqual([{ type: 'error', error: 'Model selection is not supported for this app' }]);
	});

	it('reports a failed switch', async () => {
		const { agent, connection, sent } = fakes({
			setModel: async () => {
				throw new Error('the agent could not be reconfigured');
			},
		});
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type: 'set_model', modelId: 'anthropic/claude-opus-5-5' }));
		expect(sent).toEqual([{ type: 'error', error: 'Could not switch model: the agent could not be reconfigured' }]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/agents/core/websocket.test.ts`

Expected: FAIL. `set_model` is an unknown message type, so `setModel` is never called and the error expectations are not met.

If the test file fails to load (an import-time error from a module the WebSocket handler imports), stop and report NEEDS_CONTEXT with the error.

- [ ] **Step 3: Add the request type**

In `worker/agents/constants.ts`, inside `export const WebSocketMessageRequests = {`, replace:

```ts
    // Restore a prior commit (think/SpaceDO only)
    ROLLBACK_TO_COMMIT: 'rollback_to_commit',
```

with:

```ts
    // Restore a prior commit (think/SpaceDO only)
    ROLLBACK_TO_COMMIT: 'rollback_to_commit',

    // Switch the build model for later turns (think only)
    SET_MODEL: 'set_model',
```

- [ ] **Step 4: Handle `set_model`**

In `worker/agents/core/websocket.ts`, add to the imports:

```ts
import { isThinkModelId } from '../think/model-config';
```

In `interface IncomingWebSocketMessage {`, add after `commitHash?: string;`:

```ts
    modelId?: string;
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
                logger.info('Switching build model', { modelId });
                try {
                    await behavior.setModel(modelId);
                } catch (error) {
                    sendError(connection, `Could not switch model: ${error instanceof Error ? error.message : String(error)}`);
                }
                break;
            }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run test worker/agents/core/websocket.test.ts`

Expected: 4 tests PASS.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"`

Expected: no lines, `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/constants.ts worker/agents/core/websocket.ts worker/agents/core/websocket.test.ts
git commit -m "feat(think): switch the build model over the agent websocket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capabilities expose the catalog

**Files:**
- Modify: `worker/agents/core/features/types.ts` (`PlatformCapabilities`)
- Modify: `worker/api/controllers/capabilities/controller.ts`
- Modify: `worker/api/controllers/capabilities/controller.test.ts`
- Modify: `src/api-types.ts`

**Interfaces:**
- Consumes: `thinkModelOptions()`, `DEFAULT_THINK_MODEL_ID` (Task 1); `ThinkModelOption` (Task 1).
- Produces:
  - `PlatformCapabilities.thinkModels: ThinkModelOption[]` and `PlatformCapabilities.defaultThinkModel: string`.
  - `ThinkModelOption` re-exported from `@/api-types`.

- [ ] **Step 1: Write the failing test**

In `worker/api/controllers/capabilities/controller.test.ts`, add inside the `describe` block:

```ts
	it('offers the build models and the default', async () => {
		const capabilities = await capabilitiesFor({});
		expect(capabilities.thinkModels.map((model) => model.id)).toEqual([
			'google-ai-studio/gemini-3.6-flash',
			'google-ai-studio/gemini-3.8-flash',
			'anthropic/claude-sonnet-5-5',
			'anthropic/claude-opus-5-5',
		]);
		expect(capabilities.thinkModels[0]).toEqual({ id: 'google-ai-studio/gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'google-ai-studio' });
		expect(capabilities.defaultThinkModel).toBe('anthropic/claude-sonnet-5-5');
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test worker/api/controllers/capabilities/controller.test.ts`

Expected: FAIL. `capabilities.thinkModels` is undefined, so `.map` throws a TypeError.

- [ ] **Step 3: Add the fields and return them**

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

In `src/api-types.ts`, in the `export type { ... } from 'worker/agents/core/features/types';` block, replace:

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

### Task 6: Picker component and the home prompt

**Files:**
- Create: `src/components/ThinkModelPicker.tsx`
- Modify: `src/routes/home.tsx`
- Create: `src/routes/model-picker-guard.test.ts`

**Interfaces:**
- Consumes:
  - `capabilities.thinkModels`, `capabilities.defaultThinkModel` and `ThinkModelOption` (Task 5).
  - `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` from `@/components/ui/select`.
  - `cn` from `@cloudflare/kumo`.
- Produces: `ThinkModelPicker({ options, value, onChange, disabled?, className? })`, which renders `null` when `options` is empty, and the `&model=<id>` parameter on `/chat/new`.

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
		expect(source('/src/components/ThinkModelPicker.tsx')).toMatch(/if \(options\.length === 0\) return null;/);
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

Directly after the `useFeature()` destructuring statement (`const { isLoadingCapabilities, capabilities, getEnabledFeatures } = useFeature();`), add:

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

Replace the `leftActions` prop of the home `PromptBox`:

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

- [ ] **Step 5: Run the test to verify it passes**

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

### Task 7: Picker in the chat, session creation and switching

**Files:**
- Modify: `src/routes/chat/components/chat-input.tsx`
- Modify: `src/routes/chat/hooks/use-chat.ts`
- Modify: `src/routes/chat/utils/handle-websocket-message.ts`
- Modify: `src/routes/chat/chat.tsx`
- Modify: `src/routes/model-picker-guard.test.ts`

**Interfaces:**
- Consumes:
  - `ThinkModelPicker` (Task 6).
  - `capabilities.thinkModels` (Task 5).
  - `CodeGenArgs.modelId` and `ThinkState.thinkModelId` (Task 3).
  - The `set_model` request (Task 4).
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

and append at the end of the file:

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
		const syncs = handler.match(/setThinkModelId\(state\.thinkModelId \?\? ''\)/g) ?? [];
		expect(syncs).toHaveLength(2);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test src/routes/model-picker-guard.test.ts`

Expected: the 4 new tests FAIL; the 4 from Task 6 PASS.

- [ ] **Step 3: Let the chat input take left actions**

In `src/routes/chat/components/chat-input.tsx`, in `interface ChatInputProps`, add after the `aboveContent?: ReactNode;` member:

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

and in the returned `PromptBox`, replace:

```tsx
			rightActions={stopButton}
```

with:

```tsx
			leftActions={leftActions}
			rightActions={stopButton}
```

- [ ] **Step 4: Track and switch the model in `useChat`**

In `src/routes/chat/hooks/use-chat.ts`, replace the start of the parameter destructuring:

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

In the parameter type, replace:

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
					const response = await apiClient.createAgentSession({
						query: userQuery,
						projectType,
						behaviorType: explicitBehaviorType,
						images: userImages, // Pass images from URL params for multi-modal blueprint
					});
```

with:

```ts
					const response = await apiClient.createAgentSession({
						query: userQuery,
						projectType,
						behaviorType: explicitBehaviorType,
						modelId,
						images: userImages, // Pass images from URL params for multi-modal blueprint
					});
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

In `src/routes/chat/utils/handle-websocket-message.ts`, in `export interface HandleMessageDeps`, replace:

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

In the destructuring `const { ... } = useChat({`, add `thinkModelId,` and `selectThinkModel,` directly after `dismissClarifyingQuestions,`.

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

`capabilities` is already in scope in `ChatSession`: `const { capabilities } = useFeature();`.

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `bun run test src/routes/model-picker-guard.test.ts src/brand/brand-guard.test.ts`

Expected: 8 guard tests PASS, and the brand guard still passes.

Run: `bun run typecheck 2>&1 | grep "error TS" | grep -v packages/artifacts-viewer; echo "exit=$?"` and `bun run lint 2>&1 | tail -3`

Expected: no TypeScript lines, `exit=1`; lint reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/chat/components/chat-input.tsx src/routes/chat/hooks/use-chat.ts src/routes/chat/utils/handle-websocket-message.ts src/routes/chat/chat.tsx src/routes/model-picker-guard.test.ts
git commit -m "feat(think): pick and switch the build model in the chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Deploy and live checks (owner approves)

**Files:** none, unless a check fails. Fixes then follow TDD in their own commits.

**Interfaces:**
- Consumes: Tasks 1–7 committed.
- Produces: the picker live on estori.app.

- [ ] **Step 1: Release (owner go-ahead to push)**

Run:

```bash
git push origin claude/project-analysis-local-setup-dfd834
git push origin HEAD:refs/heads/estori-live
```

The owner approves the `production` environment on the run (Review deployments → `production` → Approve and deploy).

Expected: the gate is green, the deploy succeeds, and the smoke test passes `health`, `capabilities` and `preview-host`.

- [ ] **Step 2: Capabilities in production**

Run: `bun scripts/estori-smoke.ts` with `ACCESS_CLIENT_ID` and `ACCESS_CLIENT_SECRET` set to the service token values. Then fetch `https://estori.app/api/capabilities` with the same Access headers and read `data.thinkModels` and `data.defaultThinkModel`.

Expected: four models in catalog order, and default `anthropic/claude-sonnet-5-5`.

- [ ] **Step 3: Owner checks in the browser (Review Focus 1–4)**

The owner, signed in on estori.app:
- Sees the picker on the home prompt with Claude Sonnet 5.5 selected, picks Gemini 3.8 Flash, and starts a build.
- Opens an app created before this deploy. Its picker shows `Select model`.
- Opens the new app in two tabs, switches to Claude Opus 5.5 in one, and sees the other tab update.
- Sends a message after the switch.

- [ ] **Step 4: Confirm the models in the AI Gateway log**

Read the latest `estori-gateway` log entries, using the read-only gateway logs API with the deploy token.

Expected:
- The new build's first requests use `google-ai-studio/gemini-3.8-flash`. If they return 503, they continue on `anthropic/claude-sonnet-5-5`.
- The message after the switch uses `anthropic/claude-opus-5-5`.
- No 400 `thought_signature` errors appear.

Record each check as pass or fail in the ledger.
