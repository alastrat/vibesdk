import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/ThinkModelPicker.tsx',
		'/src/components/ModelUnavailableNotice.tsx',
		'/src/routes/home.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/chat-input.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/chat/utils/handle-websocket-message.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('model picker: component', () => {
	it('renders nothing when no models are offered', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('if (options.length === 0) return null;');
	});

	it('shows the placeholder when no model is selected', () => {
		expect(source('/src/components/ThinkModelPicker.tsx')).toContain('placeholder="Select model"');
	});
});

describe('model picker: home prompt', () => {
	it('renders the picker on the home prompt', () => {
		expect(source('/src/routes/home.tsx')).toMatch(/<ThinkModelPicker\b/);
	});

	it('sends the chosen model only when one is set', () => {
		expect(source('/src/routes/home.tsx')).toContain(
			"const modelParam = mode === 'app' && modelId ? `&model=${encodeURIComponent(modelId)}` : '';",
		);
	});
});

describe('model picker: chat', () => {
	it('renders the picker in the chat input for think apps', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toMatch(/<ThinkModelPicker\b/);
		expect(chat).toContain("searchParams.get('model')");
		expect(source('/src/routes/chat/components/chat-input.tsx')).toContain('leftActions={leftActions}');
	});

	it('creates the session with the chosen model', () => {
		expect(source('/src/routes/chat/hooks/use-chat.ts')).toMatch(/createAgentSession\(\{[^}]*\bmodelId\b/);
	});

	it('switches models over the agent websocket', () => {
		expect(source('/src/routes/chat/hooks/use-chat.ts')).toContain("sendWebSocketMessage(websocket, 'set_model', { modelId })");
	});

	it('syncs the selected model from agent state, including apps without one', () => {
		const handler = source('/src/routes/chat/utils/handle-websocket-message.ts');
		expect(handler.match(/setThinkModelId\(state\.thinkModelId \?\? ''\)/g) ?? []).toHaveLength(2);
	});

	it('enables the picker only while the agent socket is open', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('disabled={!isWebSocketOpen}');
		expect(chat).not.toContain('disabled={!websocket}');
		const hook = source('/src/routes/chat/hooks/use-chat.ts');
		expect(hook).toContain('setIsWebSocketOpen(true)');
		expect(hook).toContain('setIsWebSocketOpen(false)');
	});

	it('leaves the input layout alone when no models are offered', () => {
		expect(source('/src/routes/chat/chat.tsx')).toContain('(capabilities?.thinkModels?.length ?? 0) > 0');
	});
});

describe('model picker: provider failure card', () => {
	it('stores model_unavailable messages for the card', () => {
		expect(source('/src/routes/chat/utils/handle-websocket-message.ts')).toContain("case 'model_unavailable':");
	});

	it('switches with resume and retries with the resume message', () => {
		const hook = source('/src/routes/chat/hooks/use-chat.ts');
		expect(hook).toContain("sendWebSocketMessage(websocket, 'set_model', { modelId, resume: true })");
		expect(hook).toContain("sendWebSocketMessage(websocket, 'user_suggestion', { message: RESUME_BUILD_MESSAGE })");
	});

	it('shows the card above the chat input', () => {
		expect(source('/src/routes/chat/chat.tsx')).toMatch(/<ModelUnavailableNotice\b/);
	});

	it('names the price change when offering a switch', () => {
		expect(source('/src/components/ModelUnavailableNotice.tsx')).toContain('describeCreditChange(failed.creditCost, alternative.creditCost)');
	});

	it('passes the socket state to the card as well as the picker', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat.match(/disabled=\{!isWebSocketOpen\}/g) ?? []).toHaveLength(2);
	});

	it('disables the switch and retry buttons, but not dismiss', () => {
		const card = source('/src/components/ModelUnavailableNotice.tsx');
		expect(card.match(/disabled=\{disabled\}/g) ?? []).toHaveLength(2);
	});
});
