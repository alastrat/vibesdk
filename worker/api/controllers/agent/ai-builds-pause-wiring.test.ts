import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/agent/controller.ts'], { query: '?raw', import: 'default', eager: true });
const controller = sources['/worker/api/controllers/agent/controller.ts'] ?? '';

function method(signature: string): string {
	const start = controller.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = controller.indexOf('\n    static ', start + signature.length);
	return controller.slice(start, next === -1 ? undefined : next);
}

describe('starting a new store while AI builds are paused', () => {
	it('is refused before rate limits, the usage check or the agent', () => {
		const start = method('static async startCodeGeneration(');
		const pause = start.indexOf("await isFlagOn(env, 'ai-builds-paused', context.user?.id ?? null)");
		expect(pause).toBeGreaterThan(-1);
		expect(start).toContain('createErrorResponse(AI_BUILDS_PAUSED_MESSAGE, 503)');
		for (const later of ['enforceAppCreationRateLimit(', 'checkUsageAndBalance(', 'getAgentStub(']) {
			expect(start.indexOf(later), later).toBeGreaterThan(pause);
		}
	});
});
