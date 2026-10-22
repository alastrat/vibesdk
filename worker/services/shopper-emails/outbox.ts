/**
 * The shopper email outbox: each order event is written once, then sent at once and, when Cloudflare defers it,
 * again on the 15-minute schedule with backoff. Nothing here throws to the operation that raised the event.
 */

import { DEFAULT_SHOPPER_EMAIL_TEMPLATES, type ShopperEmailKind, type ShopperEmailStatus } from '../../../shared/types/shopper-emails';
import type { ShopperEmailPayload, ShopperEmailRow, ShopperEmailService } from '../../database/services/ShopperEmailService';
import type { EmailSender, SentEmail } from '../email/types';
import { classifySendError } from '../email/send-errors';
import type { StoreOrderView } from '../store-payments/store';
import { renderShopperEmail, testOrderNote, type ShopperEmailContent } from './template';
import { createLogger } from '../../logger';

export interface ShopperEmailEvent {
	orderId: string;
	kind: ShopperEmailKind;
	/** One email per order, kind and key: `order`, `own`, `catalog:{id}` or a refund request id. */
	eventKey: string;
	payload: ShopperEmailPayload;
}

export interface ShopperEmailStoreFacts {
	title: string | null;
	sellerEmail: string | null;
	/** Test emails go only to a confirmed address, so an account can't aim Estori's email at a stranger. */
	sellerEmailConfirmed: boolean;
	/** The live store's address, when it's live. */
	storeUrl: string | null;
	/** The store's own sender address, such as northwind-tea@orders.estori.app. */
	fromEmail: string;
}

export interface ShopperEmailDeps {
	/** The seller's current entitlement, checked at send time, including scheduled retries. */
	access(sellerUserId: string): Promise<{ canSend: boolean; canCustomize: boolean }>;
	emails: Pick<ShopperEmailService, 'enqueue' | 'claim' | 'finish' | 'retry' | 'due' | 'templates' | 'replyTo' | 'sentSince'>;
	order(orderId: string): Promise<StoreOrderView | null>;
	store(appId: string): Promise<ShopperEmailStoreFacts | null>;
	sender: EmailSender | null;
	/** The shared sender address, for a store that no longer exists. */
	fromEmail: string;
	alert(alert: { kind: 'shopper-email-failed' | 'shopper-email-capped'; subject: string; message: string }): Promise<void>;
	now(): Date;
	newId(): string;
}

/** Each store sends at most this many shopper emails a UTC day, to protect the account's sending reputation. */
export const STORE_DAILY_EMAIL_CAP = 1000;
export const MAX_SEND_ATTEMPTS = 5;
const MINUTE = 60 * 1000;
/** The wait before attempts 2 to 5. */
export const SEND_BACKOFF_MS: readonly number[] = [15 * MINUTE, 60 * MINUTE, 4 * 60 * MINUTE, 12 * 60 * MINUTE];
/** How long a claimed email is held from other runs while it sends. */
const LEASE_MS = 15 * MINUTE;
const STORE_NAME_MAX = 60;

const logger = createLogger('ShopperEmails');

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function missingRecipient(test: boolean, store: ShopperEmailStoreFacts | null): string {
	if (!test) return 'The order has no email address';
	return store?.sellerEmail ? "The seller's email address isn't confirmed" : 'The seller has no email address';
}

export function storeName(title: string | null): string {
	return (title ?? '').replace(/\s+/g, ' ').replace(/[<>"]/g, '').trim().slice(0, STORE_NAME_MAX) || 'Your store';
}

function startOfUtcDay(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The lines an event is about: its line numbers or catalog items, else the whole order. */
function itemsFor(order: StoreOrderView, payload: ShopperEmailPayload) {
	const chosen = order.items.filter(
		(item) => payload.lineNos?.includes(item.lineNo) || (item.catalogVariantId !== null && payload.catalogVariantIds?.includes(item.catalogVariantId)),
	);
	return (chosen.length > 0 ? chosen : order.items).map((item) => ({ name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents }));
}

export function contentFor(row: Pick<ShopperEmailRow, 'kind' | 'payload'>, order: StoreOrderView, store: ShopperEmailStoreFacts | null): ShopperEmailContent {
	const address = order.shippingAddress;
	return {
		kind: row.kind,
		storeName: storeName(store?.title ?? null),
		orderNumber: order.orderNumber,
		customerName: order.customerName,
		totalCents: order.totalCents,
		items: itemsFor(order, row.payload),
		shipTo: address ? [address.city, address.region, address.countryCode].filter(Boolean).join(', ') : null,
		carrier: row.payload.carrier ?? null,
		trackingNumber: row.payload.trackingNumber ?? null,
		refundCents: row.payload.amountCents ?? null,
		storeUrl: store?.storeUrl ?? null,
		testNote: order.mode === 'test' ? testOrderNote(order.customerEmail) : null,
	};
}

/** Takes a send to finish after the caller answers, such as `ctx.waitUntil`. */
export type DeferSend = (sending: Promise<unknown>) => void;

/**
 * Writes the event's email once, then sends it: at once, or through `defer` so a request needn't wait on Email
 * Service. A send that doesn't finish is picked up by the schedule. Never throws.
 */
export async function queueShopperEmail(deps: ShopperEmailDeps, event: ShopperEmailEvent, defer?: DeferSend): Promise<void> {
	try {
		const order = await deps.order(event.orderId);
		if (!order) return;
		const id = deps.newId();
		const queued = await deps.emails.enqueue({ id, appId: order.appId, orderId: order.id, kind: event.kind, eventKey: event.eventKey, payload: event.payload, now: deps.now() });
		if (!queued) return;
		const sending = sendShopperEmail(deps, id).catch((error: unknown) => logger.error('Could not send a shopper email', { id, error }));
		if (defer) defer(sending);
		else await sending;
	} catch (error) {
		logger.error('Could not queue a shopper email', { event, error });
	}
}

/** Sends one queued email if it's due and no other run holds it. */
export async function sendShopperEmail(deps: ShopperEmailDeps, id: string): Promise<ShopperEmailStatus | 'skipped'> {
	const now = deps.now();
	const row = await deps.emails.claim(id, now, new Date(now.getTime() + LEASE_MS));
	if (!row) return 'skipped';
	const order = await deps.order(row.orderId);
	if (!order) {
		await deps.emails.finish(id, { status: 'failed', recipient: null, test: false, error: 'The order no longer exists' });
		return 'failed';
	}
	const test = order.mode === 'test';
	const access = await deps.access(order.sellerUserId);
	if (!access.canSend) {
		await deps.emails.finish(id, { status: 'disabled', recipient: test ? null : order.customerEmail, test, error: 'Shopper emails are not included in the seller account.' });
		return 'disabled';
	}

	const [store, templates, replyTo] = await Promise.all([deps.store(order.appId), deps.emails.templates(order.appId), deps.emails.replyTo(order.appId)]);
	const saved = templates.get(row.kind);
	const template = access.canCustomize && saved ? saved : { enabled: saved?.enabled ?? true, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES[row.kind] };
	const recipient = test ? (store?.sellerEmailConfirmed ? store.sellerEmail : null) : order.customerEmail;
	if (!template.enabled) {
		await deps.emails.finish(id, { status: 'disabled', recipient, test });
		return 'disabled';
	}
	if (!recipient) {
		await deps.emails.finish(id, { status: 'failed', recipient: null, test, error: missingRecipient(test, store) });
		return 'failed';
	}
	if (!deps.sender) {
		await deps.emails.finish(id, { status: 'failed', recipient, test, error: 'Email sending is not set up' });
		return 'failed';
	}
	if ((await deps.emails.sentSince(order.appId, startOfUtcDay(now))) >= STORE_DAILY_EMAIL_CAP) {
		await deps.emails.finish(id, { status: 'capped', recipient, test });
		await deps.alert({ kind: 'shopper-email-capped', subject: order.appId, message: `A store reached ${STORE_DAILY_EMAIL_CAP} shopper emails today, so the rest of today's aren't sent.` });
		return 'capped';
	}

	const content = contentFor(row, order, store);
	const email = renderShopperEmail(template, content);
	let result: SentEmail | void;
	try {
		result = await deps.sender.send({
			to: recipient,
			subject: email.subject,
			html: email.html,
			text: email.text,
			fromEmail: store?.fromEmail ?? deps.fromEmail,
			fromName: content.storeName,
			replyTo: (access.canCustomize ? replyTo : null) ?? store?.sellerEmail ?? undefined,
			headers: { 'X-Estori-Store': order.appId, 'X-Estori-Email': row.kind },
		});
	} catch (error) {
		const outcome = classifySendError(error);
		if (outcome === 'suppressed') {
			await deps.emails.finish(id, { status: 'suppressed', recipient, test, error: errorText(error) });
			return 'suppressed';
		}
		if (outcome === 'retry' && row.attempts < MAX_SEND_ATTEMPTS) {
			await deps.emails.retry(id, new Date(now.getTime() + SEND_BACKOFF_MS[row.attempts - 1]), errorText(error));
			return 'queued';
		}
		await deps.emails.finish(id, { status: 'failed', recipient, test, error: errorText(error) });
		await deps.alert({ kind: 'shopper-email-failed', subject: order.appId, message: `A ${row.kind.replace(/_/g, ' ')} email for order #${order.orderNumber} could not be sent: ${errorText(error)}` });
		return 'failed';
	}
	// It went out, so a failure to record it isn't a send failure: the lease lets a later run try again, at least once.
	try {
		await deps.emails.finish(id, { status: 'sent', recipient, test, messageId: result?.messageId ?? null, sentAt: deps.now() });
	} catch (error) {
		logger.error('Shopper email sent but not recorded', { id, messageId: result?.messageId, error });
		throw error;
	}
	return 'sent';
}

/** Sends the emails that came due, oldest first, one at a time; returns how many it tried. */
export async function sendDueShopperEmails(deps: ShopperEmailDeps, limit: number): Promise<number> {
	const ids = await deps.emails.due(deps.now(), limit);
	let tried = 0;
	for (const id of ids) {
		try {
			if ((await sendShopperEmail(deps, id)) !== 'skipped') tried += 1;
		} catch (error) {
			logger.error('Could not send a shopper email', { id, error });
		}
	}
	return tried;
}
