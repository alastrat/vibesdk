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
		expect(register).toContain('ADMIN_EMAIL_PROVIDER_MESSAGE');
		expect(register.indexOf('validateEmail(data.email)')).toBeLessThan(register.indexOf('isPlatformAdminEmail('));
		expect(register.indexOf('isPlatformAdminEmail(')).toBeLessThan(register.indexOf('validatePassword('));
	});
});

describe('OAuth sign-in of a platform admin email', () => {
	const oauth = methodBody(source('/worker/database/services/AuthService.ts'), 'private async findOrCreateOAuthUser(');

	it('keeps an already linked identity signing in as before', () => {
		const identityLookup = oauth.indexOf('eq(schema.userOauthIdentities.providerId, oauthUserInfo.id)');
		expect(identityLookup).toBeGreaterThan(-1);
		expect(identityLookup).toBeLessThan(oauth.indexOf('mayClaimEmailByOAuth('));
		expect(oauth.indexOf('return user;')).toBeLessThan(oauth.indexOf('mayClaimEmailByOAuth('));
	});

	it('refuses providers that do not verify email before auto-linking by email or creating a user', () => {
		const guard = oauth.indexOf('if (!mayClaimEmailByOAuth(provider, email))');
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(oauth.indexOf('eq(schema.users.email, email)'));
		expect(guard).toBeLessThan(oauth.indexOf('this.createOAuthUser('));
		expect(oauth.slice(guard)).toMatch(/^[^;]*SecurityErrorType\.UNAUTHORIZED,\s*ADMIN_EMAIL_PROVIDER_MESSAGE,\s*403/);
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
