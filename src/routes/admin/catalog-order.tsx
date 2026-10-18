import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { ADMIN_CATALOG_ORDERS_PATH, type AdminCatalogOrderDetail, type AdminCatalogOrderRunner } from '@/api-types';
import { ConfirmButton } from '@/components/confirm-button';
import { useAdminCatalogOrder, useCatalogOrderAction, type CatalogOrderActionRequest } from '@/hooks/use-admin-catalog-orders';
import { formatCents } from '@/lib/pricing';
import { isForbiddenError } from '@/lib/security-error';
import { ITEM_STATUS_LABELS, ORDER_STATUS_BADGES, ORDER_STATUS_LABELS, catalogOrderActions, stripePaymentUrl } from './catalog-order-format';

export default function AdminCatalogOrderPage() {
	const { id = '' } = useParams();
	const order = useAdminCatalogOrder(id);

	return (
		<div className="size-full">
			<title>{pageTitle('Catalog order')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<Link to={ADMIN_CATALOG_ORDERS_PATH} className="w-fit text-sm text-kumo-default underline underline-offset-2">
					Catalog orders
				</Link>
				{order.data ? (
					<OrderDetail order={order.data} />
				) : order.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(order.error) ? (
					<Empty title="Admins only" description={order.error?.message} />
				) : (
					<Empty title="Couldn't load the order" description={order.error?.message} />
				)}
			</div>
		</div>
	);
}

function OrderDetail({ order }: { order: AdminCatalogOrderDetail }) {
	const action = useCatalogOrderAction(order.id);
	const actions = catalogOrderActions(order);
	const run = (request: CatalogOrderActionRequest, done: string) =>
		action.mutate(request, { onSuccess: () => toast.success(done), onError: (error) => toast.error(error.message) });

	return (
		<div className="grid gap-8">
			<section className="grid gap-2">
				<h1 className="text-3xl font-semibold text-kumo-strong">
					{order.orderNumber !== null ? `Order #${order.orderNumber}` : 'Catalog order'} at {order.storeTitle ?? order.storeAppId}
				</h1>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={ORDER_STATUS_BADGES[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
					<Badge variant="outline">{order.mode === 'test' ? 'Test' : order.mode === 'live' ? 'Live' : 'Mode unknown'}</Badge>
					<span className="text-sm text-kumo-subtle">Paid {new Date(order.createdAt).toLocaleString()}</span>
				</div>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
					<dt className="text-kumo-subtle">Seller</dt>
					<dd className="break-all">{order.sellerEmail ?? order.sellerUserId}</dd>
					<dt className="text-kumo-subtle">Payment</dt>
					<dd className="break-all">
						<a href={stripePaymentUrl(order.stripePaymentIntentId, order.mode)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
							{order.stripePaymentIntentId}
						</a>
					</dd>
					<dt className="text-kumo-subtle">Catalog order</dt>
					<dd className="break-all font-mono text-xs leading-5">{order.id}</dd>
				</dl>
				{order.lastError && <p className="text-sm text-kumo-danger">{order.lastError}</p>}
			</section>

			<section className="grid gap-3" aria-label="Actions">
				<div className="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" disabled={action.isPending} onClick={() => run({ kind: 'sync' }, 'Asked the supplier for updates')}>
						Sync now
					</Button>
					{actions.includes('retry') && (
						<ConfirmButton
							label="Retry"
							title="Place this order again?"
							description="Estori tries again to place the order's items with the supplier."
							pending={action.isPending}
							onConfirm={() => run({ kind: 'retry' }, 'Placing the order again')}
						/>
					)}
					{actions.includes('release') && (
						<ConfirmButton
							label="Release"
							title="Release this order?"
							description="Do this only after reviewing the payment. Estori places the catalog items with the supplier now, instead of refunding them when the hold ends."
							pending={action.isPending}
							onConfirm={() => run({ kind: 'release' }, 'Released the order')}
						/>
					)}
					{actions.includes('sandbox') && (
						<>
							<Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => run({ kind: 'sandbox', move: 'ship' }, 'Marked shipped in the sandbox')}>
								Mark shipped (sandbox)
							</Button>
							<Button variant="ghost" size="sm" disabled={action.isPending} onClick={() => run({ kind: 'sandbox', move: 'deliver' }, 'Marked delivered in the sandbox')}>
								Mark delivered (sandbox)
							</Button>
						</>
					)}
				</div>
			</section>

			<div className="grid gap-8 md:grid-cols-2">
				<Section title="Money">
					<dl className="grid grid-cols-[1fr_max-content] gap-y-1 text-sm">
						<dt className="text-kumo-subtle">Paid by the shopper</dt>
						<dd className="text-right">{formatCents(order.totalCents)}</dd>
						<dt className="text-kumo-subtle">Catalog cost</dt>
						<dd className="text-right">{formatCents(order.catalogTotalCents)}</dd>
						<dt className="text-kumo-subtle">Estori's fee</dt>
						<dd className="text-right">{formatCents(order.applicationFeeCents)}</dd>
						<dt className="text-kumo-subtle">Refunded</dt>
						<dd className="text-right">{formatCents(order.refundedCents)}</dd>
					</dl>
				</Section>
				<Section title="Ship to">
					<address className="text-sm not-italic leading-6">
						{order.shipTo.name}
						<br />
						{order.shipTo.line1}
						{order.shipTo.line2 && (
							<>
								<br />
								{order.shipTo.line2}
							</>
						)}
						<br />
						{[order.shipTo.city, order.shipTo.region, order.shipTo.postalCode].filter(Boolean).join(', ')}
						<br />
						{order.shipTo.countryCode}
						{order.shipTo.phone && (
							<>
								<br />
								{order.shipTo.phone}
							</>
						)}
					</address>
				</Section>
			</div>

			<Section title="Items">
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="text-kumo-subtle">
							<tr>
								<th scope="col" className="py-2 pr-4 font-normal">Product</th>
								<th scope="col" className="py-2 pr-4 font-normal">Qty</th>
								<th scope="col" className="py-2 pr-4 font-normal">Status</th>
								<th scope="col" className="py-2 pr-4 font-normal">Supplier order</th>
								<th scope="col" className="py-2 font-normal">Tracking</th>
							</tr>
						</thead>
						<tbody>
							{order.items.map((item) => (
								<tr key={item.id} className="border-t border-kumo-line align-top">
									<th scope="row" className="py-2.5 pr-4 font-normal">
										{item.name ?? item.catalogVariantId}
										<span className="block text-xs text-kumo-subtle">
											{formatCents(item.unitPriceCents)} each, catalog {formatCents(item.catalogPriceCents)}
										</span>
									</th>
									<td className="py-2.5 pr-4">{item.quantity}</td>
									<td className="py-2.5 pr-4">
										{ITEM_STATUS_LABELS[item.status]}
										{item.supplierRefunded && <span className="block text-xs text-kumo-subtle">Supplier refunded</span>}
									</td>
									<td className="py-2.5 pr-4 break-all">{item.supplierOrderId ?? 'Not placed'}</td>
									<td className="py-2.5 break-all">{item.trackingNumber ? `${item.trackingNumber}${item.carrier ? ` (${item.carrier})` : ''}` : 'None yet'}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</Section>

			<Section title="Order processing">
				<RunnerDetails runner={order.runner} placementAttempts={order.placementAttempts} />
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-medium text-kumo-strong">{title}</h2>
			{children}
		</section>
	);
}

const PLACEMENT_LABELS: Readonly<Record<AdminCatalogOrderRunner['placement'], string>> = {
	due: 'Placing with the supplier',
	done: 'Placed; following shipments',
	'needs-attention': 'Stopped until someone retries',
	'risk-hold': 'Held for a risky payment',
};

function RunnerDetails({ runner, placementAttempts }: { runner: AdminCatalogOrderRunner | null; placementAttempts: number }) {
	if (!runner) return <p className="text-sm text-kumo-subtle">The order's runner has no state to show.</p>;
	const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'None');
	return (
		<div className="grid gap-3">
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
				<dt className="text-kumo-subtle">Step</dt>
				<dd>{PLACEMENT_LABELS[runner.placement]}</dd>
				<dt className="text-kumo-subtle">Placement attempts</dt>
				<dd>{placementAttempts}</dd>
				<dt className="text-kumo-subtle">Next placement attempt</dt>
				<dd>{when(runner.nextPlacementAt)}</dd>
				<dt className="text-kumo-subtle">Next supplier check</dt>
				<dd>{when(runner.nextSyncAt)}</dd>
				{runner.riskHoldUntil && (
					<>
						<dt className="text-kumo-subtle">Hold refunds the items at</dt>
						<dd>{when(runner.riskHoldUntil)}</dd>
					</>
				)}
				<dt className="text-kumo-subtle">Failed refunds in a row</dt>
				<dd>{runner.refundFailures}</dd>
			</dl>
			<details className="text-sm">
				<summary className="cursor-pointer text-kumo-subtle">Raw state</summary>
				<pre className="mt-2 overflow-x-auto rounded-md bg-kumo-elevated p-3 text-xs">{runner.raw}</pre>
			</details>
		</div>
	);
}
