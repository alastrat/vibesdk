import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/controllers/agent/controller.ts',
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/codingAgent.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('starting an app from a template', () => {
	const controller = source('/worker/api/controllers/agent/controller.ts');
	const think = source('/worker/agents/core/behaviors/think.ts');

	it('checks the template before spending an app-creation credit or creating an agent', () => {
		const resolve = controller.indexOf('resolveTemplateStart(');
		expect(resolve).toBeGreaterThan(-1);
		expect(resolve).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(resolve).toBeLessThan(controller.indexOf('const agentId = generateId()'));
	});

	it('passes the seed to the Think agent and counts the use after it initializes', () => {
		expect(controller).toContain('thinkModelId: thinkModel.id, templateSeed');
		expect(controller).toContain('incrementUseCount(templateSeed.templateId)');
	});

	it('seeds the workspace from the template instead of an empty space', () => {
		expect(think).toContain('await this.seedFromTemplate(templateSeed, described)');
		expect(think).toContain('space.importFiles(files, `Start from template ${seed.name} v${seed.version}`)');
		expect(think).toContain('if (!described) this.setMVPGenerated()');
		expect(think).toContain('templateCopyQuery(templateSeed.name)');
	});

	it('personalizes only the first turn', () => {
		expect(think).toContain('const templateStart = this.isMVPGenerated() ? undefined : this.state.templateStart;');
	});

	it('records the template version on the saved app', () => {
		expect(source('/worker/agents/core/codingAgent.ts')).toContain('fromTemplateVersionId');
	});

	it('saves a finished exact copy as completed', () => {
		expect(source('/worker/agents/core/codingAgent.ts')).toContain("status: this.state.mvpGenerated ? 'completed' : 'generating'");
	});
});
