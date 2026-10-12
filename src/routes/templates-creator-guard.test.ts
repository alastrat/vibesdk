import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/profile.tsx',
		'/src/components/templates/SubmitTemplateDialog.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: creators', () => {
	it('shows the template bar on the app page for Think owners and template copies', () => {
		const app = source('/src/routes/app/index.tsx');
		expect(app).toContain('<AppTemplateBar');
		expect(app).toContain('canManage={isOwner && isThink}');
		expect(app).toContain('origin={app.fromTemplate}');
	});

	it('offers Submit as template in the chat header for Think owners', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain("isOwner && behaviorType === 'think'");
		expect(chat).toContain('<SubmitTemplateDialog');
	});

	it('passes the live header title to the submit dialog', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('appTitle={headerTitle || app.title}');
	});

	it('lists the creator templates on the profile', () => {
		const profile = source('/src/routes/profile.tsx');
		expect(profile).toContain("{ value: 'templates', label: 'Templates' }");
		expect(profile).toContain('<MyTemplatesList />');
	});

	it('requires the rights confirmation before submitting', () => {
		const dialog = source('/src/components/templates/SubmitTemplateDialog.tsx');
		expect(dialog).toContain('I own the rights to this content and allow others to copy and adapt it.');
		expect(dialog).toContain('disabled={!rightsConfirmed}');
	});

	it('starts the name from the current title within the server limit and warns it is permanent', () => {
		const dialog = source('/src/components/templates/SubmitTemplateDialog.tsx');
		expect(dialog).toContain('slice(0, 60)');
		expect(dialog).toContain("Name, description, category and price can't be changed after you submit.");
	});
});
