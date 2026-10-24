import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminPanel, Table } from './admin-layout';
import {
	ADMIN_CATALOG_ORDERS_PATH,
	type AdminCatalogOrderDetail,
	type AdminCatalogOrderRunner,
} from '@/api-types';
import { ConfirmButton } from '@/components/confirm-button';
import {
	useAdminCatalogOrder,
	useCatalogOrderAction,
	type CatalogOrderActionRequest,
} from '@/hooks/use-admin-catalog-orders';
import { formatCents } from '@/lib/pricing';
import { isForbiddenError } from '@/lib/security-error';
import {
	ITEM_STATUS_LABELS,
	ORDER_STATUS_BADGES,
	ORDER_STATUS_LABELS,
	catalogOrderActions,
	stripePaymentUrl,
} from './catalog-order-format';

export default function AdminCatalogOrderPage() {
	useI18n();
	const { id = '' } = useParams();
	const order = useAdminCatalogOrder(id);

	return (
		<AdminPage
			section="catalog-orders"
			title={t('Catalog order')}
			description={t(
				'Inspect fulfillment, payment details, and supplier updates.',
			)}
			refreshing={order.isFetching}
			onRefresh={() => void order.refetch()}
		>
			<Link
				to={ADMIN_CATALOG_ORDERS_PATH}
				className="w-fit text-sm text-kumo-subtle underline underline-offset-2"
			>
				{t('Back to catalog orders')}
			</Link>
			{order.data ? (
				<OrderDetail order={order.data} />
			) : order.isLoading ? (
				<div className="flex justify-center py-16">
					<Loader />
				</div>
			) : isForbiddenError(order.error) ? (
				<Empty
					title={t('Admins only')}
					description={order.error?.message}
				/>
			) : (
				<Empty
					title={t("Couldn't load the order")}
					description={order.error?.message}
				/>
			)}
		</AdminPage>
	);
}

function OrderDetail({ order }: { order: AdminCatalogOrderDetail }) {
	const action = useCatalogOrderAction(order.id);
	const actions = catalogOrderActions(order);
	const run = (request: CatalogOrderActionRequest, done: string) =>
		action.mutate(request, {
			onSuccess: () => toast.success(done),
			onError: (error) => toast.error(error.message),
		});

	return (
		<div className="grid gap-4">
			<section className="admin-detail-summary grid gap-3">
				<h2 className="text-xl font-semibold text-kumo-strong">
					{t('{order} at {store}', {
						order:
							order.orderNumber !== null
								? t('Order #{number}', {
										number: order.orderNumber,
									})
								: t('Catalog order'),
						store: order.storeTitle ?? order.storeAppId,
					})}
				</h2>
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={ORDER_STATUS_BADGES[order.status]}>
						{t(ORDER_STATUS_LABELS[order.status])}
					</Badge>
					<Badge variant="outline">
						{order.mode === 'test'
							? 'Test'
							: order.mode === 'live'
								? 'Live'
								: 'Mode unknown'}
					</Badge>
					<span className="text-sm text-kumo-subtle">
						Paid {new Date(order.createdAt).toLocaleString()}
					</span>
				</div>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
					<dt className="text-kumo-subtle">{t('Seller')}</dt>
					<dd className="break-all">
						{order.sellerEmail ?? order.sellerUserId}
					</dd>
					<dt className="text-kumo-subtle">{t('Payment')}</dt>
					<dd className="break-all">
						<a
							href={stripePaymentUrl(
								order.stripePaymentIntentId,
								order.mode,
							)}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2"
						>
							{order.stripePaymentIntentId}
						</a>
					</dd>
					<dt className="text-kumo-subtle">{t('Catalog order')}</dt>
					<dd className="break-all font-mono text-xs leading-5">
						{order.id}
					</dd>
				</dl>
				{order.lastError && (
					<p className="text-sm text-kumo-danger">
						{order.lastError}
					</p>
				)}
			</section>

			<AdminPanel title={t('Order actions')}>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="secondary"
						size="sm"
						disabled={action.isPending}
						onClick={() =>
							run(
								{ kind: 'sync' },
								'Asked the supplier for updates',
							)
						}
					>
						Sync now
					</Button>
					{actions.includes('retry') && (
						<ConfirmButton
							label="Retry"
							title={t('Place this order again?')}
							description={t(
								"Estori tries again to place the order's items with the supplier.",
							)}
							pending={action.isPending}
							onConfirm={() =>
								run(
									{ kind: 'retry' },
									'Placing the order again',
								)
							}
						/>
					)}
					{actions.includes('release') && (
						<ConfirmButton
							label="Release"
							title={t('Release this order?')}
							description={t(
								'Do this only after reviewing the payment. Estori places the catalog items with the supplier now, instead of refunding them when the hold ends.',
							)}
							pending={action.isPending}
							onConfirm={() =>
								run({ kind: 'release' }, 'Released the order')
							}
						/>
					)}
					{actions.includes('sandbox') && (
						<>
							<Button
								variant="ghost"
								size="sm"
								disabled={action.isPending}
								onClick={() =>
									run(
										{ kind: 'sandbox', move: 'ship' },
										'Marked shipped in the sandbox',
									)
								}
							>
								Mark shipped (sandbox)
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={action.isPending}
								onClick={() =>
									run(
										{ kind: 'sandbox', move: 'deliver' },
										'Marked delivered in the sandbox',
									)
								}
							>
								Mark delivered (sandbox)
							</Button>
						</>
					)}
				</div>
			</AdminPanel>

			<div className="grid gap-4 md:grid-cols-2">
				<Section title={t('Money')}>
					<dl className="grid grid-cols-[1fr_max-content] gap-y-1 text-sm">
						<dt className="text-kumo-subtle">
							{t('Paid by the shopper')}
						</dt>
						<dd className="text-right">
							{formatCents(order.totalCents)}
						</dd>
						<dt className="text-kumo-subtle">
							{t('Catalog cost')}
						</dt>
						<dd className="text-right">
							{formatCents(order.catalogTotalCents)}
						</dd>
						<dt className="text-kumo-subtle">
							{t("Estori's fee")}
						</dt>
						<dd className="text-right">
							{formatCents(order.applicationFeeCents)}
						</dd>
						<dt className="text-kumo-subtle">{t('Refunded')}</dt>
						<dd className="text-right">
							{formatCents(order.refundedCents)}
						</dd>
					</dl>
				</Section>
				<Section title={t('Ship to')}>
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
						{[
							order.shipTo.city,
							order.shipTo.region,
							order.shipTo.postalCode,
						]
							.filter(Boolean)
							.join(', ')}
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

			<Section title={t('Items')}>
				<div className="admin-table-scroll">
					<Table className="w-full text-left text-sm">
						<Table.Header className="text-kumo-subtle">
							<Table.Row>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Product')}
								</th>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Qty')}
								</th>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Status')}
								</th>
								<th
									scope="col"
									className="py-2 pr-4 font-normal"
								>
									{t('Supplier order')}
								</th>
								<th
									scope="col"
									className="py-2 font-normal"
								>
									{t('Tracking')}
								</th>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{order.items.map((item) => (
								<Table.Row
									key={item.id}
									className="border-t border-kumo-line align-top"
								>
									<th
										scope="row"
										className="py-2.5 pr-4 font-normal"
									>
										{item.name ?? item.catalogVariantId}
										<span className="block text-xs text-kumo-subtle">
											{formatCents(item.unitPriceCents)}{' '}
											each, catalog{' '}
											{formatCents(
												item.catalogPriceCents,
											)}
										</span>
									</th>
									<Table.Cell className="py-2.5 pr-4">
										{item.quantity}
									</Table.Cell>
									<Table.Cell className="py-2.5 pr-4">
										{t(ITEM_STATUS_LABELS[item.status])}
										{item.supplierRefunded && (
											<span className="block text-xs text-kumo-subtle">
												{t('Supplier refunded')}
											</span>
										)}
									</Table.Cell>
									<Table.Cell className="py-2.5 pr-4 break-all">
										{item.supplierOrderId ?? 'Not placed'}
									</Table.Cell>
									<Table.Cell className="py-2.5 break-all">
										{item.trackingNumber
											? `${item.trackingNumber}${item.carrier ? ` (${item.carrier})` : ''}`
											: 'None yet'}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
				</div>
			</Section>

			<Section title={t('Order processing')}>
				<RunnerDetails
					runner={order.runner}
					placementAttempts={order.placementAttempts}
				/>
			</Section>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return <AdminPanel title={title}>{children}</AdminPanel>;
}

const PLACEMENT_LABELS: Readonly<
	Record<AdminCatalogOrderRunner['placement'], string>
> = {
	due: 'Placing with the supplier',
	done: 'Placed; following shipments',
	'needs-attention': 'Stopped until someone retries',
	'risk-hold': 'Held for a risky payment',
};

function RunnerDetails({
	runner,
	placementAttempts,
}: {
	runner: AdminCatalogOrderRunner | null;
	placementAttempts: number;
}) {
	if (!runner)
		return (
			<p className="text-sm text-kumo-subtle">
				{t("The order's runner has no state to show.")}
			</p>
		);
	const when = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString() : 'None';
	return (
		<div className="grid gap-3">
			<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
				<dt className="text-kumo-subtle">{t('Step')}</dt>
				<dd>{PLACEMENT_LABELS[runner.placement]}</dd>
				<dt className="text-kumo-subtle">{t('Placement attempts')}</dt>
				<dd>{placementAttempts}</dd>
				<dt className="text-kumo-subtle">
					{t('Next placement attempt')}
				</dt>
				<dd>{when(runner.nextPlacementAt)}</dd>
				<dt className="text-kumo-subtle">{t('Next supplier check')}</dt>
				<dd>{when(runner.nextSyncAt)}</dd>
				{runner.riskHoldUntil && (
					<>
						<dt className="text-kumo-subtle">
							{t('Hold refunds the items at')}
						</dt>
						<dd>{when(runner.riskHoldUntil)}</dd>
					</>
				)}
				<dt className="text-kumo-subtle">
					{t('Failed refunds in a row')}
				</dt>
				<dd>{runner.refundFailures}</dd>
			</dl>
			<details className="text-sm">
				<summary className="cursor-pointer text-kumo-subtle">
					{t('Raw state')}
				</summary>
				<pre className="mt-2 overflow-x-auto rounded-md bg-kumo-elevated p-3 text-xs">
					{runner.raw}
				</pre>
			</details>
		</div>
	);
}
