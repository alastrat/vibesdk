export type Vector = { x: number; y: number; z: number };
export type GlobeMarket = { id: string; latitude: number; longitude: number; label: string };
const RAD = Math.PI / 180;
const SIZE = 680;
const RADIUS = 250;
const CENTER = 340;

export function toVector(latitude: number, longitude: number): Vector {
	const latitudeRad = latitude * RAD;
	const longitudeRad = longitude * RAD;
	return { x: Math.cos(latitudeRad) * Math.sin(longitudeRad), y: Math.sin(latitudeRad), z: Math.cos(latitudeRad) * Math.cos(longitudeRad) };
}

/** A raised great-circle route, so connections lift clear of the globe's edge. */
function route(from: Vector, to: Vector): Vector[] {
	const angle = Math.acos(Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z)));
	return Array.from({ length: 81 }, (_, index) => {
		const t = index / 80;
		const a = Math.sin((1 - t) * angle) / Math.sin(angle);
		const b = Math.sin(t * angle) / Math.sin(angle);
		const height = 1 + Math.sin(t * Math.PI) * 0.23;
		return { x: (from.x * a + to.x * b) * height, y: (from.y * a + to.y * b) * height, z: (from.z * a + to.z * b) * height };
	});
}

export type CountryPoints = Record<string, number[][]>;

export function createGlobeRenderer(canvas: HTMLCanvasElement, points: number[][], markets: readonly GlobeMarket[], countries: CountryPoints) {
	const context = canvas.getContext('2d');
	if (!context) return null;
	const land = points.map(([latitude, longitude]) => toVector(latitude, longitude));
	const countryLand = markets.map((market) => (countries[market.id] ?? []).map(([lat, lon]) => toVector(lat, lon)));
	const locations = markets.map((market) => toVector(market.latitude, market.longitude));
	const routes = locations.map((point, index) => route(point, locations[(index + 1) % locations.length]));
	let resolution = 0;

	return (longitude: number, active: number, time: number, latitude = 12.6, previous = active, progress = 1) => {
		const width = canvas.clientWidth;
		const nextResolution = Math.round(width * Math.min(window.devicePixelRatio || 1, 2));
		if (width === 0) return;
		if (resolution !== nextResolution) {
			resolution = nextResolution;
			canvas.width = resolution;
			canvas.height = resolution;
		}
		context.setTransform(resolution / SIZE, 0, 0, resolution / SIZE, 0, 0);
		context.clearRect(0, 0, SIZE, SIZE);
		const yaw = longitude * RAD;
		const cos = Math.cos(yaw),
			sin = Math.sin(yaw);
		const tilt = latitude * RAD;
		const project = (point: Vector) => {
			const x = point.x * cos - point.z * sin;
			const z = point.x * sin + point.z * cos;
			const y = point.y * Math.cos(tilt) - z * Math.sin(tilt);
			return { x: CENTER + x * RADIUS, y: CENTER - y * RADIUS, z: point.y * Math.sin(tilt) + z * Math.cos(tilt) };
		};
		const sphere = context.createRadialGradient(260, 245, 10, CENTER, CENTER, RADIUS);
		sphere.addColorStop(0, '#191e24');
		sphere.addColorStop(0.72, '#11151a');
		sphere.addColorStop(1, '#0b0e12');
		context.fillStyle = sphere;
		context.beginPath();
		context.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
		context.fill();
		for (const point of land) {
			const p = project(point);
			if (p.z <= 0) continue;
			context.fillStyle = `rgba(213,222,232,${0.13 + p.z * 0.62})`;
			const size = 0.8 + p.z * 0.65;
			context.fillRect(p.x, p.y, size, size);
		}
		// Country-shaped masks cover every land dot inside the selected border.
		// Crossfade masks as the camera moves, instead of jumping between small city-radius patches.
		for (const index of new Set([previous, active])) {
			const opacity = previous === active ? 1 : index === active ? progress : 1 - progress;
			if (opacity <= 0) continue;
			for (const point of countryLand[index]) {
				const p = project(point);
				if (p.z <= 0) continue;
				context.fillStyle = `rgba(245,137,74,${(0.35 + p.z * 0.6) * opacity})`;
				const size = 0.8 + p.z * 0.65;
				context.fillRect(p.x, p.y, size, size);
			}
		}
		for (const [index, connection] of routes.entries()) {
			context.beginPath();
			let connected = false;
			for (const point of connection) {
				const p = project(point);
				// A raised arc can remain visible beyond the silhouette even on the far hemisphere.
				if (p.z < 0 && Math.hypot(p.x - CENTER, p.y - CENTER) < RADIUS) {
					connected = false;
					continue;
				}
				if (connected) context.lineTo(p.x, p.y);
				else context.moveTo(p.x, p.y);
				connected = true;
			}
			context.strokeStyle = index === active || (index + 1) % markets.length === active ? '#f18a4a' : 'rgba(241,138,74,.32)';
			context.lineWidth = 1.2;
			context.stroke();
			const travel = connection[Math.floor(((time / 3400 + index * 0.21) % 1) * 80)];
			const dot = project(travel);
			if (dot.z > 0 || Math.hypot(dot.x - CENTER, dot.y - CENTER) > RADIUS) {
				context.fillStyle = 'rgba(245,137,74,.16)';
				context.beginPath();
				context.arc(dot.x, dot.y, 7, 0, Math.PI * 2);
				context.fill();
				context.fillStyle = '#ffac76';
				context.beginPath();
				context.arc(dot.x, dot.y, 2.3, 0, Math.PI * 2);
				context.fill();
			}
		}
		const placed: { x: number; y: number; width: number }[] = [];
		// Place the active label first. Small globes keep just its label, with dots for the other markets.
		const order = [active, ...markets.map((_, index) => index).filter((index) => index !== active)];
		const labelScale = Math.max(1, Math.min(2.2, 544 / width));
		const labelHeight = 26 * labelScale;
		context.font = `${14 * labelScale}px "DM Sans", sans-serif`;
		context.textAlign = 'center';
		for (const index of order) {
			const p = project(locations[index]);
			if (p.z < 0.08) continue;
			context.fillStyle = '#fff';
			context.beginPath();
			context.arc(p.x, p.y, index === active ? 3.5 : 2.5, 0, Math.PI * 2);
			context.fill();
			if (width < 440 && index !== active) continue;
			const textWidth = context.measureText(markets[index].label).width + 18 * labelScale;
			const above = p.y - labelHeight - 9;
			const candidates = [
				{ x: p.x, y: above },
				{ x: p.x - textWidth / 2 - 10, y: above },
				{ x: p.x + textWidth / 2 + 10, y: above },
				{ x: p.x, y: p.y + 12 },
				{ x: p.x - textWidth / 2 - 10, y: p.y + 12 },
				{ x: p.x + textWidth / 2 + 10, y: p.y + 12 },
			];
			const overlaps = (candidate: { x: number; y: number }) => placed.some((label) =>
				Math.abs(label.y - candidate.y) < labelHeight + 3 && Math.abs(label.x - candidate.x) < (label.width + textWidth) / 2 + 5);
			const position = candidates.find((candidate) => !overlaps(candidate)) ?? { x: p.x, y: above };
			while (overlaps(position)) position.y -= labelHeight + 6;
			const { x, y } = position;
			placed.push({ x, y, width: textWidth });
			context.strokeStyle = 'rgba(255,255,255,.3)';
			context.beginPath();
			context.moveTo(x, y > p.y ? y : y + labelHeight);
			context.lineTo(p.x, p.y);
			context.stroke();
			context.fillStyle = index === active ? '#fff' : '#c5c9ce';
			context.beginPath();
			context.roundRect(x - textWidth / 2, y, textWidth, labelHeight, 7 * labelScale);
			context.fill();
			context.fillStyle = '#14191f';
			context.fillText(markets[index].label, x, y + 18 * labelScale);
			context.fillStyle = '#fff';
			context.beginPath();
			context.arc(p.x, p.y, index === active ? 3.5 : 2.5, 0, Math.PI * 2);
			context.fill();
		}
	};
}
