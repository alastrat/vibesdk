# Think model picker

Status: approved in chat, 2026-10-06.

## Goal

Let every Estori user choose which model builds their app: once on the home prompt for a new build, and again from the chat input for later messages in an existing app.

## Decisions

| Question | Decision |
|---|---|
| When can users pick? | At the start (home prompt) and mid-chat (chat input). The choice is saved per app. |
| Models offered | Gemini 3.6 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5 |
| Who can pick | Every user, all four models |
| Default model | Claude Sonnet 5.5 |
| Mid-chat switch takes effect | From the next message; a turn already running finishes on its model |
| Fallback | Gemini choices fall back to Sonnet 5.5; Claude choices fall back to Gemini 3.6 Flash; the fallback still sticks for the rest of a turn |

## Model catalog

One list in `worker/agents/think/model-config.ts` is the single source of truth for the build models.

| Id | Label | Provider | Credits per step | Context |
|---|---|---|---|---|
| `google-ai-studio/gemini-3.6-flash` | Gemini 3.6 Flash | google-ai-studio | 3 | 1,048,576 |
| `google-ai-studio/gemini-3.8-flash` | Gemini 3.8 Flash | google-ai-studio | 3 | 1,048,576 |
| `anthropic/claude-sonnet-5-5` | Claude Sonnet 5.5 | anthropic | 8 | 1,000,000 |
| `anthropic/claude-opus-5-5` | Claude Opus 5.5 | anthropic | 16 | 1,000,000 |

Credits use the platform scale where $0.25 per 1M input tokens is 1 credit. The Gemini Flash input price is $0.75 per 1M through 2026-12-31 and $1.50 from 2027-01-01. Claude prices come from the Anthropic model table: Sonnet 5.5 $2, Opus 5.5 $4.

Helpers in the same module:
- `resolveThinkModel(id)` returns the catalog entry for an id, or the default for an unknown or missing id.
- `isThinkModelId(id)` reports whether an id is in the catalog.
- `fallbackModelFor(model)` returns Sonnet 5.5 for Google models and Gemini 3.6 Flash for Anthropic models.

## Architecture

### Platform capabilities

`GET /api/capabilities` gains `thinkModels: { id, label, provider }[]` and `defaultThinkModel`. The frontend already loads capabilities on start through `useFeature()`, so no new endpoint is needed.

### Starting a build with a model

- The home prompt shows the picker in `PromptBox` `leftActions`, next to the project mode selector when that is visible. Its initial value is `defaultThinkModel`.
- `handleCreateApp` adds `&model=<id>` to `/chat/new`.
- The chat route reads `model` from the URL and passes it to `useChat`, which sends it as `modelId` in `createAgentSession`.
- `CodeGenArgs` gains an optional `modelId`. `startCodeGeneration` resolves it with `resolveThinkModel` and passes `thinkModelId` in the think init args.
- `ThinkState` gains `thinkModelId`. `ThinkCodingBehavior.initialize` stores it before `configureThinkAgent` runs.

### Switching mid-chat

- The chat input shows the same picker in `leftActions` for think apps. Its value is the app's `thinkModelId`, which the frontend reads from agent state on `agent_connected` and `cf_agent_state`.
- Changing it sends `{ type: 'set_model', modelId }` over the agent WebSocket.
- The server handles it with `ThinkCodingBehavior.setModel(modelId)`:
  - it rejects ids outside the catalog with a WebSocket error;
  - it saves `thinkModelId` in state, which broadcasts `cf_agent_state` to every open tab;
  - it re-runs `configureThinkAgent`, which pushes the new model to the ThinkAgent with `configureVibe`.
- `ThinkAgent.getModel()` reads the configuration on each turn, so the new model applies from the next message. `configureVibe` re-renders the system prompt, which `selectSystemPrompt` already picks by model family.

### Agent configuration

`configureThinkAgent` uses `resolveThinkModel(this.state.thinkModelId)` in place of the hard-coded Gemini constants, and reports whether `configureVibe` succeeded.

Apps created before this change have no `thinkModelId`. They keep running on the model they were configured with (Gemini 3.6 Flash), and their chat picker shows a "Select model" placeholder rather than a model they are not using, until the user picks one.

`ThinkAgent.beforeStep` charges the catalog credit cost of the configured model (`resolveThinkModel(config.model.modelName)`) in place of the hard-coded Gemini cost.

When `ENABLE_THINK_MODEL_FALLBACK` is on, the fallback is `fallbackModelFor(selected)`. Its key resolution is unchanged: the platform provider key when set, otherwise the key stored in the AI Gateway.

### Gemini thought signatures on either side

Gemini rejects tool-call history without thought signatures; other providers must not receive them. `createFallbackFetch` replaces the primary-only `preparePrimaryBody(body)` with `prepareBody(body, modelName)`, applied to whichever request goes out: primary or fallback. `ThinkAgent` injects signatures only when the target model is a Google model. This lets a Claude primary fall back to Gemini, and a Gemini primary fall back to Claude.

### Picker component

`src/components/ThinkModelPicker.tsx` is a compact select built on the existing Radix `Select` primitive (the `TimePeriodSelector` pattern). Its props are the options, the value, `onChange`, and `disabled`. It renders nothing when the option list is empty, so builds without the capability keep today's UI.

## Error handling

| Case | Behavior |
|---|---|
| Unknown `modelId` when creating an app | Use the default and log a warning |
| Unknown `modelId` in `set_model` | WebSocket error "Unknown model"; state unchanged |
| `set_model` for a non-think app | WebSocket error "Model selection is not supported for this app" |
| `configureVibe` fails during a switch | Logged; the app keeps its previous model; the saved `thinkModelId` is restored so the picker shows the model that is actually running |
| Picker changed while disconnected | The picker is disabled until the WebSocket is open |

## Testing

- Catalog: default resolution, unknown ids, `isThinkModelId`, fallback pairing for each model.
- Fallback fetch: the body hook runs for primary and fallback with the right model name, and signatures reach only Google-bound requests.
- Capabilities controller: returns the catalog options and the default.
- WebSocket: `set_model` calls `setModel` with the id; missing id and unsupported behavior send errors.
- Frontend guard: the home prompt and the chat input render `ThinkModelPicker`; `createAgentSession` sends `modelId`.
- Live: one build per provider on estori.app after deploy, plus one mid-chat switch, confirmed in the AI Gateway logs.

## Out of scope

- A chat notice when a turn switches to the fallback.
- Per-user cost caps. Think meters credits but does not block, so a model's cost is not capped per user.
- Bring-your-own-key model lists and the existing per-action model configuration UI.
