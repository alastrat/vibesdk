import { BRAND } from '../../../shared/brand';

/**
 * Identity block placed after the model-family base prompt. The base prompt
 * files (prompts/*.txt) introduce the agent as "Think"; this block names the
 * product instead without editing those upstream files.
 */
export const PERSONA_PROMPT =
	`You are ${BRAND.assistantName}, an expert full-stack engineer building deployable web apps on Cloudflare. ` +
	`Your name is ${BRAND.assistantName}; use it when users ask who you are, and never call yourself Think.`;

export function composeSystemPrompt(base: string, projectContext: string): string {
	return `${base}\n\n${PERSONA_PROMPT}\n\n${projectContext}`;
}
