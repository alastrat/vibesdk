import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type RefObject,
} from 'react';
import { Button, Dialog } from '@cloudflare/kumo';
import { ArrowsOutSimpleIcon, XIcon } from '@phosphor-icons/react';
import type { StoreTrafficBreakdown, StoreTrafficEvent } from '@/api-types';
import landPoints from '@/components/public-site/globe/land-points.json';
import { toVector } from '@/components/public-site/globe/renderer';
import { t, useI18n } from '@/lib/i18n';
import { INTL_LOCALE } from 'shared/i18n/locales';
import {
	countryCode,
	getVisitCountries,
	projector,
	type Camera,
	type VisitCountry,
} from './visit-globe-utils';
import './visit-globe.css';

export type VisitGlobeProps = {
	events: StoreTrafficEvent[];
	countries: StoreTrafficBreakdown[];
	activeCountry?: string | null;
	onSelectCountry: (code: string | null) => void;
};
type MappedCountry = VisitCountry & Camera;

const LAND = landPoints
	.filter((_, index) => index % 2 === 0)
	.map(([latitude, longitude]) => toVector(latitude, longitude));
const isMapped = (country: VisitCountry): country is MappedCountry =>
	country.latitude !== undefined && country.longitude !== undefined;
const coordinate = (value: number) => Number(value.toFixed(2));

function useMapMotion(ref: RefObject<HTMLDivElement | null>) {
	const [enabled, setEnabled] = useState(false);
	useEffect(() => {
		if (!ref.current || typeof window === 'undefined') return;
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		let inView = true;
		const update = () =>
			setEnabled(
				inView &&
					document.visibilityState !== 'hidden' &&
					!media.matches,
			);
		const observer =
			typeof IntersectionObserver === 'undefined'
				? null
				: new IntersectionObserver(([entry]) => {
						inView = entry.isIntersecting;
						update();
					});
		observer?.observe(ref.current);
		media.addEventListener('change', update);
		document.addEventListener('visibilitychange', update);
		update();
		return () => {
			observer?.disconnect();
			media.removeEventListener('change', update);
			document.removeEventListener('visibilitychange', update);
		};
	}, [ref]);
	return enabled;
}

function useCamera(target: Camera, animate: boolean) {
	const [camera, setCamera] = useState<Camera>(target);
	const current = useRef(camera);
	useEffect(() => {
		const destination = {
			latitude: target.latitude,
			longitude: target.longitude,
		};
		const from = current.current;
		if (
			from.latitude === destination.latitude &&
			from.longitude === destination.longitude
		)
			return;
		if (!animate) {
			current.current = destination;
			setCamera(destination);
			return;
		}
		const longitudeDelta =
			((destination.longitude - from.longitude + 540) % 360) - 180;
		const started = performance.now();
		let frame = 0;
		let lastPaint = 0;
		const tick = (now: number) => {
			const progress = Math.min(1, (now - started) / 1100);
			if (now - lastPaint >= 32 || progress === 1) {
				const eased = progress * progress * (3 - 2 * progress);
				current.current =
					progress === 1
						? destination
						: {
								latitude:
									from.latitude +
									(destination.latitude - from.latitude) *
										eased,
								longitude:
									from.longitude + longitudeDelta * eased,
							};
				setCamera(current.current);
				lastPaint = now;
			}
			if (progress < 1) frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [target.latitude, target.longitude, animate]);
	return camera;
}

type GlobeMapProps = {
	countries: VisitCountry[];
	activeCountry: string | null;
	onSelectCountry: VisitGlobeProps['onSelectCountry'];
	countryName: (code: string) => string;
	count: (value: number) => string;
	paused?: boolean;
};

function GlobeMap({
	countries,
	activeCountry,
	onSelectCountry,
	countryName,
	count,
	paused = false,
}: GlobeMapProps) {
	const id = useId().replace(/:/g, '');
	const ref = useRef<HTMLDivElement>(null);
	const visibleMotion = useMapMotion(ref);
	const animate = visibleMotion && !paused;
	const [interacting, setInteracting] = useState(false);
	const [cycle, setCycle] = useState(0);
	const mapped = useMemo(() => countries.filter(isMapped), [countries]);
	const codes = mapped.map((country) => country.code).join(',');
	useEffect(() => setCycle(0), [codes]);
	useEffect(() => {
		if (!animate || interacting || activeCountry || mapped.length < 2)
			return;
		const timer = window.setInterval(
			() => setCycle((value) => (value + 1) % mapped.length),
			5000,
		);
		return () => window.clearInterval(timer);
	}, [animate, interacting, activeCountry, mapped.length, codes]);
	const target = mapped.find((country) => country.code === activeCountry) ??
		mapped[cycle % mapped.length] ?? { latitude: 12, longitude: -70 };
	const camera = useCamera(target, animate);
	const project = useMemo(() => projector(camera), [camera]);
	const land = useMemo(() => {
		const near: string[] = [],
			edge: string[] = [];
		for (const point of LAND) {
			const p = project(point);
			if (p.depth <= 0) continue;
			(p.depth > 0.45 ? near : edge).push(
				`M${coordinate(180 + p.x * 154)} ${coordinate(180 + p.y * 154)}h.01`,
			);
		}
		return { near: near.join(''), edge: edge.join('') };
	}, [project]);
	return (
		<div
			ref={ref}
			className="visit-globe-map"
			data-animating={animate}
			onMouseEnter={() => setInteracting(true)}
			onMouseLeave={() => setInteracting(false)}
			onFocusCapture={() => setInteracting(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setInteracting(false);
			}}
		>
			<svg
				viewBox="0 0 360 360"
				role="group"
				aria-label={t('Visitor locations')}
			>
				<defs>
					<radialGradient
						id={`${id}-sphere`}
						cx="32%"
						cy="28%"
						r="72%"
					>
						<stop offset="0" stopColor="#fafbfc" />
						<stop offset="0.7" stopColor="#f0f1f3" />
						<stop offset="1" stopColor="#e2e5e8" />
					</radialGradient>
				</defs>
				<circle
					cx="180"
					cy="180"
					r="154"
					fill={`url(#${id}-sphere)`}
					stroke="#e2e5e8"
					strokeWidth="0.6"
				/>
				<path
					d={land.edge}
					fill="none"
					stroke="#9da7b0"
					strokeWidth="2.4"
					strokeLinecap="round"
				/>
				<path
					d={land.near}
					fill="none"
					stroke="#788792"
					strokeWidth="2.4"
					strokeLinecap="round"
				/>
				{mapped.map((country) => {
					const point = project(
						toVector(country.latitude, country.longitude),
					);
					if (point.depth <= 0.06) return null;
					const selected = country.code === activeCountry;
					const select = () =>
						onSelectCountry(selected ? null : country.code);
					const label = t(
						'{country}: {count} page views. Approximate country location.',
						{
							country: countryName(country.code),
							count: count(country.views),
						},
					);
					return (
						<g
							key={country.code}
							data-country={country.code}
							className={`visit-globe-marker${selected ? ' is-selected' : ''}`}
							transform={`translate(${coordinate(180 + point.x * 154)} ${coordinate(180 + point.y * 154)})`}
							role="button"
							tabIndex={0}
							aria-label={label}
							aria-pressed={selected}
							onClick={select}
							onKeyDown={(event) => {
								if (
									event.key === 'Enter' ||
									event.key === ' '
								) {
									event.preventDefault();
									select();
								}
							}}
						>
							<title>{label}</title>
							<circle r="18" fill="transparent" />
							<circle className="visit-globe-pulse" r="10" />
							<circle className="visit-globe-marker-ring" r="7" />
							<circle
								className="visit-globe-marker-dot"
								r={selected ? 5.6 : 4.5}
							/>
						</g>
					);
				})}
			</svg>
		</div>
	);
}

export function VisitGlobe({
	events,
	countries,
	activeCountry = null,
	onSelectCountry,
}: VisitGlobeProps) {
	const { locale } = useI18n();
	const [open, setOpen] = useState(false);
	const observed = useMemo(
		() => getVisitCountries(events, countries),
		[events, countries],
	);
	const names = useMemo(
		() => new Intl.DisplayNames([INTL_LOCALE[locale]], { type: 'region' }),
		[locale],
	);
	const countryName = (code: string) => names.of(code) ?? code;
	const count = (value: number) =>
		value.toLocaleString(INTL_LOCALE[locale], { maximumFractionDigits: 0 });
	const selection = activeCountry ? countryCode(activeCountry) : null;
	const mapProps = {
		countries: observed,
		activeCountry: selection,
		onSelectCountry,
		countryName,
		count,
	};
	return (
		<div className="visit-globe">
			<GlobeMap {...mapProps} paused={open} />
			<Dialog.Root open={open} onOpenChange={setOpen}>
				<Dialog.Trigger
					render={(props) => (
						<Button
							{...props}
							size="xs"
							variant="ghost"
							shape="square"
							className="visit-globe-expand"
							aria-label={t('Explore visitor locations')}
							icon={
								<span title={t('Explore visitor locations')}>
									<ArrowsOutSimpleIcon size={14} />
								</span>
							}
						/>
					)}
				/>
				<Dialog size="lg" className="visit-globe-dialog">
					<div className="visit-globe-dialog-heading">
						<Dialog.Title>{t('Visitor locations')}</Dialog.Title>
						<Dialog.Close
							render={(props) => (
								<Button
									{...props}
									size="sm"
									variant="ghost"
									shape="square"
									aria-label={t('Close')}
									icon={<XIcon size={16} />}
								/>
							)}
						/>
					</div>
					<Dialog.Description className="visit-globe-description">
						{t(
							'Approximate country locations from recorded storefront requests.',
						)}
					</Dialog.Description>
					<GlobeMap {...mapProps} />
					<div
						className="visit-globe-country-list"
						role="group"
						aria-label={t('Countries')}
					>
						<Button
							size="sm"
							variant={!selection ? 'secondary' : 'ghost'}
							aria-pressed={!selection}
							onClick={() => onSelectCountry(null)}
						>
							{t('All countries')}
						</Button>
						{observed.map((country) => (
							<Button
								key={country.code}
								size="sm"
								variant={
									selection === country.code
										? 'secondary'
										: 'ghost'
								}
								aria-pressed={selection === country.code}
								onClick={() =>
									onSelectCountry(
										selection === country.code
											? null
											: country.code,
									)
								}
							>
								<span>{countryName(country.code)}</span>
								<span className="visit-globe-country-count">
									{t('{count} page views', {
										count: count(country.views),
									})}
									{!isMapped(country) &&
										` · ${t('Map location unavailable')}`}
								</span>
							</Button>
						))}
					</div>
					{!observed.length && (
						<p className="visit-globe-description">
							{t('No traffic recorded in this period.')}
						</p>
					)}
				</Dialog>
			</Dialog.Root>
			{selection && (
				<Button
					size="xs"
					variant="ghost"
					className="visit-globe-reset"
					aria-label={t('All countries')}
					onClick={() => onSelectCountry(null)}
					icon={<XIcon size={10} />}
				>
					{countryName(selection)}
				</Button>
			)}
		</div>
	);
}
