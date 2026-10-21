/**
 * Finds the English text of the app's messages in source code, and the English text that was never wrapped in one.
 *
 * Messages are found by name:
 *  - `t('text')`, `t('text', values)` and the server form `t(locale, 'text', values)`;
 *  - `tn('one', 'other', count, values)` and `tn(locale, 'one', 'other', count, values)`, keyed by `one|other`;
 *  - `msg('text')`;
 *  - `<T text="text" />`, as a string or an expression;
 *  - the same names called on any object, such as `i18n.t('text')` or `serverT(locale).t('text')`, and with type
 *    arguments, such as `t<string>('text')`.
 * A template literal with no expressions counts as a literal, and a condition or fallback gives one message for each
 * literal in it: `t(busy ? 'Saving' : 'Save')` is two. A variable, member or call is left alone, since a constant
 * marked with `msg()` is translated where it is shown. A template literal with expressions, or a concatenation, can
 * never match a catalog key, so it comes back in `skipped` for the caller to treat as an error.
 */

import { parse } from '@babel/parser';
import type { File, JSXAttribute, JSXOpeningElement, Node, TemplateLiteral } from '@babel/types';
import { pluralKey } from './translate';

export interface ExtractedMessage {
	/** The catalog key: the English text, or `singular|plural` for a plural. */
	key: string;
	plural?: { singular: string; plural: string };
	file: string;
	line: number;
}

/** Why a message could not be read from a call. */
export type SkipReason = 'a template literal with expressions' | 'a concatenation' | 'forms that are not both literals';

/** A call that names a message in a way no catalog key can match. */
export interface SkippedMessage {
	file: string;
	line: number;
	/** `t`, `tn`, `msg`, or `T` for `<T text>`. */
	call: string;
	reason: SkipReason;
}

export interface Extraction {
	messages: ExtractedMessage[];
	skipped: SkippedMessage[];
}

export interface UntranslatedText {
	file: string;
	line: number;
	text: string;
}

/** Files without a call of these names, with or without type arguments, or a `<T`, hold no message: they are not parsed. */
const MAY_HOLD_MESSAGE = /\b(?:t|tn|msg)\s*(?:<[^()]*>\s*)?\(|<T\b/;

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

/** JSX attributes that hold code: path data, class names, styles, `data-*`, and the plain attributes of HTML. */
const CODE_ATTRIBUTES: ReadonlySet<string> = new Set(['d', 'points', 'transform', 'viewBox', 'fontFamily', 'className', 'style', 'href', 'id', 'key', 'type']);

/** Object keys whose value is text the user reads, so even a single capitalized word under one is flagged. */
const DATA_TEXT_KEYS: ReadonlySet<string> = new Set(['label', 'title', 'description', 'placeholder', 'tooltip', 'message', 'heading', 'text']);

/** The `toast` calls whose message the user reads: sonner's, and Kumo's `add`. */
const TOAST_METHODS: ReadonlySet<string> = new Set(['success', 'error', 'warning', 'info', 'message', 'loading', 'add']);

/** The properties of a toast's options object that the user reads. */
const TOAST_TEXT_PROPERTIES: ReadonlySet<string> = new Set(['title', 'description']);

const HAS_LETTER = /\p{L}/u;
const HTML_ENTITY = /&#?\w+;/g;
const IGNORE_MARKER = /^\s*i18n-ignore\b/;
const MESSAGE_START = /^\p{Lu}/u;
const SENTENCE_END = /[.?!…:]$/;
const CAPITALIZED_WORD = /^\p{Lu}\p{Ll}/u;
const FUNCTION_NODES: ReadonlySet<string> = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'ClassMethod']);

/** The names that write log lines: `console`, `log`, `logger`, and the getters that hand one out; or `currentLogger`. */
const LOGGER_NAME = /^(?:console|log|logger|getLog|getLogger)$/i;
const LOGGER_SUFFIX = /Logger$/;
/** `log('x')` and `logError('x')`, but not `login('x')`. */
const LOG_FUNCTION = /^log(?:[A-Z]\w*)?$/;

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

/** Calls `visit` for a node and every node below it, parents first, with the node's ancestors, the nearest last. */
export function visitNodes(root: Node, visit: (node: Node, ancestors: readonly Node[]) => void): void {
	const ancestors: Node[] = [];
	const walk = (node: Node): void => {
		visit(node, ancestors);
		ancestors.push(node);
		for (const [key, value] of Object.entries(node)) {
			if (NOT_CHILDREN.has(key)) continue;
			if (Array.isArray(value)) {
				for (const item of value) if (isNode(item)) walk(item);
			} else if (isNode(value)) {
				walk(value);
			}
		}
		ancestors.pop();
	};
	walk(root);
}

function isTemplateWithoutExpressions(node: TemplateLiteral): boolean {
	return node.expressions.length === 0;
}

/** The text of a string literal, or of a template literal with no expressions; empty text is not a message. */
function literalText(node: Node | null | undefined): string | null {
	if (!node) return null;
	switch (node.type) {
		case 'StringLiteral':
			return node.value === '' ? null : node.value;
		case 'TemplateLiteral':
			return (isTemplateWithoutExpressions(node) ? node.quasis[0]?.value.cooked : null) || null;
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return literalText(node.expression);
		default:
			return null;
	}
}

/** The messages an argument holds, and what stops it from holding others. */
interface KeyParts {
	keys: string[];
	problems: SkipReason[];
}

const NO_KEYS: KeyParts = { keys: [], problems: [] };

function joined(a: KeyParts, b: KeyParts): KeyParts {
	return { keys: [...a.keys, ...b.keys], problems: [...a.problems, ...b.problems] };
}

/**
 * The literals an argument can be: a string, either branch of a condition, either side of a fallback. A template
 * literal with expressions and a concatenation are problems; a variable, member or call is neither.
 */
function keyParts(node: Node | null | undefined): KeyParts {
	if (!node) return NO_KEYS;
	switch (node.type) {
		case 'StringLiteral':
			return node.value === '' ? NO_KEYS : { keys: [node.value], problems: [] };
		case 'TemplateLiteral': {
			if (!isTemplateWithoutExpressions(node)) return { keys: [], problems: ['a template literal with expressions'] };
			const text = node.quasis[0]?.value.cooked;
			return text ? { keys: [text], problems: [] } : NO_KEYS;
		}
		case 'BinaryExpression':
			return node.operator === '+' ? { keys: [], problems: ['a concatenation'] } : NO_KEYS;
		case 'ConditionalExpression':
			return joined(keyParts(node.consequent), keyParts(node.alternate));
		case 'LogicalExpression':
			return joined(keyParts(node.left), keyParts(node.right));
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return keyParts(node.expression);
		default:
			return NO_KEYS;
	}
}

function isShaped(node: Node | null | undefined): boolean {
	const { keys, problems } = keyParts(node);
	return keys.length > 0 || problems.length > 0;
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

interface CallReading {
	messages: MessageShape[];
	problems: SkipReason[];
}

/**
 * A plural is read only when both its forms are plain literals; a form that is only a variable is left alone. A
 * message as the third argument means the server form, with a locale first; in the client form it is a count, which
 * may be any expression.
 */
function readPlural(args: readonly Node[]): CallReading {
	const offset = keyParts(args[2]).keys.length > 0 ? 1 : 0;
	const singular = literalText(args[offset]);
	const plural = literalText(args[offset + 1]);
	if (singular !== null && plural !== null) return { messages: [{ key: pluralKey(singular, plural), plural: { singular, plural } }], problems: [] };
	return { messages: [], problems: isShaped(args[offset]) || isShaped(args[offset + 1]) ? ['forms that are not both literals'] : [] };
}

/**
 * The messages a call names. Only the client form `t(text, values)` has an object second argument, so a message
 * there means the server form with a locale first; `tn` is told apart by its third argument, a count in the client form.
 */
function readCall(name: string, args: readonly Node[]): CallReading {
	if (name === 'tn') return readPlural(args);
	const second = name === 't' ? keyParts(args[1]) : NO_KEYS;
	const { keys, problems } = second.keys.length > 0 || second.problems.length > 0 ? second : keyParts(args[0]);
	return { messages: keys.map((key) => ({ key })), problems };
}

/** The value of a `<T text>` attribute, with its expression container taken off. */
function textOfTag(tag: JSXOpeningElement): Node | null | undefined {
	for (const attribute of tag.attributes) {
		if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier' || attribute.name.name !== 'text') continue;
		return attribute.value?.type === 'JSXExpressionContainer' ? attribute.value.expression : attribute.value;
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

/** The messages `source` marks for translation, in source order, and the calls that name one no catalog key can match. */
export function extractMessages(source: string, file: string): Extraction {
	if (!MAY_HOLD_MESSAGE.test(source)) return { messages: [], skipped: [] };
	const messages: Array<{ at: number; value: ExtractedMessage }> = [];
	const skipped: Array<{ at: number; value: SkippedMessage }> = [];
	visitNodes(parseSource(source, file).program, (node) => {
		let call: string | null = null;
		let reading: CallReading | null = null;
		if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
			const name = calleeName(node.callee);
			if (name !== null && MESSAGE_FUNCTIONS.has(name)) {
				call = name;
				reading = readCall(name, node.arguments);
			}
		} else if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && node.name.name === 'T') {
			call = 'T';
			const { keys, problems } = keyParts(textOfTag(node));
			reading = { messages: keys.map((key) => ({ key })), problems };
		}
		if (call === null || reading === null) return;
		const at = startOf(node);
		const line = lineOf(node);
		for (const message of reading.messages) messages.push({ at, value: { ...message, file, line } });
		for (const reason of reading.problems) skipped.push({ at, value: { file, line, call, reason } });
	});
	return { messages: inSourceOrder(messages), skipped: inSourceOrder(skipped) };
}

/** The messages in a set of files, by path; a leading slash, as in `import.meta.glob` keys, is dropped. */
export function messagesOfFiles(files: Readonly<Record<string, string>>): Extraction {
	const found = Object.entries(files).map(([path, text]) => extractMessages(text, path.replace(/^\//, '')));
	return { messages: found.flatMap((extraction) => extraction.messages), skipped: found.flatMap((extraction) => extraction.skipped) };
}

interface TextLeaf {
	node: Node;
	text: string;
}

function tidy(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** A template literal as written, without its backticks. */
function templateSource(node: TemplateLiteral, source: string): string {
	return source.slice(startOf(node) + 1, (node.end ?? 1) - 1);
}

/** The template's fixed text: what is left with its expressions taken out. */
function fixedText(node: TemplateLiteral): string {
	return node.quasis.map((quasi) => quasi.value.cooked ?? '').join('');
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
		case 'TemplateLiteral':
			return HAS_LETTER.test(fixedText(node)) ? [{ node, text: tidy(templateSource(node, source)) }] : [];
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

/** The name of an identifier, a member's property, or the function a call calls. */
function plainName(node: Node): string | null {
	if (node.type === 'Identifier') return node.name;
	if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && !node.computed && node.property.type === 'Identifier') return node.property.name;
	if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') return plainName(node.callee);
	return null;
}

/** `console`, a logger, or what hands one out: `logger`, `this.logger`, `currentLogger`, `this.logger()`, `this.getLog()`. */
function isLoggerSource(node: Node): boolean {
	const name = plainName(node);
	return name !== null && (LOGGER_NAME.test(name) || LOGGER_SUFFIX.test(name));
}

/** A call that writes a log line: a method of a logger, or a function named `log` or `logSomething`. */
function isLogCall(callee: Node): boolean {
	if (callee.type === 'Identifier') return LOG_FUNCTION.test(callee.name);
	return (callee.type === 'MemberExpression' || callee.type === 'OptionalMemberExpression') && isLoggerSource(callee.object);
}

/** Whether a node only hands the value of one of its parts on, so that part's text is shown where the node's is. */
function passesValue(parent: Node, child: Node): boolean {
	switch (parent.type) {
		case 'ConditionalExpression':
			return parent.test !== child;
		case 'LogicalExpression':
		case 'JSXExpressionContainer':
		case 'TSAsExpression':
		case 'TSSatisfiesExpression':
		case 'TSNonNullExpression':
			return true;
		case 'BinaryExpression':
			return parent.operator === '+';
		default:
			return false;
	}
}

/** How an attribute's value is read: shown as text, the key of a `<T text>`, code, or shown when it reads as a message. */
type AttributeKind = 'text' | 'message' | 'code' | 'other';

function attributeKind(attribute: JSXAttribute, element: Node | undefined): AttributeKind {
	if (attribute.name.type !== 'JSXIdentifier') return 'code';
	const name = attribute.name.name;
	if (name === 'text') return element?.type === 'JSXOpeningElement' && element.name.type === 'JSXIdentifier' && element.name.name === 'T' ? 'message' : 'text';
	if (TEXT_ATTRIBUTES.has(name)) return 'text';
	return CODE_ATTRIBUTES.has(name) || name.startsWith('data-') ? 'code' : 'other';
}

/** Whether a node sits in the value of an attribute that holds code or a message key, outside any function in it. */
function insideCodeAttribute(ancestors: readonly Node[]): boolean {
	for (let index = ancestors.length - 1; index >= 0; index--) {
		const ancestor = ancestors[index];
		if (FUNCTION_NODES.has(ancestor.type)) return false;
		if (ancestor.type === 'JSXAttribute') {
			const kind = attributeKind(ancestor, ancestors[index - 1]);
			return kind === 'code' || kind === 'message';
		}
	}
	return false;
}

/** Tags whose template is code: `sql`, `css`, and a `sql` method. */
function isCodeTag(tag: Node): boolean {
	if (tag.type === 'Identifier') return tag.name === 'sql' || tag.name === 'css';
	return tag.type === 'MemberExpression' && !tag.computed && tag.property.type === 'Identifier' && tag.property.name === 'sql';
}

/** Where a literal's value goes: the first node above it that does more than hand the value on, and the child it came through. */
interface Owner {
	parent: Node | undefined;
	child: Node;
}

/** Looks through a condition's branches, a fallback, a concatenation and a type assertion to where the value goes. */
function ownerOf(node: Node, ancestors: readonly Node[]): Owner {
	let child = node;
	let index = ancestors.length - 1;
	while (index >= 0 && passesValue(ancestors[index], child)) child = ancestors[index--];
	return { parent: ancestors[index], child };
}

/**
 * Whether a literal is code or data rather than text the user reads: a module source, a key, a type, an argument of
 * `t`, `tn`, `msg` or a log call, the value of a JSX attribute that holds code, or a `sql` or `css` template.
 */
function isNotShown({ parent, child }: Owner, ancestors: readonly Node[]): boolean {
	if (insideCodeAttribute(ancestors)) return true;
	if (!parent) return false;
	switch (parent.type) {
		case 'ImportDeclaration':
		case 'ExportNamedDeclaration':
		case 'ExportAllDeclaration':
		case 'ImportAttribute':
		case 'TSExternalModuleReference':
		case 'TSImportType':
		case 'TSModuleDeclaration':
		case 'TSLiteralType':
			return true;
		case 'TaggedTemplateExpression':
			return parent.quasi === child && isCodeTag(parent.tag);
		case 'ObjectProperty':
		case 'ObjectMethod':
		case 'ClassProperty':
		case 'ClassMethod':
		case 'TSPropertySignature':
		case 'TSMethodSignature':
			return parent.key === child;
		case 'TSEnumMember':
			return parent.id === child;
		case 'MemberExpression':
		case 'OptionalMemberExpression':
			return parent.computed && parent.property === child;
		case 'CallExpression':
		case 'OptionalCallExpression': {
			if (parent.callee === child) return false;
			const name = calleeName(parent.callee);
			return parent.callee.type === 'Import' || name === 'require' || (name !== null && MESSAGE_FUNCTIONS.has(name)) || isLogCall(parent.callee);
		}
		default:
			return false;
	}
}

/** Whether the value is a property, under a name that is text, of an object: `{ label: 'Orders' }`. */
function isDataText({ parent, child }: Owner): boolean {
	return parent?.type === 'ObjectProperty' && !parent.computed && parent.value === child && DATA_TEXT_KEYS.has(propertyName(parent.key) ?? '');
}

/** Text that reads as a message: it starts with a capital, and has a space in it or ends like a sentence. */
function readsAsMessage(text: string): boolean {
	return MESSAGE_START.test(text) && (/\s/.test(text) || SENTENCE_END.test(text.trimEnd()));
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
 * English text that is shown to the user without going through `t`:
 *  - JSX text, the string values of the text attributes, and the message of a `toast`, each with letters in it;
 *  - any other string, or the fixed text of a template literal, that reads as a message: a capital first, then a space
 *    inside or a closing mark (`. ? ! … :`) at the end. That is an object's `label`, a fallback passed to a helper,
 *    an error's message, a `confirm()`, a message constant, the value of a custom prop such as `eyebrow`. A single
 *    capitalized word counts too as the value of `label`, `title`, `description`, `placeholder`, `tooltip`, `message`,
 *    `heading` or `text` in an object. It is not a module source, a key, a type, an argument of `t`, `tn`, `msg` or a log
 *    call, the value of an attribute that holds code (`className`, `style`, `d`, `data-*`, ...), or a `sql` or `css` template.
 * A line is skipped when an `i18n-ignore` comment stands alone on the line above it, or trails it, for names and code
 * that are never translated.
 */
export function findUntranslatedText(source: string, file: string): UntranslatedText[] {
	const ast = parseSource(source, file);
	const ignored = ignoredLines(ast, source);
	const found: Array<{ at: number; value: UntranslatedText }> = [];
	/** Literals the rules for text positions have seen, ignored or not, so the general rule leaves them be. */
	const seen = new Set<number>();

	const report = (at: number, line: number, text: string, ownerLine = line): void => {
		if (!ignored.has(line) && !ignored.has(ownerLine)) found.push({ at, value: { file, line, text } });
	};
	const reportLeaves = (expression: Node | null | undefined, ownerLine?: number): void => {
		for (const leaf of textLeaves(expression, source)) {
			seen.add(startOf(leaf.node));
			report(startOf(leaf.node), lineOf(leaf.node), leaf.text, ownerLine);
		}
	};

	visitNodes(ast.program, (node, ancestors) => {
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
				if (attributeKind(node, ancestors[ancestors.length - 1]) === 'text') {
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
			case 'StringLiteral':
			case 'TemplateLiteral': {
				if (seen.has(startOf(node))) break;
				const owner = ownerOf(node, ancestors);
				if (isNotShown(owner, ancestors)) break;
				const text = node.type === 'StringLiteral' ? node.value : fixedText(node);
				if (readsAsMessage(text) || (CAPITALIZED_WORD.test(text) && isDataText(owner))) report(startOf(node), lineOf(node), tidy(node.type === 'StringLiteral' ? node.value : templateSource(node, source)));
				break;
			}
			default:
				break;
		}
	});
	return inSourceOrder(found);
}
