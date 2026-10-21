import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/think/ThinkAgent.ts', '/worker/agents/core/behaviors/think.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

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

describe('build analytics wiring', () => {
	const agent = source('/worker/agents/think/ThinkAgent.ts');
	const host = source('/worker/agents/core/behaviors/think.ts');

	it("counts every step of a turn and answers its steps and billing's charged credits to the host", () => {
		expect(between(agent, 'override async beforeTurn(', 'override getSkills(')).toMatch(/this\.turnSteps = 0;\s*this\.turnCredits = 0;/);
		expect(between(agent, 'override async beforeStep(', 'if (ctx.stepNumber')).toContain('this.turnSteps += 1;');
		expect(agent).toContain('async getTurnUsage(): Promise<BuildTurnUsage | null>');
		expect(agent).toContain('credits: this.turnCreditsUsed()');
	});

	it("reads a turn's usage once, so a turn that never reached beforeTurn can't repeat the previous one", () => {
		const read = between(agent, 'async getTurnUsage(): Promise<BuildTurnUsage | null>', '\n\t}\n');
		expect(read).toMatch(/const steps = this\.turnSteps;\s*this\.turnSteps = null;\s*return steps === null \? null : \{ steps, credits: this\.turnCreditsUsed\(\) \};/);
	});

	it('sends build_started before the turn, and build_finished after it, failed or not', () => {
		const run = between(host, 'private async runPrompt(', 'private async captureTurnReferences(');
		expect(run.indexOf('this.startBuildAnalytics()')).toBeLessThan(run.indexOf('await stub.chat(message, forwarder)'));
		expect(between(run, '} finally {', 'if (turnError !== undefined)')).toContain('await build.finish(chatFinished && turnError === undefined, stub);');
	});
});
