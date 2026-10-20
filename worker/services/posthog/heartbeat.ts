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

async function passes(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), timeoutMs);
	});
	try {
		return await Promise.race([check().catch(() => false), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export async function runHeartbeatChecks(deps: HeartbeatDeps): Promise<ServerEventProperties<'heartbeat'>> {
	const startedMs = deps.nowMs();
	const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
	const headers: Record<string, string> = deps.stagingKey ? { [STAGING_KEY_HEADER]: deps.stagingKey } : {};
	const [appOk, databaseOk] = await Promise.all([
		passes(async () => {
			const response = await deps.fetchApp(new Request(`${deps.appOrigin}/api/health`, { headers }));
			if (response.status !== 200) return false;
			const body: unknown = await response.json();
			return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok';
		}, timeoutMs),
		passes(async () => {
			await deps.queryDatabase();
			return true;
		}, timeoutMs),
	]);
	let storesOk: boolean | null = null;
	const slug = deps.storesDomain ? await deps.newestLiveSlug().catch(() => null) : null;
	if (slug && deps.storesDomain) {
		const storeUrl = `${getProtocolForHost(deps.storesDomain)}://${slug}.${deps.storesDomain}/`;
		storesOk = await passes(async () => (await deps.fetchApp(new Request(storeUrl, { headers }))).status < 500, timeoutMs);
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
