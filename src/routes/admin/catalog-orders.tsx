import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { ADMIN_CATALOG_ORDERS_PATH, type AdminCatalogOrderRow, type AdminCatalogOrderView } from '@/api-types';
import { useAdminCatalogOrders } from '@/hooks/use-admin-catalog-orders';
import { isForbiddenError } from '@/lib/security-error';
import { ORDER_STATUS_LABELS, ORDER_STATUS_BADGES, itemProgress } from './catalog-order-format';

const VIEWS: ReadonlyArray<{ id: AdminCatalogOrderView; label: string }> = [
	{ id: 'attention', label: 'Needs attention' },
	{ id: 'all', label: 'All orders' },
];

export default function AdminCatalogOrdersPage() {
	const [view, setView] = useState<AdminCatalogOrderView>('attention');
	const orders = useAdminCatalogOrders(view);
	const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];

	return (
		<div className="size-full">
			<title>{pageTitle('Catalog orders')}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<Link to="/admin/reviews" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Reviews
					</Link>
					<h1 className="text-3xl font-semibold text-kumo-strong">Catalog orders</h1>
					<p className="text-kumo-subtle">
						Orders Estori places with the supplier. Needs attention lists the stuck and risk-held ones, those with an item
						held back, and those with an item late to ship or arrive.
					</p>
				</div>
				<div className="flex gap-2" role="group" aria-label="Which orders">
					{VIEWS.map((option) => (
						<Button key={option.id} size="sm" variant={view === option.id ? 'primary' : 'secondary'} aria-pressed={view === option.id} onClick={() => setView(option.id)}>
							{option.label}
						</Button>
					))}
				</div>
				{orders.data ? (
					rows.length > 0 ? (
						<OrdersTable rows={rows} />
					) : (
						<Empty
							title={view === 'attention' ? 'Nothing needs you' : 'No catalog orders yet'}
							description={view === 'attention' ? 'Every catalog order is on its way.' : 'Orders with catalog items show up here once they are paid.'}
						/>
					)
				) : orders.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(orders.error) ? (
					<Empty title="Admins only" description={orders.error?.message} />
				) : (
					<Empty title="Couldn't load catalog orders" description={orders.error?.message} />
				)}
				{orders.hasNextPage && (
					<Button variant="secondary" size="sm" className="w-fit" onClick={() => void orders.fetchNextPage()} loading={orders.isFetchingNextPage}>
						Load more
					</Button>
				)}
			</div>
		</div>
	);
}

function OrdersTable({ rows }: { rows: AdminCatalogOrderRow[] }) {
	return (
		<div className="overflow-x-auto">
			<table className="w-full text-left text-sm">
				<caption className="sr-only">Catalog orders, newest first</caption>
				<thead className="text-kumo-subtle">
					<tr>
						<th scope="col" className="py-2 pr-4 font-normal">Order</th>
						<th scope="col" className="py-2 pr-4 font-normal">Store</th>
						<th scope="col" className="py-2 pr-4 font-normal">Seller</th>
						<th scope="col" className="py-2 pr-4 font-normal">Status</th>
						<th scope="col" className="py-2 pr-4 font-normal">Items</th>
						<th scope="col" className="py-2 font-normal">Last error</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((order) => (
						<tr key={order.id} className="border-t border-kumo-line align-top text-kumo-default">
							<th scope="row" className="py-2.5 pr-4 font-normal">
								<Link to={`${ADMIN_CATALOG_ORDERS_PATH}/${encodeURIComponent(order.id)}`} className="underline underline-offset-2">
									{order.orderNumber !== null ? `Order #${order.orderNumber}` : order.id.slice(0, 8)}
								</Link>
								<span className="block text-xs text-kumo-subtle">{new Date(order.createdAt).toLocaleString()}</span>
							</th>
							<td className="py-2.5 pr-4">
								<Link to={`/app/${encodeURIComponent(order.storeAppId)}`} className="underline underline-offset-2">
									{order.storeTitle ?? order.storeAppId}
								</Link>
							</td>
							<td className="py-2.5 pr-4 break-all">{order.sellerEmail ?? 'Unknown'}</td>
							<td className="py-2.5 pr-4">
								<span className="flex flex-wrap gap-1">
									<Badge variant={ORDER_STATUS_BADGES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
									{order.mode === 'test' && <Badge variant="outline">Test</Badge>}
								</span>
							</td>
							<td className="py-2.5 pr-4">{itemProgress(order.itemCounts)}</td>
							<td className="py-2.5 max-w-xs text-kumo-subtle">{order.lastError ?? ''}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
