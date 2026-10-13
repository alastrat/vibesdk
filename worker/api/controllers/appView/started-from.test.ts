import { describe, expect, it } from 'vitest';
import { toStartedFromView } from './started-from';

const row = {
	id: 'source1',
	title: 'Lumen Yoga',
	creatorName: 'Creator' as string | null,
	visibility: 'public' as const,
	removedFromDiscoverAt: null as Date | null,
};

describe('toStartedFromView', () => {
	it('names a source that is still public and in Discover', () => {
		expect(toStartedFromView(row)).toEqual({
			available: true,
			appId: 'source1',
			title: 'Lumen Yoga',
			creatorName: 'Creator',
		});
	});

	it('falls back to Unknown when the creator has no display name', () => {
		expect(toStartedFromView({ ...row, creatorName: null })).toMatchObject({ available: true, creatorName: 'Unknown' });
	});

	it('reveals nothing about a source that is now private', () => {
		const view = toStartedFromView({ ...row, visibility: 'private' });
		expect(view).toEqual({ available: false });
		expect(JSON.stringify(view)).not.toContain('Lumen');
	});

	it('reveals nothing about a source removed from Discover', () => {
		const view = toStartedFromView({ ...row, removedFromDiscoverAt: new Date(0) });
		expect(view).toEqual({ available: false });
		expect(JSON.stringify(view)).not.toContain('source1');
	});

	it('has no view when the source row is gone', () => {
		expect(toStartedFromView(null)).toBeNull();
	});
});
