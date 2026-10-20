/**
 * Worker errors to PostHog as `$exception` events. The logger's error path and unhandled API errors report here.
 * A repeated error goes once a minute, and at most 30 go a minute per isolate, so a loop can't flood PostHog. Email
 * addresses are removed, and the logger's structured data is never sent. It reads its key from the Worker's env, so
 * Durable Objects report too. Never imports the logger, which imports this.
 */

import { env } from 'cloudflare:workers';
import { SYSTEM_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { PostHogClient, type CaptureInput, type EventValue } from './client';
import { posthogConfig } from './config';
import { keepAlive } from './request-scope';

export interface ServerErrorInput {
	component: string;
	message: string;
	error?: Error;
}

/** A type, not an interface, so frames fit the event's JSON properties. */
export type ExceptionFrame = {
	platform: 'custom';
	lang: 'javascript';
	function: string;
	filename: string;
	lineno: number;
	colno: number;
	in_app: boolean;
};

export const ERRORS_PER_MINUTE = 30;
export const REPEAT_WINDOW_MS = 60_000;
const MINUTE_MS = 60_000;
const MAX_FINGERPRINTS = 500;
/** A real frame line is far shorter; the frame pattern backtracks, so longer lines are skipped rather than read. */
const MAX_FRAME_LINE_CHARS = 1_000;
/** What is sent of a message. */
const MAX_TEXT_CHARS = 2_000;
/** Read past the cut, and dropped from the end when the read itself stopped short; more than any address the pattern matches. */
const SCRUB_MARGIN_CHARS = 512;
const FRAME_LINE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
/** Bounded runs, so reading a long text without an address stays linear. */
const EMAIL = /[^\s@<>()"',;:]{1,64}@[^\s@<>()"',;:]{1,255}\.[a-z]{2,}/gi;
const ENCODED_AT = /%40/gi;

export function scrubEmails(text: string): string {
	// An address in a URL is encoded, so its @ is decoded first, which keeps the scrubbing to one linear pattern.
	return text.replace(ENCODED_AT, '@').replace(EMAIL, '[email]');
}

/** Bounds the text a fingerprint keeps; it is never sent, so it needs no scrubbing. */
function clip(text: string): string {
	return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

/**
 * A message as it is sent: scrubbed, then cut to MAX_TEXT_CHARS. Scrubbing reads MAX_TEXT_CHARS plus a margin, so an
 * address that straddles the cut is whole when it is scrubbed. When even that read stopped short of the text's end, the
 * last margin of the scrubbed result is dropped too: an address split by the read's own end would stay there, and the
 * scrubbing can have shrunk the text so that this end is now inside the cut.
 */
function sendableText(text: string): string {
	const window = text.slice(0, MAX_TEXT_CHARS + SCRUB_MARGIN_CHARS);
	const scrubbed = scrubEmails(window);
	if (window.length === text.length) return scrubbed.slice(0, MAX_TEXT_CHARS);
	return scrubbed.slice(0, Math.max(0, Math.min(MAX_TEXT_CHARS, scrubbed.length - SCRUB_MARGIN_CHARS)));
}

/** V8 stack lines as PostHog's raw frames: oldest call first, the throwing frame last. */
export function parseStack(stack: string | undefined): ExceptionFrame[] {
	const frames: ExceptionFrame[] = [];
	for (const line of (stack ?? '').split('\n')) {
		const match = line.length > MAX_FRAME_LINE_CHARS ? null : FRAME_LINE.exec(line);
		if (!match) continue;
		const [, fn, filename, lineno, colno] = match;
		frames.push({
			platform: 'custom',
			lang: 'javascript',
			function: fn ? fn.replace(/^async /, '') : '?',
			filename,
			lineno: Number(lineno),
			colno: Number(colno),
			in_app: !filename.includes('node_modules'),
		});
	}
	return frames.reverse();
}

/** Errors that differ only in ids and numbers share a fingerprint. */
export function errorFingerprint(input: ServerErrorInput): string {
	const value = clip(input.error?.message || input.message).replace(/\b\w*\d\w*\b/g, '#');
	return `${input.component}|${input.error?.name || 'Error'}|${value}`;
}

export function exceptionProperties(input: ServerErrorInput): Record<string, EventValue> {
	const error = input.error;
	return {
		component: input.component,
		log_message: sendableText(input.message),
		$exception_level: 'error',
		$exception_list: [
			{
				type: error?.name || 'Error',
				value: sendableText(error?.message || input.message),
				mechanism: { handled: true, synthetic: error === undefined },
				stacktrace: { type: 'raw', frames: parseStack(error?.stack) },
			},
		],
	};
}

export class ErrorReporter {
	private readonly lastSent = new Map<string, number>();
	private windowStartMs = Number.NEGATIVE_INFINITY;
	private sentInWindow = 0;
	private warned = false;

	constructor(
		private readonly send: (input: CaptureInput) => void,
		private readonly limits: { perMinute: number; repeatWindowMs: number },
		private readonly nowMs: () => number = Date.now,
	) {}

	report(input: ServerErrorInput): void {
		try {
			const now = this.nowMs();
			const fingerprint = errorFingerprint(input);
			const last = this.lastSent.get(fingerprint);
			if (last !== undefined && now - last < this.limits.repeatWindowMs) return;
			if (now - this.windowStartMs >= MINUTE_MS) {
				this.windowStartMs = now;
				this.sentInWindow = 0;
			}
			if (this.sentInWindow >= this.limits.perMinute) return;
			this.sentInWindow += 1;
			if (this.lastSent.size >= MAX_FINGERPRINTS) this.lastSent.clear();
			this.lastSent.set(fingerprint, now);
			this.send({ event: '$exception', distinctId: SYSTEM_DISTINCT_ID, personless: true, properties: exceptionProperties(input) });
		} catch (error) {
			// Reporting an error must never raise one. A console warning, not a logged error, which would report again.
			this.warnOnce(error);
		}
	}

	private warnOnce(error: unknown): void {
		if (this.warned) return;
		this.warned = true;
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(JSON.stringify({ level: 'warn', component: 'PostHog', msg: 'Could not report a server error; further failures are not logged', error: reason }));
	}
}

let isolateClient: { projectKey: string; client: PostHogClient } | null = null;

/** The isolate's own client, built on first use, so no request is needed. */
function sendFromIsolate(input: CaptureInput): void {
	const config = posthogConfig(env);
	if (!config) return;
	if (isolateClient?.projectKey !== config.projectKey) {
		isolateClient = {
			projectKey: config.projectKey,
			client: new PostHogClient({ config, fetcher: (request, init) => fetch(request, init), optedOut: async () => new Set<string>(), keepAlive, now: () => new Date() }),
		};
	}
	isolateClient.client.capture(input);
}

const reporter = new ErrorReporter(sendFromIsolate, { perMinute: ERRORS_PER_MINUTE, repeatWindowMs: REPEAT_WINDOW_MS });

export function reportServerError(input: ServerErrorInput): void {
	reporter.report(input);
}
