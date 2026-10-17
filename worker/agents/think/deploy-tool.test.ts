import { describe, expect, it } from 'vitest';
import { createDeploySpaceTool } from './deploy-tool';
import type { SpaceWorkspaceStub } from './space-workspace-ops';

type Execute = (args: { branch?: string }, options: { toolCallId: string; messages: [] }) => Promise<string>;

function toolWith(deployed: string[]) {
	const stub = {
		gitCommit: async () => ({}),
		deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
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
});
