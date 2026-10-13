/** R2 access for template snapshots and screenshots. */

import { parseBundle, type TreeFile } from './snapshot';
import type { TemplateObjectStore } from './submit';

export function r2TemplateStore(bucket: R2Bucket): TemplateObjectStore {
	return {
		async put(key, body, contentType) {
			await bucket.put(key, body, { httpMetadata: { contentType } });
		},
		async delete(keys) {
			await bucket.delete(keys);
		},
	};
}

/** Read a version's `files.json`, validating every path. */
export async function readTemplateSnapshot(bucket: R2Bucket, key: string): Promise<TreeFile[]> {
	const object = await bucket.get(key);
	if (!object) throw new Error('Template snapshot is missing');
	return parseBundle(await object.text());
}

/** A stored template screenshot as a response, or null when it is missing. */
export async function templateImageResponse(
	bucket: R2Bucket,
	key: string,
	cacheControl: string,
): Promise<Response | null> {
	const object = await bucket.get(key);
	if (!object || !object.body) return null;
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
			'Cache-Control': cacheControl,
			'X-Content-Type-Options': 'nosniff',
		},
	});
}
