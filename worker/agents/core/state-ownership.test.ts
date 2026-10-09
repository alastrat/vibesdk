import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/core/codingAgent.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('agent state ownership', () => {
	it('overrides validateStateChange so only the server can change agent state', () => {
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain(
			"override validateStateChange(_nextState: AgentState, source: Connection | 'server'): void {",
		);
		expect(agent).toContain(
			"if (source !== 'server') throw new Error('Agent state can only be changed by the server');",
		);
	});
});
