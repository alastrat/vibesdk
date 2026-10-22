import { useEffect, useState } from 'react';

/** Manual selection holds its market until playback is explicitly resumed. */
export function useMarketRotation(count: number, enabled: boolean) {
	const [active, setActive] = useState(0);
	const [paused, setPaused] = useState(false);
	const playing = enabled && !paused;
	useEffect(() => {
		if (!playing || count < 2) return;
		const timer = setInterval(() => setActive((index) => (index + 1) % count), 6500);
		return () => clearInterval(timer);
	}, [playing, count]);
	return {
		active,
		paused,
		playing,
		select: (index: number) => {
			setActive(index);
			setPaused(true);
		},
		toggle: () => setPaused((value) => !value),
	};
}
