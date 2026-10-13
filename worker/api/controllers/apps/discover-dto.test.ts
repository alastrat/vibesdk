import { describe, expect, it } from 'vitest';
import type { EnhancedAppData } from '../../../database/types';
import { toPublicAppListItem } from './publicAppDto';

function app(overrides: Partial<EnhancedAppData> = {}): EnhancedAppData {
	return {
		id: 'app1',
		title: 'Lumen Yoga',
		description: null,
		iconUrl: null,
		originalPrompt: 'secret prompt',
		finalPrompt: null,
		framework: '',
		userId: 'owner',
		sessionToken: null,
		visibility: 'public',
		status: 'completed',
		deploymentId: 'dep1',
		githubRepositoryUrl: null,
		githubRepositoryVisibility: null,
		isArchived: false,
		isFeatured: false,
		version: 1,
		parentAppId: null,
		fromTemplateVersionId: null,
		category: 'landing',
		reuseConsentAt: new Date(0),
		removedFromDiscoverAt: null,
		removedFromDiscoverBy: null,
		removedFromDiscoverReason: null,
		previewVersion: 0,
		screenshotUrl: null,
		screenshotCapturedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		lastDeployedAt: new Date(0),
		userName: 'Creator',
		userAvatar: null,
		starCount: 0,
		userStarred: false,
		userFavorited: false,
		...overrides,
	};
}

describe('toPublicAppListItem for Discover', () => {
	it('marks a deployed free site reusable with no price', () => {
		expect(toPublicAppListItem(app())).toMatchObject({ category: 'landing', priceCents: null, inReview: false, reusable: true });
	});

	it('shows the approved price of a paid site', () => {
		expect(toPublicAppListItem(app({ paidPriceCents: 2900 }))).toMatchObject({ priceCents: 2900, reusable: true });
	});

	it('is not reusable while a paid site waits for its first approval or before a recorded deploy', () => {
		expect(toPublicAppListItem(app({ paidInReview: true })).reusable).toBe(false);
		expect(toPublicAppListItem(app({ lastDeployedAt: null })).reusable).toBe(false);
	});

	it('never exposes the prompt, owner or deployment', () => {
		const item = JSON.stringify(toPublicAppListItem(app()));
		expect(item).not.toContain('secret prompt');
		expect(item).not.toContain('dep1');
		expect(item).not.toContain('"userId"');
	});
});
