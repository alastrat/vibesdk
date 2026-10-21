/**
 * Route Authentication Middleware
 */

import { createMiddleware } from 'hono/factory';
import { AuthUser } from '../../types/auth-types';
import { createLogger } from '../../logger';
import { AppService, UserService } from '../../database';
import { authMiddleware } from './auth';
import { RateLimitService } from '../../services/rate-limit/rateLimits';
import { errorResponse } from '../../api/responses';
import { Context } from 'hono';
import { AppEnv } from '../../types/appenv';
import { RateLimitExceededError } from 'shared/types/errors';
import * as Sentry from '@sentry/cloudflare';
import { getUserConfigurableSettings } from 'worker/config';
import { authenticateViaTicket, hasTicketParam } from './ticketAuth';
import { requestLocale, setRequestLocale, t } from '../../services/i18n/request-locale';
import { msg } from '../../../shared/i18n/translate';

const logger = createLogger('RouteAuth');

/**
 * Authentication levels for route protection
 */
export type AuthLevel = 'public' | 'authenticated' | 'owner-only' | 'admin';

/**
 * Authentication requirement configuration
 */
export interface AuthRequirement {
    required: boolean;
    level: AuthLevel;
    resourceOwnershipCheck?: (user: AuthUser, params: Record<string, string>, env: Env) => Promise<boolean>;
    /** Platform role check for admin routes; reads the role on every request. */
    roleCheck?: (user: AuthUser, env: Env) => Promise<boolean>;
}

/**
 * Ticket authentication configuration
 */
export type TicketResourceType = 'agent' | 'vault';

export interface TicketAuthConfig {
    /** Type of resource this ticket authenticates */
    resourceType: TicketResourceType;
    /** Path parameter name containing the resource ID (for agent) */
    paramName?: string;
}

/**
 * Additional options for setAuthLevel middleware
 */
export interface AuthLevelOptions {
    /** Ticket-based authentication configuration */
    ticketAuth?: TicketAuthConfig;
}

/**
 * Common auth requirement configurations
 */
export const AuthConfig = {
    // Public route - no authentication required
    public: { 
        required: false,
        level: 'public' as const
    },
    
    // Require full authentication (no anonymous users)
    authenticated: { 
        required: true, 
        level: 'authenticated' as const 
    },
    
    // Require resource ownership (for app editing)
    ownerOnly: { 
        required: true, 
        level: 'owner-only' as const,
        resourceOwnershipCheck: checkAppOwnership
    },

    // Require the platform admin role (template review)
    admin: {
        required: true,
        level: 'admin' as const,
        roleCheck: checkAdminRole
    },
    
    // Public read access, but owner required for modifications
    publicReadOwnerWrite: { 
        required: false 
    }
} as const;

/**
 * Route authentication logic that enforces authentication requirements
 */
export async function routeAuthChecks(
    user: AuthUser | null,
    env: Env,
    requirement: AuthRequirement,
    params?: Record<string, string>
): Promise<{ success: boolean; response?: Response }> {
    try {
        // Public routes always pass
        console.log('requirement', requirement, 'for user', user);
        if (requirement.level === 'public') {
            return { success: true };
        }

        // For authenticated routes
        if (requirement.level === 'authenticated') {
            if (!user) {
                return {
                    success: false,
                    response: createAuthRequiredResponse()
                };
            }

            return { success: true };
        }

        // For owner-only routes
        if (requirement.level === 'owner-only') {
            if (!user) {
                return {
                    success: false,
                    response: createAuthRequiredResponse(msg('Account required'))
                };
            }

            // Check resource ownership if function provided
            if (requirement.resourceOwnershipCheck) {
                if (params) {
                    const isOwner = await requirement.resourceOwnershipCheck(user, params, env);
                    return {
                        success: isOwner,
                        response: isOwner ? undefined : createForbiddenResponse(msg('You can only access your own resources'))
                    }
                }
                return {
                    success: false,
                    response: createForbiddenResponse(msg('Invalid resource ownership'))
                };
            }

            return { success: true };
        }

        // For admin routes
        if (requirement.level === 'admin') {
            if (!user) {
                return {
                    success: false,
                    response: createAuthRequiredResponse()
                };
            }
            const isAdmin = requirement.roleCheck ? await requirement.roleCheck(user, env) : false;
            return {
                success: isAdmin,
                response: isAdmin ? undefined : createForbiddenResponse(msg('Admin access required'))
            };
        }

        // Default fallback
        return { success: true };
    } catch (error) {
        logger.error('Error in route auth middleware', error);
        return {
            success: false,
            response: new Response(JSON.stringify({
                success: false,
                error: t('Authentication check failed')
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            })
        };
    }
}

/*
 * Enforce authentication requirement
 */
export async function enforceAuthRequirement(c: Context<AppEnv>) : Promise<Response | undefined> {
    let user: AuthUser | null = c.get('user') || null;

    const requirement = c.get('authLevel') as AuthRequirement | undefined;
    const authOptions = c.get('authLevelOptions') as AuthLevelOptions | undefined;
    
    if (!requirement) {
        logger.error('No authentication level found');
        return errorResponse(msg('No authentication level found'), 500);
    }
    
    // Only perform auth if we need it or don't have user yet
    if (!user && (requirement.level === 'authenticated' || requirement.level === 'owner-only' || requirement.level === 'admin')) {
        const request = c.req.raw;
        const env = c.env;
        const params = c.req.param();
        
        // Strategy 1: Ticket-based auth (if configured and ticket present)
        if (authOptions?.ticketAuth && hasTicketParam(request)) {
            const ticketAuth = await authenticateViaTicket(request, env, authOptions.ticketAuth, params);
            if (ticketAuth) {
                user = ticketAuth.user;
                setRequestLocale(await requestLocale(env, request, user));
                c.set('user', user);
                c.set('sessionId', ticketAuth.sessionId);
                Sentry.setUser({ id: user.id, email: user.email });
                
                const config = await getUserConfigurableSettings(c.env, user.id);
                c.set('config', config);
                
                // Skip rate limiting for ticket auth (already rate-limited at ticket creation)
                logger.info('Authenticated via ticket', { userId: user.id, resourceType: authOptions.ticketAuth.resourceType });
            } else {
                // Ticket was provided but invalid - reject immediately
                return errorResponse(msg('Invalid or expired ticket'), 403);
            }
        }
        
        // Strategy 2: Standard JWT auth (header/cookie)
        if (!user) {
            const userSession = await authMiddleware(c.req.raw, c.env);
            if (!userSession) {
                return errorResponse(msg('Authentication required'), 401);
            }
            user = userSession.user;
            c.set('user', user);
            c.set('sessionId', userSession.sessionId);
            Sentry.setUser({ id: user.id, email: user.email });

            const config = await getUserConfigurableSettings(c.env, user.id);
            c.set('config', config);

            try {
                await RateLimitService.enforceAuthRateLimit(c.env, config.security.rateLimit, user, c.req.raw);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return errorResponse(error, 429);
                }
                logger.error('Error enforcing auth rate limit', error);
                return errorResponse(msg('Internal server error'), 500);
            }
        }
    }
    
    const params = c.req.param();
    const env = c.env;
    const result = await routeAuthChecks(user, env, requirement, params);
    if (!result.success) {
        logger.warn('Authentication check failed', result.response, requirement, user);
        return result.response;
    }
}

export function setAuthLevel(requirement: AuthRequirement, options?: AuthLevelOptions) {
    return createMiddleware(async (c, next) => {
        c.set('authLevel', requirement);
        if (options) {
            c.set('authLevelOptions', options);
        }
        return await next();
    })
}

/**
 * Create standardized authentication required response
 */
function createAuthRequiredResponse(message?: string): Response {
    return new Response(JSON.stringify({
        success: false,
        error: {
            type: 'AUTHENTICATION_REQUIRED',
            message: t(message || msg('Authentication required')),
            action: 'login'
        }
    }), {
        status: 401,
        headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="API"'
        }
    });
}

/**
 * Create standardized forbidden response
 */
function createForbiddenResponse(message: string): Response {
    return new Response(JSON.stringify({
        success: false,
        error: {
            type: 'FORBIDDEN',
            message: t(message),
            action: 'insufficient_permissions'
        }
    }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
    });
}

/**
 * Check if user owns an app by agent/app ID
 */
export async function checkAppOwnership(user: AuthUser, params: Record<string, string>, env: Env): Promise<boolean> {
    try {
        const agentId = params.agentId || params.id;
        if (!agentId) {
            return false;
        }

        const appService = new AppService(env);
        const ownershipResult = await appService.checkAppOwnership(agentId, user.id);
        return ownershipResult.isOwner;
    } catch (error) {
        logger.error('Error checking app ownership', error);
        return false;
    }
}

/**
 * Check platform admin access in D1: the admin role, or a Google or GitHub
 * identity that verified a platform admin email. Read on every request, so a
 * role change or an unlinked identity takes effect without a new session.
 */
export async function checkAdminRole(user: AuthUser, env: Env): Promise<boolean> {
    try {
        return await new UserService(env).isPlatformAdmin(user.id);
    } catch (error) {
        logger.error('Error checking admin role', error);
        return false;
    }
}
