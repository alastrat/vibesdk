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

			{/* The walker, backlit by the globe, mid-stride toward us: drawn 128 units tall with the feet on the horizon. */}
			<g transform="translate(300 346)" fill="#101838">
				<ellipse cx="1" cy="127.5" rx="17" ry="2.4" fill="#060b24" opacity="0.6" />
				{/* Head and neck */}
				<path d="M0 0 C4.3 0 6.8 2.9 6.7 7.2 C6.6 10.6 5.4 13.6 3.4 15.6 C2.4 16.5 1.2 17 0 17 C-1.2 17 -2.4 16.5 -3.4 15.6 C-5.4 13.6 -6.6 10.6 -6.7 7.2 C-6.8 2.9 -4.3 0 0 0 Z" />
				<path d="M-3.5 14 L3.5 14 C3.6 18 4.2 20.6 5.6 22.6 L-5.6 22.6 C-4.2 20.6 -3.6 18 -3.5 14 Z" />
				{/* Jacket: sloped shoulders, a waist, and a hem at the hips */}
				<path d="M-4.6 20.6 C-8.8 21.1 -13 22 -15.4 23.8 C-17.2 25.4 -16.8 30.5 -15.6 36 C-14 43 -11.8 49 -11.4 55 C-11.2 60 -12.2 64.5 -13 69 L13 69 C12.2 64.5 11.2 60 11.4 55 C11.8 49 14 43 15.6 36 C16.8 30.5 17.2 25.4 15.4 23.8 C13 22 8.8 21.1 4.6 20.6 Z" />
				{/* Sleeves and hands: one arm hanging loose, one bent toward the pocket */}
				<path d="M-15.2 23.6 C-18 24.4 -19.4 27.6 -19.4 32 C-19.4 39 -19 45.5 -18.6 51 C-18.2 56 -17.8 60.5 -17.3 64.4 L-13.6 64.4 C-13.9 60 -14.3 55.5 -14.5 51 C-14.7 45 -14.5 38 -13.4 31 Z" />
				<path d="M-17.2 64 C-17.6 67 -17.4 70.5 -16.2 72.6 C-15.4 73.8 -14.2 73.6 -13.8 72.2 C-13.4 70 -13.4 66.8 -13.6 64 Z" />
				<path d="M15.2 23.6 C18 24.4 19.4 27.6 19.4 32 C19.4 39 19.2 45 18.6 50.5 C17.8 55.5 16.4 59.5 14.4 63.2 L11.2 61.4 C12.8 58 14.2 54.5 14.7 50.4 C15.1 45 14.8 38 13.4 31 Z" />
				<path d="M14.4 63 C14 65.4 12.8 67.4 11.4 67.8 C10.4 68 9.8 67.2 10.2 66 C10.6 64.6 11 63 11.2 61.4 Z" />
				{/* Legs from under the jacket: the back one straight, the front one a step nearer and lower */}
				<path d="M-12.8 64 C-13.4 76 -13.1 87 -11.8 97 C-11 104 -11.2 110 -10.2 116.5 C-9.9 118.5 -9.8 120 -9.6 121 L-5.6 121 C-5.6 117 -5.2 112 -4.6 106 C-4 101 -3.8 97 -3.4 94 C-2.4 86 -1.2 79 -0.2 73 L0 64 Z" />
				<path d="M-10.2 120 C-11.4 121 -11.8 122.8 -11 123.8 C-9.6 124.6 -5.6 124.6 -4.4 123.8 C-3.8 123 -4.4 121 -5.2 120 Z" />
				<path d="M0 64 L0.2 73 C1.6 80 3 87 4.2 94.5 C4.8 101 5.4 107 6.1 113 C6.5 117 6.8 120 7 123.5 L11.8 123.5 C11.8 120 12 116 12.4 111 C13 105 13.4 100 13.2 95.5 C13.6 86 13.6 76 13 64 Z" />
				<path d="M6.4 122.6 C5.4 124 5.4 126.4 6.6 127.2 C8.6 128.2 12.4 128.2 13.8 127.2 C14.6 126.4 14 123.8 12.6 122.6 Z" />
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
