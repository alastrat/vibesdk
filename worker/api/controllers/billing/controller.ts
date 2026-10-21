/** The signed-in seller's own plan: the billing page's view, and the actions that ask Stripe to change it. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { BillingService } from '../../../database';
import { CreditLedgerService } from '../../../database/services/CreditLedgerService';
import { loadAccount, loadCredits } from '../../../services/billing/account';
import {
	billingActionDepsFromEnv,
	billingHistory,
	buyCredits,
	cancelPlan,
	changePlan,
	checkoutStatus,
	checkoutTerms,
	completeCardSetup,
	invoicePdf,
	payOpenInvoice,
	recordCheckoutConsent,
	resumePlan,
	startCardSetup,
	startCheckout,
	type BillingActionDeps,
	type BillingActionResult,
} from '../../../services/billing/actions';
import { stripeFromEnv } from '../../../services/payments/config';
import { isFlagOn } from '../../../services/posthog/flags';
import { billingView, cardForView } from '../../../services/billing/view';
import { localeFromAcceptLanguage } from '../../../../shared/i18n/locales';
import type { Translator } from '../../../../shared/i18n/translate';
import { createLogger } from '../../../logger';
import { serverT } from '../../../services/i18n/server-t';
import type { AuthUser } from '../../../types/auth-types';
import {
	BILLING_NOT_OPEN_MESSAGE,
	type BillingChangeRequested,
	type BillingView,
	type CardSetupStart,
	type CheckoutClientStart,
	type CheckoutStatusView,
	type CheckoutTermsView,
	type InvoicePaymentResult,
	type InvoiceView,
} from '../../../../shared/types/billing';

type BillingAction<T> = (deps: BillingActionDeps, user: AuthUser) => Promise<BillingActionResult<T>>;

export class BillingController extends BaseController {
	static logger = createLogger('BillingController');

	static async get(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingView>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<BillingView>('Authentication required', 401);
		try {
			const account = await loadAccount(env, user.id);
			if (!account.billing) return this.createSuccessResponse(billingView(account, null, [], false, null));
			const customerId = await new BillingService(env).customerOf(user.id);
			const [credits, purchases, card] = await Promise.all([
				loadCredits(env, account),
				new CreditLedgerService(env).purchasesOf(user.id),
				cardForView(stripeFromEnv(env), customerId, account),
			]);
			return this.createSuccessResponse(billingView(account, credits, purchases, customerId !== null, card));
		} catch (error) {
			return this.handleError(error, 'read the billing page') as ControllerResponse<ApiResponse<BillingView>>;
		}
	}

	static async checkout(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutClientStart>>> {
		return this.act(request, env, context, 'start a plan checkout', async (deps, user) => startCheckout(deps, user, await this.bodyField(request, 'plan')));
	}

	static async credits(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutClientStart>>> {
		return this.act(request, env, context, 'start a credits checkout', async (deps, user) =>
			buyCredits(deps, user, await loadAccount(env, user.id), await this.bodyField(request, 'credits')),
		);
	}

	static async checkoutTerms(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutTermsView>>> {
		return this.act(request, env, context, 'read the checkout terms', (deps, user) => checkoutTerms(deps, user.id, context.queryParams.get('session_id')));
	}

	static async checkoutConsent(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<{ recorded: true }>>> {
		return this.act(request, env, context, 'record the checkout consent', async (deps, user) => recordCheckoutConsent(deps, user.id, await this.jsonBody(request)));
	}

	static async checkoutStatus(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutStatusView>>> {
		return this.act(request, env, context, 'read the checkout status', (deps, user) => checkoutStatus(deps, user.id, context.queryParams.get('session_id')));
	}

	static async changePlan(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingChangeRequested>>> {
		return this.act(request, env, context, 'change the plan', async (deps, user) => changePlan(deps, user.id, await this.bodyField(request, 'plan')));
	}

	static async cancel(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingChangeRequested>>> {
		return this.act(request, env, context, 'cancel the plan', (deps, user) => cancelPlan(deps, user.id));
	}

	static async resume(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingChangeRequested>>> {
		return this.act(request, env, context, 'keep the plan', (deps, user) => resumePlan(deps, user.id));
	}

	static async cardSetup(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CardSetupStart>>> {
		return this.act(request, env, context, 'start a card change', async (deps, user) => startCardSetup(deps, user, await this.bodyField(request, 'mode')));
	}

	static async cardComplete(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<InvoicePaymentResult>>> {
		return this.act(request, env, context, 'finish a card change', async (deps, user) => completeCardSetup(deps, user.id, await this.bodyField(request, 'sessionId')));
	}

	/** Pays the failed invoice with the card on file. */
	static async payInvoice(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<InvoicePaymentResult>>> {
		return this.act(request, env, context, 'pay the open invoice', (deps, user) => payOpenInvoice(deps, user.id, null));
	}

	static async history(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<InvoiceView[]>>> {
		return this.act(request, env, context, 'read the billing history', (deps, user) => billingHistory(deps, user.id));
	}

	/** The invoice's PDF as the file itself; a refusal is the usual JSON error. */
	static async invoicePdf(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Response> {
		return this.settle(request, env, context, 'download an invoice', (deps, user) => invoicePdf(deps, user.id, context.pathParams.id), (pdf) => pdf);
	}

	private static async act<T>(request: Request, env: Env, context: RouteContext, what: string, action: BillingAction<T>): Promise<ControllerResponse<ApiResponse<T>>> {
		return this.settle(request, env, context, what, action, (value) => this.createSuccessResponse(value));
	}

	/** Signed in and inside the billing flag, then the action; a success is answered by `answer`, a refusal or failure as the error the app reads. */
	private static async settle<T, R extends Response>(
		request: Request,
		env: Env,
		context: RouteContext,
		what: string,
		action: BillingAction<T>,
		answer: (value: T) => R,
	): Promise<R | ControllerResponse<ApiResponse<never>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse('Authentication required', 401);
		if (!(await isFlagOn(env, 'billing', user.id))) return this.createErrorResponse(BILLING_NOT_OPEN_MESSAGE, 403);
		try {
			const result = await action(billingActionDepsFromEnv(env, request, this.translatorFor(request, user)), user);
			if (result.ok) return answer(result.value);
			if ('refusal' in result) return this.createPlanLimitResponse(result.refusal);
			return this.createErrorResponse(result.message, result.status);
		} catch (error) {
			return this.handleError(error, what) as ControllerResponse<ApiResponse<never>>;
		}
	}

	/** The language the checkout's wording is written in: the seller's saved one, else their browser's, else English. */
	private static translatorFor(request: Request, user: AuthUser): Translator {
		return serverT(user.locale ?? localeFromAcceptLanguage(request.headers.get('Accept-Language')));
	}

	/** The JSON body as sent; an unreadable or missing body reads as undefined, which the action refuses with its own message. */
	private static async jsonBody(request: Request): Promise<unknown> {
		const body = await this.parseJsonBody<unknown>(request);
		return body.success ? body.data : undefined;
	}

	/** One field of a JSON object body; anything else reads as missing, which the action refuses with its own message. */
	private static async bodyField(request: Request, name: string): Promise<unknown> {
		const data = await this.jsonBody(request);
		return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;
	}
}
