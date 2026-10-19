/** Switching drafts from the API and from the AI's tools: their shared result, refusals and tool-output parsing. */
import type { ActiveDraft } from '@space-do/space';

export type DraftChangeResult = { ok: true; draftId: string } | { error: string; status: 400 | 404 | 409 };

export const DRAFT_BUSY_MESSAGE = 'Wait for the AI to finish, then switch drafts.';
const MISSING_DRAFT = "That draft doesn't exist.";

/** Tools whose output names the draft now checked out. */
export const DRAFT_SWITCHING_TOOLS: ReadonlySet<string> = new Set(['create_draft', 'switch_draft', 'bring_in_live_changes']);

export function draftErrorStatus(error: string): 404 | 409 {
	return error === MISSING_DRAFT ? 404 : 409;
}

function isActiveDraft(value: unknown): value is ActiveDraft {
	if (!value || typeof value !== 'object') return false;
	const draft = value as Record<string, unknown>;
	return typeof draft.id === 'string' && typeof draft.name === 'string' && typeof draft.branch === 'string';
}

/** A tool's JSON string or object output as an object, or null. */
function outputObject(output: unknown): Record<string, unknown> | null {
	let parsed: unknown = output;
	if (typeof output === 'string') {
		try {
			parsed = JSON.parse(output);
		} catch {
			return null;
		}
	}
	return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
}

/** The `activeDraft` a draft tool reports, from its JSON string or object output. */
export function activeDraftOf(output: unknown): ActiveDraft | null {
	const draft = outputObject(output)?.activeDraft;
	return isActiveDraft(draft) ? draft : null;
}

/** The commit a draft tool's own deploy built, or null when it didn't deploy or the build failed. */
export function deployedCommitOf(output: unknown): string | null {
	const deploy = outputObject(output)?.deploy;
	if (!deploy || typeof deploy !== 'object') return null;
	const { error, commit_hash: commit } = deploy as { error?: unknown; commit_hash?: unknown };
	return error === undefined && typeof commit === 'string' ? commit : null;
}

/** Whether cancelling the bring-in of the live store's changes reports that it put the draft back. */
export function cancelledOf(output: unknown): boolean {
	return outputObject(output)?.cancelled === true;
}

/** Runs `change` once `previous` has settled, pass or fail, so draft changes never overlap on the host. */
export function chainDraftChange<T>(previous: Promise<unknown> | null, change: () => Promise<T>): Promise<T> {
	const settled = previous ? previous.then(() => undefined, () => undefined) : Promise.resolve();
	return settled.then(change);
}
