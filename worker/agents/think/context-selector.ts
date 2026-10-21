import type { ModelMessage, ToolCallPart, ToolResultPart, UserModelMessage } from 'ai';

const RECENT_MESSAGE_COUNT = 5;
const MAX_NOTED_CALLS = 30;
const MAX_TARGET_LENGTH = 80;
/** Input fields that name what a tool call acted on, most specific first. */
const TARGET_KEYS = ['path', 'pattern', 'query', 'name', 'draft', 'branch', 'productId', 'url', 'message'];

type MessagePart = {
	type?: string;
};

function partsOf(message: ModelMessage): MessagePart[] {
	return Array.isArray(message.content) ? (message.content as MessagePart[]) : [];
}

function toolCallsOf(message: ModelMessage): ToolCallPart[] {
	if (message.role !== 'assistant' || !Array.isArray(message.content)) return [];
	return message.content.filter((part): part is ToolCallPart => part.type === 'tool-call');
}

function toolResultsOf(message: ModelMessage): ToolResultPart[] {
	if (message.role !== 'tool') return [];
	return message.content.filter((part): part is ToolResultPart => part.type === 'tool-result');
}

function toolCallIds(message: ModelMessage): Set<string> {
	return new Set(toolCallsOf(message).map((part) => part.toolCallId));
}

function toolResultIds(message: ModelMessage): Set<string> {
	return new Set(toolResultsOf(message).map((part) => part.toolCallId));
}

function containsToolCall(message: ModelMessage, toolName: string): boolean {
	return toolCallsOf(message).some((part) => part.toolName === toolName);
}

function hasText(message: ModelMessage): boolean {
	if (message.role !== 'user' && message.role !== 'assistant') return false;
	if (typeof message.content === 'string') return message.content.trim().length > 0;
	return partsOf(message).some(
		(part) => part.type === 'text' && 'text' in part && typeof part.text === 'string' && part.text.trim().length > 0,
	);
}

/** Tools such as deploy_space report failure in their result instead of throwing. */
function reportsError(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return Boolean(record.error) || record.ok === false || record.success === false;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function failed(result: ToolResultPart | undefined): boolean {
	const output = result?.output;
	if (!output) return false;
	switch (output.type) {
		case 'error-text':
		case 'error-json':
		case 'execution-denied':
			return true;
		case 'text':
			return reportsError(parseJson(output.value));
		case 'json':
			return reportsError(output.value);
		default:
			return false;
	}
}

function callTarget(input: unknown): string {
	if (typeof input !== 'object' || input === null) return '';
	const record = input as Record<string, unknown>;
	for (const key of TARGET_KEYS) {
		const value = record[key];
		if (typeof value !== 'string' || value.trim().length === 0) continue;
		const target = value.trim();
		return ` ${JSON.stringify(target.length > MAX_TARGET_LENGTH ? `${target.slice(0, MAX_TARGET_LENGTH)}...` : target)}`;
	}
	return '';
}

interface NotedCall {
	label: string;
	failed: boolean;
	count: number;
}

/**
 * Lists a turn's omitted tool calls so the model does not read its kept replies
 * as claims about work it never did. Inputs and results stay out to save tokens.
 */
function toolCallNote(calls: NotedCall[]): string {
	const shown = calls.slice(0, MAX_NOTED_CALLS).map((call) => {
		const details = [...(call.count > 1 ? [`${call.count} calls`] : []), ...(call.failed ? ['failed'] : [])];
		return details.length > 0 ? `${call.label} (${details.join(', ')})` : call.label;
	});
	const hidden = calls.slice(MAX_NOTED_CALLS).reduce((sum, call) => sum + call.count, 0);
	if (hidden > 0) shown.push(`and ${hidden} more call${hidden === 1 ? '' : 's'}`);
	return (
		'System note, not written by the user: your reply to this message made the tool calls below. ' +
		'They ran, but their inputs and results are left out of this context to save space; ' +
		`use the workspace tools if you need details. Calls: ${shown.join('; ')}.`
	);
}

function withNote(message: UserModelMessage, note: string): UserModelMessage {
	const content =
		typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content;
	return { ...message, content: [...content, { type: 'text', text: note }] };
}

/**
 * Notes, keyed by the index of the user message that opened each turn, for turns
 * whose replies are kept but whose ordinary tool calls are dropped.
 */
function collectToolCallNotes(
	messages: ModelMessage[],
	selected: Set<number>,
	protectedToolMessages: Set<number>,
): Map<number, string> {
	const results = new Map<string, ToolResultPart>();
	for (const message of messages) {
		for (const part of toolResultsOf(message)) results.set(part.toolCallId, part);
	}

	const notes = new Map<number, string>();
	let turnStart = -1;
	let repliesKept = false;
	let calls = new Map<string, NotedCall>();
	const closeTurn = () => {
		if (turnStart < 0 || !repliesKept || calls.size === 0) return;
		notes.set(turnStart, toolCallNote([...calls.values()]));
	};

	messages.forEach((message, index) => {
		if (message.role === 'user') {
			closeTurn();
			turnStart = index;
			repliesKept = false;
			calls = new Map();
			return;
		}
		if (message.role !== 'assistant') return;
		if (selected.has(index) && hasText(message)) repliesKept = true;
		if (protectedToolMessages.has(index)) return;
		for (const call of toolCallsOf(message)) {
			const label = `${call.toolName}${callTarget(call.input)}`;
			const isFailed = failed(results.get(call.toolCallId));
			const key = `${label}\n${isFailed}`;
			const noted = calls.get(key);
			if (noted) noted.count++;
			else calls.set(key, { label, failed: isFailed, count: 1 });
		}
	});
	closeTurn();
	return notes;
}

function includeNamedToolPair(
	messages: ModelMessage[],
	selected: Set<number>,
	protectedToolMessages: Set<number>,
	callIndex: number,
): void {
	selected.add(callIndex);
	protectedToolMessages.add(callIndex);
	const calls = toolCallIds(messages[callIndex]);
	for (let candidate = callIndex + 1; candidate < messages.length; candidate++) {
		if (messages[candidate].role !== 'tool') break;
		const results = toolResultIds(messages[candidate]);
		if ([...results].some((id) => calls.has(id))) {
			selected.add(candidate);
			protectedToolMessages.add(candidate);
		}
	}
}

export function selectThinkContextMessages(messages: ModelMessage[]): ModelMessage[] {
	if (messages.length === 0) return [];

	const selected = new Set<number>([0]);
	const protectedToolMessages = new Set<number>();
	let recentTextCount = 0;
	for (let index = messages.length - 1; index >= 0 && recentTextCount < RECENT_MESSAGE_COUNT; index--) {
		if (!hasText(messages[index])) continue;
		selected.add(index);
		recentTextCount++;
	}

	for (let index = 0; index < messages.length; index++) {
		if (containsToolCall(messages[index], 'ask_questions')) {
			includeNamedToolPair(messages, selected, protectedToolMessages, index);
			for (let candidate = index + 1; candidate < messages.length; candidate++) {
				if (messages[candidate].role === 'user') {
					selected.add(candidate);
					break;
				}
			}
		}
		if (
			containsToolCall(messages[index], 'activate_skill') ||
			containsToolCall(messages[index], 'set_title')
		) {
			includeNamedToolPair(messages, selected, protectedToolMessages, index);
		}
	}

	const notes = collectToolCallNotes(messages, selected, protectedToolMessages);
	for (const index of notes.keys()) selected.add(index);

	return messages.flatMap((message, index) => {
		if (!selected.has(index)) return [];
		const note = notes.get(index);
		if (note && message.role === 'user') return [withNote(message, note)];
		if (
			message.role !== 'assistant' ||
			protectedToolMessages.has(index) ||
			!Array.isArray(message.content)
		) {
			return [message];
		}
		const textContent = message.content.filter((part) => part.type !== 'tool-call');
		return textContent.length > 0 ? [{ ...message, content: textContent }] : [];
	});
}
