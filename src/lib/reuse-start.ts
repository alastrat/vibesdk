/** Chat URL that starts a new app from a published site; the chat page creates the session. */
export function reuseStartPath(input: { sourceAppId: string; description: string; modelId?: string }): string {
	const params = new URLSearchParams();
	params.set('source', input.sourceAppId);
	params.set('query', input.description.trim());
	params.set('projectType', 'app');
	params.set('behaviorType', 'think');
	if (input.modelId) params.set('model', input.modelId);
	return `/chat/new?${params.toString()}`;
}
