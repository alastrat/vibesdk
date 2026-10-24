import { describe, expect, it } from 'vitest';
import {
	cumulativeHours,
	rotateCamera,
	liveSnapshotState,
} from './live-analytics-utils';
describe('live analytics interaction', () => {
	it('only plots observed hours and accumulates current and previous values independently', () => {
		expect(
			cumulativeHours(
				[
					{ hour: 0, value: 2, previous: 1 },
					{ hour: 1, value: 3, previous: 4 },
					{ hour: 2, value: 99, previous: 99 },
				],
				1,
			),
		).toEqual([
			{ hour: 0, value: 2, previous: 1 },
			{ hour: 1, value: 5, previous: 5 },
		]);
	});
	it('wraps longitude and clamps pitch for repeated mouse/touch drags', () => {
		expect(rotateCamera({ latitude: 80, longitude: 175 }, 20, 40)).toEqual({
			latitude: 85,
			longitude: -165,
		});
		expect(
			rotateCamera({ latitude: 0, longitude: -175 }, -740, -100),
		).toEqual({ latitude: -85, longitude: 165 });
	});
	it('does not claim stale or failed snapshots are live', () => {
		expect(liveSnapshotState(1000, 2000, false, false)).toBe('live');
		expect(liveSnapshotState(1000, 17000, false, false)).toBe('stale');
		expect(liveSnapshotState(1000, 2000, true, false)).toBe('error');
		expect(liveSnapshotState(1000, 2000, false, true)).toBe('paused');
	});
});
