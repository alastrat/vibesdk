import { useId } from 'react';
import { cn } from '@/lib/utils';

/** Bumps of a cloud: circles over a flat base, all filled with one white-to-blue fade. */
const CLOUD_BUMPS = [
	{ cx: 70, cy: 92, r: 40 },
	{ cx: 128, cy: 64, r: 54 },
	{ cx: 196, cy: 58, r: 62 },
	{ cx: 262, cy: 78, r: 48 },
	{ cx: 310, cy: 98, r: 32 },
] as const;

/** The cloud's white-to-blue fade, in the cloud's own coordinates so every bump shares it and no seams show. */
function CloudFade({ id, edge }: { id: string; edge: string }) {
	return (
		<linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="130">
			<stop offset="0.3" stopColor="#ffffff" />
			<stop offset="1" stopColor={edge} />
		</linearGradient>
	);
}

function CloudShape({ fill }: { fill: string }) {
	return (
		<g fill={fill}>
			{CLOUD_BUMPS.map((bump) => (
				<circle key={bump.cx} {...bump} />
			))}
			<rect x="40" y="88" width="300" height="42" rx="21" />
		</g>
	);
}

/** A soft cloud for the panel's corners; it drifts slowly. */
export function Cloud({ className }: { className?: string }) {
	const fade = useId();
	return (
		<svg aria-hidden viewBox="20 0 340 140" className={cn('animate-public-drift', className)}>
			<defs>
				<CloudFade id={fade} edge="#c9dcf8" />
			</defs>
			<CloudShape fill={`url(#${fade})`} />
		</svg>
	);
}

/** The laptop's store, block by block: the bar, the headline, the button, the picture, then three products. */
const STORE_BLOCKS = [
	{ x: 208, y: 96, width: 194, height: 10, rx: 3, fill: '#e7edf7' },
	{ x: 208, y: 116, width: 92, height: 9, rx: 3, fill: '#c7d6ee' },
	{ x: 208, y: 130, width: 70, height: 9, rx: 3, fill: '#c7d6ee' },
	{ x: 208, y: 146, width: 40, height: 12, rx: 6, fill: '#145fe4' },
	{ x: 310, y: 116, width: 92, height: 44, rx: 4, fill: '#dbe7fb' },
	{ x: 208, y: 170, width: 58, height: 34, rx: 4, fill: '#eef3fb' },
	{ x: 276, y: 170, width: 58, height: 34, rx: 4, fill: '#eef3fb' },
	{ x: 344, y: 170, width: 58, height: 34, rx: 4, fill: '#eef3fb' },
] as const;

/** A laptop resting on a cloud, its screen building a store over and over. Decorative: the panel's words carry the meaning. */
export function CloudLaptop() {
	const ids = useId();
	const screen = `${ids}-screen`;
	const deck = `${ids}-deck`;
	const fade = `${ids}-cloud`;
	return (
		<svg aria-hidden viewBox="60 20 520 380" className="relative z-10 mx-auto w-full max-w-[560px]">
			<defs>
				<linearGradient id={screen} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#6aa0ff" />
					<stop offset="1" stopColor="#1f5fe0" />
				</linearGradient>
				<linearGradient id={deck} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#c3c8d1" />
					<stop offset="1" stopColor="#7f8794" />
				</linearGradient>
				<CloudFade id={fade} edge="#bcd3f6" />
			</defs>
			<g className="animate-public-float">
				{/* Turned slightly, as on 1Password; the deck below follows the screen's bottom edge. */}
				<g transform="translate(305 150) skewY(-4) translate(-305 -150)">
					<rect x="170" y="60" width="270" height="180" rx="12" fill="#2d3038" />
					<rect x="180" y="70" width="250" height="160" rx="4" fill={`url(#${screen})`} />
					<rect x="198" y="86" width="214" height="128" rx="6" fill="#ffffff" />
					{STORE_BLOCKS.map((block, index) => (
						<rect
							key={`${block.x}-${block.y}`}
							{...block}
							className="animate-public-build [transform-box:fill-box] origin-center"
							style={{ animationDelay: `${index * 180}ms` }}
						/>
					))}
				</g>
				<path d="M152 254 L460 232 L482 242 L132 266 Z" fill={`url(#${deck})`} />
				<path d="M132 266 L482 242 L482 248 L132 272 Z" fill="#6b7280" />
			</g>
			<g transform="translate(110 236) scale(1.25)">
				<CloudShape fill={`url(#${fade})`} />
			</g>
		</svg>
	);
}
