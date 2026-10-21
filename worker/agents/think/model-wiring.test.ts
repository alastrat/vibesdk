import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/think/ThinkAgent.ts',
		'/worker/agents/think/model-config.ts',
		'/worker/api/controllers/agent/controller.ts',
		'/worker/agents/inferutils/core.ts',
		'/worker/services/tasks/task-model.ts',
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

	it("charges each step from its real usage at the turn's model prices, or by the old daily counter while billing is off", () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		const beforeTurn = agent.slice(agent.indexOf('override async beforeTurn('), agent.indexOf('override getSkills('));
		const beforeStep = agent.slice(agent.indexOf('override async beforeStep('), agent.indexOf('override async onStepFinish('));
		const onStepFinish = agent.slice(agent.indexOf('override async onStepFinish('), agent.indexOf('turnCreditsUsed(): number'));
		expect(beforeTurn).toContain('resolveThinkModel(');
		expect(beforeTurn).toContain('ctx.model');
		expect(beforeTurn).toContain("(await isFlagOn(this.env, 'billing', config.userId))");
		expect(beforeTurn).toContain('prices: model.prices');
		expect(beforeTurn).toContain('creditCost');
		expect(beforeStep).toContain('this.turnUsage.creditCost');
		expect(beforeStep).not.toContain('resolveThinkModel');
		expect(onStepFinish).toContain('stepCredits(usage.prices, stepUsage, usage.typical)');
		expect(onStepFinish).toContain('useKey: `${this.name}:${usage.turnId}:${ctx.stepNumber}`');
		expect(onStepFinish).not.toContain('resolveThinkModel');
	});

	it("totals every turn's step credits, billing on or off, and charges them only with billing on", () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		const beforeTurn = agent.slice(agent.indexOf('override async beforeTurn('), agent.indexOf('override getSkills('));
		const onStepFinish = agent.slice(agent.indexOf('override async onStepFinish('), agent.indexOf('turnCreditsUsed(): number'));
		// The turn's prices come before the metering lookup, so a failed lookup still prices every step.
		const pricing = beforeTurn.indexOf('prices: model.prices');
		expect(pricing).toBeGreaterThan(-1);
		expect(pricing).toBeLessThan(beforeTurn.indexOf('try {'));
		expect(beforeTurn).toContain('this.turnCredits = 0;');
		// Every step adds to the turn's total before the billing-only charge.
		const total = onStepFinish.indexOf('this.turnCredits += credits;');
		const billingOnly = onStepFinish.indexOf("if (usage.mode !== 'credits') return;");
		expect(total).toBeGreaterThan(-1);
		expect(billingOnly).toBeGreaterThan(total);
		expect(onStepFinish.indexOf('await chargeStep(')).toBeGreaterThan(billingOnly);
		expect(agent).toMatch(/turnCreditsUsed\(\): number \{\s*return this\.turnCredits;\s*\}/);
	});

	it('never leaves a billed turn free when its account fails to load: it retries, then loads again at each step', () => {
		const agent = source('/worker/agents/think/ThinkAgent.ts');
		const beforeTurn = agent.slice(agent.indexOf('override async beforeTurn('), agent.indexOf('override getSkills('));
		const onStepFinish = agent.slice(agent.indexOf('override async onStepFinish('), agent.indexOf('turnCreditsUsed(): number'));
		// The billed mode is set whether or not the account loads, outside the daily lookup's try.
		const billed = beforeTurn.indexOf("mode: 'credits', userId: config.userId, account: await loadTurnAccount(this.env, config.userId)");
		expect(billed).toBeGreaterThan(-1);
		expect(billed).toBeLessThan(beforeTurn.indexOf('try {'));
		const reload = onStepFinish.indexOf('usage.account ??= await loadTurnAccount(this.env, usage.userId);');
		expect(reload).toBeGreaterThan(onStepFinish.indexOf("if (usage.mode !== 'credits') return;"));
		expect(reload).toBeLessThan(onStepFinish.indexOf('await chargeStep('));
		expect(onStepFinish).toMatch(/console\.error\('A billed step was not charged[^']*', \{ userId: usage\.userId/);
	});

	it('checks credits before a new store starts, and charges older AI calls through billing when it is on', () => {
		const controller = source('/worker/api/controllers/agent/controller.ts');
		const credit = controller.indexOf('checkCreditsBeforeTurn(env, user.id)');
		expect(credit).toBeGreaterThan(-1);
		expect(credit).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(controller).toContain('createPlanLimitResponse(credits.refusal)');
		const infer = source('/worker/agents/inferutils/core.ts');
		expect(infer.indexOf('chargeLegacyCall(env,')).toBeGreaterThan(-1);
		expect(infer.indexOf('chargeLegacyCall(env,')).toBeLessThan(infer.indexOf('RateLimitService.enforceLLMCallsRateLimit('));
	});

	it('keeps one stored-keys rule for the agent and for tasks: a gateway holding the keys never gets a forwarded Authorization', () => {
		for (const path of ['/worker/agents/think/ThinkAgent.ts', '/worker/services/tasks/task-model.ts']) {
			const text = source(path);
			expect(text, path).toContain('storedKeysFetch(');
			expect(text, path).not.toMatch(/headers\.delete\('authorization'\)/i);
		}
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

	it('logs every failed turn, and reads the fallback flag from the typed environment', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		const report = behavior.slice(behavior.indexOf('private async reportTurnError('), behavior.indexOf('/** Feeds a chunk to the build'));
		expect(report.indexOf("this.logger.warn('A build turn failed', { error })")).toBeGreaterThan(-1);
		expect(report).toContain('this.env.ENABLE_THINK_MODEL_FALLBACK');
		expect(report).not.toContain('as unknown as');
	});

	it('stops draining queued inputs after a failed turn', () => {
		const behavior = source('/worker/agents/core/behaviors/think.ts');
		const build = behavior.slice(behavior.indexOf('async build()'), behavior.indexOf('private async runPrompt('));
		expect(behavior).toContain('private async runPrompt(message: UIMessage, conversationId: string): Promise<boolean>');
		expect(behavior).toContain('return turnError === undefined;');
		expect(build).toContain('completed = await this.runPrompt(message, conversationId);');
		expect(build).toMatch(/if \(!completed\) break;/);
		// The MVP flag is still set for a failed turn, as before; only the loop stops.
		expect(build.indexOf('this.setMVPGenerated()')).toBeLessThan(build.indexOf('if (!completed) break;'));
	});
});
