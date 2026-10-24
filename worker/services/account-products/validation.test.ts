import { describe, expect, it } from 'vitest';
import { validateProduct, validateUpload } from './validation';
const valid = {
	name: 'Coffee',
	description: '',
	category: '',
	type: 'physical',
	variants: [
		{ id: '', name: 'Bag', priceCents: 1200, sku: '', available: true },
	],
	imageAssetId: null,
	downloadAssetIds: [],
	weightGrams: 250,
};
describe('private product validation', () => {
	it('assigns a stable bounded ID to new own variants and rejects forged catalog identities', () => {
		const saved = validateProduct(valid);
		expect(saved.variants[0].id).toMatch(/^[a-z0-9-]{1,64}$/);
		expect(() =>
			validateProduct({
				...valid,
				variants: [
					{ ...valid.variants[0], catalogVariantId: 'forged' },
				],
			}),
		).toThrow();
	});
	it('rejects empty, duplicate, excessive, or invalidly priced variants', () => {
		for (const variants of [
			[],
			Array.from({ length: 31 }, () => valid.variants[0]),
			[{ ...valid.variants[0], priceCents: 49 }],
			[{ ...valid.variants[0], priceCents: 1000001 }],
			[
				{ ...valid.variants[0], id: 'same' },
				{ ...valid.variants[0], id: 'same' },
			],
		])
			expect(() => validateProduct({ ...valid, variants })).toThrow();
	});
	it('refuses physical download attachments and invalid asset IDs', () => {
		expect(() =>
			validateProduct({ ...valid, downloadAssetIds: ['x'] }),
		).toThrow();
		expect(() =>
			validateProduct({ ...valid, imageAssetId: '../secret' }),
		).toThrow();
	});
	it('allows only approved upload kinds and safe filenames', () => {
		expect(validateUpload('image', 'image/png', 'bag.png')).toEqual({
			kind: 'image',
			contentType: 'image/png',
			name: 'bag.png',
		});
		for (const mime of [
			'image/svg+xml',
			'text/html',
			'application/x-msdownload',
		])
			expect(() => validateUpload('download', mime, 'file')).toThrow();
		expect(() =>
			validateUpload('image', 'image/png', '../secret.png'),
		).toThrow();
	});
});

import { readBoundedBody } from './assets';
it('bounds actual streamed upload bytes even without Content-Length', async () => {
	const request = new Request('https://example.test', {
		method: 'POST',
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(4));
				controller.enqueue(new Uint8Array(4));
				controller.close();
			},
		}),
	});
	await expect(readBoundedBody(request, 6)).rejects.toMatchObject({
		status: 413,
	});
});
