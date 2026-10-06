import { describe, expect, it } from 'vitest';
import { parse } from 'jsonc-parser';
import estoriRaw from '../wrangler.estori.jsonc?raw';
import upstreamRaw from '../wrangler.jsonc?raw';

interface Binding { binding?: string; name?: string; [key: string]: unknown }
interface WranglerConfig {
	name: string;
	routes?: Array<Record<string, unknown>>;
	vars?: Record<string, unknown>;
	d1_databases?: Binding[];
	kv_namespaces?: Binding[];
	r2_buckets?: Binding[];
	artifacts?: Binding[];
	containers?: unknown[];
	dispatch_namespaces?: unknown[];
	durable_objects?: { bindings: Binding[] };
	migrations?: unknown[];
	keep_vars?: boolean;
	workers_dev?: boolean;
	assets?: unknown;
	worker_loaders?: unknown;
}

const estori = parse(estoriRaw) as WranglerConfig;
const upstream = parse(upstreamRaw) as WranglerConfig;

describe('wrangler.estori.jsonc', () => {
	it('names the production worker', () => {
		expect(estori.name).toBe('estori-production');
	});

	it('has no container sandbox and no dispatch namespace', () => {
		expect(estori.containers).toBeUndefined();
		expect(estori.dispatch_namespaces).toBeUndefined();
	});

	it('binds Estori data resources with real ids', () => {
		expect(estori.d1_databases).toEqual([
			{ binding: 'DB', database_name: 'estori-db', database_id: expect.stringMatching(/^[0-9a-f-]{36}$/), migrations_dir: 'migrations' },
		]);
		expect(estori.kv_namespaces).toEqual([{ binding: 'VibecoderStore', id: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
		expect(estori.r2_buckets).toEqual([{ binding: 'TEMPLATES_BUCKET', bucket_name: 'estori-assets' }]);
		expect(estori.artifacts).toEqual([{ binding: 'ARTIFACTS', namespace: 'estori-production' }]);
		expect(estoriRaw).not.toContain('__ESTORI_');
	});

	it('routes the app host and the preview host', () => {
		expect(estori.routes).toEqual([
			{ pattern: 'estori.app', custom_domain: true },
			{ pattern: '*preview.estori.app/*', zone_name: 'estori.app' },
		]);
	});

	it('sets the Estori vars without dev or dispatch settings', () => {
		expect(estori.vars).toMatchObject({
			CUSTOM_DOMAIN: 'estori.app',
			CUSTOM_PREVIEW_DOMAIN: 'preview.estori.app',
			ENVIRONMENT: 'prod',
			CLOUDFLARE_AI_GATEWAY: 'estori-gateway',
			ARTIFACTS_NAMESPACE: 'estori-production',
			ENABLE_THINK_MODEL_FALLBACK: 'true',
		});
		const keys = Object.keys(estori.vars ?? {});
		expect(keys.filter((k) => k.startsWith('DEV_BROWSER_') || k === 'DISPATCH_NAMESPACE')).toEqual([]);
	});

	it('keeps Durable Objects, migrations, assets and loaders identical to upstream', () => {
		expect(estori.durable_objects).toEqual(upstream.durable_objects);
		expect(estori.migrations).toEqual(upstream.migrations);
		expect(estori.assets).toEqual(upstream.assets);
		expect(estori.worker_loaders).toEqual(upstream.worker_loaders);
		expect(estori.keep_vars).toBe(true);
		expect(estori.workers_dev).toBe(false);
	});
});
