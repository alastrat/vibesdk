import type { DraftStart, DraftSummary, DraftsSnapshot } from '@space-do/space';

export type { DraftStart, DraftSummary, DraftsSnapshot };

export interface CreateDraftRequest {
	name: string;
	from: DraftStart;
}

export interface RenameDraftRequest {
	name: string;
}
