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

	it("charges the configured model's credit cost per step", () => {
		expect(source('/worker/agents/think/ThinkAgent.ts')).toContain('resolveThinkModel(config.model.modelName).config.creditCost');
	});

	it('keeps the catalog as the only model list', () => {
		expect(source('/worker/agents/think/model-config.ts')).not.toMatch(/\bTHINK_MODEL_ID\b|\bTHINK_MODEL_CONFIG\b/);
	});
});
