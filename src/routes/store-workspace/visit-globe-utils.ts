import type { StoreTrafficBreakdown, StoreTrafficEvent } from '@/api-types';
import { toVector, type Vector } from '@/components/public-site/globe/renderer';

export type VisitCountry = {
	code: string;
	views: number;
	recentEvents: number;
	latestEvent: number;
	latitude?: number;
	longitude?: number;
};
export type Camera = { latitude: number; longitude: number };

// Approximate national centers, never inferred visitor/city coordinates. Countries
// without an entry stay available in the list and are not plotted at a fake point.
const COUNTRY_CENTERS: Record<string, readonly [number, number]> = {
	AR: [-34, -64],
	AU: [-25, 134],
	AT: [47.5, 14.5],
	BE: [50.8, 4.5],
	BO: [-17, -65],
	BR: [-10, -55],
	BG: [43, 25],
	CA: [56, -106],
	CL: [-30, -71],
	CN: [35, 105],
	CO: [4, -73],
	CR: [10, -84],
	CU: [22, -79.5],
	CZ: [49.8, 15.5],
	DK: [56, 10],
	DO: [19, -70.7],
	EC: [-2, -77.5],
	EG: [27, 30],
	SV: [13.8, -88.9],
	EE: [59, 26],
	FI: [64, 26],
	FR: [46, 2],
	DE: [51, 10],
	GH: [8, -2],
	GR: [39, 22],
	GT: [15.5, -90.3],
	HT: [19, -72.4],
	HN: [15, -86.5],
	HK: [22.3, 114.2],
	HU: [47, 20],
	IS: [65, -18],
	IN: [21, 78],
	ID: [-5, 120],
	IR: [32, 53],
	IQ: [33, 44],
	IE: [53, -8],
	IL: [31.5, 34.8],
	IT: [43, 12],
	JM: [18.1, -77.3],
	JP: [36, 138],
	JO: [31, 36],
	KE: [1, 38],
	KR: [36, 128],
	LV: [57, 25],
	LT: [56, 24],
	MY: [4, 110],
	MX: [23, -102],
	MA: [32, -6],
	NL: [52.5, 5.8],
	NZ: [-41, 174],
	NI: [13, -85],
	NG: [10, 8],
	NO: [62, 10],
	PK: [30, 70],
	PA: [9, -80],
	PY: [-23, -58],
	PE: [-10, -76],
	PH: [13, 122],
	PL: [52, 20],
	PT: [39.5, -8],
	PR: [18.2, -66.5],
	RO: [46, 25],
	RU: [60, 100],
	SA: [25, 45],
	SG: [1.4, 103.8],
	ZA: [-29, 24],
	ES: [40, -4],
	SE: [62, 15],
	CH: [47, 8],
	TW: [23.7, 121],
	TH: [15, 101],
	TR: [39, 35],
	UA: [49, 32],
	AE: [24, 54],
	GB: [54, -2],
	US: [39, -98],
	UY: [-33, -56],
	VE: [8, -66],
	VN: [16, 106],
};
const finiteCount = (value: number) =>
	Number.isFinite(value) ? Math.max(0, value) : 0;
export const countryCode = (value: string) => {
	const code = value.trim().toUpperCase();
	return /^[A-Z]{2}$/.test(code) && !['XX', 'ZZ', 'T1'].includes(code)
		? code
		: null;
};

/** Keep aggregates authoritative; events identify recent countries, not extra views. */
export function getVisitCountries(
	events: StoreTrafficEvent[],
	countries: StoreTrafficBreakdown[],
): VisitCountry[] {
	const observed = new Map<string, VisitCountry>();
	const get = (code: string) => {
		let entry = observed.get(code);
		if (!entry) {
			const center = COUNTRY_CENTERS[code];
			entry = {
				code,
				views: 0,
				recentEvents: 0,
				latestEvent: 0,
				...(center
					? { latitude: center[0], longitude: center[1] }
					: {}),
			};
			observed.set(code, entry);
		}
		return entry;
	};
	for (const country of countries) {
		const code = countryCode(country.name);
		if (
			!code ||
			finiteCount(country.views) + finiteCount(country.visitors) === 0
		)
			continue;
		get(code).views += finiteCount(country.views);
	}
	const seenEvents = new Set<string>();
	for (const event of events) {
		const code = countryCode(event.country);
		if (!code || seenEvents.has(event.id)) continue;
		seenEvents.add(event.id);
		const entry = get(code);
		entry.recentEvents += 1;
		entry.latestEvent = Math.max(
			entry.latestEvent,
			Date.parse(event.createdAt) || 0,
		);
	}
	return [...observed.values()]
		.map((entry) => ({
			...entry,
			views: Math.max(entry.views, entry.recentEvents),
		}))
		.sort(
			(a, b) =>
				b.latestEvent - a.latestEvent ||
				b.views - a.views ||
				a.code.localeCompare(b.code),
		);
}

export function projector(camera: Camera) {
	const yaw = (camera.longitude * Math.PI) / 180;
	const tilt = (camera.latitude * Math.PI) / 180;
	const cos = Math.cos(yaw),
		sin = Math.sin(yaw);
	const tiltCos = Math.cos(tilt),
		tiltSin = Math.sin(tilt);
	return (point: Vector) => {
		const x = point.x * cos - point.z * sin;
		const z = point.x * sin + point.z * cos;
		return {
			x,
			y: z * tiltSin - point.y * tiltCos,
			depth: point.y * tiltSin + z * tiltCos,
		};
	};
}

/** Orthographic unit-sphere projection, matching the landing globe's geography. */
export function projectVisitPoint(
	latitude: number,
	longitude: number,
	camera: Camera,
) {
	return projector(camera)(toVector(latitude, longitude));
}
