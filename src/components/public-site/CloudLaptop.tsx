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

/** A puff of the big cloud: circles and one rounded base, all sharing one fade so no seams show. */
interface Puff {
	cx: number;
	cy: number;
	r: number;
}

/** The cloud's left side, behind the laptop's keyboard. */
const BACK_PUFFS: readonly Puff[] = [
	{ cx: 1105, cy: 405, r: 118 },
	{ cx: 1010, cy: 482, r: 84 },
	{ cx: 1235, cy: 398, r: 80 },
];

/** The cloud's right side and base, in front of the laptop: it covers the keyboard's far end and the screen's corner. */
const FRONT_PUFFS: readonly Puff[] = [
	{ cx: 1500, cy: 482, r: 96 },
	{ cx: 1690, cy: 410, r: 112 },
	{ cx: 1852, cy: 458, r: 98 },
	{ cx: 1625, cy: 540, r: 110 },
	{ cx: 1290, cy: 540, r: 100 },
	{ cx: 1085, cy: 548, r: 95 },
];

function Puffs({ puffs, fill, base }: { puffs: readonly Puff[]; fill: string; base?: boolean }) {
	return (
		<g fill={fill}>
			{puffs.map((puff) => (
				<circle key={`${puff.cx}-${puff.cy}`} {...puff} />
			))}
			{base && <rect x="935" y="470" width="1015" height="175" rx="86" />}
		</g>
	);
}

/** Polygons with softly rounded corners: the stroke, in the fill's color, rounds each corner. */
function Rounded({ points, fill, radius, className, delay }: { points: string; fill: string; radius: number; className?: string; delay?: number }) {
	return (
		<polygon
			points={points}
			fill={fill}
			stroke={fill}
			strokeWidth={radius * 2}
			strokeLinejoin="round"
			className={className}
			style={delay === undefined ? undefined : { animationDelay: `${delay}ms` }}
		/>
	);
}

/** The store on the laptop's screen, block by block: the bar, then the two left blocks and the tall one on the right. */
const STORE_BLOCKS = [
	{ points: '1322,209 1563,209 1562,219 1320,219', fill: '#e9eef7' },
	{ points: '1325,244 1428,244 1425,284 1321,284', fill: '#dde5f2' },
	{ points: '1320,293 1423,293 1420,333 1316,333', fill: '#dde5f2' },
	{ points: '1442,244 1550,244 1544,333 1436,333', fill: '#dde5f2' },
] as const;

/**
 * A laptop resting in a cloud, turned slightly to the left as on 1Password: the lid's right edge shows its
 * thickness and the keyboard runs off to the left. Drawn in the reference picture's own coordinates; the laptop
 * and its cloud float together, and the screen builds a store over and over.
 */
export function CloudLaptop() {
	const ids = useId();
	const screen = `${ids}-screen`;
	const deck = `${ids}-deck`;
	const fade = `${ids}-cloud`;
	return (
		<svg aria-hidden viewBox="900 110 1080 560" className="relative z-10 mx-auto w-full max-w-[600px]">
			<defs>
				<linearGradient id={screen} x1="0" y1="0" x2="0.35" y2="1">
					<stop offset="0" stopColor="#62a0f8" />
					<stop offset="1" stopColor="#1c5bdf" />
				</linearGradient>
				<linearGradient id={deck} x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stopColor="#9a9fa8" />
					<stop offset="1" stopColor="#575c65" />
				</linearGradient>
				<linearGradient id={fade} gradientUnits="userSpaceOnUse" x1="0" y1="285" x2="0" y2="650">
					<stop offset="0.3" stopColor="#ffffff" />
					<stop offset="0.68" stopColor="#e2ecfc" />
					<stop offset="1" stopColor="#a9c6f2" />
				</linearGradient>
			</defs>
			<g className="animate-public-float">
				<Puffs puffs={BACK_PUFFS} fill={`url(#${fade})`} />
				{/* The lid: its right edge first, then the bezel, the screen and the store window. */}
				<polygon points="1630,146 1646,155 1627,410 1611,407" fill="#5b6069" />
				<Rounded points="1275,150 1621,150 1604,401 1243,403" fill="#2b2e35" radius={7} />
				<Rounded points="1284,160 1614,160 1598,394 1254,396" fill={`url(#${screen})`} radius={2} />
				<Rounded points="1308,196 1579,196 1566,363 1291,363" fill="#ffffff" radius={4} />
				{STORE_BLOCKS.map((block, index) => (
					<Rounded
						key={block.points}
						points={block.points}
						fill={block.fill}
						radius={3}
						delay={index * 220}
						className="animate-public-build [transform-box:fill-box] origin-center"
					/>
				))}
				{/* The keyboard, seen edge on: a light top and a darker front, rounded at its far left. */}
				<path d="M1126 404 H1612 L1600 412 H1118 Z" fill="#c3c7ce" />
				<path d="M1124 412 H1600 V438 H1124 A13 13 0 0 1 1124 412 Z" fill={`url(#${deck})`} />
				<Puffs puffs={FRONT_PUFFS} fill={`url(#${fade})`} base />
				{/* Faint edges where the puffs overlap, as on 1Password's cloud. */}
				<g fill="none" stroke="#cfdcf3" strokeWidth="4" strokeLinecap="round">
					<path d="M1428 478 A92 80 0 0 1 1560 418" />
					<path d="M1612 372 A105 92 0 0 1 1768 336" />
					<path d="M960 432 A96 84 0 0 1 1090 380" />
				</g>
			</g>
		</svg>
	);
}
