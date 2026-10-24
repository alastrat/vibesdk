import { describe, expect, it } from 'vitest';
import { workspaceSearchItems } from './workspace-search-model';

const apps = [
	{ id: 'tea', title: 'Café Tea', userId: 'owner' },
	{ id: 'candles', title: 'Candles', userId: 'other-owner' },
];
describe('workspace search destinations', () => {
	it('searches owned store names without accents and preserves the active tool', () => {
		expect(workspaceSearchItems(apps, 'owner', 'cafe', { section: 'emails', catalogPaused: false })).toEqual([{ id: 'store:tea', label: 'Café Tea', path: '/stores/tea?section=emails', kind: 'store' }]);
	});
	it('never offers another owner’s store or cached stores after sign-out', () => {
		expect(workspaceSearchItems(apps, 'owner', 'Candles', { catalogPaused: false })).toEqual([]);
		expect(workspaceSearchItems(apps, null, '', { catalogPaused: false })).toEqual([]);
	});
	it('includes real global destinations while hiding paused catalog and global store tools', () => {
		const paths = workspaceSearchItems(apps, 'owner', '', { catalogPaused: true }).map((item) => item.path);
		expect(paths).toContain('/apps');
		expect(paths).toContain('/orders');
		expect(paths).toContain('/settings/billing');
		expect(paths).not.toContain('/catalog');
		expect(paths).not.toContain('/emails');
		expect(paths).not.toContain('/translations');
	});
});
