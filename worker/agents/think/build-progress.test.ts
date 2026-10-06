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
