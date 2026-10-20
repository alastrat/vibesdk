/** Sends billing's emails, once each: a notice is claimed under its key in `billing_notices` before it goes out. */

import { BillingService, UserService } from '../../database';
import { createLogger } from '../../logger';
import { BILLING_PATH, type BillingNoticeKind } from '../../../shared/types/billing';
import type { PaidPlanId, PlanId } from '../../../shared/types/plans';
import {
	creditsLowEmail,
	creditsReceiptEmail,
	creditsRefundedEmail,
	creditsRenewedEmail,
	downgradeScheduledEmail,
	enforcementNoticeEmail,
	paymentFailedEmail,
	planEndedEmail,
	planEndingEmail,
	planReceiptEmail,
	planStartedEmail,
	planUpgradedEmail,
	type BillingLinks,
} from '../email/billing-templates';
import { configuredBaseUrl } from '../email/links';
import { createEmailSender } from '../email/sender';
import type { EmailSender, OutgoingEmail } from '../email/types';

const PRICING_PATH = '/pricing';

/** One email per kind of notice, with what its copy needs. */
export type BillingEmail =
	| { kind: 'plan_started'; plan: PaidPlanId; renewsAt: number }
	| { kind: 'receipt'; plan: PaidPlanId; amountCents: number; currency: string; periodStart: number; periodEnd: number; invoiceNumber: string | null; invoiceUrl: string | null }
	| { kind: 'plan_upgraded'; plan: PaidPlanId }
	| { kind: 'downgrade_scheduled'; plan: PaidPlanId; at: number }
	| { kind: 'payment_failed'; plan: PaidPlanId; graceEndsAt: number }
	| { kind: 'plan_ending'; plan: PaidPlanId; endsAt: number }
	| { kind: 'plan_ended'; plan: PaidPlanId; reason: 'cancelled' | 'payment-failed' }
	| { kind: 'credits_renewed'; credits: number; renewsAt: number }
	| { kind: 'credits_20' | 'credits_5'; plan: PlanId; left: number; renewsAt: number }
	| { kind: 'credits_receipt'; credits: number; amountCents: number; expiresAt: number; receiptNumber: string }
	| { kind: 'credits_refunded'; credits: number; amountCents: number }
	| { kind: 'enforcement_notice'; startsOn: number; overLimits: boolean };

/** An email and the key it is recorded under, so it goes out once. */
export interface PlannedNotice {
	key: string;
	email: BillingEmail;
}

export interface BillingMailDeps {
	sender: EmailSender | null;
	userEmail(userId: string): Promise<string | null>;
	/** The deployment's address for the emails' links; null drops their buttons. */
	baseUrl: string | null;
}

export type ClaimingMailDeps = BillingMailDeps & {
	/** True for the caller that records the notice first. */
	claim(userId: string, key: string, kind: BillingNoticeKind): Promise<boolean>;
};

const logger = createLogger('BillingNotices');

function linksFor(baseUrl: string | null): BillingLinks {
	return { billing: baseUrl ? `${baseUrl}${BILLING_PATH}` : null, pricing: baseUrl ? `${baseUrl}${PRICING_PATH}` : null };
}

export function billingEmail(to: string, email: BillingEmail, baseUrl: string | null): OutgoingEmail {
	const links = linksFor(baseUrl);
	switch (email.kind) {
		case 'plan_started':
			return planStartedEmail(to, email, links);
		case 'receipt':
			return planReceiptEmail(to, email);
		case 'plan_upgraded':
			return planUpgradedEmail(to, email, links);
		case 'downgrade_scheduled':
			return downgradeScheduledEmail(to, email, links);
		case 'payment_failed':
			return paymentFailedEmail(to, email, links);
		case 'plan_ending':
			return planEndingEmail(to, email, links);
		case 'plan_ended':
			return planEndedEmail(to, email, links);
		case 'credits_renewed':
			return creditsRenewedEmail(to, email, links);
		case 'credits_20':
		case 'credits_5':
			return creditsLowEmail(to, email, links);
		case 'credits_receipt':
			return creditsReceiptEmail(to, email, links);
		case 'credits_refunded':
			return creditsRefundedEmail(to, email, links);
		case 'enforcement_notice':
			return enforcementNoticeEmail(to, email, links);
	}
}

/** Sends each notice to the account's address; one that fails is logged and the rest still go. Answers how many were sent. */
export async function sendBillingEmails(deps: BillingMailDeps, userId: string, notices: readonly PlannedNotice[]): Promise<number> {
	const { sender } = deps;
	if (!sender || notices.length === 0) return 0;
	try {
		const to = await deps.userEmail(userId);
		if (!to) return 0;
		let sent = 0;
		for (const notice of notices) {
			try {
				await sender.send(billingEmail(to, notice.email, deps.baseUrl));
				sent += 1;
			} catch (error) {
				logger.error('Could not send a billing email', { userId, kind: notice.email.kind, key: notice.key, error });
			}
		}
		return sent;
	} catch (error) {
		logger.error('Could not look up the address for billing emails', { userId, error });
		return 0;
	}
}

/** Claims the notice, then sends it: a notice already claimed is not sent again. */
export async function claimAndSendNotice(deps: ClaimingMailDeps, userId: string, notice: PlannedNotice): Promise<'sent' | 'already-sent' | 'not-sent'> {
	try {
		if (!(await deps.claim(userId, notice.key, notice.email.kind))) return 'already-sent';
		return (await sendBillingEmails(deps, userId, [notice])) === 1 ? 'sent' : 'not-sent';
	} catch (error) {
		logger.error('Could not claim a billing notice', { userId, kind: notice.email.kind, key: notice.key, error });
		return 'not-sent';
	}
}

export function billingMailFromEnv(env: Env): BillingMailDeps {
	return {
		sender: createEmailSender(env),
		userEmail: async (userId) => (await new UserService(env).findUser({ id: userId }))?.email ?? null,
		baseUrl: configuredBaseUrl(env),
	};
}

export function claimingMailFromEnv(env: Env): ClaimingMailDeps {
	return { ...billingMailFromEnv(env), claim: (userId, key, kind) => new BillingService(env).claimNotice(userId, key, kind, new Date()) };
}
