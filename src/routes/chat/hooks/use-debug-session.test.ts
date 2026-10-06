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
