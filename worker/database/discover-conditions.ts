/**
 * Discover's SQL: which public apps show, and how each app's paid listing
 * affects pricing and reuse. A paid listing counts only while it is listed.
 */

import { eq, sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';
import type { DiscoverFilters } from '../services/templates/reuse';

const listedListing = sql`select 1 from templates as listing where listing.source_app_id = ${schema.apps.id} and listing.status = 'listed'`;

/** The approved price of a listed paid listing, or null for a free site. */
export const paidPriceSubquery = sql<number | null>`(select listing.price_cents from templates as listing where listing.source_app_id = ${schema.apps.id} and listing.status = 'listed' and listing.current_version_id is not null)`;

/** True while a paid listing is listed, approved or not. */
export const paidListedSubquery = sql<boolean>`exists (${listedListing})`.mapWith(Boolean);

/** 1 while a listed paid listing waits for its first approval. */
export const paidInReviewSubquery = sql<number>`exists (${listedListing} and listing.current_version_id is null)`;

export function discoverConditions(filters: DiscoverFilters | undefined): SQL[] {
	const conditions: SQL[] = [sql`${schema.apps.removedFromDiscoverAt} is null`];
	if (!filters) return conditions;
	if (filters.category) conditions.push(eq(schema.apps.category, filters.category));
	if (filters.pricing === 'free') conditions.push(sql`not exists (${listedListing})`);
	if (filters.pricing === 'paid') {
		conditions.push(sql`exists (${listedListing} and listing.current_version_id is not null)`);
	}
	if (filters.showcasedOnly) conditions.push(eq(schema.apps.isFeatured, true));
	if (filters.reusableOnly) {
		conditions.push(sql`${schema.apps.lastDeployedAt} is not null`);
		conditions.push(sql`not exists (${listedListing} and listing.current_version_id is null)`);
	}
	return conditions;
}
