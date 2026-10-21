import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/auth/controller.ts'], { query: '?raw', import: 'default', eager: true });
const auth = sources['/worker/api/controllers/auth/controller.ts'] ?? '';

function method(signature: string): string {
	const start = auth.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = auth.indexOf('\n    static ', start + signature.length);
	return auth.slice(start, next === -1 ? undefined : next);
}

describe('the session carries telemetry', () => {
	it('on sign-up, sign-in and the profile', () => {
		for (const signature of ['static async register(', 'static async login(', 'static async getProfile(']) {
			expect(method(signature), signature).toContain('sessionTelemetry(env, request, ');
		}
	});

	it('stores a GPC signal on a provider sign-in', () => {
		expect(method('static async handleOAuthCallback(')).toContain('await honorAnalyticsChoice(env, request, result.user.id)');
	});
});
