import { useLayoutEffect, useRef, useState } from 'react';

/**
 * The zoom that fits a picture drawn `designWidth` wide into its container, at most `max`, so it scales
 * like an image instead of reflowing. Measured before paint and again on every resize.
 */
export function useFitZoom<T extends HTMLElement>(designWidth: number, max = 1.15) {
	const ref = useRef<T>(null);
	const [zoom, setZoom] = useState(1);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const fit = () => {
			const width = element.clientWidth - parseFloat(getComputedStyle(element).paddingLeft) - parseFloat(getComputedStyle(element).paddingRight);
			if (width > 0) setZoom(Math.min(max, width / designWidth));
		};
		const observer = new ResizeObserver(fit);
		observer.observe(element);
		fit();
		return () => observer.disconnect();
	}, [designWidth, max]);

	return [ref, zoom] as const;
}
