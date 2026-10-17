import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * Steps through a looping story while the element is on screen: beat `i` holds for `beats[i]` ms.
 * Off screen it pauses; with reduced motion it shows the last beat, the finished picture.
 * Pass a module-level array so the timer isn't reset on every render.
 */
export function useStory<T extends Element>(beats: readonly number[]) {
	const ref = useRef<T>(null);
	const [reduced] = useState(prefersReducedMotion);
	const [visible, setVisible] = useState(false);
	const [beat, setBeat] = useState(0);

	useEffect(() => {
		const element = ref.current;
		if (!element || reduced) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.35 });
		observer.observe(element);
		return () => observer.disconnect();
	}, [reduced]);

	useEffect(() => {
		if (!visible) return;
		const timer = setTimeout(() => setBeat((current) => (current + 1) % beats.length), beats[beat]);
		return () => clearTimeout(timer);
	}, [visible, beat, beats]);

	return [ref, reduced ? beats.length - 1 : beat] as const;
}
