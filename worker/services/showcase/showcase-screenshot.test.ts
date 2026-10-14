import { describe, expect, it, vi } from 'vitest';
import { SHOWCASE_VIEWPORT } from '../browser-capture/capture-core';
import {
	captureShowcaseScreenshot,
	runShowcaseRefresh,
	showcaseEligible,
	type ShowcaseCaptureDeps,
	type ShowcaseCaptureResult,
} from './showcase-screenshot';

/** Base64 of random bytes: as large and varied as a real page capture. */
function pageLikeCapture(bytes: number): string {
	let binary = '';
	for (const byte of crypto.getRandomValues(new Uint8Array(bytes))) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fakeDeps(capture: () => Promise<string>, saveResult = true) {
	const store = vi.fn(async (appId: string) => `/api/screenshots/${appId}/showcase.jpg`);
	const save = vi.fn(async () => saveResult);
	const logger = { info: vi.fn(), warn: vi.fn() };
	const deps: ShowcaseCaptureDeps = { capture: vi.fn(capture), store, save, logger };
	return { deps, store, save, logger };
}

describe('showcase screenshots', () => {
	it('captures a tall 1280x1650 page', () => {
		expect(SHOWCASE_VIEWPORT).toEqual({ width: 1280, height: 1650 });
	});

	it('stores and records a real capture', async () => {
		const image = pageLikeCapture(20_000);
		const { deps, store, save } = fakeDeps(async () => image);
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('stored');
		expect(store).toHaveBeenCalledWith('app1', image);
		expect(save).toHaveBeenCalledWith('app1', '/api/screenshots/app1/showcase.jpg');
	});

	it('keeps the previous image when a capture looks blank', async () => {
		const { deps, store, logger } = fakeDeps(async () => btoa('blank'));
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('blank');
		expect(store).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('reports a failed capture without throwing', async () => {
		const { deps, store, logger } = fakeDeps(async () => {
			throw new Error('Browser Rendering timed out');
		});
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('failed');
		expect(store).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('reports a failure when the app is gone before the image is recorded', async () => {
		const { deps } = fakeDeps(async () => pageLikeCapture(20_000), false);
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('failed');
	});

	it('refreshes a few stores at a time and counts every outcome', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const result = await runShowcaseRefresh(
			['a', 'b', 'c', 'd', 'e'],
			async (appId): Promise<ShowcaseCaptureResult> => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				return appId === 'b' ? 'failed' : appId === 'c' ? 'blank' : 'stored';
			},
			2,
		);
		expect(result).toEqual({ captured: 3, failed: 2 });
		expect(maxInFlight).toBe(2);
	});

	it('gives showcase images only to public stores still in Discover', () => {
		expect(showcaseEligible({ visibility: 'public', removedFromDiscoverAt: null })).toBe(true);
		expect(showcaseEligible({ visibility: 'private', removedFromDiscoverAt: null })).toBe(false);
		expect(showcaseEligible({ visibility: 'public', removedFromDiscoverAt: new Date() })).toBe(false);
		expect(showcaseEligible(null)).toBe(false);
	});
});
