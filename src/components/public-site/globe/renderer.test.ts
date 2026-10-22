import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGlobeRenderer } from './renderer';
import { GLOBAL_MARKETS } from './markets';

afterEach(() => vi.unstubAllGlobals());

describe('globe markets', () => {
	it('offers the seven requested markets with a local flag for each', () => {
		expect(GLOBAL_MARKETS.map((market) => market.id)).toEqual(['us', 'br', 'co', 'cl', 'ar', 'mx', 'es']);
		for (const market of GLOBAL_MARKETS) expect(market.flag).toBe(`/marketing/flags/${market.id}.svg`);
	});

	it('highlights the whole selected country rather than a radius around its marker', () => {
		vi.stubGlobal('window', { devicePixelRatio: 1 });
		const pixels: { color: string; x: number; y: number }[] = [];
		const context = {
			fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
			setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
			moveTo() {}, lineTo() {}, stroke() {}, roundRect() {}, fillText() {},
			createRadialGradient: () => ({ addColorStop() {} }),
			measureText: (label: string) => ({ width: label.length * 7 }),
			fillRect(x: number, y: number) { pixels.push({ color: String(this.fillStyle), x, y }); },
		};
		const canvas = { clientWidth: 680, getContext: () => context } as unknown as HTMLCanvasElement;
		// Northern Amazon, western Acre, northeastern coast and southern Brazil.
		const brazil = [[2.82, -60.67], [-9.97, -67.81], [-8.05, -34.9], [-30.03, -51.23]];
		const colombia = [[4.71, -74.07]];
		const markets = [
			{ id: 'br', latitude: -23.5, longitude: -46.6, label: 'Brazil' },
			{ id: 'co', latitude: 4.71, longitude: -74.07, label: 'Colombia' },
		];
		const draw = createGlobeRenderer(canvas, [...brazil, ...colombia], markets, { br: brazil, co: colombia });
		expect(draw).not.toBeNull();
		draw!(-55, 0, 0);
		const highlighted = pixels.filter((pixel) => pixel.color.startsWith('rgba(245,137,74,'));
		expect(highlighted).toHaveLength(4);
		pixels.length = 0;
		draw!(-55, 1, 0);
		expect(pixels.filter((pixel) => pixel.color.startsWith('rgba(245,137,74,'))).toHaveLength(1);
	});
});
