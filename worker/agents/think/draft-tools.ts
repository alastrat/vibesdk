/**
 * Drafts for the AI: versions of the store with their own previews. The tools talk to the SpaceDO directly, run in
 * order with the AI's other tools, and report `activeDraft` after a switch so the host's preview follows it.
 * Publishing stays the seller's click: there is no publish tool.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { ActiveDraft, BringInOutcome, DraftSummary } from '@space-do/space';
import { STORE_DRAFTS_PAUSED_MESSAGE } from '../../../shared/types/drafts';
import { withDurableObjectResetRetry, type SpaceWorkspaceStub } from './space-workspace-ops';

type GetStub = () => SpaceWorkspaceStub;

export type DraftToolName = 'list_drafts' | 'create_draft' | 'switch_draft' | 'bring_in_live_changes' | 'cancel_bringing_in_live_changes';

type Conflicts = Extract<BringInOutcome, { result: 'conflicts' }>;

const MARKED_FILES = [
	"The files in `files` have conflict markers. Each conflict has a line starting `<<<<<<<` followed by a name, this draft's version,",
	"a line `=======`, the live store's version, then a line starting `>>>>>>>` followed by a code.",
	"Keep this draft's changes and the live store's fix. Remove all three marker lines. Never repeat the names or codes on those lines to the seller.",
].join(' ');
const DELETED_BY_DRAFT =
	"The files in `deletedByDraft` were deleted from this draft, but the live store changed them. They hold the live store's version for now: decide whether to keep the file or delete it.";
const DELETED_BY_LIVE =
	"The files in `deletedByLive` were deleted from the live store, but this draft changed them. They hold this draft's version for now: decide whether to keep the file or delete it.";
const FINISH_IN_THIS_TURN =
	'Finish or cancel within this turn, and do not call ask_questions meanwhile: an unfinished one is cancelled when your turn ends.';
const THEN_DEPLOY = [
	'Then call deploy_space. If the build fails, fix it and deploy again.',
	'If you cannot get a clean build, call cancel_bringing_in_live_changes and tell the seller what blocked it.',
	FINISH_IN_THIS_TURN,
].join(' ');
const BINARY_ON_BOTH_SIDES = [
	'Nothing was brought in and the draft is unchanged.',
	'The files in `files` (images or fonts) changed in this draft and in the live store, and cannot be combined.',
	'Tell the seller which files they are and that they should replace them in one version first.',
].join(' ');
/** File edits in the same step run in no fixed order around the change, so they can land in either draft. */
const ON_ITS_OWN = 'Call this on its own, never in the same step as file edits.';
const BUILD_FAILED = [
	"The live store's changes are in this draft, but it did not build.",
	'Fix the build and call deploy_space again, or call cancel_bringing_in_live_changes and tell the seller what blocked it.',
	FINISH_IN_THIS_TURN,
].join(' ');

function statusOf(draft: DraftSummary): string[] {
	if (draft.bringingInLiveChanges) return ['bringing in live changes'];
	if (draft.live) return ['live'];
	const status: string[] = [];
	if (draft.unpublishedChanges) status.push('unpublished changes');
	if (draft.behindLive) status.push('behind the live store');
	return status;
}

function startedFromOf(draft: DraftSummary): string {
	return draft.startedFrom === 'live' ? 'the live store' : 'Main';
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function conflictGuidance(outcome: Conflicts): string {
	const steps: string[] = [];
	if (outcome.files.length > 0) steps.push(MARKED_FILES);
	if (outcome.deletedByDraft.length > 0) steps.push(DELETED_BY_DRAFT);
	if (outcome.deletedByLive.length > 0) steps.push(DELETED_BY_LIVE);
	steps.push(THEN_DEPLOY);
	return steps.join(' ');
}

function deployFailed(deploy: unknown): boolean {
	return typeof deploy === 'object' && deploy !== null && Boolean((deploy as { error?: unknown }).error);
}

/** What the AI does next, when the outcome leaves work for it; null when the draft is finished. */
function guidanceFor(outcome: BringInOutcome): string | null {
	if ('error' in outcome) return null;
	switch (outcome.result) {
		case 'conflicts':
			return conflictGuidance(outcome);
		case 'binary-changed-on-both-sides':
			return BINARY_ON_BOTH_SIDES;
		case 'fast-forward':
		case 'merged':
			return deployFailed(outcome.deploy) ? BUILD_FAILED : null;
		case 'up-to-date':
			return null;
	}
}

async function findDraft(getStub: GetStub, name: string | undefined): Promise<DraftSummary | { error: string }> {
	const { drafts } = await withDurableObjectResetRetry(getStub, (stub) => stub.listDrafts());
	if (name === undefined || name.trim() === '') {
		return drafts.find((draft) => draft.active) ?? drafts[0] ?? { error: 'This store has no drafts yet.' };
	}
	const wanted = name.trim().toLowerCase();
	return drafts.find((draft) => draft.name.toLowerCase() === wanted) ?? { error: `There's no draft named '${name.trim()}'.` };
}

/**
 * Switches to the draft and deploys its preview when stale, in order with the AI's other tools. A deploy that
 * throws still reports the switch, so the host follows the draft that is now checked out.
 */
async function activate(getStub: GetStub, id: string): Promise<{ activeDraft: ActiveDraft; deploy?: unknown } | { error: string }> {
	const result = await withDurableObjectResetRetry(getStub, (stub) => stub.activateDraft(id));
	if ('error' in result) return result;
	if (!result.previewStale) return { activeDraft: result.draft };
	try {
		const deploy = await withDurableObjectResetRetry(getStub, (stub) => stub.deploy(result.draft.branch));
		return { activeDraft: result.draft, deploy };
	} catch (error) {
		return { activeDraft: result.draft, deploy: { error: `Deploy failed: ${messageOf(error)}` } };
	}
}

/** `draftsPaused` answers whether starting new drafts is paused; drafts that exist keep working. */
export function createDraftTools(opts: { getStub: GetStub; draftsPaused: () => Promise<boolean> }): Record<DraftToolName, Tool> {
	const { getStub, draftsPaused } = opts;
	return {
		list_drafts: tool({
			description: "List the store's drafts: versions of the store, each with its own preview. Shows which one you are editing and how each compares with the live store.",
			inputSchema: z.object({}),
			execute: async () => {
				const snapshot = await withDurableObjectResetRetry(getStub, (stub) => stub.listDrafts());
				return JSON.stringify({
					published: snapshot.published,
					limit: snapshot.limit,
					drafts: snapshot.drafts.map((draft) => ({ name: draft.name, startedFrom: startedFromOf(draft), editing: draft.active, status: statusOf(draft) })),
				});
			},
		}),
		create_draft: tool({
			description: [
				'Start a new draft and switch to it. from "main" copies Main; from "live" copies the live store, for a quick fix that can be published alone while Main keeps unpublished work.',
				"Suggest a quick fix only when you're editing Main, it has unpublished changes, and the seller asks for a small change to the live store.",
				"If you're already editing another draft, make the change in that draft: never start a new draft unless the seller asks or you're on Main.",
				ON_ITS_OWN,
			].join(' '),
			inputSchema: z.object({
				name: z.string().describe('Short name the seller will see, e.g. "Typo fix".'),
				from: z.enum(['main', 'live']).describe('Where the draft starts.'),
			}),
			execute: async (args: { name: string; from: 'main' | 'live' }) => {
				if (await draftsPaused()) return `${STORE_DRAFTS_PAUSED_MESSAGE} Keep working in the current draft.`;
				const created = await withDurableObjectResetRetry(getStub, (stub) => stub.createDraft(args.name, args.from));
				if ('error' in created) return JSON.stringify(created);
				return JSON.stringify(await activate(getStub, created.id));
			},
		}),
		switch_draft: tool({
			description: `Switch to another draft by its name. Your edits then go to that draft, and the preview shows it. ${ON_ITS_OWN}`,
			inputSchema: z.object({ draft: z.string().describe("The draft's name.") }),
			execute: async (args: { draft: string }) => {
				const draft = await findDraft(getStub, args.draft);
				if ('error' in draft) return JSON.stringify(draft);
				return JSON.stringify(await activate(getStub, draft.id));
			},
		}),
		bring_in_live_changes: tool({
			description: [
				"Bring the live store's changes into a draft (the one you are editing by default), for a draft that is behind the live store. Never call it unless the seller asks.",
				'When it returns conflicts, follow its `next` text, and finish with deploy_space or cancel_bringing_in_live_changes in the same turn.',
				ON_ITS_OWN,
			].join(' '),
			inputSchema: z.object({ draft: z.string().optional().describe("The draft's name; defaults to the one you are editing.") }),
			execute: async (args: { draft?: string }) => {
				const draft = await findDraft(getStub, args.draft);
				if ('error' in draft) return JSON.stringify(draft);
				let activeDraft: ActiveDraft;
				if (draft.active) {
					activeDraft = await withDurableObjectResetRetry(getStub, (stub) => stub.getActiveDraft());
				} else {
					const switched = await activate(getStub, draft.id);
					if ('error' in switched) return JSON.stringify(switched);
					activeDraft = switched.activeDraft;
				}
				let outcome: BringInOutcome;
				try {
					outcome = await withDurableObjectResetRetry(getStub, (stub) => stub.bringInLiveChanges(draft.id));
				} catch (error) {
					outcome = { error: `Bringing in the live store's changes failed: ${messageOf(error)}` };
				}
				const next = guidanceFor(outcome);
				return JSON.stringify({
					...outcome,
					...(next ? { next } : {}),
					activeDraft: { id: activeDraft.id, name: activeDraft.name, branch: activeDraft.branch },
				});
			},
		}),
		cancel_bringing_in_live_changes: tool({
			description: "Cancel bringing in the live store's changes. The draft goes back to how it was before.",
			inputSchema: z.object({}),
			execute: async () => JSON.stringify(await withDurableObjectResetRetry(getStub, (stub) => stub.cancelBringingInLiveChanges())),
		}),
	};
}
