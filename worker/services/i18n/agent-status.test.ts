import { expect, it } from 'vitest';
import { localizeAgentStatus } from './agent-status';
it('localizes platform statuses without touching protocol fields or seller content', () => {
	expect(localizeAgentStatus('generation_started', { message: 'Code generation started', status: 'generating' }, 'es')).toEqual({
		message: 'Se inició la generación de código',
		status: 'generating',
	});
	expect(localizeAgentStatus('conversation_response', { message: 'Code generation started' }, 'es').message).toBe(
		'Code generation started',
	);
	expect(
		localizeAgentStatus('file_generated', { message: 'Code generation started', fileContents: 'English file text' }, 'pt-BR')
			.fileContents,
	).toBe('English file text');
});
