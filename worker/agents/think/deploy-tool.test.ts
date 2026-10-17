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
});

