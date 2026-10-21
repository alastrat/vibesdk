import { msg } from '../../../../shared/i18n/translate';
/** A store's drafts, for its owner: list, start, switch, rename and delete. Publishing stays in the live store controller. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import type { DraftsSnapshot } from '@space-do/space';
import { getAgentStub } from '../../../agents';
import { draftErrorStatus } from '../../../agents/think/draft-change';
import { isFlagOn } from '../../../services/posthog/flags';
import { STORE_DRAFTS_PAUSED_MESSAGE } from '../../../../shared/types/drafts';
import type { CreateDraftRequest, RenameDraftRequest } from './types';

/** Starting and switching drafts go through the agent, which keeps its preview in step; the rest go to SpaceDO. */
interface DraftsSpaceStub {
	listDrafts(): Promise<DraftsSnapshot>;
	renameDraft(id: string, name: string): Promise<{ ok: true } | { error: string }>;
	deleteDraft(id: string): Promise<{ ok: true } | { error: string }>;
}

function spaceOf(env: Env, appId: string): DraftsSpaceStub | null {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	return namespace ? (namespace.get(namespace.idFromName(appId)) as unknown as DraftsSpaceStub) : null;
}

const NAME_REQUIRED = 'Give the draft a name.';

export function parseCreateDraft(body: { name?: unknown; from?: unknown }): CreateDraftRequest | { error: string } {
	if (typeof body.name !== 'string') return { error: NAME_REQUIRED };
	if (body.from !== undefined && body.from !== 'main' && body.from !== 'live') return { error: 'Start the draft from Main or from the live store.' };
	return { name: body.name, from: body.from === 'live' ? 'live' : 'main' };
}

export function parseRenameDraft(body: { name?: unknown }): RenameDraftRequest | { error: string } {
	return typeof body.name === 'string' ? { name: body.name } : { error: NAME_REQUIRED };
}

type DraftsOutcome = { ok: true } | { ok: true; draftId: string } | { error: string; status?: number };

/** The store's snapshot after a change, or the change's refusal with its status. */
export async function draftsResponse(
	outcome: DraftsOutcome,
	snapshot: () => Promise<DraftsSnapshot>,
): Promise<{ data: DraftsSnapshot } | { error: string; status: number }> {
	if ('error' in outcome) return { error: outcome.error, status: outcome.status ?? draftErrorStatus(outcome.error) };
	return { data: await snapshot() };
}

export class DraftsController extends BaseController {
	private static async respond(
		env: Env,
		appId: string | undefined,
		change: (space: DraftsSpaceStub, appId: string) => Promise<DraftsOutcome>,
	): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		if (!appId) return this.createErrorResponse<DraftsSnapshot>(msg('Store not found'), 404);
		const space = spaceOf(env, appId);
		if (!space) return this.createErrorResponse<DraftsSnapshot>(msg("Drafts aren't available right now."), 503);
		try {
			const result = await draftsResponse(await change(space, appId), () => space.listDrafts());
			return 'error' in result ? this.createErrorResponse<DraftsSnapshot>(result.error, result.status) : this.createSuccessResponse(result.data);
		} catch (error) {
			return this.handleError(error, "update the store's drafts") as ControllerResponse<ApiResponse<DraftsSnapshot>>;
		}
	}

	static async list(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		return this.respond(env, context.pathParams.id, async () => ({ ok: true }));
	}

	static async create(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const body = await this.parseJsonBody<{ name?: unknown; from?: unknown }>(request);
		const parsed = parseCreateDraft(body.success && body.data ? body.data : {});
		return this.respond(env, context.pathParams.id, async (_space, appId) => {
			if ('error' in parsed) return { error: parsed.error, status: 400 };
			if (await isFlagOn(env, 'store-drafts-paused', context.user?.id ?? null)) return { error: STORE_DRAFTS_PAUSED_MESSAGE, status: 503 };
			return (await getAgentStub(env, appId)).createDraft(parsed.name, parsed.from);
		});
	}

	static async activate(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (_space, appId) => (await getAgentStub(env, appId)).switchDraft(draftId));
	}

	static async rename(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const body = await this.parseJsonBody<{ name?: unknown }>(request);
		const parsed = parseRenameDraft(body.success && body.data ? body.data : {});
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (space) => {
			if ('error' in parsed) return { error: parsed.error, status: 400 };
			const renamed = await space.renameDraft(draftId, parsed.name);
			return 'error' in renamed ? { error: renamed.error, status: renamed.error === "That draft doesn't exist." ? 404 : 400 } : renamed;
		});
	}

	static async remove(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (space) => space.deleteDraft(draftId));
	}
}
