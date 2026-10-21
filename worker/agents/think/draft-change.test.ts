import { describe, expect, it } from 'vitest';
import { activeDraftOf, cancelledOf, chainDraftChange, deployedCommitOf, DRAFT_SWITCHING_TOOLS, draftErrorStatus } from './draft-change';

describe('activeDraftOf', () => {
	it("reads the draft a tool switched to from its JSON output, so the host's preview follows it", () => {
		const output = JSON.stringify({ activeDraft: { id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' } });
		expect(activeDraftOf(output)).toEqual({ id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' });
		expect(activeDraftOf({ activeDraft: { id: 'main', name: 'Main', branch: 'main' } })).toEqual({ id: 'main', name: 'Main', branch: 'main' });
	});

	it('ignores outputs without a well-formed draft', () => {
		for (const output of ['not json', '{}', JSON.stringify({ activeDraft: { id: 1 } }), null, 42]) {
			expect(activeDraftOf(output)).toBeNull();
		}
	});

	it('lists the tools that can change the active draft', () => {
		expect([...DRAFT_SWITCHING_TOOLS].sort()).toEqual(['bring_in_live_changes', 'create_draft', 'switch_draft']);
	});

	it('answers 404 for a missing draft and 409 for any other refusal', () => {
		expect(draftErrorStatus("That draft doesn't exist.")).toBe(404);
		expect(draftErrorStatus("Couldn't save your work before switching. Try again.")).toBe(409);
	});
});

describe('deployedCommitOf', () => {
	it('reads the commit a switching tool deployed, from its JSON string or object output', () => {
		const switched = { activeDraft: { id: 'main', name: 'Main', branch: 'main' }, deploy: { preview_url: 'https://p', commit_hash: 'c0ffee1' } };
		expect(deployedCommitOf(JSON.stringify(switched))).toBe('c0ffee1');
		expect(deployedCommitOf(switched)).toBe('c0ffee1');
		expect(deployedCommitOf({ result: 'merged', commit: 'abc1234', deploy: { commit_hash: 'abc1234' } })).toBe('abc1234');
	});

	it("has none when the tool didn't deploy or the build failed", () => {
		const draft = { id: 'main', name: 'Main', branch: 'main' };
		for (const output of [
			JSON.stringify({ activeDraft: draft }),
			{ activeDraft: draft, deploy: { error: 'Build failed', commit_hash: 'c0ffee1' } },
			{ activeDraft: draft, deploy: { error: 'Deploy failed: reset' } },
			'not json',
			null,
		]) {
			expect(deployedCommitOf(output)).toBeNull();
		}
	});
});

describe('cancelledOf', () => {
	it('reads whether cancelling put the draft back', () => {
		expect(cancelledOf(JSON.stringify({ cancelled: true }))).toBe(true);
		expect(cancelledOf({ cancelled: false })).toBe(false);
		expect(cancelledOf('not json')).toBe(false);
	});
});

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('chainDraftChange', () => {
	it("starts a change only after the one before it finishes, so two switches never apply to the store at once", async () => {
		const events: string[] = [];
		const first = deferred();
		const a = chainDraftChange(null, async () => {
			events.push('a start');
			await first.promise;
			events.push('a end');
			return 'a';
		});
		const b = chainDraftChange(a, async () => {
			events.push('b start');
			return 'b';
		});
		await settle();
		expect(events).toEqual(['a start']);
		first.resolve();
		expect(await b).toBe('b');
		expect(await a).toBe('a');
		expect(events).toEqual(['a start', 'a end', 'b start']);
	});

	it('still runs a change after the one before it failed', async () => {
		const first = deferred();
		const a = chainDraftChange(null, () => first.promise);
		const b = chainDraftChange(a, async () => 'b ran');
		first.reject(new Error('boom'));
		await expect(a).rejects.toThrow('boom');
		await expect(b).resolves.toBe('b ran');
	});

	it('starts straight away when nothing is pending', async () => {
		const events: string[] = [];
		const pending = deferred();
		const run = chainDraftChange(null, async () => {
			events.push('start');
			await pending.promise;
		});
		await settle();
		expect(events).toEqual(['start']);
		pending.resolve();
		await run;
	});
});
