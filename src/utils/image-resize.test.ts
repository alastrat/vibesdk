import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, fitWithin, jpegFallbackFor } from './image-resize';

describe('fitWithin', () => {
	it('keeps images that already fit', () => {
		expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
		expect(fitWithin(MAX_IMAGE_EDGE, 900)).toEqual({ width: MAX_IMAGE_EDGE, height: 900 });
	});

	it('scales the long edge down to the limit and keeps the aspect ratio', () => {
		expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
		expect(fitWithin(1000, 4000)).toEqual({ width: 400, height: 1600 });
	});

	it('never collapses a side to zero', () => {
		expect(fitWithin(10_000, 3)).toEqual({ width: 1600, height: 1 });
	});
});

describe('jpegFallbackFor', () => {
	it('keeps WebP output, which preserves transparency', () => {
		expect(jpegFallbackFor('image/webp')).toBeNull();
	});

	it('re-encodes as JPEG on a white backdrop when the browser could not encode WebP', () => {
		const expected = { mimeType: 'image/jpeg', backdrop: '#ffffff' };
		expect(jpegFallbackFor('image/png')).toEqual(expected);
		expect(jpegFallbackFor('')).toEqual(expected);
	});
});
