import type { ModelMessage, ToolResultPart } from 'ai';
import { describe, expect, it } from 'vitest';
import { selectThinkContextMessages } from './context-selector';

function user(text: string): ModelMessage {
	return { role: 'user', content: text };
}

function assistant(text: string): ModelMessage {
	return { role: 'assistant', content: text };
}

function toolCall(id: string, toolName: string, input?: Record<string, unknown>): ModelMessage {
	return {
		role: 'assistant',
		content: [
			{
				type: 'tool-call',
				toolCallId: id,
				toolName,
				input: input ?? (toolName === 'ask_questions' ? { questions: [{ question: 'Choose' }] } : {}),
			},
		],
	};
}

function ask(id: string): ModelMessage {
	return toolCall(id, 'ask_questions');
}

function result(
	id: string,
	toolName = 'ask_questions',
	output: ToolResultPart['output'] = { type: 'text', value: '{"ok":true}' },
): ModelMessage {
	return {
		role: 'tool',
		content: [{ type: 'tool-result', toolCallId: id, toolName, output }],
	};
}

/** A user message carrying the note that lists its turn's omitted tool calls. */
function noted(text: string, calls: string): ModelMessage {
	return {
		role: 'user',
		content: [
			{ type: 'text', text },
			{ type: 'text', text: expect.stringContaining(`Calls: ${calls}`) },
		],
	};
}

/** The calls listed in the note on the selected user message that starts with `text`. */
function callsNotedOn(selected: ModelMessage[], text: string): string | undefined {
	for (const message of selected) {
		if (message.role !== 'user' || typeof message.content === 'string') continue;
		const texts = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : []));
		if (texts[0] === text && texts.length > 1) return texts[texts.length - 1].split('Calls: ')[1];
	}
	return undefined;
}

describe('selectThinkContextMessages', () => {
	it('returns short histories unchanged', () => {
		const messages = [user('first'), assistant('one'), user('two')];
		expect(selectThinkContextMessages(messages)).toEqual(messages);
	});

	it('keeps the first and last five messages', () => {
		const messages = [
			user('first'),
			assistant('drop-1'),
			assistant('drop-2'),
			user('recent-1'),
			assistant('recent-2'),
			user('recent-3'),
			assistant('recent-4'),
			user('recent-5'),
		];
		expect(selectThinkContextMessages(messages)).toEqual([
			messages[0],
			...messages.slice(-5),
		]);
	});

	it('keeps every clarification call, its result, and its next user reply', () => {
		const messages = [
			user('first'),
			ask('ask-1'),
			result('ask-1'),
			assistant('waiting'),
			user('answer-1'),
			assistant('old work'),
			ask('ask-2'),
			result('ask-2'),
			assistant('more waiting'),
			user('answer-2'),
			assistant('recent-1'),
			user('recent-2'),
			assistant('recent-3'),
			user('recent-4'),
			assistant('recent-5'),
		];
		expect(selectThinkContextMessages(messages)).toEqual([
			messages[0],
			messages[1],
			messages[2],
			messages[4],
			messages[6],
			messages[7],
			...messages.slice(-6, -5),
			...messages.slice(-5),
		]);
	});

	it('associates consecutive calls with the same next user reply', () => {
		const messages = [
			user('first'),
			ask('ask-1'),
			result('ask-1'),
			ask('ask-2'),
			result('ask-2'),
			assistant('waiting'),
			user('shared answer'),
			assistant('one'),
			user('two'),
			assistant('three'),
			user('four'),
			assistant('five'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toContain(messages[1]);
		expect(selected).toContain(messages[2]);
		expect(selected).toContain(messages[3]);
		expect(selected).toContain(messages[4]);
		expect(selected.filter((message) => message === messages[6])).toHaveLength(1);
	});

	it('keeps an unanswered clarification call and its tool result', () => {
		const messages = [
			user('first'),
			assistant('old'),
			user('older'),
			ask('pending'),
			result('pending'),
			assistant('one'),
			assistant('two'),
			assistant('three'),
			assistant('four'),
			assistant('five'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toContain(messages[3]);
		expect(selected).toContain(messages[4]);
	});

	it('keeps all activate_skill calls and responses', () => {
		const messages = [
			user('first'),
			toolCall('skill-1', 'activate_skill'),
			result('skill-1', 'activate_skill'),
			assistant('old'),
			toolCall('skill-2', 'activate_skill'),
			result('skill-2', 'activate_skill'),
			user('one'),
			assistant('two'),
			user('three'),
			assistant('four'),
			user('five'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toContain(messages[1]);
		expect(selected).toContain(messages[2]);
		expect(selected).toContain(messages[4]);
		expect(selected).toContain(messages[5]);
	});

	it('keeps all set_title calls and responses', () => {
		const messages = [
			user('first'),
			toolCall('title-1', 'set_title'),
			result('title-1', 'set_title'),
			assistant('old'),
			toolCall('title-2', 'set_title'),
			result('title-2', 'set_title'),
			user('one'),
			assistant('two'),
			user('three'),
			assistant('four'),
			user('five'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toContain(messages[1]);
		expect(selected).toContain(messages[2]);
		expect(selected).toContain(messages[4]);
		expect(selected).toContain(messages[5]);
	});

	it('removes orphaned ordinary tool calls from retained assistant text', () => {
		const mixedAssistant: ModelMessage = {
			role: 'assistant',
			content: [
				{ type: 'text', text: 'I updated the file.' },
				{ type: 'tool-call', toolCallId: 'write-18', toolName: 'write', input: {} },
			],
		};
		const messages = [
			user('first'),
			assistant('old'),
			mixedAssistant,
			result('write-18', 'write'),
			user('two'),
			assistant('three'),
			user('four'),
			assistant('five'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toContainEqual({
			role: 'assistant',
			content: [{ type: 'text', text: 'I updated the file.' }],
		});
		expect(selected).not.toContain(messages[3]);
		expect(callsNotedOn(selected, 'first')).toBe('write.');
	});

	it('counts only text messages in the recent five and excludes ordinary tools', () => {
		const messages = [
			user('first'),
			assistant('old'),
			user('recent-1'),
			toolCall('read-1', 'read'),
			result('read-1', 'read'),
			assistant('recent-2'),
			toolCall('write-1', 'write'),
			result('write-1', 'write'),
			user('recent-3'),
			assistant('recent-4'),
			user('recent-5'),
		];
		expect(selectThinkContextMessages(messages)).toEqual([
			messages[0],
			noted('recent-1', 'read; write.'),
			messages[5],
			messages[8],
			messages[9],
			messages[10],
		]);
	});

	it('notes the omitted calls of a kept reply on the user message that opened its turn', () => {
		const content = 'export const Hero = () => <section className="bg-navy" />;\n'.repeat(100);
		const messages: ModelMessage[] = [
			user('first'),
			assistant('old'),
			user('make the hero navy'),
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Updating the hero.' },
					{ type: 'tool-call', toolCallId: 'write-1', toolName: 'write', input: { path: 'src/Hero.tsx', content } },
				],
			},
			result('write-1', 'write', { type: 'text', value: 'Wrote 5900 bytes to src/Hero.tsx' }),
			toolCall('deploy-1', 'deploy_space'),
			result('deploy-1', 'deploy_space', { type: 'text', value: '{"branch":"main","preview_url":"/space/s/preview/main/"}' }),
			assistant('The hero is navy.'),
			user('now the footer'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(selected).toEqual([
			messages[0],
			messages[1],
			noted('make the hero navy', 'write "src/Hero.tsx"; deploy_space.'),
			{ role: 'assistant', content: [{ type: 'text', text: 'Updating the hero.' }] },
			messages[7],
			messages[8],
		]);
		const serialized = JSON.stringify(selected);
		expect(serialized).not.toContain('export const Hero');
		expect(serialized).not.toContain('Wrote 5900 bytes');
		expect(serialized).not.toContain('preview_url');
	});

	it('marks failed calls and counts repeated ones', () => {
		const messages: ModelMessage[] = [
			user('first'),
			user('fix the build'),
			toolCall('edit-1', 'edit', { path: 'src/App.tsx', old_string: 'a', new_string: 'b' }),
			result('edit-1', 'edit'),
			toolCall('deploy-1', 'deploy_space'),
			result('deploy-1', 'deploy_space', { type: 'text', value: '{"branch":"main","error":"Deploy failed: syntax error"}' }),
			toolCall('edit-2', 'edit', { path: 'src/App.tsx', old_string: 'b', new_string: 'c' }),
			result('edit-2', 'edit'),
			toolCall('read-1', 'read', { path: 'src/missing.tsx' }),
			result('read-1', 'read', { type: 'error-text', value: 'File not found' }),
			toolCall('deploy-2', 'deploy_space'),
			result('deploy-2', 'deploy_space', { type: 'json', value: { branch: 'main', error: 'Deploy failed again' } }),
			toolCall('deploy-3', 'deploy_space'),
			result('deploy-3', 'deploy_space', { type: 'text', value: '{"branch":"main"}' }),
			assistant('The build passes.'),
		];
		expect(callsNotedOn(selectThinkContextMessages(messages), 'fix the build')).toBe(
			'edit "src/App.tsx" (2 calls); deploy_space (2 calls, failed); read "src/missing.tsx" (failed); deploy_space.',
		);
	});

	it('keeps the note short: at most 30 distinct calls, each target cut to 80 characters', () => {
		const reads = Array.from({ length: 35 }, (_, i) => [
			toolCall(`read-${i}`, 'read', { path: `src/file-${i}.ts` }),
			result(`read-${i}`, 'read'),
		]).flat();
		const messages: ModelMessage[] = [
			user('first'),
			user('look around'),
			toolCall('grep-1', 'grep', { query: 'q'.repeat(200) }),
			result('grep-1', 'grep'),
			...reads,
			assistant('Done looking.'),
		];
		const listed = callsNotedOn(selectThinkContextMessages(messages), 'look around');
		expect(listed?.startsWith(`grep "${'q'.repeat(80)}..."; read "src/file-0.ts";`)).toBe(true);
		expect(listed?.endsWith('read "src/file-28.ts"; and 6 more calls.')).toBe(true);
	});

	it('adds no note for a turn whose replies fall outside the window', () => {
		const messages = [
			user('first'),
			user('old request'),
			toolCall('write-1', 'write', { path: 'src/Old.tsx' }),
			result('write-1', 'write'),
			assistant('old reply'),
			user('one'),
			assistant('two'),
			user('three'),
			assistant('four'),
			user('five'),
		];
		expect(selectThinkContextMessages(messages)).toEqual([messages[0], ...messages.slice(-5)]);
	});

	it('leaves kept skill and title calls out of the note', () => {
		const messages: ModelMessage[] = [
			user('first'),
			toolCall('title-1', 'set_title', { title: 'Bakery' }),
			result('title-1', 'set_title'),
			toolCall('write-1', 'write', { path: 'src/App.tsx' }),
			result('write-1', 'write'),
			assistant('Built the bakery.'),
		];
		const selected = selectThinkContextMessages(messages);
		expect(callsNotedOn(selected, 'first')).toBe('write "src/App.tsx".');
		expect(selected).toContain(messages[1]);
		expect(selected).toContain(messages[2]);
	});

	it('brings in the opening user message of a kept turn, finished or not', () => {
		const messages: ModelMessage[] = [
			user('first'),
			assistant('old'),
			user('build the store'),
			assistant('step 1'),
			assistant('step 2'),
			assistant('step 3'),
			assistant('step 4'),
			assistant('step 5'),
			toolCall('write-1', 'write', { path: 'src/App.tsx' }),
			result('write-1', 'write'),
		];
		expect(selectThinkContextMessages(messages)).toEqual([
			messages[0],
			noted('build the store', 'write "src/App.tsx".'),
			...messages.slice(3, 8),
		]);
	});
});
