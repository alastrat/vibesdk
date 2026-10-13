import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/deployment-controls.tsx',
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
		expect(dialog).toContain('disabled={!consent}');
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
