/**
 * A small PostHog capture client. It queues events and sends those captured in the same tick as one batch, after the
 * response. For people who turned analytics off it sends only an event's cost fields, under one shared id with no
 * person, and drops every other event; when the setting can't be read, everyone counts as opted out. It never throws
 * and never logs an error: the logger's error path uses it, so it warns on the console instead.
 */

import { OPTED_OUT_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { POSTHOG_INGEST_HOST, type PostHogConfig } from './config';

/** JSON values; undefined ones are left out when the batch is serialized. */
export type EventValue = string | number | boolean | null | undefined | EventValue[] | { [key: string]: EventValue };

export interface CaptureInput {
	event: string;
	distinctId: string;
	properties: Record<string, EventValue>;
	/** Events about Estori itself: no person profile and no analytics setting to check. */
	personless?: boolean;
	/** What is still sent, with no person, when this person turned analytics off: the catalog's cost fields. */
	anonymousCost?: Record<string, EventValue>;
}

export interface PostHogClientDeps {
	config: PostHogConfig | null;
	fetcher: typeof fetch;
	/** The ids among these that turned analytics off. A rejection counts everyone in the batch as opted out. */
	optedOut(userIds: readonly string[]): Promise<ReadonlySet<string>>;
	/** Keeps sending alive after the response (request-scope.ts); never throws. */
	keepAlive(work: Promise<unknown>): void;
	now(): Date;
	timeoutMs?: number;
}

export const CAPTURE_TIMEOUT_MS = 3_000;
/** A runaway loop can't hold more than this many unsent events. */
export const MAX_QUEUED_EVENTS = 100;
export const BATCH_URL = `https://${POSTHOG_INGEST_HOST}/batch/`;

interface QueuedEvent extends CaptureInput {
	timestamp: string;
}

function warn(msg: string, detail: Record<string, EventValue>): void {
	console.warn(JSON.stringify({ level: 'warn', component: 'PostHog', msg, ...detail }));
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class PostHogClient {
	private queue: QueuedEvent[] = [];
	private flushScheduled = false;

	constructor(private readonly deps: PostHogClientDeps) {}

	capture(input: CaptureInput): void {
		if (!this.deps.config || this.queue.length >= MAX_QUEUED_EVENTS) return;
		this.queue.push({ ...input, timestamp: this.deps.now().toISOString() });
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		// Scheduled before it's handed on, so the flush runs and clears flushScheduled even if nothing keeps it alive.
		const flushing = Promise.resolve().then(() => this.flush());
		this.deps.keepAlive(flushing);
	}

	async flush(): Promise<void> {
		this.flushScheduled = false;
		const config = this.deps.config;
		const events = this.queue.splice(0);
		if (!config || events.length === 0) return;
		try {
			const sendable = await this.withoutOptedOut(events);
			if (sendable.length === 0) return;
			const response = await this.deps.fetcher(BATCH_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ api_key: config.projectKey, batch: sendable.map((event) => batchEvent(event, config)) }),
				signal: AbortSignal.timeout(this.deps.timeoutMs ?? CAPTURE_TIMEOUT_MS),
			});
			if (!response.ok) warn('PostHog refused a batch', { status: response.status, events: sendable.length });
		} catch (error) {
			warn('PostHog capture failed', { error: reason(error), events: events.length });
		}
	}

	private async withoutOptedOut(events: QueuedEvent[]): Promise<QueuedEvent[]> {
		const people = [...new Set(events.filter((event) => !event.personless).map((event) => event.distinctId))];
		if (people.length === 0) return events;
		let optedOut: ReadonlySet<string> | null = null;
		try {
			optedOut = await this.deps.optedOut(people);
		} catch (error) {
			warn('Could not read analytics settings; treating everyone as opted out', { error: reason(error) });
		}
		return events.flatMap((event): QueuedEvent[] => {
			if (event.personless || (optedOut !== null && !optedOut.has(event.distinctId))) return [event];
			// Opted out: only the cost fields, under the shared id, so the AI budget still counts everyone.
			if (!event.anonymousCost) return [];
			return [{ event: event.event, distinctId: OPTED_OUT_DISTINCT_ID, properties: event.anonymousCost, personless: true, timestamp: event.timestamp }];
		});
	}
}

function batchEvent(event: QueuedEvent, config: PostHogConfig) {
	return {
		event: event.event,
		distinct_id: event.distinctId,
		timestamp: event.timestamp,
		properties: {
			...event.properties,
			environment: config.environment,
			...(config.release ? { release: config.release } : {}),
			$host: config.host,
			$lib: 'estori-worker',
			// The Worker's address isn't the person's: geolocating it would overwrite the country their browser sent.
			$geoip_disable: true,
			...(event.personless ? { $process_person_profile: false } : {}),
		},
	};
}
