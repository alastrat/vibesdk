import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_REFRESH_CRON, CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { domainFlowDepsFromEnv, runLiveStoresSchedule } from './wiring';

describe('live stores wiring', () => {
	it("checks domains waiting for DNS on the hourly sweep, and on no other schedule", async () => {
		const { d1, statements } = recordingD1();
		const env = { DB: d1, STORES_DOMAIN: 'stores.localhost', ENVIRONMENT: 'dev' } as unknown as Env;
		await runLiveStoresSchedule(CATALOG_REFRESH_CRON, env);
		expect(statements).toEqual([]);
		await runLiveStoresSchedule(CATALOG_SWEEP_CRON, env);
		expect(statements.some((entry) => entry.sql.includes('"store_domains"'))).toBe(true);
	});

	it("treats Estori's main and preview domains as its own, except localhost in development, where custom domains live", () => {
		const prod = domainFlowDepsFromEnv({ DB: recordingD1().d1, STORES_DOMAIN: 'estori.shop', CUSTOM_DOMAIN: 'estori.app', CUSTOM_PREVIEW_DOMAIN: 'preview.estori.app', ENVIRONMENT: 'prod' } as unknown as Env);
		expect(prod.own).toEqual({ storesDomain: 'estori.shop', estoriDomains: ['estori.app', 'preview.estori.app'] });
		const dev = domainFlowDepsFromEnv({ DB: recordingD1().d1, STORES_DOMAIN: 'stores.localhost', CUSTOM_DOMAIN: 'localhost', ENVIRONMENT: 'dev' } as unknown as Env);
		expect(dev.own).toEqual({ storesDomain: 'stores.localhost', estoriDomains: [] });
		expect(dev.provider?.name).toBe('local');
	});
});
