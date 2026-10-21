import posthog, { type PostHog } from 'posthog-js';

/** What keeping the person in step needs of posthog-js. */
export type PostHogPerson = Pick<PostHog, 'reset' | 'identify' | 'get_distinct_id' | 'opt_in_capturing' | 'opt_out_capturing' | 'has_opted_out_capturing'>;

/**
 * Brings PostHog's person and the analytics setting in step with the session, `previous` being the account synced last:
 * 1. another account, or signing out, starts a new anonymous person;
 * 2. the setting is applied next, also because reset() clears it;
 * 3. only then is an account that shares analytics identified, so an opted-out account's `$identify` is never captured.
 */
export function syncPerson(client: PostHogPerson, previous: string | null, userId: string | null, optedOut: boolean): void {
	if (previous !== null && previous !== userId) client.reset();
	if (optedOut) client.opt_out_capturing();
	else if (client.has_opted_out_capturing()) client.opt_in_capturing();
	if (userId && !optedOut && client.get_distinct_id() !== userId) client.identify(userId);
}

/** Errors React caught before they reached the window; uncaught ones posthog-js captures itself. */
export function captureBrowserException(error: unknown): void {
	if (!posthog.__loaded) return;
	posthog.captureException(error instanceof Error ? error : new Error(String(error)));
}

/** The analytics setting, applied in this browser right away. */
export function applyAnalyticsChoice(optedOut: boolean): void {
	if (!posthog.__loaded) return;
	if (optedOut) posthog.opt_out_capturing();
	else posthog.opt_in_capturing();
}
