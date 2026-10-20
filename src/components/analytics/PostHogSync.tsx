import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import posthog from 'posthog-js';
import { useAuth } from '@/contexts/auth-context';
import { useTelemetryConfig } from '@/hooks/use-telemetry';
import { syncPerson } from '@/lib/analytics/posthog-browser';
import { globalPrivacyControl, posthogInitOptions, replayPausedOn } from '@/lib/analytics/posthog-options';
import { posthogTokenFor } from '@/lib/analytics/posthog-projects';

/**
 * Loads PostHog on a host with a project token, once the config and the session are known, then keeps its person,
 * consent and replay in step. Elsewhere it does nothing.
 *
 * Every step is a layout effect, so they run in order (loading, then the person and consent, then replay) and before
 * the page paints: entering a paused page stops recording before that page's DOM is recorded.
 */
export function PostHogSync() {
	const config = useTelemetryConfig();
	const { user, telemetry, isLoading } = useAuth();
	const { pathname } = useLocation();
	const loaded = useRef(false);
	const syncedUserId = useRef<string | null>(null);
	const token = posthogTokenFor(window.location.hostname, config.data?.localProjectKey ?? null);
	// A failed config call still loads PostHog on estori.app, with replay not paused for visitors.
	const ready = !config.isPending && !isLoading;
	const gpc = globalPrivacyControl(navigator);
	const optedOut = gpc || (telemetry?.analyticsOptOut ?? false);
	const replayPaused = user ? (telemetry?.flags['session-replay-paused'] ?? false) : (config.data?.replayPaused ?? false);
	const replay = !replayPaused;
	const userId = user?.id ?? null;

	useLayoutEffect(() => {
		if (loaded.current || !token || !ready) return;
		posthog.init(token, posthogInitOptions({ gpc, optedOut, replay: replay && !replayPausedOn(window.location.pathname) }));
		// The browser can still carry an account from a session that ended without signing out; syncing resets it
		// unless that account is the one signed in now.
		syncedUserId.current = posthog._isIdentified() ? posthog.get_distinct_id() : null;
		loaded.current = true;
	}, [token, ready, gpc, optedOut, replay]);

	useLayoutEffect(() => {
		if (!loaded.current) return;
		syncPerson(posthog, syncedUserId.current, userId, optedOut);
		syncedUserId.current = userId;
	}, [userId, optedOut, token, ready]);

	useLayoutEffect(() => {
		if (!loaded.current) return;
		// Opting out drops what's captured; stopping as well ends the recorder's work in this tab.
		if (optedOut || !replay || replayPausedOn(pathname)) posthog.stopSessionRecording();
		// Without arguments, starting again obeys the project's sampling and triggers.
		else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
	}, [pathname, replay, optedOut, token, ready]);

	return null;
}
