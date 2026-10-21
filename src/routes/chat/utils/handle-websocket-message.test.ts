import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'partysocket';
import { toast } from 'sonner';
import { AI_BUILDS_PAUSED_CODE, AI_BUILDS_PAUSED_MESSAGE, type WebSocketMessage } from '@/api-types';
import { createWebSocketMessageHandler, type HandleMessageDeps } from './handle-websocket-message';
import type { ProjectStage } from './project-stage-helpers';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const websocket = {} as WebSocket;

/** Every setter and callback is a spy, so a test names only the state it reads. */
function depsWith(state: Partial<HandleMessageDeps>): HandleMessageDeps {
	const spies = new Map<string | symbol, ReturnType<typeof vi.fn>>();
	return new Proxy(state, {
		get(target, key) {
			if (key in target) return target[key as keyof HandleMessageDeps];
			if (!spies.has(key)) spies.set(key, vi.fn());
			return spies.get(key);
		},
	}) as HandleMessageDeps;
}

const codeStage = (status: ProjectStage['status']): ProjectStage[] => [{ id: 'code', title: 'Generating code', status }];
const pausedError: WebSocketMessage = { type: 'error', error: AI_BUILDS_PAUSED_MESSAGE, code: AI_BUILDS_PAUSED_CODE, showAsPopup: true };

describe('the browser handling an error from the server', () => {
	beforeEach(() => vi.clearAllMocks());

	it('stops showing a build as running when its start is refused for the AI-builds pause, and shows the notice', () => {
		const deps = depsWith({ isGenerating: true, projectStages: codeStage('active') });
		createWebSocketMessageHandler(deps)(websocket, pausedError);
		expect(deps.setIsGenerating).toHaveBeenCalledWith(false);
		expect(deps.updateStage).toHaveBeenCalledWith('code', { status: 'pending' });
		expect(toast.error).toHaveBeenCalledWith(AI_BUILDS_PAUSED_MESSAGE, { duration: 5000 });
	});

	it('leaves a finished code stage as it is', () => {
		const deps = depsWith({ isGenerating: true, projectStages: codeStage('completed') });
		createWebSocketMessageHandler(deps)(websocket, pausedError);
		expect(deps.setIsGenerating).toHaveBeenCalledWith(false);
		expect(deps.updateStage).not.toHaveBeenCalled();
	});

	it('keeps a build running for any other error', () => {
		const deps = depsWith({ isGenerating: true, projectStages: codeStage('active') });
		createWebSocketMessageHandler(deps)(websocket, { type: 'error', error: 'Something went wrong', showAsPopup: true });
		expect(deps.setIsGenerating).not.toHaveBeenCalled();
		expect(deps.updateStage).not.toHaveBeenCalled();
	});
});
