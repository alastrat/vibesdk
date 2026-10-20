/** Admins' view of an account's billing, and the three things they change: its plan override, its credit grants and its Stripe test customer. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { BillingService, PlanAdminService, UserService } from '../../../database';
import { CreditLedgerService } from '../../../database/services/CreditLedgerService';
import { isUniqueViolation } from '../../../database/services/unique-violation';
import type { PlanOverrideRecord } from '../../../database/schema';
import { loadAccount, loadCredits, liveSubscription, overrideLimitsOf } from '../../../services/billing/account';
import { stripeModeOf } from '../../../services/payments/config';
import { billingView } from '../../../services/billing/view';
import { createLogger } from '../../../logger';
import { PLAN_IDS, planLimitOverridesFrom, type PlanId, type PlanLimitOverrides } from '../../../../shared/types/plans';
import type { AdminBillingView, CreditGrantRequest } from '../../../../shared/types/billing';

type AdminResponse = ControllerResponse<ApiResponse<AdminBillingView>>;

interface ParsedOverride {
	plan: PlanId | null;
	limits: PlanLimitOverrides;
	until: Date | null;
	reason: string;
}

const NO_SUCH_USER = 'No user has this id';
const BAD_OVERRIDE = 'Pick a plan, give a reason, and keep the limits in range.';
const BAD_GRANT = 'Give a whole number of credits from 1 to 10,000,000, and a reason.';
const BILLING_OFF = "Billing isn't on for this account.";
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 500;
const MAX_GRANT_CREDITS = 10_000_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlanId(value: unknown): value is PlanId {
	return (PLAN_IDS as readonly unknown[]).includes(value);
}

function reasonOf(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const reason = value.trim();
	return reason.length >= MIN_REASON_LENGTH && reason.length <= MAX_REASON_LENGTH ? reason : null;
}

/** An ISO date still ahead of `nowMs`; null for anything else. */
function futureDateOf(value: unknown, nowMs: number): Date | null {
	if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
	const at = Date.parse(value);
	return Number.isNaN(at) || at <= nowMs ? null : new Date(at);
}

function parseOverride(body: unknown, nowMs: number): ParsedOverride | null {
	if (!isRecord(body)) return null;
	const { plan, limits, until, reason } = body;
	if (plan !== null && !isPlanId(plan)) return null;
	const checkedLimits = limits === undefined ? {} : planLimitOverridesFrom(limits);
	const checkedReason = reasonOf(reason);
	if (!checkedLimits || !checkedReason) return null;
	if (until === undefined || until === null) return { plan, limits: checkedLimits, until: null, reason: checkedReason };
	const checkedUntil = futureDateOf(until, nowMs);
	return checkedUntil ? { plan, limits: checkedLimits, until: checkedUntil, reason: checkedReason } : null;
}

function parseGrant(body: unknown): CreditGrantRequest | null {
	if (!isRecord(body)) return null;
	const { credits } = body;
	const reason = reasonOf(body.reason);
	const valid = typeof credits === 'number' && Number.isInteger(credits) && credits >= 1 && credits <= MAX_GRANT_CREDITS;
	return valid && reason ? { credits, reason } : null;
}

/** The override while it still rules the account: not one that ended it, and not one past its date. */
function activeOverride(record: PlanOverrideRecord | null, nowMs: number): AdminBillingView['override'] {
	if (!record || record.plan === null || (record.until !== null && record.until.getTime() <= nowMs)) return null;
	return {
		plan: record.plan,
		limits: overrideLimitsOf(record) ?? {},
		until: record.until?.getTime() ?? null,
		reason: record.reason,
		createdAt: record.createdAt.getTime(),
	};
}

function stripeUrl(env: Env, kind: 'customers' | 'subscriptions', id: string | null): string | null {
	return id === null ? null : `https://dashboard.stripe.com/${stripeModeOf(env) === 'test' ? 'test/' : ''}${kind}/${id}`;
}

async function adminBillingView(env: Env, userId: string): Promise<AdminBillingView> {
	const nowMs = Date.now();
	const account = await loadAccount(env, userId, nowMs);
	const ledger = new CreditLedgerService(env);
	const billing = new BillingService(env);
	// An account outside the billing flag resolves with no subscription, but support still wants its Stripe pages.
	const [credits, purchases, customer, subscription, override, grants] = await Promise.all([
		account.billing ? loadCredits(env, account) : null,
		account.billing ? ledger.purchasesOf(userId) : [],
		billing.customerOf(userId),
		account.billing ? account.subscription : billing.subscriptionOf(userId),
		new PlanAdminService(env).latestOverride(userId),
		ledger.grantsOf(userId, account.period.key),
	]);
	return {
		...billingView(account, credits, purchases, customer !== null),
		userId,
		override: activeOverride(override, nowMs),
		grants: grants.map((grant) => ({ credits: grant.credits, reason: grant.reason, createdAt: grant.createdAt.getTime() })),
		stripeCustomerUrl: stripeUrl(env, 'customers', customer),
		stripeSubscriptionUrl: stripeUrl(env, 'subscriptions', subscription?.stripeSubscriptionId ?? null),
	};
}

export class BillingAdminController extends BaseController {
	static logger = createLogger('BillingAdminController');

	static async get(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<AdminResponse> {
		const userId = context.pathParams.userId;
		try {
			if (!(await this.userExists(env, userId))) return this.createErrorResponse<AdminBillingView>(NO_SUCH_USER, 404);
			return this.createSuccessResponse(await adminBillingView(env, userId));
		} catch (error) {
			return this.handleError(error, "read an account's billing") as AdminResponse;
		}
	}

	static async setPlan(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<AdminResponse> {
		const admin = context.user;
		if (!admin) return this.createErrorResponse<AdminBillingView>('Authentication required', 401);
		const userId = context.pathParams.userId;
		const now = new Date();
		const body = await this.parseJsonBody<unknown>(request);
		const override = body.success ? parseOverride(body.data, now.getTime()) : null;
		if (!override) return this.createErrorResponse<AdminBillingView>(BAD_OVERRIDE, 400);
		try {
			if (!(await this.userExists(env, userId))) return this.createErrorResponse<AdminBillingView>(NO_SUCH_USER, 404);
			await new PlanAdminService(env).addOverride({ userId, ...override, adminUserId: admin.id, now });
			return this.createSuccessResponse(await adminBillingView(env, userId));
		} catch (error) {
			return this.handleError(error, "set an account's plan") as AdminResponse;
		}
	}

	static async grantCredits(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<AdminResponse> {
		const admin = context.user;
		if (!admin) return this.createErrorResponse<AdminBillingView>('Authentication required', 401);
		const userId = context.pathParams.userId;
		const body = await this.parseJsonBody<unknown>(request);
		const grant = body.success ? parseGrant(body.data) : null;
		if (!grant) return this.createErrorResponse<AdminBillingView>(BAD_GRANT, 400);
		try {
			if (!(await this.userExists(env, userId))) return this.createErrorResponse<AdminBillingView>(NO_SUCH_USER, 404);
			const account = await loadAccount(env, userId);
			if (!account.billing) return this.createErrorResponse<AdminBillingView>(BILLING_OFF, 409);
			await new CreditLedgerService(env).addGrant({
				userId,
				period: account.period,
				pool: account.limits.aiCredits,
				...grant,
				adminUserId: admin.id,
				now: new Date(),
			});
			return this.createSuccessResponse(await adminBillingView(env, userId));
		} catch (error) {
			return this.handleError(error, 'grant credits') as AdminResponse;
		}
	}

	/** Test mode only: points an account at a Stripe test-clock customer, so the billing scenarios can run against it. */
	static async linkTestCustomer(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<AdminResponse> {
		const admin = context.user;
		if (!admin) return this.createErrorResponse<AdminBillingView>('Authentication required', 401);
		const userId = context.pathParams.userId;
		const body = await this.parseJsonBody<unknown>(request);
		const stripeCustomerId = body.success && isRecord(body.data) ? body.data.stripeCustomerId : undefined;
		if (typeof stripeCustomerId !== 'string' || !stripeCustomerId.startsWith('cus_')) {
			return this.createErrorResponse<AdminBillingView>('Send the Stripe customer id, which starts with cus_.', 400);
		}
		try {
			if (!(await this.userExists(env, userId))) return this.createErrorResponse<AdminBillingView>(NO_SUCH_USER, 404);
			if (stripeModeOf(env) !== 'test') return this.createErrorResponse<AdminBillingView>('Only in Stripe test mode.', 409);
			const billing = new BillingService(env);
			if (liveSubscription(await billing.subscriptionOf(userId))) return this.createErrorResponse<AdminBillingView>('This account has a live subscription.', 409);
			try {
				await billing.linkCustomer(userId, stripeCustomerId, admin.id, new Date());
			} catch (error) {
				if (isUniqueViolation(error)) return this.createErrorResponse<AdminBillingView>('This Stripe customer belongs to another account.', 409);
				throw error;
			}
			return this.createSuccessResponse(await adminBillingView(env, userId));
		} catch (error) {
			return this.handleError(error, 'link a test customer') as AdminResponse;
		}
	}

	private static async userExists(env: Env, userId: string): Promise<boolean> {
		return (await new UserService(env).findUser({ id: userId })) !== null;
	}
}
