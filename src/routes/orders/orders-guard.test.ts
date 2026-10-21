import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '../copy-rules';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/components/layout/app-sidebar.tsx', '/src/routes/orders/orders.tsx', '/src/routes/orders/order.tsx', '/src/hooks/use-seller-orders.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the seller Orders pages', () => {
	it('are routed for signed-in users', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'orders',\s*Component: protectedPage\(SellerOrdersPage\)/);
		expect(routes).toMatch(/path: 'orders\/:id',\s*Component: protectedPage\(SellerOrderPage\)/);
	});

	it('open from an Orders item in the sidebar, folded and open', () => {
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		expect(sidebar.match(/navigate\(SELLER_ORDERS_PATH\)/g) ?? []).toHaveLength(2);
		expect(sidebar).toContain('id="orders-link"');
		// Orders comes before Emails and Translations, folded and open.
		const items = [...sidebar.matchAll(/id="(orders|emails|translations)-link"/g)].map((match) => match[1]);
		expect(items).toEqual(['orders', 'emails', 'translations', 'orders', 'emails', 'translations']);
	});

	it('list orders to ship by default, with test orders hidden behind a switch, a store filter and Load more', () => {
		const list = source('/src/routes/orders/orders.tsx');
		expect(list).toContain("useState<SellerOrderView>('to-ship')");
		expect(list).toContain('useState(false)');
		expect(list).toContain("mode: showTest ? 'all' : 'live'");
		expect(list).toContain('Show test orders');
		expect(list).toContain('data.stores');
		expect(list).toContain('orders.fetchNextPage()');
		expect(list).toContain('shippingStatus(order)');
	});

	it('name no supplier or AI assistant', () => {
		for (const path of ['/src/routes/orders/orders.tsx', '/src/routes/orders/order.tsx']) {
			const text = source(path).toLowerCase();
			for (const name of [...SUPPLIER_NAMES, ...AI_ASSISTANT_NAMES]) expect(text, `${path}: ${name}`).not.toContain(name);
		}
	});

	it('shows the order with the seller and Estori parts apart, the money split and the warnings', () => {
		const page = source('/src/routes/orders/order.tsx');
		for (const part of ['You ship', 'Estori ships', 'moneySplit(order)', 'shipToLines(order.shipTo)', 'order.needsAttention', 'order.dispute', 'CATALOG_PROGRESS_LABELS', 'order.note']) expect(page, part).toContain(part);
	});

	it('marks the order shipped with a carrier and tracking number, edits it, and asks before marking it not shipped', () => {
		const page = source('/src/routes/orders/order.tsx');
		expect(page).toContain('SELLER_CARRIERS.map');
		expect(page).toContain('shipment.mutate(');
		expect(page).toMatch(/<ConfirmButton[^>]*label="Mark as not shipped"/);
		expect(page).toContain('disabled={shipment.isPending}');
	});

	it('refunds chosen lines once per attempt, and keeps the button off while it runs', () => {
		const page = source('/src/routes/orders/order.tsx');
		expect(page).toContain('crypto.randomUUID()');
		expect(page).toContain('refund.mutate(');
		expect(page).toContain('disabled={refund.isPending || chosen.length === 0}');
		expect(page).toContain('!item.refunded');
	});

	it("pauses refunds while the shopper's bank has the payment, offers a pending refund again, and refunds through the order", () => {
		const page = source('/src/routes/orders/order.tsx');
		expect(page).toContain("Refunds are paused while the shopper's bank reviews this payment.");
		expect(page).toContain('Refund pending');
		expect(page).toContain('item.refundPending');
		const hooks = sources['/src/hooks/use-seller-orders.ts'] ?? '';
		expect(hooks).toContain('apiClient.refundSellerOrder(orderId, request)');
	});
});

