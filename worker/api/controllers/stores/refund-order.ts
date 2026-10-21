import { t } from '../../../services/i18n/request-locale';
import { msg } from '../../../../shared/i18n/translate';
/** Refunds lines of a store order the caller was already allowed to refund: by owning its store, or by being its seller. */

import { PAYMENTS_NOT_CONFIGURED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import { refundStoreLines } from '../../../services/store-payments/refund-lines';
import { storeRefundDeps } from '../../../services/store-payments/wiring';
import type { StoreOrderView } from '../../../services/store-payments/store';
import type { DeferSend } from '../../../services/shopper-emails/outbox';
import { shortBalanceMessage } from './refund-request';

export type OrderRefundOutcome = { ok: true; refundedCents: number } | { ok: false; status: 400 | 409; message: string };

/** `defer` finishes the shopper's refund email after the answer, such as through `ctx.waitUntil`. */
export async function refundOrderLines(env: Env, order: StoreOrderView, request: { lineNos: number[]; requestId: string }, defer?: DeferSend): Promise<OrderRefundOutcome> {
    const stripe = stripeFromEnv(env);
    if (!stripe) return { ok: false, status: 400, message: PAYMENTS_NOT_CONFIGURED_MESSAGE };
    const sellerAccountId = order.sellerStripeAccountId;
    if (!sellerAccountId) return { ok: false, status: 400, message: msg('This order has no seller account to refund from') };
    const result = await refundStoreLines(storeRefundDeps(env, stripe, { order, sellerAccountId, requestId: request.requestId }, defer), {
        order,
        lineNos: request.lineNos,
        requestId: request.requestId,
    });
    if (result.ok) return { ok: true, refundedCents: result.refundedCents };
    if (result.reason === 'seller_balance_short') return { ok: false, status: 409, message: shortBalanceMessage(result.shortCents) };
    if (result.reason === 'unknown_lines') return { ok: false, status: 400, message: t("This order has no line {value1}", { value1: result.lineNos.join(', ') }) };
    return { ok: false, status: 400, message: msg('These lines were already refunded') };
}
