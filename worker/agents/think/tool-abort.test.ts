import { describe, expect, it, vi } from 'vitest';
import type { Tool } from 'ai';
import { createDeploySpaceTool } from './deploy-tool';
import { createCommitTool } from './commit-tool';
import { createBrowserConsoleLogsTool } from './browser-logs-tool';
import type { SpaceWorkspaceStub } from './space-workspace-ops';
import type { CapturePayload } from '../../services/browser-capture/types';

const STOP = 'Stopped by the user';

const capture = vi.hoisted(() => ({
	signal: undefined as AbortSignal | undefined,
}));

vi.mock('../../services/browser-capture/factory', () => ({
	getBrowserCaptureClient: () => ({
		// Like a real capture whose page is closed on abort: it fails once the signal aborts.
		captureConsoleLogs: (_payload: CapturePayload, signal?: AbortSignal) => {
			capture.signal = signal;
			return new Promise((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(new Error('Target closed')));
			});
		},
	}),
}));

/** Runs a tool the way the AI SDK does, with the turn's abort signal. */
async function run(tool: Tool, input: Record<string, unknown>, abortSignal: AbortSignal): Promise<unknown> {
	if (!tool.execute) throw new Error('Tool has no execute');
	return await tool.execute(input, { toolCallId: 'call-1', messages: [], abortSignal });
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (reason: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** A SpaceDO whose commit and deploy RPCs stay in flight until the test settles them. */
function fakeSpace() {
	const commit = deferred<{ sha: string; message: string }>();
	const deploy = deferred<unknown>();
	const calls: string[] = [];
	const stub = {
		gitCommit: (message: string) => {
			calls.push(`commit:${message}`);
			return commit.promise;
		},
		deploy: (branch: string) => {
			calls.push(`deploy:${branch}`);
			return deploy.promise;
		},
	} as unknown as SpaceWorkspaceStub;
	return { stub, commit, deploy, calls };
}

describe('deploy_space', () => {
	it('deploys as before when the turn is not stopped', async () => {
		const space = fakeSpace();
		const tool = createDeploySpaceTool({ getStub: () => space.stub });
		space.commit.reject(new Error('nothing to commit'));
		space.deploy.resolve({ preview_url: '/space/app-1/preview/main/' });

		const result = await run(tool, {}, new AbortController().signal);

		expect(JSON.parse(String(result))).toEqual({ branch: 'main', preview_url: '/space/app-1/preview/main/' });
	});

	it('stops waiting for a deploy in flight', async () => {
		const space = fakeSpace();
		const tool = createDeploySpaceTool({ getStub: () => space.stub });
		const controller = new AbortController();
		space.commit.resolve({ sha: 'abc', message: 'deploy: snapshot working tree' });
		const result = run(tool, {}, controller.signal);
		await vi.waitFor(() => expect(space.calls).toContain('deploy:main'));

		controller.abort(STOP);
		space.deploy.resolve({ preview_url: '/space/app-1/preview/main/' });

		await expect(result).rejects.toBe(STOP);
	});

	it('does not deploy after a Stop during the commit', async () => {
		const space = fakeSpace();
		const tool = createDeploySpaceTool({ getStub: () => space.stub });
		const controller = new AbortController();
		space.deploy.resolve({ preview_url: '/space/app-1/preview/main/' });
		const result = run(tool, {}, controller.signal);
		await vi.waitFor(() => expect(space.calls).toEqual(['commit:deploy: snapshot working tree']));

		controller.abort(STOP);
		space.commit.reject(new Error('nothing to commit'));

		await expect(result).rejects.toBe(STOP);
		expect(space.calls).not.toContain('deploy:main');
	});
});

describe('commit', () => {
	it('reports a Stop instead of nothing to commit', async () => {
		const space = fakeSpace();
		const tool = createCommitTool({ getStub: () => space.stub });
		const controller = new AbortController();
		const result = run(tool, { message: 'Add login form' }, controller.signal);
		await vi.waitFor(() => expect(space.calls).toEqual(['commit:Add login form']));

		controller.abort(STOP);
		space.commit.reject(new Error('nothing to commit'));

		await expect(result).rejects.toBe(STOP);
	});
});

describe('get_browser_console_logs', () => {
	it('passes the turn signal to the capture and reports a Stop as an abort', async () => {
		const tool = createBrowserConsoleLogsTool({ env: {} as Env, defaultUrl: 'https://estori.app/preview' });
		const controller = new AbortController();
		const result = run(tool, {}, controller.signal);
		await vi.waitFor(() => expect(capture.signal).toBe(controller.signal));

		controller.abort(STOP);

		await expect(result).rejects.toBe(STOP);
	});
});
