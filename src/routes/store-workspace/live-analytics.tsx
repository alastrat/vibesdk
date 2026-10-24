import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Loader, Select } from '@cloudflare/kumo';
import {
	CaretLeftIcon,
	PauseIcon,
	PlayIcon,
	ArrowClockwiseIcon,
	GlobeHemisphereWestIcon,
	XIcon,
} from '@phosphor-icons/react';
import { Pie } from '@visx/shape';
import type { StoreTrafficBreakdown } from '@/api-types';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import { t, useI18n } from '@/lib/i18n';
import { pageTitle } from '@/brand';
import { VisitorGlobeMap } from './visit-globe';
import { getVisitCountries } from './visit-globe-utils';
import {
	cumulativeHours,
	liveSnapshotState,
	type LiveHour,
} from './live-analytics-utils';
import { LiveHourlyChart } from './live-hourly-chart';
import './live-analytics.css';

function LiveDonut({
	title,
	entries,
	total,
	gray = false,
}: {
	title: string;
	entries: StoreTrafficBreakdown[];
	total: number;
	gray?: boolean;
}) {
	const { locale } = useI18n();
	const colors = gray
		? ['#bdbdbd', '#929aa2', '#d0d4d8', '#787f86']
		: ['#1955e6', '#29a875', '#88acf4', '#93d3b7'];
	const shown = entries.slice(0, 5);
	const remainder =
		total - shown.reduce((sum, entry) => sum + entry.visitors, 0);
	const slices =
		remainder > 0
			? [
					...shown,
					{ name: 'Other', views: remainder, visitors: remainder },
				]
			: shown;
	const displayName = (value: string) =>
		value === 'Other'
			? t('Other')
			: value === 'desktop'
				? t('Desktop')
				: value === 'mobile'
					? t('Mobile')
					: value === 'tablet'
						? t('Tablet')
						: value === 'Direct'
							? t('Direct')
							: value === 'Unknown'
								? t('Unknown')
								: value;
	return (
		<section className="live-card live-donut-card">
			<h2>{title}</h2>
			<div className="live-donut-body">
				<svg
					viewBox="0 0 200 200"
					role="img"
					aria-label={`${title}: ${total.toLocaleString(locale)} ${t('Visitors')}`}
				>
					<g transform="translate(100 100)">
						{entries.length ? (
							<Pie
								data={slices}
								pieValue={(entry) => entry.visitors}
								pieSort={null}
								pieSortValues={null}
								innerRadius={54}
								outerRadius={90}
							>
								{({ arcs, path }) =>
									arcs.map((arc, index) => (
										<path
											key={arc.data.name}
											d={path(arc) ?? undefined}
											fill={colors[index % colors.length]}
										>
											<title>{`${displayName(arc.data.name)}: ${arc.data.visitors}`}</title>
										</path>
									))
								}
							</Pie>
						) : (
							<circle
								r={72}
								fill="none"
								stroke="#f0f1f3"
								strokeWidth={36}
							/>
						)}
						<text
							textAnchor="middle"
							y="0"
							className="live-donut-number"
						>
							{total.toLocaleString(locale)}
						</text>
						<text
							textAnchor="middle"
							y="20"
							className="live-donut-label"
						>
							{t('Visitors')}
						</text>
					</g>
				</svg>
				<ul>
					{slices.map((entry, index) => (
						<li key={entry.name}>
							<i
								style={{
									background: colors[index % colors.length],
								}}
							/>
							<span title={displayName(entry.name)}>
								{displayName(entry.name)}
							</span>
							<small>
								{entry.visitors.toLocaleString(locale)}
							</small>
						</li>
					))}
					{!entries.length && (
						<li className="live-muted">{t('No data available')}</li>
					)}
				</ul>
			</div>
		</section>
	);
}
function LiveMetric({
	title,
	value,
	previous,
	rows,
	format,
	delta,
	control,
}: {
	title: string;
	value: number;
	previous: number;
	rows: LiveHour[];
	format: (value: number) => string;
	delta?: number;
	control?: React.ReactNode;
}) {
	return (
		<section className="live-card live-metric-card">
			<div className="live-card-head">
				<h2>{title}</h2>
				{control}
			</div>
			<div className="live-metric-value">
				{format(value)}
				{delta !== undefined && delta !== 0 && (
					<span className={delta > 0 ? 'positive' : 'negative'}>
						{delta > 0 ? '+' : ''}
						{delta}
					</span>
				)}
			</div>
			<LiveHourlyChart rows={rows} label={title} format={format} />
			<div className="live-chart-legend">
				<span>
					<i />
					{t('Today')} <b>{format(value)}</b>
				</span>
				<span>
					<i />
					{t('Yesterday')} <b>{format(previous)}</b>
				</span>
			</div>
		</section>
	);
}
export function LiveStoreAnalytics({
	appId,
	userId,
	mode,
}: {
	appId: string;
	userId: string;
	mode: 'live' | 'test';
}) {
	const { locale } = useI18n();
	const [params] = useSearchParams();
	const back = new URLSearchParams(params);
	back.delete('view');
	const [paused, setPaused] = useState(false);
	const [clock, setClock] = useState(Date.now());
	const [activeCountry, setActiveCountry] = useState<string | null>(null);
	const [currency, setCurrency] = useState('');
	useEffect(() => {
		const timer = window.setInterval(() => setClock(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	const query = useQuery({
		queryKey: queryKeys.account.storeLiveAnalytics(userId, appId, mode),
		queryFn: ({ signal }) =>
			unwrap(
				apiClient.getLiveStoreAnalytics(appId, mode, signal),
				t("Couldn't load store analytics. Try again in a moment."),
			),
		enabled: !!userId && !paused,
		refetchInterval: paused ? false : 5000,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: 'always',
		staleTime: 0,
		retry: false,
	});
	const data = query.data;
	const state = liveSnapshotState(
		query.dataUpdatedAt,
		clock,
		query.isError,
		paused || query.fetchStatus === 'paused',
	);
	const count = (value: number) =>
		value.toLocaleString(locale, { maximumFractionDigits: 0 });
	const names = useMemo(
		() => new Intl.DisplayNames([locale], { type: 'region' }),
		[locale],
	);
	const countryName = (code: string) =>
		/^[A-Z]{2}$/.test(code) ? (names.of(code) ?? code) : t('Unknown');
	const countries = useMemo(
		() => getVisitCountries(data?.events ?? [], data?.countries ?? []),
		[data],
	);
	const hour = data ? new Date(data.generatedAt).getUTCHours() : 0;
	const sale =
		data?.sales.find((row) => row.currency === currency) ?? data?.sales[0];
	const money = (cents: number) =>
		new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: sale?.currency ?? 'USD',
		}).format(cents / 100);
	const salesHours =
		sale?.hours ??
		Array.from({ length: 24 }, (_, hour) => ({
			hour,
			cents: 0,
			previousCents: 0,
		}));
	const events = (data?.events ?? []).filter(
		(event) => !activeCountry || event.country === activeCountry,
	);
	const lastUpdated = data
		? new Intl.DateTimeFormat(locale, {
				hour: 'numeric',
				minute: '2-digit',
				second: '2-digit',
				timeZone: 'UTC',
			}).format(new Date(data.generatedAt))
		: '';
	return (
		<div className="store-live-analytics">
			<title>{pageTitle(t('Live analytics'))}</title>
			<h1 className="sr-only">{t('Live analytics')}</h1>
			<header className="live-toolbar">
				<Link to={`?${back}`}>
					<CaretLeftIcon size={16} />
					{t('Analytics')}
				</Link>
				<div className="live-toolbar-actions">
					{mode === 'test' && (
						<span className="live-test-label">
							{t('Test data')}
						</span>
					)}
					<span
						className="live-status"
						data-state={state}
						title={t('Updates every 5 seconds · UTC')}
					>
						<i />
						{state === 'live'
							? t('Live')
							: state === 'paused'
								? t('Paused')
								: state === 'error'
									? t('Connection lost')
									: t('Reconnecting…')}
					</span>
					<Button
						size="xs"
						variant="ghost"
						shape="square"
						aria-label={
							paused
								? t('Resume live updates')
								: t('Pause live updates')
						}
						title={
							paused
								? t('Resume live updates')
								: t('Pause live updates')
						}
						onClick={() => setPaused(!paused)}
						icon={
							paused ? (
								<PlayIcon size={15} />
							) : (
								<PauseIcon size={15} />
							)
						}
					/>
					<Button
						size="xs"
						variant="ghost"
						shape="square"
						aria-label={t('Refresh')}
						title={t('Refresh')}
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
						icon={<ArrowClockwiseIcon size={15} />}
					/>
				</div>
			</header>
			{query.isPending ? (
				<div className="live-loading" role="status">
					<Loader />
					{t('Loading storefront analytics…')}
				</div>
			) : !data ? (
				<div className="live-loading" role="alert">
					<p>
						{t(
							"Couldn't load store analytics. Try again in a moment.",
						)}
					</p>
					<Button onClick={() => void query.refetch()}>
						{t('Try again')}
					</Button>
				</div>
			) : (
				<>
					{(state === 'error' || state === 'stale') && (
						<p className="live-connection-note" role="status">
							{t(
								'Showing the last received data. Trying to reconnect…',
							)}
						</p>
					)}
					<div className="live-grid">
						<aside
							className="live-metrics"
							aria-label={t('Today’s metrics')}
						>
							<LiveMetric
								title={t("Today's Sales")}
								value={sale?.todayCents ?? 0}
								previous={sale?.yesterdayCents ?? 0}
								rows={cumulativeHours(
									salesHours.map((row) => ({
										hour: row.hour,
										value: row.cents,
										previous: row.previousCents,
									})),
									hour,
								)}
								format={money}
								control={
									data.sales.length > 1 ? (
										<Select
											aria-label={t('Currency')}
											value={sale?.currency ?? ''}
											onValueChange={(value) =>
												setCurrency(String(value))
											}
										>
											{data.sales.map((row) => (
												<Select.Option
													key={row.currency}
													value={row.currency}
												>
													{row.currency.toUpperCase()}
												</Select.Option>
											))}
										</Select>
									) : undefined
								}
							/>
							<LiveMetric
								title={t("Today's Page Views")}
								value={data.today.pageViews}
								previous={data.yesterday.pageViews}
								delta={
									data.today.pageViews -
									data.yesterday.pageViews
								}
								rows={cumulativeHours(
									data.hours.map((row) => ({
										hour: row.hour,
										value: row.pageViews,
										previous: row.previousPageViews,
									})),
									hour,
								)}
								format={count}
							/>
							<LiveDonut
								title={t('Devices')}
								entries={data.devices}
								total={data.today.visitors}
							/>
							<LiveDonut
								title={t('Top sources')}
								entries={data.sources}
								total={data.today.visitors}
								gray
							/>
						</aside>
						<section
							className="live-globe-stage"
							aria-label={t('Visitor locations')}
						>
							<div className="live-globe-canvas">
								<VisitorGlobeMap
									interactive
									countries={countries}
									activeCountry={activeCountry}
									onSelectCountry={setActiveCountry}
									countryName={countryName}
									count={count}
								/>
							</div>
							<div className="live-globe-caption">
								<span>
									{t('{count} active visitors', {
										count: count(data.activeVisitors),
									})}
								</span>
								<small>
									{t(
										'Last 5 minutes · Approximate country locations',
									)}
								</small>
								<small>
									{t(
										'Drag to rotate · Arrow keys to explore',
									)}
								</small>
							</div>
						</section>
						<aside className="live-feed">
							<div className="live-feed-heading">
								<h2>
									<i
										className="live-event-dot"
										data-state={state}
									/>
									{t('Live events')}
								</h2>
								{activeCountry && (
									<Button
										size="xs"
										variant="ghost"
										aria-label={t('All countries')}
										onClick={() => setActiveCountry(null)}
										icon={<XIcon size={12} />}
									>
										{countryName(activeCountry)}
									</Button>
								)}
							</div>
							<p
								className="live-feed-time"
								title={t('Updates every 5 seconds · UTC')}
							>
								{t('Updated {time} UTC', { time: lastUpdated })}
							</p>
							{events.length ? (
								<ol
									aria-label={t(
										'Recent storefront requests · UTC',
									)}
								>
									{events.map((event) => (
										<li
											key={event.id}
											className="live-event"
										>
											<Button
												variant="ghost"
												onClick={() =>
													setActiveCountry(
														activeCountry ===
															event.country
															? null
															: event.country,
													)
												}
												aria-label={t(
													'Show visits from {country}',
													{
														country: countryName(
															event.country,
														),
													},
												)}
											>
												<span className="live-event-icon">
													<GlobeHemisphereWestIcon
														size={13}
													/>
												</span>
												<span className="live-event-detail">
													<strong>
														{t('Page view')}
													</strong>
													<span>
														{countryName(
															event.country,
														)}{' '}
														·{' '}
														{event.device ===
														'mobile'
															? t('Mobile')
															: event.device ===
																  'tablet'
																? t('Tablet')
																: t('Desktop')}
													</span>
													<small title={event.path}>
														{event.path}
													</small>
												</span>
												<time
													dateTime={event.createdAt}
												>
													{new Intl.DateTimeFormat(
														locale,
														{
															hour: 'numeric',
															minute: '2-digit',
															timeZone: 'UTC',
														},
													).format(
														new Date(
															event.createdAt,
														),
													)}
												</time>
											</Button>
										</li>
									))}
								</ol>
							) : (
								<p className="live-waiting">
									{t('Waiting for visitors…')}
								</p>
							)}
							{data.hasMoreEvents && (
								<small className="live-muted">
									{t('Showing the latest 50 events.')}
								</small>
							)}
							<span className="sr-only" role="status">
								{t('{count} recent events', {
									count: count(events.length),
								})}
							</span>
						</aside>
					</div>
				</>
			)}
		</div>
	);
}
