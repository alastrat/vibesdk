import { describe, expect, it } from 'vitest';
import { BuildProgressTracker, LINE_UPDATE_INTERVAL_MS, ToolInputScanner, type ProgressChunk } from './build-progress';

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
