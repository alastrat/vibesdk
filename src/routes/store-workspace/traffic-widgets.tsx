import { useId, useState } from 'react';
import { Button, Table } from '@cloudflare/kumo';
import { GlobeHemisphereWestIcon } from '@phosphor-icons/react';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar, Pie } from '@visx/shape';
import type { StoreTrafficAnalytics, StoreTrafficBreakdown } from '@/api-types';
import { t, useI18n } from '@/lib/i18n';
import { formatCents } from '@/lib/pricing';
import { INTL_LOCALE } from 'shared/i18n/locales';
import { MetricChart } from './metric-chart';
import './traffic-widgets.css';

export type TrafficWidgetsProps = {
	data: StoreTrafficAnalytics;
	paidCents: number;
	/** Distinct customers with paid orders, not all traffic or all-status customers. */
	customerCount: number;
};
type TrafficMetric = 'visitors' | 'pageViews' | 'checkoutStarts';
const COLORS = [
	'#7356cf',
	'#a58be5',
	'#c8b8ee',
	'#527fba',
	'#8bb2c7',
	'#b2b7c2',
];
const safeCount = (value: number) =>
	Number.isFinite(value) ? Math.max(0, value) : 0;

function safePath(value: string): string {
	// Never surface query strings, fragments, or credentials from request URLs.
	try {
		return new URL(value, 'https://store.invalid').pathname.slice(0, 240);
	} catch {
		return '/';
	}
}

function sourceName(value: string): string {
	if (value.toLowerCase() === 'direct') return t('Direct');
	if (!value || value.toLowerCase() === 'unknown') return t('Unknown');
	try {
		return (
			new URL(
				value.includes('://') ? value : `https://${value}`,
			).hostname.slice(0, 80) || t('Unknown')
		);
	} catch {
		return t('Unknown');
	}
}
function deviceName(value: string): string {
	switch (value.toLowerCase()) {
		case 'desktop':
			return t('Desktop');
		case 'mobile':
			return t('Mobile');
		case 'tablet':
			return t('Tablet');
		case 'bot':
			return t('Bot');
		default:
			return t('Unknown');
	}
}

function DailyBars({ trend }: { trend: StoreTrafficAnalytics['trend'] }) {
	return (
		<div className="tw-daily-bars" aria-hidden="true">
			<ParentSize
				initialSize={{ width: 260, height: 54 }}
				ignoreDimensions={['height']}
				debounceTime={30}
			>
				{({ width }) => {
					const x = scaleBand({
						domain: trend.map((day) => day.date),
						range: [0, width],
						padding: 0.28,
					});
					const y = scaleLinear({
						domain: [
							0,
							Math.max(
								1,
								...trend.map((day) => safeCount(day.pageViews)),
							),
						],
						range: [52, 2],
					});
					return (
						<svg
							width={width}
							height={54}
							viewBox={`0 0 ${width} 54`}
						>
							{trend.map((day) => (
								<Bar
									key={day.date}
									x={x(day.date)}
									y={y(safeCount(day.pageViews))}
									width={x.bandwidth()}
									height={52 - y(safeCount(day.pageViews))}
									rx={1.5}
									fill="var(--tw-accent)"
									opacity={0.66}
								/>
							))}
						</svg>
					);
				}}
			</ParentSize>
		</div>
	);
}

function BreakdownDonut({
	title,
	entries,
	trend,
	displayName,
}: {
	title: string;
	entries: StoreTrafficBreakdown[];
	trend: StoreTrafficAnalytics['trend'];
	displayName: (name: string) => string;
}) {
	const { locale } = useI18n();
	const format = (value: number) =>
		safeCount(value).toLocaleString(INTL_LOCALE[locale], {
			maximumFractionDigits: 0,
		});
	const sorted = entries
		.filter((entry) => safeCount(entry.views) > 0)
		.sort((a, b) => b.views - a.views);
	const visible = sorted
		.slice(0, 5)
		.map((entry) => ({ ...entry, label: displayName(entry.name) }));
	if (sorted.length > 5)
		visible.push({
			name: 'other',
			label: t('Other'),
			views: sorted.slice(5).reduce((sum, entry) => sum + entry.views, 0),
			visitors: 0,
		});
	const total = visible.reduce((sum, entry) => sum + entry.views, 0);
	const percent = (value: number) =>
		(total ? value / total : 0).toLocaleString(INTL_LOCALE[locale], {
			style: 'percent',
			maximumFractionDigits: 1,
		});
	return (
		<section className="tw-card tw-breakdown">
			<h2>{title}</h2>
			{total ? (
				<>
					<div className="tw-donut-layout">
						<svg
							viewBox="0 0 180 180"
							role="img"
							aria-label={t('{title}: {count} page views', {
								title,
								count: format(total),
							})}
						>
							<g transform="translate(90 90)">
								<Pie
									data={visible}
									pieValue={(entry) => entry.views}
									pieSort={null}
									pieSortValues={null}
									innerRadius={57}
									outerRadius={78}
									padAngle={0.025}
									cornerRadius={2}
								>
									{({ arcs, path }) =>
										arcs.map((arc, index) => (
											<path
												key={arc.data.name}
												d={path(arc) ?? undefined}
												fill={COLORS[index]}
											>
												<title>{`${arc.data.label}: ${percent(arc.data.views)}`}</title>
											</path>
										))
									}
								</Pie>
								<text
									textAnchor="middle"
									y="-1"
									className="tw-donut-value"
								>
									{format(total)}
								</text>
								<text
									textAnchor="middle"
									y="18"
									className="tw-donut-caption"
								>
									{t('Page views')}
								</text>
							</g>
						</svg>
						<ul className="tw-donut-legend">
							{visible.map((entry, index) => (
								<li key={entry.name}>
									<span className="tw-legend-name">
										<i
											style={{
												background: COLORS[index],
											}}
										/>
										{entry.label}
									</span>
									<strong>{percent(entry.views)}</strong>
								</li>
							))}
						</ul>
					</div>
					<DailyBars trend={trend} />
					<p className="tw-caption">
						{t('Daily page views · all traffic')}
					</p>
				</>
			) : (
				<p className="tw-empty">
					{t('No traffic recorded in this period.')}
				</p>
			)}
		</section>
	);
}

function RequestGlobe() {
	const id = useId().replace(/:/g, '');
	return (
		<svg className="tw-globe" viewBox="0 0 300 154" aria-hidden="true">
			<defs>
				<radialGradient id={`${id}-globe`} cx="35%" cy="28%">
					<stop offset="0" stopColor="#a796e5" stopOpacity=".24" />
					<stop offset="1" stopColor="#7356cf" stopOpacity=".03" />
				</radialGradient>
				<clipPath id={`${id}-globe-clip`}>
					<circle cx="150" cy="92" r="79" />
				</clipPath>
			</defs>
			<circle
				cx="150"
				cy="92"
				r="79"
				fill={`url(#${id}-globe)`}
				className="tw-globe-outline"
			/>
			<g clipPath={`url(#${id}-globe-clip)`} className="tw-globe-grid">
				<ellipse cx="150" cy="92" rx="28" ry="79" />
				<ellipse cx="150" cy="92" rx="58" ry="79" />
				<ellipse cx="150" cy="92" rx="79" ry="25" />
				<ellipse cx="150" cy="92" rx="79" ry="53" />
				<path d="M71 92h158M150 13v158" />
			</g>
		</svg>
	);
}

export function TrafficWidgets({
	data,
	paidCents,
	customerCount,
}: TrafficWidgetsProps) {
	const { locale } = useI18n();
	const [metric, setMetric] = useState<TrafficMetric>('visitors');
	const count = (value: number) =>
		safeCount(value).toLocaleString(INTL_LOCALE[locale], {
			maximumFractionDigits: 0,
		});
	const money = (value: number) =>
		formatCents(Math.round(safeCount(value)), locale);
	const date = (value: string | null, time = false) => {
		const timestamp = value ? Date.parse(value) : NaN;
		return Number.isFinite(timestamp)
			? new Intl.DateTimeFormat(INTL_LOCALE[locale], {
					month: 'short',
					day: 'numeric',
					...(time
						? ({ hour: '2-digit', minute: '2-digit' } as const)
						: ({ year: 'numeric' } as const)),
					timeZone: 'UTC',
				}).format(timestamp)
			: t('Not available');
	};
	const countryNames = new Intl.DisplayNames([INTL_LOCALE[locale]], {
		type: 'region',
	});
	const country = (value: string) =>
		/^[A-Z]{2}$/.test(value) && value !== 'XX'
			? (countryNames.of(value) ?? t('Unknown'))
			: t('Unknown');
	const labels: Record<TrafficMetric, string> = {
		visitors: t('Estimated visitors'),
		pageViews: t('Page views'),
		checkoutStarts: t('Checkouts'),
	};
	const totalViews = safeCount(data.totals.pageViews);
	const share = (views: number) =>
		totalViews ? Math.min(1, safeCount(views) / totalViews) : 0;
	const shareLabel = (views: number) =>
		share(views).toLocaleString(INTL_LOCALE[locale], {
			style: 'percent',
			maximumFractionDigits: 1,
		});
	const events = [...data.events]
		.sort(
			(a, b) =>
				(Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
		)
		.slice(0, 6);
	return (
		<div className="tw-grid">
			<section className="tw-card tw-traffic">
				<div className="tw-card-heading">
					<div>
						<h2>{t('Traffic over time')}</h2>
						<p className="tw-subtitle">
							{t(
								'Published storefront requests served by Cloudflare',
							)}
						</p>
					</div>
					{data.mode === 'test' && (
						<span className="tw-test-label">
							{t('Test traffic')}
						</span>
					)}
				</div>
				<div className="tw-traffic-toolbar">
					<div>
						<strong className="tw-large-value">
							{count(data.totals[metric])}
						</strong>
						<span className="tw-value-label">{labels[metric]}</span>
					</div>
					<div
						role="group"
						aria-label={t('Traffic metric')}
						className="tw-metric-tabs"
					>
						{(
							[
								{ key: 'visitors', label: t('Visitors') },
								{ key: 'pageViews', label: t('Page views') },
								{
									key: 'checkoutStarts',
									label: t('Checkouts'),
								},
							] as const
						).map((tab) => (
							<Button
								key={tab.key}
								size="sm"
								variant={
									metric === tab.key ? 'secondary' : 'ghost'
								}
								aria-label={tab.label}
								aria-pressed={metric === tab.key}
								onClick={() => setMetric(tab.key)}
							>
								{tab.label}
							</Button>
						))}
					</div>
				</div>
				<MetricChart
					label={labels[metric]}
					points={data.trend.map((day) => ({
						date: day.date,
						value: safeCount(day[metric]),
					}))}
					previous={data.previous.map((day) => ({
						date: day.date,
						value: safeCount(day[metric]),
					}))}
					formatValue={count}
				/>
				<div className="tw-chart-key">
					<span>
						<i />
						{t('Selected period')}
					</span>
					<span>
						<i className="tw-prior" />
						{t('Previous period')}
					</span>
					<span>UTC</span>
				</div>
				<p className="tw-caption">
					{t(
						'Anonymous estimates based on request signals; a visitor may be counted again on another day.',
					)}
				</p>
				<p className="tw-caption">
					{data.trackingSince
						? t('Traffic tracking since {date}', {
								date: date(data.trackingSince),
							})
						: t(
								'Traffic tracking starts when someone visits your published store.',
							)}
				</p>
			</section>
			<section className="tw-card tw-events">
				<div className="tw-card-heading">
					<h2>{t('Recent events')}</h2>
					<GlobeHemisphereWestIcon size={18} />
				</div>
				<RequestGlobe />
				<p className="tw-caption">
					{t('Recent storefront requests · UTC')}
				</p>
				{events.length ? (
					<ol>
						{events.map((event) => (
							<li key={event.id}>
								<div className="tw-event-icon">
									<GlobeHemisphereWestIcon size={15} />
								</div>
								<div className="tw-event-content">
									<strong>{safePath(event.path)}</strong>
									<span>
										{country(event.country)} ·{' '}
										{deviceName(event.device)} ·{' '}
										{sourceName(event.source)}
									</span>
								</div>
								<time
									dateTime={
										Number.isFinite(
											Date.parse(event.createdAt),
										)
											? event.createdAt
											: undefined
									}
								>
									{date(event.createdAt, true)}
								</time>
							</li>
						))}
					</ol>
				) : (
					<p className="tw-empty">{t('No recent events.')}</p>
				)}
			</section>
			<BreakdownDonut
				title={t('Traffic sources')}
				entries={data.sources}
				trend={data.trend}
				displayName={sourceName}
			/>
			<BreakdownDonut
				title={t('Devices')}
				entries={data.devices}
				trend={data.trend}
				displayName={deviceName}
			/>
			<section className="tw-card tw-countries">
				<h2>{t('Countries')}</h2>
				<p className="tw-subtitle">
					{t('Approximate request locations')}
				</p>
				<div className="tw-table-scroll">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Country')}</Table.Head>
								<Table.Head>{t('Views')}</Table.Head>
								<Table.Head>{t('Visitors')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{[...data.countries]
								.sort((a, b) => b.views - a.views)
								.map((entry) => (
									<Table.Row key={entry.name}>
										<Table.Cell>
											{country(entry.name)}
										</Table.Cell>
										<Table.Cell>
											{count(entry.views)}
										</Table.Cell>
										<Table.Cell>
											{count(entry.visitors)}
										</Table.Cell>
									</Table.Row>
								))}
						</Table.Body>
					</Table>
				</div>
				{!data.countries.length && (
					<p className="tw-empty">
						{t('No traffic recorded in this period.')}
					</p>
				)}
			</section>
			<section className="tw-card tw-pages">
				<h2>{t('Top pages')}</h2>
				<p className="tw-subtitle">
					{t('Most viewed storefront paths')}
				</p>
				<div className="tw-table-scroll">
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Page')}</Table.Head>
								<Table.Head>{t('Views')}</Table.Head>
								<Table.Head>{t('Visitors')}</Table.Head>
								<Table.Head>{t('Share of views')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{[...data.pages]
								.sort((a, b) => b.views - a.views)
								.map((entry) => (
									<Table.Row key={entry.name}>
										<Table.Cell>
											<span className="tw-page-path">
												{safePath(entry.name)}
											</span>
										</Table.Cell>
										<Table.Cell>
											{count(entry.views)}
										</Table.Cell>
										<Table.Cell>
											{count(entry.visitors)}
										</Table.Cell>
										<Table.Cell>
											<span className="tw-share">
												<span>
													<i
														style={{
															width: `${share(entry.views) * 100}%`,
														}}
													/>
												</span>
												<span>
													{shareLabel(entry.views)}
												</span>
											</span>
										</Table.Cell>
									</Table.Row>
								))}
						</Table.Body>
					</Table>
				</div>
				{!data.pages.length && (
					<p className="tw-empty">
						{t('No traffic recorded in this period.')}
					</p>
				)}
			</section>
			<div className="tw-summary-stack">
				<section className="tw-card tw-summary">
					<h2>{t('Total refunded')}</h2>
					<strong>{money(data.totals.totalRefundedCents)}</strong>
					<p>
						{t(
							'Actual refunded amounts; no daily refund history is available.',
						)}
					</p>
				</section>
				<section className="tw-card tw-summary">
					<h2>{t('Average revenue per customer')}</h2>
					<strong>
						{customerCount > 0
							? money(paidCents / customerCount)
							: '—'}
					</strong>
					<p>
						{customerCount > 0
							? t(
									'Paid order totals ÷ known paid customers. Before fees.',
								)
							: t('No paid customers in this period.')}
					</p>
				</section>
				<section className="tw-card tw-summary">
					<h2>{t('Abandoned checkouts')}</h2>
					<strong>{count(data.totals.abandonedCheckouts)}</strong>
					<p>
						{t(
							'Open or expired checkouts started over 30 minutes ago.',
						)}
					</p>
				</section>
			</div>
		</div>
	);
}
