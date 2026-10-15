import { describe, expect, it } from 'vitest';
import { and } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { discoverConditions } from './discover-conditions';
import type { DiscoverFilters } from '../services/templates/reuse';

const dialect = new SQLiteSyncDialect();
const ALL: DiscoverFilters = { category: null, pricing: 'all', reusableOnly: false, showcasedOnly: false };

function render(filters: DiscoverFilters | undefined) {
	const where = and(...discoverConditions(filters));
	if (!where) throw new Error('no conditions');
	return dialect.sqlToQuery(where);
}

describe('discoverConditions', () => {
	it('always hides sites an admin removed', () => {
		expect(render(undefined).sql).toContain('removed_from_discover_at" is null');
		expect(render(ALL).sql).toContain('removed_from_discover_at" is null');
	});

	it('limits the landing page to stores an admin showcased', () => {
		const query = render({ ...ALL, showcasedOnly: true });
		expect(query.sql).toContain('"is_featured" = ?');
		expect(query.params).toContain(1);
		expect(render(ALL).sql).not.toContain('is_featured');
	});

	it('filters by category', () => {
		const query = render({ ...ALL, category: 'store' });
		expect(query.sql).toContain('"category" = ?');
		expect(query.params).toContain('store');
	});

	it('treats a site without a listed paid listing as free', () => {
		const query = render({ ...ALL, pricing: 'free' });
		expect(query.sql).toContain('not exists (select 1 from templates as listing where listing.source_app_id =');
		expect(query.sql).toContain("listing.status = 'listed'");
	});

	it('treats a site with an approved listed listing as paid', () => {
		const query = render({ ...ALL, pricing: 'paid' });
		expect(query.sql).toContain('exists (select 1 from templates as listing');
		expect(query.sql).toContain('listing.current_version_id is not null');
	});

	it('limits reusable sites to recorded deploys without a first review pending', () => {
		const query = render({ ...ALL, reusableOnly: true });
		expect(query.sql).toContain('last_deployed_at" is not null');
		expect(query.sql).toContain('listing.current_version_id is null');
	});
});
