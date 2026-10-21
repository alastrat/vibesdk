/** The email a seller gets for each new order in their stores, at most NEW_ORDER_EMAILS_PER_DAY a UTC day. */

import { createEmailSender } from '../email/sender';
import { configuredBaseUrl } from '../email/links';
import { sellerNewOrderEmail } from '../email/templates';
import type { EmailSender } from '../email/types';
import { SellerOrderService, StoreOrderService } from '../../database';
import { sellerOrderPath } from '../../../shared/types/store-payments';
import type { StoreOrderView } from './store';
import { createLogger } from '../../logger';
import type { Locale } from '../../../shared/i18n/locales';
import { savedUserLocale } from '../i18n/saved-locale';
import { serverT } from '../i18n/server-t';

export const NEW_ORDER_EMAILS_PER_DAY = 100;
const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const STORE_TITLE_MAX = 60;

export interface NewOrderEmailDeps {
	order(orderId: string): Promise<StoreOrderView | null>;
	facts(orderId: string): Promise<{ storeTitle: string | null; sellerEmail: string | null } | null>;
	sender: EmailSender | null;
	counter: { get(key: string): Promise<string | null>; put(key: string, value: string, options: { expirationTtl: number }): Promise<void> };
	baseUrl: string | null;
	now(): Date;
	sellerLocale?(userId: string): Promise<Locale | null>;
}

function storeName(title: string | null): string {
	const clean = (title ?? '').replace(/\s+/g, ' ').trim().slice(0, STORE_TITLE_MAX);
	return clean || 'your store';
}

export async function notifySellerOfNewOrder(deps: NewOrderEmailDeps, orderId: string): Promise<'sent' | 'capped' | 'not-sent'> {
	if (!deps.sender) return 'not-sent';
	const [order, facts] = await Promise.all([deps.order(orderId), deps.facts(orderId)]);
	if (!order || !facts?.sellerEmail) return 'not-sent';
	const key = `seller-order-emails:${order.sellerUserId}:${deps.now().toISOString().slice(0, 10)}`;
	const sentToday = Number((await deps.counter.get(key)) ?? '0');
	if (sentToday >= NEW_ORDER_EMAILS_PER_DAY) return 'capped';
	const address = order.shippingAddress;
	const locale = await deps.sellerLocale?.(order.sellerUserId).catch(() => null) ?? 'en';
	await deps.sender.send(
		sellerNewOrderEmail(facts.sellerEmail, {
			storeTitle: facts.storeTitle?.trim() ? storeName(facts.storeTitle) : serverT(locale).t('your store'),
			orderNumber: order.orderNumber,
			test: order.mode === 'test',
			totalCents: order.totalCents,
			shareCents: order.totalCents - order.applicationFeeCents,
			items: order.items.map((item) => ({ name: item.name, quantity: item.quantity, kind: item.kind })),
			shipTo: address ? { name: address.name, city: address.city, region: address.region, countryCode: address.countryCode } : null,
			note: order.note,
			link: deps.baseUrl ? `${deps.baseUrl}${sellerOrderPath(order.id)}` : null,
		}, locale),
	);
	await deps.counter.put(key, String(sentToday + 1), { expirationTtl: TWO_DAYS_SECONDS });
	return 'sent';
}

const logger = createLogger('SellerOrderEmails');

/** Never throws: a lost email must not undo or retry an order; the Orders page always has it. */
export function newOrderNotifier(deps: NewOrderEmailDeps): (orderId: string) => Promise<void> {
	return async (orderId) => {
		try {
			const outcome = await notifySellerOfNewOrder(deps, orderId);
			if (outcome === 'capped') logger.warn('New-order email skipped: daily cap reached', { orderId });
		} catch (error) {
			logger.error('Could not email the seller about a new order', { orderId, error });
		}
	};
}

export function newOrderNotifierFromEnv(env: Env): (orderId: string) => Promise<void> {
	return newOrderNotifier({
		order: (orderId) => new StoreOrderService(env).getOrder(orderId),
		facts: (orderId) => new SellerOrderService(env).newOrderEmailFacts(orderId),
		sender: createEmailSender(env),
		counter: env.VibecoderStore,
		baseUrl: configuredBaseUrl(env),
		now: () => new Date(),
		sellerLocale: (userId) => savedUserLocale(env, userId),
	});
}
