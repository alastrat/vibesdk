import type { CaptureResult, PostHogConfig } from 'posthog-js';
import { POSTHOG_API_HOST, POSTHOG_UI_HOST } from './posthog-projects';

/**
 * Recording stops on these paths and below them: orders, shopper emails, the profile with its payments setup
 * (`/profile?tab=paid`), settings with billing (`/settings/billing`), and admin pages.
 */
export const REPLAY_PAUSED_PATHS = ['/orders', '/emails', '/profile', '/settings', '/admin'] as const;

export function replayPausedOn(pathname: string): boolean {
	return REPLAY_PAUSED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** An address without its query and fragment, where reset and confirmation tokens, and prompts, travel. */
export function withoutQuery(url: string): string {
	const cut = url.search(/[?#]/);
	return cut === -1 ? url : url.slice(0, cut);
}

/** An absolute web address, up to the next space or quote. */
const ADDRESS = /https?:\/\/[^\s"'`<>]+/gi;

/** The text with every address in it cut before its query, whether the text is an address or mentions one. */
function withoutQueries(text: string): string {
	return text.replace(ADDRESS, (address) => withoutQuery(address));
}

function isPlainRecord(value: object): value is Record<string, unknown> {
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Two values whose keys became the same address: lists, such as heatmap points per page, are joined. */
function mergeAt(existing: unknown, incoming: unknown): unknown {
	return Array.isArray(existing) && Array.isArray(incoming) ? [...existing, ...incoming] : incoming;
}

/** Strips addresses in place at any depth, in values and in keys (heatmap data is keyed by page address). */
function stripNested(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === 'string') return withoutQueries(value);
	if (typeof value !== 'object' || value === null || seen.has(value)) return value;
	seen.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) value[index] = stripNested(value[index], seen);
		return value;
	}
	if (!isPlainRecord(value)) return value;
	for (const key of Object.keys(value)) {
		const stripped = stripNested(value[key], seen);
		const strippedKey = withoutQueries(key);
		if (strippedKey === key) {
			value[key] = stripped;
		} else {
			delete value[key];
			value[strippedKey] = mergeAt(value[strippedKey], stripped);
		}
	}
	return value;
}

/**
 * posthog-js `before_send`: every address in the event leaves the browser without its query and fragment, at any
 * depth: page addresses, referrers, web vitals, heatmap pages, and the page and request addresses in replay data.
 * `$pathname` has no query and stays as it is.
 */
export function stripUrlQueries(event: CaptureResult | null): CaptureResult | null {
	if (!event) return null;
	const seen = new WeakSet<object>();
	stripNested(event.properties, seen);
	stripNested(event.$set, seen);
	stripNested(event.$set_once, seen);
	return event;
}

export interface AnalyticsState {
	/** The browser's Global Privacy Control signal. */
	gpc: boolean;
	/** The signed-in user's analytics setting. */
	optedOut: boolean;
	/** Whether this page may record: replay isn't paused by its flag, and the path isn't a paused one. */
	replay: boolean;
}

export function posthogInitOptions(state: AnalyticsState): Partial<PostHogConfig> {
	return {
		api_host: POSTHOG_API_HOST,
		ui_host: POSTHOG_UI_HOST,
		person_profiles: 'identified_only',
		capture_pageview: 'history_change',
		capture_pageleave: 'if_capture_pageview',
		autocapture: true,
		// Clicks are recorded by where they land, never by what the element says or links to.
		mask_all_text: true,
		mask_all_element_attributes: true,
		capture_exceptions: true,
		advanced_disable_feature_flags: true,
		disable_surveys: true,
		disable_session_recording: !state.replay,
		enable_recording_console_log: false,
		// Layouts and clicks, not what's written: all text and inputs masked, images blocked, and no request headers or
		// bodies. Every iframe is blocked, since the editor's preview carries a signed preview token in its address.
		session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'img, iframe', recordHeaders: false, recordBody: false },
		before_send: stripUrlQueries,
		opt_out_capturing_by_default: state.gpc || state.optedOut,
	};
}

/** `navigator.globalPrivacyControl`, which only some browsers have. */
export function globalPrivacyControl(nav: Navigator & { globalPrivacyControl?: boolean }): boolean {
	return nav.globalPrivacyControl === true;
}
