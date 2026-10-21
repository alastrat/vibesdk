import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/auth/controller.ts', '/src/hooks/use-oauth-error-toast.ts'], { query: '?raw', import: 'default', eager: true });

describe('a provider sign-in refused while sign-ups are paused', () => {
	it('comes back to the home page with its own error code', () => {
		const auth = sources['/worker/api/controllers/auth/controller.ts'] ?? '';
		expect(auth).toContain('error instanceof SignupsPausedError');
		expect(auth).toContain('? SIGNUPS_PAUSED_ERROR_CODE');
	});

	it('shows the pause message there', () => {
		expect(sources['/src/hooks/use-oauth-error-toast.ts']).toContain('[SIGNUPS_PAUSED_ERROR_CODE]: t(SIGNUPS_PAUSED_MESSAGE)');
	});
});
