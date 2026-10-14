import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/authRoutes.ts', '/worker/database/services/AuthService.ts', '/worker/api/controllers/auth/authSchemas.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function methodBody(text: string, signature: string): string {
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = text.indexOf('\n    /**', start);
	return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe('terms agreement wiring', () => {
	it('lets only signed-in users record agreement', () => {
		const line = source('/worker/api/routes/authRoutes.ts')
			.split('\n')
			.find((candidate) => candidate.includes("'/accept-terms'"));
		expect(line).toContain('setAuthLevel(AuthConfig.authenticated)');
		expect(line).toContain('AuthController.acceptTerms');
	});

	it('refuses a password sign-up without the current terms version, before creating the account', () => {
		const register = methodBody(source('/worker/database/services/AuthService.ts'), 'async register(');
		expect(register).toContain('isCurrentTermsVersion(data.acceptedTermsVersion)');
		expect(register).toContain('TERMS_REQUIRED_MESSAGE');
		expect(register.indexOf('isCurrentTermsVersion(')).toBeLessThan(register.indexOf('insert(schema.users)'));
		expect(register).toContain('termsVersion: TERMS_VERSION');
	});

	it('lets the version through the register schema and selects it for the session user', () => {
		expect(source('/worker/api/controllers/auth/authSchemas.ts')).toContain('acceptedTermsVersion:');
		const forAuth = methodBody(source('/worker/database/services/AuthService.ts'), 'getUserForAuth(');
		expect(forAuth).toContain('termsVersion: schema.users.termsVersion');
	});
});
