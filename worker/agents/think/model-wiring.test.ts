import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/think/ThinkAgent.ts',
		'/worker/agents/think/model-config.ts',
		'/worker/api/controllers/agent/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('think model wiring', () => {
	it("configures the agent from the app's selected model", () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		expect(behavior).toContain('resolveThinkModel(this.state.thinkModelId)');
		expect(behavior).not.toMatch(/THINK_MODEL_ID|THINK_MODEL_CONFIG/);
	});

	it('stores the requested model when a think app is created', () => {
		const controller = source('/worker/api/controllers/agent/controller.ts');
		expect(controller).toContain('resolveThinkModel(body.modelId)');
		expect(controller).toContain('thinkModelId: thinkModel.id');
	});

	it("charges the credit cost of the model the turn runs on, captured once per turn", () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		const beforeTurn = agent.slice(agent.indexOf('override async beforeTurn('), agent.indexOf('override getSkills('));
		const beforeStep = agent.slice(agent.indexOf('override async beforeStep('), agent.indexOf('async configureVibe('));
		expect(beforeTurn).toContain('resolveThinkModel(');
		expect(beforeTurn).toContain('ctx.model');
		expect(beforeTurn).toContain('creditCost');
		expect(beforeStep).toContain('this.turnUsage.creditCost');
		expect(beforeStep).not.toContain('resolveThinkModel');
		expect(beforeStep).not.toContain('modelName');
	});

	it('keeps the catalog as the only model list', () => {
		expect(source('/worker/agents/think/model-config.ts')).not.toMatch(/\bTHINK_MODEL_ID\b|\bTHINK_MODEL_CONFIG\b/);
	});

	it('reports failed turns through the provider failure check', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		expect(behavior).toContain('stub.getProviderFailure()');
		expect(behavior).toContain('WebSocketMessageResponses.MODEL_UNAVAILABLE');
		expect(behavior.match(/await this\.reportTurnError\(/g) ?? []).toHaveLength(2);
	});

	it('stops draining queued inputs after a failed turn', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		const build = behavior.slice(behavior.indexOf('async build()'), behavior.indexOf('private async runPrompt('));
		expect(behavior).toContain('private async runPrompt(text: string): Promise<boolean>');
		expect(behavior).toContain('return turnError === undefined;');
		expect(build).toContain('completed = await this.runPrompt(compiled);');
		expect(build).toMatch(/if \(!completed\) break;/);
		// The MVP flag is still set for a failed turn, as before; only the loop stops.
		expect(build.indexOf('this.setMVPGenerated()')).toBeLessThan(build.indexOf('if (!completed) break;'));
	});
});
