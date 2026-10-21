import { t } from '../../../services/i18n/request-locale';
import { msg } from '../../../../shared/i18n/translate';
/**
 * Model Providers Controller
 */

import { BaseController } from '../baseController';
import { RouteContext } from '../../types/route-context';
import { ApiResponse, ControllerResponse } from '../types';
import { ModelProvidersService } from '../../../database/services/ModelProvidersService';
import { z } from 'zod';
import {
    ModelProvidersListData,
    ModelProviderData,
    ModelProviderCreateData,
    ModelProviderUpdateData,
    ModelProviderDeleteData,
    ModelProviderTestData,
    CreateProviderRequest,
    UpdateProviderRequest,
    TestProviderRequest
} from './types';
import { createLogger } from '../../../logger';

// Validation schemas
const createProviderSchema = z.object({
    name: z.string().min(1).max(100),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1)
});

const updateProviderSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional(),
    isActive: z.boolean().optional()
});

const testProviderSchema = z.object({
    providerId: z.string().optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().min(1).optional()
}).refine(
    (data) => data.providerId || (data.baseUrl && data.apiKey),
    "Either providerId or both baseUrl and apiKey must be provided"
);

export class ModelProvidersController extends BaseController {
    static logger = createLogger('ModelProvidersController');

    /**
     * Get all custom providers for the authenticated user
     */
    static async getProviders(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProvidersListData>>> {
        try {
            const user = context.user!;
            const modelProvidersService = new ModelProvidersService(env);
            const providers = await modelProvidersService.getUserProviders(user.id);

            return ModelProvidersController.createSuccessResponse({
                providers: providers.filter(p => p.isActive)
            });
        } catch (error) {
            this.logger.error('Error getting providers:', error);
            return ModelProvidersController.createErrorResponse<ModelProvidersListData>(msg('Failed to get providers'), 500);
        }
    }

    /**
     * Get a specific provider by ID
     */
    static async getProvider(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProviderData>>> {
        try {
            const user = context.user!;

            const url = new URL(request.url);
            const providerId = url.pathname.split('/').pop();

            if (!providerId) {
                return ModelProvidersController.createErrorResponse<ModelProviderData>(msg('Provider ID is required'), 400);
            }

            const modelProvidersService = new ModelProvidersService(env);
            const provider = await modelProvidersService.getProvider(user.id, providerId);

            if (!provider) {
                throw new Error('Provider not found');
            }

            return ModelProvidersController.createSuccessResponse({
                provider
            });
        } catch (error) {
            this.logger.error('Error getting provider:', error);
            return ModelProvidersController.createErrorResponse<ModelProviderData>(msg('Failed to get provider'), 500);
        }
    }

	/**
	 * Create a new custom provider
	 */

    static async createProvider(request: Request, _env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProviderCreateData>>> {
        try {
            const bodyResult = await ModelProvidersController.parseJsonBody<CreateProviderRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response as ControllerResponse<ApiResponse<ModelProviderCreateData>>;
            }

            const validation = createProviderSchema.safeParse(bodyResult.data);
            if (!validation.success) {
                return ModelProvidersController.createErrorResponse<ModelProviderCreateData>(
                    t("Validation error: {value1}", { value1: validation.error.issues.map(e => e.message).join(', ') }),
                    400
                );
            }


            return ModelProvidersController.createErrorResponse<ModelProviderCreateData>(
                msg('Custom model providers are temporarily disabled. Please use BYOK (Bring Your Own Key) in the vault settings.'),
                503
            );
        } catch (error) {
            return ModelProvidersController.createErrorResponse<ModelProviderCreateData>(
                msg('Failed to create provider'),
                500
            );
        }
    }

	/**
	 * Update an existing provider
	 */

    static async updateProvider(request: Request, _env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProviderUpdateData>>> {
        try {
            const url = new URL(request.url);
            const providerId = url.pathname.split('/').pop();

            if (!providerId) {
                return ModelProvidersController.createErrorResponse<ModelProviderUpdateData>(msg('Provider ID is required'), 400);
            }

            const bodyResult = await ModelProvidersController.parseJsonBody<UpdateProviderRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response as ControllerResponse<ApiResponse<ModelProviderUpdateData>>;
            }

            const validation = updateProviderSchema.safeParse(bodyResult.data);
            if (!validation.success) {
                return ModelProvidersController.createErrorResponse<ModelProviderUpdateData>(
                    t("Validation error: {value1}", { value1: validation.error.issues.map(e => e.message).join(', ') }),
                    400
                );
            }


            return ModelProvidersController.createErrorResponse<ModelProviderUpdateData>(
                msg('Custom model providers are temporarily disabled. Please use BYOK (Bring Your Own Key) in the vault settings.'),
                503
            );
        } catch (error) {
            this.logger.error('Error updating provider:', error);
            return ModelProvidersController.createErrorResponse<ModelProviderUpdateData>(msg('Failed to update provider'), 500);
        }
    }

	/**
	 * Delete a provider
	 */

    static async deleteProvider(request: Request, _env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProviderDeleteData>>> {
        try {
            const url = new URL(request.url);
            const providerId = url.pathname.split('/').pop();

            if (!providerId) {
                return ModelProvidersController.createErrorResponse<ModelProviderDeleteData>(msg('Provider ID is required'), 400);
            }

            return ModelProvidersController.createErrorResponse<ModelProviderDeleteData>(
                msg('Custom model providers are temporarily disabled.'),
                503
            );
        } catch (error) {
            this.logger.error('Error deleting provider:', error);
            return ModelProvidersController.createErrorResponse<ModelProviderDeleteData>(msg('Failed to delete provider'), 500);
        }
    }

	/**
	 * Test provider connection
	 */

    static async testProvider(request: Request, _env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<ModelProviderTestData>>> {
        try {
            const bodyResult = await ModelProvidersController.parseJsonBody<TestProviderRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response as ControllerResponse<ApiResponse<ModelProviderTestData>>;
            }

            const validation = testProviderSchema.safeParse(bodyResult.data);
            if (!validation.success) {
                return ModelProvidersController.createErrorResponse<ModelProviderTestData>(
                    t("Validation error: {value1}", { value1: validation.error.issues.map(e => e.message).join(', ') }),
                    400
                );
            }


            if (validation.data.providerId) {
                return ModelProvidersController.createErrorResponse<ModelProviderTestData>(
                    msg('Testing stored providers is temporarily disabled. Please provide baseUrl and apiKey directly.'),
                    503
                );
            }

            const baseUrl = validation.data.baseUrl!;
            const apiKey = validation.data.apiKey!;

            const startTime = Date.now();
            try {
                const testUrl = `${baseUrl.replace(/\/$/, '')}/models`;
                const response = await fetch(testUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                const responseTime = Date.now() - startTime;

                if (response.ok) {
                    return ModelProvidersController.createSuccessResponse<ModelProviderTestData>({
                        success: true,
                        responseTime
                    });
                } else {
                    const errorText = await response.text();
                    return ModelProvidersController.createErrorResponse<ModelProviderTestData>(
                        t("API request failed: {value1} {value2}", { value1: response.status, value2: errorText }),
                        500
                    );
                }
            } catch (error) {
                return ModelProvidersController.createErrorResponse<ModelProviderTestData>(
                    t("Connection failed: {value1}", { value1: error instanceof Error ? error.message : 'Unknown error' }),
                    500
                );
            }
        } catch (error) {
            this.logger.error('Error testing provider:', error);
            return ModelProvidersController.createErrorResponse<ModelProviderTestData>(msg('Failed to test provider'), 500);
        }
    }
}
