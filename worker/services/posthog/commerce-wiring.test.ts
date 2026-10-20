import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/services/store-payments/wiring.ts', '/worker/services/payments/purchase-wiring.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	return text.slice(from, text.indexOf(end, from + start.length));
}

const wiring = sources['/worker/services/store-payments/wiring.ts'] ?? '';
const purchases = sources['/worker/services/payments/purchase-wiring.ts'] ?? '';

describe('money events are sent where records are first written', () => {
	it('sends sale_completed once per order, from both the webhook and the return page', () => {
		const record = between(wiring, 'recordOrder: async (order) => {', 'notifyNewOrder:');
		expect(record).toContain("if (recorded === 'recorded') {");
		expect(record).toContain("capture('sale_completed', order.sellerUserId, saleCompletedProperties(order, firstSale))");
		expect(record).toContain('sellerOrderCount(order.sellerUserId, order.mode)');
	});

	it('sends catalog_order_placed when the catalog lines are first recorded', () => {
		const handOff = between(wiring, 'handOffCatalogLines: async (paid) => {', 'settleSale:');
		expect(handOff).toContain("if (recorded.result === 'recorded' && recorded.orderId) {");
		expect(handOff).toContain("capture('catalog_order_placed', paid.sellerUserId, catalogOrderPlacedProperties(paid))");
	});

	it("sends template_sold to the listing's seller when a paid site sale is first recorded", () => {
		const record = between(purchases, 'recordStripePurchase: async (record) => {', 'sessionRecorded:');
		expect(record).toContain('if (recorded) {');
		expect(record).toContain("capture('template_sold', seller.userId, templateSoldProperties(record))");
	});
});
