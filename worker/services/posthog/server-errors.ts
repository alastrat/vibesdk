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
const FRAME_LINE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;

export function scrubEmails(text: string): string {
	return text.replace(EMAIL, '[email]');
}

/** V8 stack lines as PostHog's raw frames: oldest call first, the throwing frame last. */
export function parseStack(stack: string | undefined): ExceptionFrame[] {
	const frames: ExceptionFrame[] = [];
	for (const line of (stack ?? '').split('\n')) {
		const match = FRAME_LINE.exec(line);
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
	const value = (input.error?.message || input.message).replace(/\b\w*\d\w*\b/g, '#');
	return `${input.component}|${input.error?.name || 'Error'}|${value}`;
}

export function exceptionProperties(input: ServerErrorInput): Record<string, EventValue> {
	const error = input.error;
	return {
		component: input.component,
		log_message: scrubEmails(input.message),
		$exception_level: 'error',
		$exception_list: [
			{
				type: error?.name || 'Error',
				value: scrubEmails(error?.message || input.message),
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
		} catch {
			// Reporting an error must never raise one.
		}
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
