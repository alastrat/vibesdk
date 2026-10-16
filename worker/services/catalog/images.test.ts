import { describe, expect, it } from 'vitest';
import { catalogImageKey, catalogImagePath, createImageCopier } from './images';

function fakeBucket(existing: string[] = []) {
	const stored = new Map<string, string | undefined>(existing.map((key) => [key, 'image/jpeg']));
	const bucket: Pick<R2Bucket, 'head' | 'put'> = {
		head: (async (key: string) => (stored.has(key) ? ({ key } as R2Object) : null)) as R2Bucket['head'],
		put: (async (key: string, _value: unknown, options?: R2PutOptions) => {
			const metadata = options?.httpMetadata;
			stored.set(key, metadata instanceof Headers ? (metadata.get('Content-Type') ?? undefined) : metadata?.contentType);
			return { key } as R2Object;
		}) as R2Bucket['put'],
	};
	return { bucket, stored };
}

function imageFetch(contentType: string, bytes = 10) {
	let calls = 0;
	const fakeFetch: typeof fetch = async () => {
		calls += 1;
		return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': contentType, 'Content-Length': String(bytes) } });
	};
	return { fakeFetch, calls: () => calls };
}

describe('catalog images', () => {
	it('keys an image by product and a digest of its address, keeping the extension', async () => {
		const key = await catalogImageKey('cp_1', 'https://cf.example/abc.PNG?x=1');
		expect(key).toMatch(/^catalog\/cp_1\/[0-9a-f]{16}\.png$/);
		expect(await catalogImageKey('cp_1', 'https://cf.example/abc.PNG?x=1')).toBe(key);
		expect(await catalogImageKey('cp_1', 'https://cf.example/noext')).toMatch(/\.jpg$/);
		expect(catalogImagePath(key)).toBe(`/api/catalog/images/${key.slice('catalog/'.length)}`);
	});

	it('copies an image once, and only images of reasonable size', async () => {
		const { bucket, stored } = fakeBucket();
		const source = imageFetch('image/jpeg');
		const copier = createImageCopier(bucket, source.fakeFetch);

		const key = await copier.copy('cp_1', 'https://cf.example/a.jpg');
		expect(key && stored.get(key)).toBe('image/jpeg');
		expect(await copier.copy('cp_1', 'https://cf.example/a.jpg')).toBe(key);
		expect(source.calls()).toBe(1);

		expect(await createImageCopier(bucket, imageFetch('text/html').fakeFetch).copy('cp_1', 'https://cf.example/page.jpg')).toBeNull();
		expect(await createImageCopier(bucket, imageFetch('image/jpeg', 6 * 1024 * 1024).fakeFetch).copy('cp_1', 'https://cf.example/huge.jpg')).toBeNull();
	});
});
