import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertSubscription, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { StripeConnectService } from '../../../database/services/StripeConnectService';
import { StripeConnectController } from './connectController';
import type { RouteContext } from '../../types/route-context';

let db: D1Database;
beforeAll(async () => { db = await migratedD1(); });
afterEach(() => vi.restoreAllMocks());

const context = (userId: string) => ({ user: { id: userId } }) as RouteContext;
const request = () => new Request('https://estori.app/api/payments/payout-schedule', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interval: 'daily', anchor: '' }),
});
const flags = { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, transfersActive: true, cardPaymentsActive: true };
const env = () => envWith(db, { BILLING: 'on', STRIPE_SECRET_KEY: 'sk_test_fake', VibecoderStore: { get: async () => null } });

async function seller(id: string) {
    await insertUser(db, id);
    await new StripeConnectService(env()).create({ userId: id, stripeAccountId: `acct_${id}`, flags });
}

function fakeStripe(id: string) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({
        id: `acct_${id}`, details_submitted: true, charges_enabled: true, payouts_enabled: true,
        capabilities: { transfers: 'active', card_payments: 'active' },
    }), { headers: { 'Content-Type': 'application/json' } }));
}

describe('payout schedule plan access', () => {
    it('keeps Basic weekly on Monday and refuses a schedule change before contacting Stripe', async () => {
        const id = 'payout_basic';
        await seller(id);
        const fetcher = fakeStripe(id);
        const response = await StripeConnectController.setPayoutSchedule(request(), env(), {} as ExecutionContext, context(id));
        expect(response.status).toBe(402);
        expect(await response.json()).toMatchObject({ error: { planLimit: { limit: 'flexiblePayouts', upgradeTo: 'pro' } } });
        expect(fetcher).not.toHaveBeenCalled();
        expect(await new StripeConnectService(env()).getByUser(id)).toMatchObject({ payoutInterval: 'weekly', payoutAnchor: 'monday' });
    });

    it.each(['pro', 'premium'] as const)('allows %s to change a schedule and preserves it after downgrade', async (plan) => {
        const id = `payout_${plan}`;
        await seller(id);
        const now = Date.now();
        await insertSubscription(db, { userId: id, stripeSubscriptionId: `sub_${id}`, plan, status: 'active', currentPeriodStart: new Date(now), currentPeriodEnd: new Date(now + 30 * 86_400_000) });
        const fetcher = fakeStripe(id);
        expect((await StripeConnectController.setPayoutSchedule(request(), env(), {} as ExecutionContext, context(id))).status).toBe(200);
        expect(fetcher).toHaveBeenCalled();
        expect(await new StripeConnectService(env()).getByUser(id)).toMatchObject({ payoutInterval: 'daily' });
        await db.prepare('UPDATE subscriptions SET status = ? WHERE user_id = ?').bind('canceled', id).run();
        fetcher.mockClear();
        expect((await StripeConnectController.setPayoutSchedule(request(), env(), {} as ExecutionContext, context(id))).status).toBe(402);
        expect(fetcher).not.toHaveBeenCalled();
        expect(await new StripeConnectService(env()).getByUser(id)).toMatchObject({ payoutInterval: 'daily' });
    });
});
