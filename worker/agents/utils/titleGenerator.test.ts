import { describe, it, expect } from 'vitest';
import { deriveProjectTitle, deriveShortTitle } from './titleGenerator';

describe('deriveShortTitle', () => {
	it('returns short queries unchanged (trimmed)', () => {
		expect(deriveShortTitle('  Todo app  ')).toBe('Todo app');
	});

	it('collapses newlines and repeated whitespace to single spaces', () => {
		expect(deriveShortTitle('Build a\n\n  task   manager')).toBe(
			'Build a task manager',
		);
	});

	it('truncates long queries on a word boundary with an ellipsis', () => {
		const query =
			'Build a full featured project management application with kanban boards and reporting dashboards';
		const result = deriveShortTitle(query, 60);
		expect(result.endsWith('…')).toBe(true);
		expect(result.length).toBeLessThanOrEqual(61);
		expect(result).not.toContain('  ');
		// Should cut on a word boundary, not mid-word.
		expect(query.startsWith(result.slice(0, -1))).toBe(true);
		expect(result.slice(0, -1).endsWith(' ')).toBe(false);
	});

	it('hard-cuts when there is no early word boundary', () => {
		const query = 'a'.repeat(100);
		const result = deriveShortTitle(query, 60);
		expect(result).toBe(`${'a'.repeat(60)}…`);
	});

	it('falls back for empty or whitespace-only input', () => {
		expect(deriveShortTitle('')).toBe('New project');
		expect(deriveShortTitle('   \n  ')).toBe('New project');
		expect(deriveShortTitle('', 60, 'Untitled')).toBe('Untitled');
	});
});

describe('deriveProjectTitle', () => {
	it('uses the product name the request gives in quotes', () => {
		expect(
			deriveProjectTitle('Build an online store called "Trailhead Supply" that sells outdoor and camping gear.'),
		).toBe('Trailhead Supply');
	});

	it('accepts "named", curly quotes, and any capitalisation', () => {
		expect(deriveProjectTitle('A bakery site Named \u201cCrumb & Co.\u201d with online orders')).toBe('Crumb & Co.');
		expect(deriveProjectTitle("Make a portfolio called 'Lumen Studio' for my photos")).toBe('Lumen Studio');
	});

	it('keeps apostrophes inside a double-quoted name', () => {
		expect(deriveProjectTitle('Build a cafe site called "Joe\'s Coffee Bar" with a menu')).toBe("Joe's Coffee Bar");
	});

	it('falls back to the short form of the request when no name is quoted', () => {
		expect(deriveProjectTitle('Build a todo app')).toBe('Build a todo app');
		const query = 'Build a full featured project management application with kanban boards and reporting dashboards';
		expect(deriveProjectTitle(query)).toBe(deriveShortTitle(query));
	});

	it('ignores a quoted name too long to be a title', () => {
		const query = `Build a store called "${'Very '.repeat(14)}Long Name" for gear`;
		expect(deriveProjectTitle(query)).toBe(deriveShortTitle(query));
	});

	it('falls back for empty input', () => {
		expect(deriveProjectTitle('')).toBe('New project');
	});
});
