import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkCodingBehavior } from '../core/behaviors/think';
import type { AgentInfrastructure } from '../core/AgentCore';
import type { ThinkState } from '../core/state';
import { WebSocketMessageResponses } from '../constants';
import { createLogger } from '../../logger';

// The `agents` entry needs `exports` from `cloudflare:workers`, which the test runtime lacks.
vi.mock('agents', () => ({
	getAgentByName: async (namespace: DurableObjectNamespace, name: string) =>
		namespace.get(namespace.idFromName(name)),
}));

interface ChatCallback {
	onStart(event: { requestId: string }): void | Promise<void>;
}

/**
 * Stands in for the ThinkAgent DO. Like `Think.chat()`, a turn reports its
 * request id through `onStart` and, once `cancelChat` aborts that id, ends
 * without `onDone` or `onError`. Otherwise it runs until `finishTurn()`.
 */
class FakeThinkAgent {
	readonly prompts: string[] = [];
	readonly started: string[] = [];
	readonly cancelled: string[] = [];
	private readonly running = new Map<string, () => void>();
	private startGate: Promise<void> | null = null;

	async setName(): Promise<void> {}

	async chat(text: string, callback: ChatCallback): Promise<void> {
		const requestId = `req-${this.prompts.length + 1}`;
		this.prompts.push(text);
		const ended = new Promise<void>((resolve) => this.running.set(requestId, resolve));
		if (this.startGate) await this.startGate;
		await callback.onStart({ requestId });
		this.started.push(requestId);
		await ended;
		this.running.delete(requestId);
	}

	async cancelChat(requestId: string): Promise<void> {
		this.cancelled.push(requestId);
		this.running.get(requestId)?.();
	}

	async getProviderFailure(): Promise<null> {
		return null;
	}

	/** Ends every running turn as completed. */
	finishTurn(): void {
		for (const end of this.running.values()) end();
	}

	/** Holds `onStart` back, as if its RPC were still in flight, until the returned release is called. */
	holdStart(): () => void {
		let release = (): void => {};
		this.startGate = new Promise<void>((resolve) => {
			release = resolve;
		});
		return () => {
			this.startGate = null;
			release();
		};
	}
}

const agents: FakeThinkAgent[] = [];

afterEach(() => {
	for (const agent of agents.splice(0)) agent.finishTurn();
});

function createBehavior(pendingUserInputs: string[]) {
	const agent = new FakeThinkAgent();
	agents.push(agent);
	const broadcasts: string[] = [];
	let state = {
		behaviorType: 'think',
		projectType: 'app',
		query: 'build a todo app',
		pendingUserInputs,
		mvpGenerated: true,
		thinkAgentName: 'app-1',
	} as unknown as ThinkState;
	const namespace = {
		idFromName: (name: string) => name,
		get: () => agent,
	};
	const logger = createLogger('ThinkStopTest');
	const infrastructure = {
		get state() {
			return state;
		},
		setState: (next: ThinkState) => {
			state = next;
		},
		broadcast: (type: string) => {
			broadcasts.push(type);
		},
		getAgentId: () => 'app-1',
		logger: () => logger,
		env: { THINK_DO: namespace } as unknown as Env,
	} as unknown as AgentInfrastructure<ThinkState>;
	const behavior = new ThinkCodingBehavior(infrastructure, 'app');
	return { agent, behavior, broadcasts, pendingInputs: () => state.pendingUserInputs };
}

describe('stopping a think build', () => {
	it('runs queued inputs after a completed turn', async () => {
		const { agent, behavior } = createBehavior(['first']);
		const building = behavior.build();
		await vi.waitFor(() => expect(agent.started).toEqual(['req-1']));
		await behavior.queueUserRequest('second');
		agent.finishTurn();
		await vi.waitFor(() => expect(agent.started).toEqual(['req-1', 'req-2']));
		agent.finishTurn();
		await building;

		expect(agent.prompts).toEqual(['first', 'second']);
		expect(agent.cancelled).toEqual([]);
	});

	it('cancels the running turn, ends the build and keeps queued inputs', async () => {
		const { agent, behavior, broadcasts, pendingInputs } = createBehavior(['first']);
		const building = behavior.build();
		await vi.waitFor(() => expect(agent.started).toEqual(['req-1']));
		await behavior.queueUserRequest('second');

		expect(behavior.cancelCurrentInference()).toBe(true);
		await vi.waitFor(() => expect(agent.cancelled).toEqual(['req-1']));
		await building;

		expect(agent.prompts).toEqual(['first']);
		expect(pendingInputs()).toEqual(['second']);
		expect(behavior.getBuildProgress()).toBeNull();
		expect(broadcasts).not.toContain(WebSocketMessageResponses.ERROR);
		expect(broadcasts).not.toContain(WebSocketMessageResponses.MODEL_UNAVAILABLE);
	});

	it('cancels a turn whose request id arrives after Stop', async () => {
		const { agent, behavior } = createBehavior(['first']);
		const releaseStart = agent.holdStart();
		const building = behavior.build();
		await vi.waitFor(() => expect(agent.prompts).toEqual(['first']));

		expect(behavior.cancelCurrentInference()).toBe(true);
		releaseStart();
		await vi.waitFor(() => expect(agent.cancelled).toEqual(['req-1']));
		await building;

		expect(agent.started).toEqual(['req-1']);
	});

	it('does not start queued inputs when Stop lands as a turn finishes', async () => {
		const { agent, behavior, pendingInputs } = createBehavior(['first']);
		let ended = false;
		const building = behavior.build().then(() => {
			ended = true;
		});
		await vi.waitFor(() => expect(agent.started).toEqual(['req-1']));
		await behavior.queueUserRequest('second');

		agent.finishTurn();
		behavior.cancelCurrentInference();
		await vi.waitFor(() => expect(ended || agent.prompts.length > 1).toBe(true));

		expect(agent.prompts).toEqual(['first']);
		expect(pendingInputs()).toEqual(['second']);
		await building;
	});

	it('ignores a Stop sent while no build runs', async () => {
		const { agent, behavior } = createBehavior(['first']);
		expect(behavior.cancelCurrentInference()).toBe(false);

		const building = behavior.build();
		await vi.waitFor(() => expect(agent.started).toEqual(['req-1']));
		agent.finishTurn();
		await building;

		expect(agent.prompts).toEqual(['first']);
		expect(agent.cancelled).toEqual([]);
	});
});
