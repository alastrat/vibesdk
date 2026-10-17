/** Early-access requests: a signed-in user's own, and every request for admins. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { EarlyAccessService } from '../../../database';
import { parseEarlyAccessRequest, toEarlyAccessAdminData } from './earlyAccessDto';
import type { EarlyAccessAdminData, MyEarlyAccessData } from './types';

export class EarlyAccessController extends BaseController {
    static logger = createLogger('EarlyAccessController');

    /** Records a request for one program and returns all of the user's requests. */
    static async request(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyEarlyAccessData>>> {
        try {
            const bodyResult = await EarlyAccessController.parseJsonBody<unknown>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<MyEarlyAccessData>>;
            }
            const parsed = parseEarlyAccessRequest(bodyResult.data);
            if (!parsed.ok) {
                return EarlyAccessController.createErrorResponse<MyEarlyAccessData>(parsed.error, 400);
            }
            const service = new EarlyAccessService(env);
            const userId = context.user!.id;
            await service.request(userId, parsed.capability);
            return EarlyAccessController.createSuccessResponse<MyEarlyAccessData>({ capabilities: await service.listForUser(userId) });
        } catch (error) {
            this.logger.error('Error recording an early access request', error);
            return EarlyAccessController.createErrorResponse<MyEarlyAccessData>("Couldn't save your request", 500);
        }
    }

    static async mine(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyEarlyAccessData>>> {
        try {
            const capabilities = await new EarlyAccessService(env).listForUser(context.user!.id);
            return EarlyAccessController.createSuccessResponse<MyEarlyAccessData>({ capabilities });
        } catch (error) {
            this.logger.error('Error listing early access requests', error);
            return EarlyAccessController.createErrorResponse<MyEarlyAccessData>("Couldn't load your early access requests", 500);
        }
    }

    static async listAll(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<EarlyAccessAdminData>>> {
        try {
            const rows = await new EarlyAccessService(env).listAll();
            return EarlyAccessController.createSuccessResponse<EarlyAccessAdminData>(toEarlyAccessAdminData(rows));
        } catch (error) {
            this.logger.error('Error listing all early access requests', error);
            return EarlyAccessController.createErrorResponse<EarlyAccessAdminData>("Couldn't load early access requests", 500);
        }
    }
}
