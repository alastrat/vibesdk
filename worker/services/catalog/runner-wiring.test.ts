import { describe, expect, it } from 'vitest';
import { catalogSupplierMode } from './CatalogOrderRunner';

const sources = import.meta.glob<string>(['/worker/index.ts', '/worker/services/store-payments/wiring.ts', '/wrangler.jsonc', '/wrangler.estori.jsonc'], {
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
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'dev', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod' } as unknown as Env)).toBe('sandbox');
		expect(catalogSupplierMode({ ENVIRONMENT: 'prod', CATALOG_SUPPLIER_LIVE: 'true' } as unknown as Env)).toBe('live');
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
});
