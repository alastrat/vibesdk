/**
 * Finds the English text of the app's messages in source code, and the English text that was never wrapped in one.
 *
 * Messages are found by name, with literal arguments only (a non-literal argument is not extracted):
 *  - `t('text')`, `t('text', values)` and the server form `t(locale, 'text', values)`;
 *  - `tn('one', 'other', count, values)` and `tn(locale, 'one', 'other', count, values)`, keyed by `one|other`;
 *  - `msg('text')`;
 *  - `<T text="text" />`, as a string or an expression;
 *  - the same names called on any object, such as `i18n.t('text')` or `serverT(locale).t('text')`.
 * A template literal with no expressions counts as a literal.
 */

import { parse } from '@babel/parser';
import type { File, JSXOpeningElement, Node } from '@babel/types';
import { pluralKey } from './translate';

export interface ExtractedMessage {
	/** The catalog key: the English text, or `singular|plural` for a plural. */
	key: string;
	plural?: { singular: string; plural: string };
	file: string;
	line: number;
}

export interface UntranslatedText {
	file: string;
	line: number;
	text: string;
}

/** Files without a call of these names, or a `<T`, hold no message, so they are not parsed. */
const MAY_HOLD_MESSAGE = /\b(?:t|tn|msg)\s*\(|<T\b/;

const MESSAGE_FUNCTIONS: ReadonlySet<string> = new Set(['t', 'tn', 'msg']);

/** JSX attributes whose string value the user reads. */
const TEXT_ATTRIBUTES: ReadonlySet<string> = new Set([
	'title',
	'placeholder',
	'aria-label',
	'alt',
	'label',
	'description',
	'message',
	'tooltip',
	'searchPlaceholder',
	'pageTitle',
]);

/** The `toast` calls whose message the user reads: sonner's, and Kumo's `add`. */
const TOAST_METHODS: ReadonlySet<string> = new Set(['success', 'error', 'warning', 'info', 'message', 'loading', 'add']);

/** The properties of a toast's options object that the user reads. */
const TOAST_TEXT_PROPERTIES: ReadonlySet<string> = new Set(['title', 'description']);

const HAS_LETTER = /\p{L}/u;
const HTML_ENTITY = /&#?\w+;/g;
const IGNORE_MARKER = /^\s*i18n-ignore\b/;

/** Keys of a node that hold no child nodes of the code. */
const NOT_CHILDREN: ReadonlySet<string> = new Set(['loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

/** Parses TypeScript, and JSX in `.tsx` and `.jsx`; names the file when the source does not parse. */
export function parseSource(source: string, file: string): File {
	try {
		return parse(source, { sourceType: 'module', plugins: /\.[jt]sx$/.test(file) ? ['typescript', 'jsx'] : ['typescript'] });
	} catch (error) {
		throw new Error(`Cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function isNode(value: unknown): value is Node {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

/** Calls `visit` for a node and every node below it, parents first. */
export function visitNodes(root: Node, visit: (node: Node) => void): void {
	visit(root);
	for (const [key, value] of Object.entries(root)) {
		if (NOT_CHILDREN.has(key)) continue;
		if (Array.isArray(value)) {
			for (const item of value) if (isNode(item)) visitNodes(item, visit);
		} else if (isNode(value)) {
			visitNodes(value, visit);
		}
	}
}

/** The text of a string literal, or of a template literal with no expressions; empty text is not a message. */
function literalText(node: Node | null | undefined): string | null {
	if (!node) return null;
	switch (node.type) {
		case 'StringLiteral':
			return node.value === '' ? null : node.value;
		case 'TemplateLiteral': {
			const text = node.expressions.length === 0 ? node.quasis[0]?.value.cooked : null;
			return text || null;
		}
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return literalText(node.expression);
		default:
			return null;
	}
}

/** The function's own name, or the method's name when it is called on an object. */
function calleeName(callee: Node): string | null {
	if (callee.type === 'Identifier') return callee.name;
	if ((callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && !callee.computed && callee.property.type === 'Identifier') {
		return callee.property.name;
	}
	return null;
}

type MessageShape = Pick<ExtractedMessage, 'key' | 'plural'>;

/**
 * The message a call names. Only the client form `t(text, values)` has an object second argument, so a literal there
 * means the server form with a locale first; `tn` is told apart by its third argument, a count in the client form.
 */
function messageOfCall(name: string, args: readonly Node[]): MessageShape | null {
	if (name === 'tn') {
		const offset = literalText(args[2]) === null ? 0 : 1;
		const singular = literalText(args[offset]);
		const plural = literalText(args[offset + 1]);
		return singular !== null && plural !== null ? { key: pluralKey(singular, plural), plural: { singular, plural } } : null;
	}
	const key = name === 't' ? (literalText(args[1]) ?? literalText(args[0])) : literalText(args[0]);
	return key === null ? null : { key };
}

function textOfTag(tag: JSXOpeningElement): string | null {
	for (const attribute of tag.attributes) {
		if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier' || attribute.name.name !== 'text') continue;
		const value = attribute.value;
		return value?.type === 'JSXExpressionContainer' ? literalText(value.expression) : literalText(value);
	}
	return null;
}

function startOf(node: Node): number {
	return node.start ?? 0;
}

function lineOf(node: Node): number {
	return node.loc?.start.line ?? 0;
}

/** Orders findings by where they start; the walk visits a parent's parts in the order the parser built them, not read. */
function inSourceOrder<T>(found: ReadonlyArray<{ at: number; value: T }>): T[] {
	return [...found].sort((a, b) => a.at - b.at).map(({ value }) => value);
}

/** Every message `source` marks for translation, in source order. */
export function extractMessages(source: string, file: string): ExtractedMessage[] {
	if (!MAY_HOLD_MESSAGE.test(source)) return [];
	const found: Array<{ at: number; value: ExtractedMessage }> = [];
	visitNodes(parseSource(source, file).program, (node) => {
		let message: MessageShape | null = null;
		if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
			const name = calleeName(node.callee);
			message = name !== null && MESSAGE_FUNCTIONS.has(name) ? messageOfCall(name, node.arguments) : null;
		} else if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && node.name.name === 'T') {
			const key = textOfTag(node);
			message = key === null ? null : { key };
		}
		if (message) found.push({ at: startOf(node), value: { ...message, file, line: lineOf(node) } });
	});
	return inSourceOrder(found);
}

/** The messages in a set of files, by path; a leading slash, as in `import.meta.glob` keys, is dropped. */
export function messagesOfFiles(files: Readonly<Record<string, string>>): ExtractedMessage[] {
	return Object.entries(files).flatMap(([path, text]) => extractMessages(text, path.replace(/^\//, '')));
}

interface TextLeaf {
	node: Node;
	text: string;
}

function tidy(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * The literal pieces of text an expression can show: a string, the fixed parts of a template, either branch of a
 * condition or fallback, and the strings in a concatenation. A call, a variable or a member shows nothing known.
 */
function textLeaves(node: Node | null | undefined, source: string): TextLeaf[] {
	if (!node) return [];
	switch (node.type) {
		case 'StringLiteral':
			return HAS_LETTER.test(node.value) ? [{ node, text: tidy(node.value) }] : [];
		case 'TemplateLiteral': {
			const fixed = node.quasis.map((quasi) => quasi.value.cooked ?? '').join(' ');
			return HAS_LETTER.test(fixed) ? [{ node, text: tidy(source.slice(startOf(node) + 1, (node.end ?? 1) - 1)) }] : [];
		}
		case 'ConditionalExpression':
			return [...textLeaves(node.consequent, source), ...textLeaves(node.alternate, source)];
		case 'LogicalExpression':
			return [...textLeaves(node.left, source), ...textLeaves(node.right, source)];
		case 'BinaryExpression':
			return node.operator === '+' ? [...textLeaves(node.left, source), ...textLeaves(node.right, source)] : [];
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return textLeaves(node.expression, source);
		default:
			return [];
	}
}

/** The property's name when it is written as a name or a string. */
function propertyName(key: Node): string | null {
	if (key.type === 'Identifier') return key.name;
	return key.type === 'StringLiteral' ? key.value : null;
}

function isToastCall(callee: Node): boolean {
	if (callee.type === 'Identifier') return callee.name === 'toast';
	return (
		(callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') &&
		callee.object.type === 'Identifier' &&
		callee.object.name === 'toast' &&
		!callee.computed &&
		callee.property.type === 'Identifier' &&
		TOAST_METHODS.has(callee.property.name)
	);
}

/**
 * The lines an `i18n-ignore` comment covers: the line below a comment that stands alone on its line (a JSX comment
 * may keep its braces), and the line of a comment that trails code.
 */
function ignoredLines(ast: File, source: string): Set<number> {
	const lines = source.split('\n');
	const ignored = new Set<number>();
	for (const comment of ast.comments ?? []) {
		if (!comment.loc || !IGNORE_MARKER.test(comment.value)) continue;
		const before = (lines[comment.loc.start.line - 1] ?? '').slice(0, comment.loc.start.column).trim();
		ignored.add(before === '' || before === '{' ? comment.loc.end.line + 1 : comment.loc.start.line);
	}
	return ignored;
}

/** The line of the first letter in JSX text, whose node starts at the end of whatever comes before it. */
function firstLetterLine(node: Node, source: string): number {
	const raw = source.slice(startOf(node), node.end ?? 0).replace(HTML_ENTITY, (entity) => ' '.repeat(entity.length));
	const letterAt = raw.search(HAS_LETTER);
	return lineOf(node) + (raw.slice(0, Math.max(letterAt, 0)).match(/\n/g)?.length ?? 0);
}

/**
 * English text that is shown to the user without going through `t`: JSX text, the string values of the text
 * attributes, and the message of a `toast`, each with letters in it. A line is skipped when an `i18n-ignore` comment
 * stands alone on the line above it, or trails it, for names and code that are never translated.
 */
export function findUntranslatedText(source: string, file: string): UntranslatedText[] {
	const ast = parseSource(source, file);
	const ignored = ignoredLines(ast, source);
	const found: Array<{ at: number; value: UntranslatedText }> = [];

	const report = (at: number, line: number, text: string, ownerLine = line): void => {
		if (!ignored.has(line) && !ignored.has(ownerLine)) found.push({ at, value: { file, line, text } });
	};
	const reportLeaves = (expression: Node | null | undefined, ownerLine?: number): void => {
		for (const leaf of textLeaves(expression, source)) report(startOf(leaf.node), lineOf(leaf.node), leaf.text, ownerLine);
	};

	visitNodes(ast.program, (node) => {
		switch (node.type) {
			case 'JSXElement':
			case 'JSXFragment':
				for (const child of node.children) {
					if (child.type === 'JSXText') {
						const text = tidy(child.value.replace(HTML_ENTITY, ' '));
						if (HAS_LETTER.test(text)) report(startOf(child), firstLetterLine(child, source), text);
					} else if (child.type === 'JSXExpressionContainer') {
						reportLeaves(child.expression);
					}
				}
				break;
			case 'JSXAttribute':
				if (node.name.type === 'JSXIdentifier' && TEXT_ATTRIBUTES.has(node.name.name)) {
					reportLeaves(node.value?.type === 'JSXExpressionContainer' ? node.value.expression : node.value);
				}
				break;
			case 'CallExpression':
			case 'OptionalCallExpression': {
				if (!isToastCall(node.callee)) break;
				const [first, second] = node.arguments;
				const callLine = lineOf(node);
				for (const argument of [first, second]) {
					if (argument?.type !== 'ObjectExpression') continue;
					for (const property of argument.properties) {
						if (property.type !== 'ObjectProperty' || !TOAST_TEXT_PROPERTIES.has(propertyName(property.key) ?? '')) continue;
						reportLeaves(property.value, callLine);
					}
				}
				reportLeaves(first, callLine);
				break;
			}
			default:
				break;
		}
	});
	return inSourceOrder(found);
}
