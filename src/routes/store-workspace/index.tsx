import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Input, Loader, Table } from '@cloudflare/kumo';
import {
	ArrowLeftIcon,
	ArrowUpRightIcon,
	ChartLineUpIcon,
	CreditCardIcon,
	HouseIcon,
	PackageIcon,
	SparkleIcon,
	StorefrontIcon,
	UsersIcon,
} from '@phosphor-icons/react';
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from 'recharts';
import type { AppDetailsData, SellerOrderRow } from '@/api-types';
import { sellerOrderPath } from '@/api-types';
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

const sections = [
	{ id: 'home', label: msg('Home'), icon: HouseIcon },
	{ id: 'analytics', label: msg('Analytics'), icon: ChartLineUpIcon },
	{ id: 'products', label: msg('Products'), icon: PackageIcon },
	{ id: 'customers', label: msg('Customers'), icon: UsersIcon },
	{ id: 'payments', label: msg('Payments'), icon: CreditCardIcon },
] as const;
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
	return <Workspace app={app} userId={userId} />;
}

function Workspace({ app, userId }: { app: AppDetailsData; userId: string }) {
	useI18n();
	const [params, setParams] = useSearchParams();
	const section =
		sections.find((item) => item.id === params.get('section')) ??
		sections[0];
	const [days, setDays] = useState(30);
	const throughDay = new Date().toISOString().slice(0, 10);
	const window = reportingWindow(days, throughDay);
	const orders = useQuery({
		queryKey: queryKeys.account.sellerOrders.workspace(
			userId,
			app.id,
			days,
			throughDay,
		),
		queryFn: ({ signal }) =>
			fetchReportOrders(
				app.id,
				window,
				(filters) =>
					unwrap(
						apiClient.getSellerOrders(filters),
						t("Couldn't load your orders"),
					),
				signal,
			),
		enabled: section.id !== 'products',
		retry: false,
	});
	const report = orders.data
		? aggregateOrders(orders.data, app.id, window)
		: null;
	const sectionLink = (id: string) => {
		const next = new URLSearchParams(params);
		next.set('section', id);
		return `?${next.toString()}`;
	};
	return (
		<div className="estori-store">
			<title>{pageTitle(app.title || t('Store workspace'))}</title>
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
						aria-current={section.id === id ? 'page' : undefined}
					>
						<Icon size={18} />
						{t(label)}
					</Link>
				))}
			</nav>
			<main className="es-main">
				<div className="es-page-heading">
					<div>
						<p className="es-eyebrow">
							{app.title || t('Your store')}
						</p>
						<h1>
							{section.id === 'home'
								? t('Make yourself at home.')
								: t(section.label)}
						</h1>
						<p>
							{section.id === 'home'
								? t(
										'Your store, your next idea, and the orders behind it.',
									)
								: section.id === 'analytics'
									? t('A closer look at your paid orders.')
									: section.id === 'products'
										? t(
												'Shape your collection in the store builder.',
											)
										: section.id === 'customers'
											? t(
													'The people behind your orders.',
												)
											: t(
													'Order payments, with a clear view of their status.',
												)}
						</p>
					</div>
					{section.id !== 'products' && (
						<label className="es-range">
							<span>{t('Reporting period')}</span>
							<select
								value={days}
								onChange={(event) =>
									setDays(Number(event.target.value))
								}
							>
								<option value={7}>{t('Last 7 days')}</option>
								<option value={30}>{t('Last 30 days')}</option>
								<option value={90}>{t('Last 90 days')}</option>
							</select>
						</label>
					)}
				</div>
				{section.id === 'home' && (
					<div className="es-feature-grid">
						<section className="es-editorial">
							<span className="es-eyebrow">
								{t('Your next chapter')}
							</span>
							<h2>{t('Your ideas. A world of possibility.')}</h2>
							<p>
								{t(
									'Keep shaping a store that feels like you. Update your collection, refine your story, or try a new idea with Estori.',
								)}
							</p>
							<Link
								className="es-button es-button-primary"
								to={`/chat/${app.id}`}
							>
								<SparkleIcon size={16} />
								{t('Open store builder')}
								<ArrowUpRightIcon size={14} />
							</Link>
							<div
								className="es-editorial-art"
								aria-hidden="true"
							>
								<StorefrontIcon weight="duotone" />
							</div>
						</section>
						<section className="es-next">
							<span className="es-icon-tile">
								<PackageIcon size={24} />
							</span>
							<h2>{t('Make room for something new.')}</h2>
							<p>
								{t(
									'Explore products from the Estori catalog for your next collection.',
								)}
							</p>
							<Link className="es-text-link" to="/catalog">
								{t('Explore the catalog')}
								<ArrowUpRightIcon size={15} />
							</Link>
						</section>
					</div>
				)}
				{section.id === 'products' ? (
					<Products appId={app.id} />
				) : (
					<>
						<p className="es-period">
							{t(
								'{start} – {end}, including today · UTC · Live orders only',
								{
									start: date(
										new Date(window.start).toISOString(),
									),
									end: date(throughDay),
								},
							)}
						</p>
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
									<Stats report={report} />
									{(section.id === 'home' ||
										section.id === 'analytics') && (
										<section className="es-panel">
											<div className="es-panel-heading">
												<div>
													<h2>
														{t('Paid order totals')}
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
													'Excludes test orders, refunded orders, and disputes. These totals are before fees and are not payout balances.',
												)}
											</p>
											<SalesChart trend={report.trend} />
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
									)}
									{section.id === 'analytics' && (
										<div className="es-note">
											<ChartLineUpIcon size={22} />
											<div>
												<strong>
													{t(
														'A clear picture, built from real orders',
													)}
												</strong>
												<p>
													{t(
														'Visitor counts and conversion rates are not available in this workspace. Paid totals exclude any order with a refund or dispute, including partial refunds.',
													)}
												</p>
											</div>
										</div>
									)}
									{(section.id === 'home' ||
										section.id === 'payments') && (
										<OrderTable
											key={section.id}
											rows={report.orders}
										/>
									)}
									{section.id === 'customers' && (
										<Customers rows={report.customers} />
									)}
									{section.id === 'payments' && (
										<div className="es-note">
											<CreditCardIcon size={22} />
											<div>
												<strong>
													{t('Manage your payouts')}
												</strong>
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
													<ArrowUpRightIcon
														size={14}
													/>
												</Link>
											</div>
										</div>
									)}
								</>
							)
						)}
					</>
				)}
				{section.id === 'home' && (
					<div className="es-footer-links">
						<Link to="/orders">
							{t('Orders across all stores')}
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
			</main>
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
		<div
			className="es-chart"
			role="img"
			aria-label={t('Daily paid order totals in USD')}
		>
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart
					data={trend}
					margin={{ top: 12, right: 16, bottom: 2, left: 6 }}
					accessibilityLayer
				>
					<defs>
						<linearGradient
							id="es-sales-fill"
							x1="0"
							y1="0"
							x2="0"
							y2="1"
						>
							<stop
								offset="0%"
								stopColor="#2563eb"
								stopOpacity={0.2}
							/>
							<stop
								offset="100%"
								stopColor="#2563eb"
								stopOpacity={0.01}
							/>
						</linearGradient>
					</defs>
					<CartesianGrid
						vertical={false}
						stroke="var(--es-line)"
						strokeDasharray="3 4"
					/>
					<XAxis
						dataKey="date"
						tickFormatter={(value) => date(String(value), true)}
						tickLine={false}
						axisLine={false}
						minTickGap={45}
						tick={{ fill: 'var(--es-muted)', fontSize: 11 }}
					/>
					<YAxis
						tickFormatter={(value) => money(Number(value))}
						tickLine={false}
						axisLine={false}
						width={78}
						tick={{ fill: 'var(--es-muted)', fontSize: 11 }}
					/>
					<Tooltip
						labelFormatter={(value) => date(String(value))}
						formatter={(value) => [
							money(Number(value)),
							t('Paid order totals'),
						]}
						contentStyle={{
							background: 'var(--es-surface)',
							border: '1px solid var(--es-line)',
							borderRadius: 10,
							color: 'var(--es-ink)',
							fontSize: 12,
						}}
					/>
					<Area
						type="linear"
						dataKey="paidCents"
						stroke="#2563eb"
						strokeWidth={2}
						fill="url(#es-sales-fill)"
						isAnimationActive={false}
					/>
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
}

function OrderTable({ rows }: { rows: SellerOrderRow[] }) {
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
				<select
					aria-label={t('Filter orders')}
					value={status}
					onChange={(event) => {
						setStatus(event.target.value);
						setLimit(20);
					}}
				>
					<option value="all">{t('All orders')}</option>
					<option value="to-ship">{t('To ship')}</option>
					{Object.entries(PAYMENT_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{t(label)}
						</option>
					))}
				</select>
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
										to={sellerOrderPath(row.id)}
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

function Customers({ rows }: { rows: CustomerSummary[] }) {
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
									{customerLabel(row.name, row.email)}
								</Table.Cell>
								<Table.Cell>{row.email}</Table.Cell>
								<Table.Cell>{row.orders}</Table.Cell>
								<Table.Cell>{money(row.paidCents)}</Table.Cell>
								<Table.Cell>
									<Link
										className="es-order-link"
										to={sellerOrderPath(row.lastOrderId)}
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
		</section>
	);
}

function Products({ appId }: { appId: string }) {
	return (
		<div className="es-product-grid">
			<section className="es-product-card">
				<span className="es-icon-tile">
					<PackageIcon size={28} />
				</span>
				<h2>{t('Your collection lives in your store')}</h2>
				<p>
					{t(
						'A product inventory is not available in this workspace yet. Open the builder to view and change the products in this store.',
					)}
				</p>
				<Link
					className="es-button es-button-primary"
					to={`/chat/${appId}`}
				>
					{t('Open store builder')}
					<ArrowUpRightIcon size={15} />
				</Link>
			</section>
			<section className="es-product-card">
				<span className="es-icon-tile">
					<SparkleIcon size={28} />
				</span>
				<h2>{t('Discover your next product')}</h2>
				<p>
					{t(
						'Browse the Estori catalog, then work with the builder to add products to this store.',
					)}
				</p>
				<Link className="es-button" to="/catalog">
					{t('Explore the catalog')}
					<ArrowUpRightIcon size={15} />
				</Link>
			</section>
		</div>
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
