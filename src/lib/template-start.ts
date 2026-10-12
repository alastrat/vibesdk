/** Chat URL that starts a new app from a template; the chat page creates the session. */
export function templateStartPath(input: { templateId: string; description: string; modelId?: string }): string {
	const params = new URLSearchParams();
	params.set('template', input.templateId);
	params.set('query', input.description.trim());
	params.set('projectType', 'app');
	params.set('behaviorType', 'think');
	if (input.modelId) params.set('model', input.modelId);
	return `/chat/new?${params.toString()}`;
}
