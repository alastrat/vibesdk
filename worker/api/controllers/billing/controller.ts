/** The signed-in seller's own plan: the billing page's view, and the actions that ask Stripe to change it. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { BillingService } from '../../../database';
import { CreditLedgerService } from '../../../database/services/CreditLedgerService';
import { loadAccount, loadCredits } from '../../../services/billing/account';
import {
	billingActionDepsFromEnv,
	buyCredits,
	cancelPlan,
	changePlan,
	openPortal,
	resumePlan,
	startCheckout,
	type BillingActionDeps,
	type BillingActionResult,
} from '../../../services/billing/actions';
import { isBillingOn } from '../../../services/billing/flag';
import { billingView } from '../../../services/billing/view';
import { createLogger } from '../../../logger';
import type { AuthUser } from '../../../types/auth-types';
import {
	BILLING_NOT_OPEN_MESSAGE,
	type BillingChangeRequested,
	type BillingRedirect,
	type BillingView,
	type CheckoutStarted,
} from '../../../../shared/types/billing';

type BillingAction<T> = (deps: BillingActionDeps, user: AuthUser) => Promise<BillingActionResult<T>>;

export class BillingController extends BaseController {
	static logger = createLogger('BillingController');

	static async get(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingView>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<BillingView>('Authentication required', 401);
		try {
			const account = await loadAccount(env, user.id);
			if (!account.billing) return this.createSuccessResponse(billingView(account, null, [], false));
			const [credits, purchases, customer] = await Promise.all([
				loadCredits(env, account),
				new CreditLedgerService(env).purchasesOf(user.id),
				new BillingService(env).customerOf(user.id),
			]);
			return this.createSuccessResponse(billingView(account, credits, purchases, customer !== null));
		} catch (error) {
			return this.handleError(error, 'read the billing page') as ControllerResponse<ApiResponse<BillingView>>;
		}
	}

	static async checkout(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutStarted>>> {
		return this.act(request, env, context, 'start a plan checkout', async (deps, user) => startCheckout(deps, user, await this.bodyField(request, 'plan')));
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

	static async portal(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<BillingRedirect>>> {
		return this.act(request, env, context, 'open the billing portal', (deps, user) => openPortal(deps, user.id));
	}

	static async credits(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<CheckoutStarted>>> {
		return this.act(request, env, context, 'start a credits checkout', async (deps, user) =>
			buyCredits(deps, user, await loadAccount(env, user.id), await this.bodyField(request, 'credits')),
		);
	}

	/** Signed in and inside the billing flag, then the action, its answer mapped to a response. */
	private static async act<T>(request: Request, env: Env, context: RouteContext, what: string, action: BillingAction<T>): Promise<ControllerResponse<ApiResponse<T>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<T>('Authentication required', 401);
		if (!isBillingOn(env, user.id)) return this.createErrorResponse<T>(BILLING_NOT_OPEN_MESSAGE, 403);
		try {
			const result = await action(billingActionDepsFromEnv(env, request), user);
			if (result.ok) return this.createSuccessResponse(result.value);
			if ('refusal' in result) return this.createPlanLimitResponse<T>(result.refusal);
			return this.createErrorResponse<T>(result.message, result.status);
		} catch (error) {
			return this.handleError(error, what) as ControllerResponse<ApiResponse<T>>;
		}
	}

	/** One field of a JSON object body; anything else reads as missing, which the action refuses with its own message. */
	private static async bodyField(request: Request, name: string): Promise<unknown> {
		const body = await this.parseJsonBody<unknown>(request);
		const data = body.success ? body.data : undefined;
		return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[name] : undefined;
	}
}
