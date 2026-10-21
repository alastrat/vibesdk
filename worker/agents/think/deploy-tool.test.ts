import { describe, expect, it } from 'vitest';
import { createDeploySpaceTool } from './deploy-tool';
import type { SpaceWorkspaceStub } from './space-workspace-ops';

type Execute = (args: { branch?: string }, options: { toolCallId: string; messages: [] }) => Promise<string>;

const STORE_FILE = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 600 },
	products: [{ id: 'trail-mug', name: 'Trail Mug', variants: [{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2400 }] }],
};

function toolWith(deployed: string[], storeFile?: string) {
	const stub = {
		gitCommit: async () => ({}),
		getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' }),
		deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
		readFile: async (path: string) => {
			if (path !== 'estori-store.json' || storeFile === undefined) throw new Error(`ENOENT: ${path}`);
			return storeFile;
		},
	} as unknown as SpaceWorkspaceStub;
	const tool = createDeploySpaceTool({ getStub: () => stub });
	return (args: { branch?: string }) => (tool.execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] });
}

describe('deploy_space', () => {
	it("refuses the live branch, which only the seller's publish writes", async () => {
		const deployed: string[] = [];
		const result = JSON.parse(await toolWith(deployed)({ branch: 'live' }));
		expect(result.error).toContain('reserved for the live store');
		expect(deployed).toEqual([]);
	});

	it('deploys main by default', async () => {
		const deployed: string[] = [];
		await toolWith(deployed)({});
		expect(deployed).toEqual(['main']);
	});

	it("tells the agent what's wrong with the store file after a deploy, since checkout is off until it's valid", async () => {
		const deployed: string[] = [];
		const broken = JSON.stringify({ ...STORE_FILE, brand: { name: 'Trail', colors: { accent: 'blue' } } });
		const result = JSON.parse(await toolWith(deployed, broken)({}));
		expect(result.preview_url).toBe('/space/s/preview/main/');
		expect(result.storeFile.ok).toBe(false);
		expect(result.storeFile.errors.join(' ')).toContain('brand.colors.accent');

		expect(JSON.parse(await toolWith([], JSON.stringify(STORE_FILE))({})).storeFile).toEqual({ ok: true });
		expect(JSON.parse(await toolWith([])({}))).not.toHaveProperty('storeFile');
	});

	it("deploys the draft being edited, and refuses any other version, including 'published'", async () => {
		const deployed: string[] = [];
		const stub = {
			gitCommit: async () => ({}),
			getActiveDraft: async () => ({ id: 'k3x9q2mf', name: 'Typo fix', branch: 'draft-k3x9q2mf', tip: 'c1' }),
			deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
			readFile: async () => { throw new Error('ENOENT'); },
		} as unknown as SpaceWorkspaceStub;
		const tool = createDeploySpaceTool({ getStub: () => stub });
		const run = (args: { branch?: string }) => (tool.execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] });
		await run({});
		expect(deployed).toEqual(['draft-k3x9q2mf']);
		for (const branch of ['main', 'published']) {
			expect(JSON.parse(await run({ branch })).error).toContain('Switch to it with switch_draft first');
		}
		expect(deployed).toEqual(['draft-k3x9q2mf']);
	});

	it('does not deploy while conflict markers remain, since that would build the old version and report success', async () => {
		const deployed: string[] = [];
		const stub = {
			gitCommit: async () => { throw new Error('Remove the conflict markers from about.html first.'); },
			getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' }),
			deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
			readFile: async () => { throw new Error('ENOENT'); },
		} as unknown as SpaceWorkspaceStub;
		const tool = createDeploySpaceTool({ getStub: () => stub });
		const result = JSON.parse(await (tool.execute as unknown as Execute)({}, { toolCallId: 'call_1', messages: [] }));
		expect(result).toEqual({ branch: 'main', error: 'Remove the conflict markers from about.html first.' });
		expect(deployed).toEqual([]);
	});

	it('still deploys when the commit fails for another reason, such as a clean tree', async () => {
		const deployed: string[] = [];
		const stub = {
			gitCommit: async () => { throw new Error('nothing to commit'); },
			getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' }),
			deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
			readFile: async () => { throw new Error('ENOENT'); },
		} as unknown as SpaceWorkspaceStub;
		const tool = createDeploySpaceTool({ getStub: () => stub });
		await (tool.execute as unknown as Execute)({}, { toolCallId: 'call_1', messages: [] });
		expect(deployed).toEqual(['main']);
	});
});
