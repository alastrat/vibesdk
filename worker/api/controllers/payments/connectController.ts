/** Seller onboarding with Stripe Connect Express: start or resume onboarding, read status, open the dashboard. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { SellerTermsService, StripeConnectService } from '../../../database';
import { StripeApiError, accountFlags, sellerReadiness, type SellerFlags } from '../../../services/payments/stripe-client';
import { sellerSetupStep } from '../../../../shared/types/seller-setup';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import type { StripeConnectStatusData, StripeLinkData } from './types';

const FINISH_ONBOARDING_MESSAGE = 'Finish Stripe onboarding first';

const ACCEPT_TERMS_FIRST_MESSAGE = 'Accept the selling terms first';

/** The status for a seller with these flags (null: no Connect account) and selling-terms agreement. */
function statusOf(flags: SellerFlags | null, termsAccepted: boolean): StripeConnectStatusData {
    const readiness = sellerReadiness(flags, termsAccepted);
    return {
        configured: true,
        connected: readiness.connected,
        detailsSubmitted: readiness.detailsSubmitted,
        payoutsEnabled: readiness.payoutsEnabled,
        transfersActive: readiness.transfersActive,
        cardPaymentsActive: readiness.cardPaymentsActive,
        sellerTermsAccepted: termsAccepted,
        setupStep: sellerSetupStep(readiness),
    };
}

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
            if (!(await new SellerTermsService(env).hasAccepted(user.id))) {
                return StripeConnectController.createErrorResponse<StripeLinkData>(ACCEPT_TERMS_FIRST_MESSAGE, 400);
            }
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
                const link = await accounts.forgetIfMissing(stored, linkFor);
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
     * The seller's payments readiness, refreshed from Stripe; falls back to the stored flags if Stripe fails,
     * and reads as not connected when Stripe no longer has the account.
     */
    private static async loadStatus(env: Env, userId: string): Promise<StripeConnectStatusData> {
        const termsAccepted = await new SellerTermsService(env).hasAccepted(userId);
        const stripe = stripeFromEnv(env);
        if (!stripe) return { ...statusOf(null, termsAccepted), configured: false };
        const accounts = new StripeConnectService(env);
        const stored = await accounts.getByUser(userId);
        if (!stored) return statusOf(null, termsAccepted);
        let flags: SellerFlags = {
            detailsSubmitted: stored.detailsSubmitted,
            chargesEnabled: stored.chargesEnabled,
            payoutsEnabled: stored.payoutsEnabled,
            transfersActive: stored.transfersActive,
            cardPaymentsActive: stored.cardPaymentsActive,
        };
        try {
            const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
            if (!account) return statusOf(null, termsAccepted);
            flags = accountFlags(account);
            await accounts.updateFlags(stored.stripeAccountId, flags);
        } catch (error) {
            this.logger.warn('Could not refresh the Stripe account; using stored flags', error);
        }
        return statusOf(flags, termsAccepted);
    }

    static async getStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            return StripeConnectController.createSuccessResponse(await StripeConnectController.loadStatus(env, context.user!.id));
        } catch (error) {
            this.logger.error('Error loading Stripe status', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to load your Stripe status', 500);
        }
    }

    /** Record the seller's agreement to the current selling terms, then return their status. */
    static async acceptSellerTerms(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            const body = await StripeConnectController.parseJsonBody<{ version?: unknown }>(request);
            if (!body.success) return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Send the terms version you agreed to', 400);
            const accepted = await new SellerTermsService(env).accept(context.user!.id, body.data?.version, new Date());
            if (!accepted) {
                return StripeConnectController.createErrorResponse<StripeConnectStatusData>('The selling terms were updated; reload the page to agree to the latest version', 400);
            }
            return StripeConnectController.createSuccessResponse(await StripeConnectController.loadStatus(env, context.user!.id));
        } catch (error) {
            this.logger.error('Error recording the selling-terms agreement', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to record your agreement', 500);
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
            const link = await accounts.forgetIfMissing(stored, (accountId) => stripe.createLoginLink(accountId));
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
