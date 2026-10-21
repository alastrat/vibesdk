import type { CaptureResult, PostHogConfig } from 'posthog-js';
import { scrubEmails } from '../../../shared/types/scrub-emails';
import { POSTHOG_API_HOST, POSTHOG_UI_HOST, type AnalyticsEnvironment } from './posthog-projects';

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

/**
 * The text with every web address in it cut before its query, whether the text is an address or mentions one, and every
 * email address replaced with `[email]`.
 */
function scrubText(text: string): string {
	return scrubEmails(text.replace(ADDRESS, (address) => withoutQuery(address)));
}

/** Attributes that hold words someone wrote, such as an app's name in a title; replay masks them as it masks page text. */
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set(['title', 'alt', 'placeholder', 'aria-label', 'aria-description', 'aria-valuetext']);
/** Attributes that hold an address. */
const ADDRESS_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'src', 'action', 'formaction', 'poster']);

/**
 * Replay's `maskAttributeFn`. Replay data is compressed before `before_send` sees it, so attributes are cleaned here, as
 * they are recorded. Styles and every other attribute are kept as they are, so layouts still replay.
 */
export function maskReplayAttribute(name: string, value: string): string {
	const attribute = name.toLowerCase();
	if (TEXT_ATTRIBUTES.has(attribute)) return '*'.repeat(value.length);
	if (ADDRESS_ATTRIBUTES.has(attribute)) return scrubEmails(withoutQuery(value));
	return value;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
	const prototype: unknown = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** Two values whose keys became the same address: lists, such as heatmap points per page, are joined. */
function mergeAt(existing: unknown, incoming: unknown): unknown {
	return Array.isArray(existing) && Array.isArray(incoming) ? [...existing, ...incoming] : incoming;
}

/** Scrubs text in place at any depth, in values and in keys (heatmap data is keyed by page address). */
function scrubNested(value: unknown, seen: WeakSet<object>): unknown {
	if (typeof value === 'string') return scrubText(value);
	if (typeof value !== 'object' || value === null || seen.has(value)) return value;
	seen.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) value[index] = scrubNested(value[index], seen);
		return value;
	}
	// A compressed replay event holds gzip bytes as text, which rewriting would corrupt; maskReplayAttribute cleaned it.
	if (!isPlainRecord(value) || typeof value.cv === 'string') return value;
	for (const key of Object.keys(value)) {
		const scrubbed = scrubNested(value[key], seen);
		const scrubbedKey = scrubText(key);
		if (scrubbedKey === key) {
			value[key] = scrubbed;
		} else {
			delete value[key];
			value[scrubbedKey] = mergeAt(value[scrubbedKey], scrubbed);
		}
	}
	return value;
}

/**
 * posthog-js `before_send`. At any depth of the event, every web address leaves the browser without its query and
 * fragment: page addresses, referrers, web vitals, heatmap pages, and the page and request addresses in replay data.
 * Every email address becomes `[email]`, browser exceptions included. `$pathname` has no query and stays as it is.
 */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
	if (!event) return null;
	// posthog-js adds the page's title to each pageview, and a project's page is titled with the seller's app name.
	delete event.properties.title;
	const seen = new WeakSet<object>();
	scrubNested(event.properties, seen);
	scrubNested(event.$set, seen);
	scrubNested(event.$set_once, seen);
	return event;
}

export interface AnalyticsState {
	/** Which environment this page's events belong to. */
	environment: AnalyticsEnvironment;
	/** The browser's Global Privacy Control signal. */
	gpc: boolean;
	/** The signed-in user's analytics setting. */
	optedOut: boolean;
	/** Whether this page may record: replay isn't paused by its flag, and the path isn't a paused one. */
	replay: boolean;
}

/**
 * `before_send` for a page in `environment`: tags the event, then scrubs it. A super property would do the same, but
 * `syncPerson`'s reset() clears those; before_send tags every event for as long as the page lives.
 */
function taggedScrubber(environment: AnalyticsEnvironment): (event: CaptureResult) => CaptureResult | null {
	return (event) => {
		event.properties.environment = environment;
		return scrubEvent(event);
	};
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
		// Layouts and clicks, not what's written: all text, inputs and written attributes masked, images blocked, and no
		// request headers or bodies. Every iframe is blocked, since the editor's preview carries a signed preview token in
		// its address.
		session_recording: {
			maskAllInputs: true,
			maskTextSelector: '*',
			blockSelector: 'img, iframe',
			maskAttributeFn: maskReplayAttribute,
			recordHeaders: false,
			recordBody: false,
		},
		before_send: taggedScrubber(state.environment),
		// The cookie holds the user id; on `.estori.app` it would reach every preview, which runs generated code.
		cross_subdomain_cookie: false,
		opt_out_capturing_by_default: state.gpc || state.optedOut,
	};
}

/** `navigator.globalPrivacyControl`, which only some browsers have. */
export function globalPrivacyControl(nav: Navigator & { globalPrivacyControl?: boolean }): boolean {
	return nav.globalPrivacyControl === true;
}
