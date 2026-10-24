import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Input } from '@cloudflare/kumo';
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpRightIcon,
	ChartLineUpIcon,
	CheckCircleIcon,
	CreditCardIcon,
	HouseIcon,
	MagnifyingGlassIcon,
	PackageIcon,
	PlusIcon,
	SparkleIcon,
	StorefrontIcon,
	UsersIcon,
	XIcon,
} from '@phosphor-icons/react';
import type { Store } from './route';
import './store-workspace.css';

const sections = [
	{ id: 'home', label: 'Home', icon: HouseIcon },
	{ id: 'analytics', label: 'Analytics', icon: ChartLineUpIcon },
	{ id: 'products', label: 'Products', icon: PackageIcon },
	{ id: 'customers', label: 'Customers', icon: UsersIcon },
	{ id: 'payments', label: 'Payments', icon: CreditCardIcon },
] as const;
type Section = (typeof sections)[number]['id'];
type Product = {
	id: number;
	name: string;
	image: string;
	price: number;
	stock: number;
	status: 'Active' | 'Draft';
};
type Customer = {
	name: string;
	email: string;
	orders: number;
	spent: number;
	city: string;
	joined: string;
};
type Payment = {
	id: string;
	customer: string;
	total: number;
	status: 'Paid' | 'Pending' | 'Refunded';
	date: string;
};
type Detail =
	| { kind: 'product'; product: Product }
	| { kind: 'customer'; customer: Customer }
	| { kind: 'payment'; payment: Payment }
	| { kind: 'new' | 'storefront' | 'agent' }
	| null;
const money = (value: number) =>
	new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
	}).format(value);
const productSets: Record<number, [string, string, number][]> = {
	1: [
		['House Blend', 'house-blend', 18],
		['Ethiopia Guji', 'ethiopia-guji', 24],
		['Ceramic Dripper', 'ceramic-dripper', 32],
	],
	2: [
		['Everyday Wool Socks', 'wool-socks', 24],
		['Weekend Daypack', 'trail-daypack', 68],
		['Daily Bottle', 'insulated-bottle', 32],
	],
	3: [
		['Trail Daypack', 'trail-daypack', 68],
		['Brass Compass', 'brass-compass', 42],
		['Insulated Bottle', 'insulated-bottle', 32],
	],
	4: [
		['Slow Morning Dripper', 'ceramic-dripper', 32],
		['Sunday Coffee', 'house-blend', 18],
		['Everyday Bottle', 'insulated-bottle', 32],
	],
};
const customers: Customer[] = [
	{
		name: 'Jamie Ellis',
		email: 'jamie@example.com',
		orders: 4,
		spent: 146,
		city: 'Austin, United States',
		joined: 'Oct 03, 2026',
	},
	{
		name: 'Sofia Rivera',
		email: 'sofia@example.com',
		orders: 2,
		spent: 72,
		city: 'Bogotá, Colombia',
		joined: 'Oct 11, 2026',
	},
	{
		name: 'Noah Chen',
		email: 'noah@example.com',
		orders: 3,
		spent: 108,
		city: 'Toronto, Canada',
		joined: 'Oct 14, 2026',
	},
	{
		name: 'Isabella Costa',
		email: 'isabella@example.com',
		orders: 1,
		spent: 54,
		city: 'São Paulo, Brazil',
		joined: 'Oct 20, 2026',
	},
	{
		name: 'Oliver Reed',
		email: 'oliver@example.com',
		orders: 1,
		spent: 32,
		city: 'Seattle, United States',
		joined: 'Oct 22, 2026',
	},
];
const payments: Payment[] = [
	{
		id: '#1048',
		customer: 'Jamie Ellis',
		total: 54,
		status: 'Paid',
		date: 'Oct 23, 9:42 AM',
	},
	{
		id: '#1047',
		customer: 'Sofia Rivera',
		total: 36,
		status: 'Paid',
		date: 'Oct 23, 9:18 AM',
	},
	{
		id: '#1046',
		customer: 'Noah Chen',
		total: 72,
		status: 'Pending',
		date: 'Oct 23, 8:56 AM',
	},
	{
		id: '#1045',
		customer: 'Isabella Costa',
		total: 54,
		status: 'Paid',
		date: 'Oct 22, 4:28 PM',
	},
	{
		id: '#1044',
		customer: 'Oliver Reed',
		total: 32,
		status: 'Refunded',
		date: 'Oct 22, 2:13 PM',
	},
];

function TrendChart({
	days,
	empty = false,
}: {
	days: string;
	empty?: boolean;
}) {
	const values =
		days === '7'
			? [82, 69, 80, 44, 53, 35, 19]
			: [92, 82, 88, 72, 78, 63, 66, 34, 48, 26, 35, 12];
	const points = values
		.map((y, i) => `${(i * 600) / (values.length - 1)},${empty ? 112 : y}`)
		.join(' ');
	return (
		<div className="store-trend">
			<svg
				viewBox="0 0 600 130"
				role="img"
				aria-label={
					empty
						? 'No sales yet in this sample store'
						: `Illustrative sales trend for the last ${days} days`
				}
				preserveAspectRatio="none"
			>
				{[20, 65, 112].map((y) => (
					<line
						key={y}
						x1="0"
						x2="600"
						y1={y}
						y2={y}
						stroke="#e9edf2"
						strokeDasharray="3 5"
					/>
				))}
				<polygon points={`0,130 ${points} 600,130`} fill="#edf3ff" />
				<polyline
					points={points}
					fill="none"
					stroke="#2463eb"
					strokeWidth="2.5"
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<div>
				<span>{days === '7' ? 'Oct 17' : 'Sep 24'}</span>
				<span>{days === '7' ? 'Oct 20' : 'Oct 08'}</span>
				<span>Oct 23</span>
			</div>
		</div>
	);
}
function Status({ children }: { children: string }) {
	return (
		<span className={`store-status store-status-${children.toLowerCase()}`}>
			<i />
			{children}
		</span>
	);
}

/** Exploratory, sample-only store workspace. No network calls or account mutations. */
export function StoreWorkspacePreview({
	store,
	stores,
}: {
	store: Store;
	stores: Store[];
}) {
	const [params, setParams] = useSearchParams();
	const section: Section =
		sections.find((item) => item.id === params.get('section'))?.id ??
		'home';
	const [days, setDays] = useState('30');
	const [search, setSearch] = useState('');
	const [statusFilter, setStatusFilter] = useState('All');
	const [detail, setDetail] = useState<Detail>(null);
	const [notice, setNotice] = useState('');
	const [agentReply, setAgentReply] = useState(false);
	const [products, setProducts] = useState<Product[]>(() =>
		(productSets[store.id] ?? productSets[4]).map(
			([name, image, price], i) => ({
				id: i + 1,
				name,
				image: `/marketing/products/${image}.webp`,
				price,
				stock: [124, 68, 32][i],
				status: store.status === 'Draft' ? 'Draft' : 'Active',
			}),
		),
	);
	const dialog = useRef<HTMLDialogElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const hasSales = store.status === 'Published';
	const factor = days === '7' ? 0.27 : 1;
	const multiplier = store.id === 2 ? 0.72 : 1;
	const sales = hasSales ? Math.round(4286 * factor * multiplier) : 0;
	const orders = hasSales ? Math.round(128 * factor * multiplier) : 0;
	const go = (next: Section) =>
		setParams({ store: String(store.id), section: next });
	useEffect(() => {
		setSearch('');
		setStatusFilter('All');
		setNotice('');
		heading.current?.focus();
	}, [section]);
	useEffect(() => {
		if (detail) dialog.current?.showModal();
		else dialog.current?.close();
	}, [detail]);
	const filteredProducts = products.filter(
		(p) =>
			p.name.toLowerCase().includes(search.toLowerCase()) &&
			(statusFilter === 'All' || p.status === statusFilter),
	);
	const filteredCustomers = (hasSales ? customers : []).filter((c) =>
		`${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()),
	);
	const filteredPayments = (hasSales ? payments : []).filter(
		(p) =>
			`${p.customer} ${p.id}`
				.toLowerCase()
				.includes(search.toLowerCase()) &&
			(statusFilter === 'All' || p.status === statusFilter),
	);
	const stats = (
		<div className="store-stats">
			{[
				['Total sales', money(sales), hasSales ? '+18.6%' : '—'],
				['Orders', orders.toLocaleString(), hasSales ? '+12.3%' : '—'],
				[
					'Customers',
					hasSales
						? Math.round(96 * factor * multiplier).toLocaleString()
						: '0',
					hasSales ? '+8.4%' : '—',
				],
				[
					'Conversion rate',
					hasSales ? '3.8%' : '0%',
					hasSales ? '+0.6 pts' : '—',
				],
			].map(([label, value, change]) => (
				<div key={label}>
					<span>{label}</span>
					<strong>{value}</strong>
					<small>
						{change} <span>vs. previous period</span>
					</small>
				</div>
			))}
		</div>
	);
	const range = (
		<select
			aria-label="Reporting period"
			value={days}
			onChange={(e) => setDays(e.target.value)}
		>
			<option value="30">Last 30 days</option>
			<option value="7">Last 7 days</option>
		</select>
	);
	const openAgent = () => {
		setAgentReply(false);
		setDetail({ kind: 'agent' });
	};
	const paymentTable = (rows: Payment[]) => (
		<div className="store-table-scroll">
			<table>
				<thead>
					<tr>
						<th>Payment</th>
						<th>Customer</th>
						<th>Status</th>
						<th>Date</th>
						<th className="store-align-right">Amount</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((p) => (
						<tr key={p.id}>
							<td>
								<button
									className="store-text-button"
									onClick={() =>
										setDetail({
											kind: 'payment',
											payment: p,
										})
									}
								>
									{p.id}
									<ArrowUpRightIcon />
								</button>
							</td>
							<td>{p.customer}</td>
							<td>
								<Status>{p.status}</Status>
							</td>
							<td>{p.date}</td>
							<td className="store-align-right">
								{money(p.total)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			{!rows.length && (
				<p className="store-empty">
					No payments to show
					{hasSales
						? '. Try a different search or filter.'
						: '. This sample store is still a draft.'}
				</p>
			)}
		</div>
	);
	return (
		<div className="layout-lab store-lab" data-mode="light">
			<a href="#store-content" className="lab-skip">
				Skip to store content
			</a>
			<div className="lab-preview-banner">
				<span>
					<span className="lab-preview-dot" /> Store workspace preview
				</span>
				<span>Sample data · No live changes</span>
				<button onClick={() => setParams({})}>
					<ArrowLeftIcon /> All stores
				</button>
			</div>
			<div className="store-shell">
				<aside
					className="store-rail"
					aria-label="Workspace and store switcher"
				>
					<button
						className="store-brand-mark"
						title="All stores"
						aria-label="Back to all stores"
						onClick={() => setParams({})}
					>
						<img src="/favicon.ico" alt="" />
					</button>
					<button
						title="Workspace home"
						aria-label="Workspace home"
						onClick={() => setParams({})}
					>
						<HouseIcon />
					</button>
					<span className="store-rail-divider" />
					{stores.map((s) => (
						<button
							key={s.id}
							title={s.name}
							aria-label={`Switch to ${s.name}`}
							aria-current={
								s.id === store.id ? 'page' : undefined
							}
							className={`store-rail-avatar ${s.id === store.id ? 'store-rail-current' : ''}`}
							style={{ background: s.color }}
							onClick={() =>
								setParams({
									store: String(s.id),
									section: 'home',
								})
							}
						>
							{s.initials}
						</button>
					))}
					<div className="store-rail-bottom">
						<button
							title="Ask Estori"
							aria-label="Ask Estori"
							onClick={openAgent}
						>
							<SparkleIcon />
						</button>
						<button
							className="store-account"
							title="Return to workspace"
							aria-label="Return to workspace"
							onClick={() => setParams({})}
						>
							AM
						</button>
					</div>
				</aside>
				<div className="store-frame">
					<header className="store-header">
						<div className="store-identity">
							<span style={{ background: store.color }}>
								{store.initials}
							</span>
							<div>
								<strong>{store.name}</strong>
								<small>
									{store.status === 'Published'
										? 'Store workspace'
										: 'Draft store'}
								</small>
							</div>
						</div>
						<nav aria-label="Store navigation">
							{sections.map(({ id, label, icon: Icon }) => (
								<button
									key={id}
									aria-current={
										section === id ? 'page' : undefined
									}
									onClick={() => go(id)}
								>
									<Icon />
									<span>{label}</span>
								</button>
							))}
						</nav>
						<Button
							variant="secondary"
							className="store-preview-button"
							aria-label="Preview store"
							onClick={() => setDetail({ kind: 'storefront' })}
						>
							<StorefrontIcon />
							<span>Preview store</span>
							<ArrowUpRightIcon />
						</Button>
					</header>
					<main id="store-content" className="store-content">
						<div className="store-page-heading">
							<div>
								<p className="store-eyebrow">
									{store.category} <span>/</span>{' '}
									{
										sections.find((s) => s.id === section)
											?.label
									}
								</p>
								<h1 ref={heading} tabIndex={-1}>
									{section === 'home'
										? 'Make yourself at home.'
										: sections.find((s) => s.id === section)
												?.label}
								</h1>
								<p>
									{
										{
											home: `A little perspective on ${store.name}, and what comes next.`,
											analytics:
												'Understand what brings people in—and keeps them coming back.',
											products:
												'Everything you sell, in one place.',
											customers:
												'Get to know the people behind every order.',
											payments:
												'A clear view of what comes in and what goes out.',
										}[section]
									}
								</p>
							</div>
							<div className="store-heading-actions">
								{(section === 'home' ||
									section === 'analytics') &&
									range}
								{section === 'products' && (
									<Button
										variant="primary"
										className="lab-primary"
										onClick={() =>
											setDetail({ kind: 'new' })
										}
									>
										<PlusIcon /> Add product
									</Button>
								)}
							</div>
						</div>
						{notice && (
							<p role="status" className="store-notice">
								<CheckCircleIcon />
								{notice}
							</p>
						)}
						{section === 'home' && (
							<>
								<div className="store-home-feature">
									<div className="store-editorial">
										<span className="store-feature-tag">
											<i />
											{store.status === 'Published'
												? 'Your next chapter'
												: 'Your idea starts here'}
										</span>
										<h2>
											{store.id === 1
												? 'Small batches.\nBig possibilities.'
												: 'Your ideas.\nA world of possibility.'}
										</h2>
										<p>
											{store.status === 'Published'
												? 'Your store is open. Keep creating the things your customers will love.'
												: 'Bring your collection together and make it feel like you.'}
										</p>
										<button onClick={() => go('products')}>
											Explore your products{' '}
											<ArrowRightIcon />
										</button>
										<img
											src={products[0].image}
											alt={products[0].name}
										/>
									</div>
									<div className="store-next">
										<div>
											<span className="store-icon-tile">
												<SparkleIcon />
											</span>
											<span className="store-eyebrow">
												A little help from Estori
											</span>
										</div>
										<h2>
											Good things
											<br />
											start with an idea.
										</h2>
										<p>
											Find a fresh angle for your next
											collection, or give a product story
											a new voice.
										</p>
										<Button
											variant="secondary"
											onClick={openAgent}
										>
											Let’s make something{' '}
											<ArrowUpRightIcon />
										</Button>
										<small>Try a sample conversation</small>
									</div>
								</div>
								<div className="store-section-heading">
									<h2>Your store at a glance</h2>
									<button onClick={() => go('analytics')}>
										See analytics <ArrowRightIcon />
									</button>
								</div>
								{stats}
								<div className="store-two-columns">
									<section className="store-panel">
										<div className="store-section-heading">
											<h2>Sales over time</h2>
											<span>USD · Sample</span>
										</div>
										<strong className="store-chart-total">
											{money(sales)}
										</strong>
										<TrendChart
											days={days}
											empty={!hasSales}
										/>
									</section>
									<section className="store-panel">
										<div className="store-section-heading">
											<h2>Your collection</h2>
											<button
												onClick={() => go('products')}
											>
												View all <ArrowRightIcon />
											</button>
										</div>
										{products.slice(0, 3).map((p) => (
											<button
												className="store-mini-product"
												key={p.id}
												onClick={() =>
													setDetail({
														kind: 'product',
														product: p,
													})
												}
											>
												<img src={p.image} alt="" />
												<span>
													<strong>{p.name}</strong>
													<small>
														{p.stock} in stock
													</small>
												</span>
												<span>{money(p.price)}</span>
											</button>
										))}
									</section>
								</div>
								<section className="store-panel">
									<div className="store-section-heading">
										<h2>Recent payments</h2>
										<button onClick={() => go('payments')}>
											View all <ArrowRightIcon />
										</button>
									</div>
									{paymentTable(
										hasSales ? payments.slice(0, 3) : [],
									)}
								</section>
							</>
						)}
						{section === 'analytics' && (
							<>
								{stats}
								<section className="store-panel store-analytics-chart">
									<div className="store-section-heading">
										<div>
											<h2>Total sales</h2>
											<p>
												Sales performance for the
												selected period
											</p>
										</div>
										<span>USD · Sample</span>
									</div>
									<strong className="store-chart-total">
										{money(sales)}
									</strong>
									<TrendChart days={days} empty={!hasSales} />
								</section>
								<div className="store-two-columns">
									<section className="store-panel">
										<h2>From first visit to checkout</h2>
										<p>See where customers move forward.</p>
										{[
											['Store visits', 100, '3,368'],
											['Added to cart', 12.4, '416'],
											['Reached checkout', 6.4, '214'],
											['Placed an order', 3.8, '128'],
										].map(([label, width, count]) => (
											<div
												className="store-funnel-row"
												key={label}
											>
												<div>
													<span>{label}</span>
													<strong>
														{hasSales
															? Math.round(
																	Number(
																		String(
																			count,
																		).replace(
																			',',
																			'',
																		),
																	) *
																		factor *
																		multiplier,
																).toLocaleString()
															: '0'}
													</strong>
												</div>
												<div className="store-meter">
													<i
														style={{
															width: hasSales
																? `${width}%`
																: '0%',
														}}
													/>
												</div>
											</div>
										))}
									</section>
									<section className="store-panel">
										<h2>Where people find you</h2>
										<p>
											Share of visits by source · Sample
										</p>
										{[
											['Direct', 42],
											['Instagram', 31],
											['Search', 19],
											['Other', 8],
										].map(([label, value]) => (
											<div
												className="store-source"
												key={label}
											>
												<span>{label}</span>
												<div className="store-meter">
													<i
														style={{
															width: hasSales
																? `${value}%`
																: '0%',
														}}
													/>
												</div>
												<strong>
													{hasSales ? value : 0}%
												</strong>
											</div>
										))}
									</section>
								</div>
							</>
						)}
						{(section === 'products' ||
							section === 'customers' ||
							section === 'payments') && (
							<>
								{section === 'payments' && (
									<div className="store-payment-summary">
										<div>
											<span>Paid in this sample</span>
											<strong>
												{money(hasSales ? 144 : 0)}
											</strong>
										</div>
										<div>
											<span>Pending</span>
											<strong>
												{money(hasSales ? 72 : 0)}
											</strong>
										</div>
										<div>
											<span>Refunded</span>
											<strong>
												{money(hasSales ? 32 : 0)}
											</strong>
										</div>
										<small>
											<CreditCardIcon /> Payments preview
											· USD
										</small>
									</div>
								)}
								<section className="store-panel store-list-panel">
									<div className="store-table-toolbar">
										<label>
											<MagnifyingGlassIcon />
											<input
												aria-label={`Search ${section}`}
												placeholder={`Search ${section}…`}
												value={search}
												onChange={(e) =>
													setSearch(e.target.value)
												}
											/>
										</label>
										{section !== 'customers' && (
											<select
												aria-label="Filter by status"
												value={statusFilter}
												onChange={(e) =>
													setStatusFilter(
														e.target.value,
													)
												}
											>
												{(section === 'products'
													? ['All', 'Active', 'Draft']
													: [
															'All',
															'Paid',
															'Pending',
															'Refunded',
														]
												).map((s) => (
													<option key={s} value={s}>
														{s === 'All'
															? 'All statuses'
															: s}
													</option>
												))}
											</select>
										)}
										<span>
											{section === 'products'
												? filteredProducts.length
												: section === 'customers'
													? filteredCustomers.length
													: filteredPayments.length}{' '}
											{section}
										</span>
									</div>
									{section === 'products' && (
										<div className="store-table-scroll">
											<table>
												<thead>
													<tr>
														<th>Product</th>
														<th>Status</th>
														<th>Inventory</th>
														<th className="store-align-right">
															Price
														</th>
													</tr>
												</thead>
												<tbody>
													{filteredProducts.map(
														(p) => (
															<tr key={p.id}>
																<td>
																	<button
																		className="store-product-cell"
																		onClick={() =>
																			setDetail(
																				{
																					kind: 'product',
																					product:
																						p,
																				},
																			)
																		}
																	>
																		<img
																			src={
																				p.image
																			}
																			alt=""
																		/>
																		<span>
																			<strong>
																				{
																					p.name
																				}
																			</strong>
																			<small>
																				Physical
																				product
																			</small>
																		</span>
																	</button>
																</td>
																<td>
																	<Status>
																		{
																			p.status
																		}
																	</Status>
																</td>
																<td>
																	{p.stock}{' '}
																	available
																</td>
																<td className="store-align-right">
																	{money(
																		p.price,
																	)}
																</td>
															</tr>
														),
													)}
												</tbody>
											</table>
											{!filteredProducts.length && (
												<p className="store-empty">
													No products match. Try
													another search or status.
												</p>
											)}
										</div>
									)}
									{section === 'customers' && (
										<div className="store-table-scroll">
											<table>
												<thead>
													<tr>
														<th>Customer</th>
														<th>Location</th>
														<th>Orders</th>
														<th>Customer since</th>
														<th className="store-align-right">
															Total spent
														</th>
													</tr>
												</thead>
												<tbody>
													{filteredCustomers.map(
														(c) => (
															<tr key={c.email}>
																<td>
																	<button
																		className="store-product-cell"
																		onClick={() =>
																			setDetail(
																				{
																					kind: 'customer',
																					customer:
																						c,
																				},
																			)
																		}
																	>
																		<span className="store-customer-avatar">
																			{c.name
																				.split(
																					' ',
																				)
																				.map(
																					(
																						n,
																					) =>
																						n[0],
																				)
																				.join(
																					'',
																				)}
																		</span>
																		<span>
																			<strong>
																				{
																					c.name
																				}
																			</strong>
																			<small>
																				{
																					c.email
																				}
																			</small>
																		</span>
																	</button>
																</td>
																<td>
																	{c.city}
																</td>
																<td>
																	{c.orders}
																</td>
																<td>
																	{c.joined}
																</td>
																<td className="store-align-right">
																	{money(
																		c.spent,
																	)}
																</td>
															</tr>
														),
													)}
												</tbody>
											</table>
											{!filteredCustomers.length && (
												<p className="store-empty">
													{hasSales
														? 'No customers match your search.'
														: 'Your customers will appear here after your first sale.'}
												</p>
											)}
										</div>
									)}
									{section === 'payments' &&
										paymentTable(filteredPayments)}
									<div className="store-table-footer">
										Illustrative records for this preview.
										Nothing is connected to your account.
									</div>
								</section>
							</>
						)}
						<footer className="store-content-footer">
							<span>Made for your next chapter.</span>
							<span>estori.</span>
						</footer>
					</main>
					<button className="store-agent-float" onClick={openAgent}>
						<SparkleIcon /> Ask Estori
					</button>
				</div>
			</div>
			<dialog
				ref={dialog}
				className="store-detail-dialog"
				aria-labelledby="store-dialog-title"
				onCancel={() => setDetail(null)}
				onClick={(e) => {
					if (e.target === e.currentTarget) setDetail(null);
				}}
			>
				<div className="store-dialog-body">
					<button
						className="store-dialog-close"
						aria-label="Close details"
						onClick={() => setDetail(null)}
					>
						<XIcon />
					</button>
					<p className="store-eyebrow">{store.name} · Preview</p>
					<h2 id="store-dialog-title">
						{detail?.kind === 'product'
							? detail.product.name
							: detail?.kind === 'customer'
								? detail.customer.name
								: detail?.kind === 'payment'
									? `Payment ${detail.payment.id}`
									: detail?.kind === 'new'
										? 'Make room for something new.'
										: detail?.kind === 'agent'
											? 'What shall we create?'
											: 'Your storefront, at a glance.'}
					</h2>
					{detail?.kind === 'product' && (
						<>
							<img
								className="store-detail-image"
								src={detail.product.image}
								alt={detail.product.name}
							/>
							<div className="store-detail-price">
								<strong>{money(detail.product.price)}</strong>
								<Status>{detail.product.status}</Status>
							</div>
							<dl>
								<div>
									<dt>Inventory</dt>
									<dd>{detail.product.stock} available</dd>
								</div>
								<div>
									<dt>Type</dt>
									<dd>Physical product</dd>
								</div>
							</dl>
							<p className="store-demo-note">
								Sample product details. Editing and publishing
								will connect to your store in a future version.
							</p>
						</>
					)}
					{detail?.kind === 'customer' && (
						<>
							<span className="store-customer-avatar store-avatar-large">
								{detail.customer.name
									.split(' ')
									.map((n) => n[0])
									.join('')}
							</span>
							<p>{detail.customer.email}</p>
							<dl>
								{[
									['Location', detail.customer.city],
									['Customer since', detail.customer.joined],
									['Orders', detail.customer.orders],
									[
										'Total spent',
										money(detail.customer.spent),
									],
								].map(([k, v]) => (
									<div key={k}>
										<dt>{k}</dt>
										<dd>{v}</dd>
									</div>
								))}
							</dl>
							<p className="store-demo-note">
								Fictional customer profile for layout review.
							</p>
						</>
					)}
					{detail?.kind === 'payment' && (
						<>
							<div className="store-detail-price">
								<strong>{money(detail.payment.total)}</strong>
								<Status>{detail.payment.status}</Status>
							</div>
							<dl>
								{[
									['Customer', detail.payment.customer],
									['Date', detail.payment.date],
									['Currency', 'USD'],
									['Method', 'Sample card payment'],
								].map(([k, v]) => (
									<div key={k}>
										<dt>{k}</dt>
										<dd>{v}</dd>
									</div>
								))}
							</dl>
							<p className="store-demo-note">
								Illustrative payment only. No funds are moved in
								this preview.
							</p>
						</>
					)}
					{detail?.kind === 'new' && (
						<form
							className="store-product-form"
							onSubmit={(e) => {
								e.preventDefault();
								const data = new FormData(e.currentTarget);
								const title = String(data.get('name')).trim();
								if (!title) return;
								setProducts((prev) => [
									...prev,
									{
										id: Date.now(),
										name: title,
										price: Number(data.get('price')),
										stock: 0,
										image: '/marketing/products/ceramic-dripper.webp',
										status: 'Draft',
									},
								]);
								setSearch('');
								setStatusFilter('All');
								setDetail(null);
								setNotice(
									`“${title}” added as a sample draft. Changes reset when you reload or switch stores.`,
								);
							}}
						>
							<p>Add a sample product to explore this flow.</p>
							<label>
								Product name
								<Input
									name="name"
									aria-label="Product name"
									required
									placeholder="e.g. Weekend Blend"
								/>
							</label>
							<label>
								Price in USD
								<Input
									name="price"
									aria-label="Price in USD"
									type="number"
									min="0"
									max="100000"
									step="0.01"
									defaultValue="24.00"
									required
								/>
							</label>
							<p className="store-demo-note">
								Saved only in this preview. Uses a placeholder
								product image.
							</p>
							<Button
								variant="primary"
								className="lab-primary"
								type="submit"
							>
								Create sample draft
							</Button>
						</form>
					)}
					{detail?.kind === 'storefront' && (
						<>
							<div className="store-shop-preview">
								<span>{store.name}</span>
								<h3>
									{store.id === 1
										? 'Good mornings start here.'
										: 'Find your next favorite.'}
								</h3>
								<div>
									{products.slice(0, 3).map((p) => (
										<button
											key={p.id}
											onClick={() =>
												setDetail({
													kind: 'product',
													product: p,
												})
											}
										>
											<img src={p.image} alt="" />
											<strong>{p.name}</strong>
											<small>{money(p.price)}</small>
										</button>
									))}
								</div>
							</div>
							<p className="store-demo-note">
								A sample of the customer-facing view. No live
								storefront is opened or published.
							</p>
						</>
					)}
					{detail?.kind === 'agent' && (
						<form
							className="store-product-form"
							onSubmit={(e) => {
								e.preventDefault();
								setAgentReply(true);
							}}
						>
							<p>A little help with {store.name}.</p>
							<label>
								Your idea
								<textarea
									required
									placeholder="Help me write a story for my next collection…"
								/>
							</label>
							<Button
								variant="primary"
								className="lab-primary"
								type="submit"
							>
								<SparkleIcon /> Try sample response
							</Button>
							{agentReply && (
								<div
									role="status"
									className="store-agent-response"
								>
									<strong>Here’s a starting point.</strong>
									<p>
										Tell the story behind your collection:
										what inspired it, how it’s made, and the
										small detail that makes it yours. Pair
										it with a close-up photo and a clear
										invitation to explore.
									</p>
									<small>
										Prewritten preview response · No AI
										credits used
									</small>
								</div>
							)}
						</form>
					)}
				</div>
			</dialog>
		</div>
	);
}
