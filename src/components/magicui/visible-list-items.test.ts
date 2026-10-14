import { describe, expect, it } from 'vitest';
import { visibleListItems } from './visible-list-items';

describe('visibleListItems', () => {
	it('shows the arrived items newest first, like a notification feed', () => {
		expect(visibleListItems(['a', 'b', 'c'], 2, true)).toEqual(['b', 'a']);
	});

	it('keeps arrival order for step lists', () => {
		expect(visibleListItems(['a', 'b', 'c'], 2, false)).toEqual(['a', 'b']);
	});

	it('never shows more items than it has, or a negative number of them', () => {
		expect(visibleListItems(['a'], 5, false)).toEqual(['a']);
		expect(visibleListItems(['a'], -1, false)).toEqual([]);
	});
});
