import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/earlyAccessRoutes.ts', '/worker/api/routes/index.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('early access routes', () => {
	const routes = source('/worker/api/routes/earlyAccessRoutes.ts');

	it('lets signed-in users record and read only their own requests', () => {
		expect(routes).toContain("app.post('/api/early-access', setAuthLevel(AuthConfig.authenticated)");
		expect(routes).toContain("app.get('/api/early-access', setAuthLevel(AuthConfig.authenticated)");
	});

	it('shows the full list to admins only', () => {
		expect(routes).toContain("app.get('/api/admin/early-access', setAuthLevel(AuthConfig.admin)");
		expect(routes.split('\n').filter((line) => line.includes("'/api/admin/"))).toHaveLength(1);
	});

	it('is registered with the app', () => {
		expect(source('/worker/api/routes/index.ts')).toContain('setupEarlyAccessRoutes(app);');
	});
});
