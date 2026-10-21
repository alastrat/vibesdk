/** What the API answers for analytics, the analytics setting and flags. */

import { msg } from '../i18n/translate';
import type { ClientFlagValues, FlagKey, FlagKind } from './feature-flags';

/** `GET /api/telemetry/config`. The browser's project token comes from a committed hostname map, not from here. */
export interface TelemetryConfigData {
	/** `session-replay-paused` for visitors who aren't signed in. */
	replayPaused: boolean;
	/** Local development only: the token a developer set in `.dev.vars` to opt in. Null everywhere else. */
	localProjectKey: string | null;
}

/** Sent with the signed-in session, so flag-dependent UI renders once. */
export interface SessionTelemetry {
	flags: ClientFlagValues;
	analyticsOptOut: boolean;
}

export type AnalyticsOptOutSource = 'settings' | 'gpc';

/** `GET` and `PUT /api/user/analytics`. */
export interface AnalyticsPreferenceData {
	optedOut: boolean;
	source: AnalyticsOptOutSource | null;
	/** This request carried the browser's Global Privacy Control signal, so analytics can't be turned on. */
	gpc: boolean;
}

export const GPC_ANALYTICS_MESSAGE = msg("Your browser's Global Privacy Control setting is on, so analytics stays off.");

export interface AdminFlagRow {
	key: FlagKey;
	description: string;
	kind: FlagKind;
	clientVisible: boolean;
	/** The flag's value for the signed-in admin. */
	value: boolean;
	/** PostHog answered for this flag; false means it's off. */
	inPostHog: boolean;
	/** The flag's rollout in PostHog; null without the optional personal API key. 0 when the flag is disabled. */
	rolloutPercent: number | null;
}

/** `GET /api/admin/flags`: every registry flag, evaluated for the admin asking. */
export interface AdminFlagsData {
	userId: string;
	/** posthog: PostHog answered; defaults: it didn't, so every flag is off; off: no project token on this deployment. */
	source: 'posthog' | 'defaults' | 'off';
	flags: AdminFlagRow[];
	/** The project's flags page in PostHog, where flags are edited; null without a project. */
	posthogFlagsUrl: string | null;
}
