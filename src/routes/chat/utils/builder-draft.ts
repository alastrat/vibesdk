/** A client-only, reviewed draft for an existing store. It is never an agent-start query. */
export function readBuilderDraft(
	state: unknown,
	appId: string | undefined,
): string {
	if (
		!appId ||
		appId === 'new' ||
		!state ||
		typeof state !== 'object' ||
		!('builderDraft' in state)
	)
		return '';
	const value = state.builderDraft;
	if (
		!value ||
		typeof value !== 'object' ||
		!('source' in value) ||
		value.source !== 'store-workspace' ||
		!('appId' in value) ||
		value.appId !== appId ||
		!('text' in value) ||
		typeof value.text !== 'string' ||
		value.text.length > 4000
	)
		return '';
	return value.text.trim();
}
