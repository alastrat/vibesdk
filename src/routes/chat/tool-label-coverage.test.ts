import { afterEach, describe, expect, it } from 'vitest';
import { parse } from '@babel/parser';
import {
	isCallExpression,
	isClassDeclaration,
	isClassMethod,
	isExportNamedDeclaration,
	isFunctionDeclaration,
	isIdentifier,
	isObjectExpression,
	isObjectProperty,
	isReturnStatement,
	isSpreadElement,
	type Expression,
	type File,
} from '@babel/types';
import agent from '../../../worker/agents/think/ThinkAgent.ts?raw';
import drafts from '../../../worker/agents/think/draft-tools.ts?raw';
import catalog from '../../../worker/agents/think/catalog-tools.ts?raw';
import payments from '../../../worker/agents/think/payments-setup-tool.ts?raw';
import display from './utils/tool-display.ts?raw';
import { applyAccountLocale } from '@/lib/i18n';
import { getToolSummary } from './utils/tool-display';

const ast = (source: string): File => parse(source, { sourceType: 'module', plugins: ['typescript'] });
const factories: Record<string, string> = { createDraftTools: drafts, createCatalogTools: catalog, createPaymentsSetupTool: payments };
function names(expression: Expression): string[] {
	if (expression.type === 'TSAsExpression') return names(expression.expression);
	if (isCallExpression(expression) && isIdentifier(expression.callee)) {
		if (expression.callee.name === 'serializeTools') return names(expression.arguments[0] as Expression);
		const source = factories[expression.callee.name];
		if (!source) throw new Error(`Unknown tool factory ${expression.callee.name}`);
		for (const statement of ast(source).program.body) {
			const declaration = isExportNamedDeclaration(statement) ? statement.declaration : statement;
			if (isFunctionDeclaration(declaration) && declaration.id?.name === expression.callee.name) {
				const returned = declaration.body.body.find(isReturnStatement);
				if (returned?.argument) return names(returned.argument);
			}
		}
	}
	if (!isObjectExpression(expression)) throw new Error('Tool registry must return an object');
	return expression.properties.flatMap((property) => {
		if (isSpreadElement(property)) return names(property.argument);
		if (isObjectProperty(property) && isIdentifier(property.key)) return [property.key.name];
		throw new Error('Unrecognized tool registry property');
	});
}
afterEach(() => applyAccountLocale('en'));
describe('registered Think tools', () => {
	it('have localized start, success and error labels rather than raw tool names', async () => {
		const declaration = ast(agent)
			.program.body.map((node) => (isExportNamedDeclaration(node) ? node.declaration : node))
			.find(isClassDeclaration);
		const method = declaration?.body.body.find((node) => isClassMethod(node) && isIdentifier(node.key) && node.key.name === 'getTools');
		if (!isClassMethod(method)) throw new Error('Missing ThinkAgent.getTools');
		const returned = method.body.body.find(isReturnStatement)?.argument;
		const expression = returned?.type === 'TSAsExpression' ? returned.expression : returned;
		if (!expression) throw new Error('Missing tool registry');
		const tools = names(expression);
		const declarationOfVerbs = ast(display)
			.program.body.flatMap((node) => (node.type === 'VariableDeclaration' ? node.declarations : []))
			.find((node) => isIdentifier(node.id) && node.id.name === 'VERBS');
		if (!declarationOfVerbs?.init) throw new Error('Missing tool verbs');
		const verbs = new Set(names(declarationOfVerbs.init as Expression));
		expect(tools.length).toBeGreaterThan(15);
		for (const name of tools) expect(verbs.has(name), name).toBe(true);
		for (const locale of ['es', 'pt-BR'] as const) {
			await applyAccountLocale(locale);
			for (const name of tools)
				for (const status of ['start', 'success', 'error'] as const) {
					const label = getToolSummary({ name, status, timestamp: 0 });
					expect(label, `${locale}:${name}:${status}`).not.toBe(name);
				}
		}
	});
});
