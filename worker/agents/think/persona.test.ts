import { describe, expect, it } from 'vitest';
import { BRAND } from '../../../shared/brand';
import { PERSONA_PROMPT, composeSystemPrompt } from './persona';

describe('PERSONA_PROMPT', () => {
	it('introduces the assistant by the brand name', () => {
		expect(PERSONA_PROMPT.startsWith(`You are ${BRAND.assistantName},`)).toBe(true);
	});

	it('overrides the base prompt identity', () => {
		expect(PERSONA_PROMPT).toContain('never call yourself Think');
	});
});

describe('composeSystemPrompt', () => {
	it('places the persona and the references rules between the base prompt and the project context', () => {
		expect(composeSystemPrompt('BASE', 'REFS', 'CONTEXT')).toBe(
			`BASE\n\n${PERSONA_PROMPT}\n\nREFS\n\nCONTEXT`,
		);
	});
});
