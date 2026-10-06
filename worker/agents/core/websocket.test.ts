import { describe, expect, it } from 'vitest';
import type { Connection } from 'agents';
import { handleWebSocketMessage } from './websocket';
import type { CodeGeneratorAgent } from './codingAgent';
import type { checkUsageAndBalance } from '../../services/rate-limit';
import { RESUME_BUILD_MESSAGE } from '../../../shared/think';

interface FakeBehavior {
	setModel?: (modelId: string) => Promise<void>;
}

const allowAll = (async () => ({ allowed: true })) as unknown as typeof checkUsageAndBalance;

function fakes(behavior: FakeBehavior) {
	const sent: Array<{ type: string; error?: string }> = [];
	const calls: string[] = [];
	const connection = { id: 'c1', url: 'wss://estori.app/ws', send: (data: string) => sent.push(JSON.parse(data)) } as unknown as Connection;
	const agent = {
		getBehavior: () => behavior,
		state: { metadata: { userId: 'u1' } },
		env: {},
		setState: () => undefined,
		handleUserInput: async (message: string) => void calls.push(`input:${message}`),
	} as unknown as CodeGeneratorAgent;
	return { sent, calls, connection, agent };
}

function setModel(modelId: string | undefined, resume?: boolean): string {
	return JSON.stringify({ type: 'set_model', ...(modelId ? { modelId } : {}), ...(resume ? { resume } : {}) });
}

describe('set_model', () => {
	it('switches the app to a catalog model', async () => {
		const switched: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async (id) => void switched.push(id) });
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5'), allowAll);
		expect(switched).toEqual(['anthropic/claude-opus-5-5']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([]);
	});

	it('resumes the build after switching when asked', async () => {
		const order: string[] = [];
		const { agent, connection, calls } = fakes({ setModel: async (id) => void order.push(`model:${id}`) });
		await handleWebSocketMessage(agent, connection, setModel('google-ai-studio/gemini-3.6-flash', true), allowAll);
		expect([...order, ...calls]).toEqual(['model:google-ai-studio/gemini-3.6-flash', `input:${RESUME_BUILD_MESSAGE}`]);
	});

	it('rejects ids outside the catalog', async () => {
		const switched: string[] = [];
		const { agent, connection, sent } = fakes({ setModel: async (id) => void switched.push(id) });
		await handleWebSocketMessage(agent, connection, setModel('openai/gpt-9'), allowAll);
		await handleWebSocketMessage(agent, connection, setModel(undefined), allowAll);
		expect(switched).toEqual([]);
		expect(sent).toEqual([
			{ type: 'error', error: 'Unknown model' },
			{ type: 'error', error: 'Unknown model' },
		]);
	});

	it('reports apps that cannot change models', async () => {
		const { agent, connection, sent } = fakes({});
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5'), allowAll);
		expect(sent).toEqual([{ type: 'error', error: 'Model selection is not supported for this app' }]);
	});

	it('reports a failed switch and does not resume', async () => {
		const { agent, connection, sent, calls } = fakes({
			setModel: async () => {
				throw new Error('the agent could not be reconfigured');
			},
		});
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), allowAll);
		expect(sent).toEqual([{ type: 'error', error: 'Could not switch model: the agent could not be reconfigured' }]);
		expect(calls).toEqual([]);
	});
});
