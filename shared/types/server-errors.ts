/**
 * A Worker error on its way to PostHog. The logger hands it to the reporter registered with `setErrorReporter`
 * (worker/logger/core.ts), and worker/services/posthog/server-errors.ts takes it. It lives here so the logger, which the
 * frontend's type check reaches, doesn't import the Worker-only reporter.
 */
export interface ServerErrorInput {
	component: string;
	message: string;
	error?: Error;
}
