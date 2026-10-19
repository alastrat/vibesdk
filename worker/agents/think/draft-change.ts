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

/** The `activeDraft` a draft tool reports, from its JSON string or object output. */
export function activeDraftOf(output: unknown): ActiveDraft | null {
	let parsed: unknown = output;
	if (typeof output === 'string') {
		try {
			parsed = JSON.parse(output);
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const draft = (parsed as { activeDraft?: unknown }).activeDraft;
	return isActiveDraft(draft) ? draft : null;
}
