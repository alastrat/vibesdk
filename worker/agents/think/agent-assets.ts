/**
 * Images in a Think conversation are stored in R2 and referenced on a reserved
 * host, so stored messages stay small. Each model request inlines them as data
 * URLs, because providers cannot reach Estori's storage.
 */

export const AGENT_ASSET_HOST = 'assets.estori.internal';
const AGENT_ASSET_PREFIX = `https://${AGENT_ASSET_HOST}/`;

/** Larger images are left out of the request; Claude rejects images over 5 MB. */
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface AssetBucket {
	get(key: string): Promise<{
		size: number;
		httpMetadata?: { contentType?: string };
		arrayBuffer(): Promise<ArrayBuffer>;
	} | null>;
}

export interface AssetCache {
	get(key: string): string | undefined;
	set(key: string, dataUrl: string): void;
}

export function agentAssetUrl(r2Key: string): string {
	return AGENT_ASSET_PREFIX + r2Key.split('/').map(encodeURIComponent).join('/');
}

export function agentAssetKey(url: string): string | null {
	if (!url.startsWith(AGENT_ASSET_PREFIX)) return null;
	return url.slice(AGENT_ASSET_PREFIX.length).split('/').map(decodeURIComponent).join('/');
}

/** Data URLs by R2 key, evicting the oldest entries beyond `maxBytes`. */
export function createAssetCache(maxBytes: number): AssetCache {
	const entries = new Map<string, string>();
	let total = 0;
	return {
		get: (key) => entries.get(key),
		set: (key, dataUrl) => {
			if (dataUrl.length > maxBytes) return;
			const previous = entries.get(key);
			if (previous !== undefined) {
				total -= previous.length;
				entries.delete(key);
			}
			entries.set(key, dataUrl);
			total += dataUrl.length;
			for (const [oldKey, oldValue] of entries) {
				if (total <= maxBytes) break;
				entries.delete(oldKey);
				total -= oldValue.length;
			}
		},
	};
}

type Inlined = { kind: 'data'; dataUrl: string } | { kind: 'text'; text: string };

interface ImageUrlPart {
	type: 'image_url';
	image_url: { url: string; [key: string]: unknown };
}

function assetImageKey(part: unknown): string | null {
	const p = part as { type?: unknown; image_url?: { url?: unknown } };
	if (p?.type !== 'image_url' || typeof p.image_url?.url !== 'string') return null;
	return agentAssetKey(p.image_url.url);
}

async function loadAsset(key: string, bucket: AssetBucket, cache: AssetCache): Promise<Inlined> {
	const cached = cache.get(key);
	if (cached) return { kind: 'data', dataUrl: cached };
	const object = await bucket.get(key);
	if (!object) return { kind: 'text', text: '[image unavailable]' };
	if (object.size > MAX_INLINE_IMAGE_BYTES) return { kind: 'text', text: '[image too large]' };
	const mediaType = object.httpMetadata?.contentType ?? 'image/jpeg';
	const dataUrl = `data:${mediaType};base64,${Buffer.from(await object.arrayBuffer()).toString('base64')}`;
	cache.set(key, dataUrl);
	return { kind: 'data', dataUrl };
}

/**
 * Replaces every reserved-host image in a chat-completions body with an inline
 * data URL read from R2. Bodies without such images are returned unchanged.
 */
export async function inlineAgentAssets(body: string, bucket: AssetBucket, cache: AssetCache): Promise<string> {
	if (!body.includes(AGENT_ASSET_HOST)) return body;
	let json: { messages?: unknown };
	try {
		json = JSON.parse(body);
	} catch {
		return body;
	}
	if (!Array.isArray(json.messages)) return body;

	const keys = new Set<string>();
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const key = assetImageKey(part);
			if (key) keys.add(key);
		}
	}
	if (keys.size === 0) return body;

	const loaded = new Map(
		await Promise.all([...keys].map(async (key) => [key, await loadAsset(key, bucket, cache)] as const)),
	);
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (let i = 0; i < content.length; i++) {
			const key = assetImageKey(content[i]);
			const inlined = key ? loaded.get(key) : undefined;
			if (!inlined) continue;
			const part = content[i] as ImageUrlPart;
			content[i] =
				inlined.kind === 'data'
					? { ...part, image_url: { ...part.image_url, url: inlined.dataUrl } }
					: { type: 'text', text: inlined.text };
		}
	}
	return JSON.stringify(json);
}
