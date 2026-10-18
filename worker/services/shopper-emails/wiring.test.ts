import { describe, expect, it } from 'vitest';
import { recordingD1 } from '../../database/test-support/recording-d1';
import { CATALOG_HEALTH_CRON } from '../catalog/health';
import { CATALOG_REFRESH_CRON, CATALOG_SWEEP_CRON } from '../catalog/scheduler';
import { EMAIL_FROM } from '../email/types';
import { runShopperEmailSchedule, shopperEmailDepsFromEnv } from './wiring';

describe('shopper emails wiring', () => {
	it('sends the emails that came due every 15 minutes, forgets old ones daily, and does nothing on other schedules', async () => {
		const { d1, statements } = recordingD1();
		const env = { DB: d1, ENVIRONMENT: 'dev' } as unknown as Env;
		await runShopperEmailSchedule(CATALOG_SWEEP_CRON, env);
		expect(statements).toEqual([]);
		await runShopperEmailSchedule(CATALOG_REFRESH_CRON, env);
		expect(statements.some((entry) => entry.sql.startsWith('select') && entry.sql.includes('"shopper_emails"'))).toBe(true);
		statements.length = 0;
		await runShopperEmailSchedule(CATALOG_HEALTH_CRON, env);
		expect(statements.some((entry) => entry.sql.startsWith('delete from "shopper_emails"'))).toBe(true);
	});

	it("gives a live store its address on the stores domain, and sends from SHOPPER_EMAIL_FROM, else Estori's address", async () => {
		const { d1 } = recordingD1((sql) => (sql.includes('"live_stores"') ? [['Northwind Tea', 'seller@example.test', 1, 'northwind-tea', 'live']] : []));
		const deps = shopperEmailDepsFromEnv({ DB: d1, STORES_DOMAIN: 'estori.shop', CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod', SHOPPER_EMAIL_FROM: ' orders@estori.app ' } as unknown as Env);
		expect(deps.fromEmail).toBe('orders@estori.app');
		expect(await deps.store('app_tea')).toEqual({ title: 'Northwind Tea', sellerEmail: 'seller@example.test', sellerEmailConfirmed: true, storeUrl: 'https://northwind-tea.estori.shop' });
		const plain = shopperEmailDepsFromEnv({ DB: recordingD1().d1, CUSTOM_DOMAIN: 'estori.app', ENVIRONMENT: 'prod' } as unknown as Env);
		expect(plain.fromEmail).toBe(EMAIL_FROM.email);
		expect(await plain.store('app_gone')).toBeNull();
	});
});
