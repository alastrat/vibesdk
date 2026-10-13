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

describe('starting an app from a published site', () => {
	const controller = source('/worker/api/controllers/agent/controller.ts');
	const think = source('/worker/agents/core/behaviors/think.ts');
	const agent = source('/worker/agents/core/codingAgent.ts');

	it('resolves the site before spending an app-creation credit or creating an agent', () => {
		const resolve = controller.indexOf('resolveReuseStart(createReuseLookup(env), body.sourceAppId, user.id)');
		expect(resolve).toBeGreaterThan(-1);
		expect(resolve).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(resolve).toBeLessThan(controller.indexOf('const agentId = generateId()'));
	});

	it('passes the files to the Think agent and keeps no separate use counter', () => {
		expect(controller).toContain('thinkModelId: thinkModel.id, reuseSeed');
		expect(controller).not.toContain('incrementUseCount');
		expect(controller).not.toContain('templateSeed');
	});

	it('seeds the workspace from the site instead of an empty space', () => {
		expect(think).toContain('await this.seedFromSite(reuseSeed, described)');
		expect(think).toContain('space.importFiles(seed.files, `Start from ${seed.sourceTitle}`)');
		expect(think).toContain('if (!described) this.setMVPGenerated()');
		expect(think).toContain('siteCopyQuery(reuseSeed.sourceTitle)');
		expect(think).not.toContain('readTemplateSnapshot');
	});

	it('records the site start before the system prompt is built', () => {
		const initialize = think.slice(think.indexOf('async initialize('), think.indexOf('private async configureThinkAgent('));
		const record = initialize.indexOf('reuseStart: reuseSeed');
		expect(record).toBeGreaterThan(-1);
		expect(record).toBeLessThan(initialize.indexOf('await this.configureThinkAgent();'));
	});

	it('tells the model to rewrite a copy instead of asking clarifying questions', () => {
		const prompt = think.slice(think.indexOf('private buildSystemPrompt('), think.indexOf('private async seedEmptySpace('));
		expect(prompt).toContain('this.state.reuseStart');
		expect(prompt).toContain("'## Started from a published site'");
		expect(prompt).toContain('without calling \\`ask_questions\\`');
		expect(prompt).toContain("'## Clarify before building'");
	});

	it('personalizes only the first turn', () => {
		expect(think).toContain('this.isMVPGenerated() || !this.state.reuseStart ? undefined');
	});

	it('records where a copy came from on the saved app', () => {
		expect(agent).toContain('parentAppId: reuseStart?.sourceAppId ?? null');
		expect(agent).toContain('fromTemplateVersionId: reuseStart?.versionId ?? null');
		expect(agent).toContain("status: this.state.mvpGenerated ? 'completed' : 'generating'");
	});

	it('stamps the app row on creation when the copy deployed during initialization', () => {
		expect(agent).toContain("lastDeployedAt: 'lastDeployedCommit' in state && state.lastDeployedCommit ? new Date() : null");
	});

	it('stamps the app row on every deploy so Discover knows the site is deployed', () => {
		expect(think.split('this.recordDeployedCommit(').length - 1).toBe(2);
		expect(think).toContain('lastDeployedAt: new Date()');
		expect(think).not.toContain('this.setState({ ...this.state, lastDeployedCommit: commitHash })');
	});
});
