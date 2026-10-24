import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/admin/admin-layout.tsx',
		'/src/routes/admin/catalog-orders.tsx',
		'/src/routes/admin/catalog-order.tsx',
		'/src/hooks/use-admin-catalog-orders.ts',
		'/src/lib/api-client.ts',
		'/src/components/live-store/GoLiveDialog.tsx',
		'/src/components/confirm-button.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the admin catalog orders pages', () => {
	it('are routed for signed-in users at the path alert emails link to', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(
			/path: 'admin\/catalog-orders',\s*Component: protectedPage\(AdminCatalogOrdersPage\)/,
		);
		expect(routes).toMatch(
			/path: 'admin\/catalog-orders\/:id',\s*Component: protectedPage\(AdminCatalogOrderPage\)/,
		);
	});

	it('are linked from the admin pages', () => {
		expect(source('/src/routes/admin/admin-layout.tsx')).toContain(
			'path: ADMIN_CATALOG_ORDERS_PATH',
		);
		expect(source('/src/routes/admin/catalog-order.tsx')).toContain(
			'to={ADMIN_CATALOG_ORDERS_PATH}',
		);
	});

	it('list the orders that need someone by default, with a view of all of them and a button for the next page', () => {
		const list = source('/src/routes/admin/catalog-orders.tsx');
		expect(list).toContain("useState<AdminCatalogOrderView>('attention')");
		expect(list).toContain('useAdminCatalogOrders(view)');
		expect(list).toContain('orders.fetchNextPage()');
		expect(list).toContain('itemProgress(order.itemCounts)');
	});

	it('read and act on orders through the admin API', () => {
		const client = source('/src/lib/api-client.ts');
		for (const path of [
			'`/api/admin/catalog/orders?${query}`',
			'`/api/admin/catalog/orders/${encodeURIComponent(orderId)}`',
			'/sync`',
			'/retry`',
			'/release`',
			'/sandbox`',
		]) {
			expect(client, path).toContain(path);
		}
		expect(source('/src/hooks/use-admin-catalog-orders.ts')).toContain(
			'queryClient.invalidateQueries({ queryKey: queryKeys.account.catalogOrders.all() })',
		);
	});

	it('offer only the actions the order allows, asking before Retry and Release', () => {
		const page = source('/src/routes/admin/catalog-order.tsx');
		expect(page).toContain('catalogOrderActions(order)');
		expect(page).toMatch(/<ConfirmButton[^>]*label="Retry"/);
		expect(page).toMatch(/<ConfirmButton[^>]*label="Release"/);
		expect(page).toMatch(/stripePaymentUrl\(\s*order\.stripePaymentIntentId,\s*order\.mode,?\s*\)/);
	});

	it('share the confirm button with the Go live panel', () => {
		expect(source('/src/components/live-store/GoLiveDialog.tsx')).toContain(
			"import { ConfirmButton } from '@/components/confirm-button';",
		);
		expect(source('/src/components/confirm-button.tsx')).toContain(
			"from '@/components/ui/alert-dialog'",
		);
	});
});
