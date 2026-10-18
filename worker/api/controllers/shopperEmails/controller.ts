/** A seller's shopper emails: each store's templates and reply-to setting, previews and test sends. Store routes are owner-only. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import { ShopperEmailService } from '../../../database';
import type { ShopperEmailRow } from '../../../database/services/ShopperEmailService';
import {
    DEFAULT_SHOPPER_EMAIL_TEMPLATES,
    SHOPPER_EMAIL_KINDS,
    SHOPPER_EMAIL_PLACEHOLDERS,
    isShopperEmailKind,
    type RecentShopperEmail,
    type ShopperEmailKind,
    type ShopperEmailPreview,
    type ShopperEmailSettings,
    type ShopperEmailsData,
    type ShopperEmailStoresData,
    type ShopperEmailTemplate,
    type ShopperEmailTemplateView,
    type ShopperEmailTestResult,
} from '../../../../shared/types/shopper-emails';
import { createEmailSender } from '../../../services/email/sender';
import { storeName } from '../../../services/shopper-emails/outbox';
import { maskEmail, renderShopperEmail, sampleContent, TEMPLATE_TEST_NOTE } from '../../../services/shopper-emails/template';
import { shopperEmailStoreFromEnv } from '../../../services/shopper-emails/wiring';
import { parseReplyTo, parseTemplateFields, parseTemplateRequest } from './template-request';

const RECENT_EMAILS = 50;
/** Test sends a seller may make an hour, across their stores. */
export const TEST_SENDS_PER_HOUR = 10;
const TWO_HOURS_SECONDS = 2 * 60 * 60;

/** A store's email, or Estori's default when it saved none; "edited" means its text differs from the default. */
function templateView(kind: ShopperEmailKind, saved: ShopperEmailTemplate | undefined): ShopperEmailTemplateView {
    const fallback = DEFAULT_SHOPPER_EMAIL_TEMPLATES[kind];
    if (!saved) return { kind, edited: false, enabled: true, ...fallback };
    return { kind, edited: saved.subject !== fallback.subject || saved.heading !== fallback.heading || saved.body !== fallback.body, ...saved };
}

function recentView(row: ShopperEmailRow & { orderNumber: number | null }): RecentShopperEmail {
    return {
        id: row.id,
        kind: row.kind,
        orderNumber: row.orderNumber,
        recipient: maskEmail(row.recipient),
        status: row.status,
        test: row.test,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
    };
}

export class ShopperEmailsController extends BaseController {
    /** The signed-in seller's stores with a live store or an order, for the Emails page's picker. */
    static async stores(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailStoresData>>> {
        try {
            const stores = await new ShopperEmailService(env).storesOf(context.user!.id);
            return ShopperEmailsController.createSuccessResponse<ShopperEmailStoresData>({ stores });
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'list stores for shopper emails') as ControllerResponse<ApiResponse<ShopperEmailStoresData>>;
        }
    }

    static async read(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailsData>>> {
        const appId = context.pathParams.id;
        if (!appId) return ShopperEmailsController.createErrorResponse('Missing store id', 400);
        try {
            const emails = new ShopperEmailService(env);
            const store = await shopperEmailStoreFromEnv(env)(appId);
            if (!store) return ShopperEmailsController.createErrorResponse('Store not found', 404);
            const [saved, replyTo, recent] = await Promise.all([emails.templates(appId), emails.replyTo(appId), emails.recent(appId, RECENT_EMAILS)]);
            return ShopperEmailsController.createSuccessResponse<ShopperEmailsData>({
                templates: SHOPPER_EMAIL_KINDS.map((kind) => templateView(kind, saved.get(kind))),
                placeholders: SHOPPER_EMAIL_PLACEHOLDERS,
                replyTo,
                sellerEmail: store.sellerEmail,
                senderEmail: store.fromEmail,
                recent: recent.map(recentView),
            });
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'read shopper emails') as ControllerResponse<ApiResponse<ShopperEmailsData>>;
        }
    }

    static async saveTemplate(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailTemplateView>>> {
        const target = ShopperEmailsController.target(context);
        if (!target) return ShopperEmailsController.createErrorResponse('No such email', 404);
        const body = await ShopperEmailsController.parseJsonBody<unknown>(request);
        const parsed = body.success ? parseTemplateRequest(target.kind, body.data) : null;
        if (!parsed?.ok) return ShopperEmailsController.createErrorResponse(parsed?.message ?? 'Send the email as JSON', 400);
        try {
            await new ShopperEmailService(env).saveTemplate(target.appId, target.kind, parsed.value, new Date());
            return ShopperEmailsController.createSuccessResponse(templateView(target.kind, parsed.value));
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'save a shopper email') as ControllerResponse<ApiResponse<ShopperEmailTemplateView>>;
        }
    }

    static async resetTemplate(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailTemplateView>>> {
        const target = ShopperEmailsController.target(context);
        if (!target) return ShopperEmailsController.createErrorResponse('No such email', 404);
        try {
            const kept = await new ShopperEmailService(env).resetTemplate(target.appId, target.kind, new Date());
            return ShopperEmailsController.createSuccessResponse(templateView(target.kind, kept ?? undefined));
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'reset a shopper email') as ControllerResponse<ApiResponse<ShopperEmailTemplateView>>;
        }
    }

    static async saveSettings(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailSettings>>> {
        const appId = context.pathParams.id;
        if (!appId) return ShopperEmailsController.createErrorResponse('Missing store id', 400);
        const body = await ShopperEmailsController.parseJsonBody<unknown>(request);
        const parsed = body.success ? parseReplyTo(body.data) : null;
        if (!parsed?.ok) return ShopperEmailsController.createErrorResponse(parsed?.message ?? 'Send the setting as JSON', 400);
        try {
            await new ShopperEmailService(env).saveReplyTo(appId, parsed.value, new Date());
            return ShopperEmailsController.createSuccessResponse<ShopperEmailSettings>({ replyTo: parsed.value });
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'save where shopper replies go') as ControllerResponse<ApiResponse<ShopperEmailSettings>>;
        }
    }

    /** Renders a template, saved or not, with a sample order. */
    static async preview(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailPreview>>> {
        const target = ShopperEmailsController.target(context);
        if (!target) return ShopperEmailsController.createErrorResponse('No such email', 404);
        const body = await ShopperEmailsController.parseJsonBody<unknown>(request);
        const parsed = body.success ? parseTemplateFields(target.kind, body.data) : null;
        if (!parsed?.ok) return ShopperEmailsController.createErrorResponse(parsed?.message ?? 'Send the email as JSON', 400);
        try {
            const store = await shopperEmailStoreFromEnv(env)(target.appId);
            if (!store) return ShopperEmailsController.createErrorResponse('Store not found', 404);
            return ShopperEmailsController.createSuccessResponse<ShopperEmailPreview>(renderShopperEmail(parsed.value, sampleContent(target.kind, storeName(store.title), store.storeUrl)));
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'preview a shopper email') as ControllerResponse<ApiResponse<ShopperEmailPreview>>;
        }
    }

    /** Sends a template, saved or not, filled in with a sample order, to the store's seller once their email is confirmed. */
    static async test(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<ShopperEmailTestResult>>> {
        const target = ShopperEmailsController.target(context);
        if (!target) return ShopperEmailsController.createErrorResponse('No such email', 404);
        const body = await ShopperEmailsController.parseJsonBody<unknown>(request);
        const parsed = body.success ? parseTemplateFields(target.kind, body.data) : null;
        if (!parsed?.ok) return ShopperEmailsController.createErrorResponse(parsed?.message ?? 'Send the email as JSON', 400);
        const sender = createEmailSender(env);
        if (!sender) return ShopperEmailsController.createErrorResponse("Email sending isn't set up on this deployment", 400);
        const user = context.user!;
        try {
            const [store, replyTo] = await Promise.all([shopperEmailStoreFromEnv(env)(target.appId), new ShopperEmailService(env).replyTo(target.appId)]);
            if (!store) return ShopperEmailsController.createErrorResponse('Store not found', 404);
            // Only to the store's seller at a confirmed address, so an account can't aim Estori's email at a stranger.
            const to = store.sellerEmailConfirmed ? store.sellerEmail : null;
            if (!to) return ShopperEmailsController.createErrorResponse('Confirm your email address to send yourself tests. Use the link Estori emailed you when you signed up.', 403);
            const key = `shopper-email-tests:${user.id}:${new Date().toISOString().slice(0, 13)}`;
            const sentThisHour = Number((await env.VibecoderStore.get(key)) ?? '0');
            if (sentThisHour >= TEST_SENDS_PER_HOUR) return ShopperEmailsController.createErrorResponse(`You can send ${TEST_SENDS_PER_HOUR} test emails an hour. Try again later.`, 429);
            const content = { ...sampleContent(target.kind, storeName(store.title), store.storeUrl), testNote: TEMPLATE_TEST_NOTE };
            const email = renderShopperEmail(parsed.value, content);
            // Counted before sending, so a failing send can't be retried without limit.
            await env.VibecoderStore.put(key, String(sentThisHour + 1), { expirationTtl: TWO_HOURS_SECONDS });
            await sender.send({
                to,
                subject: email.subject,
                html: email.html,
                text: email.text,
                fromEmail: store.fromEmail,
                fromName: content.storeName,
                replyTo: replyTo ?? store.sellerEmail ?? undefined,
                headers: { 'X-Estori-Store': target.appId, 'X-Estori-Email': target.kind },
            });
            return ShopperEmailsController.createSuccessResponse<ShopperEmailTestResult>({ sentTo: to });
        } catch (error) {
            return ShopperEmailsController.handleError(error, 'send a test shopper email') as ControllerResponse<ApiResponse<ShopperEmailTestResult>>;
        }
    }

    private static target(context: RouteContext): { appId: string; kind: ShopperEmailKind } | null {
        const { id, kind } = context.pathParams;
        return id && kind && isShopperEmailKind(kind) ? { appId: id, kind } : null;
    }
}
