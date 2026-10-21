import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/userRoutes.ts', '/worker/api/routes/index.ts', '/worker/app.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the saved-language route', () => {
	const routes = source('/worker/api/routes/userRoutes.ts');

	it('is a signed-in PUT, like the analytics setting', () => {
		expect(routes).toContain("app.put('/api/user/locale', setAuthLevel(AuthConfig.authenticated), adaptController(UserController, UserController.setLocale));");
	});

	it('is the only /api/user/locale route', () => {
		expect(routes.split('\n').filter((line) => line.includes("'/api/user/locale'"))).toHaveLength(1);
	});

	it('is registered with the app', () => {
		expect(source('/worker/api/routes/index.ts')).toContain('setupUserRoutes(app);');
	});

	it('is checked for CSRF with every other write', () => {
		const app = source('/worker/app.ts');
		expect(app).toContain("if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {");
		expect(app).toContain('await CsrfService.enforce(c.req.raw, undefined);');
	});
});
