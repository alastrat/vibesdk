import { describe, expect, it } from 'vitest';
import { getThoughtSignature, injectThoughtSignatures, SKIP_THOUGHT_SIGNATURE } from './thought-signatures';

interface ToolCall {
	id: string;
	type: 'function';
	function: { name: string; arguments: string };
	extra_content?: { google?: { thought_signature?: string } };
}

function body(...toolCalls: ToolCall[]): string {
	return JSON.stringify({
		model: 'google-ai-studio/gemini-3.6-flash',
		messages: [
			{ role: 'user', content: 'Build a mug store.' },
			{ role: 'assistant', content: '', tool_calls: toolCalls },
			...toolCalls.map((call) => ({ role: 'tool', tool_call_id: call.id, content: '{"ok":true}' })),
		],
	});
}

function call(id: string, signature?: string): ToolCall {
	return {
		id,
		type: 'function',
		function: { name: 'set_title', arguments: '{"title":"Mug Store"}' },
		...(signature ? { extra_content: { google: { thought_signature: signature } } } : {}),
	};
}

function signaturesOf(bodyText: string): Array<string | undefined> {
	const json = JSON.parse(bodyText) as { messages: Array<{ tool_calls?: unknown[] }> };
	return json.messages.flatMap((m) => (m.tool_calls ?? []).map((c) => getThoughtSignature(c)));
}

describe('injectThoughtSignatures', () => {
	it('re-attaches the signature Gemini returned for a tool call', () => {
		const out = injectThoughtSignatures(body(call('call_1')), new Map([['call_1', 'sig-1']]));
		expect(signaturesOf(out)).toEqual(['sig-1']);
	});

	it('marks tool calls Gemini did not produce with the validator-skip placeholder', () => {
		const out = injectThoughtSignatures(body(call('toolu_from_claude')), new Map());
		expect(signaturesOf(out)).toEqual([SKIP_THOUGHT_SIGNATURE]);
	});

	it('keeps a signature that is already present', () => {
		const out = injectThoughtSignatures(body(call('call_1', 'existing')), new Map([['call_1', 'harvested']]));
		expect(signaturesOf(out)).toEqual(['existing']);
	});

	it('handles a mix of Gemini and foreign tool calls in one history', () => {
		const out = injectThoughtSignatures(body(call('call_1'), call('toolu_2')), new Map([['call_1', 'sig-1']]));
		expect(signaturesOf(out)).toEqual(['sig-1', SKIP_THOUGHT_SIGNATURE]);
	});

	it('returns bodies without tool calls unchanged', () => {
		const plain = JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
		expect(injectThoughtSignatures(plain, new Map())).toBe(plain);
	});

	it('returns non-JSON bodies unchanged', () => {
		expect(injectThoughtSignatures('not json', new Map())).toBe('not json');
	});
});
