/**
 * Gemini 3 rejects function-call history without a `thought_signature`
 * (`400 INVALID_ARGUMENT`). The AI SDK drops the signatures, so they are
 * harvested from responses and re-attached to outgoing requests.
 */

/**
 * Gemini's documented value for function calls it did not produce, such as
 * calls made by the fallback model or calls whose signature was not kept.
 */
export const SKIP_THOUGHT_SIGNATURE = 'skip_thought_signature_validator';

export function getThoughtSignature(call: unknown): string | undefined {
	const sig = (call as { extra_content?: { google?: { thought_signature?: unknown } } })?.extra_content?.google
		?.thought_signature;
	return typeof sig === 'string' ? sig : undefined;
}

/**
 * Re-attaches harvested signatures (keyed by tool-call id) to the `tool_calls`
 * in a chat-completions request body. Calls with no known signature get
 * {@link SKIP_THOUGHT_SIGNATURE}. Bodies that are not chat-completions JSON for a Google model
 * are returned unchanged.
 */
export function injectThoughtSignatures(bodyText: string, signatures: ReadonlyMap<string, string>): string {
	let json: { model?: unknown; messages?: unknown };
	try {
		json = JSON.parse(bodyText);
	} catch {
		return bodyText;
	}
	if (typeof json.model !== 'string' || !json.model.startsWith('google-ai-studio/')) return bodyText;
	const messages = json.messages;
	if (!Array.isArray(messages)) return bodyText;
	let changed = false;
	for (const message of messages) {
		const toolCalls = (message as { tool_calls?: unknown })?.tool_calls;
		if (!Array.isArray(toolCalls)) continue;
		for (const call of toolCalls) {
			const id = (call as { id?: unknown })?.id;
			if (typeof id !== 'string') continue;
			if (getThoughtSignature(call)) continue;
			const c = call as { extra_content?: { google?: Record<string, unknown> } };
			c.extra_content = {
				...(c.extra_content ?? {}),
				google: { ...(c.extra_content?.google ?? {}), thought_signature: signatures.get(id) ?? SKIP_THOUGHT_SIGNATURE },
			};
			changed = true;
		}
	}
	return changed ? JSON.stringify(json) : bodyText;
}
