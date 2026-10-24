import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Checkbox, Input, Popover, Select } from '@cloudflare/kumo';
import {
	CalendarBlankIcon,
	ClockIcon,
	DownloadSimpleIcon,
	GlobeIcon,
	PencilSimpleIcon,
} from '@phosphor-icons/react';
import { useApps } from '@/hooks/use-apps';
import { getLocale, msg, t, useI18n } from '@/lib/i18n';
import { INTL_LOCALE } from 'shared/i18n/locales';
import { analyticsCsv } from './analytics-export';
import {
	ANALYTICS_WIDGETS,
	customPeriod,
	type AnalyticsPeriod,
	type AnalyticsWidget,
} from './analytics-filters';
import type { aggregateOrders } from './report';
import './analytics-toolbar.css';

type Report = ReturnType<typeof aggregateOrders>;
const WIDGET_LABELS = {
	overview: msg('Sales overview'),
	traffic: msg('Storefront traffic'),
	metrics: msg('Order metrics'),
	activity: msg('Order activity'),
	breakdowns: msg('Sales breakdowns'),
};
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
export function AnalyticsToolbar({
	period,
	appId,
	appTitle,
	userId,
	mode,
	products,
	productId,
	compare,
	hiddenWidgets,
	report,
	productsError = false,
	onRetryProducts,
}: {
	period: AnalyticsPeriod;
	appId: string;
	appTitle: string;
	userId: string;
	mode: 'live' | 'test';
	products: { id: string; name: string }[];
	productId: string;
	compare: boolean;
	hiddenWidgets: AnalyticsWidget[];
	report: Report | null;
	productsError?: boolean;
	onRetryProducts?: () => void;
}) {
	useI18n();
	const [params, setParams] = useSearchParams();
	const navigate = useNavigate();
	const { apps } = useApps();
	const [dateOpen, setDateOpen] = useState(false);
	const [from, setFrom] = useState(period.from);
	const [to, setTo] = useState(period.to);
	const [dateError, setDateError] = useState(false);
	const today = new Date().toISOString().slice(0, 10);
	const update = (change: (next: URLSearchParams) => void) => {
		const next = new URLSearchParams(params);
		change(next);
		setParams(next);
	};
	const openDates = (open: boolean) => {
		setDateOpen(open);
		if (open) {
			setFrom(period.from);
			setTo(period.to);
			setDateError(false);
		}
	};
	const formatDate = (value: string) =>
		new Date(value + 'T00:00:00Z').toLocaleDateString(
			INTL_LOCALE[getLocale()],
			{
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				timeZone: 'UTC',
			},
		);
	const dateLabel =
		period.from === period.to
			? formatDate(period.to)
			: `${formatDate(period.from)} – ${formatDate(period.to)}`;
	const periodItems = [
		{ value: 'today', label: t('Today') },
		{ value: 'yesterday', label: t('Yesterday') },
		{ value: '7', label: t('Last 7 days') },
		{ value: '30', label: t('Last 30 days') },
		{ value: '90', label: t('Last 90 days') },
		{ value: 'custom', label: t('Custom dates') },
	];
	const storeItems = apps
		.filter((app) => app.userId === userId)
		.map((app) => ({
			value: app.id,
			label: app.title || t('Untitled store'),
		}));
	if (!storeItems.some((app) => app.value === appId))
		storeItems.unshift({ value: appId, label: appTitle });
	const productItems = [
		{ value: '', label: t('All products') },
		...products.map((product) => ({
			value: product.id,
			label: product.name,
		})),
	];
	if (productId && !products.some((product) => product.id === productId))
		productItems.push({ value: productId, label: t('Selected product') });
	return (
		<div
			className="ea-filters"
			role="region"
			aria-label={t('Analytics filters')}
		>
			<div className="ea-date-group">
				<Select
					size="sm"
					aria-label={t('Reporting period')}
					value={period.preset}
					items={periodItems}
					onValueChange={(value) => {
						if (value === 'custom') {
							openDates(true);
							return;
						}
						if (value)
							update((next) => {
								next.set('period', value);
								next.delete('days');
								next.delete('from');
								next.delete('to');
							});
					}}
				/>
				<Popover open={dateOpen} onOpenChange={openDates}>
					<Popover.Trigger
						render={
							<Button
								size="sm"
								variant="secondary"
								aria-label={`${t('Choose dates')}: ${dateLabel}`}
								icon={<CalendarBlankIcon size={16} />}
							/>
						}
					>
						<span className="ea-date-value">{dateLabel}</span>
					</Popover.Trigger>
					<Popover.Content className="ea-filter-popover ea-date-popover">
						<Popover.Title>{t('Custom dates')}</Popover.Title>
						<div className="ea-date-inputs">
							<Input
								type="date"
								label={t('Start date')}
								value={from}
								max={today}
								onChange={(e) => setFrom(e.target.value)}
							/>
							<Input
								type="date"
								label={t('End date')}
								value={to}
								min={from}
								max={today}
								onChange={(e) => setTo(e.target.value)}
							/>
						</div>
						{dateError && (
							<p className="ea-filter-error" role="alert">
								{t(
									'Choose a valid date range of up to 90 days, ending today or earlier.',
								)}
							</p>
						)}
						<div className="ea-filter-actions">
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setDateOpen(false)}
							>
								{t('Cancel')}
							</Button>
							<Button
								size="sm"
								onClick={() => {
									if (!customPeriod(from, to, today)) {
										setDateError(true);
										return;
									}
									update((next) => {
										next.set('period', 'custom');
										next.set('from', from);
										next.set('to', to);
										next.delete('days');
									});
									setDateOpen(false);
								}}
							>
								{t('Apply')}
							</Button>
						</div>
					</Popover.Content>
				</Popover>
			</div>
			<span
				className="ea-product-filter"
				title={t(
					'Filters orders and checkouts containing this product. Visits remain store-wide.',
				)}
			>
				{productsError ? (
					<Button
						size="sm"
						variant="secondary"
						onClick={onRetryProducts}
					>
						{t("Couldn't load your products")}
					</Button>
				) : (
					<Select
						size="sm"
						aria-label={t('Product filter')}
						value={productId}
						items={productItems}
						onValueChange={(value) =>
							update((next) => {
								if (value) next.set('product', value);
								else next.delete('product');
							})
						}
					/>
				)}
			</span>
			<Select
				size="sm"
				aria-label={t('Store filter')}
				value={appId}
				items={storeItems}
				renderValue={(value) => (
					<span className="ea-store-value">
						<GlobeIcon size={16} />
						<span>
							{
								storeItems.find((item) => item.value === value)
									?.label
							}
						</span>
					</span>
				)}
				onValueChange={(value) => {
					if (!value || value === appId) return;
					const next = new URLSearchParams(params);
					next.delete('product');
					next.set('section', 'analytics');
					navigate(`/stores/${encodeURIComponent(value)}?${next}`);
				}}
			/>
			<span
				className={
					mode === 'test' ? 'ea-filter-test' : 'ea-filter-mode'
				}
			>
				<Select
					size="sm"
					aria-label={t('Data mode')}
					value={mode}
					items={{ live: t('Live sales'), test: t('Test data') }}
					onValueChange={(value) =>
						update((next) => {
							if (value === 'test') next.set('mode', 'test');
							else next.delete('mode');
						})
					}
				/>
			</span>
			<Popover>
				<Popover.Trigger
					render={
						<Button
							size="sm"
							variant="secondary"
							aria-label={t('Reporting timezone')}
							shape="square"
							icon={<ClockIcon size={16} />}
						/>
					}
				/>
				<Popover.Content className="ea-filter-popover ea-timezone-popover">
					<Popover.Title>{t('Reporting timezone')}</Popover.Title>
					<strong>UTC</strong>
					<Popover.Description>
						{t(
							'Reports use UTC so orders and visits share the same calendar days.',
						)}
					</Popover.Description>
				</Popover.Content>
			</Popover>
			<div className="ea-customize">
				<Popover>
					<Popover.Trigger
						render={
							<Button
								size="sm"
								variant="secondary"
								icon={<PencilSimpleIcon size={16} />}
							/>
						}
					>
						{t('Customize')}
					</Popover.Trigger>
					<Popover.Content className="ea-filter-popover ea-customize-popover">
						<Popover.Title>
							{t('Customize analytics')}
						</Popover.Title>
						<Checkbox
							label={t('Compare periods')}
							checked={compare}
							onCheckedChange={(checked) =>
								update((next) => {
									if (checked) next.delete('compare');
									else next.set('compare', 'off');
								})
							}
						/>
						<div className="ea-widget-options">
							<span>{t('Visible widgets')}</span>
							{ANALYTICS_WIDGETS.map((widget) => (
								<Checkbox
									key={widget}
									label={t(WIDGET_LABELS[widget])}
									checked={!hiddenWidgets.includes(widget)}
									onCheckedChange={(checked) =>
										update((next) => {
											const hidden =
												ANALYTICS_WIDGETS.filter(
													(item) =>
														item === widget
															? !checked
															: hiddenWidgets.includes(
																	item,
																),
												);
											if (hidden.length)
												next.set(
													'hide',
													hidden.join(','),
												);
											else next.delete('hide');
										})
									}
								/>
							))}
						</div>
						<div className="ea-filter-actions">
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									update((next) => {
										next.delete('hide');
										next.delete('compare');
									})
								}
							>
								{t('Reset layout')}
							</Button>
							<Button
								size="sm"
								variant="secondary"
								disabled={!report}
								icon={<DownloadSimpleIcon size={16} />}
								onClick={() => {
									if (report) exportReport(report);
								}}
							>
								{t('Export report')}
							</Button>
						</div>
					</Popover.Content>
				</Popover>
			</div>
		</div>
	);
}
