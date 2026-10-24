import { useState } from 'react';
import { Button, Table } from '@cloudflare/kumo';
import {
	ArrowDownIcon,
	ArrowUpIcon,
	DownloadSimpleIcon,
} from '@phosphor-icons/react';
import { t, msg, getLocale, useI18n } from '@/lib/i18n';
import { INTL_LOCALE } from 'shared/i18n/locales';
import { formatCents } from '@/lib/pricing';
import { analyticsCsv, comparisonChange } from './analytics-export';
import type { aggregateOrders } from './report';
import { MetricChart } from './metric-chart';
import './analytics-panel.css';

type Report = ReturnType<typeof aggregateOrders>;
type Metric = 'paidCents' | 'paidOrders' | 'average';
const money = (value: number) => formatCents(Math.round(value), getLocale());
const count = (value: number) =>
	value.toLocaleString(INTL_LOCALE[getLocale()], {
		maximumFractionDigits: 1,
	});
const percent = (value: number) =>
	value.toLocaleString(INTL_LOCALE[getLocale()], {
		style: 'percent',
		maximumFractionDigits: 1,
	});
const ratio = (value: number, total: number) => (total ? value / total : 0);
function Change({
	current,
	previous,
	inverse = false,
}: {
	current: number;
	previous: number;
	inverse?: boolean;
}) {
	const change = comparisonChange(current, previous);
	if (change === null)
		return (
			<span className="ea-change ea-neutral">
				{t('No prior baseline')}
			</span>
		);
	const Icon = change < 0 ? ArrowDownIcon : ArrowUpIcon;
	return (
		<span
			className={`ea-change ${change === 0 ? 'ea-neutral' : change > 0 !== inverse ? 'ea-positive' : 'ea-negative'}`}
		>
			<Icon size={12} />
			{percent(Math.abs(change))}
			<span className="ea-change-caption">{t('vs previous period')}</span>
		</span>
	);
}
function points(report: Report, metric: Metric) {
	return report.trend.map((day) => ({
		date: day.date,
		value:
			metric === 'average'
				? ratio(day.paidCents, day.paidOrders)
				: day[metric],
	}));
}
function exportReport(report: Report) {
	const url = URL.createObjectURL(
		new Blob([analyticsCsv(report)], { type: 'text/csv;charset=utf-8' }),
	);
	const link = document.createElement('a');
	link.href = url;
	link.download = 'estori-analytics.csv';
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function AnalyticsPanel({
	report,
	previous,
	mode,
}: {
	report: Report;
	previous: Report;
	mode: 'live' | 'test';
}) {
	useI18n();
	const [metric, setMetric] = useState<Metric>('paidCents');
	const [compare, setCompare] = useState(true);
	const metrics = [
		{ key: 'paidCents', label: msg('Paid order totals'), format: money },
		{ key: 'paidOrders', label: msg('Successful payments'), format: count },
		{ key: 'average', label: msg('Average paid order'), format: money },
	] as const;
	const active = metrics.find((item) => item.key === metric)!;
	const currentValue =
		metric === 'average' ? report.averageOrderCents : report[metric];
	const priorValue =
		metric === 'average' ? previous.averageOrderCents : previous[metric];
	const statCards = [
		{
			label: msg('Successful payments'),
			value: report.paidOrders,
			prior: previous.paidOrders,
			detail: msg('Orders currently marked paid'),
			format: count,
		},
		{
			label: msg('Average paid order'),
			value: report.averageOrderCents,
			prior: previous.averageOrderCents,
			detail: msg('Paid totals divided by paid orders'),
			format: money,
		},
		{
			label: msg('Ordering customers'),
			value: report.customerCount,
			prior: previous.customerCount,
			detail: msg('Unique shopper emails in this period'),
			format: count,
		},
		{
			label: msg('Items ordered'),
			value: report.units,
			prior: previous.units,
			detail: msg('Across all order statuses'),
			format: count,
		},
		{
			label: msg('Repeat customers'),
			value: report.repeatCustomerRate,
			prior: previous.repeatCustomerRate,
			detail: msg('Customers with multiple orders in this period'),
			format: percent,
		},
		{
			label: msg('Refund rate'),
			value: ratio(report.refundedOrders, report.totalOrders),
			prior: ratio(previous.refundedOrders, previous.totalOrders),
			detail: msg('Orders with a full or partial refund'),
			format: percent,
			inverse: true,
		},
		{
			label: msg('Dispute rate'),
			value: ratio(report.disputedOrders, report.totalOrders),
			prior: ratio(previous.disputedOrders, previous.totalOrders),
			detail: msg('Orders with an open or lost dispute'),
			format: percent,
			inverse: true,
		},
		{
			label: msg('Unfulfilled'),
			value: report.unfulfilledOrders,
			prior: previous.unfulfilledOrders,
			detail: msg('Across all order statuses'),
			format: count,
			inverse: true,
		},
	];
	const dayName = (weekday: number) =>
		new Date(Date.UTC(2026, 0, 4 + weekday)).toLocaleDateString(
			INTL_LOCALE[getLocale()],
			{ weekday: 'short', timeZone: 'UTC' },
		);
	const maxDay = Math.max(1, ...report.weekdays.map((day) => day.paidCents));
	const topCustomers = [...report.customers]
		.sort((a, b) => b.paidCents - a.paidCents)
		.slice(0, 5);
	return (
		<div className="ea-dashboard">
			<div className="ea-toolbar">
				<span>
					{t('Compared with the preceding {days} days', {
						days: report.trend.length,
					})}
				</span>
				<div>
					<Button
						size="sm"
						variant="secondary"
						aria-pressed={compare}
						onClick={() => setCompare(!compare)}
					>
						{t('Compare periods')}
					</Button>
					<Button
						size="sm"
						variant="secondary"
						icon={<DownloadSimpleIcon size={16} />}
						onClick={() => exportReport(report)}
					>
						{t('Export report')}
					</Button>
				</div>
			</div>
			{mode === 'test' && (
				<div className="ea-test-notice" role="status">
					<strong>{t('Test data')}</strong>
					<span>
						{t(
							'Test transactions are separate from live sales. The sample stores contain illustrative transactions; no money has moved.',
						)}
					</span>
				</div>
			)}
			<div className="ea-overview-grid">
				<section className="es-panel ea-hero">
					<div className="ea-hero-top">
						<div>
							<span className="ea-eyebrow">
								{t(active.label)}
							</span>
							<strong className="ea-hero-value">
								{active.format(currentValue)}
							</strong>
							{compare && (
								<Change
									current={currentValue}
									previous={priorValue}
								/>
							)}
						</div>
						<div
							className="ea-metric-picker"
							role="group"
							aria-label={t('Chart metric')}
						>
							{metrics.map((item) => (
								<Button
									key={item.key}
									size="sm"
									variant={
										metric === item.key
											? 'secondary'
											: 'ghost'
									}
									aria-pressed={metric === item.key}
									onClick={() => setMetric(item.key)}
								>
									{t(item.label)}
								</Button>
							))}
						</div>
					</div>
					<MetricChart
						label={t(active.label)}
						points={points(report, metric)}
						previous={
							compare ? points(previous, metric) : undefined
						}
						formatValue={active.format}
					/>
					<div className="ea-chart-caption">
						<span>
							<i />
							{t('Selected period')}
						</span>
						{compare && (
							<span>
								<i className="ea-prior-dot" />
								{t('Previous period')}
							</span>
						)}
						<small>
							{metric === 'paidOrders'
								? t('UTC')
								: t('UTC · USD · Before fees')}
						</small>
					</div>
				</section>
				<section className="es-panel ea-snapshot">
					<h2>{t('Orders at a glance')}</h2>
					<strong>{count(report.totalOrders)}</strong>
					<p>{t('Total orders')}</p>
					<div>
						{[
							{ label: t('Paid'), value: report.paidOrders },
							{
								label: t('Refunded orders'),
								value: report.refundedOrders,
							},
							{
								label: t('Disputed orders'),
								value: report.disputedOrders,
							},
						].map((item) => (
							<div className="ea-summary-row" key={item.label}>
								<span>{item.label}</span>
								<b>{count(item.value)}</b>
							</div>
						))}
					</div>
					<p className="ea-footnote">
						{t(
							'Paid totals exclude orders with refunds or disputes and do not represent profit or payout balances.',
						)}
					</p>
				</section>
			</div>
			<div className="ea-stat-grid">
				{statCards.map((stat) => (
					<section className="es-panel ea-stat" key={stat.label}>
						<h2>{t(stat.label)}</h2>
						<strong>{stat.format(stat.value)}</strong>
						{compare && (
							<Change
								current={stat.value}
								previous={stat.prior}
								inverse={stat.inverse}
							/>
						)}
						<p>{t(stat.detail)}</p>
					</section>
				))}
			</div>
			<div className="ea-detail-grid">
				<section className="es-panel">
					<div className="ea-section-heading">
						<h2>{t('Order activity')}</h2>
						<span>{t('Daily orders')}</span>
					</div>
					<MetricChart
						label={t('Daily orders')}
						points={report.trend.map((day) => ({
							date: day.date,
							value: day.orders,
						}))}
						previous={
							compare
								? previous.trend.map((day) => ({
										date: day.date,
										value: day.orders,
									}))
								: undefined
						}
						formatValue={count}
						compact
						color="#7056db"
					/>
				</section>
				<section className="es-panel">
					<div className="ea-section-heading">
						<h2>{t('Refund activity')}</h2>
						<span>{t('Orders with refunds')}</span>
					</div>
					<MetricChart
						label={t('Orders with refunds')}
						points={report.trend.map((day) => ({
							date: day.date,
							value: day.refundedOrders,
						}))}
						previous={
							compare
								? previous.trend.map((day) => ({
										date: day.date,
										value: day.refundedOrders,
									}))
								: undefined
						}
						formatValue={count}
						compact
						color="#d18a42"
					/>
				</section>
			</div>
			<div className="ea-breakdown-grid">
				<section className="es-panel ea-breakdown">
					<h2>{t('Sales by weekday')}</h2>
					<p>{t('Paid order totals by UTC weekday')}</p>
					{report.weekdays.map((day) => (
						<div className="ea-weekday" key={day.weekday}>
							<span>{dayName(day.weekday)}</span>
							<div>
								<i
									style={{
										width: `${(day.paidCents / maxDay) * 100}%`,
									}}
								/>
							</div>
							<b>{money(day.paidCents)}</b>
						</div>
					))}
				</section>
				<section className="es-panel ea-breakdown">
					<h2>{t('Fulfillment overview')}</h2>
					<p>{t('Current status of orders placed in this period')}</p>
					<div className="ea-fulfillment-value">
						{percent(
							ratio(report.fulfilledOrders, report.totalOrders),
						)}
						<small>{t('Fulfilled')}</small>
					</div>
					<div
						className="ea-progress"
						role="img"
						aria-label={t('Fulfilled orders: {count} of {total}', {
							count: report.fulfilledOrders,
							total: report.totalOrders,
						})}
					>
						<i
							style={{
								width: `${ratio(report.fulfilledOrders, report.totalOrders) * 100}%`,
							}}
						/>
					</div>
					<div className="ea-summary-row">
						<span>{t('Fulfilled')}</span>
						<b>{count(report.fulfilledOrders)}</b>
					</div>
					<div className="ea-summary-row">
						<span>{t('Unfulfilled')}</span>
						<b>{count(report.unfulfilledOrders)}</b>
					</div>
					<div className="ea-summary-row">
						<span>{t('Average items per order')}</span>
						<b>{count(report.averageItemsPerOrder)}</b>
					</div>
					<div className="ea-summary-row">
						<span>{t('Own product units')}</span>
						<b>{count(report.ownUnits)}</b>
					</div>
					<div className="ea-summary-row">
						<span>{t('Catalog product units')}</span>
						<b>{count(report.catalogUnits)}</b>
					</div>
				</section>
				<section className="es-panel ea-breakdown ea-customers">
					<h2>{t('Top customers')}</h2>
					<p>{t('Ranked by paid order totals in this period')}</p>
					<Table>
						<Table.Header>
							<Table.Row>
								<Table.Head>{t('Customer')}</Table.Head>
								<Table.Head>{t('Orders')}</Table.Head>
								<Table.Head>{t('Paid totals')}</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{topCustomers.map((customer) => (
								<Table.Row key={customer.email}>
									<Table.Cell>
										{customer.name || customer.email}
									</Table.Cell>
									<Table.Cell>{customer.orders}</Table.Cell>
									<Table.Cell>
										{money(customer.paidCents)}
									</Table.Cell>
								</Table.Row>
							))}
						</Table.Body>
					</Table>
					{!topCustomers.length && (
						<p>{t('No customers in this period yet.')}</p>
					)}
				</section>
			</div>
			<p className="ea-footnote">
				{t(
					'Metrics use order creation dates in UTC and their current payment status. Repeat customers are measured within this period. Traffic, acquisition costs and subscription revenue need additional tracking.',
				)}
			</p>
		</div>
	);
}
