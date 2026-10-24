import { t } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Cycles through words in place, each rising in. Every word sits in the same grid cell, so the longest one holds
 * the space and nothing around it moves. Reduced motion keeps the first word. Visual only: give screen readers
 * the sentence separately.
 */
export function RotatingWord({ words, intervalMs = 2200, className }: { words: readonly string[]; intervalMs?: number; className?: string }) {
	const [reduced] = useState(prefersReducedMotion);
	const [shown, setShown] = useState(0);

	useEffect(() => {
		if (reduced) return;
		const timer = setInterval(() => setShown((current) => (current + 1) % words.length), intervalMs);
		return () => clearInterval(timer);
	}, [reduced, words.length, intervalMs]);

	return (
		<span aria-hidden className={cn('inline-grid', className)}>
			{words.map((word, index) => (
				<span key={word} className={cn('col-start-1 row-start-1', index === shown ? 'animate-public-rise' : 'invisible')}>
					{t(word)}
				</span>
			))}
		</span>
	);
}
