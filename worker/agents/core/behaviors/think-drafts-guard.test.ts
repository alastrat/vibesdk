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

	it('cancels a leftover merge before creating a draft, only while the AI is idle', () => {
		const body = methodBody(think, 'async createDraft(');
		const cancel = body.indexOf('await this.cancelUnfinishedMerge()');
		expect(cancel).toBeGreaterThan(body.indexOf('this.isCodeGenerating()'));
		expect(cancel).toBeLessThan(body.indexOf('space.createDraft(name, from)'));
	});

	it('cancels a leftover merge for a publish only while the AI is idle', () => {
		const body = methodBody(think, 'async cancelLeftoverMerge(');
		expect(body).toContain('if (this.isCodeGenerating()) return;');
		expect(body.indexOf('this.isCodeGenerating()')).toBeLessThan(body.indexOf('this.cancelUnfinishedMerge()'));
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain('async cancelLeftoverMerge(): Promise<void>');
		expect(methodBody(agent.replace(/\n {4}/g, '\n\t'), 'async cancelLeftoverMerge(')).toContain('this.behavior.cancelLeftoverMerge()');
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
		expect(body).toContain("Now working on '{value1}'.");
		expect(body).toContain('value1: String(draft.name)');
		expect(body).toContain('.setPreviewUrl(await this.getBrowserPreviewURL())');
		expect(body).not.toContain('configureThinkAgent(');
	});

	it("moves the agent's console check to the new draft without re-rendering its prompt, and only logs when that fails", () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		expect(body).toMatch(/try \{\s*await \(await this\.getThinkStub\(\)\)\.setPreviewUrl\([^)]*\)[^)]*\);\s*\} catch \(error\) \{\s*this\.logger\.warn\(/);
		expect(body.indexOf('currentBranch: draft.branch')).toBeLessThan(body.indexOf('.setPreviewUrl('));
		expect(think).toContain('setPreviewUrl: (previewUrl: string) => Promise<void>;');
	});

	it("gives the console check's preview address the app's current preview version, so it keeps working after a visibility toggle", () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		const call = body.slice(body.indexOf('.setPreviewUrl('), body.indexOf(';', body.indexOf('.setPreviewUrl(')));
		expect(call).toContain('getBrowserPreviewURL()');
		expect(call).not.toContain('getBrowserPreviewURL(0)');
	});

	it('shows the new draft in the preview even when its rebuild fails', () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		const deployed = body.search(/const deployed = deployPreview \? await this\.deployCurrentBranch\(\) : null;\s*if \(!deployed\) \{[^}]*DEPLOYMENT_COMPLETED[^}]*getBrowserPreviewURL\(\)/);
		expect(deployed).toBeGreaterThan(-1);
	});

	it("records the new draft's deployed commit when the host didn't deploy it, so a snapshot matches the preview", () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		const lookup = body.indexOf('space.getStoreManifest(draft.branch)');
		expect(lookup).toBeGreaterThan(-1);
		expect(body.indexOf('this.recordDeployedCommit(', lookup)).toBeGreaterThan(lookup);
		expect(think).toContain('getStoreManifest: (branch: string) => Promise<{ commitHash: string; manifest: string | null } | null>;');
	});

	it('records the commit a switching tool deployed', () => {
		expect(think).toMatch(/const draft = activeDraftOf\(output\);\s*if \(draft\) await this\.applyActiveDraft\(draft, false, deployedCommitOf\(output\)\);/);
	});

	it("rebuilds the Code tab's copy of the files whenever the draft's files change under it", () => {
		expect(methodBody(think, 'private async applyActiveDraft(')).toContain('await this.rebuildFileMirror()');
		expect(methodBody(think, 'private async cancelUnfinishedMerge(')).toMatch(/if \(!cancelled\) return;[\s\S]*await this\.rebuildFileMirror\(\)/);
		expect(think).toMatch(/toolName === 'cancel_bringing_in_live_changes'\)[\s\S]{0,200}await this\.rebuildFileMirror\(\)/);
		const rebuild = methodBody(think, 'private async rebuildFileMirror(');
		for (const part of ['space.list()', 'selectMirrorFiles(', 'space.readFileBytes(', 'rebuildMirror(this.state.generatedFilesMap', 'generatedFilesMap: map', 'WebSocketMessageResponses.FILE_DELETED', 'WebSocketMessageResponses.FILE_GENERATED']) {
			expect(rebuild, part).toContain(part);
		}
	});

	it('follows the draft a tool switched to without deploying from the host mid-turn', () => {
		expect(think).toContain('DRAFT_SWITCHING_TOOLS.has(toolName)');
		expect(think).toMatch(/activeDraftOf\(output\)[\s\S]{0,200}applyActiveDraft\(draft, false[,)]/);
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
