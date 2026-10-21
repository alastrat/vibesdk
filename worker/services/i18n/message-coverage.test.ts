import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { expect, it } from 'vitest';
const sources = import.meta.glob<string>(
	[
		'/worker/api/**/*.ts',
		'/worker/database/services/AuthService.ts',
		'/worker/database/services/SessionService.ts',
		'/worker/middleware/auth/routeAuth.ts',
		'!/worker/api/**/*.{test,d}.ts',
		'!/worker/api/controllers/admin*/**',
		'!/worker/api/controllers/admin*/**/*',
	],
	{ query: '?raw', import: 'default', eager: true },
);
it('marks literal controller error messages for both catalogs', () => {
	const missing: string[] = [];
	for (const [file, source] of Object.entries(sources))
		traverse(parse(source, { sourceType: 'module', plugins: ['typescript'] }), {
			NewExpression(path) {
				const node = path.node;
				if (
					node.callee.type === 'Identifier' &&
					node.callee.name === 'SecurityError' &&
					(node.arguments[1]?.type === 'StringLiteral' || node.arguments[1]?.type === 'TemplateLiteral')
				)
					missing.push(`${file}:${node.loc?.start.line}`);
			},
			CallExpression(path) {
				const node = path.node;
				const controllerError =
					node.callee.type === 'MemberExpression' &&
					node.callee.property.type === 'Identifier' &&
					node.callee.property.name === 'createErrorResponse';
				const directError = node.callee.type === 'Identifier' && node.callee.name === 'errorResponse';
				if (!controllerError && !directError) return;
				if (node.arguments[0]?.type === 'StringLiteral' || node.arguments[0]?.type === 'TemplateLiteral')
					missing.push(`${file}:${node.loc?.start.line}`);
			},
		});
	expect(missing).toEqual([]);
});
