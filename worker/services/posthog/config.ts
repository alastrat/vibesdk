/**
 * Where PostHog lives and whether this deployment talks to it. Only production has a project token (a plain var in
 * wrangler.estori.jsonc); without one, nothing is sent and every flag is off. Never imports the logger: the logger
 * imports this.
 */

export const POSTHOG_INGEST_HOST = 'us.i.posthog.com';
export const POSTHOG_ASSET_HOST = 'us-assets.i.posthog.com';
export const POSTHOG_UI_ORIGIN = 'https://us.posthog.com';
/** The browser's PostHog traffic goes through Estori's own domain at this path (proxy.ts). */
export const INGEST_PATH = '/ingest';

export interface PostHogConfig {
	/** The project's token: public and write-only. */
	projectKey: string;
	/** The project's id, for links to it; null when not set. */
	projectId: string | null;
	environment: string;
	/** The Worker version, on every server event. */
	release: string | null;
	/**
	 * `$host` on every server event. PostHog's test-account filter excludes localhost, so a developer who opts in
	 * locally never counts in production numbers.
	 */
	host: string;
}

type ConfigEnv = {
	POSTHOG_PROJECT_KEY?: string;
	POSTHOG_PROJECT_ID?: string;
	ENVIRONMENT?: string;
	CUSTOM_DOMAIN?: string;
	CF_VERSION_METADATA?: { id: string };
};

/** Null without a project token: nothing is sent, and every flag is off. */
export function posthogConfig(env: ConfigEnv): PostHogConfig | null {
	const projectKey = env.POSTHOG_PROJECT_KEY?.trim();
	if (!projectKey) return null;
	return {
		projectKey,
		projectId: env.POSTHOG_PROJECT_ID?.trim() || null,
		environment: env.ENVIRONMENT || 'dev',
		release: env.CF_VERSION_METADATA?.id ?? null,
		host: env.CUSTOM_DOMAIN || 'localhost',
	};
}

/** Where flags are edited: the project's flags page in PostHog. */
export function posthogFlagsUrl(config: PostHogConfig | null): string | null {
	return config?.projectId ? `${POSTHOG_UI_ORIGIN}/project/${config.projectId}/feature_flags` : null;
}
