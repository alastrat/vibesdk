import { describe, expect, it } from 'vitest';
import { publishAction } from './publish-action';

const LIVE = { status: 'live' as const, slug: 'northwind-tea', hasChanges: false };

describe('the publish button', () => {
	it('publishes a store that was never published, or is offline', () => {
		expect(publishAction({ status: 'unpublished', slug: null, hasChanges: true }, 'northwind-tea')).toEqual({ label: 'Publish', disabled: false });
		expect(publishAction({ ...LIVE, status: 'offline' }, 'northwind-tea')).toEqual({ label: 'Publish', disabled: false });
	});

	it('publishes changes only when the preview has some', () => {
		expect(publishAction({ ...LIVE, hasChanges: true }, 'northwind-tea')).toEqual({ label: 'Publish changes', disabled: false });
		expect(publishAction(LIVE, 'northwind-tea')).toEqual({ label: 'Up to date', disabled: true });
	});

	it('moves a live store to a new address', () => {
		expect(publishAction(LIVE, 'northwind')).toEqual({ label: 'Publish', disabled: false });
	});

	it("names the draft Publish sends once the store has drafts", () => {
		const draft = { id: 'k3x9q2mf', name: 'Typo fix' };
		expect(publishAction({ status: 'unpublished', slug: null, hasChanges: true, draft }, 'northwind-tea')).toEqual({ label: "Publish 'Typo fix'", disabled: false });
		expect(publishAction({ ...LIVE, hasChanges: true, draft }, 'northwind-tea')).toEqual({ label: "Publish 'Typo fix'", disabled: false });
		expect(publishAction({ ...LIVE, draft }, 'northwind-tea')).toEqual({ label: 'Up to date', disabled: true });
	});
});
