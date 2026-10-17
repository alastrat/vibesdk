# CJ Client and Catalog Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estori's catalog holds curated CJdropshipping products with current, per-destination catalog prices, and checkout locks those prices for catalog lines.

**Architecture:** A minimal CJ REST client (one `request` helper, an encrypted token cached in KV, one call per 1.1 s) feeds a refresh batch that writes products, variants and per-destination offers to D1 and copies images to R2. `lockCatalogPrices` reads the offers for checkout. Nothing in this plan places an order.

**Tech Stack:** Cloudflare Workers, D1 with Drizzle, KV, R2, WebCrypto (HKDF, AES-GCM), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-cjdropshipping-adapter-design.md` (owner accepted all recommendations on 2026-10-15). This is the spec's plan 1.

## Global Constraints

- The secret is `CJDROPSHIPPING_API_KEY` (the owner's name for it), declared optional in `worker/types/env.d.ts`. Without it, prices read as unavailable and the refresh skips.
- This plan calls only CJ's token, product, stock and freight endpoints. No order, no payment, no balance call.
- No credential in D1. The token lives in KV `VibecoderStore`, key `catalog:cj:session:v1`, AES-GCM-encrypted with an HKDF key derived from the API key.
- Calls are at least `CJ_MIN_CALL_INTERVAL_MS = 1100` ms apart per isolate.
- Amounts are integer US cents; CJ's decimal dollars go through `usdToCents`, never floating-point multiplication.
- Destinations: `CATALOG_DESTINATIONS = { US: { name: 'United States', origin: 'US' } }`. Offers older than 72 hours lock as unavailable. Stock below 10 at the origin is unavailable.
- No supplier name reaches sellers or shoppers: catalog text drops lines naming one (`SUPPLIER_NAMES`), and images are served from Estori.
- No `any`. Tabs in `shared/` and `worker/services/`; four spaces in `worker/database/` and `worker/api/`.
- Commits: `type(scope): lowercase subject` with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- Tests: `npx vitest run <files>` after loopback sockets drain (`netstat -an | grep -c TIME_WAIT` under 1500).

## Review Focus

1. CJ answers HTTP 200 with a non-200 `code`: an error, never data (Task 3).
2. Two isolates (or a second client) need a token: the second reads KV and never calls `getAccessToken` (Task 2).
3. CJ changes a price to a value like `"16.90"` or `16.9`: stored as exactly 1690 cents (Task 1).
4. The refresh pipeline stalls for days: checkout stops selling at prices older than 72 hours (Task 6).
5. One product's refresh fails (CJ error, removed product): the rest of the batch still refreshes, and the failure is stored on that product (Task 5).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `shared/types/catalog.ts` | Destinations and catalog status lists |
| `worker/services/catalog/config.ts` | Worker-only intervals, limits and budgets |
| `worker/services/catalog/money.ts` | `usdToCents` |
| `worker/services/catalog/cj/errors.ts` | `CjApiError`, `classifyCjError` |
| `worker/services/catalog/cj/types.ts` | CJ response shapes used here |
| `worker/services/catalog/cj/session.ts` | The encrypted token cache |
| `worker/services/catalog/cj/client.ts` | `requestCjAccessToken`, `createCjClient` |
| `worker/services/catalog/catalog-text.ts` | Plain text from CJ's HTML, without supplier names |
| `worker/services/catalog/refresh.ts` | `refreshCatalogBatch`, `chooseFreight`, `variantsFrom` |
| `worker/services/catalog/offers.ts` | `lockFromOffer`, `lockCatalogPrices` |
| `worker/services/catalog/images.ts` | Image keys and the R2 copier |
| `worker/services/catalog/curated.ts` | The curated products |
| `worker/services/catalog/scheduler.ts` | `runCatalogRefresh`, `runCatalogSchedule` |
| `worker/database/schema.ts`, `migrations/0019_*.sql` | `catalog_products`, `catalog_variants`, `catalog_variant_offers` |
| `worker/database/services/CatalogProductService.ts` | Curated rows, claims, refresh writes, offer reads |
| `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts` | Image route, admin refresh |
| `worker/index.ts` | `scheduled` |

---

### Task 1: Catalog constants and dollars to cents

**Files:**
- Modify: `shared/types/catalog.ts`
- Create: `worker/services/catalog/config.ts`, `worker/services/catalog/money.ts`
- Test: `worker/services/catalog/money.test.ts`

**Interfaces:**
- Produces: `CATALOG_DESTINATIONS`, `CATALOG_PRODUCT_STATUSES`, `CatalogProductStatus`, `CATALOG_VARIANT_STATUSES`, `CatalogVariantStatus`, `CATALOG_OFFER_UNAVAILABLE_REASONS`, `CatalogOfferUnavailableReason`; the constants in `config.ts`; `usdToCents(value: string | number): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { usdToCents } from './money';

describe('usdToCents', () => {
	it('reads decimal dollars exactly, as strings or numbers', () => {
		expect(usdToCents('4.27')).toBe(427);
		expect(usdToCents('0.1')).toBe(10);
		expect(usdToCents('16.90')).toBe(1690);
		expect(usdToCents(16.9)).toBe(1690);
		expect(usdToCents('12')).toBe(1200);
		expect(usdToCents(0)).toBe(0);
	});

	it('rounds a third decimal half up', () => {
		expect(usdToCents('3.994')).toBe(399);
		expect(usdToCents('3.995')).toBe(400);
	});

	it('refuses anything that is not one amount', () => {
		for (const value of ['', 'abc', '-1', '38.15 -- 38.20', '1e3', Number.NaN]) expect(usdToCents(value)).toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/money.test.ts`
Expected: FAIL, "Cannot find module './money'".

- [ ] **Step 3: Write the constants and the conversion**

Append to `shared/types/catalog.ts`:

```ts
/** Where catalog items ship, each from one origin warehouse country, so an order's lines share one origin. */
export const CATALOG_DESTINATIONS: Readonly<Record<string, { name: string; origin: string }>> = {
	US: { name: 'United States', origin: 'US' },
};

export const CATALOG_PRODUCT_STATUSES = ['active', 'paused', 'retired'] as const;
export type CatalogProductStatus = (typeof CATALOG_PRODUCT_STATUSES)[number];
export const CATALOG_VARIANT_STATUSES = ['active', 'retired'] as const;
export type CatalogVariantStatus = (typeof CATALOG_VARIANT_STATUSES)[number];
export const CATALOG_OFFER_UNAVAILABLE_REASONS = ['out-of-stock', 'no-shipping', 'paused', 'retired'] as const;
export type CatalogOfferUnavailableReason = (typeof CATALOG_OFFER_UNAVAILABLE_REASONS)[number];
```

`worker/services/catalog/config.ts`:

```ts
/** Worker-only catalog settings: CJ's limits, refresh budgets and selling rules. */

export const CJ_API_BASE = 'https://developers.cjdropshipping.com/api2.0/v1/';
/** CJ allows one call a second at its Free level. */
export const CJ_MIN_CALL_INTERVAL_MS = 1100;
export const CJ_THROTTLED_WAIT_MS = 1200;
export const CJ_REQUEST_TIMEOUT_MS = 15_000;
/** The refresh stops below this many points, so placements keep points for their freight quote. */
export const CJ_POINTS_RESERVE = 5000;

export const CATALOG_REFRESH_BATCH = 15;
export const CATALOG_DETAILS_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CATALOG_REFRESH_CLAIM_MS = 10 * 60 * 1000;
/** A buffer against selling the last units twice. */
export const CATALOG_MIN_STOCK = 10;
export const CATALOG_MAX_DELIVERY_DAYS: Readonly<Record<string, number>> = { US: 10 };
/** Older offers lock as unavailable: Estori stops selling at prices it can no longer vouch for. */
export const CATALOG_OFFER_MAX_AGE_MS = 72 * 60 * 60 * 1000;
export const CATALOG_MAX_IMAGES = 8;
export const CATALOG_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const CATALOG_MAX_DESCRIPTION = 5000;
```

`worker/services/catalog/money.ts`:

```ts
/** CJ's US dollars (a number or a decimal string) as whole cents, without floating-point multiplication. Null when unreadable. */
export function usdToCents(value: string | number): number | null {
	const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : value.trim();
	const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
	if (!match) return null;
	const fraction = (match[2] ?? '').padEnd(3, '0');
	const cents = Number(match[1]) * 100 + Number(fraction.slice(0, 2));
	return Number(fraction[2]) >= 5 ? cents + 1 : cents;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/money.test.ts shared/types/catalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/types/catalog.ts worker/services/catalog/config.ts worker/services/catalog/money.ts worker/services/catalog/money.test.ts
git commit -m "feat(catalog): catalog destinations, settings and exact dollar amounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CJ errors and the encrypted token cache

**Files:**
- Create: `worker/services/catalog/cj/errors.ts`, `worker/services/catalog/cj/session.ts`
- Test: `worker/services/catalog/cj/errors.test.ts`, `worker/services/catalog/cj/session.test.ts`

**Interfaces:**
- Produces:
  - `CjApiError(message, status: number, code: number | null, requestId: string | null)`; `CjErrorClass`; `classifyCjError(error: unknown): CjErrorClass`;
  - `CjTokenRecord = { accessToken: string; accessTokenExpiresAt: number; openId: string }`;
  - `CjSession` with `token(): Promise<CjTokenRecord>` and `refresh(): Promise<CjTokenRecord>`, built from `CjSessionDeps = { kv: Pick<KVNamespace, 'get' | 'put'>; apiKey: string; fetchToken(apiKey: string): Promise<CjTokenRecord>; now(): number }`; `CJ_SESSION_KEY`.

- [ ] **Step 1: Write the failing tests**

`worker/services/catalog/cj/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CjApiError, classifyCjError } from './errors';

function cj(code: number | null, status = 200, message = 'failed'): CjApiError {
	return new CjApiError(message, status, code, 'req_1');
}

describe('classifyCjError', () => {
	it('sorts every documented code into its class', () => {
		const cases: Array<[number, string]> = [
			[1600001, 'auth-token'],
			[1600002, 'auth-token'],
			[1600003, 'account'],
			[1600008, 'account'],
			[1600200, 'throttled'],
			[16900500, 'throttled'],
			[1600000, 'temporary'],
			[1600101, 'temporary'],
			[1600300, 'bad-request'],
			[16900403, 'bad-request'],
			[1602001, 'item-unavailable'],
			[10063, 'item-unavailable'],
			[1603102, 'item-unavailable'],
			[1605002, 'undeliverable'],
			[1603003, 'duplicate-order'],
			[1604000, 'insufficient-balance'],
			[1604001, 'payment-blocked'],
			[1603101, 'payment-blocked'],
		];
		for (const [code, kind] of cases) expect([code, classifyCjError(cj(code))]).toEqual([code, kind]);
	});

	it('treats HTTP 429 and the per-IP limit as throttling, and anything unknown as temporary', () => {
		expect(classifyCjError(cj(null, 429))).toBe('throttled');
		expect(classifyCjError(cj(1600000, 200, 'one ip limit reached'))).toBe('throttled');
		expect(classifyCjError(cj(999, 500))).toBe('temporary');
		expect(classifyCjError(new TypeError('fetch failed'))).toBe('temporary');
	});
});
```

`worker/services/catalog/cj/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CJ_SESSION_KEY, CjSession, type CjTokenRecord } from './session';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function fakeKv() {
	const values = new Map<string, { value: string; ttl: number | undefined }>();
	const kv: Pick<KVNamespace, 'get' | 'put'> = {
		get: (async (key: string) => values.get(key)?.value ?? null) as KVNamespace['get'],
		put: async (key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: KVNamespacePutOptions) => {
			values.set(key, { value: String(value), ttl: options?.expirationTtl });
		},
	};
	return { kv, values };
}

function tokenSource(record: CjTokenRecord) {
	let calls = 0;
	return {
		fetchToken: async () => {
			calls += 1;
			return { ...record, accessToken: `${record.accessToken}-${calls}` };
		},
		calls: () => calls,
	};
}

const RECORD: CjTokenRecord = { accessToken: 'cj-token', accessTokenExpiresAt: NOW + 180 * DAY, openId: '1234567' };

describe('CjSession', () => {
	it('fetches a token once and shares it with every later session through KV', async () => {
		const { kv } = fakeKv();
		const source = tokenSource(RECORD);
		const first = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });
		const second = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });

		expect((await first.token()).accessToken).toBe('cj-token-1');
		expect((await first.token()).accessToken).toBe('cj-token-1');
		expect((await second.token()).accessToken).toBe('cj-token-1');
		expect(source.calls()).toBe(1);
	});

	it('stores only ciphertext, which another API key cannot read', async () => {
		const { kv, values } = fakeKv();
		const source = tokenSource(RECORD);
		await new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW }).token();

		const stored = values.get(CJ_SESSION_KEY);
		expect(stored?.value).not.toContain('cj-token');
		expect(stored?.value).not.toContain('1234567');
		// The entry expires 7 days before the token does.
		expect(stored?.ttl).toBe((180 - 7) * 24 * 60 * 60);

		const rotated = new CjSession({ kv, apiKey: 'key-2', fetchToken: source.fetchToken, now: () => NOW });
		expect((await rotated.token()).accessToken).toBe('cj-token-2');
		expect(source.calls()).toBe(2);
	});

	it('fetches a new token on refresh, and when the stored one is about to expire', async () => {
		const { kv } = fakeKv();
		const source = tokenSource(RECORD);
		const session = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW });
		await session.token();
		expect((await session.refresh()).accessToken).toBe('cj-token-2');

		const late = new CjSession({ kv, apiKey: 'key-1', fetchToken: source.fetchToken, now: () => NOW + 175 * DAY });
		expect((await late.token()).accessToken).toBe('cj-token-3');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/services/catalog/cj/errors.test.ts worker/services/catalog/cj/session.test.ts`
Expected: FAIL, "Cannot find module './errors'" and "./session".

- [ ] **Step 3: Write the errors and the session**

`worker/services/catalog/cj/errors.ts`:

```ts
/** CJ's failures, and what each means for the caller. */

export class CjApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: number | null,
		readonly requestId: string | null,
	) {
		super(message);
		this.name = 'CjApiError';
	}
}

export type CjErrorClass =
	| 'auth-token'
	| 'account'
	| 'throttled'
	| 'temporary'
	| 'bad-request'
	| 'item-unavailable'
	| 'undeliverable'
	| 'duplicate-order'
	| 'insufficient-balance'
	| 'payment-blocked';

const CODE_CLASSES: ReadonlyArray<readonly [readonly number[], CjErrorClass]> = [
	[[1600001, 1600002], 'auth-token'],
	[[1600003, 1600004, 1600005, 1600006, 1600007, 1600008], 'account'],
	[[1600200, 16900500, 429], 'throttled'],
	[[1600000, 1600301, 1608002, 1610001, 1600100, 1600101], 'temporary'],
	[[1600300, 16900202, 16900203, 16900204, 16900205, 16900403], 'bad-request'],
	[[1602000, 1602001, 1602002, 1602003, 10063, 1603102], 'item-unavailable'],
	[[1605000, 1605001, 1605002], 'undeliverable'],
	[[1603003], 'duplicate-order'],
	[[1604000], 'insufficient-balance'],
	[[1604001, 1603101], 'payment-blocked'],
];

/** Network errors and timeouts are temporary, as is any code CJ hasn't documented. */
export function classifyCjError(error: unknown): CjErrorClass {
	if (!(error instanceof CjApiError)) return 'temporary';
	if (error.status === 429 || /one ip limit/i.test(error.message)) return 'throttled';
	const code = error.code;
	if (code === null) return 'temporary';
	return CODE_CLASSES.find(([codes]) => codes.includes(code))?.[1] ?? 'temporary';
}
```

`worker/services/catalog/cj/session.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run worker/services/catalog/cj/errors.test.ts worker/services/catalog/cj/session.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/cj/errors.ts worker/services/catalog/cj/errors.test.ts worker/services/catalog/cj/session.ts worker/services/catalog/cj/session.test.ts
git commit -m "feat(catalog): cj error classes and an encrypted token cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The CJ client

**Files:**
- Create: `worker/services/catalog/cj/types.ts`, `worker/services/catalog/cj/client.ts`
- Modify: `worker/types/env.d.ts` (`CJDROPSHIPPING_API_KEY?: string`)
- Test: `worker/services/catalog/cj/client.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - CJ types `CjProduct`, `CjVariant`, `CjInventory`, `CjFreightOption`, `CjFreightRequest`;
  - `requestCjAccessToken(apiKey: string, fetchImpl?: typeof fetch): Promise<CjTokenRecord>`;
  - `CjClient = { queryProduct(pid: string): Promise<CjProduct>; inventoryByPid(pid: string): Promise<CjInventory>; freightCalculate(input: CjFreightRequest): Promise<CjFreightOption[]>; pointsRemaining(): number | null }`;
  - `createCjClient(deps: CjClientDeps): CjClient` with `CjClientDeps = { session: Pick<CjSession, 'token' | 'refresh'>; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; minIntervalMs?: number }`; `cjClientFromEnv(env: Env): CjClient | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createCjClient, requestCjAccessToken } from './client';
import { CjApiError } from './errors';
import type { CjTokenRecord } from './session';

const TOKEN: CjTokenRecord = { accessToken: 'tok-1', accessTokenExpiresAt: 1_900_000_000_000, openId: '42' };

function scriptedFetch(answers: Array<{ status?: number; body: unknown }>) {
	const calls: Array<{ url: string; method: string; token: string | null; body: string | null }> = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		calls.push({
			url: String(input),
			method: init?.method ?? 'GET',
			token: new Headers(init?.headers).get('CJ-Access-Token'),
			body: typeof init?.body === 'string' ? init.body : null,
		});
		const answer = answers.shift();
		if (!answer) throw new Error('No scripted answer left');
		return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
	};
	return { calls, fakeFetch };
}

function fakeSession() {
	let refreshes = 0;
	return {
		session: {
			token: async () => TOKEN,
			refresh: async () => {
				refreshes += 1;
				return { ...TOKEN, accessToken: `tok-${refreshes + 1}` };
			},
		},
		refreshes: () => refreshes,
	};
}

function clock() {
	let now = 0;
	const sleeps: number[] = [];
	return {
		now: () => now,
		sleep: async (ms: number) => {
			sleeps.push(ms);
			now += ms;
		},
		sleeps,
	};
}

const OK = (data: unknown) => ({ body: { code: 200, result: true, message: 'Success', data, requestId: 'r1', pointsInfo: { remaining: 49_000 } } });

describe('createCjClient', () => {
	it('sends the token, reads the data and remembers the points left', async () => {
		const { calls, fakeFetch } = scriptedFetch([OK({ pid: 'p1', variants: [] })]);
		const time = clock();
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, ...time });

		expect(await client.queryProduct('p1')).toEqual({ pid: 'p1', variants: [] });
		expect(calls[0]).toMatchObject({ url: 'https://developers.cjdropshipping.com/api2.0/v1/product/query?pid=p1', method: 'GET', token: 'tok-1' });
		expect(client.pointsRemaining()).toBe(49_000);
	});

	it('treats HTTP 200 with a failing code as an error', async () => {
		const { fakeFetch } = scriptedFetch([{ body: { code: 1602001, result: false, message: 'Product removed', data: null, requestId: 'r2' } }]);
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, ...clock() });

		const error = await client.queryProduct('p1').catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CjApiError);
		expect(error).toMatchObject({ code: 1602001, requestId: 'r2' });
	});

	it('fetches a new token once when CJ refuses the current one', async () => {
		const { calls, fakeFetch } = scriptedFetch([
			{ body: { code: 1600001, result: false, message: 'Invalid token', data: null } },
			OK([]),
		]);
		const { session, refreshes } = fakeSession();
		const client = createCjClient({ session, fetchImpl: fakeFetch, ...clock() });

		await client.freightCalculate({ startCountryCode: 'US', endCountryCode: 'US', products: [{ vid: 'v1', quantity: 1 }] });
		expect(refreshes()).toBe(1);
		expect(calls.map((call) => call.token)).toEqual(['tok-1', 'tok-2']);
		expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ startCountryCode: 'US', endCountryCode: 'US', products: [{ vid: 'v1', quantity: 1 }] });
	});

	it('waits and repeats once when throttled, and spaces every call', async () => {
		const { fakeFetch } = scriptedFetch([{ status: 429, body: { code: 1600200, message: 'Too many requests' } }, OK({ pid: 'p1' }), OK({ pid: 'p2' })]);
		const time = clock();
		const client = createCjClient({ session: fakeSession().session, fetchImpl: fakeFetch, minIntervalMs: 1100, ...time });

		await client.queryProduct('p1');
		await client.queryProduct('p2');
		expect(time.sleeps).toEqual([1200, 1100, 1100]);
	});
});

describe('requestCjAccessToken', () => {
	it('reads the token, its expiry and the open id', async () => {
		const { calls, fakeFetch } = scriptedFetch([OK({ accessToken: 'tok-9', accessTokenExpiryDate: '2027-04-14T05:27:03+08:00', openId: 1234567 })]);
		expect(await requestCjAccessToken('key-1', fakeFetch)).toEqual({ accessToken: 'tok-9', accessTokenExpiresAt: Date.parse('2027-04-14T05:27:03+08:00'), openId: '1234567' });
		expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ apiKey: 'key-1' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/cj/client.test.ts`
Expected: FAIL, "Cannot find module './client'".

- [ ] **Step 3: Write the types and the client**

`worker/services/catalog/cj/types.ts`:

```ts
/** The parts of CJ's API 2.0 responses Estori reads. CJ sends some numbers as strings. */

export interface CjVariant {
	vid: string;
	variantSku: string | null;
	variantNameEn: string | null;
	variantKey: string | null;
	variantImage: string | null;
	variantWeight: number | string | null;
	variantSellPrice: number | string;
}

export interface CjProduct {
	pid: string;
	productNameEn: string;
	productSku: string | null;
	/** 3 is on sale. */
	status: string | number;
	categoryName: string | null;
	/** Property names, such as "Color" or "Color-Size". */
	productKeyEn: string | null;
	productImageSet: string[] | null;
	/** A JSON array of addresses, when productImageSet is missing. */
	productImage: string | null;
	description: string | null;
	materialNameEn: string[] | string | null;
	variants: CjVariant[];
}

export interface CjInventory {
	variantInventories: Array<{ vid: string; inventory: Array<{ countryCode: string; totalInventory: number }> }> | null;
}

export interface CjFreightRequest {
	startCountryCode: string;
	endCountryCode: string;
	zip?: string;
	products: Array<{ vid: string; quantity: number }>;
}

export interface CjFreightOption {
	logisticName: string;
	/** Delivery days, such as "3-5". */
	logisticAging: string | null;
	/** US dollars, including taxes and clearance. */
	totalPostageFee: number | string | null;
	logisticPrice: number | string | null;
}
```

`worker/services/catalog/cj/client.ts`:

```ts
/** A minimal CJ API 2.0 client: one request helper, the session's token, spaced calls. Read-only endpoints in this file. */

import { CJ_API_BASE, CJ_MIN_CALL_INTERVAL_MS, CJ_REQUEST_TIMEOUT_MS, CJ_THROTTLED_WAIT_MS } from '../config';
import { CjApiError, classifyCjError } from './errors';
import { CjSession, type CjTokenRecord } from './session';
import type { CjFreightOption, CjFreightRequest, CjInventory, CjProduct } from './types';

interface CjEnvelope<T> {
	code: number;
	message: string;
	data: T;
	requestId?: string;
	pointsInfo?: { remaining?: number };
}

export interface CjClient {
	queryProduct(pid: string): Promise<CjProduct>;
	inventoryByPid(pid: string): Promise<CjInventory>;
	freightCalculate(input: CjFreightRequest): Promise<CjFreightOption[]>;
	/** The points CJ last reported left today, or null before any call. */
	pointsRemaining(): number | null;
}

export interface CjClientDeps {
	session: Pick<CjSession, 'token' | 'refresh'>;
	fetchImpl?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
	minIntervalMs?: number;
}

type CjRequest = { method: 'GET'; query: Record<string, string> } | { method: 'POST'; body: unknown };

/** Success is HTTP 200 with code 200; CJ's message must not be used to judge it. */
async function readEnvelope<T>(response: Response): Promise<CjEnvelope<T>> {
	let envelope: CjEnvelope<T> | null;
	try {
		envelope = (await response.json()) as CjEnvelope<T>;
	} catch {
		envelope = null;
	}
	if (response.status !== 200 || !envelope || envelope.code !== 200) {
		throw new CjApiError(envelope?.message ?? `CJ answered HTTP ${response.status}`, response.status, envelope?.code ?? null, envelope?.requestId ?? null);
	}
	return envelope;
}

export async function requestCjAccessToken(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<CjTokenRecord> {
	const response = await fetchImpl(`${CJ_API_BASE}authentication/getAccessToken`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ apiKey }),
		signal: AbortSignal.timeout(CJ_REQUEST_TIMEOUT_MS),
	});
	const { data } = await readEnvelope<{ accessToken: string; accessTokenExpiryDate: string; openId: string | number }>(response);
	return { accessToken: data.accessToken, accessTokenExpiresAt: Date.parse(data.accessTokenExpiryDate), openId: String(data.openId) };
}

export function createCjClient(deps: CjClientDeps): CjClient {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const now = deps.now ?? (() => Date.now());
	const interval = deps.minIntervalMs ?? CJ_MIN_CALL_INTERVAL_MS;
	let lastCallAt: number | null = null;
	let points: number | null = null;

	async function send<T>(path: string, request: CjRequest, accessToken: string): Promise<T> {
		const wait = lastCallAt === null ? 0 : lastCallAt + interval - now();
		if (wait > 0) await sleep(wait);
		lastCallAt = now();
		const url = request.method === 'GET' ? `${CJ_API_BASE}${path}?${new URLSearchParams(request.query)}` : `${CJ_API_BASE}${path}`;
		const response = await fetchImpl(url, {
			method: request.method,
			headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': accessToken },
			body: request.method === 'POST' ? JSON.stringify(request.body) : undefined,
			signal: AbortSignal.timeout(CJ_REQUEST_TIMEOUT_MS),
		});
		const envelope = await readEnvelope<T>(response);
		if (typeof envelope.pointsInfo?.remaining === 'number') points = envelope.pointsInfo.remaining;
		return envelope.data;
	}

	/** An invalid token gets one new token and one repeat; throttling gets one wait and one repeat. */
	async function request<T>(path: string, request: CjRequest): Promise<T> {
		const token = await deps.session.token();
		try {
			return await send<T>(path, request, token.accessToken);
		} catch (error) {
			const kind = classifyCjError(error);
			if (kind === 'auth-token') return send<T>(path, request, (await deps.session.refresh()).accessToken);
			if (kind === 'throttled') {
				await sleep(CJ_THROTTLED_WAIT_MS);
				lastCallAt = now();
				return send<T>(path, request, token.accessToken);
			}
			throw error;
		}
	}

	return {
		queryProduct: (pid) => request<CjProduct>('product/query', { method: 'GET', query: { pid } }),
		inventoryByPid: (pid) => request<CjInventory>('product/stock/getInventoryByPid', { method: 'GET', query: { pid } }),
		freightCalculate: (input) => request<CjFreightOption[]>('logistic/freightCalculate', { method: 'POST', body: input }),
		pointsRemaining: () => points,
	};
}

/** Null without the API key: catalog prices then read as unavailable. */
export function cjClientFromEnv(env: Env): CjClient | null {
	const apiKey = env.CJDROPSHIPPING_API_KEY;
	if (!apiKey) return null;
	const session = new CjSession({ kv: env.VibecoderStore, apiKey, fetchToken: (key) => requestCjAccessToken(key), now: () => Date.now() });
	return createCjClient({ session });
}
```

Add to `worker/types/env.d.ts`, after `SERPAPI_KEY: string;`:

```ts
		// The catalog supplier's API key; without it catalog prices read as unavailable.
		CJDROPSHIPPING_API_KEY?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/cj/client.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/cj/types.ts worker/services/catalog/cj/client.ts worker/services/catalog/cj/client.test.ts worker/types/env.d.ts
git commit -m "feat(catalog): a cj api client with spaced calls and one token retry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Catalog tables and their service

**Files:**
- Modify: `worker/database/schema.ts`
- Create: `migrations/0019_<generated>.sql` and meta
- Create: `worker/database/services/CatalogProductService.ts`, `worker/services/catalog/catalog-store.ts`
- Modify: `worker/database/index.ts`
- Test: `worker/database/catalog-data-schema.test.ts`, `worker/database/services/CatalogProductService.test.ts`

**Interfaces:**
- Consumes: Task 1 status lists.
- Produces (in `catalog-store.ts`):
  - `CuratedProduct = { supplierProductId: string; category: string; title?: string; paused?: boolean }`;
  - `ClaimedProduct = { id: string; supplierProductId: string; status: CatalogProductStatus; title: string | null; imageKeys: string[] }`;
  - `RefreshedVariant = { supplierVariantId: string; sku: string | null; name: string; options: Record<string, string>; imageKey: string | null; weightGrams: number; supplierCostCents: number; stock: Record<string, number>; status: CatalogVariantStatus }`;
  - `RefreshedOffer = { supplierVariantId: string; destinationCountry: string; originCountry: string; logisticName: string | null; deliveryDaysMin: number | null; deliveryDaysMax: number | null; supplierCostCents: number; shippingCents: number | null; catalogPriceCents: number | null; available: boolean; unavailableReason: CatalogOfferUnavailableReason | null }`;
  - `RefreshedProduct = { productId: string; title: string; description: string; category: string | null; imageKeys: string[]; attributes: Record<string, string>; variants: RefreshedVariant[]; offers: RefreshedOffer[]; refreshedAt: Date }`;
  - `OfferLookup = { catalogVariantId: string; supplierVariantId: string; offer: { available: boolean; catalogPriceCents: number | null; updatedAt: Date } | null }`;
  - `CatalogRefreshStore = { ensureCurated(entries: readonly CuratedProduct[], now: Date): Promise<void>; claimForRefresh(limit: number, now: Date): Promise<ClaimedProduct[]>; saveRefresh(product: RefreshedProduct): Promise<void>; recordRefreshError(productId: string, message: string, now: Date): Promise<void> }`;
  - `CatalogProductService implements CatalogRefreshStore` plus `lookupOffers(catalogVariantIds: readonly string[], country: string): Promise<OfferLookup[]>`.

- [ ] **Step 1: Write the failing tests**

`worker/database/catalog-data-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('catalog data schema', () => {
	it('keeps one row per supplier product and per supplier variant', () => {
		const products = getTableConfig(schema.catalogProducts).indexes.find((index) => index.config.name === 'catalog_products_supplier_unique_idx');
		const variants = getTableConfig(schema.catalogVariants).indexes.find((index) => index.config.name === 'catalog_variants_supplier_variant_unique_idx');
		expect(products?.config.unique).toBe(true);
		expect(variants?.config.unique).toBe(true);
	});

	it('keys offers by variant and destination', () => {
		const keys = getTableConfig(schema.catalogVariantOffers).primaryKeys[0]?.columns.map((column) => column.name);
		expect(keys).toEqual(['variant_id', 'destination_country']);
		expect(schema.catalogProducts.status.default).toBe('active');
	});

	it('ships the tables in a migration', () => {
		for (const table of ['catalog_products', 'catalog_variants', 'catalog_variant_offers']) expect(allMigrationSql).toContain(`CREATE TABLE \`${table}\``);
	});
});
```

`worker/database/services/CatalogProductService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CatalogProductService } from './CatalogProductService';
import { recordingD1 } from '../test-support/recording-d1';
import type { RefreshedProduct } from '../../services/catalog/catalog-store';

const REFRESHED: RefreshedProduct = {
	productId: 'cp_1',
	title: 'Gravity Pet Feeder',
	description: 'A feeder.',
	category: 'Pet Supplies',
	imageKeys: ['catalog/cp_1/a.jpg'],
	attributes: { Material: 'Plastic' },
	variants: [
		{ supplierVariantId: 'v1', sku: 'S1', name: 'Blue', options: { Color: 'Blue' }, imageKey: null, weightGrams: 200, supplierCostCents: 1690, stock: { US: 262 }, status: 'active' },
		{ supplierVariantId: 'v2', sku: 'S2', name: 'Pink', options: { Color: 'Pink' }, imageKey: null, weightGrams: 200, supplierCostCents: 1690, stock: { US: 258 }, status: 'active' },
	],
	offers: [
		{ supplierVariantId: 'v1', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
		{ supplierVariantId: 'v2', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
	],
	refreshedAt: new Date(1_800_000_000_000),
};

describe('CatalogProductService', () => {
	it("writes a product's refresh in one batch, one statement per row", async () => {
		const { d1, batches } = recordingD1();
		await new CatalogProductService({ DB: d1 } as unknown as Env).saveRefresh(REFRESHED);

		expect(batches).toHaveLength(1);
		const kinds = batches[0].map((entry) => entry.sql.split(' ').slice(0, 3).join(' ').toLowerCase());
		expect(kinds.filter((kind) => kind === 'insert into "catalog_variants"')).toHaveLength(2);
		expect(kinds.filter((kind) => kind === 'insert into "catalog_variant_offers"')).toHaveLength(2);
		expect(kinds[0]).toBe('update "catalog_products" set');
		expect(Math.max(...batches[0].map((entry) => entry.params.length))).toBeLessThanOrEqual(100);
	});

	it('claims the stalest active products with one update that returns them', async () => {
		const { d1, statements } = recordingD1((sql) => (sql.toLowerCase().includes('returning') ? [['cp_1', 'p1', 'active', null, '[]']] : []));
		const claimed = await new CatalogProductService({ DB: d1 } as unknown as Env).claimForRefresh(15, new Date(1_800_000_000_000));

		expect(claimed).toEqual([{ id: 'cp_1', supplierProductId: 'p1', status: 'active', title: null, imageKeys: [] }]);
		const claim = statements.find((statement) => statement.sql.toLowerCase().startsWith('update "catalog_products"'));
		expect(claim?.sql.toLowerCase()).toContain('returning');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/database/catalog-data-schema.test.ts worker/database/services/CatalogProductService.test.ts`
Expected: FAIL (no `catalogProducts` export; no `./CatalogProductService`).

- [ ] **Step 3: Add the tables**

Extend the catalog import in `schema.ts` with `CATALOG_PRODUCT_STATUSES, CATALOG_VARIANT_STATUSES, CATALOG_OFFER_UNAVAILABLE_REASONS`, and add after `storeOrderItems`:

```ts
/** Catalog products - the curated supplier products Estori sells, refreshed from the supplier. */
export const catalogProducts = sqliteTable('catalog_products', {
    id: text('id').primaryKey(),
    supplier: text('supplier', { enum: CATALOG_SUPPLIERS }).notNull(),
    supplierProductId: text('supplier_product_id').notNull(),
    status: text('status', { enum: CATALOG_PRODUCT_STATUSES }).notNull().default('active'),
    category: text('category').notNull(),
    title: text('title'),
    description: text('description'),
    // JSON arrays and objects: R2 keys of the copied images, and the supplier's English properties.
    images: text('images').notNull().default('[]'),
    attributes: text('attributes').notNull().default('{}'),
    detailsRefreshedAt: integer('details_refreshed_at', { mode: 'timestamp' }),
    refreshClaimedUntil: integer('refresh_claimed_until', { mode: 'timestamp' }),
    lastRefreshError: text('last_refresh_error'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    supplierIdx: uniqueIndex('catalog_products_supplier_unique_idx').on(table.supplier, table.supplierProductId),
    statusIdx: index('catalog_products_status_idx').on(table.status),
}));

/** Catalog variants - one per supplier variant; the id is the catalogVariantId stores and carts carry. */
export const catalogVariants = sqliteTable('catalog_variants', {
    id: text('id').primaryKey(),
    productId: text('product_id').notNull().references(() => catalogProducts.id, { onDelete: 'cascade' }),
    supplierVariantId: text('supplier_variant_id').notNull(),
    sku: text('sku'),
    name: text('name').notNull(),
    options: text('options').notNull().default('{}'),
    imageKey: text('image_key'),
    weightGrams: integer('weight_grams').notNull(),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    // JSON { countryCode: quantity } of the supplier's stock by warehouse country.
    stock: text('stock').notNull().default('{}'),
    status: text('status', { enum: CATALOG_VARIANT_STATUSES }).notNull().default('active'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    supplierVariantIdx: uniqueIndex('catalog_variants_supplier_variant_unique_idx').on(table.supplierVariantId),
    productIdx: index('catalog_variants_product_idx').on(table.productId),
}));

/** Catalog variant offers - a variant's price and availability for one destination country. */
export const catalogVariantOffers = sqliteTable('catalog_variant_offers', {
    variantId: text('variant_id').notNull().references(() => catalogVariants.id, { onDelete: 'cascade' }),
    destinationCountry: text('destination_country').notNull(),
    originCountry: text('origin_country').notNull(),
    logisticName: text('logistic_name'),
    deliveryDaysMin: integer('delivery_days_min'),
    deliveryDaysMax: integer('delivery_days_max'),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    shippingCents: integer('shipping_cents'),
    catalogPriceCents: integer('catalog_price_cents'),
    available: integer('available', { mode: 'boolean' }).notNull(),
    unavailableReason: text('unavailable_reason', { enum: CATALOG_OFFER_UNAVAILABLE_REASONS }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    pk: primaryKey({ columns: [table.variantId, table.destinationCountry] }),
}));
```

Run: `npm run db:generate -- --name catalog_data`, then apply `migrations/0019_catalog_data.sql` to the local dev D1 with sqlite3 as for 0016-0018.

- [ ] **Step 4: Write the record types and the service**

`worker/services/catalog/catalog-store.ts`:

```ts
/** What the catalog refresh and checkout read and write, independent of D1 so they are tested with fakes. */

import type { CatalogOfferUnavailableReason, CatalogProductStatus, CatalogVariantStatus } from '../../../shared/types/catalog';

export interface CuratedProduct {
	supplierProductId: string;
	category: string;
	/** Replaces the supplier's title when set. */
	title?: string;
	paused?: boolean;
}

export interface ClaimedProduct {
	id: string;
	supplierProductId: string;
	status: CatalogProductStatus;
	title: string | null;
	imageKeys: string[];
}

export interface RefreshedVariant {
	supplierVariantId: string;
	sku: string | null;
	name: string;
	options: Record<string, string>;
	imageKey: string | null;
	weightGrams: number;
	supplierCostCents: number;
	stock: Record<string, number>;
	status: CatalogVariantStatus;
}

export interface RefreshedOffer {
	supplierVariantId: string;
	destinationCountry: string;
	originCountry: string;
	logisticName: string | null;
	deliveryDaysMin: number | null;
	deliveryDaysMax: number | null;
	supplierCostCents: number;
	shippingCents: number | null;
	catalogPriceCents: number | null;
	available: boolean;
	unavailableReason: CatalogOfferUnavailableReason | null;
}

export interface RefreshedProduct {
	productId: string;
	title: string;
	description: string;
	category: string | null;
	imageKeys: string[];
	attributes: Record<string, string>;
	variants: RefreshedVariant[];
	offers: RefreshedOffer[];
	refreshedAt: Date;
}

export interface OfferLookup {
	catalogVariantId: string;
	supplierVariantId: string;
	/** Null when the variant has no offer for the destination. */
	offer: { available: boolean; catalogPriceCents: number | null; updatedAt: Date } | null;
}

export interface CatalogRefreshStore {
	ensureCurated(entries: readonly CuratedProduct[], now: Date): Promise<void>;
	claimForRefresh(limit: number, now: Date): Promise<ClaimedProduct[]>;
	saveRefresh(product: RefreshedProduct): Promise<void>;
	recordRefreshError(productId: string, message: string, now: Date): Promise<void>;
}
```

`worker/database/services/CatalogProductService.ts`:

```ts
/** D1 reads and writes for catalog products, variants and offers. */

import { and, asc, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { CATALOG_DETAILS_MAX_AGE_MS, CATALOG_REFRESH_CLAIM_MS } from '../../services/catalog/config';
import type { CatalogRefreshStore, ClaimedProduct, CuratedProduct, OfferLookup, RefreshedProduct } from '../../services/catalog/catalog-store';

function imageKeysOf(images: string): string[] {
    const parsed: unknown = JSON.parse(images);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
}

export class CatalogProductService extends BaseService implements CatalogRefreshStore {
    /** Adds curated products not yet in the catalog, pauses or reactivates listed ones, and retires the rest. */
    async ensureCurated(entries: readonly CuratedProduct[], now: Date): Promise<void> {
        const ids = entries.map((entry) => entry.supplierProductId);
        const statements = entries.map((entry) =>
            this.database
                .insert(schema.catalogProducts)
                .values({
                    id: generateId(),
                    supplier: 'cjdropshipping',
                    supplierProductId: entry.supplierProductId,
                    status: entry.paused ? 'paused' : 'active',
                    category: entry.category,
                    title: entry.title ?? null,
                    createdAt: now,
                    updatedAt: now,
                })
                .onConflictDoUpdate({
                    target: [schema.catalogProducts.supplier, schema.catalogProducts.supplierProductId],
                    set: { status: entry.paused ? 'paused' : 'active', category: entry.category, title: entry.title ?? null, updatedAt: now },
                }),
        );
        const retire = this.database
            .update(schema.catalogProducts)
            .set({ status: 'retired', updatedAt: now })
            .where(ids.length > 0 ? notInArray(schema.catalogProducts.supplierProductId, ids) : sql`1 = 1`);
        await this.database.batch([retire, ...statements]);
    }

    /** Claims the stalest products due for a refresh, so overlapping runs never refresh the same one. */
    async claimForRefresh(limit: number, now: Date): Promise<ClaimedProduct[]> {
        const due = this.database
            .select({ id: schema.catalogProducts.id })
            .from(schema.catalogProducts)
            .where(
                and(
                    inArray(schema.catalogProducts.status, ['active', 'paused']),
                    or(isNull(schema.catalogProducts.refreshClaimedUntil), lt(schema.catalogProducts.refreshClaimedUntil, now)),
                    or(isNull(schema.catalogProducts.detailsRefreshedAt), lt(schema.catalogProducts.detailsRefreshedAt, new Date(now.getTime() - CATALOG_DETAILS_MAX_AGE_MS))),
                ),
            )
            .orderBy(asc(sql`coalesce(${schema.catalogProducts.detailsRefreshedAt}, 0)`))
            .limit(limit);
        const rows = await this.database
            .update(schema.catalogProducts)
            .set({ refreshClaimedUntil: new Date(now.getTime() + CATALOG_REFRESH_CLAIM_MS) })
            .where(inArray(schema.catalogProducts.id, due))
            .returning({
                id: schema.catalogProducts.id,
                supplierProductId: schema.catalogProducts.supplierProductId,
                status: schema.catalogProducts.status,
                title: schema.catalogProducts.title,
                images: schema.catalogProducts.images,
            });
        return rows.map(({ images, ...row }) => ({ ...row, imageKeys: imageKeysOf(images) }));
    }

    /** One batch per product: the product, each variant and each offer in its own statement (D1 binds at most 100 parameters). */
    async saveRefresh(product: RefreshedProduct): Promise<void> {
        const at = product.refreshedAt;
        const existing = await this.database
            .select({ id: schema.catalogVariants.id, supplierVariantId: schema.catalogVariants.supplierVariantId })
            .from(schema.catalogVariants)
            .where(eq(schema.catalogVariants.productId, product.productId))
            .all();
        const variantIds = new Map(existing.map((variant) => [variant.supplierVariantId, variant.id]));
        for (const variant of product.variants) if (!variantIds.has(variant.supplierVariantId)) variantIds.set(variant.supplierVariantId, generateId());
        const listed = new Set(product.variants.map((variant) => variant.supplierVariantId));

        const updateProduct = this.database
            .update(schema.catalogProducts)
            .set({
                title: product.title,
                description: product.description,
                category: product.category ?? undefined,
                images: JSON.stringify(product.imageKeys),
                attributes: JSON.stringify(product.attributes),
                detailsRefreshedAt: at,
                refreshClaimedUntil: null,
                lastRefreshError: null,
                updatedAt: at,
            })
            .where(eq(schema.catalogProducts.id, product.productId));
        const variants = product.variants.map((variant) => {
            const row = {
                sku: variant.sku,
                name: variant.name,
                options: JSON.stringify(variant.options),
                imageKey: variant.imageKey,
                weightGrams: variant.weightGrams,
                supplierCostCents: variant.supplierCostCents,
                stock: JSON.stringify(variant.stock),
                status: variant.status,
                updatedAt: at,
            };
            return this.database
                .insert(schema.catalogVariants)
                .values({ ...row, id: variantIds.get(variant.supplierVariantId) ?? generateId(), productId: product.productId, supplierVariantId: variant.supplierVariantId })
                .onConflictDoUpdate({ target: schema.catalogVariants.supplierVariantId, set: row });
        });
        const offers = product.offers.flatMap((offer) => {
            const variantId = variantIds.get(offer.supplierVariantId);
            if (!variantId) return [];
            const row = {
                originCountry: offer.originCountry,
                logisticName: offer.logisticName,
                deliveryDaysMin: offer.deliveryDaysMin,
                deliveryDaysMax: offer.deliveryDaysMax,
                supplierCostCents: offer.supplierCostCents,
                shippingCents: offer.shippingCents,
                catalogPriceCents: offer.catalogPriceCents,
                available: offer.available,
                unavailableReason: offer.unavailableReason,
                updatedAt: at,
            };
            return [
                this.database
                    .insert(schema.catalogVariantOffers)
                    .values({ ...row, variantId, destinationCountry: offer.destinationCountry })
                    .onConflictDoUpdate({ target: [schema.catalogVariantOffers.variantId, schema.catalogVariantOffers.destinationCountry], set: row }),
            ];
        });
        // Variants the supplier no longer lists are retired, with their offers unavailable.
        const gone = existing.filter((variant) => !listed.has(variant.supplierVariantId)).map((variant) => variant.id);
        const retire = gone.flatMap((variantId) => [
            this.database.update(schema.catalogVariants).set({ status: 'retired', updatedAt: at }).where(eq(schema.catalogVariants.id, variantId)),
            this.database
                .update(schema.catalogVariantOffers)
                .set({ available: false, unavailableReason: 'retired', updatedAt: at })
                .where(eq(schema.catalogVariantOffers.variantId, variantId)),
        ]);
        await this.database.batch([updateProduct, ...variants, ...offers, ...retire]);
    }

    async recordRefreshError(productId: string, message: string, now: Date): Promise<void> {
        await this.database
            .update(schema.catalogProducts)
            .set({ lastRefreshError: message.slice(0, 500), refreshClaimedUntil: null, updatedAt: now })
            .where(eq(schema.catalogProducts.id, productId));
    }

    async lookupOffers(catalogVariantIds: readonly string[], country: string): Promise<OfferLookup[]> {
        if (catalogVariantIds.length === 0) return [];
        const rows = await this.database
            .select({
                catalogVariantId: schema.catalogVariants.id,
                supplierVariantId: schema.catalogVariants.supplierVariantId,
                available: schema.catalogVariantOffers.available,
                catalogPriceCents: schema.catalogVariantOffers.catalogPriceCents,
                updatedAt: schema.catalogVariantOffers.updatedAt,
            })
            .from(schema.catalogVariants)
            .leftJoin(
                schema.catalogVariantOffers,
                and(eq(schema.catalogVariantOffers.variantId, schema.catalogVariants.id), eq(schema.catalogVariantOffers.destinationCountry, country)),
            )
            .where(inArray(schema.catalogVariants.id, [...catalogVariantIds]))
            .all();
        return rows.map((row) => ({
            catalogVariantId: row.catalogVariantId,
            supplierVariantId: row.supplierVariantId,
            offer: row.available === null || row.updatedAt === null ? null : { available: row.available, catalogPriceCents: row.catalogPriceCents, updatedAt: row.updatedAt },
        }));
    }
}
```

Export it from `worker/database/index.ts` next to `CatalogOrderService`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run worker/database/catalog-data-schema.test.ts worker/database/services/CatalogProductService.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add worker/database/schema.ts migrations/0019_catalog_data.sql migrations/meta worker/database/catalog-data-schema.test.ts worker/services/catalog/catalog-store.ts worker/database/services/CatalogProductService.ts worker/database/services/CatalogProductService.test.ts worker/database/index.ts
git commit -m "feat(catalog): catalog products, variants and offers on d1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Refreshing products from CJ

**Files:**
- Create: `worker/services/catalog/catalog-text.ts`, `worker/services/catalog/refresh.ts`
- Modify: `tsconfig.worker.json` (include `./src/routes/copy-rules.ts`)
- Test: `worker/services/catalog/refresh.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces:
  - `catalogText(html: string | null): string` (plain text, no supplier names, at most 5,000 characters);
  - `chooseFreight(options: readonly CjFreightOption[], maxDays: number): ChosenFreight | null` with `ChosenFreight = { logisticName: string; shippingCents: number; daysMin: number | null; daysMax: number | null }`;
  - `RefreshDeps = { client: Pick<CjClient, 'queryProduct' | 'inventoryByPid' | 'freightCalculate' | 'pointsRemaining'>; store: CatalogRefreshStore; images: { copy(productId: string, sourceUrl: string): Promise<string | null> }; now(): number }`;
  - `refreshCatalogBatch(deps, limit?: number): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { catalogText } from './catalog-text';
import { chooseFreight, refreshCatalogBatch, type RefreshDeps } from './refresh';
import type { CatalogRefreshStore, ClaimedProduct, RefreshedProduct } from './catalog-store';
import type { CjFreightOption, CjProduct } from './cj/types';

const NOW = 1_800_000_000_000;

const PRODUCT: CjProduct = {
	pid: 'p1',
	productNameEn: 'Gravity Pet Feeder Water Dispenser',
	productSku: 'CJFT1',
	status: '3',
	categoryName: 'Pet Supplies / Feeding',
	productKeyEn: 'Color',
	productImageSet: ['https://cf.example/a.jpg', 'https://cf.example/b.jpg'],
	productImage: null,
	description: '<p><b>Overview:</b></p><p>Feeds and waters.</p><p>Ships from CJdropshipping.</p>',
	materialNameEn: ['Plastic'],
	variants: [
		{ vid: 'v-blue', variantSku: 'S1', variantNameEn: '', variantKey: 'Blue', variantImage: 'https://cf.example/blue.jpg', variantWeight: 200, variantSellPrice: 16.9 },
		{ vid: 'v-pink', variantSku: 'S2', variantNameEn: 'Pink', variantKey: 'Pink', variantImage: null, variantWeight: '200', variantSellPrice: '16.90' },
	],
};

function fakeStore(claimed: ClaimedProduct[]) {
	const saved: RefreshedProduct[] = [];
	const errors: Array<{ productId: string; message: string }> = [];
	const store: CatalogRefreshStore = {
		ensureCurated: async () => {},
		claimForRefresh: async () => claimed,
		saveRefresh: async (product) => {
			saved.push(product);
		},
		recordRefreshError: async (productId, message) => {
			errors.push({ productId, message });
		},
	};
	return { store, saved, errors };
}

function deps(store: CatalogRefreshStore, overrides: Partial<RefreshDeps['client']> = {}): RefreshDeps {
	return {
		store,
		now: () => NOW,
		images: { copy: async (productId, url) => `catalog/${productId}/${url.split('/').pop()}` },
		client: {
			queryProduct: async () => PRODUCT,
			inventoryByPid: async () => ({ variantInventories: [{ vid: 'v-blue', inventory: [{ countryCode: 'US', totalInventory: 262 }] }, { vid: 'v-pink', inventory: [{ countryCode: 'US', totalInventory: 4 }] }] }),
			freightCalculate: async () => [{ logisticName: 'USPS US to US', logisticAging: '3-5', totalPostageFee: 0, logisticPrice: 0 }],
			pointsRemaining: () => 40_000,
			...overrides,
		},
	};
}

const CLAIMED: ClaimedProduct = { id: 'cp_1', supplierProductId: 'p1', status: 'active', title: null, imageKeys: [] };

describe('refreshCatalogBatch', () => {
	it('prices every variant for each destination, and holds back stock under the buffer', async () => {
		const { store, saved } = fakeStore([CLAIMED]);
		expect(await refreshCatalogBatch(deps(store))).toEqual({ refreshed: 1, failed: 0, stoppedForPoints: false });

		const product = saved[0];
		expect(product).toMatchObject({ productId: 'cp_1', title: 'Gravity Pet Feeder Water Dispenser', category: 'Pet Supplies / Feeding', attributes: { Material: 'Plastic' } });
		expect(product.imageKeys).toEqual(['catalog/cp_1/a.jpg', 'catalog/cp_1/b.jpg']);
		expect(product.variants.map((variant) => [variant.supplierVariantId, variant.name, variant.options, variant.supplierCostCents, variant.stock, variant.imageKey])).toEqual([
			['v-blue', 'Blue', { Color: 'Blue' }, 1690, { US: 262 }, 'catalog/cp_1/blue.jpg'],
			['v-pink', 'Pink', { Color: 'Pink' }, 1690, { US: 4 }, null],
		]);
		expect(product.offers).toEqual([
			{ supplierVariantId: 'v-blue', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS US to US', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: true, unavailableReason: null },
			{ supplierVariantId: 'v-pink', destinationCountry: 'US', originCountry: 'US', logisticName: 'USPS US to US', deliveryDaysMin: 3, deliveryDaysMax: 5, supplierCostCents: 1690, shippingCents: 0, catalogPriceCents: 2028, available: false, unavailableReason: 'out-of-stock' },
		]);
		expect(product.description).toBe('Overview: Feeds and waters.');
	});

	it('marks offers unavailable when no shipping option delivers in time, or the product is paused or off sale', async () => {
		const slow = fakeStore([CLAIMED]);
		await refreshCatalogBatch(deps(slow.store, { freightCalculate: async () => [{ logisticName: 'Slow Post', logisticAging: '12-20', totalPostageFee: 2, logisticPrice: 2 }] }));
		expect(slow.saved[0].offers.map((offer) => [offer.available, offer.unavailableReason, offer.catalogPriceCents])).toEqual([
			[false, 'no-shipping', null],
			[false, 'no-shipping', null],
		]);

		const paused = fakeStore([{ ...CLAIMED, status: 'paused' }]);
		await refreshCatalogBatch(deps(paused.store));
		expect(paused.saved[0].offers.every((offer) => !offer.available && offer.unavailableReason === 'paused')).toBe(true);

		const offSale = fakeStore([CLAIMED]);
		await refreshCatalogBatch(deps(offSale.store, { queryProduct: async () => ({ ...PRODUCT, status: '2' }) }));
		expect(offSale.saved[0].variants.every((variant) => variant.status === 'retired')).toBe(true);
		expect(offSale.saved[0].offers.every((offer) => offer.unavailableReason === 'retired')).toBe(true);
	});

	it('records a failing product and carries on with the rest', async () => {
		const { store, saved, errors } = fakeStore([CLAIMED, { ...CLAIMED, id: 'cp_2', supplierProductId: 'p2' }]);
		const result = await refreshCatalogBatch(
			deps(store, {
				queryProduct: async (pid) => {
					if (pid === 'p1') throw new Error('Product removed');
					return { ...PRODUCT, pid };
				},
			}),
		);
		expect(result).toEqual({ refreshed: 1, failed: 1, stoppedForPoints: false });
		expect(errors).toEqual([{ productId: 'cp_1', message: 'Product removed' }]);
		expect(saved.map((product) => product.productId)).toEqual(['cp_2']);
	});

	it('stops before the points reserve', async () => {
		const { store, saved } = fakeStore([CLAIMED, { ...CLAIMED, id: 'cp_2' }]);
		const result = await refreshCatalogBatch(deps(store, { pointsRemaining: () => 4_000 }));
		expect(result).toEqual({ refreshed: 0, failed: 0, stoppedForPoints: true });
		expect(saved).toHaveLength(0);
	});
});

describe('chooseFreight', () => {
	const options: CjFreightOption[] = [
		{ logisticName: 'Fast', logisticAging: '2-3', totalPostageFee: '6.50', logisticPrice: '6.50' },
		{ logisticName: 'Cheap', logisticAging: '5-9', totalPostageFee: '3.10', logisticPrice: '3.10' },
		{ logisticName: 'Cheap but slow', logisticAging: '15-25', totalPostageFee: '1.00', logisticPrice: '1.00' },
		{ logisticName: 'Cheap too', logisticAging: '4-7', totalPostageFee: '3.10', logisticPrice: '3.10' },
	];

	it('takes the cheapest option that arrives in time, then the quicker one', () => {
		expect(chooseFreight(options, 10)).toEqual({ logisticName: 'Cheap too', shippingCents: 310, daysMin: 4, daysMax: 7 });
		expect(chooseFreight(options, 3)).toEqual({ logisticName: 'Fast', shippingCents: 650, daysMin: 2, daysMax: 3 });
		expect(chooseFreight(options, 1)).toBeNull();
	});
});

describe('catalogText', () => {
	it('keeps plain text and drops lines naming a supplier', () => {
		expect(catalogText('<p>Soft&nbsp;cotton &amp; wool.</p><br/><p>Sold on AliExpress too.</p>')).toBe('Soft cotton & wool.');
		expect(catalogText(null)).toBe('');
		expect(catalogText(`<p>${'a'.repeat(6000)}</p>`)).toHaveLength(5000);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/refresh.test.ts`
Expected: FAIL, "Cannot find module './catalog-text'".

- [ ] **Step 3: Write the text cleaner and the refresh**

Add `"./src/routes/copy-rules.ts",` to the `include` list in `tsconfig.worker.json`, next to `./src/lib/capabilities.ts`.

`worker/services/catalog/catalog-text.ts`:

```ts
/** Catalog copy as plain text, without the supplier's name: sellers and shoppers never see who fulfills. */

import { SUPPLIER_NAMES } from '../../../src/routes/copy-rules';
import { CATALOG_MAX_DESCRIPTION } from './config';

const ENTITIES: Readonly<Record<string, string>> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

function namesSupplier(line: string): boolean {
	const lower = line.toLowerCase();
	return SUPPLIER_NAMES.some((name) => lower.includes(name)) || /\bcj\b/i.test(line);
}

export function catalogText(html: string | null): string {
	if (!html) return '';
	const lines = html
		.replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter((line) => line.length > 0 && !namesSupplier(line));
	return lines.join(' ').slice(0, CATALOG_MAX_DESCRIPTION);
}
```

`worker/services/catalog/refresh.ts`:

```ts
/**
 * One refresh run: claim the stalest products, read each from CJ (details, stock, freight per destination), copy new
 * images, and write variants and per-destination offers. A product that fails is recorded and the batch moves on.
 */

import { CATALOG_DESTINATIONS, catalogPriceCents, type CatalogOfferUnavailableReason } from '../../../shared/types/catalog';
import { catalogText } from './catalog-text';
import type { CatalogRefreshStore, ClaimedProduct, RefreshedOffer, RefreshedProduct, RefreshedVariant } from './catalog-store';
import type { CjClient } from './cj/client';
import type { CjFreightOption, CjInventory, CjProduct, CjVariant } from './cj/types';
import { CATALOG_MAX_DELIVERY_DAYS, CATALOG_MAX_IMAGES, CATALOG_MIN_STOCK, CATALOG_REFRESH_BATCH, CJ_POINTS_RESERVE } from './config';
import { usdToCents } from './money';

export interface RefreshDeps {
	client: Pick<CjClient, 'queryProduct' | 'inventoryByPid' | 'freightCalculate' | 'pointsRemaining'>;
	store: CatalogRefreshStore;
	images: { copy(productId: string, sourceUrl: string): Promise<string | null> };
	now(): number;
}

export interface ChosenFreight {
	logisticName: string;
	shippingCents: number;
	daysMin: number | null;
	daysMax: number | null;
}

const ON_SALE = '3';

function deliveryDays(aging: string | null): { min: number | null; max: number | null } {
	const numbers = (aging ?? '').match(/\d+/g)?.map(Number) ?? [];
	if (numbers.length === 0) return { min: null, max: null };
	return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/** Options that arrive within `maxDays`, cheapest first, then quickest. */
export function chooseFreight(options: readonly CjFreightOption[], maxDays: number): ChosenFreight | null {
	const candidates = options.flatMap((option) => {
		const shippingCents = usdToCents(option.totalPostageFee ?? option.logisticPrice ?? '');
		const days = deliveryDays(option.logisticAging);
		if (shippingCents === null || days.max === null || days.max > maxDays) return [];
		return [{ logisticName: option.logisticName, shippingCents, daysMin: days.min, daysMax: days.max }];
	});
	candidates.sort((a, b) => a.shippingCents - b.shippingCents || (a.daysMax ?? 0) - (b.daysMax ?? 0));
	return candidates[0] ?? null;
}

function imageUrls(product: CjProduct): string[] {
	if (product.productImageSet && product.productImageSet.length > 0) return product.productImageSet;
	try {
		const parsed: unknown = JSON.parse(product.productImage ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
	} catch {
		return [];
	}
}

function optionsOf(product: CjProduct, variant: CjVariant): Record<string, string> {
	const value = variant.variantKey ?? variant.variantNameEn ?? '';
	const names = (product.productKeyEn ?? '').split('-').map((name) => name.trim()).filter(Boolean);
	const values = value.split('-').map((part) => part.trim());
	if (names.length > 1 && names.length === values.length) return Object.fromEntries(names.map((name, index) => [name, values[index]]));
	return value ? { [names[0] ?? 'Option']: value } : {};
}

function stockOf(inventory: CjInventory, vid: string): Record<string, number> {
	const entry = inventory.variantInventories?.find((item) => item.vid === vid);
	return Object.fromEntries((entry?.inventory ?? []).map((row) => [row.countryCode, row.totalInventory]));
}

function attributesOf(product: CjProduct): Record<string, string> {
	const material = Array.isArray(product.materialNameEn) ? product.materialNameEn.join(', ') : product.materialNameEn;
	return material ? { Material: material } : {};
}

async function refreshOne(deps: RefreshDeps, claimed: ClaimedProduct): Promise<RefreshedProduct> {
	const product = await deps.client.queryProduct(claimed.supplierProductId);
	const inventory = await deps.client.inventoryByPid(claimed.supplierProductId);
	const onSale = String(product.status) === ON_SALE;

	const imageKeys = (await Promise.all(imageUrls(product).slice(0, CATALOG_MAX_IMAGES).map((url) => deps.images.copy(claimed.id, url)))).filter(
		(key): key is string => key !== null,
	);
	const variants: RefreshedVariant[] = [];
	for (const variant of product.variants) {
		const supplierCostCents = usdToCents(variant.variantSellPrice);
		if (supplierCostCents === null) continue;
		variants.push({
			supplierVariantId: variant.vid,
			sku: variant.variantSku,
			name: variant.variantNameEn || variant.variantKey || product.productNameEn,
			options: optionsOf(product, variant),
			imageKey: variant.variantImage ? await deps.images.copy(claimed.id, variant.variantImage) : null,
			weightGrams: Math.round(Number(variant.variantWeight ?? 0)) || 0,
			supplierCostCents,
			stock: stockOf(inventory, variant.vid),
			status: onSale ? 'active' : 'retired',
		});
	}

	const offers: RefreshedOffer[] = [];
	for (const [destination, { origin }] of Object.entries(CATALOG_DESTINATIONS)) {
		// Variants of the same weight share one freight quote.
		const quotes = new Map<number, ChosenFreight | null>();
		for (const variant of variants) {
			if (!quotes.has(variant.weightGrams)) {
				const options = await deps.client.freightCalculate({ startCountryCode: origin, endCountryCode: destination, products: [{ vid: variant.supplierVariantId, quantity: 1 }] });
				quotes.set(variant.weightGrams, chooseFreight(options, CATALOG_MAX_DELIVERY_DAYS[destination] ?? 10));
			}
			const freight = quotes.get(variant.weightGrams) ?? null;
			const reason: CatalogOfferUnavailableReason | null =
				variant.status === 'retired'
					? 'retired'
					: claimed.status !== 'active'
						? 'paused'
						: !freight
							? 'no-shipping'
							: (variant.stock[origin] ?? 0) < CATALOG_MIN_STOCK
								? 'out-of-stock'
								: null;
			offers.push({
				supplierVariantId: variant.supplierVariantId,
				destinationCountry: destination,
				originCountry: origin,
				logisticName: freight?.logisticName ?? null,
				deliveryDaysMin: freight?.daysMin ?? null,
				deliveryDaysMax: freight?.daysMax ?? null,
				supplierCostCents: variant.supplierCostCents,
				shippingCents: freight?.shippingCents ?? null,
				catalogPriceCents: freight ? catalogPriceCents({ supplierCostCents: variant.supplierCostCents, shippingCents: freight.shippingCents }) : null,
				available: reason === null,
				unavailableReason: reason,
			});
		}
	}

	return {
		productId: claimed.id,
		title: claimed.title ?? product.productNameEn.trim(),
		description: catalogText(product.description),
		category: product.categoryName,
		imageKeys,
		attributes: attributesOf(product),
		variants,
		offers,
		refreshedAt: new Date(deps.now()),
	};
}

export async function refreshCatalogBatch(deps: RefreshDeps, limit: number = CATALOG_REFRESH_BATCH): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean }> {
	const claimed = await deps.store.claimForRefresh(limit, new Date(deps.now()));
	let refreshed = 0;
	let failed = 0;
	for (const product of claimed) {
		const points = deps.client.pointsRemaining();
		if (points !== null && points < CJ_POINTS_RESERVE) return { refreshed, failed, stoppedForPoints: true };
		try {
			await deps.store.saveRefresh(await refreshOne(deps, product));
			refreshed += 1;
		} catch (error) {
			failed += 1;
			await deps.store.recordRefreshError(product.id, error instanceof Error ? error.message : String(error), new Date(deps.now()));
		}
	}
	return { refreshed, failed, stoppedForPoints: false };
}
```

The checks run in this order (retired, paused, no shipping, low stock), so a paused product's offers read `paused` even when freight and stock are fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run worker/services/catalog/refresh.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/catalog-text.ts worker/services/catalog/refresh.ts worker/services/catalog/refresh.test.ts tsconfig.worker.json
git commit -m "feat(catalog): refresh catalog prices, stock and shipping from cj

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Locking catalog prices for checkout

**Files:**
- Create: `worker/services/catalog/offers.ts`
- Modify: `worker/services/store-payments/catalog-locks.ts`
- Test: `worker/services/catalog/offers.test.ts`

**Interfaces:**
- Consumes: Task 4 `OfferLookup`, `CatalogProductService.lookupOffers`; `CatalogLock` from `worker/services/store-payments/pricing.ts`.
- Produces: `lockFromLookup(lookup: OfferLookup | undefined, catalogVariantId: string, nowMs: number): CatalogLock`; `lockCatalogPrices(env: Env, input: { catalogVariantIds: readonly string[]; shipToCountry: string }): Promise<readonly CatalogLock[]>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { lockFromLookup } from './offers';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('lockFromLookup', () => {
	const lookup = { catalogVariantId: 'cv_1', supplierVariantId: 'v1', offer: { available: true, catalogPriceCents: 2028, updatedAt: new Date(NOW - HOUR) } };

	it("locks an available offer's current price", () => {
		expect(lockFromLookup(lookup, 'cv_1', NOW)).toEqual({ ok: true, catalogVariantId: 'cv_1', supplier: 'cjdropshipping', supplierVariantId: 'v1', lockedCatalogPriceCents: 2028 });
	});

	it('refuses unknown variants, destinations without an offer, unavailable offers and stale prices', () => {
		expect(lockFromLookup(undefined, 'cv_x', NOW)).toEqual({ ok: false, catalogVariantId: 'cv_x', reason: 'unknown' });
		expect(lockFromLookup({ ...lookup, offer: null }, 'cv_1', NOW)).toEqual({ ok: false, catalogVariantId: 'cv_1', reason: 'ships_to_unsupported' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, available: false } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, catalogPriceCents: null } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
		expect(lockFromLookup({ ...lookup, offer: { ...lookup.offer, updatedAt: new Date(NOW - 73 * HOUR) } }, 'cv_1', NOW)).toMatchObject({ ok: false, reason: 'unavailable' });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/offers.test.ts`
Expected: FAIL, "Cannot find module './offers'".

- [ ] **Step 3: Write the locks and wire checkout to them**

`worker/services/catalog/offers.ts`:

```ts
/** Catalog prices locked for checkout, from the refreshed offers. Stale or unavailable offers never sell. */

import { CATALOG_DESTINATIONS } from '../../../shared/types/catalog';
import { CatalogProductService } from '../../database';
import type { CatalogLock } from '../store-payments/pricing';
import type { OfferLookup } from './catalog-store';
import { CATALOG_OFFER_MAX_AGE_MS } from './config';

export function lockFromLookup(lookup: OfferLookup | undefined, catalogVariantId: string, nowMs: number): CatalogLock {
	if (!lookup) return { ok: false, catalogVariantId, reason: 'unknown' };
	const offer = lookup.offer;
	if (!offer) return { ok: false, catalogVariantId, reason: 'ships_to_unsupported' };
	const stale = nowMs - offer.updatedAt.getTime() > CATALOG_OFFER_MAX_AGE_MS;
	if (!offer.available || offer.catalogPriceCents === null || stale) return { ok: false, catalogVariantId, reason: 'unavailable' };
	return { ok: true, catalogVariantId, supplier: 'cjdropshipping', supplierVariantId: lookup.supplierVariantId, lockedCatalogPriceCents: offer.catalogPriceCents };
}

export async function lockCatalogPrices(env: Env, input: { catalogVariantIds: readonly string[]; shipToCountry: string }): Promise<readonly CatalogLock[]> {
	if (!CATALOG_DESTINATIONS[input.shipToCountry]) {
		return input.catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'ships_to_unsupported' }));
	}
	const lookups = await new CatalogProductService(env).lookupOffers(input.catalogVariantIds, input.shipToCountry);
	const byId = new Map(lookups.map((lookup) => [lookup.catalogVariantId, lookup]));
	const nowMs = Date.now();
	return input.catalogVariantIds.map((catalogVariantId) => lockFromLookup(byId.get(catalogVariantId), catalogVariantId, nowMs));
}
```

Replace `worker/services/store-payments/catalog-locks.ts` with:

```ts
/** Catalog price locks for checkout, from the catalog's current offers. */

import { lockCatalogPrices } from '../catalog/offers';
import type { CatalogLock } from './pricing';

export function lockCatalogPricesFor(env: Env, catalogVariantIds: readonly string[], shipToCountry: string): Promise<readonly CatalogLock[]> {
	return lockCatalogPrices(env, { catalogVariantIds, shipToCountry });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run worker/services/catalog/offers.test.ts worker/services/store-payments`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/offers.ts worker/services/catalog/offers.test.ts worker/services/store-payments/catalog-locks.ts
git commit -m "feat(catalog): lock current catalog prices at checkout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Catalog images on R2 and the public image route

**Files:**
- Create: `worker/services/catalog/images.ts`, `worker/api/controllers/catalog/controller.ts`, `worker/api/routes/catalogRoutes.ts`
- Modify: `worker/api/routes/index.ts`
- Test: `worker/services/catalog/images.test.ts`, `worker/api/controllers/catalog/catalog-routes-wiring.test.ts`

**Interfaces:**
- Consumes: `sha256Hash` from `worker/utils/cryptoUtils.ts`.
- Produces: `catalogImageKey(productId: string, sourceUrl: string): Promise<string>`; `createImageCopier(bucket: Pick<R2Bucket, 'head' | 'put'>, fetchImpl?: typeof fetch): { copy(productId: string, sourceUrl: string): Promise<string | null> }`; `catalogImagePath(key: string): string`; `GET /api/catalog/images/:productId/:file` (public); `POST /api/admin/catalog/refresh` (admin, added in Task 8).

- [ ] **Step 1: Write the failing tests**

`worker/services/catalog/images.test.ts`:

```ts
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
```

`worker/api/controllers/catalog/catalog-routes-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/catalogRoutes.ts', '/worker/api/routes/index.ts'], { query: '?raw', import: 'default', eager: true });

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('catalog routes', () => {
	it('serves catalog images publicly and keeps catalog operations to admins', () => {
		const routes = source('/worker/api/routes/catalogRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/catalog/images/:productId/:file'"))).toContain('setAuthLevel(AuthConfig.public)');
		for (const line of routes.filter((candidate) => candidate.includes("'/api/admin/catalog/"))) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupCatalogRoutes(app)');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run worker/services/catalog/images.test.ts worker/api/controllers/catalog/catalog-routes-wiring.test.ts`
Expected: FAIL ("Cannot find module './images'"; "Source not found").

- [ ] **Step 3: Write the images module, the controller and the route**

`worker/services/catalog/images.ts`:

```ts
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
```

`worker/api/controllers/catalog/controller.ts`:

```ts
/** Catalog images for stores and shoppers, and catalog operations for admins. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FILE = /^[0-9a-f]{16}\.(jpg|jpeg|png|webp)$/;

export class CatalogController extends BaseController {
    static async serveImage(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        const { productId, file } = context.pathParams;
        if (!productId || !file || !PRODUCT_ID.test(productId) || !FILE.test(file)) {
            return new Response('Not found', { status: 404 }) as unknown as ControllerResponse<ApiResponse<never>>;
        }
        const object = await env.TEMPLATES_BUCKET.get(`catalog/${productId}/${file}`);
        if (!object) return new Response('Not found', { status: 404 }) as unknown as ControllerResponse<ApiResponse<never>>;
        return new Response(object.body, {
            headers: {
                'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Access-Control-Allow-Origin': '*',
            },
        }) as unknown as ControllerResponse<ApiResponse<never>>;
    }
}
```

(Follow `worker/api/controllers/screenshots/controller.ts` for how it returns a raw `Response` through `ControllerResponse`; match its cast if it differs.)

`worker/api/routes/catalogRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { CatalogController } from '../controllers/catalog/controller';

/** Catalog images (public, for stores and shoppers) and catalog operations (admins). */
export function setupCatalogRoutes(app: Hono<AppEnv>): void {
    app.get('/api/catalog/images/:productId/:file', setAuthLevel(AuthConfig.public), adaptController(CatalogController, CatalogController.serveImage));
}
```

Register after `setupStoreRoutes(app);` in `worker/api/routes/index.ts`:

```ts
    // Catalog images and catalog operations
    setupCatalogRoutes(app);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run worker/services/catalog/images.test.ts worker/api/controllers/catalog/catalog-routes-wiring.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/images.ts worker/services/catalog/images.test.ts worker/api/controllers/catalog worker/api/routes/catalogRoutes.ts worker/api/routes/index.ts
git commit -m "feat(catalog): serve catalog images from estori

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The curated list, the scheduled refresh and the admin trigger

**Files:**
- Create: `worker/services/catalog/curated.ts`, `worker/services/catalog/scheduler.ts`
- Modify: `worker/index.ts` (`scheduled`), `worker/api/controllers/catalog/controller.ts` (`refreshNow`), `worker/api/routes/catalogRoutes.ts`
- Test: `worker/services/catalog/curated.test.ts`

**Interfaces:**
- Consumes: Tasks 3-7.
- Produces: `CURATED_PRODUCTS: readonly CuratedProduct[]`; `runCatalogRefresh(env: Env): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean } | null>`; `runCatalogSchedule(cron: string, env: Env): Promise<void>`; `CATALOG_REFRESH_CRON = '*/15 * * * *'`; `POST /api/admin/catalog/refresh` (admin).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { CURATED_PRODUCTS } from './curated';
import { SUPPLIER_NAMES } from '../../../src/routes/copy-rules';

describe('the curated catalog', () => {
	it('lists 5 to 10 distinct supplier products, each with a category and no supplier name', () => {
		expect(CURATED_PRODUCTS.length).toBeGreaterThanOrEqual(5);
		expect(CURATED_PRODUCTS.length).toBeLessThanOrEqual(10);
		expect(new Set(CURATED_PRODUCTS.map((entry) => entry.supplierProductId)).size).toBe(CURATED_PRODUCTS.length);
		for (const entry of CURATED_PRODUCTS) {
			expect(entry.category.length).toBeGreaterThan(0);
			const text = `${entry.title ?? ''} ${entry.category}`.toLowerCase();
			for (const name of SUPPLIER_NAMES) expect(text).not.toContain(name);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/catalog/curated.test.ts`
Expected: FAIL, "Cannot find module './curated'".

- [ ] **Step 3: Write the list, the scheduler and the trigger**

`worker/services/catalog/curated.ts` (picked on 2026-10-16 from CJ's US warehouses: at least 100 units, light, not fragile, no batteries, no brand names):

```ts
/** The products Estori's catalog sells. Curation is owner-driven and reviewed in a pull request. */

import type { CuratedProduct } from './catalog-store';

export const CURATED_PRODUCTS: readonly CuratedProduct[] = [
	{ supplierProductId: '2058795311789957121', category: 'Pet supplies', title: 'Gravity Pet Feeder and Water Bowl' },
	{ supplierProductId: '1859780638086680576', category: 'Pet supplies', title: 'Adjustable Dog Training Collar' },
	{ supplierProductId: '1874633667228389377', category: 'Home and kitchen', title: 'Bathroom Corner Shelf with Hooks' },
	{ supplierProductId: '1876836104507744257', category: 'Home and kitchen', title: 'Kitchen Organizer' },
	{ supplierProductId: '2042494543935479810', category: 'Fitness', title: 'Six-Tube Pedal Resistance Band' },
	{ supplierProductId: '1955836424589574145', category: 'Desk and phone accessories', title: 'Silicone Watch Strap' },
];
```

`worker/services/catalog/scheduler.ts`:

```ts
/** Scheduled catalog work. The refresh runs every 15 minutes in production; admins can run it now. */

import { createLogger } from '../../logger';
import { CatalogProductService } from '../../database';
import { cjClientFromEnv } from './cj/client';
import { CURATED_PRODUCTS } from './curated';
import { createImageCopier } from './images';
import { refreshCatalogBatch } from './refresh';

const logger = createLogger('CatalogSchedule');

export const CATALOG_REFRESH_CRON = '*/15 * * * *';

/** Null when the supplier's API key isn't set. */
export async function runCatalogRefresh(env: Env): Promise<{ refreshed: number; failed: number; stoppedForPoints: boolean } | null> {
	const client = cjClientFromEnv(env);
	if (!client) {
		logger.warn('Catalog refresh skipped: CJDROPSHIPPING_API_KEY is not set');
		return null;
	}
	const store = new CatalogProductService(env);
	await store.ensureCurated(CURATED_PRODUCTS, new Date());
	const result = await refreshCatalogBatch({ client, store, images: createImageCopier(env.TEMPLATES_BUCKET), now: () => Date.now() });
	logger.info('Catalog refresh finished', result);
	return result;
}

export async function runCatalogSchedule(cron: string, env: Env): Promise<void> {
	if (cron === CATALOG_REFRESH_CRON) await runCatalogRefresh(env);
}
```

In `worker/index.ts`, import `runCatalogSchedule` from `./services/catalog/scheduler` and add to the `worker` object after `fetch`:

```ts
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(runCatalogSchedule(controller.cron, env));
	},
```

Add to `CatalogController`:

```ts
    /** Runs one catalog refresh now: for local runs and right after curation changes. */
    static async refreshNow(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<{ refreshed: number; failed: number; stoppedForPoints: boolean }>>> {
        try {
            const result = await runCatalogRefresh(env);
            if (!result) return this.createErrorResponse('The catalog supplier is not configured', 409);
            return this.createSuccessResponse(result);
        } catch (error) {
            return this.handleError(error, 'refresh the catalog') as ControllerResponse<ApiResponse<{ refreshed: number; failed: number; stoppedForPoints: boolean }>>;
        }
    }
```

and its route in `catalogRoutes.ts`:

```ts
    app.post('/api/admin/catalog/refresh', setAuthLevel(AuthConfig.admin), adaptController(CatalogController, CatalogController.refreshNow));
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run worker/services/catalog/curated.test.ts worker/api/controllers/catalog`
Expected: PASS.
Run: `npx tsc --noEmit -p tsconfig.worker.json`
Expected: no errors outside `packages/artifacts-viewer`.

- [ ] **Step 5: Run a refresh locally against CJ**

With the dev server on 8100 and an admin session, `POST /api/admin/catalog/refresh` twice (the batch claims up to 15 products). Expected: `refreshed` equals the curated count, D1 `catalog_variant_offers` has a priced US offer for each in-stock variant, and R2 holds the images.

- [ ] **Step 6: Commit**

```bash
git add worker/services/catalog/curated.ts worker/services/catalog/curated.test.ts worker/services/catalog/scheduler.ts worker/index.ts worker/api/controllers/catalog/controller.ts worker/api/routes/catalogRoutes.ts
git commit -m "feat(catalog): curated products, a scheduled refresh and an admin trigger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan

- **Crons in `wrangler.jsonc` and `wrangler.estori.jsonc`:** with plan 2's single config change (Durable Object binding, migration, crons), as the spec orders. Until then the refresh runs from the admin trigger.
- **Repricing every offer in D1 on each run (spec step 1):** every refresh recomputes `catalog_price_cents` from current inputs, and products refresh every 6 hours, so a margin change reaches every offer within 6 hours. Ruling in the ledger.
- **Freight quoted every 24 hours separately from details:** freight is quoted with every refresh (every 6 hours). At 6 products that costs about 100 points a day. Ruling in the ledger.
- **`getCatalogOffers` for the publish-time minimum check:** with live stores, which publish.
