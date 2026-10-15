import { useId } from 'react';

/** Rays from the globe's centre to the panel's edges. */
const RAYS = [
	[0, 40],
	[90, 0],
	[220, 0],
	[300, 0],
	[380, 0],
	[510, 0],
	[600, 40],
	[600, 200],
	[0, 200],
] as const;

/** Lines across the floor, from the foot of the globe to the bottom edge. */
const FLOOR_LINES = [-260, -150, -60, 0, 60, 150, 260] as const;

/**
 * A person walking toward a glowing globe on a night-blue floor, among floating store cards: 1Password's contact
 * illustration, drawn for Estori. The cards drift; everything is decorative.
 */
export function GlobeWalk({ className }: { className?: string }) {
	const ids = useId();
	const night = `${ids}-night`;
	const globe = `${ids}-globe`;
	const halo = `${ids}-halo`;
	const sphere = `${ids}-sphere`;
	const floor = `${ids}-floor`;
	return (
		<svg aria-hidden viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" className={className}>
			<defs>
				<linearGradient id={night} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#141f4d" />
					<stop offset="1" stopColor="#0d1533" />
				</linearGradient>
				<radialGradient id={globe} cx="0.5" cy="0.45" r="0.6">
					<stop offset="0" stopColor="#f2fffb" />
					<stop offset="0.45" stopColor="#8ff2d6" />
					<stop offset="1" stopColor="#2fd4b0" />
				</radialGradient>
				<radialGradient id={halo} cx="0.5" cy="0.5" r="0.5">
					<stop offset="0.55" stopColor="#ffffff" stopOpacity="0.55" />
					<stop offset="1" stopColor="#ffffff" stopOpacity="0" />
				</radialGradient>
				<clipPath id={sphere}>
					<circle cx="300" cy="330" r="150" />
				</clipPath>
				<clipPath id={floor}>
					<ellipse cx="300" cy="700" rx="560" ry="230" />
				</clipPath>
			</defs>

			<rect width="600" height="600" fill={`url(#${night})`} />
			<g stroke="#2b46a8" strokeWidth="1.5" opacity="0.7">
				{RAYS.map(([x, y]) => (
					<line key={`${x}-${y}`} x1="300" y1="330" x2={x} y2={y} />
				))}
			</g>
			<polygon points="150,70 250,60 236,150 140,160" fill="#22357f" opacity="0.8" />
			<polygon points="330,40 380,36 370,120 322,124" fill="#2a49b8" opacity="0.7" />

			<circle cx="300" cy="330" r="205" fill={`url(#${halo})`} />
			<circle cx="300" cy="330" r="150" fill={`url(#${globe})`} />
			<g clipPath={`url(#${sphere})`} fill="none" stroke="#ffffff" strokeOpacity="0.8" strokeWidth="2.5">
				{[150, 112, 70, 26].map((rx) => (
					<ellipse key={rx} cx="300" cy="330" rx={rx} ry="150" />
				))}
				{[-110, -60, -15, 30, 75, 120].map((offset) => (
					<line key={offset} x1="140" y1={330 + offset} x2="460" y2={330 + offset} />
				))}
			</g>

			<ellipse cx="300" cy="700" rx="560" ry="230" fill="#13205c" />
			<g clipPath={`url(#${floor})`} stroke="#2f5ae8" strokeWidth="1.5" opacity="0.7">
				{FLOOR_LINES.map((offset) => (
					<line key={offset} x1="300" y1="472" x2={300 + offset * 3} y2="620" />
				))}
				<ellipse cx="300" cy="700" rx="420" ry="170" fill="none" />
			</g>
			<ellipse cx="300" cy="700" rx="560" ry="230" fill="none" stroke="#86b6ff" strokeWidth="5" opacity="0.9" />

			{/* The walker, seen from behind, mid-stride. */}
			<g fill="#0b1230">
				<circle cx="300" cy="384" r="11" />
				<path d="M287 399 Q300 393 313 399 L317 440 Q300 447 283 440 Z" />
				<path d="M287 402 L280 435 L286 437 L294 408 Z" />
				<path d="M313 402 L321 433 L315 435 L306 408 Z" />
				<path d="M289 439 L282 478 L291 479 L301 445 Z" />
				<path d="M300 445 L309 479 L318 477 L312 439 Z" />
			</g>

			<g className="animate-public-float">
				<g transform="translate(468 214) rotate(-12)">
					<rect width="96" height="96" rx="12" fill="#f3f6ff" />
					<rect x="6" y="6" width="96" height="96" rx="12" fill="#2a49b8" opacity="0.35" transform="translate(-2 4)" />
					<rect width="96" height="96" rx="12" fill="#f3f6ff" />
					<path d="M20 34 h12 l10 34 h34 l8 -24 h-46" fill="none" stroke="#1f47c8" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
					<circle cx="48" cy="78" r="5" fill="#38d9b4" />
					<circle cx="72" cy="78" r="5" fill="#38d9b4" />
					<circle cx="64" cy="32" r="14" fill="#38d9b4" stroke="#1f47c8" strokeWidth="3" />
					<path d="M64 25 v14 M57 32 h14" stroke="#1f47c8" strokeWidth="3" strokeLinecap="round" />
				</g>
			</g>
			<g className="animate-public-float" style={{ animationDelay: '-2s' }}>
				<g transform="translate(-18 120) rotate(14)">
					<rect width="120" height="150" rx="10" fill="#2448c4" />
					<path d="M20 34 h70 M20 56 h50 M20 78 h62" stroke="#7fd9ff" strokeWidth="4" strokeLinecap="round" opacity="0.8" />
				</g>
			</g>
			<g className="animate-public-float" style={{ animationDelay: '-3.5s' }}>
				<g transform="translate(-30 360) rotate(10)">
					<rect width="220" height="44" rx="22" fill="#2f5ae8" />
					<rect x="44" y="12" width="70" height="18" rx="4" fill="#ff9a6b" />
					<rect x="120" y="12" width="20" height="18" rx="4" fill="#ff5c8a" />
				</g>
			</g>
			<circle cx="120" cy="520" r="22" fill="#38d9b4" />
			<circle cx="452" cy="498" r="13" fill="#38d9b4" />
			<circle cx="380" cy="640" r="70" fill="#38d9b4" />
		</svg>
	);
}
