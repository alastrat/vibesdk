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

/** A usage check that records when it runs, so tests can assert it ran and when. */
function recordingCheck(order: string[], result: { allowed: boolean; reason?: string }): typeof checkUsageAndBalance {
	return (async () => {
		order.push('usage-check');
		return result;
	}) as unknown as typeof checkUsageAndBalance;
}

function fakes(behavior: FakeBehavior, calls: string[] = []) {
	const sent: Array<{ type: string; error?: string; code?: string; showAsPopup?: boolean }> = [];
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

	it('resumes the build after switching and passing the usage check', async () => {
		const order: string[] = [];
		const { agent, connection, sent } = fakes({ setModel: async (id) => void order.push(`model:${id}`) }, order);
		const usageCheck = recordingCheck(order, { allowed: true });
		await handleWebSocketMessage(agent, connection, setModel('google-ai-studio/gemini-3.6-flash', true), usageCheck);
		expect(order).toEqual(['model:google-ai-studio/gemini-3.6-flash', 'usage-check', `input:${RESUME_BUILD_MESSAGE}`]);
		expect(sent).toEqual([]);
	});

	it('switches but does not resume when the usage check blocks', async () => {
		const order: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async (id) => void order.push(`model:${id}`) });
		const usageCheck = recordingCheck(order, { allowed: false, reason: 'limit' });
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), usageCheck);
		expect(order).toEqual(['model:anthropic/claude-opus-5-5', 'usage-check']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([{ type: 'error', error: 'limit', code: 'USAGE_LIMIT_EXCEEDED', showAsPopup: true }]);
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
