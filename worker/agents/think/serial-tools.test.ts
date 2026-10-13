import { tool, type Tool, type ToolExecutionOptions } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { serializeTools } from './serial-tools';

const options = { toolCallId: 'call', messages: [] } as unknown as ToolExecutionOptions;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordingTool(log: string[], name: string, ms: number): Tool {
	return tool({
		description: name,
		inputSchema: z.object({}),
		execute: async () => {
			log.push(`${name}:start`);
			await delay(ms);
			log.push(`${name}:end`);
			return name;
		},
	});
}

function failingTool(log: string[], name: string): Tool {
	return tool({
		description: name,
		inputSchema: z.object({}),
		execute: async () => {
			log.push(`${name}:start`);
			throw new Error(`${name} failed`);
		},
	});
}

function run(t: Tool): Promise<unknown> {
	return Promise.resolve(t.execute?.({}, options));
}

describe('serializeTools', () => {
	it('finishes a slow write before a deploy called after it in the same step', async () => {
		const log: string[] = [];
		const tools = serializeTools({
			write: recordingTool(log, 'write', 30),
			deploy_space: recordingTool(log, 'deploy_space', 0),
		});

		await Promise.all([run(tools.write), run(tools.deploy_space)]);

		expect(log).toEqual(['write:start', 'write:end', 'deploy_space:start', 'deploy_space:end']);
	});

	it('returns each tool its own result', async () => {
		const log: string[] = [];
		const tools = serializeTools({
			write: recordingTool(log, 'write', 5),
			deploy_space: recordingTool(log, 'deploy_space', 0),
		});

		const results = await Promise.all([run(tools.write), run(tools.deploy_space)]);

		expect(results).toEqual(['write', 'deploy_space']);
	});

	it('keeps running later calls after one fails', async () => {
		const log: string[] = [];
		const tools = serializeTools({
			edit: failingTool(log, 'edit'),
			deploy_space: recordingTool(log, 'deploy_space', 0),
		});

		const [edit, deploy] = await Promise.allSettled([run(tools.edit), run(tools.deploy_space)]);

		expect(edit.status).toBe('rejected');
		expect(deploy).toEqual({ status: 'fulfilled', value: 'deploy_space' });
		expect(log).toEqual(['edit:start', 'deploy_space:start', 'deploy_space:end']);
	});

	it('keeps each tool description and schema', () => {
		const original = recordingTool([], 'write', 0);
		const { write } = serializeTools({ write: original });

		expect(write.description).toBe(original.description);
		expect(write.inputSchema).toBe(original.inputSchema);
	});
});

const thinkAgentSource = import.meta.glob<string>('/worker/agents/think/ThinkAgent.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
})['/worker/agents/think/ThinkAgent.ts'];

describe('ThinkAgent tool wiring', () => {
	function between(text: string, start: string, end: string): string {
		const from = text.indexOf(start);
		if (from === -1) throw new Error(`Marker not found: ${start}`);
		const to = text.indexOf(end, from + start.length);
		if (to === -1) throw new Error(`Marker not found: ${end}`);
		return text.slice(from, to);
	}

	const getTools = between(thinkAgentSource ?? '', 'override getTools(): ToolSet {', 'override async beforeStep(');

	it('runs the tools that change or deploy the workspace one at a time', () => {
		const serialized = between(getTools, 'serializeTools({', 'set_title:');
		for (const name of ['write:', 'edit:', 'delete:', 'commit:', 'deploy_space:', 'get_browser_console_logs:']) {
			expect(serialized).toContain(name);
		}
	});

	it('leaves read-only file tools free to run in parallel', () => {
		const parallel = between(getTools, 'return {', 'serializeTools({');
		for (const name of ['read:', 'list:', 'find:', 'grep:']) {
			expect(parallel).toContain(name);
		}
	});
});
