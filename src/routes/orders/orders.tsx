import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { sellerOrderPath, type SellerOrderRow, type SellerOrderView } from '@/api-types';
import { useSellerOrders } from '@/hooks/use-seller-orders';
import { formatCents } from '@/lib/pricing';
import { PAYMENT_LABELS, customerLabel, itemsSummary, shippingStatus, storeLabel } from './order-format';

const VIEWS: ReadonlyArray<{ id: SellerOrderView; label: string }> = [
	{ id: 'to-ship', label: 'To ship' },
	{ id: 'all', label: 'All orders' },
];

export default function SellerOrdersPage() {
	const [view, setView] = useState<SellerOrderView>('to-ship');
	const [showTest, setShowTest] = useState(false);
	const [store, setStore] = useState<string | null>(null);
	const orders = useSellerOrders({ view, mode: showTest ? 'all' : 'live', store });
	const data = orders.data?.pages[0];
	const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];

	return (
		<div className="size-full">
			<title>{pageTitle('Orders')}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">Orders</h1>
					<p className="text-kumo-subtle">Orders from all your stores. Ship the items you sell yourself; Estori ships the catalog items.</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<div className="flex gap-2" role="group" aria-label="Which orders">
						{VIEWS.map((option) => (
							<Button key={option.id} size="sm" variant={view === option.id ? 'primary' : 'secondary'} aria-pressed={view === option.id} onClick={() => setView(option.id)}>
								{option.label}
							</Button>
						))}
					</div>
					{data && data.stores.length > 1 && (
						<label className="flex items-center gap-2 text-sm text-kumo-subtle">
							Store
							<select className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm text-kumo-default" value={store ?? ''} onChange={(event) => setStore(event.target.value || null)}>
								<option value="">All stores</option>
								{data.stores.map((option) => (
									<option key={option.appId} value={option.appId}>
										{storeLabel(option.title)}
									</option>
								))}
							</select>
						</label>
					)}
					<label className="flex items-center gap-2 text-sm text-kumo-subtle">
						<input type="checkbox" checked={showTest} onChange={(event) => setShowTest(event.target.checked)} />
						Show test orders
					</label>
				</div>

				{orders.data ? (
					rows.length > 0 ? (
						<>
							<OrdersTable rows={rows} />
							<OrderCards rows={rows} />
						</>
					) : (
						<div className="grid justify-items-center gap-3">
							<Empty
								title={view === 'to-ship' ? 'Nothing to ship' : 'No orders yet'}
								description={view === 'to-ship' ? 'Orders with items you ship yourself show up here.' : 'Orders from your stores show up here once shoppers buy.'}
							/>
							{!showTest && data?.hasTestOrders && (
								<p className="text-sm text-kumo-subtle">
									Your test orders are hidden.{' '}
									<button type="button" className="underline underline-offset-2" onClick={() => setShowTest(true)}>
										Show test orders
									</button>
								</p>
							)}
						</div>
					)
				) : orders.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : (
					<Empty title="Couldn't load your orders" description={orders.error?.message} />
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

function PaymentBadges({ order }: { order: SellerOrderRow }) {
	return (
		<span className="flex flex-wrap gap-1">
			<Badge variant={order.paymentStatus === 'paid' ? 'success' : order.paymentStatus === 'disputed' || order.paymentStatus === 'dispute_lost' ? 'error' : 'secondary'}>{PAYMENT_LABELS[order.paymentStatus]}</Badge>
			{order.mode === 'test' && <Badge variant="outline">Test</Badge>}
		</span>
	);
}

function OrdersTable({ rows }: { rows: SellerOrderRow[] }) {
	return (
		<div className="hidden overflow-x-auto sm:block">
			<table className="w-full text-left text-sm">
				<caption className="sr-only">Your orders, newest first</caption>
				<thead className="text-kumo-subtle">
					<tr>
						<th scope="col" className="py-2 pr-4 font-normal">Order</th>
						<th scope="col" className="py-2 pr-4 font-normal">Store</th>
						<th scope="col" className="py-2 pr-4 font-normal">Customer</th>
						<th scope="col" className="py-2 pr-4 font-normal">Items</th>
						<th scope="col" className="py-2 pr-4 font-normal">Total</th>
						<th scope="col" className="py-2 pr-4 font-normal">Payment</th>
						<th scope="col" className="py-2 font-normal">Shipping</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((order) => (
						<tr key={order.id} className="border-t border-kumo-line align-top text-kumo-default">
							<th scope="row" className="py-2.5 pr-4 font-normal">
								<Link to={sellerOrderPath(order.id)} className="underline underline-offset-2">
									Order #{order.orderNumber}
								</Link>
								<span className="block text-xs text-kumo-subtle">{new Date(order.createdAt).toLocaleString()}</span>
							</th>
							<td className="py-2.5 pr-4">{storeLabel(order.storeTitle)}</td>
							<td className="py-2.5 pr-4">
								{customerLabel(order.customerName, order.customerEmail)}
								{order.customerName && order.customerEmail && <span className="block text-xs break-all text-kumo-subtle">{order.customerEmail}</span>}
							</td>
							<td className="py-2.5 pr-4">{itemsSummary(order)}</td>
							<td className="py-2.5 pr-4">{formatCents(order.totalCents)}</td>
							<td className="py-2.5 pr-4">
								<PaymentBadges order={order} />
							</td>
							<td className="py-2.5">{shippingStatus(order)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** The same orders as cards, for phones. */
function OrderCards({ rows }: { rows: SellerOrderRow[] }) {
	return (
		<ul className="grid gap-3 sm:hidden">
			{rows.map((order) => (
				<li key={order.id} className="grid gap-1.5 rounded-lg border border-kumo-line p-3 text-sm">
					<div className="flex items-center justify-between gap-2">
						<Link to={sellerOrderPath(order.id)} className="font-medium underline underline-offset-2">
							Order #{order.orderNumber}
						</Link>
						<span>{formatCents(order.totalCents)}</span>
					</div>
					<span className="text-kumo-subtle">
						{storeLabel(order.storeTitle)} · {new Date(order.createdAt).toLocaleDateString()}
					</span>
					<span>{customerLabel(order.customerName, order.customerEmail)}</span>
					<span>
						{itemsSummary(order)} · {shippingStatus(order)}
					</span>
					<PaymentBadges order={order} />
				</li>
			))}
		</ul>
	);
}
