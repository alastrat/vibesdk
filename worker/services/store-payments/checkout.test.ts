import { describe, expect, it } from 'vitest';
import type { StoreManifest } from '../../../shared/types/store-payments';
import type { StoreCheckoutSessionInput } from '../payments/stripe-client';
import { startStoreCheckout, type StartCheckoutDeps, type StartCheckoutInput } from './checkout';
import type { CatalogLock } from './pricing';
import type { StoreCheckoutRecord } from './store';

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
	appId: 'app_1',
	sellerUserId: 'u1',
	body: { items: [{ variantId: 'trail-mug-blue', quantity: 2 }], shipTo: 'US', successPath: '/thanks', cancelPath: '/cart' },
	storeBaseUrl: 'https://preview.test/space/app_1/preview/main',
};

function fakeDeps(overrides: Partial<StartCheckoutDeps> = {}) {
	const saved: StoreCheckoutRecord[] = [];
	const sessions: StoreCheckoutSessionInput[] = [];
	const locked: Array<{ ids: readonly string[]; country: string }> = [];
	const attached: string[] = [];
	const failed: string[] = [];
	const deps: StartCheckoutDeps = {
		loadManifest: async () => ({ commitHash: 'c0ffee', text: JSON.stringify(MANIFEST) }),
		sellerAccount: async () => ({ stripeAccountId: 'acct_1', paymentsEnabled: true }),
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
			return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' };
		},
		attachSession: async (_checkoutId, sessionId) => {
			attached.push(sessionId);
		},
		markFailed: async (checkoutId) => {
			failed.push(checkoutId);
		},
		newCheckoutId: () => 'chk_1',
		nowMs: () => 1_800_000_000_000,
		...overrides,
	};
	return { deps, saved, sessions, locked, attached, failed };
}

describe('startStoreCheckout', () => {
	it("saves the priced checkout, then sends the shopper to Stripe with the seller's account and the fee", async () => {
		const { deps, saved, sessions, attached } = fakeDeps();
		expect(await startStoreCheckout(deps, INPUT)).toEqual({ ok: true, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_1' });

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
			successUrl: 'https://preview.test/space/app_1/preview/main/__estori/return?session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'https://preview.test/space/app_1/preview/main/cart',
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
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', paymentsEnabled: false }) }, 'payments_unavailable'],
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
		const { deps, sessions } = fakeDeps();
		await startStoreCheckout(deps, { ...INPUT, body: { ...(INPUT.body as object), cancelPath: '//evil.example' } });
		expect(sessions[0].cancelUrl).toBe('https://preview.test/space/app_1/preview/main/');
	});
});
