/**
 * `deploy_space` — commits
 * the working tree and deploys a SpaceDO branch so the preview at
 * `/space/:name/preview/:branch/` rebuilds. The skills (see
 * `skills/app-file-structure`) instruct the model to call this after writing
 * files; pair it with `get_browser_console_logs` to verify the preview.
 *
 * Runs inside the ThinkAgent DO and talks to the companion SpaceDO directly via
 * RPC (no round-trip through the busy parent agent).
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { withDurableObjectResetRetry, type SpaceWorkspaceStub } from './space-workspace-ops';
import { LIVE_BRANCH } from '../../../shared/types/live-stores';
import { STORE_MANIFEST_FILE } from '../../../shared/types/store-payments';
import { parseStoreManifest } from '../../services/store-payments/manifest';

const DESCRIPTION = [
	'Commit the current working tree and deploy a branch so its preview rebuilds and serves the latest code.',
	'',
	'Call this after writing/editing files to make changes visible in the preview. Returns the deploy result as JSON, including the preview path and any build errors — read those errors and fix the code if the build failed, then redeploy.',
	'',
	"Defaults to the 'main' branch. The 'live' branch is the seller's published store: never deploy it.",
	'',
	'When the project has estori-store.json, the result includes storeFile: checkout is off until it is valid, so fix every error it lists and deploy again.',
].join('\n');

/** The store file's check, so the agent hears of a mistake that turns checkout off; nothing when there is no file. */
async function storeFileCheck(getStub: () => SpaceWorkspaceStub): Promise<{ ok: true } | { ok: false; errors: string[] } | null> {
	let text: string;
	try {
		text = await withDurableObjectResetRetry(getStub, (stub) => stub.readFile(STORE_MANIFEST_FILE));
	} catch {
		return null;
	}
	const parsed = parseStoreManifest(text);
	return parsed.ok ? { ok: true } : { ok: false, errors: parsed.errors };
}

export function createDeploySpaceTool(opts: { getStub: () => SpaceWorkspaceStub }): Tool {
	const { getStub } = opts;
	return tool({
		description: DESCRIPTION,
		inputSchema: z.object({
			branch: z
				.string()
				.optional()
				.describe("Git branch to deploy. Defaults to 'main'."),
		}),
		execute: async (args: { branch?: string }) => {
			const branch = args.branch && args.branch.length > 0 ? args.branch : 'main';
			// The live store serves what the seller published from Estori; an agent deploy must never replace it.
			if (branch.toLowerCase() === LIVE_BRANCH) {
				return JSON.stringify({ branch, error: `Branch "${branch}" is reserved for the live store. Deploy 'main'; the seller publishes it from Estori.` });
			}
			try {
				await withDurableObjectResetRetry(getStub, (stub) =>
					stub.gitCommit('deploy: snapshot working tree'),
				);
			} catch {
				// No changes to commit (clean tree) — proceed to deploy the existing HEAD.
			}
			try {
				const result = await withDurableObjectResetRetry(getStub, (stub) => stub.deploy(branch));
				const storeFile = await storeFileCheck(getStub);
				return JSON.stringify({ branch, ...(result as Record<string, unknown>), ...(storeFile ? { storeFile } : {}) }, null, 2);
			} catch (e) {
				return JSON.stringify({
					branch,
					error: `Deploy failed: ${e instanceof Error ? e.message : String(e)}`,
				});
			}
		},
	});
}
