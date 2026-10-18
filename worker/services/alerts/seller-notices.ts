/** Emails to sellers about their store: a reached limit, items Estori refunded, or a domain whose DNS went. Once a day per kind and subject. */

import { createEmailSender } from '../email/sender';
import { sellerDomainUnreachableEmail, sellerItemsRefundedEmail, sellerLimitReachedEmail } from '../email/templates';
import type { EmailSender, OutgoingEmail } from '../email/types';
import { UserService } from '../../database';
import { createLogger } from '../../logger';

export type SellerNotice =
	| { sellerUserId: string; kind: 'limit-reached'; weeklySalesCents: number }
	| { sellerUserId: string; kind: 'items-refunded'; orderId: string; itemCount: number; reason: 'supplier' | 'risk' }
	| { sellerUserId: string; kind: 'domain-unreachable'; hostname: string };

export interface SellerNoticeDeps {
	throttle: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
	sender: EmailSender | null;
	sellerEmail(sellerUserId: string): Promise<string | null>;
}

const DAY_SECONDS = 24 * 60 * 60;

/** What a notice is about, so each is sent once a day: the seller's store, an order, or a domain. */
function subjectOf(notice: SellerNotice): string {
	switch (notice.kind) {
		case 'limit-reached':
			return notice.sellerUserId;
		case 'items-refunded':
			return notice.orderId;
		case 'domain-unreachable':
			return notice.hostname;
	}
}

function emailFor(to: string, notice: SellerNotice): OutgoingEmail {
	switch (notice.kind) {
		case 'limit-reached':
			return sellerLimitReachedEmail(to, notice.weeklySalesCents);
		case 'items-refunded':
			return sellerItemsRefundedEmail(to, notice.itemCount, notice.reason);
		case 'domain-unreachable':
			return sellerDomainUnreachableEmail(to, notice.hostname);
	}
}

export async function sendSellerNotice(deps: SellerNoticeDeps, notice: SellerNotice): Promise<'sent' | 'throttled' | 'not-sent'> {
	const key = `seller-notice:${notice.kind}:${subjectOf(notice)}`;
	if (await deps.throttle.get(key)) return 'throttled';
	const to = await deps.sellerEmail(notice.sellerUserId);
	if (!deps.sender || !to) return 'not-sent';
	await deps.sender.send(emailFor(to, notice));
	await deps.throttle.put(key, '1', { expirationTtl: DAY_SECONDS });
	return 'sent';
}

const logger = createLogger('SellerNotices');

export function sellerNoticesFromEnv(env: Env): (notice: SellerNotice) => Promise<void> {
	const deps: SellerNoticeDeps = {
		throttle: env.VibecoderStore,
		sender: createEmailSender(env),
		sellerEmail: async (userId) => (await new UserService(env).findUser({ id: userId }))?.email ?? null,
	};
	return async (notice) => {
		try {
			await sendSellerNotice(deps, notice);
		} catch (error) {
			logger.error('Could not email a seller notice', { notice, error });
		}
	};
}
