/** Seller onboarding with Stripe Connect Express: start or resume onboarding, read status, open the dashboard. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { StripeConnectService } from '../../../database';
import { StripeApiError, accountFlags } from '../../../services/payments/stripe-client';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import type { StripeConnectStatusData, StripeLinkData } from './types';

const FINISH_ONBOARDING_MESSAGE = 'Finish Stripe onboarding first';

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
            const origin = new URL(request.url).origin;
            const linkFor = (accountId: string) =>
                stripe.createAccountLink({
                    accountId,
                    refreshUrl: `${origin}/profile?tab=paid&stripe=refresh`,
                    returnUrl: `${origin}/profile?tab=paid&stripe=return`,
                });
            const stored = await accounts.getByUser(user.id);
            if (stored) {
                // A stored account Stripe no longer has is deleted, and onboarding starts over with a fresh one below.
                const link = await accounts.forgetIfMissing(user.id, () => linkFor(stored.stripeAccountId));
                if (link) return StripeConnectController.createSuccessResponse<StripeLinkData>({ url: link.url });
            }
            let accountId: string | undefined;
            const created = await stripe.createExpressAccount({ email: user.email, userId: user.id, nowMs: Date.now() });
            try {
                await accounts.create({ userId: user.id, stripeAccountId: created.id, flags: accountFlags(created) });
                accountId = created.id;
            } catch (error) {
                // A concurrent request stored the account first; use that one.
                accountId = (await accounts.getByUser(user.id))?.stripeAccountId;
                if (!accountId) throw error;
            }
            const link = await linkFor(accountId);
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

    /**
     * The seller's payout readiness, refreshed from Stripe; falls back to the stored flags if Stripe fails,
     * and reads as not connected when Stripe no longer has the account.
     */
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
                const account = await accounts.forgetIfMissing(stored.userId, () => stripe.retrieveAccount(stored.stripeAccountId));
                if (!account) {
                    return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({ configured: true, ...NOT_CONNECTED });
                }
                flags = accountFlags(account);
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
            const userId = context.user!.id;
            const accounts = new StripeConnectService(env);
            const stored = await accounts.getByUser(userId);
            if (!stored || !stored.detailsSubmitted) {
                return StripeConnectController.createErrorResponse<StripeLinkData>(FINISH_ONBOARDING_MESSAGE, 400);
            }
            const link = await accounts.forgetIfMissing(userId, () => stripe.createLoginLink(stored.stripeAccountId));
            if (!link) return StripeConnectController.createErrorResponse<StripeLinkData>(FINISH_ONBOARDING_MESSAGE, 400);
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
