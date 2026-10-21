import { describe, expect, it } from 'vitest';
import { posthogConfig, posthogFlagsUrl } from './config';

describe('PostHog config', () => {
	it('is off without a project token, as on staging, in local development and in tests', () => {
		expect(posthogConfig({ ENVIRONMENT: 'staging', CUSTOM_DOMAIN: 'staging.estori.app' })).toBeNull();
		expect(posthogConfig({ POSTHOG_PROJECT_KEY: '   ', ENVIRONMENT: 'prod' })).toBeNull();
	});

	it('names the project, the environment, the Worker version and the host, which keeps local opt-in out of production numbers', () => {
		expect(
			posthogConfig({ POSTHOG_PROJECT_KEY: ' phc_abc ', POSTHOG_PROJECT_ID: '675096', ENVIRONMENT: 'prod', CUSTOM_DOMAIN: 'estori.app', CF_VERSION_METADATA: { id: 'ver-1' } }),
		).toEqual({ projectKey: 'phc_abc', projectId: '675096', environment: 'prod', release: 'ver-1', host: 'estori.app' });
		expect(posthogConfig({ POSTHOG_PROJECT_KEY: 'phc_abc', CUSTOM_DOMAIN: 'localhost' })).toEqual({
			projectKey: 'phc_abc',
			projectId: null,
			environment: 'dev',
			release: null,
			host: 'localhost',
		});
	});

	it("links to the project's flags in PostHog", () => {
		expect(posthogFlagsUrl(posthogConfig({ POSTHOG_PROJECT_KEY: 'phc_abc', POSTHOG_PROJECT_ID: '675096', CUSTOM_DOMAIN: 'estori.app' }))).toBe(
			'https://us.posthog.com/project/675096/feature_flags',
		);
		expect(posthogFlagsUrl(posthogConfig({ POSTHOG_PROJECT_KEY: 'phc_abc', CUSTOM_DOMAIN: 'localhost' }))).toBeNull();
		expect(posthogFlagsUrl(null)).toBeNull();
	});
});
