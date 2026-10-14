import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes/settings/index.tsx', '/src/routes/chat/components/debug-panel.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('account deletion is requested by email, not faked', () => {
	const settings = source('/src/routes/settings/index.tsx');

	it('sends the erasure request to the privacy address with a fixed subject', () => {
		expect(settings).toContain('LEGAL_CONTACT.privacy');
		expect(settings).toContain('Delete my Estori account');
		expect(settings).toContain('We complete erasure within 45 days');
	});

	it('no longer pretends to delete the account in the browser', () => {
		expect(settings).not.toContain('not yet implemented');
		expect(settings).not.toContain('handleDeleteAccount');
	});

	it('words the section as a request, not an instant action', () => {
		expect(settings).toContain('Ask us to erase your account and all your data');
		expect(settings).not.toContain('Permanently delete your account');
	});

	it('keeps a space between "the" and the brand name in the API-keys empty state', () => {
		expect(settings).not.toMatch(/use the\s*\n\s*\{BRAND\.name\}/);
	});
});

describe('the debug panel reaches Estori support', () => {
	const debugPanel = source('/src/routes/chat/components/debug-panel.tsx');

	it('mails the support address, not the upstream maintainer', () => {
		expect(debugPanel).not.toContain('ashishsingh');
		expect(debugPanel).not.toContain('cloudflare.com?subject');
		expect(debugPanel).toContain('LEGAL_CONTACT.support');
	});
});
