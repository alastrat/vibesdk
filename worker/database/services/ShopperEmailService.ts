/** D1 for shopper emails: each store's templates and reply-to setting, and the outbox that sends each order event's email once. */

import { and, asc, desc, eq, exists, gte, inArray, isNotNull, lt, lte, sql, type SQLWrapper } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { DEFAULT_SHOPPER_EMAIL_TEMPLATES, type ShopperEmailKind, type ShopperEmailStatus, type ShopperEmailStoreOption, type ShopperEmailTemplate } from '../../../shared/types/shopper-emails';

/** What an event adds to its email: the lines or catalog items it's about, tracking, and a refund amount. */
export interface ShopperEmailPayload {
    lineNos?: number[];
    catalogVariantIds?: string[];
    carrier?: string | null;
    trackingNumber?: string | null;
    amountCents?: number;
}

export interface ShopperEmailRow {
    id: string;
    appId: string;
    orderId: string;
    kind: ShopperEmailKind;
    eventKey: string;
    payload: ShopperEmailPayload;
    status: ShopperEmailStatus;
    test: boolean;
    recipient: string | null;
    attempts: number;
    nextAttemptAt: Date;
    messageId: string | null;
    error: string | null;
    createdAt: Date;
    sentAt: Date | null;
}

function payloadOf(json: string): ShopperEmailPayload {
    try {
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === 'object' ? (parsed as ShopperEmailPayload) : {};
    } catch {
        return {};
    }
}

type EmailRecord = typeof schema.shopperEmails.$inferSelect;

function rowOf(record: EmailRecord): ShopperEmailRow {
    return { ...record, payload: payloadOf(record.payload) };
}

/** The outbox wrote the order's confirmation: orders from before shopper emails have none, and are left alone. */
function confirmationWritten(orderId: SQLWrapper) {
    return sql`EXISTS (SELECT 1 FROM shopper_emails c WHERE c.order_id = ${orderId} AND c.kind = 'order_confirmation')`;
}

/** No refund email names this line of the order yet. */
function refundLineNotEmailed(orderId: SQLWrapper, lineNo: SQLWrapper) {
    return sql`NOT EXISTS (SELECT 1 FROM shopper_emails e, json_each(e.payload, '$.lineNos') j WHERE e.order_id = ${orderId} AND e.kind = 'refund_issued' AND j.value = ${lineNo})`;
}

/** No shipped email covers this supplier shipment of the order yet. */
function shipmentNotEmailed(orderId: SQLWrapper, supplierOrderId: SQLWrapper) {
    return sql`NOT EXISTS (SELECT 1 FROM shopper_emails e WHERE e.order_id = ${orderId} AND e.kind = 'order_shipped' AND e.event_key = 'catalog:' || ${supplierOrderId})`;
}

/** A catalog item on its way with tracking, on a supplier shipment no shipped email covers yet. */
function unemailedShipment() {
    return and(
        inArray(schema.catalogOrderItems.status, ['shipped', 'delivered']),
        isNotNull(schema.catalogOrderItems.supplierOrderId),
        isNotNull(schema.catalogOrderItems.trackingNumber),
        shipmentNotEmailed(schema.storeOrders.id, schema.catalogOrderItems.supplierOrderId),
    );
}

export class ShopperEmailService extends BaseService {
    /** The templates a store saved; a kind with none uses Estori's default. */
    async templates(appId: string): Promise<Map<ShopperEmailKind, ShopperEmailTemplate>> {
        const rows = await this.database.select().from(schema.shopperEmailTemplates).where(eq(schema.shopperEmailTemplates.appId, appId)).all();
        return new Map(rows.map((row) => [row.kind, { enabled: row.enabled, subject: row.subject, heading: row.heading, body: row.body }]));
    }

    async saveTemplate(appId: string, kind: ShopperEmailKind, template: ShopperEmailTemplate, now: Date): Promise<void> {
        await this.database
            .insert(schema.shopperEmailTemplates)
            .values({ appId, kind, ...template, updatedAt: now })
            .onConflictDoUpdate({ target: [schema.shopperEmailTemplates.appId, schema.shopperEmailTemplates.kind], set: { ...template, updatedAt: now } })
            .run();
    }

    /** Back to Estori's text. A switched-off email stays off, and the template that keeps it off is returned; otherwise null. */
    async resetTemplate(appId: string, kind: ShopperEmailKind, now: Date): Promise<ShopperEmailTemplate | null> {
        if ((await this.templates(appId)).get(kind)?.enabled === false) {
            const off = { enabled: false, ...DEFAULT_SHOPPER_EMAIL_TEMPLATES[kind] };
            await this.saveTemplate(appId, kind, off, now);
            return off;
        }
        await this.database.delete(schema.shopperEmailTemplates).where(and(eq(schema.shopperEmailTemplates.appId, appId), eq(schema.shopperEmailTemplates.kind, kind))).run();
        return null;
    }

    async replyTo(appId: string): Promise<string | null> {
        const row = await this.database.select({ replyTo: schema.shopperEmailSettings.replyTo }).from(schema.shopperEmailSettings).where(eq(schema.shopperEmailSettings.appId, appId)).get();
        return row?.replyTo ?? null;
    }

    async saveReplyTo(appId: string, replyTo: string | null, now: Date): Promise<void> {
        await this.database
            .insert(schema.shopperEmailSettings)
            .values({ appId, replyTo, updatedAt: now })
            .onConflictDoUpdate({ target: schema.shopperEmailSettings.appId, set: { replyTo, updatedAt: now } })
            .run();
    }

    /** Queues an event's email; false when this event already has one, so a repeated event sends nothing. */
    async enqueue(row: { id: string; appId: string; orderId: string; kind: ShopperEmailKind; eventKey: string; payload: ShopperEmailPayload; now: Date }): Promise<boolean> {
        const written = await this.database
            .insert(schema.shopperEmails)
            .values({ id: row.id, appId: row.appId, orderId: row.orderId, kind: row.kind, eventKey: row.eventKey, payload: JSON.stringify(row.payload), status: 'queued', nextAttemptAt: row.now, createdAt: row.now })
            .onConflictDoNothing()
            .returning({ id: schema.shopperEmails.id });
        return written.length > 0;
    }

    /** Takes a due queued email for one send, pushing its next attempt to `leaseUntil`; null when it isn't due or another run has it. */
    async claim(id: string, now: Date, leaseUntil: Date): Promise<ShopperEmailRow | null> {
        const emails = schema.shopperEmails;
        const [record] = await this.database
            .update(emails)
            .set({ attempts: sql`${emails.attempts} + 1`, nextAttemptAt: leaseUntil })
            .where(and(eq(emails.id, id), eq(emails.status, 'queued'), lte(emails.nextAttemptAt, now)))
            .returning();
        return record ? rowOf(record) : null;
    }

    async finish(id: string, update: { status: ShopperEmailStatus; recipient: string | null; test: boolean; messageId?: string | null; error?: string | null; sentAt?: Date | null }): Promise<void> {
        await this.database
            .update(schema.shopperEmails)
            .set({ status: update.status, recipient: update.recipient, test: update.test, messageId: update.messageId ?? null, error: update.error ?? null, sentAt: update.sentAt ?? null })
            .where(eq(schema.shopperEmails.id, id))
            .run();
    }

    /** Leaves a claimed email queued for a later attempt, with why this one failed. */
    async retry(id: string, nextAttemptAt: Date, error: string): Promise<void> {
        await this.database.update(schema.shopperEmails).set({ nextAttemptAt, error }).where(eq(schema.shopperEmails.id, id)).run();
    }

    async due(now: Date, limit: number): Promise<string[]> {
        const emails = schema.shopperEmails;
        const rows = await this.database
            .select({ id: emails.id })
            .from(emails)
            .where(and(eq(emails.status, 'queued'), lte(emails.nextAttemptAt, now)))
            .orderBy(asc(emails.nextAttemptAt))
            .limit(limit)
            .all();
        return rows.map((row) => row.id);
    }

    /** Emails this store sent since `since`, for its daily cap. */
    async sentSince(appId: string, since: Date): Promise<number> {
        const emails = schema.shopperEmails;
        const row = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(emails)
            .where(and(eq(emails.appId, appId), eq(emails.status, 'sent'), gte(emails.sentAt, since)))
            .get();
        return Number(row?.count ?? 0);
    }

    async recent(appId: string, limit: number): Promise<Array<ShopperEmailRow & { orderNumber: number | null }>> {
        const emails = schema.shopperEmails;
        const rows = await this.database
            .select({ email: emails, orderNumber: schema.storeOrders.orderNumber })
            .from(emails)
            .leftJoin(schema.storeOrders, eq(schema.storeOrders.id, emails.orderId))
            .where(eq(emails.appId, appId))
            .orderBy(desc(emails.createdAt), desc(emails.id))
            .limit(limit)
            .all();
        return rows.map((row) => ({ ...rowOf(row.email), orderNumber: row.orderNumber }));
    }

    async prune(before: Date): Promise<void> {
        await this.database.delete(schema.shopperEmails).where(lt(schema.shopperEmails.createdAt, before)).run();
    }

    /** The user's stores: their apps with a live store or an order, for the Emails page's picker. */
    async storesOf(userId: string): Promise<ShopperEmailStoreOption[]> {
        const apps = schema.apps;
        const rows = await this.database
            .select({ appId: apps.id, title: apps.title })
            .from(apps)
            .where(
                and(
                    eq(apps.userId, userId),
                    sql`(${exists(this.database.select({ one: sql`1` }).from(schema.liveStores).where(eq(schema.liveStores.appId, apps.id)))} OR ${exists(this.database.select({ one: sql`1` }).from(schema.storeOrders).where(eq(schema.storeOrders.appId, apps.id)))})`,
                ),
            )
            .orderBy(asc(apps.title))
            .all();
        return rows;
    }

    /** What a store's emails show and where test orders go: its title, its seller's email and whether it's confirmed, its slug, and the slug again while it's live. */
    async storeFacts(appId: string): Promise<{ title: string | null; sellerEmail: string | null; sellerEmailConfirmed: boolean; slug: string | null; liveSlug: string | null } | null> {
        const row = await this.database
            .select({ title: schema.apps.title, sellerEmail: schema.users.email, confirmed: schema.users.emailVerified, slug: schema.liveStores.slug, status: schema.liveStores.status })
            .from(schema.apps)
            .leftJoin(schema.users, eq(schema.users.id, schema.apps.userId))
            .leftJoin(schema.liveStores, eq(schema.liveStores.appId, schema.apps.id))
            .where(eq(schema.apps.id, appId))
            .get();
        if (!row) return null;
        return { title: row.title, sellerEmail: row.sellerEmail, sellerEmailConfirmed: row.confirmed === true, slug: row.slug, liveSlug: row.status === 'live' ? row.slug : null };
    }

    /** Refunded lines of the order that no refund email names yet; a refund Stripe never made isn't one. */
    async refundsToEmail(orderId: string): Promise<Array<{ lineNo: number; amountCents: number }>> {
        const refunds = schema.storeRefunds;
        return this.database
            .select({ lineNo: refunds.lineNo, amountCents: refunds.amountCents })
            .from(refunds)
            .where(and(eq(refunds.orderId, orderId), isNotNull(refunds.stripeRefundId), refundLineNotEmailed(refunds.orderId, refunds.lineNo)))
            .orderBy(asc(refunds.lineNo))
            .all();
    }

    /** The order's catalog shipments with tracking that no shipped email covers yet, one per supplier order. */
    async catalogShipmentsToEmail(orderId: string): Promise<Array<{ supplierOrderId: string; carrier: string | null; trackingNumber: string; catalogVariantIds: string[] }>> {
        const rows = await this.database
            .select({ supplierOrderId: schema.catalogOrderItems.supplierOrderId, carrier: schema.catalogOrderItems.carrier, trackingNumber: schema.catalogOrderItems.trackingNumber, catalogVariantId: schema.catalogOrderItems.catalogVariantId })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrders.id, schema.catalogOrderItems.orderId))
            .innerJoin(schema.storeOrders, eq(schema.storeOrders.stripeCheckoutSessionId, schema.catalogOrders.stripeCheckoutSessionId))
            .where(and(eq(schema.storeOrders.id, orderId), unemailedShipment()))
            .orderBy(asc(schema.catalogOrderItems.supplierOrderId), asc(schema.catalogOrderItems.id))
            .all();
        const shipments = new Map<string, { supplierOrderId: string; carrier: string | null; trackingNumber: string; catalogVariantIds: string[] }>();
        for (const row of rows) {
            if (!row.supplierOrderId || !row.trackingNumber) continue;
            const shipment = shipments.get(row.supplierOrderId) ?? { supplierOrderId: row.supplierOrderId, carrier: row.carrier, trackingNumber: row.trackingNumber, catalogVariantIds: [] };
            shipment.catalogVariantIds.push(row.catalogVariantId);
            shipments.set(row.supplierOrderId, shipment);
        }
        return [...shipments.values()];
    }

    /** Orders with a refund made between `since` and `before` that no refund email names. */
    async ordersWithRefundsToEmail(since: Date, before: Date, limit: number): Promise<string[]> {
        const refunds = schema.storeRefunds;
        const rows = await this.database
            .selectDistinct({ orderId: refunds.orderId })
            .from(refunds)
            .where(
                and(
                    isNotNull(refunds.stripeRefundId),
                    gte(refunds.createdAt, since),
                    lt(refunds.createdAt, before),
                    confirmationWritten(refunds.orderId),
                    refundLineNotEmailed(refunds.orderId, refunds.lineNo),
                ),
            )
            .limit(limit)
            .all();
        return rows.map((row) => row.orderId);
    }

    /** Orders with catalog items shipped since `since` that no shipped email covers. */
    async ordersWithShipmentsToEmail(since: Date, limit: number): Promise<string[]> {
        const rows = await this.database
            .selectDistinct({ orderId: schema.storeOrders.id })
            .from(schema.catalogOrderItems)
            .innerJoin(schema.catalogOrders, eq(schema.catalogOrders.id, schema.catalogOrderItems.orderId))
            .innerJoin(schema.storeOrders, eq(schema.storeOrders.stripeCheckoutSessionId, schema.catalogOrders.stripeCheckoutSessionId))
            .where(and(gte(schema.catalogOrderItems.updatedAt, since), confirmationWritten(schema.storeOrders.id), unemailedShipment()))
            .limit(limit)
            .all();
        return rows.map((row) => row.orderId);
    }
}
