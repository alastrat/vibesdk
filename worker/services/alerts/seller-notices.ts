/** Emails to sellers about their store: a reached limit, or items Estori refunded. Once a day per kind and subject. */

import { createEmailSender } from '../email/sender';
import { sellerItemsRefundedEmail, sellerLimitReachedEmail } from '../email/templates';
import type { EmailSender } from '../email/types';
import { UserService } from '../../database';
import { createLogger } from '../../logger';

export type SellerNotice =
	| { sellerUserId: string; kind: 'limit-reached'; weeklySalesCents: number }
	| { sellerUserId: string; kind: 'items-refunded'; orderId: string; itemCount: number; reason: 'supplier' | 'risk' };

export interface SellerNoticeDeps {
	throttle: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
	sender: EmailSender | null;
	sellerEmail(sellerUserId: string): Promise<string | null>;
}

const DAY_SECONDS = 24 * 60 * 60;

export async function sendSellerNotice(deps: SellerNoticeDeps, notice: SellerNotice): Promise<'sent' | 'throttled' | 'not-sent'> {
	const subject = notice.kind === 'limit-reached' ? notice.sellerUserId : notice.orderId;
	const key = `seller-notice:${notice.kind}:${subject}`;
	if (await deps.throttle.get(key)) return 'throttled';
	const to = await deps.sellerEmail(notice.sellerUserId);
	if (!deps.sender || !to) return 'not-sent';
	await deps.sender.send(notice.kind === 'limit-reached' ? sellerLimitReachedEmail(to, notice.weeklySalesCents) : sellerItemsRefundedEmail(to, notice.itemCount, notice.reason));
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
