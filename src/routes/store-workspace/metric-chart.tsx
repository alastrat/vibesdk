import {
	useId,
	useMemo,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
} from 'react';
import { curveLinear } from '@visx/curve';
import { ParentSize } from '@visx/responsive';
import { scaleLinear, scaleUtc } from '@visx/scale';
import { AreaClosed, LinePath } from '@visx/shape';
import { t, useI18n } from '@/lib/i18n';
import './metric-chart.css';

export type MetricPoint = { date: string; value: number };
export type MetricChartProps = {
	points: MetricPoint[];
	previous?: MetricPoint[];
	formatValue: (value: number) => string;
	label: string;
	color?: string;
	compact?: boolean;
	height?: number;
};

type TimedPoint = MetricPoint & { time: number };
type ChartPoint = TimedPoint & { previous?: TimedPoint };
const DAY = 86_400_000;

function dailyPoints(points: MetricPoint[]): TimedPoint[] {
	const days = new Map<number, TimedPoint>();
	for (const point of points) {
		const time = Date.parse(`${point.date}T00:00:00Z`);
		if (
			!Number.isFinite(time) ||
			!Number.isFinite(point.value) ||
			new Date(time).toISOString().slice(0, 10) !== point.date
		)
			continue;
		days.set(time, { ...point, time });
	}
	return [...days.values()].sort((a, b) => a.time - b.time);
}

/** Daily UTC observations. Previous points are aligned by day offset, not by calendar date. */
export function MetricChart({
	points,
	previous,
	formatValue,
	label,
	color,
	compact = false,
	height: chartHeight,
}: MetricChartProps) {
	const rows = useMemo(() => {
		const current = dailyPoints(points);
		const prior = dailyPoints(previous ?? []);
		const priorByTime = new Map(prior.map((point) => [point.time, point]));
		return current.map(
			(point): ChartPoint => ({
				...point,
				previous: prior[0]
					? priorByTime.get(
							prior[0].time + point.time - current[0].time,
						)
					: undefined,
			}),
		);
	}, [points, previous]);
	useI18n();
	if (!rows.length)
		return (
			<div
				className="es-metric-chart-empty"
				role="img"
				aria-label={`${label}: ${t('No data for this period.')}`}
			>
				{t('No data for this period.')}
			</div>
		);
	const height = chartHeight ?? (compact ? 144 : 210);
	return (
		<div
			className={`es-metric-chart${compact ? ' es-metric-chart--compact' : ''}`}
			style={
				{
					height,
					...(color ? { '--metric-color': color } : {}),
				} as CSSProperties
			}
		>
			<ParentSize
				debounceTime={30}
				initialSize={{ width: 320, height }}
				ignoreDimensions={['height']}
			>
				{({ width }) => (
					<MetricPlot
						rows={rows}
						width={Math.max(width, 1)}
						height={height}
						compact={compact}
						label={label}
						formatValue={formatValue}
					/>
				)}
			</ParentSize>
		</div>
	);
}

function MetricPlot({
	rows,
	width,
	height,
	compact,
	label,
	formatValue,
}: {
	rows: ChartPoint[];
	width: number;
	height: number;
	compact: boolean;
	label: string;
	formatValue: MetricChartProps['formatValue'];
}) {
	const { locale } = useI18n();
	const id = useId().replace(/:/g, '');
	const [selected, setSelected] = useState<number | null>(null);
	const [focused, setFocused] = useState(false);
	const index = Math.max(
		0,
		Math.min(selected ?? rows.length - 1, rows.length - 1),
	);
	const active = rows[index];
	const visible = selected !== null;
	const fullDate = new Intl.DateTimeFormat(locale, {
		month: 'short',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC',
	});
	const shortDate = new Intl.DateTimeFormat(locale, {
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	});
	const values = rows.flatMap((point) =>
		point.previous ? [point.value, point.previous.value] : [point.value],
	);
	const min = Math.min(0, ...values);
	const max = Math.max(0, ...values);
	const top = 12;
	const bottom = height - (compact ? 8 : 30);
	const y = scaleLinear({
		domain: min === max ? [0, 1] : [min, max],
		range: [bottom, top],
		nice: true,
	});
	// Integer observations must never label a fractional tick as a whole visit/order.
	const integerValues = values.every(Number.isInteger);
	// Avoid duplicate labels for other compact formatters.
	const ticks = y
		.ticks(4)
		.filter((value) => !integerValues || Number.isInteger(value))
		.filter(
			(value, position, all) =>
				position === 0 ||
				formatValue(value) !== formatValue(all[position - 1]),
		);
	const labelWidth = compact
		? 8
		: Math.min(
				100,
				Math.max(
					48,
					...ticks.map((value) => formatValue(value).length * 6 + 14),
				),
			);
	const left = 8;
	const right = Math.max(left + 1, width - labelWidth);
	const first = rows[0].time;
	const last = rows[rows.length - 1].time;
	const x = scaleUtc({
		domain:
			first === last
				? [new Date(first - DAY / 2), new Date(last + DAY / 2)]
				: [new Date(first), new Date(last)],
		range: [left, right],
	});
	const dateCount = Math.min(
		rows.length,
		Math.max(2, Math.floor((right - left) / 100)),
	);
	const dateTicks = Array.from(
		new Set(
			Array.from({ length: dateCount }, (_, position) =>
				Math.round(
					(position * (rows.length - 1)) / Math.max(1, dateCount - 1),
				),
			),
		),
	);
	const activeText = `${fullDate.format(active.time)} UTC: ${formatValue(active.value)}${active.previous ? `; ${t('Previous period')}, ${fullDate.format(active.previous.time)} UTC: ${formatValue(active.previous.value)}` : ''}`;
	const xOf = (point: ChartPoint) => x(point.time);
	const yOf = (point: ChartPoint) => y(point.value);

	function inspectPointer(event: PointerEvent<HTMLDivElement>) {
		const rect = event.currentTarget.getBoundingClientRect();
		const time = x
			.invert(
				((event.clientX - rect.left) * width) / Math.max(1, rect.width),
			)
			.getTime();
		let nearest = 0;
		for (let candidate = 1; candidate < rows.length; candidate++) {
			if (
				Math.abs(rows[candidate].time - time) <
				Math.abs(rows[nearest].time - time)
			)
				nearest = candidate;
		}
		setSelected(nearest);
	}

	function inspectKeyboard(event: KeyboardEvent<HTMLDivElement>) {
		let next: number;
		switch (event.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				next = index - 1;
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				next = index + 1;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = rows.length - 1;
				break;
			case 'Escape':
				setSelected(null);
				return;
			default:
				return;
		}
		event.preventDefault();
		setSelected(Math.max(0, Math.min(next, rows.length - 1)));
	}

	return (
		<div
			className="es-metric-plot"
			role="slider"
			tabIndex={0}
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={rows.length - 1}
			aria-valuenow={index}
			aria-valuetext={activeText}
			aria-describedby={`${id}-help`}
			onFocus={() => {
				setFocused(true);
				setSelected(index);
			}}
			onBlur={() => {
				setFocused(false);
				setSelected(null);
			}}
			onKeyDown={inspectKeyboard}
			onPointerMove={inspectPointer}
			onPointerDown={inspectPointer}
			onPointerLeave={() => {
				if (!focused) setSelected(null);
			}}
		>
			<span id={`${id}-help`} className="sr-only">
				{t(
					'Use Left and Right arrow keys to explore daily values. Dates are in UTC.',
				)}
			</span>
			<svg
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				aria-hidden="true"
				focusable="false"
			>
				<defs>
					<linearGradient
						id={`${id}-fill`}
						x1="0"
						y1="0"
						x2="0"
						y2="1"
					>
						<stop
							offset="0%"
							stopColor="var(--metric-color)"
							stopOpacity=".035"
						/>
						<stop
							offset="100%"
							stopColor="var(--metric-color)"
							stopOpacity="0"
						/>
					</linearGradient>
					<clipPath id={`${id}-clip`}>
						<rect
							x={left - 4}
							y={top - 4}
							width={right - left + 8}
							height={bottom - top + 8}
						/>
					</clipPath>
				</defs>
				{!compact &&
					ticks.map((value) => (
						<g key={value}>
							<line
								x1={left}
								x2={right}
								y1={y(value)}
								y2={y(value)}
								className="es-metric-grid"
							/>
							<text
								x={right + 10}
								y={y(value)}
								dy=".32em"
								className="es-metric-axis"
							>
								{formatValue(value)}
							</text>
						</g>
					))}
				<g clipPath={`url(#${id}-clip)`}>
					<AreaClosed
						data={rows}
						x={xOf}
						y={yOf}
						y0={y(0)}
						yScale={y}
						curve={curveLinear}
						fill={`url(#${id}-fill)`}
					/>
					<LinePath
						data={rows}
						x={xOf}
						y={(point) => y(point.previous?.value ?? 0)}
						defined={(point) => point.previous !== undefined}
						curve={curveLinear}
						className="es-metric-previous"
					/>
					<LinePath
						data={rows}
						x={xOf}
						y={yOf}
						curve={curveLinear}
						className="es-metric-line"
					/>
					{rows.length === 1 && !visible && (
						<g>
							{rows[0].previous && (
								<circle
									cx={xOf(rows[0])}
									cy={y(rows[0].previous.value)}
									r={3}
									className="es-metric-prior-dot"
								/>
							)}
							<circle
								cx={xOf(rows[0])}
								cy={yOf(rows[0])}
								r={3}
								fill="var(--metric-color)"
							/>
						</g>
					)}
					{visible && (
						<g>
							<line
								x1={xOf(active)}
								x2={xOf(active)}
								y1={top}
								y2={bottom}
								className="es-metric-guide"
							/>
							{active.previous && (
								<circle
									cx={xOf(active)}
									cy={y(active.previous.value)}
									r={3}
									className="es-metric-prior-dot"
								/>
							)}
							<circle
								cx={xOf(active)}
								cy={yOf(active)}
								r={4}
								className="es-metric-dot"
							/>
						</g>
					)}
				</g>
				{!compact &&
					dateTicks.map((position, tick) => (
						<text
							key={position}
							x={xOf(rows[position])}
							y={height - 7}
							textAnchor={
								dateTicks.length === 1
									? 'middle'
									: tick === 0
										? 'start'
										: tick === dateTicks.length - 1
											? 'end'
											: 'middle'
							}
							className="es-metric-axis"
						>
							{shortDate.format(rows[position].time)}
						</text>
					))}
			</svg>
			{visible && (
				<div
					className="es-metric-tooltip"
					aria-hidden="true"
					style={{
						left: Math.max(
							4,
							Math.min(
								xOf(active) + 12,
								width - Math.min(224, width - 8) - 4,
							),
						),
					}}
				>
					<div>
						{fullDate.format(active.time)} <span>UTC</span>
					</div>
					<p>
						<span className="es-metric-tooltip-label">{label}</span>
						<strong>{formatValue(active.value)}</strong>
					</p>
					{active.previous && (
						<>
							<div className="es-metric-tooltip-prior">
								{t('Previous period')} ·{' '}
								{fullDate.format(active.previous.time)}
							</div>
							<p>
								<span>{label}</span>
								<strong>
									{formatValue(active.previous.value)}
								</strong>
							</p>
						</>
					)}
				</div>
			)}
		</div>
	);
}
