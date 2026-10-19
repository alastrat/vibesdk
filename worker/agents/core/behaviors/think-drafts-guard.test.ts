import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/core/behaviors/think.ts', '/worker/agents/core/codingAgent.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function methodBody(text: string, signature: string): string {
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	return text.slice(start, text.indexOf('\n\t}\n', start));
}

describe('the Think host and drafts', () => {
	const think = source('/worker/agents/core/behaviors/think.ts');

	it('refuses to switch while the AI works, and cancels a leftover merge before switching', () => {
		const body = methodBody(think, 'async switchDraft(');
		expect(body.indexOf('this.isCodeGenerating()')).toBeLessThan(body.indexOf('space.activateDraft(draftId)'));
		expect(body.indexOf('space.cancelBringingInLiveChanges()')).toBeLessThan(body.indexOf('space.activateDraft(draftId)'));
		expect(body).toContain('this.runDraftChange(');
	});

	it('claims a switch in the same step as it checks that the AI is idle', () => {
		const body = methodBody(think, 'async switchDraft(');
		const between = body.slice(body.indexOf('this.isCodeGenerating()'), body.indexOf('this.runDraftChange('));
		expect(between).not.toContain('await');
	});

	it('runs switches one after another on the host', () => {
		const body = methodBody(think, 'private async runDraftChange<T>(');
		expect(body).toContain('chainDraftChange(this.draftChange, change)');
		expect(body).toContain('if (this.draftChange === run) this.draftChange = null;');
	});

	it('points the preview and the agent at the new draft, deploying it only when stale', () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		expect(body).toContain('currentBranch: draft.branch');
		expect(body).toContain('await this.deployCurrentBranch()');
		expect(body).toContain('WebSocketMessageResponses.DEPLOYMENT_COMPLETED');
		expect(body).toContain("`Now working on '${draft.name}'.`");
		expect(body).toContain('.setPreviewUrl(await this.getBrowserPreviewURL(0))');
		expect(body).not.toContain('configureThinkAgent(');
	});

	it("moves the agent's console check to the new draft without re-rendering its prompt, and only logs when that fails", () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		expect(body).toMatch(/try \{\s*await \(await this\.getThinkStub\(\)\)\.setPreviewUrl\([^)]*\)[^)]*\);\s*\} catch \(error\) \{\s*this\.logger\.warn\(/);
		expect(body.indexOf('currentBranch: draft.branch')).toBeLessThan(body.indexOf('.setPreviewUrl('));
		expect(think).toContain('setPreviewUrl: (previewUrl: string) => Promise<void>;');
	});

	it('shows the new draft in the preview even when its rebuild fails', () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		const deployed = body.search(/const deployed = deployPreview \? await this\.deployCurrentBranch\(\) : null;\s*if \(!deployed\) \{[^}]*DEPLOYMENT_COMPLETED[^}]*getBrowserPreviewURL\(\)/);
		expect(deployed).toBeGreaterThan(-1);
	});

	it('follows the draft a tool switched to without deploying from the host mid-turn', () => {
		expect(think).toContain('DRAFT_SWITCHING_TOOLS.has(toolName)');
		expect(think).toMatch(/activeDraftOf\(output\)[\s\S]{0,200}applyActiveDraft\(draft, false\)/);
	});

	it('makes a turn wait for a switch, and never lets a merge outlive its turn', () => {
		const build = methodBody(think, 'async build(');
		expect(build).toContain('await this.draftChange');
		expect(build.indexOf('await this.cancelUnfinishedMerge()')).toBeLessThan(build.indexOf('while (this.state.pendingUserInputs.length > 0)'));
		const runPrompt = methodBody(think, 'private async runPrompt(');
		expect(runPrompt).toContain('await this.cancelUnfinishedMerge()');
	});

	it('only reports a rollback as done when the store accepted it', () => {
		const body = methodBody(think, 'async rollbackToCommit(');
		const check = body.search(/const deployed = await this\.handleDeploySpaceOutput\(output\);\s*if \(!deployed\) return;/);
		expect(check).toBeGreaterThan(-1);
		expect(check).toBeLessThan(body.indexOf('and redeployed.'));
		expect(check).toBeLessThan(body.indexOf('this.captureDeployedScreenshot()'));
	});

	it('makes a rollback wait for a switch in flight before it reads the branch', () => {
		const body = methodBody(think, 'async rollbackToCommit(');
		const wait = body.indexOf('await this.draftChange');
		expect(wait).toBeGreaterThan(body.indexOf('this.isCodeGenerating()'));
		expect(wait).toBeLessThan(body.indexOf('this.state.currentBranch'));
	});

	it('exposes switching and creating drafts on the agent for the drafts API', () => {
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain('async switchDraft(draftId: string): Promise<DraftChangeResult>');
		expect(agent).toContain('async createDraft(name: string, from: DraftStart): Promise<DraftChangeResult>');
	});
});
