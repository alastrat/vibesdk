import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/admin/reviews.tsx',
		'/src/routes/profile.tsx',
		'/src/components/publishing/PaidListingsList.tsx',
		'/src/components/site-page/PageCopySections.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('reviews and paid listings', () => {
	it('lets admins approve or reject a paid version with a reason and read its files', () => {
		const page = source('/src/routes/admin/reviews.tsx');
		expect(page).toContain('usePendingReviews()');
		expect(page).toContain("decision: 'approve'");
		expect(page).toContain("decision: 'reject', reason");
		expect(page).toContain('useReviewVersionFiles(');
		expect(page).toContain('isForbidden(');
	});

	it('lists the owner paid listings on the profile', () => {
		expect(source('/src/routes/profile.tsx')).toContain('<PaidListingsList />');
		expect(source('/src/routes/profile.tsx')).toContain("{ value: 'paid', label: 'Paid listings' }");
		expect(source('/src/components/publishing/PaidListingsList.tsx')).toContain('paidListingStatusView(');
	});
});

describe('reviewing page text', () => {
	it('shows the submitted text as plain text', () => {
		expect(source('/src/routes/admin/reviews.tsx')).toContain('<PageCopySections');
		const sections = source('/src/components/site-page/PageCopySections.tsx');
		expect(sections).not.toContain('dangerouslySetInnerHTML');
		expect(sections).toContain("What's included");
	});
});
