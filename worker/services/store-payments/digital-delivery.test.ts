import { describe, expect, it, vi } from 'vitest';
import { receiptDownloads, servePaidDownload, type DigitalDeliveryDeps } from './digital-delivery';
import type { StoreCheckoutRecord, StoreOrderView } from './store';

function fixtures() {
	const order: StoreOrderView = {
		id: 'ord_1',
		checkoutId: 'chk_1',
		orderNumber: 1,
		appId: 'app_1',
		sellerUserId: 'seller_1',
		mode: 'test',
		paymentStatus: 'paid',
		fulfillmentStatus: 'unfulfilled',
		refundedCents: 0,
		subtotalCents: 1000,
		shippingCents: 0,
		totalCents: 1000,
		applicationFeeCents: 60,
		currency: 'usd',
		customerEmail: null,
		customerName: null,
		shippingAddress: null,
		note: null,
		needsAttention: null,
		stripeCheckoutSessionId: null,
		stripePaymentIntentId: null,
		sellerStripeAccountId: null,
		createdAt: new Date(),
		items: [],
	};
	const checkout: StoreCheckoutRecord = {
		id: 'chk_1',
		appId: 'app_1',
		sellerUserId: 'seller_1',
		mode: 'test',
		storeVersionId: null,
		commitHash: 'abc',
		sellerStripeAccountId: null,
		shipToCountry: 'US',
		status: 'completed',
		successPath: '/',
		cancelPath: '/',
		note: null,
		weightedCents: 1000,
		createdAt: new Date(),
		expiresAt: new Date(),
		subtotalCents: 1000,
		shippingCents: 0,
		totalCents: 1000,
		applicationFeeCents: 60,
		pricedCart: {
			mode: 'test',
			storeAppId: 'app_1',
			storeVersionId: null,
			commitHash: 'abc',
			sellerStripeAccountId: null,
			currency: 'usd',
			shipToCountry: 'US',
			subtotalCents: 1000,
			shippingCents: 0,
			totalCents: 1000,
			lines: [
				{
					kind: 'own',
					productType: 'digital',
					productId: 'guide',
					accountProductId: 'account-guide',
					variantId: 'guide-pdf',
					name: 'Guide',
					quantity: 1,
					unitPriceCents: 1000,
					downloadAssetIds: ['file-original'],
				},
			],
		},
	};
	const deps: DigitalDeliveryDeps = {
		getOrder: vi.fn(async () => order),
		getCheckout: vi.fn(async () => checkout),
		getAsset: vi.fn(async (ownerId, id) =>
			ownerId === 'seller_1'
				? {
						key: 'private/secret',
						asset: { id, kind: 'download', name: 'Guide résumé.pdf', contentType: 'application/pdf', size: 4, url: '/api/private' },
					}
				: null,
		),
		getObject: vi.fn(async () => ({
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('FILE'));
					controller.close();
				},
			}),
			size: 4,
		})),
	};
	return { deps, order, checkout };
}
const claims = { appId: 'app_1', orderIds: ['ord_1'] };
const target = { appId: 'app_1', orderId: 'ord_1', mode: 'test' as const, basePath: '' };
describe('private paid downloads', () => {
	it('streams the purchased file with attachment and private headers without exposing its key', async () => {
		const { deps } = fixtures();
		const response = await servePaidDownload(deps, claims, target, 'file-original');
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('FILE');
		expect(response.headers.get('Content-Disposition')).toContain("filename*=UTF-8''Guide%20r%C3%A9sum%C3%A9.pdf");
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		const downloads = await receiptDownloads(deps, claims, target);
		expect(downloads).toEqual([{ id: 'file-original', name: 'Guide résumé.pdf', url: '/__estori/orders/ord_1/downloads/file-original' }]);
		expect(JSON.stringify(downloads)).not.toContain('private');
	});
	it('requires a receipt and refuses a different app, mode, checkout seller, or forged asset', async () => {
		const { deps, checkout } = fixtures();
		for (const [cookie, address, asset] of [
			[null, target, 'file-original'],
			[claims, { ...target, appId: 'app_other' }, 'file-original'],
			[claims, { ...target, mode: 'live' as const }, 'file-original'],
			[claims, target, 'file-new'],
		] as const) {
			expect((await servePaidDownload(deps, cookie, address, asset)).status).toBe(404);
		}
		expect(deps.getObject).not.toHaveBeenCalled();
		checkout.sellerUserId = 'other-seller';
		expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
	});
	it('revokes partial/full refunds and disputes conservatively', async () => {
		const { deps, order } = fixtures();
		for (const status of ['partially_refunded', 'refunded', 'disputed', 'dispute_lost'] as const) {
			order.paymentStatus = status;
			expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
			expect(await receiptDownloads(deps, claims, target)).toEqual([]);
		}
		order.paymentStatus = 'paid';
		order.refundedCents = 1;
		expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
	});
	it('historical orders with no snapshot cannot download current catalog files', async () => {
		const { deps, order, checkout } = fixtures();
		delete checkout.pricedCart.lines[0].downloadAssetIds;
		expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
		delete order.checkoutId;
		expect(await receiptDownloads(deps, claims, target)).toEqual([]);
	});
	it('does not deliver images or deleted assets through a download entitlement', async () => {
		const { deps } = fixtures();
		deps.getAsset = async () => ({
			key: 'private/image',
			asset: { id: 'file-original', kind: 'image', name: 'image.png', contentType: 'image/png', size: 4, url: '/private' },
		});
		expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
		deps.getAsset = async () => null;
		expect((await servePaidDownload(deps, claims, target, 'file-original')).status).toBe(404);
		expect(deps.getObject).not.toHaveBeenCalled();
	});
});
