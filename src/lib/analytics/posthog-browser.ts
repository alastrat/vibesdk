import posthog from 'posthog-js';

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
