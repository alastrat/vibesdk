/** Catalog images copied from the supplier to Estori's R2, so stores and shoppers never load a supplier address. */

import { sha256Hash } from '../../utils/cryptoUtils';
import { CATALOG_MAX_IMAGE_BYTES } from './config';

const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

export async function catalogImageKey(productId: string, sourceUrl: string): Promise<string> {
	const extension = new URL(sourceUrl).pathname.split('.').pop()?.toLowerCase() ?? '';
	const digest = (await sha256Hash(sourceUrl)).slice(0, 16);
	return `catalog/${productId}/${digest}.${EXTENSIONS.includes(extension) ? extension : 'jpg'}`;
}

/** The public path Estori serves a catalog image from. */
export function catalogImagePath(key: string): string {
	return `/api/catalog/images/${key.replace(/^catalog\//, '')}`;
}

export function createImageCopier(bucket: Pick<R2Bucket, 'head' | 'put'>, fetchImpl: typeof fetch = fetch) {
	return {
		/** The R2 key, or null when the address isn't an image of at most 5 MB. An image already copied isn't fetched again. */
		async copy(productId: string, sourceUrl: string): Promise<string | null> {
			const key = await catalogImageKey(productId, sourceUrl);
			if (await bucket.head(key)) return key;
			const response = await fetchImpl(sourceUrl, { signal: AbortSignal.timeout(15_000) });
			const contentType = response.headers.get('Content-Type') ?? '';
			if (!response.ok || !contentType.startsWith('image/')) return null;
			const bytes = await response.arrayBuffer();
			if (bytes.byteLength > CATALOG_MAX_IMAGE_BYTES) return null;
			await bucket.put(key, bytes, { httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' } });
			return key;
		},
	};
}
