/**
 * The catalog's supplier adapter for CJdropshipping. An order is placed once per order number: an existing order is
 * found first, a new one is created unpaid, paid only when its lines match, and confirmed before `ok`. Outside
 * production it creates sandbox orders and pays them by simulation.
 */

import { CATALOG_MAX_DELIVERY_DAYS } from '../config';
import { chooseFreight } from '../refresh';
import type { PlaceOrderResult, ShippingAddress, SupplierAdapter, SupplierOrderLine } from '../supplier';
import { cjShippingFields } from './address';
import type { CjClient } from './client';
import { classifyCjError } from './errors';
import { cjOrderNumber } from './order-number';
import type { CjOrderDetail } from './types';

export interface SupplierAlert {
	kind: 'held-order' | 'low-balance' | 'supplier-account' | 'lines-mismatch';
	reference: string;
	message: string;
}

export interface CjAdapterDeps {
	client: Pick<CjClient, 'getOrderDetail' | 'freightCalculate' | 'createOrder' | 'confirmOrder' | 'simulatePay' | 'payBalance'>;
	destinations: Readonly<Record<string, { name: string; origin: string }>>;
	mode: 'live' | 'sandbox';
	alert(alert: SupplierAlert): Promise<void>;
}

const PAID_STATUSES = ['UNSHIPPED', 'SHIPPED', 'DELIVERED'];
const UNPAID_STATUSES = ['CREATED', 'IN_CART', 'UNPAID'];
/** Orders CJ created without payment: they are confirmed, which makes them UNPAID, before paying. */
const UNCONFIRMED_STATUSES = ['CREATED', 'IN_CART'];

function linesMatch(order: CjOrderDetail, lines: readonly SupplierOrderLine[]): boolean {
	const canonical = (pairs: Array<[string, number]>) => pairs.map(([vid, quantity]) => `${vid}:${quantity}`).sort().join(',');
	return canonical((order.productList ?? []).map((line) => [line.vid, line.quantity])) === canonical(lines.map((line) => [line.supplierVariantId, line.quantity]));
}

export class CJDropshippingAdapter implements SupplierAdapter {
	readonly supplier = 'cjdropshipping';

	constructor(private readonly deps: CjAdapterDeps) {}

	async placeOrder(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }): Promise<PlaceOrderResult> {
		const destination = this.deps.destinations[input.address.countryCode];
		if (!destination) return { ok: false, kind: 'rejected', reason: 'Destination not served', rejectedVariantIds: [] };
		const orderNumber = await cjOrderNumber(input.orderReference, input.lines);
		try {
			const existing = await this.deps.client.getOrderDetail(orderNumber);
			if (existing) return await this.continueExisting(existing, input, orderNumber);
			return await this.create(input, orderNumber, destination);
		} catch (error) {
			return this.failure(error, input.orderReference);
		}
	}

	private async continueExisting(order: CjOrderDetail, input: { orderReference: string; lines: readonly SupplierOrderLine[] }, orderNumber: string): Promise<PlaceOrderResult> {
		if (PAID_STATUSES.includes(order.orderStatus)) return { ok: true, supplierOrderId: order.orderId };
		if (order.orderStatus === 'CANCELLED') return { ok: false, kind: 'rejected', reason: 'Cancelled by the supplier', rejectedVariantIds: [] };
		if (!UNPAID_STATUSES.includes(order.orderStatus)) return { ok: false, kind: 'retryable', reason: `Supplier order ${orderNumber} is ${order.orderStatus}` };
		return this.payAndConfirm(order.orderId, null, order, input, orderNumber);
	}

	private async create(input: { orderReference: string; lines: readonly SupplierOrderLine[]; address: ShippingAddress }, orderNumber: string, destination: { name: string; origin: string }): Promise<PlaceOrderResult> {
		const freight = chooseFreight(
			await this.deps.client.freightCalculate({
				startCountryCode: destination.origin,
				endCountryCode: input.address.countryCode,
				zip: input.address.postalCode,
				products: input.lines.map((line) => ({ vid: line.supplierVariantId, quantity: line.quantity })),
			}),
			CATALOG_MAX_DELIVERY_DAYS[input.address.countryCode] ?? 10,
		);
		if (!freight) return { ok: false, kind: 'rejected', reason: 'Undeliverable', rejectedVariantIds: [] };
		const created = await this.deps.client.createOrder({
			orderNumber,
			...cjShippingFields(input.address, destination.name),
			logisticName: freight.logisticName,
			fromCountryCode: destination.origin,
			payType: 3,
			isSandbox: this.deps.mode === 'sandbox' ? 1 : 0,
			products: input.lines.map((line) => ({ vid: line.supplierVariantId, quantity: line.quantity })),
		});
		if (created.interceptOrderReasons && created.interceptOrderReasons.length > 0) {
			const reasons = created.interceptOrderReasons.map((reason) => reason.message || String(reason.code)).join('; ');
			await this.deps.alert({ kind: 'held-order', reference: input.orderReference, message: `Held by the supplier: ${reasons}` });
			return { ok: false, kind: 'retryable', reason: `Held by the supplier: ${reasons}` };
		}
		return this.payAndConfirm(created.orderId, created.shipmentOrderId, null, input, orderNumber);
	}

	private async payAndConfirm(orderId: string, shipmentOrderId: string | null, known: CjOrderDetail | null, input: { orderReference: string; lines: readonly SupplierOrderLine[] }, orderNumber: string): Promise<PlaceOrderResult> {
		const order = known ?? (await this.deps.client.getOrderDetail(orderId));
		if (order && !linesMatch(order, input.lines)) {
			await this.deps.alert({ kind: 'lines-mismatch', reference: input.orderReference, message: `Supplier order ${orderNumber} lists other lines; it was not paid` });
			return { ok: false, kind: 'retryable', reason: 'The supplier order lists other lines' };
		}
		if (!order || UNCONFIRMED_STATUSES.includes(order.orderStatus)) await this.deps.client.confirmOrder(orderId);
		if (this.deps.mode === 'sandbox') await this.deps.client.simulatePay(orderId);
		else await this.deps.client.payBalance(shipmentOrderId ?? orderId);
		const confirmed = await this.deps.client.getOrderDetail(orderId);
		if (confirmed && PAID_STATUSES.includes(confirmed.orderStatus)) return { ok: true, supplierOrderId: orderId };
		return { ok: false, kind: 'retryable', reason: `Supplier order ${orderNumber} is not paid yet` };
	}

	private async failure(error: unknown, reference: string): Promise<PlaceOrderResult> {
		const reason = error instanceof Error ? error.message : String(error);
		switch (classifyCjError(error)) {
			case 'item-unavailable':
				return { ok: false, kind: 'rejected', reason, rejectedVariantIds: [] };
			case 'undeliverable':
				return { ok: false, kind: 'rejected', reason, rejectedVariantIds: [] };
			case 'insufficient-balance':
				await this.deps.alert({ kind: 'low-balance', reference, message: reason });
				return { ok: false, kind: 'retryable', reason };
			case 'account':
			case 'payment-blocked':
			case 'bad-request':
				await this.deps.alert({ kind: 'supplier-account', reference, message: reason });
				return { ok: false, kind: 'retryable', reason };
			default:
				return { ok: false, kind: 'retryable', reason };
		}
	}
}
