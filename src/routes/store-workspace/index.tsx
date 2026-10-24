import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
	Badge,
	Button,
	Dialog,
	Input,
	Loader,
	Select,
	Table,
} from '@cloudflare/kumo';
import {
	EnvelopeIcon,
	TranslateIcon,
	GearSixIcon,
	XIcon,
	ArrowLeftIcon,
	ArrowUpRightIcon,
	ChartLineUpIcon,
	CreditCardIcon,
	HouseIcon,
	PackageIcon,
	StorefrontIcon,
	UsersIcon,
} from '@phosphor-icons/react';
import type { AppDetailsData, SellerOrderRow } from '@/api-types';
import { StoreEmailsPanel } from '@/routes/emails/emails';
import { StoreTranslationsPanel } from '@/routes/translations/translations';
import { StoreProductsPanel } from './products';
import { StoreSettingsPanel } from './settings';
import { StoreOrdersPanel } from '../orders/orders';
import { StoreHomeIntroduction, StoreHomeCollection } from './home-overview';
import { pageTitle } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useApp } from '@/hooks/use-app';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { getLocale, msg, t, useI18n } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
import { INTL_LOCALE } from 'shared/i18n/locales';
import {
	customerLabel,
	PAYMENT_LABELS,
	shippingStatus,
} from '@/routes/orders/order-format';
import {
	aggregateOrders,
	fetchReportOrders,
	reportingWindow,
	type CustomerSummary,
} from './report';
import './store-workspace.css';
import { LiveStoreAnalytics } from './live-analytics';
import { AnalyticsPanel } from './analytics-panel';
import { AnalyticsToolbar } from './analytics-toolbar';
import {
	analyticsPeriod,
	ordersForProduct,
	productOptions,
	ANALYTICS_WIDGETS,
} from './analytics-filters';
import { MetricChart } from './metric-chart';

const sections = [
	{ id: 'home', label: msg('Home'), icon: HouseIcon },
	{ id: 'analytics', label: msg('Analytics'), icon: ChartLineUpIcon },
	{ id: 'products', label: msg('Products'), icon: PackageIcon },
	{ id: 'customers', label: msg('Customers'), icon: UsersIcon },
	{ id: 'payments', label: msg('Payments'), icon: CreditCardIcon },
	{ id: 'emails', label: msg('Emails'), icon: EnvelopeIcon },
	{ id: 'translations', label: msg('Translations'), icon: TranslateIcon },
	{ id: 'settings', label: msg('Settings'), icon: GearSixIcon },
] as const;
const storeOrderPath = (appId: string, orderId: string) =>
	`/stores/${encodeURIComponent(appId)}/orders/${encodeURIComponent(orderId)}`;
const money = (cents: number) => formatCents(cents, getLocale());
const date = (value: string, compact = false) =>
	new Date(value).toLocaleDateString(INTL_LOCALE[getLocale()], {
		timeZone: 'UTC',
		month: 'short',
		day: 'numeric',
		...(compact ? {} : { year: 'numeric' as const }),
	});

export default function StoreWorkspace() {
	useI18n();
	const { id } = useParams<{ id: string }>();
	const { user, isLoading } = useAuth();
	if (isLoading) return <Loading />;
	if (!user || !id)
		return (
			<Message title={t('Sign in to manage your store')}>
				<Link to="/apps">{t('All stores')}</Link>
			</Message>
		);
	return <OwnedStore key={`${user.id}:${id}`} appId={id} userId={user.id} />;
}

function OwnedStore({ appId, userId }: { appId: string; userId: string }) {
	useI18n();
	const { app, loading, error, refetch } = useApp(appId);
	if (loading) return <Loading />;
	if (error || !app)
		return (
			<Message title={t('Could not load this store')}>
				<p>{error}</p>
				<Button onClick={refetch}>{t('Try again')}</Button>
				<Link to="/apps">{t('All stores')}</Link>
			</Message>
		);
	if (app.userId !== userId)
		return (
			<Message
				title={t(
					'This store workspace is only available to its owner.',
				)}
			>
				<Link to="/apps">{t('All stores')}</Link>
			</Message>
		);
	return <StoreWorkspaceView app={app} userId={userId} />;
}

function StoreWorkspaceView({app,userId}:{app:AppDetailsData;userId:string}) {
 const [params]=useSearchParams();
 if(params.get('section')==='analytics' && params.get('view')==='live') return <LiveStoreAnalytics key={`${app.id}:${params.get('mode')}`} appId={app.id} userId={userId} mode={params.get('mode')==='test'?'test':'live'} />;
 return <Workspace app={app} userId={userId} />;
}

function Workspace({ app, userId }: { app: AppDetailsData; userId: string }) {
	useI18n();
	const [params, setParams] = useSearchParams();
	const section =
		sections.find((item) => item.id === params.get('section')) ??
		sections[0];
	const period = analyticsPeriod(params);
	const productId =
		section.id === 'analytics' ? (params.get('product') ?? '') : '';
	const compare = params.get('compare') !== 'off';
	const hiddenWidgets = ANALYTICS_WIDGETS.filter((widget) =>
		params.get('hide')?.split(',').includes(widget),
	);
	const days =
		section.id === 'analytics'
			? period.days
			: [7, 30, 90].includes(Number(params.get('days')))
				? Number(params.get('days'))
				: 30;
	const setDays = (value: number) => {
		const next = new URLSearchParams(params);
		next.set('days', String(value));
		setParams(next);
	};
	const reporting = ['home', 'analytics', 'customers'].includes(section.id);
	const mode = params.get('mode') === 'test' ? 'test' : 'live';
	const throughDay =
		section.id === 'analytics'
			? period.to
			: new Date().toISOString().slice(0, 10);
	const window = reportingWindow(days, throughDay);
	const fetchWindow =
		section.id === 'analytics'
			? reportingWindow(days * 2, throughDay)
			: window;
	const previousWindow = {
		start: window.start - days * 86400000,
		end: window.start,
		days,
	};
	const orders = useQuery({
		queryKey: queryKeys.account.sellerOrders.workspace(
			userId,
			app.id,
			fetchWindow.days,
			throughDay,
			mode,
		),
		queryFn: ({ signal }) =>
			fetchReportOrders(
				app.id,
				fetchWindow,
				(filters) =>
					unwrap(
						apiClient.getSellerOrders(filters),
						t("Couldn't load your orders"),
					),
				signal,
				mode,
			),
		enabled: reporting,
		retry: false,
	});
	const collection = useQuery({
		queryKey: queryKeys.account.storeProducts(app.id, userId),
		queryFn: () =>
			unwrap(
				apiClient.getStoreProducts(app.id),
				t("Couldn't load your products"),
			),
		enabled: section.id === 'analytics',
		retry: false,
	});
	const filteredOrders = ordersForProduct(orders.data ?? [], productId);
	const report = orders.data
		? aggregateOrders(filteredOrders, app.id, window, mode)
		: null;
	const previous = aggregateOrders(
		filteredOrders,
		app.id,
		previousWindow,
		mode,
	);
	const sectionLink = (id: string) => {
		const next = new URLSearchParams(params);
		next.set('section', id);
		if (id === 'payments' && mode === 'test') next.set('mode', 'all');
		return `?${next.toString()}`;
	};
	return (
		<div className="estori-store">
			<title>{pageTitle(app.title || t('Store workspace'))}</title>
			<div className="es-chrome">
				<header className="es-header">
					<div className="es-identity">
						<Link
							to="/apps"
							aria-label={t('Back to all stores')}
							className="es-back"
						>
							<ArrowLeftIcon size={18} />
						</Link>
						<span className="es-avatar">
							<StorefrontIcon size={22} />
						</span>
						<div>
							<strong>{app.title || t('Untitled store')}</strong>
							<small>{t('Store workspace')}</small>
						</div>
					</div>
					<div className="es-actions">
						<Link className="es-button" to={`/app/${app.id}`}>
							<StorefrontIcon size={16} />
							{t('Preview store')}
							<ArrowUpRightIcon size={14} />
						</Link>
					</div>
				</header>
				<nav className="es-nav" aria-label={t('Store navigation')}>
					{sections.map(({ id, label, icon: Icon }) => (
						<Link
							key={id}
							to={sectionLink(id)}
							aria-current={
								section.id === id ? 'page' : undefined
							}
						>
							<Icon size={18} />
							{t(label)}
						</Link>
					))}
				</nav>
			</div>
			<div className="es-main">
				{section.id === 'analytics' ? (
					<>
						<h1 className="sr-only">{t('Analytics')}</h1>
						<AnalyticsToolbar
							period={period}
							appId={app.id}
							appTitle={app.title || t('Untitled store')}
							userId={userId}
							mode={mode}
							products={productOptions(
								orders.data ?? [],
								collection.data?.products,
							)}
							productsError={collection.isError}
							onRetryProducts={() => void collection.refetch()}
							productId={productId}
							compare={compare}
							hiddenWidgets={hiddenWidgets}
							report={report}
						/>
					</>
				) : (
					<div className="es-page-heading">
						<div>
							<h1>
								{section.id === 'home'
									? t('Make yourself at home.')
									: t(section.label)}
							</h1>
							<p>
								{t(
									{
										home: msg(
											'Your store, your next idea, and the orders behind it.',
										),
										analytics: msg(
											'A closer look at your paid orders.',
										),
										products: msg(
											'Your published collection, in one place.',
										),
										customers: msg(
											'The people behind your orders.',
										),
										payments: msg(
											'Order payments, with a clear view of their status.',
										),
										emails: msg(
											'Make every message feel like your store.',
										),
										translations: msg(
											'Welcome shoppers in their language.',
										),
										settings: msg(
											'Your store, ready for the world.',
										),
									}[section.id],
								)}
							</p>
						</div>
						{reporting && (
							<div className="es-report-controls">
								<div className="es-range">
									<span>{t('Data mode')}</span>
									<Select
										aria-label={t('Data mode')}
										value={mode}
										items={{
											live: t('Live sales'),
											test: t('Test data'),
										}}
										onValueChange={(value) => {
											const next = new URLSearchParams(
												params,
											);
											if (value === 'test')
												next.set('mode', 'test');
											else next.delete('mode');
											setParams(next);
										}}
									/>
								</div>
								<div className="es-range">
									<span>{t('Reporting period')}</span>
									<Select
										aria-label={t('Reporting period')}
										value={String(days)}
										items={{
											'7': t('Last 7 days'),
											'30': t('Last 30 days'),
											'90': t('Last 90 days'),
										}}
										onValueChange={(value) => {
											if (value) setDays(Number(value));
										}}
									/>
								</div>
							</div>
						)}
					</div>
				)}
				{reporting && section.id !== 'analytics' && mode === 'test' && (
					<div className="ea-test-notice" role="status">
						<strong>{t('Test data')}</strong>
						<span>
							{t(
								'Test transactions are separate from live sales. The sample stores contain illustrative transactions; no money has moved.',
							)}
						</span>
					</div>
				)}
				{section.id === 'home' && (
					<StoreHomeIntroduction appId={app.id} userId={userId} />
				)}
				{section.id === 'products' ? (
					<StoreProductsPanel appId={app.id} />
				) : section.id === 'emails' ? (
					<StoreEmailsPanel appId={app.id} />
				) : section.id === 'translations' ? (
					<StoreTranslationsPanel appId={app.id} />
				) : section.id === 'settings' ? (
					<StoreSettingsPanel app={app} />
				) : section.id === 'payments' ? (
					<>
						<StoreOrdersPanel appId={app.id} />
						<div className="es-note">
							<CreditCardIcon size={22} />
							<div>
								<strong>{t('Manage your payouts')}</strong>
								<p>
									{t(
										'Payout setup and your connected payment account are available in your profile. Order totals here do not represent your available balance.',
									)}
								</p>
								<Link
									className="es-text-link"
									to="/profile?tab=paid"
								>
									{t('Open payout settings')}
									<ArrowUpRightIcon size={14} />
								</Link>
							</div>
						</div>
					</>
				) : (
					<>
						{section.id !== 'analytics' && (
							<p className="es-period">
								{t('{start} – {end}, including today · UTC', {
									start: date(
										new Date(window.start).toISOString(),
									),
									end: date(throughDay),
								})}
							</p>
						)}
						{orders.isPending ? (
							<Loading />
						) : orders.isError ? (
							<Message title={t("Couldn't load your orders")}>
								<p>{orders.error.message}</p>
								<Button onClick={() => void orders.refetch()}>
									{t('Try again')}
								</Button>
							</Message>
						) : (
							report && (
								<>
									{section.id !== 'analytics' && (
										<Stats report={report} />
									)}
									{section.id === 'analytics' && (
										<AnalyticsPanel
											key={`${app.id}:${mode}:${days}:${throughDay}:${productId}`}
											compare={compare}
											hiddenWidgets={hiddenWidgets}
											throughDay={throughDay}
											productId={productId}
											report={report}
											previous={previous}
											appId={app.id}
											userId={userId}
											mode={mode}
										/>
									)}
									{section.id === 'home' && (
										<div
											className={
												section.id === 'home'
													? 'es-home-report'
													: undefined
											}
										>
											<section className="es-panel">
												<div className="es-panel-heading">
													<div>
														<h2>
															{t(
																'Paid order totals',
															)}
														</h2>
														<p>
															{t(
																'USD · Orders currently marked paid, grouped by order date in UTC.',
															)}
														</p>
													</div>
													<span className="es-chart-legend">
														<i />
														{t('Paid orders')}
													</span>
												</div>
												<p className="es-report-note">
													{t(
														'Paid totals exclude orders with refunds or disputes and do not represent profit or payout balances.',
													)}
												</p>
												<SalesChart
													trend={report.trend}
												/>
												<div className="es-chart-foot">
													<span>
														{report.paidOrders === 0
															? t(
																	'No paid orders in this period yet.',
																)
															: t(
																	'Each point shows one UTC calendar day.',
																)}
													</span>
													{section.id === 'home' && (
														<Link
															to={sectionLink(
																'analytics',
															)}
															className="es-text-link"
														>
															{t('See analytics')}
															<ArrowUpRightIcon
																size={14}
															/>
														</Link>
													)}
												</div>
											</section>
											{section.id === 'home' && (
												<StoreHomeCollection
													appId={app.id}
													userId={userId}
												/>
											)}
										</div>
									)}
									{section.id === 'home' && (
										<OrderTable
											key={section.id}
											rows={report.orders}
											appId={app.id}
										/>
									)}
									{section.id === 'customers' && (
										<Customers
											rows={report.customers}
											orders={report.orders}
											appId={app.id}
										/>
									)}
								</>
							)
						)}
					</>
				)}
				{section.id === 'home' && (
					<div className="es-footer-links">
						<Link to="?section=payments&view=all">
							{t('All store orders')}
						</Link>
						<button
							onClick={() => setParams({ section: 'products' })}
						>
							{t('Manage products')}
						</button>
						<Link to={`/chat/${app.id}`}>
							{t('Open store builder')}
						</Link>
					</div>
				)}
			</div>
		</div>
	);
}

function Stats({ report }: { report: ReturnType<typeof aggregateOrders> }) {
	return (
		<div className="es-stats">
			{[
				{
					label: t('Paid order totals'),
					value: money(report.paidCents),
					detail: t('USD · Before fees'),
				},
				{
					label: t('Paid orders'),
					value: report.paidOrders.toLocaleString(
						INTL_LOCALE[getLocale()],
					),
					detail: t('Currently marked paid'),
				},
				{
					label: t('Ordering customers'),
					value: report.customers.length.toLocaleString(
						INTL_LOCALE[getLocale()],
					),
					detail: t('Unique shopper emails'),
				},
				{
					label: t('Average paid order'),
					value: report.paidOrders
						? money(
								Math.round(
									report.paidCents / report.paidOrders,
								),
							)
						: '—',
					detail: t('Paid order totals ÷ paid orders'),
				},
			].map((stat) => (
				<section key={stat.label}>
					<span>{stat.label}</span>
					<strong>{stat.value}</strong>
					<small>{stat.detail}</small>
				</section>
			))}
		</div>
	);
}

function SalesChart({
	trend,
}: {
	trend: ReturnType<typeof aggregateOrders>['trend'];
}) {
	return (
		<MetricChart
			label={t('Daily paid order totals in USD')}
			points={trend.map((day) => ({
				date: day.date,
				value: day.paidCents,
			}))}
			formatValue={money}
		/>
	);
}

function OrderTable({
	rows,
	appId,
}: {
	rows: SellerOrderRow[];
	appId: string;
}) {
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState('all');
	const [limit, setLimit] = useState(20);
	const filtered = rows.filter(
		(row) =>
			`${row.orderNumber} ${row.customerName ?? ''} ${row.customerEmail ?? ''}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()) &&
			(status === 'all' ||
				(status === 'to-ship'
					? row.ownUnits > 0 &&
						row.fulfillmentStatus === 'unfulfilled' &&
						(row.paymentStatus === 'paid' ||
							row.paymentStatus === 'partially_refunded')
					: row.paymentStatus === status)),
	);
	return (
		<section className="es-panel">
			<div className="es-panel-heading">
				<div>
					<h2>{t('Orders')}</h2>
					<p>
						{t('Live orders in the selected period, newest first.')}
					</p>
				</div>
				<span className="es-count">{filtered.length}</span>
			</div>
			<div className="es-toolbar">
				<Input
					size="sm"
					aria-label={t('Search orders')}
					placeholder={t('Search name, email, or order number')}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setLimit(20);
					}}
				/>
				<Select
					aria-label={t('Filter orders')}
					value={status}
					items={{
						all: t('All orders'),
						'to-ship': t('To ship'),
						...Object.fromEntries(
							Object.entries(PAYMENT_LABELS).map(
								([value, label]) => [value, t(label)],
							),
						),
					}}
					onValueChange={(value) => {
						if (value) {
							setStatus(value);
							setLimit(20);
						}
					}}
				/>
			</div>
			<div className="es-table-scroll">
				<Table>
					<caption className="sr-only">
						{t('Live orders in the selected period, newest first.')}
					</caption>
					<Table.Header>
						<Table.Row>
							{[
								t('Order'),
								t('Customer'),
								t('Status'),
								t('Shipping'),
								t('Date (UTC)'),
								t('Amount (USD)'),
							].map((label) => (
								<Table.Head key={label}>{label}</Table.Head>
							))}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{filtered.slice(0, limit).map((row) => (
							<Table.Row key={row.id}>
								<Table.Cell>
									<Link
										className="es-order-link"
										to={storeOrderPath(appId, row.id)}
									>
										#{row.orderNumber}
										<ArrowUpRightIcon size={12} />
									</Link>
								</Table.Cell>
								<Table.Cell>
									<span>
										{customerLabel(
											row.customerName,
											row.customerEmail,
										)}
									</span>
									{row.customerName && row.customerEmail && (
										<small>{row.customerEmail}</small>
									)}
								</Table.Cell>
								<Table.Cell>
									<Badge
										variant={
											row.paymentStatus === 'paid'
												? 'success'
												: row.paymentStatus ===
															'disputed' ||
													  row.paymentStatus ===
															'dispute_lost'
													? 'error'
													: 'secondary'
										}
									>
										{t(PAYMENT_LABELS[row.paymentStatus])}
									</Badge>
								</Table.Cell>
								<Table.Cell>{shippingStatus(row)}</Table.Cell>
								<Table.Cell>{date(row.createdAt)}</Table.Cell>
								<Table.Cell className="es-amount">
									{money(row.totalCents)}
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</div>
			{!filtered.length && (
				<p className="es-empty">
					{rows.length
						? t('No orders match your search or filter.')
						: t('No live orders in this period yet.')}
				</p>
			)}
			{filtered.length > limit && (
				<div className="es-table-footer">
					<Button size="sm" onClick={() => setLimit(limit + 20)}>
						{t('Load more')}
					</Button>
				</div>
			)}
		</section>
	);
}

function Customers({
	rows,
	orders,
	appId,
}: {
	rows: CustomerSummary[];
	orders: SellerOrderRow[];
	appId: string;
}) {
	const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
	const selected = rows.find((row) => row.email === selectedEmail);
	const [search, setSearch] = useState('');
	const [limit, setLimit] = useState(20);
	const filtered = rows.filter((row) =>
		`${row.name ?? ''} ${row.email}`
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);
	return (
		<section className="es-panel">
			<div className="es-panel-heading">
				<div>
					<h2>{t('Ordering customers')}</h2>
					<p>
						{t(
							'Grouped by email from live orders in this period. Orders without an email are excluded.',
						)}
					</p>
				</div>
			</div>
			<div className="es-toolbar">
				<Input
					size="sm"
					aria-label={t('Search customers')}
					placeholder={t('Search name or email')}
					value={search}
					onChange={(event) => {
						setSearch(event.target.value);
						setLimit(20);
					}}
				/>
			</div>
			<div className="es-table-scroll">
				<Table>
					<caption className="sr-only">
						{t('Customers in the selected reporting period')}
					</caption>
					<Table.Header>
						<Table.Row>
							{[
								t('Customer'),
								t('Email'),
								t('Orders'),
								t('Paid order totals'),
								t('Latest order'),
							].map((label) => (
								<Table.Head key={label}>{label}</Table.Head>
							))}
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{filtered.slice(0, limit).map((row) => (
							<Table.Row key={row.email}>
								<Table.Cell>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											setSelectedEmail(row.email)
										}
									>
										{customerLabel(row.name, row.email)}
									</Button>
								</Table.Cell>
								<Table.Cell>{row.email}</Table.Cell>
								<Table.Cell>{row.orders}</Table.Cell>
								<Table.Cell>{money(row.paidCents)}</Table.Cell>
								<Table.Cell>
									<Link
										className="es-order-link"
										to={storeOrderPath(
											appId,
											row.lastOrderId,
										)}
									>
										{date(row.lastOrder)}
										<ArrowUpRightIcon size={12} />
									</Link>
								</Table.Cell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
			</div>
			{!filtered.length && (
				<p className="es-empty">
					{rows.length
						? t('No customers match your search.')
						: t(
								'Customers will appear here after an order includes their email.',
							)}
				</p>
			)}
			{filtered.length > limit && (
				<div className="es-table-footer">
					<Button size="sm" onClick={() => setLimit(limit + 20)}>
						{t('Load more')}
					</Button>
				</div>
			)}
			<Dialog.Root
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) setSelectedEmail(null);
				}}
			>
				{selected && (
					<Dialog
						size="xl"
						className="max-h-[85svh] overflow-auto p-6"
					>
						<div className="flex items-start justify-between gap-4 mb-6">
							<div>
								<Dialog.Title className="text-xl font-semibold">
									{customerLabel(
										selected.name,
										selected.email,
									)}
								</Dialog.Title>
								<Dialog.Description className="mt-2 text-sm text-kumo-subtle">
									{t(
										'Customer activity in the selected reporting period.',
									)}
								</Dialog.Description>
							</div>
							<Dialog.Close
								render={(props) => (
									<Button
										{...props}
										variant="ghost"
										shape="square"
										aria-label={t('Close')}
									>
										<XIcon size={18} />
									</Button>
								)}
							/>
						</div>
						<a
							href={`mailto:${selected.email}`}
							className="mb-4 block break-all text-sm underline underline-offset-2"
						>
							{selected.email}
						</a>
						<Link
							className="es-text-link mb-4"
							to={`?section=payments&view=all&search=${encodeURIComponent(selected.email)}`}
						>
							{t('Browse all orders for this customer')}
							<ArrowUpRightIcon size={14} />
						</Link>
						<dl className="grid grid-cols-2 gap-4 mb-6">
							<div>
								<dt className="text-sm text-kumo-subtle">
									{t('Orders')}
								</dt>
								<dd className="text-xl font-semibold">
									{selected.orders}
								</dd>
							</div>
							<div>
								<dt className="text-sm text-kumo-subtle">
									{t('Paid order totals')}
								</dt>
								<dd className="text-xl font-semibold">
									{money(selected.paidCents)}
								</dd>
							</div>
						</dl>
						<div className="divide-y divide-kumo-line">
							{orders
								.filter(
									(order) =>
										order.customerEmail
											?.trim()
											.toLowerCase() === selected.email,
								)
								.map((order) => (
									<Link
										key={order.id}
										className="flex justify-between gap-4 py-3 text-sm hover:text-kumo-link"
										to={storeOrderPath(appId, order.id)}
									>
										<span>
											#{order.orderNumber} ·{' '}
											{date(order.createdAt)}
										</span>
										<span>
											{money(order.totalCents)} ·{' '}
											{t(
												PAYMENT_LABELS[
													order.paymentStatus
												],
											)}
										</span>
									</Link>
								))}
						</div>
					</Dialog>
				)}
			</Dialog.Root>
		</section>
	);
}

function Loading() {
	return (
		<div className="es-loading" role="status">
			<Loader />
			<span>{t('Loading store data…')}</span>
		</div>
	);
}
function Message({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="es-message" role="status">
			<h2>{title}</h2>
			{children}
		</div>
	);
}
