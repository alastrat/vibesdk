/** Delivery reads the purchased checkout snapshot, never the mutable account catalog. */
import type { ProductAsset } from '../../../shared/types/account-products';
import type { StoreMode, StoreReceipt } from '../../../shared/types/store-payments';
import { receiptAllows, type ReceiptClaims } from './receipts';
import type { StoreCheckoutRecord, StoreOrderView } from './store';

export interface DigitalDeliveryDeps {
	getOrder(id: string): Promise<StoreOrderView | null>;
	getCheckout(id: string): Promise<StoreCheckoutRecord | null>;
	getAsset(ownerId: string, assetId: string): Promise<{ asset: ProductAsset; key: string } | null>;
	getObject(key: string): Promise<{ body: ReadableStream; size: number } | null>;
}
export interface DeliveryTarget {
	appId: string;
	mode: StoreMode;
	orderId: string;
	basePath: string;
}

async function entitlement(deps: DigitalDeliveryDeps, claims: ReceiptClaims | null, target: DeliveryTarget) {
	if (!receiptAllows(claims, target.appId, target.orderId)) return null;
	const order = await deps.getOrder(target.orderId);
	if (
		!order ||
		order.appId !== target.appId ||
		order.mode !== target.mode ||
		order.paymentStatus !== 'paid' ||
		order.refundedCents !== 0 ||
		!order.checkoutId
	)
		return null;
	const checkout = await deps.getCheckout(order.checkoutId);
	if (
		!checkout ||
		checkout.id !== order.checkoutId ||
		checkout.appId !== order.appId ||
		checkout.mode !== order.mode ||
		checkout.sellerUserId !== order.sellerUserId ||
		checkout.pricedCart.storeAppId !== order.appId ||
		checkout.pricedCart.mode !== order.mode
	)
		return null;
	const ids = [
		...new Set(checkout.pricedCart.lines.flatMap((line) => (line.kind === 'own' && line.productType === 'digital' ? (line.downloadAssetIds ?? []) : []))),
	];
	return { ownerId: order.sellerUserId, ids };
}
export async function receiptDownloads(
	deps: DigitalDeliveryDeps,
	claims: ReceiptClaims | null,
	target: DeliveryTarget,
): Promise<NonNullable<StoreReceipt['downloads']>> {
	const allowed = await entitlement(deps, claims, target);
	if (!allowed) return [];
	const downloads: NonNullable<StoreReceipt['downloads']> = [];
	for (const id of allowed.ids) {
		const record = await deps.getAsset(allowed.ownerId, id);
		if (record?.asset.kind === 'download' && record.asset.id === id)
			downloads.push({
				id,
				name: record.asset.name,
				url: `${target.basePath}/__estori/orders/${encodeURIComponent(target.orderId)}/downloads/${encodeURIComponent(id)}`,
			});
	}
	return downloads;
}
export async function servePaidDownload(deps: DigitalDeliveryDeps, claims: ReceiptClaims | null, target: DeliveryTarget, assetId: string): Promise<Response> {
	const missing = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
	const allowed = await entitlement(deps, claims, target);
	if (!allowed || !allowed.ids.includes(assetId)) return missing();
	const record = await deps.getAsset(allowed.ownerId, assetId);
	if (!record || record.asset.kind !== 'download' || record.asset.id !== assetId) return missing();
	const object = await deps.getObject(record.key);
	if (!object) return missing();
	const filename = record.asset.name.replace(/[^A-Za-z0-9._ -]/g, '_');
	return new Response(object.body, {
		headers: {
			'Content-Type': record.asset.contentType,
			'Content-Length': String(object.size),
			'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(record.asset.name).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16))}`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox",
		},
	});
}
