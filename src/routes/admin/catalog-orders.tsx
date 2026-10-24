import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { msg, t, useI18n } from '@/lib/i18n';
import { AdminPage, AdminTablePanel, Table } from './admin-layout';
import {
	ADMIN_CATALOG_ORDERS_PATH,
	type AdminCatalogOrderRow,
	type AdminCatalogOrderView,
} from '@/api-types';
import { useAdminCatalogOrders } from '@/hooks/use-admin-catalog-orders';
import { isForbiddenError } from '@/lib/security-error';
import {
	ORDER_STATUS_LABELS,
	ORDER_STATUS_BADGES,
	itemProgress,
} from './catalog-order-format';

const VIEWS: ReadonlyArray<{ id: AdminCatalogOrderView; label: string }> = [
	{ id: 'attention', label: msg('Needs attention') },
	{ id: 'all', label: msg('All orders') },
];

export default function AdminCatalogOrdersPage() {
	useI18n();
	const [view, setView] = useState<AdminCatalogOrderView>('attention');
	const orders = useAdminCatalogOrders(view);
	const rows = orders.data?.pages.flatMap((page) => page.orders) ?? [];

	const viewControls = (
		<div className="flex gap-2" role="group" aria-label={t('Which orders')}>
			{VIEWS.map((option) => (
				<Button
					key={option.id}
					size="sm"
					variant={view === option.id ? 'primary' : 'secondary'}
					aria-pressed={view === option.id}
					onClick={() => setView(option.id)}
				>
					{t(option.label)}
				</Button>
			))}
		</div>
	);

	return (
		<AdminPage
			section="catalog-orders"
			title={t('Catalog orders')}
			description={t(
				'Orders Estori places with the supplier. Review stuck orders, payment holds, and delayed shipments.',
			)}
			refreshing={orders.isFetching}
			onRefresh={() => void orders.refetch()}
		>
			<AdminTablePanel
				title={t('Supplier orders')}
				count={orders.data ? rows.length : undefined}
				actions={viewControls}
			>
				{orders.data ? (
					rows.length > 0 ? (
						<OrdersTable rows={rows} />
					) : (
						<Empty
							title={
								view === 'attention'
									? t('Nothing needs you')
									: t('No catalog orders yet')
							}
							description={
								view === 'attention'
									? t('Every catalog order is on its way.')
									: t(
											'Orders with catalog items show up here once they are paid.',
										)
							}
						/>
					)
				) : orders.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(orders.error) ? (
					<Empty
						title={t('Admins only')}
						description={orders.error?.message}
					/>
				) : (
					<Empty
						title={t("Couldn't load catalog orders")}
						description={orders.error?.message}
					/>
				)}
				{orders.hasNextPage && (
					<Button
						variant="secondary"
						size="sm"
						className="w-fit"
						onClick={() => void orders.fetchNextPage()}
						loading={orders.isFetchingNextPage}
					>
						{t('Load more')}
					</Button>
				)}
			</AdminTablePanel>
		</AdminPage>
	);
}

function OrdersTable({ rows }: { rows: AdminCatalogOrderRow[] }) {
	return (
		<Table className="w-full text-left text-sm">
			<caption className="sr-only">
				{t('Catalog orders, newest first')}
			</caption>
			<Table.Header className="text-kumo-subtle">
				<Table.Row>
					<th scope="col" className="py-2 pr-4 font-normal">
						{t('Order')}
					</th>
					<th scope="col" className="py-2 pr-4 font-normal">
						{t('Store')}
					</th>
					<th scope="col" className="py-2 pr-4 font-normal">
						{t('Seller')}
					</th>
					<th scope="col" className="py-2 pr-4 font-normal">
						{t('Status')}
					</th>
					<th scope="col" className="py-2 pr-4 font-normal">
						{t('Items')}
					</th>
					<th scope="col" className="py-2 font-normal">
						{t('Last error')}
					</th>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{rows.map((order) => (
					<Table.Row
						key={order.id}
						className="border-t border-kumo-line align-top text-kumo-default"
					>
						<th scope="row" className="py-2.5 pr-4 font-normal">
							<Link
								to={`${ADMIN_CATALOG_ORDERS_PATH}/${encodeURIComponent(order.id)}`}
								className="underline underline-offset-2"
							>
								{order.orderNumber !== null
									? t('Order #{number}', {
											number: order.orderNumber,
										})
									: order.id.slice(0, 8)}
							</Link>
							<span className="block text-xs text-kumo-subtle">
								{new Date(order.createdAt).toLocaleString()}
							</span>
						</th>
						<Table.Cell className="py-2.5 pr-4">
							<Link
								to={`/app/${encodeURIComponent(order.storeAppId)}`}
								className="underline underline-offset-2"
							>
								{order.storeTitle ?? order.storeAppId}
							</Link>
						</Table.Cell>
						<Table.Cell className="py-2.5 pr-4 break-all">
							{order.sellerEmail ?? t('Unknown')}
						</Table.Cell>
						<Table.Cell className="py-2.5 pr-4">
							<span className="flex flex-wrap gap-1">
								<Badge
									variant={ORDER_STATUS_BADGES[order.status]}
								>
									{t(ORDER_STATUS_LABELS[order.status])}
								</Badge>
								{order.mode === 'test' && (
									<Badge variant="outline">{t('Test')}</Badge>
								)}
							</span>
						</Table.Cell>
						<Table.Cell className="py-2.5 pr-4">
							{itemProgress(order.itemCounts)}
						</Table.Cell>
						<Table.Cell className="py-2.5 max-w-xs text-kumo-subtle">
							{order.lastError ?? ''}
						</Table.Cell>
					</Table.Row>
				))}
			</Table.Body>
		</Table>
	);
}
