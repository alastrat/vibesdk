import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { unzipSync } from 'fflate';
import type { AppEnv } from '../../types/appenv';
import type { CatalogArtifact } from '../../../shared/types/discover-artifact';
import { migratedD1, insertUser, envWith } from '../../database/test-support/real-d1';
import { DiscoverService } from '../../database/services/DiscoverService';
import { seedCatalog, prepareCatalog, type CatalogSeedStorage } from './seed';
import { catalogFilters, DISCOVER_PREVIEW_CSP } from './validation';
import { fulfillCatalogSession, verifiedCatalogPayment, handleDiscoverPaymentEvent, startCatalogCheckout } from './payments';
import { createStripeClient, type StripeCheckoutSession } from '../payments/stripe-client';
import { catalogMedia, catalogDownload, catalogAccess, confirmCatalogCheckout } from '../../api/controllers/discover/controller';

const category = { slug: 'home',title: 'Home',description: 'Home ideas',color: '#fff' };
const fixture: CatalogArtifact = { slug: 'test-store',title: 'Test Store',summary: 'Functional original demo',description: 'A small test store.',categorySlug: 'home',kind: 'store',tier: 'premium',priceCents: 2900,tags: ['home'],features: ['cart'],palette: ['#fff'],animationKey: 'fade',featured: true,previewHtml: '<!doctype html><h1>Public preview</h1>',coverSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',files: [{ path: 'index.html',content: '<!doctype html><h1>Private premium source</h1>' },{ path: 'README.md',content: 'Open index.html.' }] };
const storage: CatalogSeedStorage = {
    async put(key,bytes,mime) { await env.TEMPLATES_BUCKET.put(key,bytes,{ httpMetadata: { contentType: mime } }); },
    async get(key) { const value = await env.TEMPLATES_BUCKET.get(key); return value ? new Uint8Array(await value.arrayBuffer()) : null; },
};
let db: D1Database;
beforeAll(async () => { db = await migratedD1(); });
afterEach(() => vi.unstubAllGlobals());

async function seeded() {
    await seedCatalog(db,storage,[fixture],[category]);
    const service = new DiscoverService(db);
    const entry = (await service.entry(fixture.slug))!;
    const version = (await service.currentVersion(entry))!;
    return { service,entry,version };
}
async function orderFixture() {
    const result = await seeded();
    await insertUser(db,'buyer');
    const order = (await result.service.createOrder('order','buyer',result.version,Date.now(),{ productName: fixture.title,buyerEmail: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store' }))!;
    const session: StripeCheckoutSession = { id: 'cs_test_session',url: null,mode: 'payment',status: 'complete',payment_status: 'paid',client_reference_id: 'buyer',metadata: { purpose: 'discover_catalog',orderId: 'order',buyerUserId: 'buyer',versionId: result.version.id },amount_total: 2900,currency: 'usd',payment_intent: 'pi_test' };
    return { ...result,order,session };
}

function mediaApp(userId?: string) {
    const app = new Hono<AppEnv>();
    app.use('*',async (c,next) => { c.set('user',userId ? { id: userId,email: `${userId}@example.test`,locale: null } : null); await next(); });
    app.get('/media/:slug/:assetId',catalogMedia);
    app.get('/download/:slug',catalogDownload);
    app.get('/access/:slug',catalogAccess);
    app.post('/confirm',confirmCatalogCheckout);
    return app;
}

describe('catalog persistence and isolation', () => {
    it('persists hash-verified R2 objects, reruns without duplicates, and supplies runnable ZIP files',async () => {
        const { service,entry,version } = await seeded();
        await seedCatalog(db,storage,[fixture],[category]);
        expect((await service.list({})).total).toBe(1);
        expect((await service.categories())[0].count).toBe(1);
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_versions').first<{ count: number }>())?.count).toBe(1);
        const archive = await storage.get(version.download_key);
        expect(new TextDecoder().decode(unzipSync(archive!)['index.html'])).toContain('Private premium source');
        const json = JSON.stringify(entry);
        expect(json).not.toContain('source_key');
        expect(json).not.toContain('Private premium source');
        expect(json).not.toContain('discover/test-store');
    });
    it('does not publish anything if an upload or readback fails',async () => {
        const broken: CatalogSeedStorage = { ...storage,async put(key,bytes,mime) { if (key.endsWith('source.zip')) throw new Error('Injected upload failure'); await storage.put(key,bytes,mime); } };
        await expect(seedCatalog(db,broken,[{ ...fixture,slug: 'failed-store' }],[category])).rejects.toThrow('Injected upload failure');
        expect(await new DiscoverService(db).entry('failed-store')).toBeNull();
    });
    it('does not replace a published version when a later upload fails',async () => {
        const { service,entry } = await seeded();
        const broken: CatalogSeedStorage = { ...storage,async put() { throw new Error('Upload failed'); } };
        await expect(seedCatalog(db,broken,[{ ...fixture,title: 'Changed' }],[category])).rejects.toThrow();
        expect((await service.entry(entry.slug))?.version).toBe(entry.version);
    });
    it('rejects traversal, duplicate files, invalid prices and secrets before publication',async () => {
        for (const artifact of [
            { ...fixture,priceCents: 1 },
            { ...fixture,files: [...fixture.files,{ path: '../secret.txt',content: 'bad' }] },
            { ...fixture,files: [...fixture.files,fixture.files[0]] },
            { ...fixture,previewHtml: `sk_live_${'a'.repeat(24)}` },
        ]) await expect(prepareCatalog([artifact],[category])).rejects.toThrow();
    });
    it('combines literal search filters, pagination and published-only access',async () => {
        const { service } = await seeded();
        await seedCatalog(db,storage,[{ ...fixture,slug: 'other-store',title: 'Other',tier: 'free',priceCents: 0 }],[category]);
        expect((await service.list({ tier: 'free',category: 'home',search: 'Other',limit: 1 })).entries[0].slug).toBe('other-store');
        expect((await service.list({ search: '%' })).total).toBe(0);
        expect((await service.list({ offset: 1,limit: 1 })).entries).toHaveLength(1);
        await db.prepare('UPDATE discover_entries SET published=0 WHERE slug=?').bind(fixture.slug).run();
        expect(await service.entry(fixture.slug)).toBeNull();
        expect((await service.categories())[0].count).toBe(1);
    });
    it('serves only cover and preview assets under the correct published slug with sandbox CSP',async () => {
        const { service,entry } = await seeded();
        const assets = await db.prepare('SELECT id,role FROM discover_assets WHERE entry_id=?').bind(entry.id).all<{ id: string;role: string }>();
        const app = mediaApp();
        const bindings = envWith(db,{ TEMPLATES_BUCKET: env.TEMPLATES_BUCKET });
        for (const asset of assets.results) {
            const response = await app.request(`/media/${entry.slug}/${asset.id}`,{},bindings);
            expect(response.status).toBe(['cover','preview'].includes(asset.role) ? 200 : 404);
            if (asset.role === 'preview') {
                expect(response.headers.get('Content-Security-Policy')).toBe(DISCOVER_PREVIEW_CSP);
                expect(await response.text()).not.toContain('Private premium source');
                expect(await service.publicAsset('different-slug',asset.id)).toBeNull();
            } else { await response.arrayBuffer(); }
        }
        await db.prepare('UPDATE discover_entries SET published=0').run();
        expect(await service.publicAsset(entry.slug,assets.results[0].id)).toBeNull();
    });
    it('requires authentication and entitlement to download premium files',async () => {
        await seeded();
        const bindings = envWith(db,{ TEMPLATES_BUCKET: env.TEMPLATES_BUCKET });
        expect((await mediaApp().request('/download/test-store',{},bindings)).status).toBe(401);
        expect((await mediaApp('stranger').request('/download/test-store',{},bindings)).status).toBe(403);
    });
});

function checkoutStripe() {
    const sessions = new Map<string, StripeCheckoutSession>();
    const requests = new Map<string, string>();
    const client = createStripeClient('sk_test_fake',async (url,init) => {
        if (init?.method === 'GET') {
            const id = String(url).split('/').pop()!;
            const session = [...sessions.values()].find((item) => item.id === id);
            if (!session) throw new Error('Session missing');
            return Response.json(session);
        }
        const key = new Headers(init?.headers).get('Idempotency-Key')!;
        const body = String(init?.body);
        if (requests.has(key)) expect(body).toBe(requests.get(key));
        requests.set(key,body);
        if (!sessions.has(key)) {
            const params = new URLSearchParams(body);
            sessions.set(key,{
                id: `cs_test_${sessions.size + 1}`,url: `https://checkout.stripe.com/pay/${sessions.size + 1}`,mode: 'payment',status: 'open',payment_status: 'unpaid',
                client_reference_id: params.get('client_reference_id'),amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),currency: 'usd',payment_intent: null,
                metadata: { purpose: 'discover_catalog',orderId: params.get('metadata[orderId]')!,buyerUserId: params.get('metadata[buyerUserId]')!,versionId: params.get('metadata[versionId]')! },
            });
        }
        return Response.json(sessions.get(key));
    });
    return { client,sessions,requests };
}

describe('catalog checkout reservation',() => {
    it('reuses one payable session across the old 30-minute boundary and catalog version updates',async () => {
        const { service,entry,version } = await seeded();
        await insertUser(db,'buyer');
        const stripe = checkoutStripe();
        const input = { entry,version,userId: 'buyer',email: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store',nowMs: 29 * 60 * 1000 };
        const first = await startCatalogCheckout(service,stripe.client,input);
        await seedCatalog(db,storage,[{ ...fixture,title: 'New release' }],[category]);
        const latest = (await service.entry(entry.slug))!;
        const second = await startCatalogCheckout(service,stripe.client,{ ...input,entry: latest,version: (await service.currentVersion(latest))!,nowMs: 31 * 60 * 1000 });
        expect(second).toEqual(first);
        expect(stripe.sessions.size).toBe(1);
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_checkout_orders').first<{ count: number }>())?.count).toBe(1);
    });
    it('reserves one order atomically for concurrent requests using different candidate IDs',async () => {
        const { service,entry,version } = await seeded();
        await insertUser(db,'buyer');
        const stripe = checkoutStripe();
        const results = await Promise.all(Array.from({ length: 8 },(_,index) => startCatalogCheckout(service,stripe.client,{
            entry,version,userId: 'buyer',email: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store',nowMs: (29 + index) * 60 * 1000,
        })));
        expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
        expect(stripe.sessions.size).toBe(1);
        expect(stripe.requests.size).toBe(1);
        expect((await db.prepare("SELECT COUNT(*) AS count FROM discover_checkout_orders WHERE status='pending'").first<{ count: number }>())?.count).toBe(1);
    });
    it('replays the identical Stripe request after a lost creation response without creating another session',async () => {
        const { service,entry,version } = await seeded();
        await insertUser(db,'buyer');
        const stripe = checkoutStripe();
        const create = stripe.client.createCatalogCheckoutSession;
        const spy = vi.spyOn(stripe.client,'createCatalogCheckoutSession').mockImplementationOnce(async (input) => {
            await create(input);
            throw new Error('Response lost after Stripe created the session');
        });
        const input = { entry,version,userId: 'buyer',email: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store',nowMs: Date.now() };
        await expect(startCatalogCheckout(service,stripe.client,input)).rejects.toThrow('Response lost');
        spy.mockRestore();
        expect((await startCatalogCheckout(service,stripe.client,{ ...input,nowMs: input.nowMs + 31 * 60 * 1000 })).kind).toBe('checkout');
        expect(stripe.sessions.size).toBe(1);
        expect(stripe.requests.size).toBe(1);
    });
    it('retains a reservation on provider failure and rotates only after Stripe confirms expiry',async () => {
        const { service,entry,version } = await seeded();
        await insertUser(db,'buyer');
        const stripe = checkoutStripe();
        const input = { entry,version,userId: 'buyer',email: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store',nowMs: Date.now() };
        await startCatalogCheckout(service,stripe.client,input);
        const retrieve = vi.spyOn(stripe.client,'retrieveCheckoutSession').mockRejectedValueOnce(new Error('Stripe unavailable'));
        await expect(startCatalogCheckout(service,stripe.client,input)).rejects.toThrow('Stripe unavailable');
        expect(stripe.sessions.size).toBe(1);
        retrieve.mockRestore();
        [...stripe.sessions.values()][0].status = 'expired';
        expect((await startCatalogCheckout(service,stripe.client,input)).kind).toBe('checkout');
        expect(stripe.sessions.size).toBe(2);
        expect((await db.prepare("SELECT COUNT(*) AS count FROM discover_checkout_orders WHERE status='pending'").first<{ count: number }>())?.count).toBe(1);
    });
    it('fulfills a completed session instead of issuing another checkout',async () => {
        const { service,entry,version } = await seeded();
        await insertUser(db,'buyer');
        const stripe = checkoutStripe();
        const input = { entry,version,userId: 'buyer',email: 'buyer@example.test',returnUrl: 'https://example.test/discover?item=test-store',nowMs: Date.now() };
        await startCatalogCheckout(service,stripe.client,input);
        const session = [...stripe.sessions.values()][0];
        Object.assign(session,{ status: 'complete',payment_status: 'paid',payment_intent: 'pi_complete' });
        expect(await startCatalogCheckout(service,stripe.client,input)).toEqual({ kind: 'owned' });
        expect(await startCatalogCheckout(service,stripe.client,input)).toEqual({ kind: 'owned' });
        expect(stripe.sessions.size).toBe(1);
        expect(await service.entitledVersion(entry,'buyer')).not.toBeNull();
    });
    it('detects competing historical paid sessions atomically and persists the duplicate for refund reconciliation',async () => {
        const { service,session } = await orderFixture();
        // Simulate an older session from before the reservation invariant; expired orders do not hold an active lock.
        await db.prepare(`INSERT INTO discover_checkout_orders(id,user_id,entry_id,version_id,price_cents,currency,product_name,buyer_email,return_url,status,created_at)
            SELECT 'legacy-order',user_id,entry_id,version_id,price_cents,currency,product_name,buyer_email,return_url,'expired',created_at FROM discover_checkout_orders WHERE id='order'`).run();
        const legacy = { ...session,id: 'cs_legacy',payment_intent: 'pi_legacy',metadata: { ...session.metadata,orderId: 'legacy-order' } };
        const results = await Promise.allSettled([fulfillCatalogSession(service,session),fulfillCatalogSession(service,legacy)]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const failed = results.find((result) => result.status === 'rejected');
        expect(failed?.status === 'rejected' && String(failed.reason)).toContain('requires refund reconciliation');
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_purchases').first<{ count: number }>())?.count).toBe(1);
        expect((await db.prepare("SELECT COUNT(*) AS count FROM discover_checkout_orders WHERE status='duplicate' AND payment_intent_id IS NOT NULL").first<{ count: number }>())?.count).toBe(1);
    });
});

describe('catalog payment verification', () => {
    it.each(['unpaid','mismatched'])('returns a retryable error when confirmation is %s',async (state) => {
        const { service,session } = await orderFixture();
        await service.attachSession('order',session.id);
        vi.stubGlobal('fetch',async () => Response.json(state === 'unpaid' ? { ...session,payment_status: 'unpaid' } : { ...session,amount_total: 1 }));
        const response = await mediaApp('buyer').request('/confirm',{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify({ sessionId: session.id }) },envWith(db,{ STRIPE_SECRET_KEY: 'sk_test_fake' }));
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ success: false });
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_purchases').first<{ count: number }>())?.count).toBe(0);
    });
    it('records a verified purchase exactly once and returns the purchased version after an update',async () => {
        const { service,entry,version,session } = await orderFixture();
        expect(await fulfillCatalogSession(service,session,'buyer')).toBe(true);
        expect(await fulfillCatalogSession(service,session,'buyer')).toBe(true);
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_purchases').first<{ count: number }>())?.count).toBe(1);
        await seedCatalog(db,storage,[{ ...fixture,title: 'New version' }],[category]);
        expect((await service.entitledVersion((await service.entry(entry.slug))!,'buyer'))?.id).toBe(version.id);
        const response = await mediaApp('buyer').request('/download/test-store',{},envWith(db,{ TEMPLATES_BUCKET: env.TEMPLATES_BUCKET }));
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        await response.arrayBuffer();
    });
    it('rejects unpaid, wrong amount/currency/buyer/version/session and mismatched signed-in user',async () => {
        const { service,order,session } = await orderFixture();
        const invalid: StripeCheckoutSession[] = [
            { ...session,payment_status: 'unpaid' },{ ...session,amount_total: 1 },{ ...session,currency: 'eur' },{ ...session,status: 'open' },
            { ...session,client_reference_id: 'other' },{ ...session,metadata: { ...session.metadata,buyerUserId: 'other' } },
            { ...session,metadata: { ...session.metadata,versionId: 'other' } },{ ...session,payment_intent: null },
        ];
        for (const candidate of invalid) expect(verifiedCatalogPayment(order,candidate)).toBe(false);
        expect(verifiedCatalogPayment({ ...order,session_id: 'cs_other' },session)).toBe(false);
        expect(await fulfillCatalogSession(service,session,'other')).toBe(false);
        expect((await db.prepare('SELECT COUNT(*) AS count FROM discover_purchases').first<{ count: number }>())?.count).toBe(0);
    });
    it('revokes a refunded purchase and cannot restore it with a duplicate completion',async () => {
        const { service,entry,session } = await orderFixture();
        await fulfillCatalogSession(service,session);
        await handleDiscoverPaymentEvent(envWith(db),{ id: 'evt_refund',type: 'charge.refunded',data: { object: { payment_intent: 'pi_test',amount_refunded: 2900,metadata: { purpose: 'discover_catalog',orderId: 'order' } } } });
        expect(await service.entitledVersion(entry,'buyer')).toBeNull();
        expect(await fulfillCatalogSession(service,session)).toBe(false);
        await expect(handleDiscoverPaymentEvent(envWith(db),{ id: 'evt_late',type: 'checkout.session.completed',data: { object: session } })).resolves.toBe(true);
    });
    it('uses a first-party platform checkout with stored price and stable idempotency',async () => {
        const calls: RequestInit[] = [];
        const client = createStripeClient('sk_test_fake',async (_url,init) => { calls.push(init!); return Response.json({ id: 'cs_test',url: 'https://checkout.stripe.com/test' }); });
        await client.createCatalogCheckoutSession({ orderId: 'order',productName: 'Store',priceCents: 2900,buyerUserId: 'buyer',versionId: 'v1',successUrl: 'https://example.test/ok',cancelUrl: 'https://example.test/cancel',nowMs: 1000000 });
        const params = new URLSearchParams(String(calls[0].body));
        expect(params.get('line_items[0][price_data][unit_amount]')).toBe('2900');
        expect(params.get('metadata[purpose]')).toBe('discover_catalog');
        expect(params.get('payment_intent_data[metadata][versionId]')).toBe('v1');
        expect(params.has('payment_intent_data[transfer_data][destination]')).toBe(false);
        expect(new Headers(calls[0].headers).get('Idempotency-Key')).toBe('discover-order');
    });
});

describe('bounded filters', () => {
    it.each(['limit=0','limit=61','limit=NaN','offset=-1','offset=10001','kind=app','tier=paid','category=../x',`search=${'x'.repeat(121)}`])('rejects %s',query => { expect(() => catalogFilters(new URLSearchParams(query))).toThrow(); });
    it('defaults to the complete catalog and preserves valid combined filters',() => {
        expect(catalogFilters(new URLSearchParams())).toMatchObject({ limit: 48,offset: 0 });
        expect(catalogFilters(new URLSearchParams('kind=store&tier=free&search=hello&category=home'))).toMatchObject({ kind: 'store',tier: 'free',search: 'hello',category: 'home' });
    });
});
