import { useLayoutEffect, useRef, useState } from 'react';
import { REDUCED_MOTION_QUERY } from '@/lib/motion';
import { canGrow, GROW_TRACK_EXTRA, growLayout, growProgress, type GrowGeometry } from '@/lib/scroll-grow';

export interface ScrollGrowSizes {
	track: number;
	stage: number;
}

/** The nearest ancestor that scrolls: the public pages scroll their own frame, not the document. */
function scrollParent(element: HTMLElement): HTMLElement {
	for (let node = element.parentElement; node; node = node.parentElement) {
		if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
	}
	return document.documentElement;
}

/**
 * Pins the stage under the top bar and, as the page scrolls, grows the panel and the window on it until
 * they fill the stage. `sizes` is null while the demo stays still: for reduced motion, or a window too
 * short to show the whole card.
 */
export function useScrollGrow() {
	const trackRef = useRef<HTMLDivElement>(null);
	const stageRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const frameRef = useRef<HTMLDivElement>(null);
	const [sizes, setSizes] = useState<ScrollGrowSizes | null>(null);

	useLayoutEffect(() => {
		const track = trackRef.current;
		const stage = stageRef.current;
		const panel = panelRef.current;
		const card = cardRef.current;
		const frame = frameRef.current;
		if (!track || !stage || !panel || !card || !frame) return;
		const scroller = scrollParent(stage);
		const scrollsDocument = scroller === document.documentElement;
		const motion = window.matchMedia(REDUCED_MOTION_QUERY);
		let geometry: GrowGeometry | null = null;
		let pinTop = 0;
		let growing = false;
		let lastProgress = -1;
		let frameRequest = 0;

		// Sizes are written straight to the elements: a render per scroll frame would be too slow.
		const apply = () => {
			frameRequest = 0;
			if (!geometry) return;
			const viewportTop = scrollsDocument ? 0 : scroller.getBoundingClientRect().top;
			const progress = growing ? growProgress(track.getBoundingClientRect().top - viewportTop, pinTop, geometry.stageHeight) : 0;
			if (progress === lastProgress) return;
			lastProgress = progress;
			const layout = growLayout(progress, geometry);
			panel.style.width = `${layout.panelWidth}px`;
			panel.style.height = `${layout.panelHeight}px`;
			panel.style.borderRadius = `${layout.panelRadius}px`;
			frame.style.transform = progress > 0 ? `translateY(${layout.frameShift}px) scale(${layout.frameScale})` : '';
		};
		const schedule = () => {
			if (!frameRequest) frameRequest = requestAnimationFrame(apply);
		};
		const measure = () => {
			pinTop = parseFloat(getComputedStyle(stage).top) || 0;
			geometry = {
				stageWidth: stage.clientWidth,
				stageHeight: scroller.clientHeight - pinTop,
				cardWidth: card.offsetWidth,
				cardHeight: card.offsetHeight,
				frameWidth: frame.offsetWidth,
				frameHeight: frame.offsetHeight,
			};
			growing = !motion.matches && canGrow(geometry);
			const next = growing ? { track: geometry.stageHeight * (1 + GROW_TRACK_EXTRA), stage: geometry.stageHeight } : null;
			setSizes((current) => (current?.track === next?.track && current?.stage === next?.stage ? current : next));
			lastProgress = -1;
			apply();
		};

		const resize = new ResizeObserver(measure);
		resize.observe(card);
		resize.observe(scroller);
		const scrollTarget: HTMLElement | Window = scrollsDocument ? window : scroller;
		scrollTarget.addEventListener('scroll', schedule, { passive: true });
		motion.addEventListener('change', measure);
		measure();
		return () => {
			resize.disconnect();
			scrollTarget.removeEventListener('scroll', schedule);
			motion.removeEventListener('change', measure);
			cancelAnimationFrame(frameRequest);
		};
	}, []);

	return { refs: { track: trackRef, stage: stageRef, panel: panelRef, card: cardRef, frame: frameRef }, sizes };
}
