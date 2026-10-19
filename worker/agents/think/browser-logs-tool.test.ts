import { describe, expect, it } from 'vitest';
import type { BrowserCaptureClient, CapturePayload } from '../../services/browser-capture/types';
import { createBrowserConsoleLogsTool } from './browser-logs-tool';

const agents = import.meta.glob<string>('/worker/agents/think/ThinkAgent.ts', { query: '?raw', import: 'default', eager: true });

type Execute = (args: { url?: string }, options: { toolCallId: string; messages: [] }) => Promise<string>;

function harness(initialUrl: string | undefined) {
	const state = { previewUrl: initialUrl };
	const captured: string[] = [];
	const client: Pick<BrowserCaptureClient, 'captureConsoleLogs'> = {
		captureConsoleLogs: async (payload: CapturePayload) => {
			captured.push(payload.url);
			return { url: payload.url, capturedAt: '2026-10-19T00:00:00.000Z', logs: [], pageErrors: [], requestFailures: [] };
		},
	};
	const tool = createBrowserConsoleLogsTool({ env: {} as Env, getDefaultUrl: () => state.previewUrl, createClient: () => client });
	const run = async (args: { url?: string } = {}) => JSON.parse(await (tool.execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] }));
	return { state, captured, run };
}

describe('get_browser_console_logs', () => {
	it("reads the preview URL when it runs, so a draft switch in the same turn is followed", async () => {
		const { state, captured, run } = harness('https://preview.test/main/');
		await run();
		state.previewUrl = 'https://preview.test/draft-a/';
		const second = await run();
		expect(captured).toEqual(['https://preview.test/main/', 'https://preview.test/draft-a/']);
		expect(second.url).toBe('https://preview.test/draft-a/');
	});

	it('inspects the URL it is given instead of the preview', async () => {
		const { captured, run } = harness('https://preview.test/main/');
		await run({ url: 'https://preview.test/main/about' });
		expect(captured).toEqual(['https://preview.test/main/about']);
	});

	it('says there is no preview yet when it has no URL', async () => {
		const { captured, run } = harness(undefined);
		expect((await run()).error).toContain('No preview URL available yet');
		expect(captured).toEqual([]);
	});
});

describe('the console check and the draft the AI is editing', () => {
	const agent = Object.values(agents)[0] ?? '';

	it('reads the preview URL from the agent config each time, not once when the tools are built', () => {
		expect(agent).toContain('getDefaultUrl: () => this.getConfig<ThinkAgentConfig>()?.previewUrl');
		expect(agent).not.toContain('defaultUrl: previewUrl');
	});

	it("updates only the preview URL when the host moves to another draft, leaving the system prompt alone mid-turn", () => {
		const start = agent.indexOf('async setPreviewUrl(');
		expect(start).toBeGreaterThan(-1);
		const body = agent.slice(start, agent.indexOf('\n\t}\n', start));
		expect(body).toContain('this.configure<ThinkAgentConfig>({ ...this.requireConfig(), previewUrl })');
		expect(body).not.toContain('refreshSystemPrompt');
	});
});
