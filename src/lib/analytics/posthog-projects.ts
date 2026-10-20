/**
 * Which PostHog project a page reports to, by hostname. Project tokens are public and write-only, so they're committed.
 * Only production has a project; staging, previews, stores and any other host get none, and posthog-js never loads
 * there. A developer can opt in on localhost: the server hands over the token from .dev.vars (TelemetryConfigData).
 */

export const POSTHOG_PROJECTS: Readonly<Record<string, string>> = {
	// "Estori production", project 675096, set up 2026-10-19.
	'estori.app': 'phc_A96M8y8nVJTwpJoFJAwcis2JVsjWYTBVKghz38WCFHiC',
};

/** posthog-js talks to the Worker's same-origin proxy (INGEST_PATH in worker/services/posthog/config.ts). */
export const POSTHOG_API_HOST = '/ingest';
/** PostHog's US UI, for links to replays and the toolbar (POSTHOG_UI_ORIGIN on the server). */
export const POSTHOG_UI_HOST = 'https://us.posthog.com';

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export function posthogTokenFor(hostname: string, localProjectKey: string | null): string | null {
	if (LOCAL_HOSTS.has(hostname)) return localProjectKey;
	return Object.hasOwn(POSTHOG_PROJECTS, hostname) ? POSTHOG_PROJECTS[hostname] : null;
}
