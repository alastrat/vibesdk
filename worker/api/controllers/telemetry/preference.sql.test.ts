/** The analytics setting's API on real SQL; each test's writes are rolled back after it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { TelemetryController } from './controller';
import type { RouteContext } from '../../types/route-context';
import { GPC_ANALYTICS_MESSAGE } from '../../../../shared/types/telemetry';

let db: D1Database;
const context = { user: { id: 'pref_1', email: 'pref_1@example.test' } } as unknown as RouteContext;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'pref_1');
});

function read(headers: Record<string, string> = {}) {
	return TelemetryController.getAnalyticsPreference(new Request('https://estori.app/api/user/analytics', { headers }), envWith(db), {} as ExecutionContext, context);
}

function write(body: unknown, headers: Record<string, string> = {}) {
	const request = new Request('https://estori.app/api/user/analytics', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
	return TelemetryController.setAnalyticsPreference(request, envWith(db), {} as ExecutionContext, context);
}

describe('the analytics setting API', () => {
	it('starts on', async () => {
		expect((await (await read()).json()).data).toEqual({ optedOut: false, source: null, gpc: false });
	});

	it('turns analytics off from settings, and on again', async () => {
		expect((await (await write({ optedOut: true })).json()).data).toEqual({ optedOut: true, source: 'settings', gpc: false });
		expect((await (await read()).json()).data).toEqual({ optedOut: true, source: 'settings', gpc: false });
		expect((await (await write({ optedOut: false })).json()).data).toEqual({ optedOut: false, source: null, gpc: false });
	});

	it('stores a GPC signal when read, and refuses to turn analytics on while it is sent', async () => {
		expect((await (await read({ 'Sec-GPC': '1' })).json()).data).toEqual({ optedOut: true, source: 'gpc', gpc: true });
		const refused = await write({ optedOut: false }, { 'Sec-GPC': '1' });
		expect(refused.status).toBe(409);
		expect((await refused.json()).error.message).toBe(GPC_ANALYTICS_MESSAGE);
	});

	it('refuses a body without a yes or no', async () => {
		expect((await write({ optedOut: 'yes' })).status).toBe(400);
		expect((await write({})).status).toBe(400);
	});
});
