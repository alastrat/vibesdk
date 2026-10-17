import { describe, expect, it } from 'vitest';
import type { StoreManifest } from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { startStoreCheckout, storeInfoOf, type StartCheckoutDeps, type StartCheckoutInput } from './checkout';
import type { CatalogLock } from './pricing';
import type { StoreCheckoutRecord } from './store';
import type { SellerReadiness } from '../../../shared/types/seller-setup';

const MANIFEST: StoreManifest = {
	version: 1,
	currency: 'usd',
	shipping: { countries: ['US'], flatRateCents: 600 },
	products: [
		{ id: 'trail-mug', name: 'Trail Mug', variants: [{ id: 'trail-mug-blue', name: 'Blue', priceCents: 2000 }] },
		{ id: 'desk-lamp', name: 'Desk Lamp', variants: [{ id: 'desk-lamp-black', name: 'Black', priceCents: 3500, catalogVariantId: 'cv_lamp' }] },
	],
};

const INPUT: StartCheckoutInput = {
	access: 'owner',
	stripeMode: 'test',
	livePayments: false,
	appId: 'app_1',
	sellerUserId: 'u1',
	body: { items: [{ variantId: 'trail-mug-blue', quantity: 2 }], shipTo: 'US', successPath: '/thanks', cancelPath: '/cart' },
	storeBaseUrl: 'https://preview.test/space/app_1/preview/main',
};

const READY: SellerReadiness = { termsAccepted: true, connected: true, detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };

function fakeDeps(overrides: Partial<StartCheckoutDeps> = {}) {
	const saved: StoreCheckoutRecord[] = [];
	const sessions: StoreCheckoutSessionInput[] = [];
	const locked: Array<{ ids: readonly string[]; country: string }> = [];
	const attached: string[] = [];
	const failed: string[] = [];
	const limits: string[] = [];
	const replaced: string[] = [];
	const deps: StartCheckoutDeps = {
		loadManifest: async () => ({ commitHash: 'c0ffee', text: JSON.stringify(MANIFEST) }),
		sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: READY }),
		lockCatalogPrices: async (ids, country) => {
			locked.push({ ids, country });
			const lock: CatalogLock = { ok: true, catalogVariantId: 'cv_lamp', supplier: 'cjdropshipping', supplierVariantId: 'cj_vid_lamp', lockedCatalogPriceCents: 1200 };
			return [lock];
		},
		saveCheckout: async (checkout) => {
			saved.push(checkout);
		},
		createSession: async (input) => {
			sessions.push(input);
			return { id: 'cs_1', clientSecret: 'cs_1_secret' };
		},
		attachSession: async (_checkoutId, sessionId) => {
			attached.push(sessionId);
		},
		markFailed: async (checkoutId) => {
			failed.push(checkoutId);
		},
		newCheckoutId: () => 'chk_1',
		nowMs: () => 1_800_000_000_000,
		sellerLimits: async () => ({ largestOrderCents: 15_000, weeklySalesCents: 50_000 }),
		weeklyUsage: async () => 0,
		releaseHolds: async () => 0,
		replaceCheckout: async (checkoutId) => {
			replaced.push(checkoutId);
		},
		limitReached: async (weeklySalesCents) => {
			limits.push(`reached ${weeklySalesCents}`);
		},
		...overrides,
	};
	return { deps, saved, sessions, locked, attached, failed, limits, replaced };
}

describe('startStoreCheckout', () => {
	it("saves the priced checkout, then sends the shopper to Stripe with the seller's account and the fee", async () => {
		const { deps, saved, sessions, attached } = fakeDeps();
		expect(await startStoreCheckout(deps, INPUT)).toEqual({
			ok: true,
			checkoutId: 'chk_1',
			clientSecret: 'cs_1_secret',
			summary: {
				currency: 'usd',
				shipTo: 'US',
				lines: [{ variantId: 'trail-mug-blue', productId: 'trail-mug', name: 'Trail Mug', variantName: 'Blue', quantity: 2, unitPriceCents: 2000, lineTotalCents: 4000 }],
				subtotalCents: 4000,
				shippingCents: 600,
				totalCents: 4600,
			},
		});

		expect(saved[0]).toMatchObject({ id: 'chk_1', mode: 'test', appId: 'app_1', commitHash: 'c0ffee', sellerUserId: 'u1', sellerStripeAccountId: 'acct_1', status: 'creating', totalCents: 4600, applicationFeeCents: 163, successPath: '/thanks', cancelPath: '/cart' });
		expect(saved[0].expiresAt.getTime()).toBe(1_800_000_000_000 + 35 * 60 * 1000);
		expect(sessions[0]).toMatchObject({
			checkoutId: 'chk_1',
			lines: [{ name: 'Trail Mug, Blue', quantity: 2, unitPriceCents: 2000 }],
			shippingCents: 600,
			shipToCountry: 'US',
			applicationFeeCents: 163,
			sellerStripeAccountId: 'acct_1',
			metadata: { kind: 'store_order', checkoutId: 'chk_1', storeAppId: 'app_1' },
			returnUrl: 'https://preview.test/space/app_1/preview/main/__estori/return?session_id={CHECKOUT_SESSION_ID}',
		});
		expect(attached).toEqual(['cs_1']);
	});

	it('locks only the catalog variants the cart names, for its country', async () => {
		const { deps, locked, sessions } = fakeDeps();
		await startStoreCheckout(deps, { ...INPUT, body: { items: [{ variantId: 'desk-lamp-black', quantity: 1 }], shipTo: 'US' } });
		expect(locked).toEqual([{ ids: ['cv_lamp'], country: 'US' }]);
		expect(sessions[0].applicationFeeCents).toBe(1349);

		const ownOnly = fakeDeps();
		await startStoreCheckout(ownOnly.deps, INPUT);
		expect(ownOnly.locked).toEqual([]);
	});

	it('refuses public previews, live keys and sellers who cannot take payments, before pricing', async () => {
		const cases: Array<[Partial<StartCheckoutInput>, Partial<StartCheckoutDeps>, string]> = [
			[{ access: 'public' }, {}, 'demo_only'],
			[{ stripeMode: 'live' }, {}, 'payments_unavailable'],
			[{ stripeMode: null }, {}, 'payments_unavailable'],
			[{}, { sellerAccount: async () => null }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, termsAccepted: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, cardPaymentsActive: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, transfersActive: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, payoutsEnabled: false } }) }, 'payments_unavailable'],
			[{}, { loadManifest: async () => null }, 'payments_unavailable'],
			[{}, { loadManifest: async () => ({ commitHash: 'c0ffee', text: '{' }) }, 'payments_unavailable'],
		];
		for (const [input, overrides, reason] of cases) {
			const { deps, saved, sessions } = fakeDeps(overrides);
			const response = await startStoreCheckout(deps, { ...INPUT, ...input });
			expect(response).toMatchObject({ ok: false, reason });
			expect(saved).toHaveLength(0);
			expect(sessions).toHaveLength(0);
		}
	});

	it('lets any shopper pay on a live store with test keys, recording a test checkout', async () => {
		const { deps, saved } = fakeDeps();
		expect(await startStoreCheckout(deps, { ...INPUT, access: 'live' })).toMatchObject({ ok: true });
		expect(saved[0]).toMatchObject({ mode: 'test', sellerUserId: 'u1' });
	});

	it('takes real payments only on a live store, and only once Estori turns them on', async () => {
		const off = fakeDeps();
		expect(await startStoreCheckout(off.deps, { ...INPUT, access: 'live', stripeMode: 'live' })).toMatchObject({ ok: false, reason: 'payments_unavailable' });
		expect(off.saved).toHaveLength(0);

		const on = fakeDeps();
		expect(await startStoreCheckout(on.deps, { ...INPUT, access: 'live', stripeMode: 'live', livePayments: true })).toMatchObject({ ok: true });
		expect(on.saved[0]).toMatchObject({ mode: 'live' });
		expect(on.saved[0]?.pricedCart.mode).toBe('live');

		// A preview never takes real payments, even its owner's.
		const preview = fakeDeps();
		expect(await startStoreCheckout(preview.deps, { ...INPUT, stripeMode: 'live', livePayments: true })).toMatchObject({ ok: false, reason: 'payments_unavailable' });
	});

	it('refuses a body that carries an amount, before reading the store', async () => {
		let manifestReads = 0;
		const { deps, sessions } = fakeDeps({
			loadManifest: async () => {
				manifestReads += 1;
				return { commitHash: 'c0ffee', text: JSON.stringify(MANIFEST) };
			},
		});
		const response = await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), amount: 1 } });
		expect(response).toEqual({ ok: false, reason: 'invalid_request', message: "Your cart couldn't be read. Refresh the page and try again." });
		expect(manifestReads).toBe(0);
		expect(sessions).toHaveLength(0);
	});

	it('never makes Estori the merchant: a session goes out only for a seller who can be one', async () => {
		const ready = fakeDeps();
		await startStoreCheckout(ready.deps, INPUT);
		expect(ready.sessions).toHaveLength(1);
		expect('sellerIsMerchant' in ready.sessions[0]).toBe(false);

		const transfersOnly = fakeDeps({ sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, cardPaymentsActive: false } }) });
		expect(await startStoreCheckout(transfersOnly.deps, INPUT)).toEqual({ ok: false, reason: 'payments_unavailable', message: "This store can't take payments right now." });
		expect(transfersOnly.sessions).toHaveLength(0);
	});

	it('marks the checkout failed when Stripe refuses the session', async () => {
		const { deps, failed } = fakeDeps({
			createSession: async () => {
				throw new Error('The account must have card_payments');
			},
		});
		expect(await startStoreCheckout(deps, INPUT)).toMatchObject({ ok: false, reason: 'stripe_failed' });
		expect(failed).toEqual(['chk_1']);
	});

	it('keeps unsafe return paths on the store', async () => {
		const { deps, saved } = fakeDeps();
		await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), cancelPath: '//evil.example' } });
		expect(saved[0].cancelPath).toBe('/');
	});

	it("refuses an order larger than the seller's largest, without saving it", async () => {
		const { deps, saved, sessions } = fakeDeps({ sellerLimits: async () => ({ largestOrderCents: 4599, weeklySalesCents: 50_000 }) });
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: false, reason: 'order_over_limit', message: "This store can't take an order this large yet." });
		expect(saved).toHaveLength(0);
		expect(sessions).toHaveLength(0);
	});

	it('pauses the store when this order would pass the weekly cap, and says so once to the seller', async () => {
		// The cart is two own mugs at $20 plus $6 shipping: $46.00, weighted $86.00.
		const { deps, limits } = fakeDeps({ weeklyUsage: async () => 50_000 - 8599 });
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: false, reason: 'store_paused', message: "This store isn't taking new orders right now. Try again later." });
		expect(limits).toEqual(['reached 50000']);

		const fits = fakeDeps({ weeklyUsage: async () => 50_000 - 8600 });
		expect(await startStoreCheckout(fits.deps, INPUT)).toMatchObject({ ok: true });
	});

	it("makes room by releasing the oldest checkouts nobody paid for, so unpaid checkouts can't pause the store", async () => {
		const released: Array<{ mode: string; cents: number }> = [];
		const { deps, limits } = fakeDeps({ weeklyUsage: async () => 50_000, releaseHolds: async (mode, cents) => (released.push({ mode, cents }), cents) });
		expect(await startStoreCheckout(deps, INPUT)).toMatchObject({ ok: true });
		expect(released).toEqual([{ mode: 'test', cents: 8600 }]);
		expect(limits).toEqual([]);
	});

	it('still pauses the store when the unpaid checkouts it could release leave too little room', async () => {
		const { deps, limits } = fakeDeps({ weeklyUsage: async () => 50_000, releaseHolds: async () => 8599 });
		expect(await startStoreCheckout(deps, INPUT)).toMatchObject({ ok: false, reason: 'store_paused' });
		expect(limits).toEqual(['reached 50000']);
	});

	it("saves the checkout's weight, so the next checkout counts it", async () => {
		const { deps, saved } = fakeDeps();
		await startStoreCheckout(deps, INPUT);
		expect(saved[0].weightedCents).toBe(8600);
	});

	it("counts the week's sales in the cart's own mode, so test checkouts never fill a live store's cap", async () => {
		const modes: string[] = [];
		const { deps } = fakeDeps({ weeklyUsage: async (mode) => (modes.push(mode), 0) });
		await startStoreCheckout(deps, INPUT);
		expect(modes).toEqual(['test']);
	});
	it('fails the checkout when Stripe gives no client secret for its payment form', async () => {
		const { deps, failed } = fakeDeps({ createSession: async () => ({ id: 'cs_1', clientSecret: null }) });
		expect(await startStoreCheckout(deps, INPUT)).toMatchObject({ ok: false, reason: 'stripe_failed' });
		expect(failed).toEqual(['chk_1']);
	});

	it('replaces the checkout the cart was edited from, before the weekly cap counts it, and starts anew when that one is no longer open', async () => {
		const order: string[] = [];
		const { deps, replaced } = fakeDeps({ weeklyUsage: async () => (order.push('usage'), 0) });
		const replace = deps.replaceCheckout;
		deps.replaceCheckout = async (checkoutId) => (order.push('replace'), replace(checkoutId));
		expect(await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), replaces: 'chk_old' } })).toMatchObject({ ok: true });
		expect(replaced).toEqual(['chk_old']);
		expect(order).toEqual(['replace', 'usage']);

		// The page reloaded after a payment, or the checkout expired: the new checkout starts as if nothing was named.
		const other = fakeDeps();
		expect(await startStoreCheckout(other.deps, { ...INPUT, body: { ...(INPUT.body as object), replaces: 'chk_paid' } })).toMatchObject({ ok: true });
		expect(other.replaced).toEqual(['chk_paid']);
		expect(other.saved).toHaveLength(1);
	});
});

describe('storeInfoOf', () => {
	it("gives the store's brand to its pages and to Estori's checkout page, or none", () => {
		const brand = { name: 'Ember', colors: { background: '#000000', surface: '#000000', text: '#ffffff', accent: '#ff8800', accentText: '#000000' }, corners: 'rounded' as const };
		expect(storeInfoOf({ ...MANIFEST, brand }, true, 'test').brand).toEqual(brand);
		expect(storeInfoOf(MANIFEST, true, 'test').brand).toBeNull();
		expect(storeInfoOf(MANIFEST, true, 'live').mode).toBe('live');
	});
});
