import { describe, expect, it } from 'vitest';

const configs = import.meta.glob<string>(['/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'], { query: '?raw', import: 'default', eager: true });

describe('the PostHog project per environment', () => {
	it("gives production the project's public token and id as plain vars", () => {
		const production = configs['/wrangler.estori.jsonc'] ?? '';
		expect(production).toContain('"POSTHOG_PROJECT_KEY": "phc_A96M8y8nVJTwpJoFJAwcis2JVsjWYTBVKghz38WCFHiC"');
		expect(production).toContain('"POSTHOG_PROJECT_ID": "675096"');
	});

	it('gives staging none, so PostHog is inert there', () => {
		expect(configs['/wrangler.estori-staging.jsonc']).not.toContain('POSTHOG_PROJECT_KEY');
	});
});
