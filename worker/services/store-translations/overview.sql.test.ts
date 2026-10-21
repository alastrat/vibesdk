/**
 * The overview under the page's polling, on real SQL with SpaceDO and the agent counted: the page asks every few seconds
 * while a task runs, so a read of the store that wrote nothing and a preview link are remembered for a while instead of
 * being asked again on every call.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentTexts } from '@space-do/space';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { buildOverview } from './overview';

/** What the agent is asked and how it answers: a link, null for a store it has no deployment of, or an error. */
const agent = vi.hoisted((): { rpcs: number; answer: string | null | 'down' } => ({ rpcs: 0, answer: 'https://estori.app/space/x/preview/main/?t=signed' }));

vi.mock('../../agents', () => ({
	getAgentStubLightweight: async () => ({
		getPublicPreviewURL: async () => {
			agent.rpcs += 1;
			if (agent.answer === 'down') throw new Error('agent unreachable');
			return agent.answer;
		},
	}),
}));

const NOW = 1_800_000_000_000;
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DEPLOYED_AT = 1_700_000_000;
let db: D1Database;
let spaceCalls: string[];
let spaceDown: boolean;
let deployments: Record<string, DeploymentTexts>;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'seller_1');
});

beforeEach(() => {
	spaceCalls = [];
	spaceDown = false;
	deployments = { main: { branch: 'main', commitHash: 'c1', files: [{ path: '/index.html', kind: 'html', text: '<h1>Fresh tea every day</h1>' }], manifest: null } };
	agent.rpcs = 0;
	agent.answer = 'https://estori.app/space/x/preview/main/?t=signed';
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

const env = (): Env => {
	const stub = {
		async getActiveDraft() {
			spaceCalls.push('getActiveDraft');
			if (spaceDown) throw new Error('SpaceDO is down');
			return { id: 'main', name: 'Main', branch: 'main', tip: null };
		},
		async getDeploymentTexts(branch: string) {
			spaceCalls.push(`getDeploymentTexts:${branch}`);
			if (spaceDown) throw new Error('SpaceDO is down');
			return deployments[branch] ?? null;
		},
	};
	return envWith(db, { SPACE_DO: { idFromName: (name: string) => name, get: () => stub } });
};

async function store(id: string): Promise<void> {
	await insertApp(db, { id, userId: 'seller_1' });
	await db.prepare('UPDATE apps SET last_deployed_at = ? WHERE id = ?').bind(DEPLOYED_AT, id).run();
}

/** One SpaceDO read of a store: its active draft, then that draft's texts. */
const ONE_READ = ['getActiveDraft', 'getDeploymentTexts:main'];

describe('the overview under polling', () => {
	it('two overview calls 3 s apart make one SpaceDO read and one agent RPC', async () => {
		await store('app_poll');
		const first = await buildOverview(env(), 'app_poll', 'seller_1', NOW);
		const second = await buildOverview(env(), 'app_poll', 'seller_1', NOW + 3 * SECOND);
		expect(spaceCalls).toEqual(ONE_READ);
		expect(agent.rpcs).toBe(1);
		expect(second).toEqual(first);
		expect(second?.previewUrl).toBe('https://estori.app/space/x/preview/main/?t=signed');
		expect(second?.languages[0].total).toBe(1);
	});

	it('asks the agent for the link again once its ten minutes are up, well before the signed link itself expires', async () => {
		await store('app_link');
		await buildOverview(env(), 'app_link', 'seller_1', NOW);
		await buildOverview(env(), 'app_link', 'seller_1', NOW + 9 * MINUTE);
		expect(agent.rpcs).toBe(1);
		await buildOverview(env(), 'app_link', 'seller_1', NOW + 10 * MINUTE + SECOND);
		expect(agent.rpcs).toBe(2);
	});

	it('does not ask an agent that cannot answer, or has no link yet, again for a minute', async () => {
		await store('app_down');
		agent.answer = 'down';
		const down = await buildOverview(env(), 'app_down', 'seller_1', NOW);
		await buildOverview(env(), 'app_down', 'seller_1', NOW + 3 * SECOND);
		expect(down?.previewUrl).toBeNull();
		expect(agent.rpcs).toBe(1);
		agent.answer = 'https://estori.app/space/x/preview/main/?t=back';
		expect((await buildOverview(env(), 'app_down', 'seller_1', NOW + MINUTE + SECOND))?.previewUrl).toBe('https://estori.app/space/x/preview/main/?t=back');
		expect(agent.rpcs).toBe(2);

		await store('app_nolink');
		agent.answer = null;
		expect((await buildOverview(env(), 'app_nolink', 'seller_1', NOW))?.previewUrl).toBeNull();
		await buildOverview(env(), 'app_nolink', 'seller_1', NOW + 3 * SECOND);
		expect(agent.rpcs).toBe(3);
	});

	it('keeps each store\'s link apart', async () => {
		await store('app_one');
		await store('app_two');
		agent.answer = 'https://estori.app/space/one/preview/main/?t=1';
		await buildOverview(env(), 'app_one', 'seller_1', NOW);
		agent.answer = 'https://estori.app/space/two/preview/main/?t=2';
		const two = await buildOverview(env(), 'app_two', 'seller_1', NOW + SECOND);
		expect(two?.previewUrl).toBe('https://estori.app/space/two/preview/main/?t=2');
		expect((await buildOverview(env(), 'app_one', 'seller_1', NOW + 2 * SECOND))?.previewUrl).toBe('https://estori.app/space/one/preview/main/?t=1');
		expect(agent.rpcs).toBe(2);
	});

	it('does not read a store again for a minute after a read that could not be written, and says so each time', async () => {
		await store('app_outage');
		spaceDown = true;
		const first = await buildOverview(env(), 'app_outage', 'seller_1', NOW);
		const second = await buildOverview(env(), 'app_outage', 'seller_1', NOW + 3 * SECOND);
		expect(spaceCalls).toEqual(['getActiveDraft']);
		expect(first).toMatchObject({ deployed: true, textsUnavailable: true });
		expect(second).toMatchObject({ deployed: true, textsUnavailable: true });

		// A minute on it tries again, and a read that works is written and ends the waiting.
		spaceDown = false;
		const recovered = await buildOverview(env(), 'app_outage', 'seller_1', NOW + MINUTE + SECOND);
		expect(spaceCalls).toEqual(['getActiveDraft', ...ONE_READ]);
		expect(recovered).toMatchObject({ deployed: true, textsUnavailable: false });
		expect(recovered?.languages[0].total).toBe(1);
		await buildOverview(env(), 'app_outage', 'seller_1', NOW + MINUTE + 4 * SECOND);
		expect(spaceCalls).toHaveLength(3);
	});

	it('does not read a store again for a minute when SpaceDO has no deployment to read, though D1 says it was deployed', async () => {
		await store('app_empty');
		deployments = {};
		const first = await buildOverview(env(), 'app_empty', 'seller_1', NOW);
		await buildOverview(env(), 'app_empty', 'seller_1', NOW + 3 * SECOND);
		expect(spaceCalls).toEqual(ONE_READ);
		expect(first).toMatchObject({ deployed: false, textsUnavailable: false, extractedAt: null });
		await buildOverview(env(), 'app_empty', 'seller_1', NOW + MINUTE + SECOND);
		expect(spaceCalls).toEqual([...ONE_READ, ...ONE_READ]);
	});

	it('still reads a store at once when a deploy lands after a read that was written, since only reads that wrote nothing wait', async () => {
		await store('app_deploys');
		await buildOverview(env(), 'app_deploys', 'seller_1', NOW);
		expect(spaceCalls).toEqual(ONE_READ);
		const later = Math.floor((NOW + 5 * SECOND) / 1000) + 1;
		await db.prepare('UPDATE apps SET last_deployed_at = ? WHERE id = ?').bind(later, 'app_deploys').run();
		deployments = { main: { branch: 'main', commitHash: 'c2', files: [{ path: '/index.html', kind: 'html', text: '<h1>Fresh tea every day</h1><p>New spring blends</p>' }], manifest: null } };
		const overview = await buildOverview(env(), 'app_deploys', 'seller_1', NOW + 10 * SECOND);
		expect(spaceCalls).toEqual([...ONE_READ, ...ONE_READ]);
		expect(overview?.languages[0].total).toBe(2);
	});
});
