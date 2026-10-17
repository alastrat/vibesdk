import { describe, expect, it } from 'vitest';
import { catalogSupplierMode } from './CatalogOrderRunner';

const sources = import.meta.glob<string>(['/worker/index.ts', '/worker/services/store-payments/wiring.ts', '/wrangler.jsonc', '/wrangler.estori.jsonc', '/worker/services/catalog/CatalogOrderRunner.ts', '/worker/services/catalog/scheduler.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the catalog order runner wiring', () => {
	it('places sandbox orders unless production says live in so many words', () => {
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev' } as unknown as Env, 'live')).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env, 'live')).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod' } as unknown as Env, 'live')).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env, 'live')).toBe('live');
	});

	it('places a sandbox order for any sale paid in test mode, or one whose payment it cannot find, even in live production', () => {
		const live = { ENVIRONMENT: 'prod', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env;
		expect(catalogSupplierMode(live, 'test')).toBe('sandbox');
		expect(catalogSupplierMode(live, null)).toBe('sandbox');
		const runner = source('/worker/services/catalog/CatalogOrderRunner.ts');
		expect(runner.slice(runner.indexOf('async alarm()'))).toContain('runnerDeps(this.env, await paymentModeOf(this.env, state.orderId))');
	});

	it('exports the runner, binds it in both configs, and starts it from the checkout hand-off', () => {
		expect(source('/worker/index.ts')).toContain("export { CatalogOrderRunner } from './services/catalog/CatalogOrderRunner';");
		for (const config of ['/wrangler.jsonc', '/wrangler.estori.jsonc']) {
			const text = source(config);
			expect(text).toContain('"class_name": "CatalogOrderRunner"');
			expect(text).toContain('"name": "CATALOG_ORDER_RUNNER"');
			expect(text).toMatch(/"new_sqlite_classes": \[\s*"CatalogOrderRunner"\s*\],\s*"tag": "v7"/);
			expect(text).toContain('"crons": ["*/15 * * * *", "5 * * * *", "35 6 * * *"]');
		}
		expect(source('/worker/services/store-payments/wiring.ts')).toContain('scheduleCatalogPlacement(env, recorded.orderId)');
	});

	it('keeps a failed alarm\'s state and tries again, and sweeps orders whose runner never started', () => {
		const runner = source('/worker/services/catalog/CatalogOrderRunner.ts');
		const alarm = runner.slice(runner.indexOf('async alarm()'));
		expect(alarm.indexOf('catch (error)')).toBeGreaterThan(-1);
		expect(alarm.indexOf('setAlarm(Date.now() + ALARM_RETRY_MS)')).toBeGreaterThan(alarm.indexOf('catch (error)'));
		expect(source('/worker/services/catalog/scheduler.ts')).toContain('cron === CATALOG_SWEEP_CRON');
	});
});
