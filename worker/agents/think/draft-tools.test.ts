import { describe, expect, it } from 'vitest';
import type { BringInOutcome, DraftsSnapshot } from '@space-do/space';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import { createDraftTools } from './draft-tools';
import type { SpaceWorkspaceStub } from './space-workspace-ops';
import SKILL from './skills/store-drafts/SKILL.md?raw';
import APP_FILE_STRUCTURE from './skills/app-file-structure/SKILL.md?raw';

const skills = import.meta.glob<string>('/worker/agents/think/skills.ts', { query: '?raw', import: 'default', eager: true });
const agents = import.meta.glob<string>('/worker/agents/think/ThinkAgent.ts', { query: '?raw', import: 'default', eager: true });

type Execute = (args: Record<string, unknown>, options: { toolCallId: string; messages: [] }) => Promise<string>;

const DRAFTS: DraftsSnapshot = {
	activeDraftId: 'main',
	published: true,
	limit: 5,
	drafts: [
		{ id: 'main', name: 'Main', startedFrom: 'main', updatedAt: 1, active: true, live: false, publishedFromHere: false, unpublishedChanges: true, behindLive: true, bringingInLiveChanges: false },
		{ id: 'k3x9q2mf', name: 'Typo fix', startedFrom: 'live', updatedAt: 2, active: false, live: true, publishedFromHere: true, unpublishedChanges: false, behindLive: false, bringingInLiveChanges: false },
	],
};

const GIT_WORDS = /branch|merge|commit|git/i;

function harness(overrides: Partial<Record<string, unknown>> = {}) {
	const calls: string[] = [];
	const conflicts: BringInOutcome = { result: 'conflicts', files: ['about.html'], deletedByDraft: [], deletedByLive: [], liveChanges: ['Fix the typo'] };
	const stub = {
		listDrafts: async () => DRAFTS,
		getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' }),
		createDraft: async (name: string, from: string) => (calls.push(`create ${name} ${from}`), { id: 'n3wdraft', name }),
		activateDraft: async (id: string) => (calls.push(`activate ${id}`), { draft: { id, name: id === 'main' ? 'Main' : 'Typo fix', branch: id === 'main' ? 'main' : `draft-${id}` }, previewStale: true }),
		deploy: async (branch: string) => (calls.push(`deploy ${branch}`), { preview_url: `/space/s/preview/${branch}/` }),
		bringInLiveChanges: async (id: string) => (calls.push(`bring ${id}`), conflicts),
		cancelBringingInLiveChanges: async () => (calls.push('cancel'), { cancelled: true }),
		...overrides,
	} as unknown as SpaceWorkspaceStub;
	const tools = createDraftTools({ getStub: () => stub });
	const run = async (name: keyof typeof tools, args: Record<string, unknown> = {}) =>
		JSON.parse(await (tools[name].execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] }));
	return { calls, run };
}

describe('draft tools', () => {
	it('lists drafts in plain words, with the one being edited', async () => {
		const { run } = harness();
		const listed = await run('list_drafts');
		expect(listed.drafts).toEqual([
			{ name: 'Main', startedFrom: 'Main', editing: true, status: ['unpublished changes', 'behind the live store'] },
			{ name: 'Typo fix', startedFrom: 'the live store', editing: false, status: ['live'] },
		]);
		expect(JSON.stringify(listed)).not.toMatch(/branch|draft-k3x9q2mf/);
	});

	it('says to edit the draft the AI is already in, and to start a quick fix only from Main', async () => {
		const rule = /already editing another draft/i;
		const skill = SKILL.replace(/\s+/g, ' ');
		const description = createDraftTools({ getStub: () => ({}) as SpaceWorkspaceStub }).create_draft.description ?? '';
		expect(description).toMatch(rule);
		expect(description).not.toMatch(GIT_WORDS);
		expect(skill).toMatch(rule);
		expect(skill).toContain("If you're editing Main and it has unpublished changes, start a quick fix from the live store for a small change");
		expect(skill).toContain("If you're already editing another draft, make the change in that draft");
		expect(skill).toContain("never start a new draft unless the seller asks or you're on Main");
	});

	it('starts a draft and switches to it, deploying its preview', async () => {
		const { calls, run } = harness();
		const result = await run('create_draft', { name: 'Spring sale', from: 'main' });
		expect(calls).toEqual(['create Spring sale main', 'activate n3wdraft', 'deploy draft-n3wdraft']);
		expect(result.activeDraft).toMatchObject({ id: 'n3wdraft' });
	});

	it('passes on a refusal to start a draft and switches nowhere', async () => {
		const { calls, run } = harness({ createDraft: async () => ({ error: 'A store has up to 5 drafts.' }) });
		expect(await run('create_draft', { name: 'Sixth', from: 'main' })).toEqual({ error: 'A store has up to 5 drafts.' });
		expect(calls).toEqual([]);
	});

	it('switches by name, ignoring case', async () => {
		const { calls, run } = harness();
		const result = await run('switch_draft', { draft: 'typo FIX' });
		expect(calls).toEqual(['activate k3x9q2mf', 'deploy draft-k3x9q2mf']);
		expect(result.activeDraft.name).toBe('Typo fix');
		expect((await run('switch_draft', { draft: 'Nope' })).error).toBe("There's no draft named 'Nope'.");
	});

	it('deploys nothing when the draft it switches to already has its preview', async () => {
		const { calls, run } = harness({
			activateDraft: async (id: string) => (calls.push(`activate ${id}`), { draft: { id, name: 'Typo fix', branch: `draft-${id}` }, previewStale: false }),
		});
		const result = await run('switch_draft', { draft: 'Typo fix' });
		expect(calls).toEqual(['activate k3x9q2mf']);
		expect(result.activeDraft).toMatchObject({ id: 'k3x9q2mf' });
	});

	it('brings live changes into the draft being edited and hands back the conflicts to resolve', async () => {
		const { calls, run } = harness();
		const result = await run('bring_in_live_changes', {});
		expect(calls).toEqual(['bring main']);
		expect(result.result).toBe('conflicts');
		expect(result.files).toEqual(['about.html']);
		expect(result.next).toContain('cancel_bringing_in_live_changes');
		expect(result.next).toContain('deploy_space');
		expect(result.next).toContain('ask_questions');
		expect(result.next).not.toMatch(GIT_WORDS);
		expect(result.activeDraft).toMatchObject({ id: 'main' });
	});

	it('describes the markers as they really look: a name and a code the seller must never hear', async () => {
		const result = await harness().run('bring_in_live_changes', {});
		for (const wrong of ['<<<<<<< draft', '>>>>>>> live']) expect(result.next).not.toContain(wrong);
		for (const line of ['<<<<<<<', '=======', '>>>>>>>', 'Remove all three marker lines', 'Never repeat the names or codes']) {
			expect(result.next).toContain(line);
		}
	});

	it('switches first when asked to bring changes into another draft', async () => {
		const { calls, run } = harness();
		await run('bring_in_live_changes', { draft: 'Typo fix' });
		expect(calls).toEqual(['activate k3x9q2mf', 'deploy draft-k3x9q2mf', 'bring k3x9q2mf']);
	});

	it('tells the AI to decide on files one side deleted and the other changed', async () => {
		const outcome: BringInOutcome = { result: 'conflicts', files: [], deletedByDraft: ['legacy.html'], deletedByLive: ['old.html'], liveChanges: ['Update legacy page'] };
		const { run } = harness({ bringInLiveChanges: async () => outcome });
		const result = await run('bring_in_live_changes', {});
		expect(result.deletedByDraft).toEqual(['legacy.html']);
		expect(result.deletedByLive).toEqual(['old.html']);
		expect(result.next).toContain('deletedByDraft');
		expect(result.next).toContain('deletedByLive');
		expect(result.next).toContain('keep the file or delete it');
		expect(result.next).toContain('deploy_space');
		expect(result.next).not.toContain('conflict markers');
		expect(result.next).not.toMatch(GIT_WORDS);
	});

	it('covers marked files and deletions together', async () => {
		const outcome: BringInOutcome = { result: 'conflicts', files: ['about.html'], deletedByDraft: ['legacy.html'], deletedByLive: [], liveChanges: [] };
		const { run } = harness({ bringInLiveChanges: async () => outcome });
		const result = await run('bring_in_live_changes', {});
		expect(result.next).toContain('conflict markers');
		expect(result.next).toContain('deletedByDraft');
		expect(result.next).not.toContain('deletedByLive');
	});

	it('refuses to combine images and fonts changed on both sides, and tells the AI to ask the seller', async () => {
		const outcome: BringInOutcome = { result: 'binary-changed-on-both-sides', files: ['logo.png'] };
		const { run } = harness({ bringInLiveChanges: async () => outcome });
		const result = await run('bring_in_live_changes', {});
		expect(result.result).toBe('binary-changed-on-both-sides');
		expect(result.files).toEqual(['logo.png']);
		expect(result.next).toContain('replace them in one version first');
		expect(result.next).not.toContain('deploy_space');
		expect(result.next).not.toMatch(GIT_WORDS);
		expect(result.activeDraft).toMatchObject({ id: 'main' });
	});

	it('hands back a failed build after a clean bring-in, which is cancelled when the turn ends', async () => {
		const outcome: BringInOutcome = { result: 'merged', commit: 'abc', deploy: { error: 'Build failed' } };
		const { run } = harness({ bringInLiveChanges: async () => outcome });
		const result = await run('bring_in_live_changes', {});
		expect(result.next).toContain('deploy_space');
		expect(result.next).toContain('cancel_bringing_in_live_changes');
		expect(result.next).not.toMatch(GIT_WORDS);

		for (const clean of [{ result: 'up-to-date' }, { result: 'fast-forward', commit: 'abc', deploy: { preview_url: '/p/' } }, { result: 'merged', commit: 'abc', deploy: { preview_url: '/p/' } }]) {
			const done = await harness({ bringInLiveChanges: async () => clean }).run('bring_in_live_changes', {});
			expect(done).not.toHaveProperty('next');
		}
	});

	it('still reports the switch when the preview deploy throws, so the host follows the draft now checked out', async () => {
		const { run } = harness({ deploy: async () => { throw new Error('Deploy engine down'); } });
		const result = await run('switch_draft', { draft: 'Typo fix' });
		expect(result.activeDraft).toMatchObject({ id: 'k3x9q2mf' });
		expect(result.deploy.error).toContain('Deploy engine down');
	});

	it('still reports the switch when bringing changes in throws after switching', async () => {
		const { run } = harness({ bringInLiveChanges: async () => { throw new Error('Store unavailable'); } });
		const result = await run('bring_in_live_changes', { draft: 'Typo fix' });
		expect(result.error).toContain('Store unavailable');
		expect(result.activeDraft).toMatchObject({ id: 'k3x9q2mf' });
	});

	it('passes on a refusal to bring changes in', async () => {
		const { run } = harness({ bringInLiveChanges: async () => ({ error: "Your store isn't published yet." }) });
		const result = await run('bring_in_live_changes', {});
		expect(result.error).toBe("Your store isn't published yet.");
		expect(result.activeDraft).toMatchObject({ id: 'main' });
	});

	it('cancels bringing changes in', async () => {
		const { calls, run } = harness();
		expect(await run('cancel_bringing_in_live_changes')).toEqual({ cancelled: true });
		expect(calls).toEqual(['cancel']);
	});
});

describe('the store drafts skill and its wiring', () => {
	it('is registered with the agent, which gets the draft tools after deploy_space', () => {
		expect(Object.values(skills)[0]).toContain("'store-drafts': STORE_DRAFTS");
		expect(SKILL).toMatch(/^---\nname: store-drafts\ndescription: .+\n---/);
		const agent = Object.values(agents)[0] ?? '';
		expect(agent).toContain('...createDraftTools({ getStub: () => this.getSpaceStub() })');
		expect(agent.indexOf('deploy_space: createDeploySpaceTool')).toBeLessThan(agent.indexOf('...createDraftTools('));
	});

	it('teaches every draft tool and every way bringing in live changes ends', () => {
		for (const name of ['list_drafts', 'create_draft', 'switch_draft', 'bring_in_live_changes', 'cancel_bringing_in_live_changes', 'deploy_space', 'ask_questions']) {
			expect(SKILL).toContain(name);
		}
		for (const outcome of ['up-to-date', 'fast-forward', 'merged', 'conflicts', 'deletedByDraft', 'deletedByLive', 'binary-changed-on-both-sides']) {
			expect(SKILL).toContain(outcome);
		}
		expect(SKILL).toContain('within the same turn');
	});

	it('describes the markers as they really look: a name and a code the seller must never hear', () => {
		for (const wrong of ['<<<<<<< draft', '>>>>>>> live']) expect(SKILL).not.toContain(wrong);
		for (const line of ['<<<<<<<', '=======', '>>>>>>>', 'Remove all three marker lines', 'Never repeat the names or codes']) {
			expect(SKILL).toContain(line);
		}
	});

	it('leaves the deploy skill telling the AI to deploy with no argument, since another draft is refused', () => {
		expect(APP_FILE_STRUCTURE).not.toContain('deploy_space("main")');
		expect(APP_FILE_STRUCTURE).not.toContain('deploy_space(branch)');
		expect(APP_FILE_STRUCTURE).not.toMatch(/deploy_space\(\s*["'`]?\w+/);
		expect(APP_FILE_STRUCTURE).toContain('deploys the draft you are editing');
	});

	it('never names an AI assistant or a supplier', () => {
		const text = SKILL.toLowerCase();
		for (const name of [...AI_ASSISTANT_NAMES, ...SUPPLIER_NAMES]) expect(text).not.toContain(name);
	});
});
