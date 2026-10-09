import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE, MAX_ORIGINAL_IMAGE_BYTES, fitWithin, jpegFallbackFor, keepsOriginalFile } from './image-resize';

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

describe('keepsOriginalFile', () => {
	it('keeps a file that fits the edge and the byte limit', () => {
		expect(keepsOriginalFile(1200, 800, MAX_ORIGINAL_IMAGE_BYTES)).toBe(true);
	});

	it('re-encodes a heavy file even when it fits the edge', () => {
		expect(keepsOriginalFile(1200, 800, MAX_ORIGINAL_IMAGE_BYTES + 1)).toBe(false);
	});

	it('re-encodes a file larger than the edge', () => {
		expect(keepsOriginalFile(3200, 1800, 1000)).toBe(false);
	});

	it('limits originals to 3.5 MB, under the 5 MB provider limit once base64-encoded', () => {
		expect(MAX_ORIGINAL_IMAGE_BYTES).toBe(3.5 * 1024 * 1024);
		expect(Math.ceil(MAX_ORIGINAL_IMAGE_BYTES / 3) * 4).toBeLessThanOrEqual(5 * 1024 * 1024);
	});
});
