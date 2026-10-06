import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/behaviors/base.ts',
		'/worker/agents/core/codingAgent.ts',
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

const THINK = '/worker/agents/core/behaviors/think.ts';

describe('build progress wiring', () => {
	it('tracks one build from start to finish', () => {
		const build = between(source(THINK), 'async build(): Promise<void> {', 'private async runPrompt(');
		expect(build).toContain('this.buildProgress = new BuildProgressTracker(Date.now());');
		expect(build).toMatch(/finally \{\s*this\.buildProgress = null;/);
	});

	it('feeds every stream chunk to the tracker before translating it', () => {
		const translate = between(source(THINK), 'private async translateChunk(', 'switch (chunk.type)');
		expect(translate).toContain('this.trackBuildProgress(chunk);');
	});

	it('broadcasts snapshots and turns progress off after a tracker failure', () => {
		const track = between(source(THINK), 'private trackBuildProgress(', 'private async translateChunk(');
		expect(track).toContain('WebSocketMessageResponses.BUILD_PROGRESS');
		expect(track).toMatch(/catch \(/);
		expect(track).toContain('this.buildProgress = null;');
	});

	it('keeps progress out of agent state', () => {
		expect(source(THINK)).not.toMatch(/setState\([^)]*buildProgress/);
	});

	it('reports no progress for other build modes', () => {
		expect(source('/worker/agents/core/behaviors/base.ts')).toMatch(
			/getBuildProgress\(\): BuildProgress \| null \{\s*return null;/,
		);
	});

	it('sends the snapshot to a tab that connects mid-build', () => {
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain('const buildProgress = this.behavior.getBuildProgress();');
		expect(between(agent, 'WebSocketMessageResponses.AGENT_CONNECTED', '});')).toContain(
			'...(buildProgress ? { buildProgress } : {}),',
		);
	});
});
