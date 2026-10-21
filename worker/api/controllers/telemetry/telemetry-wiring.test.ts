import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/telemetryRoutes.ts', '/worker/api/routes/index.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('telemetry routes', () => {
	const routes = source('/worker/api/routes/telemetryRoutes.ts');

	it('shows the flags to admins only, and nothing else under /api/admin', () => {
		expect(routes).toContain("app.get('/api/admin/flags', setAuthLevel(AuthConfig.admin)");
		expect(routes.split('\n').filter((line) => line.includes("'/api/admin/"))).toHaveLength(1);
	});

	it('is registered with the app', () => {
		expect(source('/worker/api/routes/index.ts')).toContain('setupTelemetryRoutes(app);');
	});
});
