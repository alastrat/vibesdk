import { INTL_LOCALE } from 'shared/i18n/locales';
import { getLocale, t, useI18n, msg } from '@/lib/i18n';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Empty, Input, Loader, Select } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import {
	sellerOrderPath,
	type SellerOrderRow,
	type SellerOrderView,
} from '@/api-types';
import { useSellerOrders } from '@/hooks/use-seller-orders';
import { formatCents as centsInLocale } from '@/lib/pricing';
const formatCents = (cents: number) => centsInLocale(cents, getLocale());
import './orders.css';
import {
	PAYMENT_LABELS,
	customerLabel,
	itemsSummary,
	shippingStatus,
	storeLabel,
} from './order-format';

const VIEWS: ReadonlyArray<{ id: SellerOrderView; label: string }> = [
	{ id: 'to-ship', label: msg('To ship') },
	{ id: 'all', label: msg('All orders') },
];

export default function SellerOrdersPage() {
	useI18n();
	return (
		<div className="size-full seller-orders-page">
			<title>{pageTitle(t('Orders'))}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-6">
				<header className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">
						{t('Orders')}
					</h1>
					<p className="text-sm text-kumo-subtle">
						{t(
							'Orders from all your stores. Ship the items you sell yourself; Estori ships the catalog items.',
						)}
					</p>
				</header>
				<OrdersBrowser />
			</div>
		</div>
	);
}

/** All-time, cursor-paginated operational history, separate from date-bounded analytics. */
export function StoreOrdersPanel({ appId }: { appId: string }) {
	return <OrdersBrowser appId={appId} />;
}

function OrdersBrowser({ appId }: { appId?: string }) {
	useI18n();
	const [params, setParams] = useSearchParams();
	const view: SellerOrderView =
		params.get('view') === 'all' ||
		(appId && params.get('view') !== 'to-ship')
			? 'all'
			: 'to-ship';
	const showTest = params.get('mode') === 'all';
	const store = appId ?? (params.get('store') || null);
	const search = params.get('search') ?? '';
	const status = params.get('status') ?? 'all';
	const update = (key: string, value: string) => {
		const next = new URLSearchParams(params);
		if (value) next.set(key, value);
		else next.delete(key);
		setParams(next, { replace: true });
	};
	const orders = useSellerOrders({
		view,
		mode: showTest ? 'all' : 'live',
		store,
	});
	const data = orders.data?.pages[0];
	const loaded = orders.data?.pages.flatMap((page) => page.orders) ?? [];
	const rows = loaded.filter(
		(order) =>
			(!appId || order.appId === appId) &&
			(status === 'all' || order.paymentStatus === status) &&
			`${order.orderNumber} ${order.customerName ?? ''} ${order.customerEmail ?? ''} ${order.storeTitle ?? ''}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()),
	);
	const orderPath = (order: SellerOrderRow) => {
		const base = appId
			? `/stores/${encodeURIComponent(appId)}/orders/${encodeURIComponent(order.id)}`
			: sellerOrderPath(order.id);
		const query = params.toString();
		return query ? `${base}?${query}` : base;
	};
	return (
		<section className="seller-orders-browser grid gap-4">
			<div className="order-browser-summary">
				<div>
					<span>{t('Loaded orders')}</span>
					<strong>{loaded.length}</strong>
				</div>
				<div>
					<span>{t('Paid')}</span>
					<strong>
						{
							loaded.filter(
								(order) => order.paymentStatus === 'paid',
							).length
						}
					</strong>
				</div>
				<div>
					<span>{t('To ship')}</span>
					<strong>
						{
							loaded.filter(
								(order) =>
									order.ownUnits > 0 &&
									order.fulfillmentStatus === 'unfulfilled' &&
									(order.paymentStatus === 'paid' ||
										order.paymentStatus ===
											'partially_refunded'),
							).length
						}
					</strong>
				</div>
				<div>
					<span>{t('Refunded')}</span>
					<strong>
						{
							loaded.filter(
								(order) =>
									order.paymentStatus === 'refunded' ||
									order.paymentStatus ===
										'partially_refunded',
							).length
						}
					</strong>
				</div>
			</div>
			<p className="text-xs text-kumo-subtle">
				{t(
					'All time · Counts describe the loaded orders. Load more to browse older history.',
				)}
			</p>
			<div className="order-browser-toolbar">
				<div
					className="flex gap-1"
					role="group"
					aria-label={t('Which orders')}
				>
					{VIEWS.map((option) => (
						<Button
							key={option.id}
							size="sm"
							variant={view === option.id ? 'secondary' : 'ghost'}
							aria-pressed={view === option.id}
							onClick={() => update('view', option.id)}
						>
							{t(option.label)}
						</Button>
					))}
				</div>
				{!appId && data && data.stores.length > 0 && (
					<Select
						value={store ?? ''}
						onValueChange={(value) => update('store', value ?? '')}
						aria-label={t('Store')}
						items={{
							'': t('All stores'),
							...Object.fromEntries(
								data.stores.map((option) => [
									option.appId,
									storeLabel(option.title),
								]),
							),
						}}
					/>
				)}
				<Select
					value={showTest ? 'all' : 'live'}
					onValueChange={(value) => update('mode', value ?? 'live')}
					aria-label={t('Order mode')}
					items={{
						live: t('Live orders'),
						all: t('Live and test orders'),
					}}
				/>
				<Select
					value={status}
					onValueChange={(value) => update('status', value ?? 'all')}
					aria-label={t('Payment status')}
					items={{
						all: t('All payment statuses'),
						...Object.fromEntries(
							Object.entries(PAYMENT_LABELS).map(
								([key, label]) => [key, t(label)],
							),
						),
					}}
				/>
				<Input
					type="search"
					size="sm"
					value={search}
					onChange={(event) => update('search', event.target.value)}
					placeholder={t('Search loaded orders')}
					aria-label={t('Search loaded orders')}
				/>
			</div>
			{orders.data ? (
				rows.length > 0 ? (
					<>
						<OrdersTable rows={rows} orderPath={orderPath} />
						<OrderCards rows={rows} orderPath={orderPath} />
					</>
				) : (
					<div className="grid justify-items-center gap-3 py-10">
						<Empty
							title={
								search || status !== 'all'
									? t('No orders match')
									: view === 'to-ship'
										? t('Nothing to ship')
										: t('No orders yet')
							}
							description={
								search || status !== 'all'
									? t(
											'Change your filters or load more orders to search older history.',
										)
									: t(
											'Orders from your stores show up here once shoppers buy.',
										)
							}
						/>
						{!showTest && data?.hasTestOrders && (
							<Button
								variant="secondary"
								size="sm"
								onClick={() => update('mode', 'all')}
							>
								{t('Show test orders')}
							</Button>
						)}
					</div>
				)
			) : orders.isLoading ? (
				<div className="flex justify-center py-16">
					<Loader />
				</div>
			) : (
				<Empty
					title={t("Couldn't load your orders")}
					description={orders.error?.message}
					contents={
						<Button size="sm" onClick={() => void orders.refetch()}>
							{t('Try again')}
						</Button>
					}
				/>
			)}
			{orders.isFetchNextPageError && (
				<p role="alert" className="text-sm text-kumo-danger">
					{orders.error?.message}
				</p>
			)}
			{orders.hasNextPage && (
				<Button
					variant="secondary"
					size="sm"
					className="w-fit"
					onClick={() => void orders.fetchNextPage()}
					loading={orders.isFetchingNextPage}
					disabled={orders.isFetchingNextPage}
				>
					{t('Load more')}
				</Button>
			)}
		</section>
	);
}

function PaymentBadges({ order }: { order: SellerOrderRow }) {
	useI18n();
	return (
		<span className="flex flex-wrap gap-1">
			<Badge
				variant={
					order.paymentStatus === 'paid'
						? 'success'
						: order.paymentStatus === 'disputed' ||
							  order.paymentStatus === 'dispute_lost'
							? 'error'
							: 'secondary'
				}
			>
				{t(PAYMENT_LABELS[order.paymentStatus])}
			</Badge>
			{order.mode === 'test' && (
				<Badge variant="outline">{t('Test')}</Badge>
			)}
		</span>
	);
}

function OrdersTable({
	rows,
	orderPath,
}: {
	rows: SellerOrderRow[];
	orderPath: (order: SellerOrderRow) => string;
}) {
	useI18n();
	return (
		<div className="hidden overflow-x-auto sm:block">
			<table className="w-full text-left text-sm">
				<caption className="sr-only">
					{t('Your orders, newest first')}
				</caption>
				<thead className="text-kumo-subtle">
					<tr>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Order')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Store')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Customer')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Items')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Total')}
						</th>
						<th scope="col" className="py-2 pr-4 font-normal">
							{t('Payment')}
						</th>
						<th scope="col" className="py-2 font-normal">
							{t('Shipping')}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((order) => (
						<tr
							key={order.id}
							className="border-t border-kumo-line align-top text-kumo-default"
						>
							<th scope="row" className="py-2.5 pr-4 font-normal">
								<Link
									to={orderPath(order)}
									className="underline underline-offset-2"
								>
									{t('Order #{number}', {
										number: order.orderNumber,
									})}
								</Link>
								<span className="block text-xs text-kumo-subtle">
									{new Date(order.createdAt).toLocaleString(
										INTL_LOCALE[getLocale()],
									)}
								</span>
							</th>
							<td className="py-2.5 pr-4">
								{storeLabel(order.storeTitle)}
							</td>
							<td className="py-2.5 pr-4">
								{customerLabel(
									order.customerName,
									order.customerEmail,
								)}
								{order.customerName && order.customerEmail && (
									<span className="block text-xs break-all text-kumo-subtle">
										{order.customerEmail}
									</span>
								)}
							</td>
							<td className="py-2.5 pr-4">
								{itemsSummary(order)}
							</td>
							<td className="py-2.5 pr-4">
								{formatCents(order.totalCents)}
							</td>
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
function OrderCards({
	rows,
	orderPath,
}: {
	rows: SellerOrderRow[];
	orderPath: (order: SellerOrderRow) => string;
}) {
	useI18n();
	return (
		<ul className="grid gap-3 sm:hidden">
			{rows.map((order) => (
				<li
					key={order.id}
					className="grid gap-1.5 rounded-lg border border-kumo-line p-3 text-sm"
				>
					<div className="flex items-center justify-between gap-2">
						<Link
							to={orderPath(order)}
							className="font-medium underline underline-offset-2"
						>
							{t('Order #')}
							{order.orderNumber}
						</Link>
						<span>{formatCents(order.totalCents)}</span>
					</div>
					<span className="text-kumo-subtle">
						{storeLabel(order.storeTitle)} ·{' '}
						{new Date(order.createdAt).toLocaleDateString(
							INTL_LOCALE[getLocale()],
						)}
					</span>
					<span>
						{customerLabel(order.customerName, order.customerEmail)}
					</span>
					<span>
						{itemsSummary(order)} · {shippingStatus(order)}
					</span>
					<PaymentBadges order={order} />
				</li>
			))}
		</ul>
	);
}
