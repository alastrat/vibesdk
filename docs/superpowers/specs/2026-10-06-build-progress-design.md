# Build progress and elapsed time

Status: approved in chat, 2026-10-06.

## Goal

While a Think build runs, show users that it is moving and how long it has run. A Sonnet build takes about 10 minutes, and single steps that write a large file take up to 3 minutes. The chat shows nothing new during those steps today.

## Decisions

| Question | Decision |
|---|---|
| Where | A status bar above the chat input, shown only while a build runs |
| What it shows | The step number, the elapsed time, and the current activity: thinking, writing a file with its line count so far, or another tool |
| Live file content in the editor | Out of scope |
| Time estimate | None. Elapsed time only |
| Source of progress | The server tracks steps and file progress from the stream chunks it already receives, and sends a throttled snapshot |
| Reload mid-build | The bar returns with the real elapsed time and step |

## What the user sees

The bar appears when a build starts (`generation_started`) and disappears when it ends (`generation_complete`). That covers the first prompt and every later message that runs a build. It goes in the chat input's `aboveContent` slot, before the failure card. The two never show together, because a failed build ends before its card appears.

```
Building · step 4 · 3:12
◌ Writing src/pages/Catalog.tsx · 340 lines
```

- **Step:** one model call, counted across the whole build, including queued follow-up messages that the same build runs. The bar shows no total, because nothing knows it in advance. The step is hidden until the first step starts, so the line reads `Building · 0:03` until then.
- **Clock:** `m:ss`, switching to `h:mm:ss` from one hour. It ticks every second.
- **Activity:**
  - `Thinking…` while the agent waits for the model, writes reply text, or reasons.
  - For a running tool, the label the chat's tool rows already use, without the trailing ellipsis, for example `Writing src/pages/Catalog.tsx`, `Editing src/App.tsx` or `Deploying`. Long paths are shortened by `shortenPath`.
  - For `write`, ` · N lines` follows the label once N is above 0, with N formatted for the browser's locale (`1,204 lines`). `edit` never shows a count.
  - The activity line truncates to one line on narrow screens.
- Phasic and agentic apps never show the bar.

## Architecture

### Shared types

In `worker/api/websocketTypes.ts`:

```ts
export type BuildActivity =
	| { kind: 'thinking' }
	| { kind: 'tool'; toolName: string; path?: string; lines?: number };

export type BuildProgress = {
	/** Milliseconds since the build started, measured on the server when sent. */
	elapsedMs: number;
	/** Model calls started in this build; 0 before the first. */
	step: number;
	activity: BuildActivity;
};

type BuildProgressMessage = { type: 'build_progress'; progress: BuildProgress };
```

- `BuildProgressMessage` joins the `WebSocketMessage` union.
- `AgentConnectedMessage` gains `buildProgress?: BuildProgress`.
- `WebSocketMessageResponses` in `worker/agents/constants.ts` gains `BUILD_PROGRESS: 'build_progress'`.
- `src/api-types.ts` re-exports `BuildActivity` and `BuildProgress` with the other WebSocket types.

The message carries elapsed time rather than a start timestamp, so a browser clock that runs fast or slow cannot skew the timer.

### Tool argument scanner

`worker/agents/think/build-progress.ts` holds an incremental scanner for the partial JSON of one tool call's arguments, such as `{"path":"/src/x.tsx","content":"import …\n…`.

- It processes each `inputTextDelta` once and never re-parses or keeps the arguments.
- It tracks whether it is inside a string, escape state, nesting depth, and the current top-level key.
- It captures the top-level `path` string when it closes, decoding standard JSON escapes.
- It counts newline escapes (`\n`) inside the top-level `content` string. An escaped backslash followed by `n` (`\\n`) is not a newline, and the characters of a `\uXXXX` escape are never counted.
- An escape split across two deltas is handled, because the escape state carries over.
- Unexpected input never throws. The scanner stops advancing its path or count and keeps what it has.
- Lines are the newline count plus 1 once `content` has at least one character, and 0 before that.

### Progress tracker

The same module exports `BuildProgressTracker`:

```ts
class BuildProgressTracker {
	constructor(startedAt: number);
	/** Applies one stream chunk; returns a snapshot when it should be broadcast, otherwise null. */
	onChunk(chunk: { type: string }, now: number): BuildProgress | null;
	/** The current snapshot, for a tab that connects mid-build. */
	snapshot(now: number): BuildProgress;
}
```

Chunk handling:

| Chunk | Effect |
|---|---|
| `start-step` | `step` + 1 |
| `tool-input-start` | Opens the call (`toolCallId`, `toolName`); for `write` and `edit` it creates a scanner |
| `tool-input-delta` | Feeds `inputTextDelta` to the call's scanner, if it has one |
| `tool-input-available` | Takes `path` from the final input and, for `write`, the final line count of `content` |
| `tool-output-available`, `tool-output-error` | Closes the call |
| Anything else | No change |

- **Activity** is the most recently opened call that is still open. When no call is open, it is `thinking`. So a finished `write` cannot flash "Thinking…" while another call from the same step is still running.
- **Throttle:** `onChunk` returns a snapshot at once when the step, the activity kind, the tool, or the path changes. When only the line count changed, it returns one at most once per second (1,000 ms since the last returned snapshot). Otherwise it returns `null`.

### Host wiring

In `worker/agents/core/behaviors/think.ts`:

- `build()` creates a `BuildProgressTracker` with `Date.now()` before its loop and sets it to `null` in a `finally`. One tracker spans every turn the build runs.
- Before its existing switch, `translateChunk` passes each chunk to the tracker inside a `try`/`catch` and broadcasts `BUILD_PROGRESS` with any snapshot returned. On the first exception it logs once and drops the tracker for the rest of the build, so progress can never fail a build.
- The tracker lives in memory, not in agent state. `setState` persists the state and sends it whole to every tab, which is too heavy for once-a-second updates. If the Durable Object restarts mid-build, the build restarts too, with a new tracker.
- `getBuildProgress()` returns the tracker's `snapshot(Date.now())`, or `null` when no build is running.

In `worker/agents/core/behaviors/base.ts`, `getBuildProgress(): BuildProgress | null` returns `null`. Phasic and agentic behaviors keep that default.

In `worker/agents/core/codingAgent.ts`, `agent_connected` includes `buildProgress` when `getBuildProgress()` returns a snapshot.

### Browser state

`src/routes/chat/utils/build-status.ts` holds the state type and pure transitions:

```ts
type BuildStatus = { startedAt: number; step: number; activity: BuildActivity };

function startBuildStatus(now: number): BuildStatus;
function applyBuildProgress(prev: BuildStatus | null, progress: BuildProgress, now: number): BuildStatus;
function buildStatusFromConnect(progress: BuildProgress | undefined, now: number): BuildStatus | null;
```

- `startBuildStatus` returns `startedAt: now`, step 0, `thinking`.
- `applyBuildProgress` takes the step and activity from the progress and keeps `prev.startedAt`, so network jitter cannot move the clock back. It uses `now - progress.elapsedMs` only when `prev` is `null`.
- `buildStatusFromConnect` returns `startedAt: now - progress.elapsedMs` with the snapshot's step and activity, or `null` when there is no snapshot.

`startedAt` is on the browser's clock. `use-chat.ts` holds `buildStatus: BuildStatus | null`, passes its setter to the message handler, and returns `buildStatus`.

`handle-websocket-message.ts` sets it:

| Message | Effect |
|---|---|
| `generation_started`, Think apps only | `startBuildStatus(Date.now())` |
| `build_progress` | `applyBuildProgress(prev, message.progress, Date.now())` |
| `agent_connected` | `buildStatusFromConnect(message.buildProgress, Date.now())`. A tab that reconnects after the build ended shows no stale bar. |
| `generation_complete` | `null` |

### Bar component

`src/components/BuildProgressBar.tsx` takes `status: BuildStatus | null` and renders nothing for `null`. `chat.tsx` renders it first in `aboveContent`.

- `useElapsedSeconds(startedAt)` ticks once a second inside the bar. Only the bar re-renders each second, not the chat page.
- The clock uses `formatElapsedTime` from `src/routes/chat/hooks/use-debug-session.ts`, extended to `h:mm:ss` from 3,600 seconds. The debug bubble shares the change.
- The activity label comes from a new exported helper in `src/routes/chat/utils/tool-display.ts`, `getToolActivityLabel(name, args)`: the start verb and detail without an ellipsis. `getToolSummary` builds its start-status text from the same verb and detail functions, so its output is unchanged.
- The bar has `role="status"`. Only the activity line is an `aria-live="polite"` region, so screen readers announce a new activity but not the clock every second.

## Error handling

| Case | Behavior |
|---|---|
| Malformed or cut-off tool arguments | The scanner keeps what it has; `tool-input-available` replaces the path and count with the final values |
| A tracker exception | Logged once; no more progress for that build; the build continues |
| Several tool calls in one step | Activity follows the most recent open call; `thinking` only when none are open |
| Provider failure or Stop | `build()` exits and drops the tracker; `generation_complete` clears the bar; the failure card, if any, takes the slot |
| No `build_progress` arrives (a provider that sends no argument deltas, or an older server during a deploy) | The bar shows from `generation_started` with the local clock and `Thinking…` |
| Model sends `content` before `path` | `Writing file · 340 lines` until the path arrives |
| Provider sends all the arguments in one chunk (Gemini can) | The path and count appear at once |
| Durable Object restarts mid-build | `agent_connected` has no snapshot, so the bar clears; the existing auto-resume starts a new build and the bar returns at 0:00 |
| Two tabs | Each receives every broadcast and computes `startedAt` from its own clock |
| `write` with empty content, or `edit` | No line count |

## Testing

- **Scanner** (`worker/agents/think/build-progress.test.ts`):
  - the path, including one split across deltas;
  - the line count;
  - an escape split across deltas;
  - `\\n` and `\uXXXX` not counted as newlines;
  - `content` before `path`;
  - malformed input does not throw.
- **Tracker** (same file, injected clock):
  - steps counted from `start-step`;
  - activity transitions;
  - parallel calls through the open-call set;
  - `tool-input-available` overrides the streamed values;
  - `edit` has no line count;
  - `elapsedMs` comes from the clock;
  - an immediate snapshot on a step, tool or path change;
  - line-only changes at most once per 1,000 ms.
- **Browser state** (`src/routes/chat/utils/build-status.test.ts`):
  - start;
  - progress keeping `startedAt`;
  - progress with no previous status;
  - connect with and without a snapshot.
- **Wording:**
  - `getToolActivityLabel` for `write`, `edit` and an unknown tool;
  - `getToolSummary` output unchanged;
  - `formatElapsedTime` for `0:05`, `59:59` and `1:00:00`.
- **Wiring guards** (source text, like `model-wiring.test.ts` and `model-picker-guard.test.ts`):
  - `translateChunk` feeds the tracker;
  - `build()` clears it in `finally`;
  - `agent_connected` includes `buildProgress`;
  - the handler covers `build_progress`;
  - `chat.tsx` renders `BuildProgressBar` before `ModelUnavailableNotice`.
- **Live**, after deploy, one Sonnet build on estori.app:
  - the file names and line counts move during long steps;
  - the final step number matches the AI Gateway request count;
  - a reload mid-build keeps the elapsed time;
  - the bar clears on completion, on Stop, and when the failure card appears.

## Out of scope

- Streaming file content into the code editor.
- Any estimate of the time remaining.
- Credits used, or the model name, in the bar.
