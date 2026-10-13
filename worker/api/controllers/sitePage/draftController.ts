/** AI drafts of product page text for a site's owner. Nothing is saved; the publish dialog saves edited text. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService } from '../../../database';
import { getAgentStubLightweight, getSpaceTemplateStub } from '../../../agents';
import { executeInference } from '../../../agents/inferutils/infer';
import type { InferenceContext } from '../../../agents/inferutils/config.types';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { NOT_DEPLOYED_REASON } from '../../../services/templates/reuse';
import { PAGE_DRAFT_FAILED_MESSAGE } from '../../../../shared/types/site-page';
import { PageCopyDraftError, PageCopyDraftSchema, draftPageCopy, type PageCopyCompleter } from '../../../services/site-pages/draft';
import type { PageCopyDraftData } from './types';

const DRAFT_MAX_TOKENS = 2000;
// The cheapest current Think model; the template-selection defaults point at retired Gemini 2.5 models.
const PAGE_DRAFT_MODEL_ID = 'google-ai-studio/gemini-3.6-flash';

export class PageCopyDraftController extends BaseController {
    static logger = createLogger('PageCopyDraftController');

    static async draft(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PageCopyDraftData>>> {
        try {
            const appId = context.pathParams.id;
            const user = context.user!;
            await RateLimitService.enforcePageCopyDraftRateLimit(env, context.config.security.rateLimit, user);
            const app = await new AppService(env).getAppDetails(appId, user.id);
            if (!app) return PageCopyDraftController.createErrorResponse<PageCopyDraftData>('App not found', 404);
            const commit = await (await getAgentStubLightweight(env, appId)).getDeployedCommit();
            const space = getSpaceTemplateStub(env, appId);
            if (!commit || !space) {
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(NOT_DEPLOYED_REASON, 400);
            }
            const files = await space.readTreeAtCommit(commit);
            const copy = await draftPageCopy(PageCopyDraftController.completer(env, appId, user.id), {
                title: app.title,
                category: app.category,
                description: app.description,
                files,
            });
            return PageCopyDraftController.createSuccessResponse<PageCopyDraftData>({ copy });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(error, 429);
            }
            if (error instanceof PageCopyDraftError) {
                this.logger.warn('Page text draft failed', { message: error.message, cause: error.cause });
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(PAGE_DRAFT_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error drafting page text', error);
            return PageCopyDraftController.createErrorResponse<PageCopyDraftData>('Failed to draft the page', 500);
        }
    }

    /** Structured output from a current Gemini model; the action name supplies the token and temperature settings. */
    private static completer(env: Env, appId: string, userId: string): PageCopyCompleter {
        const context: InferenceContext = {
            metadata: { agentId: appId, userId },
            enableRealtimeCodeFix: false,
            enableFastSmartCodeFix: false,
        };
        return async (messages) => {
            const result = await executeInference({
                env,
                messages,
                agentActionName: 'templateSelection',
                modelName: PAGE_DRAFT_MODEL_ID,
                schema: PageCopyDraftSchema,
                context,
                maxTokens: DRAFT_MAX_TOKENS,
                // One attempt: a later attempt would swap in the action's retired fallback or cheaper-model Gemini 2.5.
                retryLimit: 1,
            });
            return result?.object ?? null;
        };
    }
}
