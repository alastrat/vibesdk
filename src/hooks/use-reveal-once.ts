import { useEffect, useRef, useState } from 'react';

/** True from the moment the element's top passes 80% of the viewport; it stays true, so the reveal plays once. */
export function useRevealOnce<T extends Element>() {
	const ref = useRef<T>(null);
	const [revealed, setRevealed] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element || revealed) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				setRevealed(true);
				observer.disconnect();
			},
			{ rootMargin: '0px 0px -20% 0px' },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [revealed]);

	return [ref, revealed] as const;
}
