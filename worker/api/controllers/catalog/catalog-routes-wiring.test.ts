import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/catalogRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('catalog routes', () => {
	it('serves catalog images publicly and keeps catalog operations to admins', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/catalog/images/:productId/:file'"))).toContain('setAuthLevel(AuthConfig.public)');
		for (const line of routes.filter((candidate) => candidate.includes("'/api/admin/catalog/"))) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupCatalogRoutes(app)');
	});
});
