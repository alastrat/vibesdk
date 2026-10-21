/**
 * Refreshing a store's texts from its deployments, with a fake SpaceDO and real SQL: live and draft texts together,
 * a store never deployed, and a SpaceDO that can't answer.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DeploymentTexts } from '@space-do/space';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { StoreTranslationService } from '../../database/services/StoreTranslationService';
import { refreshStoreTexts } from './texts';

const NOW = 1_800_000_000_000;
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
	await insertApp(db, { id: 'app_1', userId: 'seller_1' });
});

afterEach(() => vi.restoreAllMocks());

const deployment = (branch: string, commitHash: string, html: string, manifest: string | null = null): DeploymentTexts => ({
	branch,
	commitHash,
	files: [{ path: '/index.html', kind: 'html', text: html }],
	manifest,
});

interface FakeSpace {
	/** The deployment of each branch the store has; a branch it lacks was never deployed. */
	deployments: Record<string, DeploymentTexts>;
	/** The branch the preview serves. */
	activeBranch?: string;
	/** Fails the next calls, each with this error. */
	failures?: Error[];
	/** Every call, in order. */
	calls: string[];
}

function envFor(space: FakeSpace | null): Env {
	if (space === null) return envWith(db);
	const stub = {
		async getActiveDraft() {
			space.calls.push('getActiveDraft');
			const failure = space.failures?.shift();
			if (failure) throw failure;
			return { id: 'main', name: 'Main', branch: space.activeBranch ?? 'main', tip: null };
		},
		async getDeploymentTexts(branch: string) {
			space.calls.push(`getDeploymentTexts:${branch}`);
			const failure = space.failures?.shift();
			if (failure) throw failure;
			return space.deployments[branch] ?? null;
		},
	};
	return envWith(db, { SPACE_DO: { idFromName: (name: string) => name, get: () => stub } });
}

const space = (deployments: Record<string, DeploymentTexts>, extra: Partial<FakeSpace> = {}): FakeSpace => ({ deployments, calls: [], ...extra });

async function publish(status: 'live' | 'offline' = 'live'): Promise<void> {
	await db
		.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_1', 'tea', ?, 'live01', 1, 1, 1)`)
		.bind(status)
		.run();
}

const stored = async () => (await new StoreTranslationService(envWith(db)).listRows('app_1', 'es', { limit: 100 })).rows.map((row) => row.source);

describe('refreshing a store\'s texts', () => {
	it('refreshStoreTexts unions live and draft texts', async () => {
		await publish();
		const fake = space({
			live: deployment('live', 'live01', '<h1>Welcome to the shop</h1><p>Fresh tea every day</p>'),
			main: deployment('main', 'draft02', '<h1>Welcome to the shop</h1><p>New spring blends</p>'),
		});

		expect(await refreshStoreTexts(envFor(fake), 'app_1', NOW)).toEqual({ count: 3, truncated: false, deployed: true });
		// Live first, then what only the draft has; a text both have is kept once.
		expect(await stored()).toEqual(['Welcome to the shop', 'Fresh tea every day', 'New spring blends']);
		expect(fake.calls).toEqual(['getDeploymentTexts:live', 'getActiveDraft', 'getDeploymentTexts:main']);
		expect(await new StoreTranslationService(envWith(db)).extractedAt('app_1')).toBe(NOW);
	});

	it('reads the draft the preview serves, and skips it when it is the published version', async () => {
		await publish();
		const fake = space(
			{ live: deployment('live', 'same01', '<p>Same everywhere</p>'), 'draft-spring': deployment('draft-spring', 'same01', '<p>Same everywhere</p>') },
			{ activeBranch: 'draft-spring' },
		);
		expect(await refreshStoreTexts(envFor(fake), 'app_1', NOW)).toMatchObject({ count: 1, deployed: true });
		expect(fake.calls).toEqual(['getDeploymentTexts:live', 'getActiveDraft', 'getDeploymentTexts:draft-spring']);
		expect(await stored()).toEqual(['Same everywhere']);
	});

	it('reads only the draft when the store is not live, or is offline', async () => {
		const draft = { main: deployment('main', 'draft02', '<p>Only the draft</p>') };
		const unpublished = space(draft);
		expect(await refreshStoreTexts(envFor(unpublished), 'app_1', NOW)).toEqual({ count: 1, truncated: false, deployed: true });
		expect(unpublished.calls).toEqual(['getActiveDraft', 'getDeploymentTexts:main']);

		await publish('offline');
		const offline = space({ live: deployment('live', 'live01', '<p>Old live</p>'), ...draft });
		expect(await refreshStoreTexts(envFor(offline), 'app_1', NOW)).toMatchObject({ count: 1, deployed: true });
		expect(offline.calls).toEqual(['getActiveDraft', 'getDeploymentTexts:main']);
		expect(await stored()).toEqual(['Only the draft']);
	});

	it('reads a live store whose draft was never deployed', async () => {
		await publish();
		expect(await refreshStoreTexts(envFor(space({ live: deployment('live', 'live01', '<p>Live only</p>') })), 'app_1', NOW)).toEqual({ count: 1, truncated: false, deployed: true });
	});

	it('replaces the stored texts, and a store with no text finishes with none', async () => {
		await refreshStoreTexts(envFor(space({ main: deployment('main', 'c1', '<p>First version</p><p>Going away</p>') })), 'app_1', NOW);
		await refreshStoreTexts(envFor(space({ main: deployment('main', 'c2', '<p>First version</p><p>Second version</p>') })), 'app_1', NOW + 1);
		expect(await stored()).toEqual(['First version', 'Second version']);

		expect(await refreshStoreTexts(envFor(space({ main: deployment('main', 'c3', '<div><img src="a.png"></div>') })), 'app_1', NOW + 2)).toEqual({ count: 0, truncated: false, deployed: true });
		expect(await stored()).toEqual([]);
	});

	it('a store never deployed gives deployed false and no texts', async () => {
		const fake = space({});
		expect(await refreshStoreTexts(envFor(fake), 'app_1', NOW)).toEqual({ count: 0, truncated: false, deployed: false });
		expect(await stored()).toEqual([]);
		expect(await new StoreTranslationService(envWith(db)).extractedAt('app_1')).toBeNull();

		// A live store whose published copy is gone, with no draft deployed either.
		await publish();
		expect(await refreshStoreTexts(envFor(space({})), 'app_1', NOW)).toEqual({ count: 0, truncated: false, deployed: false });
	});

	it('a cold SpaceDO error is reported, not thrown past the caller', async () => {
		await refreshStoreTexts(envFor(space({ main: deployment('main', 'c1', '<p>Kept text</p>') })), 'app_1', NOW);

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const down = space({ main: deployment('main', 'c2', '<p>Other text</p>') }, { failures: [new Error('Something went wrong')] });
		expect(await refreshStoreTexts(envFor(down), 'app_1', NOW + 1)).toEqual({ count: 0, truncated: false, deployed: false, error: 'unavailable' });
		expect(warn).toHaveBeenCalledTimes(1);
		// What was stored stays, and the extraction time with it.
		expect(await stored()).toEqual(['Kept text']);
		expect(await new StoreTranslationService(envWith(db)).extractedAt('app_1')).toBe(NOW);

		// No SpaceDO binding at all.
		expect(await refreshStoreTexts(envFor(null), 'app_1', NOW + 2)).toEqual({ count: 0, truncated: false, deployed: false, error: 'unavailable' });
		expect(warn).toHaveBeenCalledTimes(2);
	});

	it('retries once when the SpaceDO was reset, and reports it when it fails again', async () => {
		const reset = () => new Error('Durable Object reset because its code was updated.');
		const once = space({ main: deployment('main', 'c1', '<p>After the reset</p>') }, { failures: [reset()] });
		expect(await refreshStoreTexts(envFor(once), 'app_1', NOW)).toEqual({ count: 1, truncated: false, deployed: true });
		expect(once.calls).toEqual(['getActiveDraft', 'getActiveDraft', 'getDeploymentTexts:main']);

		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const twice = space({ main: deployment('main', 'c1', '<p>After the reset</p>') }, { failures: [reset(), reset()] });
		expect(await refreshStoreTexts(envFor(twice), 'app_1', NOW)).toMatchObject({ deployed: false, error: 'unavailable' });
		expect(twice.calls).toEqual(['getActiveDraft', 'getActiveDraft']);
	});

	it('reports a store with more texts than the limit as truncated', async () => {
		const paragraphs = Array.from({ length: 5_001 }, (_, index) => `<p>Item number ${index} here</p>`).join('');
		const result = await refreshStoreTexts(envFor(space({ main: deployment('main', 'c1', paragraphs) })), 'app_1', NOW);
		expect(result).toEqual({ count: 5_000, truncated: true, deployed: true });
	});
});
