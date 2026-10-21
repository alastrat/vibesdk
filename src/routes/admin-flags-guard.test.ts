import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/admin/flags.tsx', '/src/routes.tsx'], { query: '?raw', import: 'default', eager: true });

describe('the flags admin page', () => {
	const page = sources['/src/routes/admin/flags.tsx'] ?? '';

	it('is behind sign-in at /admin/flags', () => {
		expect(sources['/src/routes.tsx']).toMatch(/path: 'admin\/flags',\s*element: \(\s*<ProtectedRoute>\s*<AdminFlagsPage \/>/);
	});

	it('shows values only, and sends edits to PostHog', () => {
		expect(page).toContain('Change flags in PostHog.');
		expect(page).toContain('href={data.posthogFlagsUrl}');
		expect(page).not.toMatch(/useMutation|onCheckedChange/);
	});

	it("says when PostHog's flags are off, and why, and when rollouts are hidden", () => {
		expect(page).toContain("PostHog isn't set up on this deployment, so its flags are off. Billing's own switches and any overrides still apply.");
		expect(page).toContain("PostHog didn't answer, so its flags are off for now. Billing's own switches and any overrides still apply.");
		expect(page).toContain("Flags are off unless PostHog turns them on; billing's own switches and any overrides still apply.");
		expect(page).toContain('Rollouts show once a PostHog personal API key is added.');
	});
});
