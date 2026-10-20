import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'agents';
import { handleWebSocketMessage } from './websocket';
import type { CodeGeneratorAgent } from './codingAgent';
import type { checkUsageAndBalance } from '../../services/rate-limit';
import type { checkCreditsBeforeTurn } from '../../services/billing/metering';
import { RESUME_BUILD_MESSAGE } from '../../../shared/think';
import { AI_BUILDS_PAUSED_CODE, AI_BUILDS_PAUSED_MESSAGE } from '../../../shared/types/pauses';

interface FakeBehavior {
	setModel?: (modelId: string) => Promise<void>;
	generateAllFiles?: () => Promise<void>;
	isCodeGenerating?: () => boolean;
}

const allowAll = (async () => ({ allowed: true })) as unknown as typeof checkUsageAndBalance;

/** A usage check that records when it runs, so tests can assert it ran and when. */
function recordingCheck(order: string[], result: { allowed: boolean; reason?: string }): typeof checkUsageAndBalance {
	return (async () => {
		order.push('usage-check');
		return result;
	}) as unknown as typeof checkUsageAndBalance;
}

function creditCheck(order: string[], result: Awaited<ReturnType<typeof checkCreditsBeforeTurn>>): typeof checkCreditsBeforeTurn {
	return async () => {
		order.push('credit-check');
		return result;
	};
}

const REFUSAL = { code: 'plan_limit' as const, limit: 'aiCredits' as const, plan: 'basic' as const, upgradeTo: 'pro' as const, message: "You've used this month's free AI credits. They refill on November 12, or get Pro for 20,000 a month." };

function fakes(behavior: FakeBehavior, calls: string[] = [], behaviorType: 'think' | 'phasic' = 'think', env: Record<string, string> = {}) {
	const sent: Array<{ type: string; error?: string; code?: string; showAsPopup?: boolean }> = [];
	const connection = { id: 'c1', url: 'wss://estori.app/ws', send: (data: string) => sent.push(JSON.parse(data)) } as unknown as Connection;
	const agent = {
		getBehavior: () => behavior,
		state: { metadata: { userId: 'u1' }, behaviorType },
		env,
		setState: () => undefined,
		handleUserInput: async (message: string) => void calls.push(`input:${message}`),
	} as unknown as CodeGeneratorAgent;
	return { sent, calls, connection, agent };
}

function userSuggestion(message: string): string {
	return JSON.stringify({ type: 'user_suggestion', message });
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

describe('the credit check before a turn', () => {
	it('refuses with the plan limit and skips the old usage check while billing is on', async () => {
		const order: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async () => undefined });
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: REFUSAL }));
		expect(order).toEqual(['credit-check']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([{ type: 'error', error: REFUSAL.message, code: 'PLAN_LIMIT', planLimit: REFUSAL, showAsPopup: true }]);
	});

	it('lets the turn start with credit left, and keeps the old check while billing is off', async () => {
		const order: string[] = [];
		const { agent, connection } = fakes({ setModel: async () => undefined }, order);
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: null }));
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: false }));
		expect(order).toEqual(['credit-check', `input:${RESUME_BUILD_MESSAGE}`, 'credit-check', 'usage-check', `input:${RESUME_BUILD_MESSAGE}`]);
	});

	it("keeps the old usage check for an older builder's app while billing is on, after the credit check", async () => {
		const order: string[] = [];
		const { agent, connection, sent } = fakes({}, order, 'phasic');
		await handleWebSocketMessage(agent, connection, userSuggestion('Add a cart'), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: null }));
		await handleWebSocketMessage(agent, connection, userSuggestion('Add a cart'), recordingCheck(order, { allowed: true }), creditCheck(order, { billing: true, refusal: REFUSAL }));
		expect(order).toEqual(['credit-check', 'usage-check', 'input:Add a cart', 'credit-check']);
		expect(sent).toEqual([{ type: 'error', error: REFUSAL.message, code: 'PLAN_LIMIT', planLimit: REFUSAL, showAsPopup: true }]);
	});
});

describe('while AI builds are paused', () => {
	const PAUSED = { FEATURE_FLAG_OVERRIDES: 'ai-builds-paused=on' };
	const NOTICE = { type: 'error', error: AI_BUILDS_PAUSED_MESSAGE, code: AI_BUILDS_PAUSED_CODE, showAsPopup: true };
	const suggestion = JSON.stringify({ type: 'user_suggestion', message: 'Add a sale banner' });

	it('refuses a new message with the notice, before the usage check and the AI', async () => {
		const order: string[] = [];
		const { agent, connection, sent } = fakes({}, order, 'think', PAUSED);
		await handleWebSocketMessage(agent, connection, suggestion, recordingCheck(order, { allowed: true }));
		expect(order).toEqual([]);
		expect(sent).toEqual([NOTICE]);
	});

	it('switches the model but does not resume the build', async () => {
		const switched: string[] = [];
		const { agent, connection, sent, calls } = fakes({ setModel: async (id) => void switched.push(id) }, [], 'think', PAUSED);
		await handleWebSocketMessage(agent, connection, setModel('anthropic/claude-opus-5-5', true), allowAll);
		expect(switched).toEqual(['anthropic/claude-opus-5-5']);
		expect(calls).toEqual([]);
		expect(sent).toEqual([NOTICE]);
	});

	it.each(['generate_all', 'resume_generation'])('refuses %s without starting a build', async (type) => {
		const generateAllFiles = vi.fn(async () => undefined);
		const { agent, connection, sent } = fakes({ generateAllFiles, isCodeGenerating: () => false }, [], 'think', PAUSED);
		await handleWebSocketMessage(agent, connection, JSON.stringify({ type }), allowAll);
		expect(generateAllFiles).not.toHaveBeenCalled();
		expect(sent).toEqual([NOTICE]);
	});

	it('lets a new message through once the pause is off', async () => {
		const { agent, connection, sent, calls } = fakes({}, [], 'think', { FEATURE_FLAG_OVERRIDES: 'ai-builds-paused=off' });
		await handleWebSocketMessage(agent, connection, suggestion, allowAll);
		expect(calls).toEqual(['input:Add a sale banner']);
		expect(sent).toEqual([]);
	});
});
