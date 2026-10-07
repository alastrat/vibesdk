/**
 * Live progress of a Think build, read from the AI SDK UI stream chunks the
 * host already receives from the ThinkAgent.
 */

import type { BuildActivity, BuildProgress } from '../../api/websocketTypes';

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
				// A step only starts after every tool result of the one before, so a call
				// still open here was orphaned by an interrupted stream.
				this.calls.clear();
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
