/**
 * Estori's CJ access token, shared by every isolate through KV. The value can spend Estori's CJ balance, so it is
 * stored encrypted with a key derived from the API key: someone who can read KV but not Worker secrets can't use it,
 * and rotating the API key simply forces a new token.
 */

export const CJ_SESSION_KEY = 'catalog:cj:session:v1';
const HKDF_SALT = 'estori-cj-session';
/** The cached token is replaced this long before CJ expires it. */
const EXPIRY_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

export interface CjTokenRecord {
	accessToken: string;
	accessTokenExpiresAt: number;
	/** Also the key CJ signs its webhooks with. */
	openId: string;
}

export interface CjSessionDeps {
	kv: Pick<KVNamespace, 'get' | 'put'>;
	apiKey: string;
	fetchToken(apiKey: string): Promise<CjTokenRecord>;
	now(): number;
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

function fromBase64(text: string): Uint8Array {
	return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

async function sealingKey(apiKey: string): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', encoder.encode(apiKey), 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(HKDF_SALT), info: encoder.encode('cj-session') },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

async function seal(apiKey: string, record: CjTokenRecord): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealingKey(apiKey), encoder.encode(JSON.stringify(record)));
	return `${toBase64(iv)}.${toBase64(new Uint8Array(sealed))}`;
}

function isTokenRecord(value: unknown): value is CjTokenRecord {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	return typeof record.accessToken === 'string' && typeof record.accessTokenExpiresAt === 'number' && typeof record.openId === 'string';
}

/** Null for anything this API key didn't seal, including values sealed with a rotated key. */
async function unseal(apiKey: string, sealed: string): Promise<CjTokenRecord | null> {
	const [iv, data] = sealed.split('.');
	if (!iv || !data) return null;
	try {
		const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await sealingKey(apiKey), fromBase64(data));
		const parsed: unknown = JSON.parse(new TextDecoder().decode(plain));
		return isTokenRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export class CjSession {
	private cached: CjTokenRecord | null = null;

	constructor(private readonly deps: CjSessionDeps) {}

	private fresh(record: CjTokenRecord | null): record is CjTokenRecord {
		return record !== null && record.accessTokenExpiresAt - EXPIRY_MARGIN_MS > this.deps.now();
	}

	async token(): Promise<CjTokenRecord> {
		if (this.fresh(this.cached)) return this.cached;
		const sealed = await this.deps.kv.get(CJ_SESSION_KEY);
		const stored = sealed ? await unseal(this.deps.apiKey, sealed) : null;
		if (this.fresh(stored)) {
			this.cached = stored;
			return stored;
		}
		return this.refresh();
	}

	/** CJ returns the same token to repeated requests within a day, so isolates refreshing together agree. */
	async refresh(): Promise<CjTokenRecord> {
		const record = await this.deps.fetchToken(this.deps.apiKey);
		const ttlSeconds = Math.floor((record.accessTokenExpiresAt - EXPIRY_MARGIN_MS - this.deps.now()) / 1000);
		if (ttlSeconds >= 60) await this.deps.kv.put(CJ_SESSION_KEY, await seal(this.deps.apiKey, record), { expirationTtl: ttlSeconds });
		this.cached = record;
		return record;
	}
}
