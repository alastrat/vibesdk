/**
 * The uptime heartbeat. Every 15 minutes the cron checks the app, the database and the newest live store from inside
 * the Worker, then sends a `heartbeat` event. PostHog alerts when heartbeats stop or report a failing check.
 */

import { SYSTEM_DISTINCT_ID, type ServerEventProperties } from '../../../shared/types/analytics-events';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { createLogger } from '../../logger';
import { getProtocolForHost } from '../../utils/urls';
import { CATALOG_REFRESH_CRON } from '../catalog/scheduler';
import { storeHostConfig } from '../live-stores/hosts';
import { serverAnalytics } from './analytics';
import { posthogConfig } from './config';

/** The cron both Estori environments already schedule, so the heartbeat needs no trigger of its own. */
export const HEARTBEAT_CRON = CATALOG_REFRESH_CRON;
export const CHECK_TIMEOUT_MS = 10_000;
const STAGING_KEY_HEADER = 'x-estori-staging-key';

const logger = createLogger('Heartbeat');

export interface HeartbeatDeps {
	/** The Worker's own fetch handler, called in-process. */
	fetchApp(request: Request): Promise<Response>;
	queryDatabase(): Promise<void>;
	newestLiveSlug(): Promise<string | null>;
	appOrigin: string;
	storesDomain: string | null;
	/** Staging's gate key, sent so the in-process requests pass the gate. */
	stagingKey: string | null;
	nowMs(): number;
	timeoutMs?: number;
}

/**
 * The work's answer, or `fallback` when it takes longer than `ms`, rejects or throws before it returns a promise.
 * Nothing in a heartbeat may hang or throw, or the event that reports the failure is lost.
 */
async function withTimeout<T>(work: () => Promise<T>, ms: number, fallback: T): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), ms);
	});
	try {
		return await Promise.race([(async () => work())().catch(() => fallback), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

/** A response whose body isn't read is cancelled, so the in-process handler isn't left streaming it. */
function discardBody(response: Response): void {
	response.body?.cancel().catch(() => undefined);
}

export async function runHeartbeatChecks(deps: HeartbeatDeps): Promise<ServerEventProperties<'heartbeat'>> {
	const startedMs = deps.nowMs();
	const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
	const headers: Record<string, string> = deps.stagingKey ? { [STAGING_KEY_HEADER]: deps.stagingKey } : {};
	const requestFor = (url: string) => new Request(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
	const [appOk, databaseOk] = await Promise.all([
		withTimeout(
			async () => {
				const response = await deps.fetchApp(requestFor(`${deps.appOrigin}/api/health`));
				if (response.status !== 200) {
					discardBody(response);
					return false;
				}
				const body: unknown = await response.json();
				return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok';
			},
			timeoutMs,
			false,
		),
		withTimeout(
			async () => {
				await deps.queryDatabase();
				return true;
			},
			timeoutMs,
			false,
		),
	]);
	let storesOk: boolean | null = null;
	// The lookup reads the database the check above just found down, so it only runs when that check passed.
	const slug = deps.storesDomain && databaseOk ? await withTimeout(() => deps.newestLiveSlug(), timeoutMs, null) : null;
	if (slug && deps.storesDomain) {
		const storeUrl = `${getProtocolForHost(deps.storesDomain)}://${slug}.${deps.storesDomain}/`;
		storesOk = await withTimeout(
			async () => {
				const response = await deps.fetchApp(requestFor(storeUrl));
				discardBody(response);
				return response.status < 500;
			},
			timeoutMs,
			false,
		);
	}
	const failed = [...(appOk ? [] : ['app']), ...(databaseOk ? [] : ['database']), ...(storesOk === false ? ['stores'] : [])];
	return { healthy: failed.length === 0, app_ok: appOk, database_ok: databaseOk, stores_ok: storesOk, failed, duration_ms: deps.nowMs() - startedMs };
}

/** Runs only where there's a project to send to: production, or staging once it has a project. */
export async function runHeartbeat(cron: string, env: Env, fetchApp: (request: Request) => Promise<Response>): Promise<void> {
	if (cron !== HEARTBEAT_CRON || !posthogConfig(env)) return;
	const properties = await runHeartbeatChecks({
		fetchApp,
		queryDatabase: async () => {
			await env.DB.prepare('SELECT 1').first();
		},
		newestLiveSlug: () => new LiveStoreService(env).newestLiveSlug(),
		appOrigin: `${getProtocolForHost(env.CUSTOM_DOMAIN)}://${env.CUSTOM_DOMAIN}`,
		storesDomain: storeHostConfig(env).storesDomain,
		stagingKey: env.STAGING_GATE_KEY?.trim() || null,
		nowMs: Date.now,
	});
	serverAnalytics(env).capture('heartbeat', SYSTEM_DISTINCT_ID, properties);
	if (!properties.healthy) logger.warn('A heartbeat check failed', { failed: properties.failed });
}
