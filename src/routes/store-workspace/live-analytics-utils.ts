import type { Camera } from './visit-globe-utils';
export type LiveHour = { hour: number; value: number; previous: number };
export function cumulativeHours(
	hours: LiveHour[],
	currentHour: number,
): LiveHour[] {
	let value = 0,
		previous = 0;
	return [...hours]
		.sort((a, b) => a.hour - b.hour)
		.filter((row) => row.hour <= currentHour)
		.map((row) => ({
			hour: row.hour,
			value: (value += row.value),
			previous: (previous += row.previous),
		}));
}
export function rotateCamera(
	camera: Camera,
	longitudeDelta: number,
	latitudeDelta: number,
): Camera {
	return {
		latitude: Math.max(-85, Math.min(85, camera.latitude + latitudeDelta)),
		longitude:
			((((camera.longitude + longitudeDelta + 180) % 360) + 360) % 360) -
			180,
	};
}
export function liveSnapshotState(
	updatedAt: number,
	now: number,
	error: boolean,
	paused: boolean,
) {
	return error
		? 'error'
		: paused
			? 'paused'
			: !updatedAt || now - updatedAt > 15000
				? 'stale'
				: 'live';
}
