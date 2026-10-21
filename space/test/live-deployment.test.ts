/**
 * Publishing a live store against a real DO `SqlStorage` (via the FsHarnessDO harness): the `live` deployment is a copy
 * of the build the seller previewed, and publishing never touches the preview's own deployment.
 */
import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import {
	DEPLOYMENTS_TABLE_SQL,
	LIVE_BRANCH,
	isReservedBranch,
	migrateDeploymentsTable,
	publishLiveDeployment,
	publishedVersion,
	servedUrl,
} from '../src/space/deploy-engine';
import type {} from './test-env';

function uniqueStub(name: string) {
	const id = env.FsHarnessDO.idFromName(`live-${name}-${Date.now()}-${Math.random()}`);
	return env.FsHarnessDO.get(id);
}

function deployMain(sql: SqlStorage, commit: string, manifest: string | null): void {
	sql.exec(
		`INSERT OR REPLACE INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('main', ?, 'index.js', ?, '{}', '{}', ?, 1)`,
		commit,
		JSON.stringify({ 'index.js': `export default ${JSON.stringify(commit)}` }),
		manifest,
	);
}

function rowOf(sql: SqlStorage, branch: string): Record<string, unknown> | null {
	return sql.exec('SELECT * FROM deployments WHERE branch = ?', branch).toArray()[0] ?? null;
}

describe('publishLiveDeployment', () => {
	it("copies the previewed build into live, and later edits to the preview don't reach live until the next publish", async () => {
		await runInDurableObject(uniqueStub('copy'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deployMain(sql, 'c1', '{"version":1}');
			expect(publishLiveDeployment(sql, 50, 'main')).toEqual({ commitHash: 'c1', storeManifest: '{"version":1}' });
			const live = rowOf(sql, LIVE_BRANCH);
			expect(live).toMatchObject({ branch: 'live', commit_hash: 'c1', main_module: 'index.js', store_manifest: '{"version":1}', deployed_at: 50 });
			expect(live?.modules).toBe(rowOf(sql, 'main')?.modules);

			deployMain(sql, 'c2', null);
			expect(rowOf(sql, LIVE_BRANCH)).toMatchObject({ commit_hash: 'c1' });
			expect(publishLiveDeployment(sql, 60, 'main')).toEqual({ commitHash: 'c2', storeManifest: null });
			expect(rowOf(sql, LIVE_BRANCH)).toMatchObject({ commit_hash: 'c2', deployed_at: 60 });
			expect(rowOf(sql, 'main')).toMatchObject({ commit_hash: 'c2', deployed_at: 1 });
		});
	});

	it('publishes nothing when the preview was never deployed', async () => {
		await runInDurableObject(uniqueStub('empty'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			expect(publishLiveDeployment(sql, 50, 'main')).toBeNull();
			expect(rowOf(sql, LIVE_BRANCH)).toBeNull();
		});
	});

	it("publishes a draft's own build and records the draft it came from", async () => {
		await runInDurableObject(uniqueStub('draft'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deployMain(sql, 'm1', null);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('draft-fix00001', 'f1', 'index.js', '{}', '{}', '{}', '{"version":2}', 2)`,
			);
			expect(publishedVersion(sql)).toBeNull();
			expect(publishLiveDeployment(sql, 70, 'draft-fix00001')).toEqual({ commitHash: 'f1', storeManifest: '{"version":2}' });
			expect(publishedVersion(sql)).toEqual({ commit: 'f1', sourceBranch: 'draft-fix00001' });
			expect(rowOf(sql, 'main')).toMatchObject({ commit_hash: 'm1' });
			expect(publishLiveDeployment(sql, 80, 'draft-never00')).toBeNull();
			expect(publishLiveDeployment(sql, 80, 'live')).toBeNull();
			expect(publishedVersion(sql)).toEqual({ commit: 'f1', sourceBranch: 'draft-fix00001' });
		});
	});

	it('reads a store published before drafts as published from Main', async () => {
		await runInDurableObject(uniqueStub('legacy'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('live', 'old', 'index.js', '{}', '{}', '{}', NULL, 1)`,
			);
			expect(publishedVersion(sql)).toEqual({ commit: 'old', sourceBranch: 'main' });
		});
	});

	it('gives a store deployed before drafts the source column, keeping its live store published from Main', async () => {
		await runInDurableObject(uniqueStub('migrate'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(`CREATE TABLE deployments (
				branch TEXT PRIMARY KEY,
				commit_hash TEXT NOT NULL,
				main_module TEXT NOT NULL,
				modules TEXT NOT NULL,
				assets TEXT NOT NULL DEFAULT '{}',
				asset_config TEXT NOT NULL DEFAULT '{}',
				store_manifest TEXT,
				deployed_at INTEGER NOT NULL
			)`);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('live', 'old', 'index.js', '{}', '{}', '{}', NULL, 1)`,
			);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('draft-fix00001', 'f1', 'index.js', '{}', '{}', '{}', NULL, 2)`,
			);
			migrateDeploymentsTable(sql);
			migrateDeploymentsTable(sql);
			expect(publishedVersion(sql)).toEqual({ commit: 'old', sourceBranch: 'main' });
			expect(publishLiveDeployment(sql, 90, 'draft-fix00001')).toEqual({ commitHash: 'f1', storeManifest: null });
			expect(rowOf(sql, LIVE_BRANCH)).toMatchObject({ commit_hash: 'f1', source_branch: 'draft-fix00001', deployed_at: 90 });
			expect(publishedVersion(sql)).toEqual({ commit: 'f1', sourceBranch: 'draft-fix00001' });
		});
	});

	it('reserves the live branch name, so no deploy can overwrite the live store', () => {
		expect(isReservedBranch('live')).toBe(true);
		expect(isReservedBranch('LIVE')).toBe(true);
		expect(isReservedBranch('main')).toBe(false);
	});
});

describe('servedUrl', () => {
	it("keeps the store's own host for any path, so a path that starts with // can't name another host", () => {
		const url = servedUrl(new URL('https://northwind-tea.estori.shop/__live//evil.example/login?next=1'), '//evil.example/login');
		expect(url.host).toBe('northwind-tea.estori.shop');
		expect(url.pathname).toBe('//evil.example/login');
		expect(url.search).toBe('?next=1');
		expect(servedUrl(new URL('https://northwind-tea.estori.shop/__live'), '').href).toBe('https://northwind-tea.estori.shop/');
	});
});
