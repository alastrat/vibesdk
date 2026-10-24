import { useState } from 'react';
import { ParentSize } from '@visx/responsive';
import { scaleLinear } from '@visx/scale';
import { LinePath } from '@visx/shape';
import { curveLinear } from '@visx/curve';
import { t, useI18n } from '@/lib/i18n';
import type { LiveHour } from './live-analytics-utils';

export function LiveHourlyChart({
	rows,
	label,
	format,
}: {
	rows: LiveHour[];
	label: string;
	format: (value: number) => string;
}) {
	const { locale } = useI18n();
	const [selected, setSelected] = useState<number | null>(null);
	const empty = !rows.some((row) => row.value || row.previous);
	const hourLabel = (hour: number) =>
		new Intl.DateTimeFormat(locale, {
			hour: 'numeric',
			timeZone: 'UTC',
		}).format(new Date(Date.UTC(2026, 0, 1, hour)));
	return (
		<div className={`live-hourly${empty ? ' is-empty' : ''}`}>
			<ParentSize
				initialSize={{ width: 390, height: 142 }}
				ignoreDimensions={['height']}
				debounceTime={30}
			>
				{({ width }) => {
					const bottom = 114;
					const y = scaleLinear({
						domain: [
							0,
							Math.max(
								1,
								...rows.flatMap((row) => [
									row.value,
									row.previous,
								]),
							),
						],
						range: [bottom, 12],
						nice: true,
					});
					const tickValues = [0, 0.5, 1].map(
						(fraction) => y.domain()[1] * fraction,
					);
					const tickLabels = tickValues.map((value) =>
						empty ? '' : format(value),
					);
					// Reserve space for localized currency labels; anchor them inside the SVG.
					const axisWidth = Math.max(
						32,
						...tickLabels.map((text) => text.length * 6 + 12),
					);
					const right = Math.max(40, width - axisWidth);
					const x = scaleLinear({
						domain: [0, 23],
						range: [0, right],
					});
					const active =
						rows[
							Math.max(
								0,
								Math.min(
									selected ?? rows.length - 1,
									rows.length - 1,
								),
							)
						];
					return (
						<div
							className="live-hourly-plot"
							role="slider"
							tabIndex={0}
							aria-label={`${label} · UTC`}
							aria-valuemin={0}
							aria-valuemax={Math.max(0, rows.length - 1)}
							aria-valuenow={active?.hour ?? 0}
							aria-valuetext={
								active
									? `${hourLabel(active.hour)} UTC: ${format(active.value)}; ${t('Yesterday')}: ${format(active.previous)}`
									: t('No data available')
							}
							onPointerMove={(e) => {
								const rect =
									e.currentTarget.getBoundingClientRect();
								setSelected(
									Math.max(
										0,
										Math.min(
											rows.length - 1,
											Math.round(
												x.invert(e.clientX - rect.left),
											),
										),
									),
								);
							}}
							onPointerLeave={() => setSelected(null)}
							onBlur={() => setSelected(null)}
							onFocus={() => setSelected(rows.length - 1)}
							onKeyDown={(e) => {
								if (
									[
										'ArrowLeft',
										'ArrowRight',
										'Home',
										'End',
										'Escape',
									].includes(e.key)
								) {
									e.preventDefault();
									setSelected(
										e.key === 'Escape'
											? null
											: e.key === 'Home'
												? 0
												: e.key === 'End'
													? rows.length - 1
													: Math.max(
															0,
															Math.min(
																rows.length - 1,
																(selected ??
																	rows.length -
																		1) +
																	(e.key ===
																	'ArrowLeft'
																		? -1
																		: 1),
															),
														),
									);
								}
							}}
						>
							<svg width={width} height={142} aria-hidden="true">
								{tickValues.map((value, index) => {
									return (
										<g key={value}>
											<line
												x1={0}
												x2={right}
												y1={y(value)}
												y2={y(value)}
												stroke="#e7e8eb"
												strokeDasharray="1 4"
											/>
											<text
												x={width - 2}
												textAnchor="end"
												y={y(value) + 3}
												className="live-chart-axis"
											>
												{tickLabels.indexOf(
													tickLabels[index],
												) === index
													? tickLabels[index]
													: ''}
											</text>
										</g>
									);
								})}
								{!empty && (
									<>
										<LinePath
											data={rows}
											x={(row) => x(row.hour)}
											y={(row) => y(row.previous)}
											curve={curveLinear}
											stroke="#a6c2ff"
											strokeWidth={1.4}
											strokeDasharray="3 5"
										/>
										<LinePath
											data={rows}
											x={(row) => x(row.hour)}
											y={(row) => y(row.value)}
											curve={curveLinear}
											stroke="#1955e6"
											strokeWidth={1.7}
										/>
										{active && (
											<>
												<circle
													cx={x(active.hour)}
													cy={y(active.value)}
													r={8}
													fill="#1955e633"
												/>
												<circle
													cx={x(active.hour)}
													cy={y(active.value)}
													r={3.7}
													fill="#1955e6"
												/>
											</>
										)}
									</>
								)}
								{(right < 330
									? [0, 8, 16, 23]
									: [0, 5, 10, 15, 20, 23]
								).map((h) => (
									<text
										key={h}
										x={x(h)}
										y={136}
										textAnchor={
											h === 0
												? 'start'
												: h === 23
													? 'end'
													: 'middle'
										}
										className="live-chart-axis"
									>
										{hourLabel(h)}
									</text>
								))}
							</svg>
							{empty && (
								<span className="live-chart-empty">
									{t('No data available')}
								</span>
							)}
							{selected !== null && active && (
								<div className="live-chart-tooltip">
									<b>{hourLabel(active.hour)} UTC</b>
									<span>
										{t('Today')} {format(active.value)}
									</span>
									<span>
										{t('Yesterday')}{' '}
										{format(active.previous)}
									</span>
								</div>
							)}
						</div>
					);
				}}
			</ParentSize>
		</div>
	);
}
