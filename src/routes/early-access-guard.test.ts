import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/public-site/EarlyAccessButton.tsx',
		'/src/hooks/use-early-access.ts',
		'/src/routes/admin/early-access.tsx',
		'/src/routes/admin/reviews.tsx',
		'/src/routes.tsx',
		'/src/lib/api-client.ts',
		'/src/content/legal/privacy.md',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('early access in the app', () => {
	it('asks signed-out visitors to sign up, records after sign-in, and survives a sign-in that reloads the page', () => {
		const button = source('/src/components/public-site/EarlyAccessButton.tsx');
		expect(button).toContain('requireAuth({');
		expect(button).toContain('onSuccess: record');
		expect(button).toContain('intendedUrl: earlyAccessReturnUrl(pathname, capability)');
		expect(button).toContain("You're on the list");
		expect(source('/src/hooks/use-early-access.ts')).toContain('navigate({ pathname, hash }, { replace: true });');
	});

	it('calls the three endpoints', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain("'/api/early-access', { method: 'POST', body: { capability } }");
		expect(client).toContain("this.request<MyEarlyAccessData>('/api/early-access')");
		expect(client).toContain("'/api/admin/early-access'");
	});

	it('shows admins the list behind sign-in, and tells everyone else it is for admins', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'admin\/early-access',\s*element: \(\s*<ProtectedRoute>/);
		const page = source('/src/routes/admin/early-access.tsx');
		expect(page).toContain('isForbiddenError(requests.error)');
		expect(page).toContain('title="Admins only"');
		expect(source('/src/routes/admin/reviews.tsx')).toContain('to="/admin/early-access"');
	});

	it('tells people in the privacy policy that requests are kept, dated without asking everyone to accept the terms again', () => {
		const privacy = source('/src/content/legal/privacy.md');
		expect(privacy).toContain('updated: October 14, 2026');
		expect(privacy).toContain('**Early access requests.**');
	});
});
