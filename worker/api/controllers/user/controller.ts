import { BaseController } from '../baseController';
import { ApiResponse, ControllerResponse } from '../types';
import { RouteContext } from '../../types/route-context';
import { UserService } from '../../../database/services/UserService';
import { AppService } from '../../../database/services/AppService';
import { Visibility, AppSortOption, SortOrder, TimePeriod } from '../../../database/types';
import { LocalePreferenceService } from '../../../database/services/LocalePreferenceService';
import { UserAppsData, ProfileUpdateData, LocalePreferenceData } from './types';
import { createLogger } from '../../../logger';
import { isLocale } from '../../../../shared/i18n/locales';
import { msg } from '../../../../shared/i18n/translate';

const logger = createLogger('UserController');

/**
 * User Management Controller for Orange
 * Handles user dashboard, profile management, and app history
 */
export class UserController extends BaseController {
    static logger = logger;
    
    /**
     * Get user's apps with pagination and filtering
     */
    static async getApps(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<UserAppsData>>> {
        try {
            const user = context.user!;

            const url = new URL(request.url);
            const page = parseInt(url.searchParams.get('page') || '1');
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const status = url.searchParams.get('status') as 'generating' | 'completed' | undefined;
            const visibility = url.searchParams.get('visibility') as Visibility | undefined;
            const framework = url.searchParams.get('framework') || undefined;
            const search = url.searchParams.get('search') || undefined;
            const sort = (url.searchParams.get('sort') || 'recent') as AppSortOption;
            const order = (url.searchParams.get('order') || 'desc') as SortOrder;
            const period = (url.searchParams.get('period') || 'all') as TimePeriod;
            const offset = (page - 1) * limit;
            
            const queryOptions = {
                limit,
                offset,
                status,
                visibility,
                framework,
                search,
                sort,
                order,
                period
            };

            const appService = new AppService(env);
            
            // Get user apps with analytics and proper total count
            const [apps, totalCount] = await Promise.all([
                appService.getUserAppsWithAnalytics(user.id, queryOptions),
                appService.getUserAppsCount(user.id, queryOptions)
            ]);

            const responseData: UserAppsData = {
                apps,
                pagination: {
                    limit,
                    offset,
                    total: totalCount,
                    hasMore: offset + limit < totalCount
                }
            };

            return UserController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error getting user apps:', error);
            return UserController.createErrorResponse<UserAppsData>(msg('Failed to get user apps'), 500);
        }
    }

    /**
     * Update user profile
     */
    static async updateProfile(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ProfileUpdateData>>> {
        try {
            const user = context.user!;

            const bodyResult = await UserController.parseJsonBody<{
                username?: string;
                displayName?: string;
                bio?: string;
                theme?: 'light' | 'dark' | 'system';
            }>(request);

            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<ProfileUpdateData>>;
            }

            const userService = new UserService(env);
            const result = await userService.updateUserProfileWithValidation(user.id, bodyResult.data!);

            if (!result.success) {
                return UserController.createErrorResponse<ProfileUpdateData>(result.message, 400);
            }

            const responseData: ProfileUpdateData = result;
            return UserController.createSuccessResponse(responseData);
        } catch (error) {
            this.logger.error('Error updating user profile:', error);
            return UserController.createErrorResponse<ProfileUpdateData>(msg('Failed to update profile'), 500);
        }
    }

    /**
     * Save the language the user chose
     * PUT /api/user/locale
     */
    static async setLocale(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<LocalePreferenceData>>> {
        const user = context.user;
        if (!user) {
            return UserController.createErrorResponse<LocalePreferenceData>(msg('Unauthorized'), 401);
        }

        const body = await UserController.parseJsonBody<{ locale?: unknown }>(request);
        const locale = body.success ? body.data?.locale : undefined;
        if (!isLocale(locale)) {
            return UserController.createErrorResponse<LocalePreferenceData>(msg("That language isn't available."), 400);
        }

        try {
            await new LocalePreferenceService(env).setLocale(user.id, locale, new Date());
            return UserController.createSuccessResponse({ locale });
        } catch (error) {
            this.logger.error('Error saving the language:', error);
            return UserController.createErrorResponse<LocalePreferenceData>(msg('Failed to save the language'), 500);
        }
    }
}