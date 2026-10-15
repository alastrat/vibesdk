import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Ridges across the edge, each starting where the face's outline crosses its height. */
const RIDGES = Array.from({ length: 9 }, (_, index) => {
	const y = 32 + index * 22;
	return { y, x: 96 + 68 * Math.sqrt(Math.max(0, 1 - ((y - 120) / 102) ** 2)) };
});

/** A credit coin turned slightly, after Apollo's: a blue face with a sparkle over its darker, ridged edge. It floats. Decorative. */
export function Coin({ className }: { className?: string }) {
	const face = useId();
	return (
		<svg aria-hidden viewBox="0 0 200 240" className={cn('animate-public-float', className)}>
			<defs>
				<linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#7fb0ff" />
					<stop offset="1" stopColor="#145fe4" />
				</linearGradient>
			</defs>
			{/* The edge: the back of the coin, the band between, and its ridges. */}
			<ellipse cx="118" cy="120" rx="68" ry="102" fill="#0c3a99" />
			<rect x="96" y="18" width="22" height="204" fill="#0c3a99" />
			{RIDGES.map((ridge) => (
				<path key={ridge.y} d={`M${ridge.x} ${ridge.y} h20`} stroke="#2c5fd0" strokeWidth="7" strokeLinecap="round" />
			))}
			<ellipse cx="96" cy="120" rx="68" ry="102" fill={`url(#${face})`} stroke="#0b2f7a" strokeWidth="3" />
			<ellipse cx="96" cy="120" rx="52" ry="82" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" />
			{/* The sparkle: a four-pointed star. */}
			<path d="M96 76 C99 104 106 112 128 120 C106 128 99 136 96 164 C93 136 86 128 64 120 C86 112 93 104 96 76 Z" fill="#ffffff" />
		</svg>
	);
}
