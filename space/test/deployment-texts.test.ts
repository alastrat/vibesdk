/**
 * The text a deployment's stored bundle holds, read for translation. The row is read as stored, with no git: a cold
 * SpaceDO has no working tree yet, and the live store's bundle is a copy no branch checkout could reproduce.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import { DEPLOYMENTS_TABLE_SQL, LIVE_BRANCH, publishLiveDeployment, readDeploymentTexts } from '../src/space/deploy-engine';
import type {} from './test-env';

function uniqueStub(name: string) {
	const id = env.FsHarnessDO.idFromName(`texts-${name}-${Date.now()}-${Math.random()}`);
	return env.FsHarnessDO.get(id);
}

function deploy(
	sql: SqlStorage,
	branch: string,
	row: { commit: string; modules?: unknown; assets?: unknown; manifest?: string | null },
): void {
	sql.exec(
		`INSERT OR REPLACE INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES (?, ?, 'index.js', ?, ?, '{}', ?, 1)`,
		branch,
		row.commit,
		JSON.stringify(row.modules ?? {}),
		JSON.stringify(row.assets ?? {}),
		row.manifest ?? null,
	);
}

describe('SpaceDO.getDeploymentTexts', () => {
	it('getDeploymentTexts returns html and js text for a branch and null for a branch never deployed', async () => {
		await runInDurableObject(uniqueStub('files'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deploy(sql, 'draft-fix00001', {
				commit: 'c9',
				manifest: '{"version":1}',
				assets: {
					'/index.html': '<h1>Fresh tea</h1>',
					'/shop/menu.HTM': '<p>Menu</p>',
					'/app.js': 'const cta = "Add to cart";',
					'/lib/cart.mjs': 'export const empty = "Your cart is empty";',
					'/style.css': 'body { color: red; }',
					'/logo.png': 'iVBORw0KGgo=',
					'/data.json': '{"a":1}',
				},
				modules: {
					'index.js': 'export class App {}',
					'wrapped.js': { js: 'export const hello = "Hello there";' },
					'legacy.js': { cjs: 'module.exports = "Legacy text";' },
					__STATIC_CONTENT_MANIFEST: { text: '{}' },
					'config.json': { json: { a: 1 } },
				},
			});

			expect(readDeploymentTexts(sql, 'draft-fix00001')).toEqual({
				branch: 'draft-fix00001',
				commitHash: 'c9',
				files: [
					{ path: '/index.html', kind: 'html', text: '<h1>Fresh tea</h1>' },
					{ path: '/shop/menu.HTM', kind: 'html', text: '<p>Menu</p>' },
					{ path: '/app.js', kind: 'script', text: 'const cta = "Add to cart";' },
					{ path: '/lib/cart.mjs', kind: 'script', text: 'export const empty = "Your cart is empty";' },
					{ path: 'index.js', kind: 'script', text: 'export class App {}' },
					{ path: 'wrapped.js', kind: 'script', text: 'export const hello = "Hello there";' },
					{ path: 'legacy.js', kind: 'script', text: 'module.exports = "Legacy text";' },
				],
				manifest: '{"version":1}',
			});
			expect(readDeploymentTexts(sql, 'draft-never00')).toBeNull();
		});
	});

	it('reads the live deployment, which only the published row holds', async () => {
		await runInDurableObject(uniqueStub('live'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deploy(sql, 'main', { commit: 'm1', assets: { '/index.html': '<p>Version one</p>' } });
			publishLiveDeployment(sql, 5, 'main');
			deploy(sql, 'main', { commit: 'm2', assets: { '/index.html': '<p>Version two</p>' } });

			expect(readDeploymentTexts(sql, LIVE_BRANCH)).toEqual({
				branch: 'live',
				commitHash: 'm1',
				files: [{ path: '/index.html', kind: 'html', text: '<p>Version one</p>' }],
				manifest: null,
			});
		});
	});

	it('gives an empty file list for a deployment with no text files', async () => {
		await runInDurableObject(uniqueStub('empty'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deploy(sql, 'main', { commit: 'e1' });
			expect(readDeploymentTexts(sql, 'main')).toEqual({ branch: 'main', commitHash: 'e1', files: [], manifest: null });
		});
	});
});

const sources = import.meta.glob<string>(['/space/src/space/durable-object.ts', '/space/src/index.ts', '/space/types/index.d.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

describe('SpaceDO.getDeploymentTexts wiring', () => {
	it('waits for init and reads the stored row without touching git or the working tree', () => {
		const text = sources['/space/src/space/durable-object.ts'];
		const start = text.indexOf('async getDeploymentTexts(');
		expect(start).toBeGreaterThan(-1);
		const body = text.slice(start, text.indexOf('\n  }\n', start));
		expect(body).toContain('await this.ensureInit()');
		expect(body).toContain('readDeploymentTexts(this.ctx.storage.sql, branch)');
		expect(body).not.toMatch(/this\.(git|fs|overlay)\b/);
	});

	it('exports DeploymentTexts to the worker, in the package\'s hand-kept types too', () => {
		const entry = sources['/space/src/index.ts'];
		const types = sources['/space/types/index.d.ts'];
		expect(entry).toMatch(/export type \{[^}]*\bDeploymentTexts\b[^}]*\} from "\.\/space\/deploy-engine"/);
		expect(types).toContain('export interface DeploymentTexts {');
		const declared = types.slice(types.indexOf('export interface DeploymentTexts {'));
		const shape = declared.slice(0, declared.indexOf('\n}\n'));
		for (const field of ['branch: string;', 'commitHash: string;', "files: { path: string; kind: 'html' | 'script'; text: string }[];", 'manifest: string | null;']) {
			expect(shape).toContain(field);
		}
	});
});
