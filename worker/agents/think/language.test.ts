import { expect, it, vi } from 'vitest';
import { sellerLanguageInstruction } from './language';
import { savedUserLocale } from '../../services/i18n/saved-locale';
import source from './ThinkAgent.ts?raw';
it('loads the saved language at turn start and appends its instruction to the existing system prompt', () => {
	expect(source).toContain('const turnLocale = await savedUserLocale(this.env, config?.userId)');
	expect(source).toContain('[ctx.system, sellerLanguageInstruction(turnLocale)]');
	expect(source).toContain('return { messages, system, maxRetries: TURN_MAX_RETRIES }');
	expect(source).toContain('composeSystemPrompt(base, PROMPT_REFERENCES, projectContext)');
});
it('requests seller replies in Spanish or Portuguese while preserving store language and code', () => {
	expect(sellerLanguageInstruction('es')).toContain('Reply to the seller in Latin American Spanish.');
	expect(sellerLanguageInstruction('pt-BR')).toContain('Reply to the seller in Brazilian Portuguese.');
	expect(sellerLanguageInstruction('es')).toContain(
		"Keep code, file names and the store's own text in whatever language the seller asks for.",
	);
	expect(sellerLanguageInstruction('en')).toBe('');
	expect(sellerLanguageInstruction('fr')).toBe('');
});
it('falls back to English when a background preference cannot be loaded', async () => {
	const failed = {
		DB: {
			prepare: vi.fn(() => {
				throw Error('unavailable');
			}),
		},
	} as unknown as Parameters<typeof savedUserLocale>[0];
	expect(await savedUserLocale(failed, 'seller')).toBe('en');
	expect(sellerLanguageInstruction(await savedUserLocale(failed, 'seller'))).toBe('');
});
