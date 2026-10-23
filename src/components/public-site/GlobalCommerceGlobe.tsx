import { useI18n } from '@/lib/i18n';
import { useEffect, useRef } from 'react';
import { GLOBAL_MARKETS } from './globe/markets';
import { marketingCopy } from '@/content/marketing-copy';
import { createGlobeRenderer } from './globe/renderer';

/** Canvas is decorative. All market names and examples also have ordinary HTML controls. */
export function GlobalCommerceGlobe({ active, playing, visible, reducedMotion }: {
	active: number;
	playing: boolean;
	visible: boolean;
	reducedMotion: boolean;
}) {
	const { t } = useI18n();
	const canvas = useRef<HTMLCanvasElement>(null);
	const pose = useRef({ longitude: GLOBAL_MARKETS[0].longitude + 18, latitude: GLOBAL_MARKETS[0].latitude + 6 });
	const elapsed = useRef(0);
	const started = useRef(false);
	const previousMarket = useRef(active);
	const settling = useRef(false);
	const transition = useRef({ from: active, progress: 1 });
	useEffect(() => {
		const element = canvas.current;
		if (!element || (!visible && !started.current)) return;
		started.current = true;
		let cancelled = false;
		let frame = 0;
		let resize: ResizeObserver | undefined;
		void Promise.all([import('./globe/land-points.json'), import('./globe/country-points.json')])
			.then(([{ default: points }, { default: countries }]) => {
				if (cancelled) return;
				const draw = createGlobeRenderer(element, points, GLOBAL_MARKETS.map((market) => ({ ...market, label: t(market.label) })), countries);
				if (!draw) return;
				const target = { longitude: GLOBAL_MARKETS[active].longitude + 18, latitude: GLOBAL_MARKETS[active].latitude + 6 };
				const changed = previousMarket.current !== active;
				if (changed) {
					transition.current = { from: previousMarket.current, progress: 0 };
					settling.current = !playing;
				}
				previousMarket.current = active;
				if (reducedMotion) {
					pose.current = target;
					transition.current.progress = 1;
					settling.current = false;
				}
				let lastTime = performance.now();
				const render = () => draw(pose.current.longitude, active, elapsed.current, pose.current.latitude, transition.current.from, transition.current.progress);
				const paint = (time: number) => {
					const delta = Math.min(time - lastTime, 80);
					let moving = true;
					if (delta >= 30) {
						lastTime = time;
						elapsed.current += delta;
						// A gentle orbit continues between markets. Both axes ease toward each country
						// so southern markets stay in view instead of sitting behind the product card.
						const drift = playing ? Math.sin(elapsed.current / 8000) * 7 : 0;
						const distance = ((target.longitude + drift - pose.current.longitude + 540) % 360) - 180;
						const latitudeDistance = target.latitude - pose.current.latitude;
						const ease = 1 - Math.exp(-delta / 650);
						pose.current.longitude += distance * ease;
						pose.current.latitude += latitudeDistance * ease;
						transition.current.progress = Math.min(1, transition.current.progress + delta / 1400);
						moving = Math.abs(distance) > 0.1 || Math.abs(latitudeDistance) > 0.1 || transition.current.progress < 1;
						if (!moving) settling.current = false;
						render();
					}
					if (!cancelled && (playing || moving)) frame = requestAnimationFrame(paint);
				};
				render();
				resize = new ResizeObserver(render);
				resize.observe(element);
				if (visible && !reducedMotion && (playing || settling.current)) frame = requestAnimationFrame(paint);
			})
			.catch(() => {
				/* The CSS globe silhouette remains if the optional illustration cannot load. */
			});
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
			resize?.disconnect();
		};
	}, [active, playing, visible, reducedMotion, t]);
	return (
		<div role="img" aria-label={t(marketingCopy.home.globalCommerce.globeLabel)} className="global-commerce-globe">
			<div className="global-commerce-sphere" aria-hidden="true" />
			<canvas ref={canvas} aria-hidden="true" className="relative block aspect-square w-full" />
		</div>
	);
}
