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
	it('records at once when signed in, and otherwise carries the request only in the return URL, so any sign-in records it exactly once', () => {
		const button = source('/src/components/public-site/EarlyAccessButton.tsx');
		expect(button).toMatch(/if \(isAuthenticated && !user\?\.isAnonymous\) \{\s*record\(\);\s*return;/);
		expect(button).toContain('requireAuth({');
		expect(button).not.toContain('onSuccess: record');
		expect(button).toContain('intendedUrl: earlyAccessReturnUrl(pathname, capability)');
		expect(button).toContain("You're on the list");
		expect(source('/src/hooks/use-early-access.ts')).toContain('navigate({ pathname, hash }, { replace: true });');
	});

	it('calls the three endpoints', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain("'/api/early-access', { method: 'POST', body: { capability } }");
		expect(client).toContain("this.request<MyEarlyAccessData>('/api/early-access')");
		// Quiet like the other admin calls: non-admins see "Admins only", not an error toast.
		expect(client).toContain("this.request<EarlyAccessAdminData>('/api/admin/early-access', {}, true)");
	});

	it('shows admins the list behind sign-in, and tells everyone else it is for admins', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'admin\/early-access',\s*Component: protectedPage\(AdminEarlyAccessPage\)/);
		const page = source('/src/routes/admin/early-access.tsx');
		expect(page).toContain('isForbiddenError(requests.error)');
		expect(page).toContain('title="Admins only"');
		expect(source('/src/routes/admin/reviews.tsx')).toContain('to="/admin/early-access"');
	});

	it('tells people in the privacy policy that early access requests are kept', () => {
		expect(source('/src/content/legal/privacy.md')).toContain('**Early access requests.**');
	});
});
