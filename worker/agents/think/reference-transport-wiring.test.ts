import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/think/ThinkAgent.ts',
		'/worker/agents/core/conversation/MessageLoader.ts',
		'/worker/agents/core/behaviors/think.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

describe('ThinkAgent request body chain', () => {
	it('inlines conversation images, then adds Gemini thought signatures', () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		expect(agent).toContain(
			'injectThoughtSignatures(await inlineAgentAssets(body, this.env.TEMPLATES_BUCKET, this.assetCache), this.thoughtSignatures)',
		);
		expect(agent).toContain('private readonly assetCache = createAssetCache(ASSET_CACHE_BYTES);');
	});
});

describe('references prompt', () => {
	it('is composed into the Think system prompt', () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		expect(agent).toContain('composeSystemPrompt(base, PROMPT_REFERENCES, projectContext)');
	});

});

describe('reloaded chats', () => {
	it('skip the parts hidden from the user', () => {
		const loader = source('/worker/agents/core/conversation/MessageLoader.ts');
		expect(loader).toContain('if (isHiddenPart(part)) return');
	});
});

describe('Think host: references and images', () => {
	const THINK = '/worker/agents/core/behaviors/think.ts';

	it('queues the first prompt images and appends later ones', () => {
		const think = source(THINK);
		expect(between(think, 'async initialize(', 'async handleUserInput(')).toContain(
			'pendingImages: (initArgs.images ?? []).map(toPendingImage),',
		);
		expect(between(think, 'async handleUserInput(', 'async build(): Promise<void> {')).toContain(
			'pendingImages: [...(this.state.pendingImages ?? []), ...processedImages.map(toPendingImage)],',
		);
	});

	it('captures references before running the turn and sends one message', () => {
		const build = between(source(THINK), 'async build(): Promise<void> {', 'private async runPrompt(');
		expect(build).toContain('pendingUserInputs: [], pendingImages: []');
		const capture = build.indexOf('await this.captureTurnReferences(compiled, conversationId)');
		const run = build.indexOf('await this.runPrompt(message, conversationId)');
		expect(capture).toBeGreaterThan(-1);
		expect(run).toBeGreaterThan(capture);
		expect(build).toContain('buildTurnMessage({ id: generateNanoId(), text: compiled, images, references })');
	});

	it('sends the full message to the agent', () => {
		const think = source(THINK);
		expect(think).toContain('chat: (userMessage: string | UIMessage, callback: RpcTarget) => Promise<void>;');
		expect(between(think, 'private async runPrompt(', 'private async reportTurnError(')).toContain(
			'await stub.chat(message, forwarder);',
		);
	});

	it('shows each reference and any skipped links in the chat', () => {
		const capture = between(source(THINK), 'private async captureTurnReferences(', 'private async referenceCard(');
		expect(capture).toContain('WebSocketMessageResponses.REFERENCES_SKIPPED');
		expect(capture).toContain('WebSocketMessageResponses.REFERENCE_CAPTURED');
		expect(capture).toContain('this.buildProgress?.beginCapture(host, index, total, Date.now())');
		expect(capture).toContain('this.buildProgress?.endCapture(Date.now())');
	});
});
