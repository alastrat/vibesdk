import { describe, expect, it } from 'vitest';

/** The logger imports these modules, so they must never import it back, nor log errors that would report again. */
const sources = import.meta.glob<string>(
	['/worker/services/posthog/config.ts', '/worker/services/posthog/client.ts', '/worker/services/posthog/request-scope.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

describe("the logger's own path to PostHog", () => {
	it('never imports the logger and never logs an error', () => {
		expect(Object.keys(sources)).toHaveLength(3);
		for (const [path, text] of Object.entries(sources)) {
			expect(text, path).not.toMatch(/from '[^']*logger'/);
			expect(text, path).not.toContain('.error(');
		}
	});
});
