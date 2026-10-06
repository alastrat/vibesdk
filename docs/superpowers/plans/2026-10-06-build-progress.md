# Build Progress Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a status bar above the chat input while a Think build runs, with the step number, the elapsed time, and the current activity (thinking, writing a file with its line count so far, or another tool).

**Architecture:** The Think host already receives every AI SDK UI stream chunk from the ThinkAgent. A pure `BuildProgressTracker` reads `start-step` and the streaming tool-call chunks, including the partial JSON of `write` arguments, and returns throttled `BuildProgress` snapshots. The host broadcasts them as `build_progress` and sends the current one with `agent_connected`. The browser keeps a `BuildStatus` with a local start time, and a `BuildProgressBar` ticks its own clock.

**Tech Stack:** Cloudflare Workers and Durable Objects, AI SDK 6 UI message stream chunks, React 19, Tailwind with Kumo tokens, lucide-react, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-06-build-progress-design.md`

## Global Constraints

- **Types:**
  - Never use `any`. The frontend imports shared types from `@/api-types`.
  - The message type is `build_progress` and the constant is `WebSocketMessageResponses.BUILD_PROGRESS`.
  - `BuildActivity` and `BuildProgress` live in `worker/api/websocketTypes.ts`.
- **Values:**
  - Line-count-only snapshots go out at most once per 1,000 ms (`LINE_UPDATE_INTERVAL_MS`).
  - The clock reads `m:ss`, switching to `h:mm:ss` from 3,600 seconds.
  - Paths are sent without leading slashes.
- **Agent state:** the tracker lives in memory only. Never put build progress in agent state (`setState`).
- **Comments and indentation:**
  - Comments explain purpose, concisely. No emojis anywhere.
  - Match each file's indentation: tabs in `think.ts`, `use-chat.ts`, `chat.tsx`, `tool-display.ts` and new files; 4 spaces in `base.ts`, `codingAgent.ts`, `constants.ts` and `handle-websocket-message.ts`.
- **Tests and checks:**
  - Run only the test files a step names: `npx vitest run <files>`. On macOS the full suite can leave orphaned `workerd` processes and exhaust ports (`EADDRNOTAVAIL`).
  - Typecheck is `npm run typecheck`. The baseline has exactly 4 errors, all in `packages/artifacts-viewer`; any other error is a failure.
- **Commits:**
  - Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Stage only the files a task names.
  - Subjects are lowercase conventional commits, and every message ends with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Out of scope:** no new dependencies, no pushes and no deploys.

## Review Focus

These are the failure modes most likely to bite a user that the spec implies but does not spell out:

1. **A background tab:** when the user returns, the clock must show the true elapsed time. It is computed from the start time, never by counting ticks. *Task 7 guard: the hook computes from `now - startedAt`.*
2. **Message volume:** a build sends a progress message every second, which must not flood the browser console and debug panel. *Task 6 guard: the logging filter skips `build_progress`.*
3. **Unexpected chunks:** chunks with missing ids, or deltas for calls the tracker never saw, must never throw in the host's chunk path. *Task 2 test: "ignores chunks it does not track and malformed ones".*
4. **A second build in the same chat:** it must restart the clock at 0:00, not continue the previous build's time. *Task 6 guard: `generation_started` always sets a fresh status. Task 7 guard: the hook clamps to 0 and resets on a new `startedAt`.*
5. **Reconnecting after the build finished:** this must not leave a stale bar. *Task 5 test: connecting without a snapshot gives `null`. Task 6 guard: the status is set on every `agent_connected`, not only the first.*

---

### Task 1: Tool argument scanner

**Files:**
- Create: `worker/agents/think/build-progress.ts`
- Test: `worker/agents/think/build-progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `class ToolInputScanner { push(delta: string): void; get path(): string | undefined; get lines(): number }`, exported from `worker/agents/think/build-progress.ts`.

- [ ] **Step 1: Write the failing test**

Create `worker/agents/think/build-progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ToolInputScanner } from './build-progress';

function scan(...deltas: string[]): ToolInputScanner {
	const scanner = new ToolInputScanner();
	for (const delta of deltas) scanner.push(delta);
	return scanner;
}

describe('ToolInputScanner', () => {
	it('captures the path once its string closes', () => {
		expect(scan('{"path":"/src/App').path).toBeUndefined();
		expect(scan('{"path":"/src/App', '.tsx","content":"').path).toBe('/src/App.tsx');
	});

	it('counts the lines written to content so far', () => {
		const scanner = scan('{"path":"/a.ts","content":"');
		expect(scanner.lines).toBe(0);
		scanner.push('one\\ntwo\\nthr');
		expect(scanner.lines).toBe(3);
	});

	it('reports no lines for empty content', () => {
		expect(scan('{"path":"/a.ts","content":""}').lines).toBe(0);
	});

	it('handles an escape split across deltas', () => {
		expect(scan('{"content":"a\\', 'nb"}').lines).toBe(2);
	});

	it('does not count an escaped backslash followed by n', () => {
		// The JSON text "a\\nb" is the characters a, backslash, n, b: one line.
		expect(scan('{"content":"a\\\\nb"}').lines).toBe(1);
	});

	it('does not read the hex digits of a unicode escape as text', () => {
		// n is the letter n.
		expect(scan('{"content":"a\\u006eb"}').lines).toBe(1);
	});

	it('counts a newline written as a unicode escape', () => {
		expect(scan('{"content":"a\\u000ab"}').lines).toBe(2);
	});

	it('counts content that arrives before the path', () => {
		const scanner = scan('{"content":"x\\ny","pa');
		expect(scanner.lines).toBe(2);
		expect(scanner.path).toBeUndefined();
		scanner.push('th":"/b.ts"}');
		expect(scanner.path).toBe('/b.ts');
	});

	it('decodes escapes in the path', () => {
		expect(scan('{"path":"/src/\\u00e9t\\u00e9.ts"}').path).toBe('/src/été.ts');
	});

	it('ignores nested keys named path or content', () => {
		const scanner = scan('{"meta":{"path":"/nested","content":"a\\nb"},"path":"/top.ts"}');
		expect(scanner.path).toBe('/top.ts');
		expect(scanner.lines).toBe(0);
	});

	it('ignores path and content values that are not strings', () => {
		const scanner = scan('{"path":1,"content":null}');
		expect(scanner.path).toBeUndefined();
		expect(scanner.lines).toBe(0);
	});

	it('keeps what it has and never throws on malformed input', () => {
		const scanner = scan('{"path":"/a.ts","content":"one\\ntwo');
		expect(() => scanner.push('\\q}}]]{{')).not.toThrow();
		expect(scanner.path).toBe('/a.ts');
		expect(scanner.lines).toBe(2);
	});

	it('stops on a top-level array', () => {
		expect(() => scan('["path","/a.ts"]')).not.toThrow();
		expect(scan('["path","/a.ts"]').path).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/agents/think/build-progress.test.ts`
Expected: FAIL. The module `./build-progress` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `worker/agents/think/build-progress.ts`:

```ts
/**
 * Live progress of a Think build, read from the AI SDK UI stream chunks the
 * host already receives from the ThinkAgent.
 */

type StringRole = 'key' | 'path' | 'content' | 'other';

const SIMPLE_ESCAPES: Record<string, string> = {
	'"': '"',
	'\\': '\\',
	'/': '/',
	b: '\b',
	f: '\f',
	n: '\n',
	r: '\r',
	t: '\t',
};

/**
 * Reads streamed tool-call arguments (partial JSON) one delta at a time. It
 * captures the top-level `path` string and counts the lines of the top-level
 * `content` string without keeping the arguments. Unexpected input stops the
 * scan; what was read before stays available.
 */
export class ToolInputScanner {
	private depth = 0;
	private expectKey = false;
	private key: string | undefined;
	private inString = false;
	private role: StringRole = 'other';
	private escaped = false;
	private hex: string | null = null;
	private text = '';
	private capturedPath: string | undefined;
	private contentStarted = false;
	private newlines = 0;
	private failed = false;

	get path(): string | undefined {
		return this.capturedPath;
	}

	/** Lines in `content` so far: newlines plus one, or 0 while it is empty. */
	get lines(): number {
		return this.contentStarted ? this.newlines + 1 : 0;
	}

	push(delta: string): void {
		for (const char of delta) {
			if (this.failed) return;
			if (this.inString) this.readStringChar(char);
			else this.readStructureChar(char);
		}
	}

	private readStringChar(char: string): void {
		if (this.hex !== null) {
			this.hex += char;
			if (this.hex.length < 4) return;
			const code = Number.parseInt(this.hex, 16);
			this.hex = null;
			if (Number.isNaN(code)) {
				this.failed = true;
				return;
			}
			this.appendChar(String.fromCharCode(code));
			return;
		}
		if (this.escaped) {
			this.escaped = false;
			if (char === 'u') {
				this.hex = '';
				return;
			}
			const decoded = SIMPLE_ESCAPES[char];
			if (decoded === undefined) {
				this.failed = true;
				return;
			}
			this.appendChar(decoded);
			return;
		}
		if (char === '\\') {
			this.escaped = true;
			return;
		}
		if (char === '"') {
			this.endString();
			return;
		}
		this.appendChar(char);
	}

	private appendChar(char: string): void {
		switch (this.role) {
			case 'key':
			case 'path':
				this.text += char;
				return;
			case 'content':
				this.contentStarted = true;
				if (char === '\n') this.newlines += 1;
				return;
			default:
				return;
		}
	}

	private endString(): void {
		this.inString = false;
		if (this.role === 'key') this.key = this.text;
		else if (this.role === 'path') this.capturedPath = this.text;
		this.text = '';
	}

	private readStructureChar(char: string): void {
		switch (char) {
			case '{':
				this.depth += 1;
				if (this.depth === 1) this.expectKey = true;
				return;
			case '[':
				if (this.depth === 0) {
					this.failed = true;
					return;
				}
				this.depth += 1;
				return;
			case '}':
			case ']':
				this.depth -= 1;
				if (this.depth < 0) this.failed = true;
				return;
			case ',':
				if (this.depth === 1) this.expectKey = true;
				return;
			case ':':
				if (this.depth === 1) this.expectKey = false;
				return;
			case '"':
				this.inString = true;
				this.text = '';
				this.role = this.roleForString();
				return;
			default:
				return;
		}
	}

	private roleForString(): StringRole {
		if (this.depth !== 1) return 'other';
		if (this.expectKey) return 'key';
		if (this.key === 'path') return 'path';
		if (this.key === 'content') return 'content';
		return 'other';
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/agents/think/build-progress.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/build-progress.ts worker/agents/think/build-progress.test.ts
git commit -m "feat(think): read file path and line count from streaming tool arguments

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Progress types and tracker

**Files:**
- Modify: `worker/api/websocketTypes.ts` (`AgentConnectedMessage` near line 22; after `ModelUnavailableMessage` near line 486; the `WebSocketMessage` union ending near line 658)
- Modify: `worker/agents/constants.ts` (after `MODEL_UNAVAILABLE` near line 91)
- Modify: `src/api-types.ts` (the `worker/api/websocketTypes` export list near line 146)
- Modify: `worker/agents/think/build-progress.ts`
- Test: `worker/agents/think/build-progress.test.ts`

**Interfaces:**
- Consumes: `ToolInputScanner` from Task 1.
- Produces:
  - In `worker/api/websocketTypes.ts`:
    - `export type BuildActivity = { kind: 'thinking' } | { kind: 'tool'; toolName: string; path?: string; lines?: number }`
    - `export type BuildProgress = { elapsedMs: number; step: number; activity: BuildActivity }`
    - the `build_progress` message: `{ type: 'build_progress'; progress: BuildProgress }`
    - `AgentConnectedMessage.buildProgress?: BuildProgress`
  - `WebSocketMessageResponses.BUILD_PROGRESS`.
  - `BuildActivity` and `BuildProgress` re-exported from `@/api-types`.
  - In `worker/agents/think/build-progress.ts`:
    - `export type ProgressChunk = { type: string; [key: string]: unknown }`
    - `export const LINE_UPDATE_INTERVAL_MS = 1_000`
    - `export class BuildProgressTracker { constructor(startedAt: number); onChunk(chunk: ProgressChunk, now: number): BuildProgress | null; snapshot(now: number): BuildProgress }`

- [ ] **Step 1: Write the failing test**

In `worker/agents/think/build-progress.test.ts`, replace the import line with:

```ts
import { describe, expect, it } from 'vitest';
import { BuildProgressTracker, LINE_UPDATE_INTERVAL_MS, ToolInputScanner, type ProgressChunk } from './build-progress';
```

Append to the end of the file:

```ts
const START = 1_000_000;
const STEP: ProgressChunk = { type: 'start-step' };

function open(toolCallId: string, toolName: string): ProgressChunk {
	return { type: 'tool-input-start', toolCallId, toolName };
}

function delta(toolCallId: string, inputTextDelta: string): ProgressChunk {
	return { type: 'tool-input-delta', toolCallId, inputTextDelta };
}

function available(toolCallId: string, toolName: string, input: unknown): ProgressChunk {
	return { type: 'tool-input-available', toolCallId, toolName, input };
}

function output(toolCallId: string): ProgressChunk {
	return { type: 'tool-output-available', toolCallId, output: 'ok' };
}

describe('BuildProgressTracker', () => {
	it('counts each started step and reports the time since the build started', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.onChunk(STEP, START + 500)).toEqual({ elapsedMs: 500, step: 1, activity: { kind: 'thinking' } });
		expect(tracker.onChunk(STEP, START + 900)?.step).toBe(2);
	});

	it('reports elapsed time from the clock it is given, never below zero', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.snapshot(START + 65_000).elapsedMs).toBe(65_000);
		expect(tracker.snapshot(START - 10).elapsedMs).toBe(0);
	});

	it('reports a running tool and returns to thinking when it closes', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(STEP, START);
		expect(tracker.onChunk(open('c1', 'deploy_space'), START)?.activity).toEqual({ kind: 'tool', toolName: 'deploy_space' });
		expect(tracker.onChunk(output('c1'), START)?.activity).toEqual({ kind: 'thinking' });
	});

	it('reads the path and line count of a write while it streams', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		const progress = tracker.onChunk(delta('c1', '{"path":"/src/pages/Catalog.tsx","content":"a\\nb'), START);
		expect(progress?.activity).toEqual({ kind: 'tool', toolName: 'write', path: 'src/pages/Catalog.tsx', lines: 2 });
	});

	it('replaces streamed values with the final input', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		tracker.onChunk(delta('c1', '{"path":"/draft.ts","content":"a'), START);
		tracker.onChunk(available('c1', 'write', { path: '/src/App.tsx', content: 'a\nb\nc' }), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'write', path: 'src/App.tsx', lines: 3 });
	});

	it('never reports a line count for edit', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'edit'), START);
		tracker.onChunk(delta('c1', '{"path":"/src/App.tsx","content":"a\\nb"'), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' });
		tracker.onChunk(available('c1', 'edit', { path: '/src/App.tsx', old_string: 'a', new_string: 'b\nc' }), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' });
	});

	it('omits the line count of an empty write', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		tracker.onChunk(available('c1', 'write', { path: '/a.ts', content: '' }), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'write', path: 'a.ts' });
	});

	it('takes the path of other tools from their final input', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'read'), START);
		tracker.onChunk(available('c1', 'read', { path: '/src/App.tsx' }), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'read', path: 'src/App.tsx' });
	});

	it('follows the most recent call that is still open', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		tracker.onChunk(available('c1', 'write', { path: '/a.ts', content: 'x' }), START);
		tracker.onChunk(open('c2', 'deploy_space'), START);
		tracker.onChunk(available('c2', 'deploy_space', {}), START);
		tracker.onChunk(output('c1'), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'deploy_space' });
		tracker.onChunk({ type: 'tool-output-error', toolCallId: 'c2', errorText: 'failed' }, START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'thinking' });
	});

	it('returns to an earlier call when a later one closes first', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		tracker.onChunk(available('c1', 'write', { path: '/a.ts', content: 'x' }), START);
		tracker.onChunk(open('c2', 'read'), START);
		tracker.onChunk(output('c2'), START);
		expect(tracker.snapshot(START).activity).toEqual({ kind: 'tool', toolName: 'write', path: 'a.ts', lines: 1 });
	});

	it('opens a call that arrives complete without a start chunk', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.onChunk(available('c1', 'read', { path: '/a.ts' }), START)?.activity).toEqual({
			kind: 'tool',
			toolName: 'read',
			path: 'a.ts',
		});
	});

	it('ignores chunks it does not track and malformed ones', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.onChunk({ type: 'text-delta', id: 't', delta: 'hi' }, START)).toBeNull();
		expect(() => tracker.onChunk({ type: 'tool-input-start' }, START)).not.toThrow();
		expect(tracker.onChunk({ type: 'tool-input-start' }, START)).toBeNull();
		expect(tracker.onChunk(delta('unknown', 'x'), START)).toBeNull();
		expect(tracker.onChunk(output('unknown'), START)).toBeNull();
		expect(tracker.onChunk(available('c1', 'write', 'not an object'), START)?.activity).toEqual({ kind: 'tool', toolName: 'write' });
		expect(tracker.snapshot(START).step).toBe(0);
	});

	it('sends at once when the step, tool or path changes', () => {
		const tracker = new BuildProgressTracker(START);
		expect(tracker.onChunk(STEP, START)).not.toBeNull();
		expect(tracker.onChunk(open('c1', 'write'), START)).not.toBeNull();
		expect(tracker.onChunk(delta('c1', '{"path":"/a.ts",'), START)).not.toBeNull();
		expect(tracker.onChunk(output('c1'), START)).not.toBeNull();
		expect(tracker.onChunk(STEP, START)).not.toBeNull();
	});

	it(`sends line-count-only changes at most once per ${LINE_UPDATE_INTERVAL_MS} ms`, () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		expect(tracker.onChunk(delta('c1', '{"path":"/a.ts","content":"1'), START)).not.toBeNull();
		expect(tracker.onChunk(delta('c1', '\\n2'), START + 400)).toBeNull();
		expect(tracker.onChunk(delta('c1', '\\n3'), START + 999)).toBeNull();
		expect(tracker.onChunk(delta('c1', '\\n4'), START + 1_000)?.activity).toEqual({
			kind: 'tool',
			toolName: 'write',
			path: 'a.ts',
			lines: 4,
		});
	});

	it('does not repeat a snapshot that has not changed', () => {
		const tracker = new BuildProgressTracker(START);
		tracker.onChunk(open('c1', 'write'), START);
		tracker.onChunk(delta('c1', '{"path":"/a.ts","content":"1'), START);
		expect(tracker.onChunk(delta('c1', 'more text on the same line'), START + 5_000)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/agents/think/build-progress.test.ts`
Expected: FAIL. `BuildProgressTracker` is not a constructor, or the import is undefined. The 13 scanner tests still pass.

- [ ] **Step 3: Add the shared types and the message constant**

In `worker/api/websocketTypes.ts`, add a field to `AgentConnectedMessage`:

```ts
type AgentConnectedMessage = {
    type: 'agent_connected';
    state: AgentState;
    templateDetails: TemplateDetails;
    previewUrl?: string;
    /** Live progress when a Think build is running. */
    buildProgress?: BuildProgress;
};
```

Directly after the `ModelUnavailableMessage` line, add:

```ts
/** What a running Think build is doing right now. */
export type BuildActivity =
	| { kind: 'thinking' }
	| { kind: 'tool'; toolName: string; path?: string; lines?: number };

/** A snapshot of a running Think build. */
export type BuildProgress = {
	/** Milliseconds since the build started, measured on the server when sent. */
	elapsedMs: number;
	/** Model calls started in this build; 0 before the first. */
	step: number;
	activity: BuildActivity;
};

type BuildProgressMessage = { type: 'build_progress'; progress: BuildProgress };
```

In the `WebSocketMessage` union, replace the last member line `| ModelUnavailableMessage;` with:

```ts
	| ModelUnavailableMessage
	| BuildProgressMessage;
```

In `worker/agents/constants.ts`, after `MODEL_UNAVAILABLE: 'model_unavailable',` add:

```ts

    // Live progress of a running build (think only)
    BUILD_PROGRESS: 'build_progress',
```

In `src/api-types.ts`, add the two types to the `worker/api/websocketTypes` export list:

```ts
// WebSocket Types
export type {
  WebSocketMessage,
  WebSocketMessageData,
  CodeFixEdits,
  ModelConfigsInfoMessage,
  AgentDisplayConfig,
  ModelConfigsInfo,
  CloudflareDeploymentErrorCode,
  BuildActivity,
  BuildProgress,
} from 'worker/api/websocketTypes';
```

- [ ] **Step 4: Write the tracker**

In `worker/agents/think/build-progress.ts`, add this import directly after the file's top doc comment:

```ts
import type { BuildActivity, BuildProgress } from '../../api/websocketTypes';
```

Append to the end of the file:

```ts
/** A UI message stream chunk as the host receives it. */
export type ProgressChunk = { type: string; [key: string]: unknown };

/** Snapshots that change only the line count are sent at most this often. */
export const LINE_UPDATE_INTERVAL_MS = 1_000;

/** Tools whose streamed arguments are scanned for a path and line count. */
const SCANNED_TOOLS = new Set(['write', 'edit']);

interface OpenCall {
	toolName: string;
	scanner?: ToolInputScanner;
	/** Final values from `tool-input-available`; they replace the scanner's. */
	path?: string;
	lines?: number;
}

/**
 * Tracks one build's step count and current activity from stream chunks, and
 * decides when a snapshot is worth broadcasting.
 */
export class BuildProgressTracker {
	private step = 0;
	/** Open tool calls in the order they opened. */
	private readonly calls = new Map<string, OpenCall>();
	private lastSent: { key: string; lines: number | undefined; at: number } | undefined;

	constructor(private readonly startedAt: number) {}

	/** Applies one chunk; returns a snapshot when it should be broadcast, otherwise null. */
	onChunk(chunk: ProgressChunk, now: number): BuildProgress | null {
		if (!this.apply(chunk)) return null;
		const progress = this.snapshot(now);
		const { activity } = progress;
		const key =
			activity.kind === 'tool'
				? `${progress.step}|tool|${activity.toolName}|${activity.path ?? ''}`
				: `${progress.step}|thinking`;
		const lines = activity.kind === 'tool' ? activity.lines : undefined;
		const last = this.lastSent;
		if (last && last.key === key && (last.lines === lines || now - last.at < LINE_UPDATE_INTERVAL_MS)) {
			return null;
		}
		this.lastSent = { key, lines, at: now };
		return progress;
	}

	/** The current snapshot, for a tab that connects mid-build. */
	snapshot(now: number): BuildProgress {
		return { elapsedMs: Math.max(0, now - this.startedAt), step: this.step, activity: this.activity() };
	}

	private apply(chunk: ProgressChunk): boolean {
		switch (chunk.type) {
			case 'start-step':
				this.step += 1;
				return true;
			case 'tool-input-start': {
				const { toolCallId, toolName } = chunk;
				if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return false;
				this.calls.set(toolCallId, {
					toolName,
					scanner: SCANNED_TOOLS.has(toolName) ? new ToolInputScanner() : undefined,
				});
				return true;
			}
			case 'tool-input-delta': {
				const call = typeof chunk.toolCallId === 'string' ? this.calls.get(chunk.toolCallId) : undefined;
				if (!call?.scanner || typeof chunk.inputTextDelta !== 'string') return false;
				call.scanner.push(chunk.inputTextDelta);
				return true;
			}
			case 'tool-input-available': {
				const { toolCallId, toolName, input } = chunk;
				if (typeof toolCallId !== 'string' || typeof toolName !== 'string') return false;
				const call = this.calls.get(toolCallId) ?? { toolName };
				const args = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
				call.path = typeof args.path === 'string' && args.path.length > 0 ? args.path : undefined;
				call.lines = toolName === 'write' && typeof args.content === 'string' ? countLines(args.content) : undefined;
				call.scanner = undefined;
				this.calls.set(toolCallId, call);
				return true;
			}
			case 'tool-output-available':
			case 'tool-output-error':
				return typeof chunk.toolCallId === 'string' && this.calls.delete(chunk.toolCallId);
			default:
				return false;
		}
	}

	private activity(): BuildActivity {
		let current: OpenCall | undefined;
		for (const call of this.calls.values()) current = call;
		if (!current) return { kind: 'thinking' };
		const path = current.path ?? current.scanner?.path;
		const lines = current.toolName === 'write' ? (current.lines ?? current.scanner?.lines) : undefined;
		return {
			kind: 'tool',
			toolName: current.toolName,
			...(path ? { path: path.replace(/^\/+/, '') } : {}),
			...(lines ? { lines } : {}),
		};
	}
}

function countLines(content: string): number {
	return content.length === 0 ? 0 : content.split('\n').length;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/build-progress.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors, all in `packages/artifacts-viewer`.

- [ ] **Step 7: Commit**

```bash
git add worker/api/websocketTypes.ts worker/agents/constants.ts src/api-types.ts worker/agents/think/build-progress.ts worker/agents/think/build-progress.test.ts
git commit -m "feat(think): track build steps and activity as throttled progress snapshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Host wiring

**Files:**
- Modify: `worker/agents/core/behaviors/think.ts`:
  - the import at line 37;
  - a class field after `getBehavior()` near line 119;
  - `build()` near line 482;
  - a new method directly above `translateChunk` near line 598;
  - the first line of `translateChunk`'s body.
- Modify: `worker/agents/core/behaviors/base.ts` (import at line 20; new method after `getTotalFiles()` near line 570)
- Modify: `worker/agents/core/codingAgent.ts` (the `AGENT_CONNECTED` send near line 284)
- Test: `worker/agents/think/build-progress-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `BuildProgressTracker` from Task 2: `onChunk(chunk, now)` and `snapshot(now)`;
  - `WebSocketMessageResponses.BUILD_PROGRESS`;
  - the `BuildProgress` type;
  - `AgentConnectedMessage.buildProgress`.
- Produces:
  - `BaseCodingBehavior.getBuildProgress(): BuildProgress | null`, which returns `null`;
  - `ThinkCodingBehavior.getBuildProgress()`, which returns the live snapshot;
  - `build_progress` broadcasts during Think builds;
  - `agent_connected` carrying `buildProgress` mid-build.

- [ ] **Step 1: Write the failing guard test**

Create `worker/agents/think/build-progress-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/behaviors/base.ts',
		'/worker/agents/core/codingAgent.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

const THINK = '/worker/agents/core/behaviors/think.ts';

describe('build progress wiring', () => {
	it('tracks one build from start to finish', () => {
		const build = between(source(THINK), 'async build(): Promise<void> {', 'private async runPrompt(');
		expect(build).toContain('this.buildProgress = new BuildProgressTracker(Date.now());');
		expect(build).toMatch(/finally \{\s*this\.buildProgress = null;/);
	});

	it('feeds every stream chunk to the tracker before translating it', () => {
		const translate = between(source(THINK), 'private async translateChunk(', 'switch (chunk.type)');
		expect(translate).toContain('this.trackBuildProgress(chunk);');
	});

	it('broadcasts snapshots and turns progress off after a tracker failure', () => {
		const track = between(source(THINK), 'private trackBuildProgress(', 'private async translateChunk(');
		expect(track).toContain('WebSocketMessageResponses.BUILD_PROGRESS');
		expect(track).toMatch(/catch \(/);
		expect(track).toContain('this.buildProgress = null;');
	});

	it('keeps progress out of agent state', () => {
		expect(source(THINK)).not.toMatch(/setState\([^)]*buildProgress/);
	});

	it('reports no progress for other build modes', () => {
		expect(source('/worker/agents/core/behaviors/base.ts')).toMatch(
			/getBuildProgress\(\): BuildProgress \| null \{\s*return null;/,
		);
	});

	it('sends the snapshot to a tab that connects mid-build', () => {
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain('const buildProgress = this.behavior.getBuildProgress();');
		expect(between(agent, 'WebSocketMessageResponses.AGENT_CONNECTED', '});')).toContain(
			'...(buildProgress ? { buildProgress } : {}),',
		);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/agents/think/build-progress-wiring.test.ts`
Expected: FAIL in 5 tests: the missing markers or strings (`private trackBuildProgress(` and the others). "keeps progress out of agent state" passes.

- [ ] **Step 3: Wire the Think host**

In `worker/agents/core/behaviors/think.ts`:

1. Replace the import at line 37:

```ts
import type { BuildProgress, CloudflareDeploymentErrorCode } from '../../../api/websocketTypes';
```

and add, directly after the `import { resolveGatewayAuth } from '../../think/gateway-auth';` line:

```ts
import { BuildProgressTracker } from '../../think/build-progress';
```

2. Directly after `override getBehavior(): 'think' { return 'think'; }`, add:

```ts

	/** Progress of the running build. In memory only, so it never churns agent state. */
	private buildProgress: BuildProgressTracker | null = null;

	override getBuildProgress(): BuildProgress | null {
		return this.buildProgress?.snapshot(Date.now()) ?? null;
	}
```

3. Replace the whole `build()` method with:

```ts
	async build(): Promise<void> {
		this.buildProgress = new BuildProgressTracker(Date.now());
		try {
			if (!this.isMVPGenerated() && this.state.query && this.state.pendingUserInputs.length === 0) {
				this.setState({ ...this.state, pendingUserInputs: [this.state.query] });
			}

			while (this.state.pendingUserInputs.length > 0) {
				const pending = this.state.pendingUserInputs.slice();
				this.setState({ ...this.state, pendingUserInputs: [] });

				const compiled = pending.join('\n');
				let completed: boolean;
				try {
					completed = await this.runPrompt(compiled);
				} catch (e) {
					this.logger.error('Think prompt failed', e);
					await this.reportTurnError(e instanceof Error ? e.message : String(e));
					break;
				}

				if (!this.isMVPGenerated()) {
					this.setMVPGenerated();
				}

				// Inputs still queued wait for the resume or the next message, which runs
				// them on whichever model the user picks after the failure.
				if (!completed) break;

				// Commits (and deploys) are driven entirely by the model: it calls the
				// `commit` tool to snapshot a restore point when it decides, and
				// `deploy_space` to build/preview. The harness does neither on its own.
			}
		} finally {
			this.buildProgress = null;
		}
	}
```

4. Directly above `private async translateChunk(`, add:

```ts
	/** Feeds a chunk to the build's tracker and broadcasts any snapshot it returns. */
	private trackBuildProgress(chunk: ThinkChunk): void {
		const tracker = this.buildProgress;
		if (!tracker) return;
		try {
			const progress = tracker.onChunk(chunk, Date.now());
			if (progress) this.broadcast(WebSocketMessageResponses.BUILD_PROGRESS, { progress });
		} catch (e) {
			this.logger.warn('Build progress tracking failed; progress is off for the rest of this build', e);
			this.buildProgress = null;
		}
	}

```

5. Make the first statement of `translateChunk`'s body, before `switch (chunk.type) {`:

```ts
		this.trackBuildProgress(chunk);
```

- [ ] **Step 4: Add the base default and the connect snapshot**

In `worker/agents/core/behaviors/base.ts`, replace line 20 with:

```ts
import { BuildProgress, WebSocketMessageData, WebSocketMessageType } from '../../../api/websocketTypes';
```

and, directly after the `getTotalFiles()` method, add:

```ts

    /** Live progress of the running build, for tabs that connect mid-build. */
    getBuildProgress(): BuildProgress | null {
        return null;
    }
```

In `worker/agents/core/codingAgent.ts`, replace the `AGENT_CONNECTED` send with:

```ts
            const buildProgress = this.behavior.getBuildProgress();
            sendToConnection(connection, WebSocketMessageResponses.AGENT_CONNECTED, {
                state: this.state,
                templateDetails: this.behavior.getTemplateDetails(),
                previewUrl: previewUrl,
                ...(buildProgress ? { buildProgress } : {}),
            });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/build-progress-wiring.test.ts worker/agents/think/build-progress.test.ts worker/agents/think/model-wiring.test.ts`
Expected: PASS. 6 wiring tests, 28 progress tests, and every `model-wiring` test.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors, all in `packages/artifacts-viewer`.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/core/behaviors/think.ts worker/agents/core/behaviors/base.ts worker/agents/core/codingAgent.ts worker/agents/think/build-progress-wiring.test.ts
git commit -m "feat(think): broadcast build progress and send it to tabs that connect mid-build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Activity label and elapsed time format

**Files:**
- Modify: `src/routes/chat/utils/tool-display.ts` (`detailFor` at line 119, `getToolSummary` at line 214)
- Modify: `src/routes/chat/hooks/use-debug-session.ts` (`formatElapsedTime` at line 81)
- Test: `src/routes/chat/utils/tool-display.test.ts`
- Test: `src/routes/chat/hooks/use-debug-session.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `getToolActivityLabel(name: string, args?: Record<string, unknown>): string`, exported from `src/routes/chat/utils/tool-display.ts`;
  - `formatElapsedTime(seconds: number): string`, which now switches to `h:mm:ss` from 3,600.

- [ ] **Step 1: Write the failing tests**

In `src/routes/chat/utils/tool-display.test.ts`, add `getToolActivityLabel,` to the import list from `./tool-display` and append:

```ts
describe('getToolActivityLabel', () => {
	it('names a running write with its path and no ellipsis', () => {
		expect(getToolActivityLabel('write', { path: 'src/pages/Catalog.tsx' })).toBe('Writing src/pages/Catalog.tsx');
	});

	it('says "file" for writes and edits before the path is known', () => {
		expect(getToolActivityLabel('write')).toBe('Writing file');
		expect(getToolActivityLabel('edit')).toBe('Editing file');
	});

	it('shortens long paths', () => {
		expect(getToolActivityLabel('edit', { path: 'src/components/really/deep/folder/structure/Component.tsx' })).toBe(
			'Editing …/structure/Component.tsx',
		);
	});

	it('uses the same verbs as the tool rows', () => {
		expect(getToolActivityLabel('deploy_space')).toBe('Deploying');
		expect(getToolActivityLabel('read')).toBe('Reading');
		expect(getToolActivityLabel('custom_tool')).toBe('Running custom tool');
	});
});
```

Create `src/routes/chat/hooks/use-debug-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatElapsedTime } from './use-debug-session';

describe('formatElapsedTime', () => {
	it('shows minutes and seconds under an hour', () => {
		expect(formatElapsedTime(5)).toBe('0:05');
		expect(formatElapsedTime(192)).toBe('3:12');
		expect(formatElapsedTime(3599)).toBe('59:59');
	});

	it('adds hours from one hour', () => {
		expect(formatElapsedTime(3600)).toBe('1:00:00');
		expect(formatElapsedTime(3725)).toBe('1:02:05');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/chat/utils/tool-display.test.ts src/routes/chat/hooks/use-debug-session.test.ts`
Expected: FAIL.
- `getToolActivityLabel` is not a function.
- `formatElapsedTime(3600)` returns `'60:00'`.
- The existing `getToolSummary` tests still pass.

- [ ] **Step 3: Implement the label helper**

In `src/routes/chat/utils/tool-display.ts`:

1. Change the `detailFor` signature and its first lines from

```ts
function detailFor(event: ToolEvent): string | undefined {
	const { name, args } = event;
	const path = pickToolPath(args);
```

to

```ts
function detailFor(name: string, args?: Record<string, unknown>): string | undefined {
	const path = pickToolPath(args);
```

2. In `getToolSummary`, change `const detail = detailFor(event);` to `const detail = detailFor(event.name, event.args);`.

3. Directly after `getToolSummary`, add:

```ts

/** Tools whose running label names a file even before its path is known. */
const FILE_ACTIVITY_TOOLS = new Set(['write', 'edit']);

/**
 * Running label without the trailing ellipsis, for the build progress bar.
 * e.g. "Writing src/App.tsx", "Writing file", "Deploying"
 */
export function getToolActivityLabel(name: string, args?: Record<string, unknown>): string {
	const verb = verbFor(name, 'start');
	const detail = detailFor(name, args) ?? (FILE_ACTIVITY_TOOLS.has(name) ? pathLabel(undefined) : undefined);
	return detail ? `${verb} ${detail}` : verb;
}
```

- [ ] **Step 4: Extend the elapsed time format**

In `src/routes/chat/hooks/use-debug-session.ts`, replace `formatElapsedTime` and its doc comment with:

```ts
/**
 * Format elapsed time as M:SS, or H:MM:SS from one hour.
 */
export function formatElapsedTime(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const mins = Math.floor((seconds % 3600) / 60);
	const secs = (seconds % 60).toString().padStart(2, '0');
	if (hours === 0) return `${mins}:${secs}`;
	return `${hours}:${mins.toString().padStart(2, '0')}:${secs}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/routes/chat/utils/tool-display.test.ts src/routes/chat/hooks/use-debug-session.test.ts`
Expected: PASS. All the existing `tool-display` tests, 4 new label tests, and 2 format tests.

- [ ] **Step 6: Commit**

```bash
git add src/routes/chat/utils/tool-display.ts src/routes/chat/utils/tool-display.test.ts src/routes/chat/hooks/use-debug-session.ts src/routes/chat/hooks/use-debug-session.test.ts
git commit -m "feat(chat): add a running tool label and hour-long elapsed times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser build status

**Files:**
- Create: `src/routes/chat/utils/build-status.ts`
- Test: `src/routes/chat/utils/build-status.test.ts`

**Interfaces:**
- Consumes:
  - `BuildActivity` and `BuildProgress` from `@/api-types` (Task 2);
  - `getToolActivityLabel` and `formatElapsedTime` (Task 4).
- Produces, from `src/routes/chat/utils/build-status.ts`:
  - `export type BuildStatus = { startedAt: number; step: number; activity: BuildActivity }`
  - `startBuildStatus(now: number): BuildStatus`
  - `applyBuildProgress(prev: BuildStatus | null, progress: BuildProgress, now: number): BuildStatus`
  - `buildStatusFromConnect(progress: BuildProgress | undefined, now: number): BuildStatus | null`
  - `describeBuildHeadline(step: number, elapsedSeconds: number): string`
  - `describeBuildActivity(activity: BuildActivity): string`

- [ ] **Step 1: Write the failing test**

Create `src/routes/chat/utils/build-status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BuildActivity } from '@/api-types';
import {
	applyBuildProgress,
	buildStatusFromConnect,
	describeBuildActivity,
	describeBuildHeadline,
	startBuildStatus,
} from './build-status';

const NOW = 2_000_000;
const THINKING: BuildActivity = { kind: 'thinking' };
const WRITING: BuildActivity = { kind: 'tool', toolName: 'write', path: 'src/App.tsx', lines: 12 };

describe('build status transitions', () => {
	it('starts a build at step 0, thinking, on the local clock', () => {
		expect(startBuildStatus(NOW)).toEqual({ startedAt: NOW, step: 0, activity: THINKING });
	});

	it('takes the step and activity from progress but keeps the start time', () => {
		const next = applyBuildProgress(startBuildStatus(NOW), { elapsedMs: 90_000, step: 3, activity: WRITING }, NOW + 5_000);
		expect(next).toEqual({ startedAt: NOW, step: 3, activity: WRITING });
	});

	it('derives the start time from elapsed time when no status exists', () => {
		expect(applyBuildProgress(null, { elapsedMs: 90_000, step: 3, activity: THINKING }, NOW)).toEqual({
			startedAt: NOW - 90_000,
			step: 3,
			activity: THINKING,
		});
	});

	it('restores a running build on connect', () => {
		expect(buildStatusFromConnect({ elapsedMs: 192_000, step: 4, activity: WRITING }, NOW)).toEqual({
			startedAt: NOW - 192_000,
			step: 4,
			activity: WRITING,
		});
	});

	it('clears the status on connect when no build is running', () => {
		expect(buildStatusFromConnect(undefined, NOW)).toBeNull();
	});
});

describe('build status wording', () => {
	it('hides the step until the first one starts', () => {
		expect(describeBuildHeadline(0, 3)).toBe('Building · 0:03');
		expect(describeBuildHeadline(4, 192)).toBe('Building · step 4 · 3:12');
		expect(describeBuildHeadline(14, 3725)).toBe('Building · step 14 · 1:02:05');
	});

	it('says thinking when no tool is running', () => {
		expect(describeBuildActivity(THINKING)).toBe('Thinking…');
	});

	it('names the file and its lines while writing', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/pages/Catalog.tsx', lines: 340 })).toBe(
			'Writing src/pages/Catalog.tsx · 340 lines',
		);
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1 })).toBe('Writing src/a.ts · 1 line');
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', path: 'src/a.ts', lines: 1204 })).toBe(
			'Writing src/a.ts · 1,204 lines',
		);
	});

	it('counts lines before the path is known', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'write', lines: 340 })).toBe('Writing file · 340 lines');
	});

	it('shows other tools without a count', () => {
		expect(describeBuildActivity({ kind: 'tool', toolName: 'edit', path: 'src/App.tsx' })).toBe('Editing src/App.tsx');
		expect(describeBuildActivity({ kind: 'tool', toolName: 'deploy_space' })).toBe('Deploying');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/chat/utils/build-status.test.ts`
Expected: FAIL. The module `./build-status` cannot be resolved.

- [ ] **Step 3: Write the implementation**

Create `src/routes/chat/utils/build-status.ts`:

```ts
import type { BuildActivity, BuildProgress } from '@/api-types';
import { formatElapsedTime } from '../hooks/use-debug-session';
import { getToolActivityLabel } from './tool-display';

/** A running build as the chat shows it. `startedAt` is on this browser's clock. */
export type BuildStatus = { startedAt: number; step: number; activity: BuildActivity };

export function startBuildStatus(now: number): BuildStatus {
	return { startedAt: now, step: 0, activity: { kind: 'thinking' } };
}

/**
 * Takes the step and activity from a progress message. The start time is kept
 * once known, so network jitter cannot move the clock back.
 */
export function applyBuildProgress(prev: BuildStatus | null, progress: BuildProgress, now: number): BuildStatus {
	return {
		startedAt: prev?.startedAt ?? now - progress.elapsedMs,
		step: progress.step,
		activity: progress.activity,
	};
}

/** The status for a tab that just connected: the running build, or none. */
export function buildStatusFromConnect(progress: BuildProgress | undefined, now: number): BuildStatus | null {
	return progress ? applyBuildProgress(null, progress, now) : null;
}

/** First line of the bar, e.g. "Building · step 4 · 3:12". */
export function describeBuildHeadline(step: number, elapsedSeconds: number): string {
	const clock = formatElapsedTime(elapsedSeconds);
	return step > 0 ? `Building · step ${step} · ${clock}` : `Building · ${clock}`;
}

/** Second line of the bar, e.g. "Writing src/App.tsx · 340 lines". */
export function describeBuildActivity(activity: BuildActivity): string {
	if (activity.kind === 'thinking') return 'Thinking…';
	const label = getToolActivityLabel(activity.toolName, activity.path ? { path: activity.path } : undefined);
	if (!activity.lines) return label;
	return `${label} · ${activity.lines.toLocaleString()} ${activity.lines === 1 ? 'line' : 'lines'}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/routes/chat/utils/build-status.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat/utils/build-status.ts src/routes/chat/utils/build-status.test.ts
git commit -m "feat(chat): model the running build status and its wording

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Chat state wiring

**Files:**
- Modify: `src/routes/chat/utils/handle-websocket-message.ts`:
  - the imports near line 30;
  - `HandleMessageDeps` near line 72;
  - the deps destructuring near line 159;
  - the logging filter near line 191;
  - `agent_connected` near line 211;
  - `generation_started` near line 664;
  - `generation_complete` near line 673.
- Modify: `src/routes/chat/hooks/use-chat.ts`:
  - the imports near line 34;
  - state near line 163;
  - the deps object near line 316;
  - the return object near line 891.
- Test: `src/routes/build-progress-guard.test.ts` (new)

**Interfaces:**
- Consumes: `BuildStatus`, `startBuildStatus`, `applyBuildProgress` and `buildStatusFromConnect` (Task 5); the `build_progress` message and `agent_connected.buildProgress` (Task 2).
- Produces:
  - `HandleMessageDeps.setBuildStatus: React.Dispatch<React.SetStateAction<BuildStatus | null>>`;
  - `useChat()` returning `buildStatus: BuildStatus | null`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/build-progress-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/BuildProgressBar.tsx',
		'/src/hooks/use-elapsed-seconds.ts',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

const HANDLER = '/src/routes/chat/utils/handle-websocket-message.ts';
const HOOK = '/src/routes/chat/hooks/use-chat.ts';

describe('build progress: chat state', () => {
	it('starts a fresh status whenever a think build starts', () => {
		const started = between(source(HANDLER), "case 'generation_started':", "case 'generation_complete':");
		expect(started).toContain("if (behaviorType === 'think') setBuildStatus(startBuildStatus(Date.now()));");
	});

	it('clears the status when the build ends', () => {
		const complete = between(source(HANDLER), "case 'generation_complete':", "case 'build_progress':");
		expect(complete).toContain('setBuildStatus(null);');
	});

	it('applies progress messages', () => {
		const progress = between(source(HANDLER), "case 'build_progress':", 'break;');
		expect(progress).toContain('setBuildStatus((prev) => applyBuildProgress(prev, message.progress, Date.now()));');
	});

	it('restores or clears the status on every connect, not only the first', () => {
		const connected = between(source(HANDLER), "case 'agent_connected':", 'if (!isInitialStateRestored)');
		expect(connected).toContain('setBuildStatus(buildStatusFromConnect(message.buildProgress, Date.now()));');
	});

	it('does not log every progress message', () => {
		expect(source(HANDLER)).toContain("message.type !== 'build_progress'");
	});

	it('holds the status in the chat hook and returns it', () => {
		const hook = source(HOOK);
		expect(hook).toContain('const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);');
		expect(between(hook, 'createWebSocketMessageHandler({', '} as HandleMessageDeps)')).toContain('setBuildStatus,');
		expect(hook.slice(hook.lastIndexOf('return {'))).toContain('buildStatus,');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/build-progress-guard.test.ts`
Expected: FAIL in all 6 tests, with missing markers or strings (for example "Marker not found: case 'build_progress':").

- [ ] **Step 3: Wire the handler**

In `src/routes/chat/utils/handle-websocket-message.ts`:

1. After the `import { completeStages, type ProjectStage } from './project-stage-helpers';` line, add:

```ts
import { applyBuildProgress, buildStatusFromConnect, startBuildStatus, type BuildStatus } from './build-status';
```

2. In `HandleMessageDeps`, after the `setModelUnavailable` line, add:

```ts
    setBuildStatus: React.Dispatch<React.SetStateAction<BuildStatus | null>>;
```

3. In the deps destructuring, after `setModelUnavailable,`, add `setBuildStatus,`.

4. In the logging filter, change

```ts
        if (message.type !== 'file_chunk_generated' && message.type !== 'cf_agent_state' && message.type.length <= 50) {
```

to

```ts
        if (message.type !== 'file_chunk_generated' && message.type !== 'cf_agent_state' && message.type !== 'build_progress' && message.type.length <= 50) {
```

5. In `case 'agent_connected':`, directly after the `if (state.behaviorType === 'think') { setThinkModelId(...); }` block and before `if (!isInitialStateRestored) {`, add:

```ts
                setBuildStatus(buildStatusFromConnect(message.buildProgress, Date.now()));
```

6. In `case 'generation_started':`, after `setModelUnavailable(null);`, add:

```ts
                if (behaviorType === 'think') setBuildStatus(startBuildStatus(Date.now()));
```

7. In `case 'generation_complete':`, after `setIsGenerating(false);`, add `setBuildStatus(null);`. Then add a new case directly after that case's `break; }`:

```ts

            case 'build_progress': {
                setBuildStatus((prev) => applyBuildProgress(prev, message.progress, Date.now()));
                break;
            }
```

- [ ] **Step 4: Wire the chat hook**

In `src/routes/chat/hooks/use-chat.ts`:

1. After the `import { RESUME_BUILD_MESSAGE } from '../../../../shared/think';` line, add:

```ts
import type { BuildStatus } from '../utils/build-status';
```

2. After `const [modelUnavailable, setModelUnavailable] = useState<ModelUnavailableNotice | null>(null);`, add:

```ts
	const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
```

3. In the deps object passed to the handler factory, after `setModelUnavailable,`, add `setBuildStatus,`.

4. In the returned object, after `dismissModelUnavailable,`, add `buildStatus,`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/routes/build-progress-guard.test.ts src/routes/model-picker-guard.test.ts`
Expected: PASS. All 6 build-progress guards and every model-picker guard.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: only the 4 baseline errors, all in `packages/artifacts-viewer`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/chat/utils/handle-websocket-message.ts src/routes/chat/hooks/use-chat.ts src/routes/build-progress-guard.test.ts
git commit -m "feat(chat): keep the running build status from progress and connect messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Progress bar above the chat input

**Files:**
- Create: `src/hooks/use-elapsed-seconds.ts`
- Create: `src/components/BuildProgressBar.tsx`
- Modify: `src/routes/chat/chat.tsx` (imports near line 72; the `useChat` destructuring near line 270; `aboveContent` near line 1415)
- Test: `src/routes/build-progress-guard.test.ts`

**Interfaces:**
- Consumes:
  - `BuildStatus`, `describeBuildHeadline` and `describeBuildActivity` (Task 5);
  - `buildStatus` from `useChat()` (Task 6).
- Produces:
  - `useElapsedSeconds(startedAt: number | null): number`;
  - `BuildProgressBar({ status }: { status: BuildStatus | null })`.

- [ ] **Step 1: Write the failing guard tests**

Append to `src/routes/build-progress-guard.test.ts`:

```ts
const BAR = '/src/components/BuildProgressBar.tsx';
const CHAT = '/src/routes/chat/chat.tsx';

describe('build progress: bar', () => {
	it('renders nothing without a running build', () => {
		expect(source(BAR)).toContain('if (!status) return null;');
	});

	it('ticks the clock inside the bar only', () => {
		expect(source(BAR)).toContain('useElapsedSeconds(status?.startedAt ?? null)');
		expect(source(CHAT)).not.toContain('useElapsedSeconds');
	});

	it('computes elapsed time from the start time, so background tabs stay correct', () => {
		const hook = source('/src/hooks/use-elapsed-seconds.ts');
		expect(hook).toContain('Math.max(0, Math.floor((now - startedAt) / 1000))');
		expect(hook).toContain('}, [startedAt]);');
	});

	it('announces the activity but not the clock', () => {
		const bar = source(BAR);
		expect(bar.match(/role="status"/g) ?? []).toHaveLength(1);
		const live = bar.slice(bar.indexOf('role="status"'));
		expect(live).toContain('describeBuildActivity(status.activity)');
		expect(live).not.toContain('describeBuildHeadline');
	});

	it('shows the bar above the chat input, before the failure card', () => {
		const above = source(CHAT).slice(source(CHAT).indexOf('aboveContent={'));
		expect(above).toContain('<BuildProgressBar status={buildStatus} />');
		expect(above.indexOf('<BuildProgressBar')).toBeLessThan(above.indexOf('<ModelUnavailableNotice'));
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/build-progress-guard.test.ts`
Expected: FAIL in the 5 new tests with "Source not found: /src/components/BuildProgressBar.tsx" or "Source not found: /src/hooks/use-elapsed-seconds.ts", or a missing string in `chat.tsx`. The 6 chat-state guards still pass.

- [ ] **Step 3: Write the elapsed-seconds hook**

Create `src/hooks/use-elapsed-seconds.ts`:

```ts
import { useEffect, useState } from 'react';

/**
 * Whole seconds since `startedAt`, re-rendering once a second; 0 while
 * `startedAt` is null. Computed from the clock rather than counted, so a
 * throttled background tab shows the right time when it returns.
 */
export function useElapsedSeconds(startedAt: number | null): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (startedAt === null) return;
		setNow(Date.now());
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [startedAt]);

	return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}
```

- [ ] **Step 4: Write the bar component**

Create `src/components/BuildProgressBar.tsx`:

```tsx
import { LoaderCircle } from 'lucide-react';
import { useElapsedSeconds } from '@/hooks/use-elapsed-seconds';
import { describeBuildActivity, describeBuildHeadline, type BuildStatus } from '@/routes/chat/utils/build-status';

interface BuildProgressBarProps {
	status: BuildStatus | null;
}

/** Step, elapsed time and current activity of a running Think build. */
export function BuildProgressBar({ status }: BuildProgressBarProps) {
	const elapsedSeconds = useElapsedSeconds(status?.startedAt ?? null);
	if (!status) return null;

	return (
		<div className="mb-2 rounded-lg border border-kumo-line bg-kumo-elevated px-3 py-2 text-sm">
			<p className="text-xs font-medium tabular-nums text-kumo-subtle">
				{describeBuildHeadline(status.step, elapsedSeconds)}
			</p>
			<div className="mt-1 flex min-w-0 items-center gap-2">
				<LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-kumo-brand" />
				<p role="status" className="min-w-0 truncate text-kumo-strong">
					{describeBuildActivity(status.activity)}
				</p>
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Render the bar in the chat**

In `src/routes/chat/chat.tsx`:

1. After `import { ModelUnavailableNotice } from '@/components/ModelUnavailableNotice';`, add:

```tsx
import { BuildProgressBar } from '@/components/BuildProgressBar';
```

2. In the `useChat` destructuring, replace

```tsx
		dismissModelUnavailable,
		isWebSocketOpen,
	} = useChat({
```

with

```tsx
		dismissModelUnavailable,
		isWebSocketOpen,
		buildStatus,
	} = useChat({
```

3. In `aboveContent={ <> … </> }`, make the bar the first child, directly before `<ModelUnavailableNotice`:

```tsx
									<BuildProgressBar status={buildStatus} />
```

- [ ] **Step 6: Run every test this plan touches**

Run: `npx vitest run src/routes/build-progress-guard.test.ts src/routes/model-picker-guard.test.ts src/routes/chat/utils/build-status.test.ts src/routes/chat/utils/tool-display.test.ts src/routes/chat/hooks/use-debug-session.test.ts worker/agents/think/build-progress.test.ts worker/agents/think/build-progress-wiring.test.ts worker/agents/think/model-wiring.test.ts`
Expected: PASS in all 8 files, with 11 build-progress guards.

- [ ] **Step 7: Typecheck and lint**

Run: `npm run typecheck`
Expected: only the 4 baseline errors, all in `packages/artifacts-viewer`.

Run: `npx eslint src/components/BuildProgressBar.tsx src/hooks/use-elapsed-seconds.ts src/routes/chat/chat.tsx src/routes/chat/hooks/use-chat.ts src/routes/chat/utils/handle-websocket-message.ts src/routes/chat/utils/build-status.ts src/routes/chat/utils/tool-display.ts src/routes/chat/hooks/use-debug-session.ts worker/agents/think/build-progress.ts worker/agents/core/behaviors/think.ts`
Expected: 0 errors. Warnings that already exist on unchanged lines are acceptable; none may come from lines this plan added.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/use-elapsed-seconds.ts src/components/BuildProgressBar.tsx src/routes/chat/chat.tsx src/routes/build-progress-guard.test.ts
git commit -m "feat(chat): show build step, elapsed time and activity above the chat input

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the plan

The live checks in the spec need a deploy, which needs the owner's go-ahead. They are not part of this plan's tasks.
