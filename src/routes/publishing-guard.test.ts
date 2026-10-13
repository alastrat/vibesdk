import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/deployment-controls.tsx',
		'/src/components/publishing/PageCopyFields.tsx',
		'/src/components/publishing/PublishDialog.tsx',
		'/src/components/publishing/SiteReuseBar.tsx',
		'/src/hooks/use-app.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('publishing a site', () => {
	it('asks for consent, a category and a price before an app goes public', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('Others may copy and adapt this site.');
		expect(dialog).toContain('TEMPLATE_PRICE_OPTIONS_CENTS.map');
		expect(dialog).toContain('TEMPLATE_CATEGORIES.map');
		expect(dialog).toContain("onSubmit({ visibility: 'private' })");
		expect(dialog).toContain('disabled={!consent || !sellerReady || !pageCopy.valid}');
	});

	it('starts the price from the shared rule that skips rejected prices', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('savedListingPrice(data.listing)');
		expect(dialog).not.toContain('function savedPrice');
	});

	it('pre-ticks consent only for a public site whose consent was recorded', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain("useState(data.visibility === 'public' && data.hasReuseConsent)");
	});

	it('routes every Make public control through the dialog', () => {
		expect(source('/src/routes/app/index.tsx')).toContain('<PublishDialog');
		expect(source('/src/routes/app/index.tsx')).not.toContain('useUpdateAppVisibility');
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('<PublishDialog');
		expect(chat).toContain('onPublish={() => setIsPublishDialogOpen(true)}');
		expect(chat).not.toContain('SubmitTemplateDialog');
		expect(chat).not.toContain('Submit as template');
		const controls = source('/src/routes/chat/components/deployment-controls.tsx');
		expect(controls).toContain('onPublish?.()');
		expect(controls).toContain("apiClient.publishSite(appId, { visibility: 'private' })");
		expect(source('/src/hooks/use-app.ts')).not.toContain('useUpdateAppVisibility');
	});

	it('shows the owner the paid review status and admins the removal action', () => {
		const bar = source('/src/components/publishing/SiteReuseBar.tsx');
		expect(bar).toContain('Removed from Discover by an admin');
		expect(bar).toContain('Send update for review');
		expect(bar).toContain('Remove from Discover');
		expect(bar).toContain('Restore to Discover');
		expect(source('/src/routes/app/index.tsx')).toContain('<SiteReuseBar');
	});
});

describe('page text in the publish dialog', () => {
	it('drafts on first open, can redraft, and shows the limits', () => {
		const fields = source('/src/components/publishing/PageCopyFields.tsx');
		expect(fields).toContain('Drafting…');
		expect(fields).toContain('Redraft with AI');
		expect(fields).toContain('draft.error.message');
		expect(fields).not.toContain('PAGE_DRAFT_FAILED_MESSAGE');
		expect(fields).toContain('validatePageCopy(');
		expect(fields).toContain('SITE_PAGE_LIMITS');
		expect(fields).toContain('Your page text is in review');
	});

	it('shows every field against its limit and locks the fields while a draft is in flight', () => {
		const fields = source('/src/components/publishing/PageCopyFields.tsx');
		expect(fields).toContain('SITE_PAGE_LIMITS.features.max');
		expect(fields).toContain('SITE_PAGE_LIMITS.includes.max');
		expect(fields).toContain('SITE_PAGE_LIMITS.madeFor.max');
		expect(fields).toContain('SITE_PAGE_LIMITS.features.each');
		expect(fields).toContain('SITE_PAGE_LIMITS.includes.name');
		expect(fields).toContain('SITE_PAGE_LIMITS.includes.detail');
		expect(fields).toContain('SITE_PAGE_LIMITS.madeFor.each');
		expect(fields).toContain('readOnly={draft.isPending}');
		expect(fields).toContain('setForm((current) =>');
		expect(fields).not.toContain('setForm({ ...form');
	});

	it('tells creators the format of What is included and that a paid change goes to review', () => {
		const fields = source('/src/components/publishing/PageCopyFields.tsx');
		expect(fields).toContain('as "Name: what it has"');
		expect(fields).toContain('Changes to the page text go to review with the price.');
		expect(source('/src/components/publishing/PublishDialog.tsx')).toContain(
			'reviewedOnChange={paid && !!data.listing?.currentVersionId}',
		);
	});

	it('sends the page text with a public publish and blocks invalid text', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('<PageCopyFields');
		expect(dialog).toContain('pageCopy: pageCopy.payload');
		expect(dialog).toContain('!pageCopy.valid');
	});
});
