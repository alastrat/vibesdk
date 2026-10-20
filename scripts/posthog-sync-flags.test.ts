import { describe, expect, it } from 'vitest';
import { FLAG_KEYS } from '../shared/types/feature-flags';
import { flagsToCreate } from './posthog-sync-flags';

describe('syncing flags to PostHog', () => {
	it('creates only the missing flags, every one at 0%, so nothing is rolled out or paused until someone raises it', () => {
		const created = flagsToCreate(new Set(['billing', 'some-other-flag']));
		expect(created.map((flag) => flag.key)).toEqual(FLAG_KEYS.filter((key) => key !== 'billing'));
		expect(created.every((flag) => flag.filters.groups[0]?.rollout_percentage === 0)).toBe(true);
		expect(created[0]).toEqual({
			key: 'store-drafts-paused',
			name: 'Pauses starting new drafts of a store. Drafts that exist keep working.',
			active: true,
			filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
		});
	});

	it('creates nothing when every flag exists', () => {
		expect(flagsToCreate(new Set(FLAG_KEYS))).toEqual([]);
	});
});
