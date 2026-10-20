import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelemetryController } from './controller';
import type { RouteContext } from '../../types/route-context';

const request = new Request('https://estori.app/api/telemetry/config');

afterEach(() => {
	vi.unstubAllGlobals();
});

const config = (env: Record<string, string>) => TelemetryController.config(request, env as unknown as Env, {} as ExecutionContext, {} as RouteContext);

describe('the telemetry config', () => {
	it('gives no token and no replay pause without a project token, as on staging and in tests', async () => {
		const response = await config({ ENVIRONMENT: 'staging' });
		expect(await response.json()).toMatchObject({ success: true, data: { replayPaused: false, localProjectKey: null } });
	});

	it("gives the visitors' replay pause, and no token in production, where the browser's own map has it", async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flags: { 'session-replay-paused': { key: 'session-replay-paused', enabled: true } } })));
		const response = await config({ POSTHOG_PROJECT_KEY: 'phc_config', ENVIRONMENT: 'prod' });
		expect((await response.json()).data).toEqual({ replayPaused: true, localProjectKey: null });
	});

	it('gives local development the token a developer opted in with', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flags: {} })));
		expect((await (await config({ POSTHOG_PROJECT_KEY: 'phc_local' })).json()).data).toEqual({ replayPaused: false, localProjectKey: 'phc_local' });
	});

	it.each(['dev', 'development', 'local'])('treats ENVIRONMENT=%s as local development', async (environment) => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flags: {} })));
		expect((await (await config({ POSTHOG_PROJECT_KEY: 'phc_local', ENVIRONMENT: environment })).json()).data.localProjectKey).toBe('phc_local');
	});
});
