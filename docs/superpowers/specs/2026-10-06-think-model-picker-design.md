# Think model picker

Status: approved in chat, 2026-10-06. Revised the same day to replace the automatic fallback with a user-confirmed switch.

## Goal

Let every Estori user choose which model builds their app:
- once on the home prompt for a new build;
- again from the chat input for later messages in an existing app;
- and, when the chosen model's provider fails, decide whether to switch, seeing the price change first.

## Decisions

| Question | Decision |
|---|---|
| When can users pick? | At the start (home prompt) and mid-chat (chat input). The choice is saved per app. |
| Models offered | Gemini 3.6 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5 |
| Who can pick | Every user, all four models |
| Default model | Claude Sonnet 5.5 |
| Mid-chat switch takes effect | From the next message; a turn already running finishes on its model |
| Provider failure | After two quick retries, the build stops. The chat shows the provider's error and offers "Switch to <alternative>", with the credits per step, or "Try again". There is no silent switching. |
| What "Switch" does | Changes the app's model (the picker shows it) and continues the build |
| Price shown as | Credits per step, for example "8 credits per step instead of 3 (about 2.7x)" |
| Alternative model | Google models offer Claude Sonnet 5.5; Anthropic models offer Gemini 3.6 Flash |

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
- `fallbackModelFor(model)` returns the alternative from the Decisions table.

## Architecture

### Platform capabilities

`GET /api/capabilities` gains `thinkModels: { id, label, provider, creditCost }[]` and `defaultThinkModel`. The frontend already loads capabilities on start through `useFeature()`, so no new endpoint is needed. The failure card reads labels and credits from this list.

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

`configureThinkAgent` uses `resolveThinkModel(this.state.thinkModelId)` in place of the hard-coded Gemini constants, and reports whether `configureVibe` succeeded. `ThinkAgentConfig.model` no longer carries a fallback.

Apps created before this change have no `thinkModelId`. They keep running on the model they were configured with (Gemini 3.6 Flash). Their chat picker shows a "Select model" placeholder rather than a model they are not using, until the user picks one.

`ThinkAgent.beforeStep` charges the catalog credit cost of the configured model (`resolveThinkModel(config.model.modelName)`) in place of the hard-coded Gemini cost.

### When the model's provider fails

1. **The agent records the failure.** The ThinkAgent's fetch transport replaces the automatic fallback.
   - It records the last provider failure for the turn: the model id, a reason, the HTTP status, and the provider's message.
   - Reasons are:
     - `overloaded` for 503 and 529;
     - `rate_limited` for 429;
     - `unavailable` for other 5xx responses;
     - `timeout` when no response arrives within 60 seconds. In that case the transport returns a 504 so the AI SDK treats it like any other retryable failure.
   - A successful response clears the record. Each turn starts clean.
2. **The turn gives up quickly.** Turns retry twice (`maxRetries: 2`), about 6 seconds with backoff, then fail.
3. **The host reports the failure.**
   - When a turn fails, `ThinkCodingBehavior` asks the ThinkAgent for its recorded failure over RPC (`getProviderFailure()`).
   - If there is one, it broadcasts `model_unavailable` with the failed model id, the reason, the status, the provider's message, and the alternative model id when `ENABLE_THINK_MODEL_FALLBACK` is on.
   - Other turn errors are broadcast as `error`, as today.
4. **The chat shows a card above the input**, built from the capabilities list:
   - The failed model and the provider's reason, for example "Gemini 3.6 Flash is unavailable: Google reports high demand (503)".
   - **Switch to <alternative>**, with "8 credits per step instead of 3 (about 2.7x)" (or "about N% cheaper" when the alternative costs less). This sends `{ type: 'set_model', modelId, resume: true }`.
   - **Try again**, which sends the resume message as a normal user message.
5. **Resuming.** The resume message is "Continue where you left off.", defined once in `shared/think.ts` for both sides.
   - `set_model` with `resume: true` runs the same usage check as a user message, switches the model, and then queues the resume message.
   - The two steps run in order on the server, so the resumed turn runs on the new model.

### Gemini thought signatures on whichever request goes to Google

After a switch, the history holds tool calls made by the other provider. Gemini rejects tool-call history without thought signatures; other providers must not receive them. The transport runs a `prepareBody` hook on every request, and `injectThoughtSignatures` only changes bodies whose `model` is a Google model.

### Picker and card components

- `src/components/ThinkModelPicker.tsx` is a compact select built on the existing Radix `Select` primitive (the `TimePeriodSelector` pattern). Its props are the options, the value, `onChange`, and `disabled`. It renders nothing when the option list is empty, so builds without the capability keep today's UI.
- `src/components/ModelUnavailableNotice.tsx` renders the failure card. The credit wording comes from `src/utils/credit-change.ts`.

## Error handling

| Case | Behavior |
|---|---|
| Unknown `modelId` when creating an app | Use the default and log a warning |
| Unknown `modelId` in `set_model` | WebSocket error "Unknown model"; state unchanged |
| `set_model` for a non-think app | WebSocket error "Model selection is not supported for this app" |
| `configureVibe` fails during a switch | Error "Could not switch model: …"; the saved `thinkModelId` is restored so the picker shows the model that is actually running; no resume |
| `set_model` with `resume` blocked by usage limits | The usage-limit popup, as for a user message; the model switch has already happened |
| Provider fails after retries | `model_unavailable` card |
| Alternative fails too | The same card, now offering the alternative's alternative |
| `ENABLE_THINK_MODEL_FALLBACK` off | The card shows the error and "Try again" only |
| Non-provider turn error (for example a 400) | The existing `error` message |
| Picker changed while disconnected | The picker is disabled until the WebSocket is open |

## Testing

- Catalog: default resolution, unknown ids, `isThinkModelId`, alternative pairing for each model.
- Transport: the body hook runs on every request; status classification; provider message extraction; the 60-second timeout returns 504 and records `timeout`; success clears the record.
- Signatures: only Google-bound bodies change.
- Failure report: the notice builder includes the alternative only when offered.
- WebSocket: `set_model` validation, errors, and `resume` queueing the resume message after the switch.
- Capabilities controller: returns the catalog options, including credits, and the default.
- Credit wording: more expensive, cheaper, and equal.
- Frontend guards: both pickers render; `createAgentSession` sends `modelId`; the handler syncs `thinkModelId` and stores `model_unavailable`; the card's actions send `set_model` with `resume` and the resume message.
- Live: one build per provider on estori.app after deploy, one mid-chat switch, and the failure card on a real provider error, confirmed in the AI Gateway logs.

## Out of scope

- Per-user cost caps. Think meters credits but does not block, so a model's cost is not capped per user.
- Bring-your-own-key model lists and the existing per-action model configuration UI.
- Showing credits per step inside the picker itself.
