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

/** The R2 key behind a reserved-host URL; null for other hosts and malformed escapes. */
export function agentAssetKey(url: string): string | null {
	if (!url.startsWith(AGENT_ASSET_PREFIX)) return null;
	try {
		return url.slice(AGENT_ASSET_PREFIX.length).split('/').map(decodeURIComponent).join('/');
	} catch {
		return null;
	}
}

const SAFE_ID = '[A-Za-z0-9_-]{1,64}';
/** `uploads/<id>/<file>`, as written by uploadImageKey. */
const UPLOAD_KEY = new RegExp(`^uploads/${SAFE_ID}/[^/]+$`);
/** `screenshots/<appId>/ref-<captureId>-<kind>.jpg`, as written by the reference service. */
const REFERENCE_SHOT_KEY = new RegExp(
	`^screenshots/${SAFE_ID}/ref-${SAFE_ID}-(?:desktop-top|desktop-middle|desktop-lower|mobile-top)\\.jpg$`,
);

/**
 * Whether the transport may read a key from the shared bucket: only uploaded
 * images and reference screenshots, never a key with empty or dot segments.
 */
export function isInlinableAssetKey(key: string): boolean {
	if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
	return UPLOAD_KEY.test(key) || REFERENCE_SHOT_KEY.test(key);
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

const UNAVAILABLE: Inlined = { kind: 'text', text: '[image unavailable]' };

interface ImageUrlPart {
	type: 'image_url';
	image_url: { url: string; [key: string]: unknown };
}

function assetImageUrl(part: unknown): string | null {
	const p = part as { type?: unknown; image_url?: { url?: unknown } };
	if (p?.type !== 'image_url' || typeof p.image_url?.url !== 'string') return null;
	return p.image_url.url.startsWith(AGENT_ASSET_PREFIX) ? p.image_url.url : null;
}

/** Any failure degrades this one image to a text part, so the turn still runs. */
async function loadAsset(url: string, bucket: AssetBucket, cache: AssetCache): Promise<Inlined> {
	const key = agentAssetKey(url);
	if (!key || !isInlinableAssetKey(key)) return UNAVAILABLE;
	const cached = cache.get(key);
	if (cached) return { kind: 'data', dataUrl: cached };
	try {
		const object = await bucket.get(key);
		if (!object) return UNAVAILABLE;
		if (object.size > MAX_INLINE_IMAGE_BYTES) return { kind: 'text', text: '[image too large]' };
		const mediaType = object.httpMetadata?.contentType ?? 'image/jpeg';
		const dataUrl = `data:${mediaType};base64,${Buffer.from(await object.arrayBuffer()).toString('base64')}`;
		cache.set(key, dataUrl);
		return { kind: 'data', dataUrl };
	} catch {
		return UNAVAILABLE;
	}
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

	const urls = new Set<string>();
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const url = assetImageUrl(part);
			if (url) urls.add(url);
		}
	}
	if (urls.size === 0) return body;

	const loaded = new Map(
		await Promise.all([...urls].map(async (url) => [url, await loadAsset(url, bucket, cache)] as const)),
	);
	for (const message of json.messages) {
		const content = (message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (let i = 0; i < content.length; i++) {
			const url = assetImageUrl(content[i]);
			const inlined = url ? loaded.get(url) : undefined;
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
