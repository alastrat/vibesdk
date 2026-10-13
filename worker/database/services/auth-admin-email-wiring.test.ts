import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/database/services/AuthService.ts', '/worker/database/services/UserService.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

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

describe('platform admin email reservation', () => {
	const register = methodBody(source('/worker/database/services/AuthService.ts'), 'async register(');

	it('refuses password sign-up for a platform admin email, after the format check', () => {
		expect(register).toContain('isPlatformAdminEmail(data.email)');
		expect(register).toContain("'Sign in with Google or GitHub to use this email'");
		expect(register.indexOf('validateEmail(data.email)')).toBeLessThan(register.indexOf('isPlatformAdminEmail('));
		expect(register.indexOf('isPlatformAdminEmail(')).toBeLessThan(register.indexOf('validatePassword('));
	});
});

describe('platform admin check', () => {
	const check = methodBody(source('/worker/database/services/UserService.ts'), 'async isPlatformAdmin(');

	it('reads identities only when the role is not already admin', () => {
		expect(check.indexOf("role === 'admin'")).toBeGreaterThan(-1);
		expect(check.indexOf("role === 'admin'")).toBeLessThan(check.indexOf('userOauthIdentities'));
	});

	it('passes the provider of each identity to the decision', () => {
		expect(check).toContain('schema.userOauthIdentities.provider');
	});
});
