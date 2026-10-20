import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import posthog from 'posthog-js';
import { useAuth } from '@/contexts/auth-context';
import { useTelemetryConfig } from '@/hooks/use-telemetry';
import { globalPrivacyControl, posthogInitOptions, replayPausedOn } from '@/lib/analytics/posthog-options';
import { posthogTokenFor } from '@/lib/analytics/posthog-projects';

/**
 * Loads PostHog on a host with a project token, once the config and the session are known, then keeps its identity,
 * consent and replay in step. Elsewhere it does nothing.
 */
export function PostHogSync() {
	const config = useTelemetryConfig();
	const { user, telemetry, isLoading } = useAuth();
	const { pathname } = useLocation();
	const loaded = useRef(false);
	const identifiedAs = useRef<string | null>(null);
	const token = posthogTokenFor(window.location.hostname, config.data?.localProjectKey ?? null);
	// A failed config call still loads PostHog on estori.app, with replay not paused for visitors.
	const ready = !config.isPending && !isLoading;
	const gpc = globalPrivacyControl(navigator);
	const optedOut = gpc || (telemetry?.analyticsOptOut ?? false);
	const replayPaused = user ? (telemetry?.flags['session-replay-paused'] ?? false) : (config.data?.replayPaused ?? false);
	const replay = !replayPaused;
	const userId = user?.id ?? null;

	useEffect(() => {
		if (loaded.current || !token || !ready) return;
		posthog.init(token, posthogInitOptions({ gpc, optedOut, replay: replay && !replayPausedOn(window.location.pathname) }));
		// The browser can still carry an account from a session that ended without signing out; it's reset below
		// unless that account is the one signed in now.
		identifiedAs.current = posthog._isIdentified() ? posthog.get_distinct_id() : null;
		loaded.current = true;
	}, [token, ready, gpc, optedOut, replay]);

	useEffect(() => {
		if (!loaded.current || userId === identifiedAs.current) return;
		// Signing out, or another account signing in on this browser, starts a new anonymous person first.
		if (identifiedAs.current !== null) posthog.reset();
		if (userId) posthog.identify(userId);
		identifiedAs.current = userId;
	}, [userId, token, ready]);

	useEffect(() => {
		if (!loaded.current) return;
		if (optedOut) posthog.opt_out_capturing();
		else if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
	}, [optedOut, token, ready]);

	useEffect(() => {
		if (!loaded.current) return;
		// Opting out drops what's captured; stopping as well ends the recorder's work in this tab.
		if (optedOut || !replay || replayPausedOn(pathname)) posthog.stopSessionRecording();
		// Without arguments, starting again obeys the project's sampling and triggers.
		else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
	}, [pathname, replay, optedOut, token, ready]);

	return null;
}
