import { describe, expect, it } from 'vitest';
import { INGEST_PATH, POSTHOG_UI_ORIGIN } from '../../../worker/services/posthog/config';
import { POSTHOG_API_HOST, POSTHOG_PROJECTS, POSTHOG_UI_HOST, posthogTokenFor } from './posthog-projects';

const PRODUCTION = 'phc_A96M8y8nVJTwpJoFJAwcis2JVsjWYTBVKghz38WCFHiC';

describe('the PostHog project for this page', () => {
	it('is the production project on estori.app only', () => {
		expect(POSTHOG_PROJECTS).toEqual({ 'estori.app': { token: PRODUCTION, environment: 'prod' } });
		expect(posthogTokenFor('estori.app', null)).toEqual({ token: PRODUCTION, environment: 'prod' });
		expect(posthogTokenFor('estori.app', 'phc_local')).toEqual({ token: PRODUCTION, environment: 'prod' });
	});

	it('is none on staging, previews, stores and any other host', () => {
		for (const host of ['staging.estori.app', 'preview.estori.app', 'teashop.estori.app', 'www.estori.app', 'example.com']) {
			expect(posthogTokenFor(host, 'phc_local'), host).toBeNull();
		}
	});

	it('is the opt-in token on localhost, as dev, and none without it', () => {
		for (const host of ['localhost', '127.0.0.1', '[::1]']) expect(posthogTokenFor(host, 'phc_local'), host).toEqual({ token: 'phc_local', environment: 'dev' });
		expect(posthogTokenFor('localhost', null)).toBeNull();
	});

	it("talks to the Worker's proxy and links to the US UI, as the server does", () => {
		expect(POSTHOG_API_HOST).toBe(INGEST_PATH);
		expect(POSTHOG_UI_HOST).toBe(POSTHOG_UI_ORIGIN);
	});
});
