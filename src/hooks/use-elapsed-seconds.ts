import { useEffect, useState } from 'react';

/**
 * Whole seconds since `startedAt`, re-rendering once a second; 0 while
 * `startedAt` is null. Computed from the clock rather than counted, so a
 * throttled background tab shows the right time when it returns.
 */
export function useElapsedSeconds(startedAt: number | null): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (startedAt === null) return;
		setNow(Date.now());
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [startedAt]);

	return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}
