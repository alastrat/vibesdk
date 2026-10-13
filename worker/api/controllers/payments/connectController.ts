/** Seller onboarding with Stripe Connect Express: start or resume onboarding, read status, open the dashboard. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { StripeConnectService } from '../../../database';
import { StripeApiError, accountFlags } from '../../../services/payments/stripe-client';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import type { StripeConnectStatusData, StripeLinkData } from './types';

const NOT_CONNECTED: Omit<StripeConnectStatusData, 'configured'> = {
    connected: false,
    detailsSubmitted: false,
    payoutsEnabled: false,
    transfersActive: false,
};

export class StripeConnectController extends BaseController {
    static logger = createLogger('StripeConnectController');

    /** Create the seller's Express account on first use and return a Stripe-hosted onboarding link. */
    static async startOnboarding(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeLinkData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return StripeConnectController.createErrorResponse<StripeLinkData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const user = context.user!;
            const accounts = new StripeConnectService(env);
            let accountId = (await accounts.getByUser(user.id))?.stripeAccountId;
            if (!accountId) {
                const created = await stripe.createExpressAccount({ email: user.email, userId: user.id });
                try {
                    await accounts.create({ userId: user.id, stripeAccountId: created.id, flags: accountFlags(created) });
                    accountId = created.id;
                } catch (error) {
                    // A concurrent request stored the account first; use that one.
                    accountId = (await accounts.getByUser(user.id))?.stripeAccountId;
                    if (!accountId) throw error;
                }
            }
            const origin = new URL(request.url).origin;
            const link = await stripe.createAccountLink({
                accountId,
                refreshUrl: `${origin}/profile?tab=paid&stripe=refresh`,
                returnUrl: `${origin}/profile?tab=paid&stripe=return`,
            });
            return StripeConnectController.createSuccessResponse<StripeLinkData>({ url: link.url });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe onboarding failed', { status: error.status, code: error.code, message: error.message });
                return StripeConnectController.createErrorResponse<StripeLinkData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error starting Stripe onboarding', error);
            return StripeConnectController.createErrorResponse<StripeLinkData>('Failed to start Stripe onboarding', 500);
        }
    }

    /** The seller's payout readiness, refreshed from Stripe; falls back to the stored flags if Stripe fails. */
    static async getStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) {
                return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({ configured: false, ...NOT_CONNECTED });
            }
            const accounts = new StripeConnectService(env);
            const stored = await accounts.getByUser(context.user!.id);
            if (!stored) {
                return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({ configured: true, ...NOT_CONNECTED });
            }
            let flags = {
                detailsSubmitted: stored.detailsSubmitted,
                chargesEnabled: stored.chargesEnabled,
                payoutsEnabled: stored.payoutsEnabled,
                transfersActive: stored.transfersActive,
            };
            try {
                flags = accountFlags(await stripe.retrieveAccount(stored.stripeAccountId));
                await accounts.updateFlags(stored.stripeAccountId, flags);
            } catch (error) {
                this.logger.warn('Could not refresh the Stripe account; using stored flags', error);
            }
            return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({
                configured: true,
                connected: true,
                detailsSubmitted: flags.detailsSubmitted,
                payoutsEnabled: flags.payoutsEnabled,
                transfersActive: flags.transfersActive,
            });
        } catch (error) {
            this.logger.error('Error loading Stripe status', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to load your Stripe status', 500);
        }
    }

    /** A one-time link to the seller's Stripe Express dashboard. */
    static async dashboardLink(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeLinkData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return StripeConnectController.createErrorResponse<StripeLinkData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const stored = await new StripeConnectService(env).getByUser(context.user!.id);
            if (!stored || !stored.detailsSubmitted) {
                return StripeConnectController.createErrorResponse<StripeLinkData>('Finish Stripe onboarding first', 400);
            }
            const link = await stripe.createLoginLink(stored.stripeAccountId);
            return StripeConnectController.createSuccessResponse<StripeLinkData>({ url: link.url });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe dashboard link failed', { status: error.status, code: error.code });
                return StripeConnectController.createErrorResponse<StripeLinkData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error creating Stripe dashboard link', error);
            return StripeConnectController.createErrorResponse<StripeLinkData>('Failed to open the Stripe dashboard', 500);
        }
    }
}
