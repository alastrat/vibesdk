# Stripe Connect Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the test-mode "Buy" for paid sites with Stripe Checkout payments. Sellers are paid through Stripe Connect Express accounts, and Estori keeps a 5% application fee on every sale. Admin access for alastrat@pluriza.com is guaranteed through a provider-verified email.

**Architecture:**
- **Stripe client:** a small fetch-based client in `worker/services/payments/` talks to Stripe's REST API. There is no SDK, so the lockfile doesn't change. Webhook signatures are verified with WebCrypto.
- **Sellers:** they connect an Express account through Account Links. Their payout readiness is stored in D1 and kept fresh by the `account.updated` webhook and a status endpoint.
- **Buying:** a buyer starts a Stripe Checkout session with a destination charge, an `application_fee_amount` of 5%, and `transfer_data.destination` set to the seller's account.
- **Fulfillment:** the `checkout.session.completed` webhook records the purchase, and so does a confirm call on return from Checkout. Both are idempotent on the session id.

**Tech Stack:**
- Cloudflare Workers with Hono routes, D1 and drizzle;
- the Stripe REST API, including Connect Express, Checkout and webhooks;
- React 19, TanStack Query 5 and Kumo UI;
- vitest on the Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-12-stripe-connect-payments-design.md`. It builds on `docs/superpowers/plans/2026-10-12-unified-discover.md`, which must be complete first: this plan modifies `publish.ts`, `PublishingController`, `UseSiteButton`, `PublishDialog`, `PaidListingsList` and the admin reviews page.

## Global Constraints

**Repo rules and commands:**
- Follow `CLAUDE.md`: never use `any`; the frontend imports types only from `@/api-types`; no emojis; no TODOs; keep comments concise and about purpose.
- Never stage or commit `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Commit with explicit paths. Use conventional commits with a lowercase subject (commitlint rejects sentence case), ending with the `Co-Authored-By` trailer the agent's harness gives.
- Run only the test files a step names, with `npx vitest run <files>`.
- **Typecheck:**
  - worker: `npx tsc -p tsconfig.worker.json --noEmit`, which must stay clean after every backend task;
  - app: `npx tsc -p tsconfig.app.json --noEmit`, whose only accepted errors are the 4 in `packages/artifacts-viewer`. It may fail between Task 6 and the end of Task 7 only.
- Never print, log or commit `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`. Tests use fake values such as `sk_test_fake` and `whsec_fake`.
- No new npm dependencies.

**Values from the spec, used verbatim:**
- Fee: 5% of the price, rounded to the nearest cent: `Math.round(priceCents * 5 / 100)`. For the price options this gives 900→45, 1900→95, 2900→145 and 4900→245.
- Admin emails: `['alastrat@pluriza.com']`. They are matched lowercased, only against `user_oauth_identities` rows with `email_verified = 1`.
- **Messages** (exact text):
  - `Payments aren't set up on this deployment`
  - `Connect Stripe to get paid before setting a price`
  - `This seller can't receive payments right now`
  - `Stripe couldn't complete the request; try again`
  - `You already own this site`
  - `This payment isn't complete yet`
- Currency: `usd`. The Checkout success URL is `/app/{appId}?purchase=success&session_id={CHECKOUT_SESSION_ID}` and the cancel URL is `/app/{appId}`. The onboarding return URL is `/profile?tab=paid&stripe=return` and the refresh URL is `/profile?tab=paid&stripe=refresh`.

## Review Focus

These failure modes are the most likely to hurt someone using this; each is pinned by a test in the task named.

1. **The webhook and the confirm call both record the same Checkout session:** there must be exactly one purchase row. Task 2 has the unique index on `stripe_checkout_session_id`. Task 4 has the test `fulfill.test.ts > records a session once`.
2. **A forged webhook** (wrong secret, tampered body, replayed old timestamp) must record nothing. Task 1 has `webhook.test.ts`.
3. **A buyer confirming someone else's Checkout session id** must get 403 and no purchase. Task 5 has `checkout.test.ts > refuses a session that belongs to another buyer or site`.
4. **A seller whose Stripe account can't receive transfers** must not be able to sell. A paid publish is refused (Task 5: `publish.test.ts > refuses a paid publish until the seller can receive payments`), and checkout is refused (Task 5: `checkout.test.ts > refuses checkout when the seller cannot receive transfers`).
5. **Someone who registers alastrat@pluriza.com with email and password** before the owner must not become an admin. Task 3 has `admin-access.test.ts > never grants admin from an unverified email`.

---

### Task 1: Stripe client, webhook verification and fee

**Files:**
- Create: `worker/services/payments/stripe-client.ts` and `stripe-client.test.ts`
- Create: `worker/services/payments/webhook.ts` and `webhook.test.ts`
- Modify: `shared/types/templates.ts` (add the fee)
- Modify: `worker-configuration.d.ts` (type the two secrets)

**Interfaces:**
- Produces, from `shared/types/templates.ts`:
  - `PLATFORM_FEE_PERCENT = 5`;
  - `platformFeeCents(priceCents: number): number`.
- Produces, from `stripe-client.ts`:
  - `encodeForm(params: Record<string, FormValue>): string`;
  - `class StripeApiError extends Error { status; code; type }`;
  - the interfaces `StripeAccount`, `StripeAccountLink`, `StripeLoginLink`, `StripeCheckoutSession` and `CheckoutSessionInput`;
  - `interface StripeClient`, created by `createStripeClient(secretKey: string, fetchImpl?: typeof fetch): StripeClient`;
  - `accountFlags(account: StripeAccount): SellerFlags`, where `SellerFlags = { detailsSubmitted: boolean; chargesEnabled: boolean; payoutsEnabled: boolean; transfersActive: boolean }`.
- Produces, from `webhook.ts`:
  - `verifyStripeSignature(payload: string, header: string | null, secret: string, nowSeconds: number, toleranceSeconds?: number): Promise<boolean>`;
  - `parseStripeEvent(payload: string): StripeEvent | null`.

- [ ] **Step 1: Write the failing tests**

Create `worker/services/payments/stripe-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { platformFeeCents } from '../../../shared/types/templates';
import { StripeApiError, accountFlags, createStripeClient, encodeForm, type StripeAccount } from './stripe-client';

describe('platformFeeCents', () => {
	it('keeps 5% of every price option', () => {
		expect([900, 1900, 2900, 4900].map(platformFeeCents)).toEqual([45, 95, 145, 245]);
		expect(platformFeeCents(0)).toBe(0);
	});
});

describe('encodeForm', () => {
	it('encodes nested objects and arrays the way Stripe expects', () => {
		const body = encodeForm({
			mode: 'payment',
			line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: 2900 } }],
			metadata: { appId: 'a b' },
			skipped: undefined,
			alsoSkipped: null,
		});
		expect(decodeURIComponent(body).split('&')).toEqual([
			'mode=payment',
			'line_items[0][quantity]=1',
			'line_items[0][price_data][currency]=usd',
			'line_items[0][price_data][unit_amount]=2900',
			'metadata[appId]=a b',
		]);
	});
});

describe('accountFlags', () => {
	it('reads payout readiness from the account', () => {
		const account: StripeAccount = {
			id: 'acct_1',
			details_submitted: true,
			charges_enabled: true,
			payouts_enabled: false,
			capabilities: { transfers: 'active', card_payments: 'inactive' },
		};
		expect(accountFlags(account)).toEqual({
			detailsSubmitted: true,
			chargesEnabled: true,
			payoutsEnabled: false,
			transfersActive: true,
		});
		expect(accountFlags({ ...account, capabilities: undefined }).transfersActive).toBe(false);
	});
});

describe('createStripeClient', () => {
	it('sends form-encoded requests with the secret key and parses JSON', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fakeFetch: typeof fetch = async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1', payment_status: 'unpaid', status: 'open', client_reference_id: 'u1', metadata: {}, amount_total: 2900, currency: 'usd', payment_intent: null }), { status: 200 });
		};
		const client = createStripeClient('sk_test_fake', fakeFetch);
		const session = await client.createCheckoutSession({
			productName: 'Lumen Yoga',
			priceCents: 2900,
			feeCents: 145,
			destinationAccountId: 'acct_1',
			buyerUserId: 'u1',
			buyerEmail: 'buyer@example.test',
			successUrl: 'http://localhost/app/a1?purchase=success&session_id={CHECKOUT_SESSION_ID}',
			cancelUrl: 'http://localhost/app/a1',
			metadata: { appId: 'a1' },
		});
		expect(session.id).toBe('cs_1');
		expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
		expect(calls[0].init.method).toBe('POST');
		const headers = new Headers(calls[0].init.headers);
		expect(headers.get('Authorization')).toBe('Bearer sk_test_fake');
		expect(headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		const body = decodeURIComponent(String(calls[0].init.body));
		expect(body).toContain('payment_intent_data[application_fee_amount]=145');
		expect(body).toContain('payment_intent_data[transfer_data][destination]=acct_1');
		expect(body).toContain('line_items[0][price_data][unit_amount]=2900');
		expect(body).toContain('client_reference_id=u1');
	});

	it('turns Stripe errors into StripeApiError', async () => {
		const fakeFetch: typeof fetch = async () =>
			new Response(JSON.stringify({ error: { message: 'No such account', type: 'invalid_request_error', code: 'resource_missing' } }), {
				status: 404,
			});
		const client = createStripeClient('sk_test_fake', fakeFetch);
		await expect(client.retrieveAccount('acct_missing')).rejects.toMatchObject({
			name: 'StripeApiError',
			status: 404,
			code: 'resource_missing',
		});
		await expect(client.retrieveAccount('acct_missing')).rejects.toBeInstanceOf(StripeApiError);
	});
});
```

Create `worker/services/payments/webhook.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseStripeEvent, verifyStripeSignature } from './webhook';

const SECRET = 'whsec_fake';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });

async function sign(payload: string, timestamp: number, secret = SECRET): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
	return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('verifyStripeSignature', () => {
	const now = 1_800_000_000;

	it('accepts a valid signature', async () => {
		const header = `t=${now},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(true);
	});

	it('accepts when one of several v1 signatures matches', async () => {
		const header = `t=${now},v1=${'0'.repeat(64)},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(true);
	});

	it('rejects a wrong secret, a tampered body, an old timestamp and a missing header', async () => {
		const header = `t=${now},v1=${await sign(PAYLOAD, now, 'whsec_other')}`;
		expect(await verifyStripeSignature(PAYLOAD, header, SECRET, now)).toBe(false);
		const valid = `t=${now},v1=${await sign(PAYLOAD, now)}`;
		expect(await verifyStripeSignature(PAYLOAD.replace('cs_1', 'cs_2'), valid, SECRET, now)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, valid, SECRET, now + 301)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, null, SECRET, now)).toBe(false);
		expect(await verifyStripeSignature(PAYLOAD, 'garbage', SECRET, now)).toBe(false);
	});
});

describe('parseStripeEvent', () => {
	it('reads the id, type and object of an event', () => {
		expect(parseStripeEvent(PAYLOAD)).toEqual({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
	});

	it('returns null for anything that is not an event', () => {
		expect(parseStripeEvent('not json')).toBeNull();
		expect(parseStripeEvent(JSON.stringify({ id: 'evt_1' }))).toBeNull();
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/payments/stripe-client.test.ts worker/services/payments/webhook.test.ts`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Add the fee to the shared values**

In `shared/types/templates.ts`, add after `formatTemplatePrice`:

```ts
/** Estori's share of every sale, in percent. */
export const PLATFORM_FEE_PERCENT = 5;

/** Estori's fee on a sale, rounded to the nearest cent. */
export function platformFeeCents(priceCents: number): number {
	return Math.round((priceCents * PLATFORM_FEE_PERCENT) / 100);
}
```

Change `TEMPLATE_PAYMENT_PROVIDERS` to `['test', 'stripe'] as const`, and its comment to `/** Where a purchase was paid. 'test' purchases predate Stripe and charged nothing. */`.

- [ ] **Step 4: Implement the client**

Create `worker/services/payments/stripe-client.ts`:

```ts
/**
 * Minimal Stripe REST client for Workers: form-encoded requests over fetch,
 * no SDK. Covers Connect Express onboarding and Checkout for paid sites.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

export class StripeApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | null,
		readonly type: string | null,
	) {
		super(message);
		this.name = 'StripeApiError';
	}
}

export interface StripeAccount {
	id: string;
	details_submitted: boolean;
	charges_enabled: boolean;
	payouts_enabled: boolean;
	capabilities?: { transfers?: string; card_payments?: string };
}

export interface StripeAccountLink {
	url: string;
	expires_at: number;
}

export interface StripeLoginLink {
	url: string;
}

export interface StripeCheckoutSession {
	id: string;
	url: string | null;
	payment_status: 'paid' | 'unpaid' | 'no_payment_required';
	status: 'open' | 'complete' | 'expired' | null;
	client_reference_id: string | null;
	metadata: Record<string, string> | null;
	amount_total: number | null;
	currency: string | null;
	payment_intent: string | null;
}

export interface CheckoutSessionInput {
	productName: string;
	priceCents: number;
	feeCents: number;
	destinationAccountId: string;
	buyerUserId: string;
	buyerEmail: string;
	successUrl: string;
	cancelUrl: string;
	metadata: Record<string, string>;
}

export interface SellerFlags {
	detailsSubmitted: boolean;
	chargesEnabled: boolean;
	payoutsEnabled: boolean;
	transfersActive: boolean;
}

export interface StripeClient {
	createExpressAccount(input: { email: string; userId: string }): Promise<StripeAccount>;
	retrieveAccount(accountId: string): Promise<StripeAccount>;
	createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<StripeAccountLink>;
	createLoginLink(accountId: string): Promise<StripeLoginLink>;
	createCheckoutSession(input: CheckoutSessionInput): Promise<StripeCheckoutSession>;
	retrieveCheckoutSession(sessionId: string): Promise<StripeCheckoutSession>;
}

/** Encode nested params the way Stripe expects: a[b][c]=v and a[0]=v; null and undefined are left out. */
export function encodeForm(params: Record<string, FormValue>): string {
	const pairs: string[] = [];
	const add = (key: string, value: FormValue): void => {
		if (value === undefined || value === null) return;
		if (Array.isArray(value)) {
			value.forEach((item, index) => add(`${key}[${index}]`, item));
			return;
		}
		if (typeof value === 'object') {
			for (const [child, childValue] of Object.entries(value)) add(`${key}[${child}]`, childValue);
			return;
		}
		pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
	};
	for (const [key, value] of Object.entries(params)) add(key, value);
	return pairs.join('&');
}

export function accountFlags(account: StripeAccount): SellerFlags {
	return {
		detailsSubmitted: account.details_submitted,
		chargesEnabled: account.charges_enabled,
		payoutsEnabled: account.payouts_enabled,
		transfersActive: account.capabilities?.transfers === 'active',
	};
}

interface StripeErrorBody {
	error?: { message?: string; type?: string; code?: string };
}

export function createStripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeClient {
	async function request<T>(method: 'GET' | 'POST', path: string, params?: Record<string, FormValue>): Promise<T> {
		const body = params ? encodeForm(params) : undefined;
		const response = await fetchImpl(`${STRIPE_API}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${secretKey}`,
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: method === 'POST' ? body : undefined,
		});
		const json: unknown = await response.json();
		if (!response.ok) {
			const error = (json as StripeErrorBody).error;
			throw new StripeApiError(error?.message ?? 'Stripe request failed', response.status, error?.code ?? null, error?.type ?? null);
		}
		return json as T;
	}

	return {
		createExpressAccount: ({ email, userId }) =>
			request<StripeAccount>('POST', '/accounts', {
				type: 'express',
				country: 'US',
				email,
				capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
				metadata: { estoriUserId: userId },
			}),
		retrieveAccount: (accountId) => request<StripeAccount>('GET', `/accounts/${encodeURIComponent(accountId)}`),
		createAccountLink: ({ accountId, refreshUrl, returnUrl }) =>
			request<StripeAccountLink>('POST', '/account_links', {
				account: accountId,
				refresh_url: refreshUrl,
				return_url: returnUrl,
				type: 'account_onboarding',
			}),
		createLoginLink: (accountId) =>
			request<StripeLoginLink>('POST', `/accounts/${encodeURIComponent(accountId)}/login_links`),
		createCheckoutSession: (input) =>
			request<StripeCheckoutSession>('POST', '/checkout/sessions', {
				mode: 'payment',
				line_items: [
					{
						quantity: 1,
						price_data: { currency: 'usd', unit_amount: input.priceCents, product_data: { name: input.productName } },
					},
				],
				payment_intent_data: {
					application_fee_amount: input.feeCents,
					transfer_data: { destination: input.destinationAccountId },
					metadata: input.metadata,
				},
				client_reference_id: input.buyerUserId,
				customer_email: input.buyerEmail,
				metadata: input.metadata,
				success_url: input.successUrl,
				cancel_url: input.cancelUrl,
			}),
		retrieveCheckoutSession: (sessionId) =>
			request<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`),
	};
}
```

- [ ] **Step 5: Implement webhook verification**

Create `worker/services/payments/webhook.ts`:

```ts
/** Stripe webhook signature verification (HMAC-SHA256 over "{t}.{body}") and event parsing. */

export interface StripeEvent {
	id: string;
	type: string;
	data: { object: unknown };
}

const DEFAULT_TOLERANCE_SECONDS = 300;

function toHex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compare two hex strings without exiting early on the first difference. */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}

export async function verifyStripeSignature(
	payload: string,
	header: string | null,
	secret: string,
	nowSeconds: number,
	toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
): Promise<boolean> {
	if (!header) return false;
	let timestamp: number | null = null;
	const signatures: string[] = [];
	for (const part of header.split(',')) {
		const [key, value] = part.trim().split('=', 2);
		if (key === 't' && value) timestamp = Number(value);
		if (key === 'v1' && value) signatures.push(value);
	}
	if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return false;
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const expected = toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)));
	return signatures.some((signature) => timingSafeEqual(signature, expected));
}

export function parseStripeEvent(payload: string): StripeEvent | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const event = parsed as { id?: unknown; type?: unknown; data?: { object?: unknown } };
	if (typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.data !== 'object' || event.data === null) {
		return null;
	}
	return { id: event.id, type: event.type, data: { object: event.data.object } };
}
```

- [ ] **Step 6: Type the secrets**

In `worker-configuration.d.ts`, add `STRIPE_SECRET_KEY: string;` and `STRIPE_WEBHOOK_SECRET: string;` on the lines after `JWT_SECRET: string;` in `Cloudflare.Env`. Also add `| "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET"` after `"JWT_SECRET"` in the `ProcessEnv` `Pick` list. At runtime the values may be missing on deployments without payments; code checks for an empty value.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run worker/services/payments/stripe-client.test.ts worker/services/payments/webhook.test.ts worker/database/templates-schema.test.ts`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 8: Commit**

```bash
git add shared/types/templates.ts worker/services/payments worker-configuration.d.ts
git commit -m "feat(payments): stripe client, webhook verification and the 5% fee"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 2: Payments data model and services

**Files:**
- Modify: `worker/database/schema.ts`
- Create: migration `migrations/0010_<generated>.sql` (and its meta)
- Create: `worker/database/services/StripeConnectService.ts`
- Modify: `worker/database/services/TemplateService.ts`
- Modify: `worker/database/index.ts` (export the new service)
- Test: `worker/database/payments-schema.test.ts`

**Interfaces:**
- Produces:
  - **`stripeConnectAccounts` table:** `userId` (primary key), `stripeAccountId` (unique), `detailsSubmitted`, `chargesEnabled`, `payoutsEnabled`, `transfersActive`, `createdAt` and `updatedAt`.
  - **`templatePurchases` gains:** `stripeCheckoutSessionId` (unique index), `stripePaymentIntentId`, `platformFeeCents`, `sellerAmountCents`, `currency` (default `'usd'`), `sellerStripeAccountId`, plus provenance columns `sourceAppId` and `versionId`, both nullable text.
  - **`templateVersions` gains** a partial unique index `template_versions_one_pending_idx` on `templateId` where `status = 'pending'`, so a listing can never hold two versions in review.
  - **`StripeConnectService`:** `getByUser(userId)`, `getByAccountId(accountId)`, `create({ userId, stripeAccountId, flags })` and `updateFlags(stripeAccountId, flags)`.
  - **`TemplateService`:**
    - `recordStripePurchase(input: StripePurchaseRecord): Promise<boolean>`, which returns true when a new row was inserted;
    - `listRecentSales(limit: number): Promise<SaleRow[]>`;
    - `sumPlatformFees(): Promise<number>`;
    - `listByCreator` rows gain `grossCents`, `feeCents` and `earningsCents`.

- [ ] **Step 1: Write the failing schema test**

Create `worker/database/payments-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

describe('payments schema', () => {
	it('stores one Stripe account per seller', () => {
		expect(schema.stripeConnectAccounts.userId.primary).toBe(true);
		expect(schema.stripeConnectAccounts.stripeAccountId.isUnique).toBe(true);
		expect(schema.stripeConnectAccounts.transfersActive.default).toBe(false);
	});

	it('records each Checkout session at most once', () => {
		expect(indexNamed(schema.templatePurchases, 'template_purchases_checkout_session_unique_idx')?.config.unique).toBe(true);
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test', 'stripe']);
		expect(schema.templatePurchases.currency.default).toBe('usd');
		expect(schema.templatePurchases.platformFeeCents.notNull).toBe(false);
	});

	it('records what each purchase bought, even after its listing is deleted', () => {
		expect(schema.templatePurchases.sourceAppId.notNull).toBe(false);
		expect(schema.templatePurchases.versionId.notNull).toBe(false);
	});

	it('allows at most one version in review per listing', () => {
		expect(indexNamed(schema.templateVersions, 'template_versions_one_pending_idx')?.config.unique).toBe(true);
		expect(allMigrationSql).toMatch(/CREATE UNIQUE INDEX `template_versions_one_pending_idx`[^;]*WHERE/);
	});

	it('ships the table and columns in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `stripe_connect_accounts`');
		expect(allMigrationSql).toContain('ALTER TABLE `template_purchases` ADD `stripe_checkout_session_id` text');
		expect(allMigrationSql).toContain('ALTER TABLE `template_purchases` ADD `platform_fee_cents` integer');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `template_purchases_checkout_session_unique_idx`');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run worker/database/payments-schema.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change the schema**

In `worker/database/schema.ts`:
- **Purchases:** in `templatePurchases`, add after `provider`:

```ts
    // Stripe purchases: the Checkout session (unique, so webhook and confirm record it once) and the money split.
    stripeCheckoutSessionId: text('stripe_checkout_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    platformFeeCents: integer('platform_fee_cents'),
    sellerAmountCents: integer('seller_amount_cents'),
    currency: text('currency').notNull().default('usd'),
    sellerStripeAccountId: text('seller_stripe_account_id'),
    // What was bought, kept when the listing is deleted with its app.
    sourceAppId: text('source_app_id'),
    versionId: text('version_id'),
```

  In `templateVersions`, add to its index callback:

```ts
    // A listing holds at most one version in review.
    onePendingIdx: uniqueIndex('template_versions_one_pending_idx').on(table.templateId).where(sql`${table.status} = 'pending'`),
```

  and add to its index callback `checkoutSessionIdx: uniqueIndex('template_purchases_checkout_session_unique_idx').on(table.stripeCheckoutSessionId),`. SQLite cannot add a UNIQUE column with `ALTER TABLE`, so uniqueness must come from this index, not from `.unique()`.
- **Seller accounts:** after `templatePurchases`, add:

```ts
/**
 * Stripe Connect accounts - the Express account a seller is paid through,
 * with the readiness flags Stripe reports (refreshed by webhook and status checks).
 */
export const stripeConnectAccounts = sqliteTable('stripe_connect_accounts', {
    userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    detailsSubmitted: integer('details_submitted', { mode: 'boolean' }).notNull().default(false),
    chargesEnabled: integer('charges_enabled', { mode: 'boolean' }).notNull().default(false),
    payoutsEnabled: integer('payouts_enabled', { mode: 'boolean' }).notNull().default(false),
    transfersActive: integer('transfers_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});
```

- **Types:** add at the end of the file:

```ts
export type StripeConnectAccount = typeof stripeConnectAccounts.$inferSelect;
```

- [ ] **Step 4: Generate migration 0010 and apply it locally**

Run: `npm run db:generate`
Expected: one new `migrations/0010_<name>.sql` containing:
- the `stripe_connect_accounts` table;
- eight `ALTER TABLE template_purchases ADD` statements;
- the checkout-session unique index;
- the partial `template_versions_one_pending_idx` index with its `WHERE`.

If drizzle-kit does not emit the `WHERE` clause, append it to that `CREATE UNIQUE INDEX` statement by hand in the generated SQL. If drizzle-kit asks about renames, choose create; nothing is renamed.

Apply it locally with the global wrangler, because the project's wrangler cannot open the local D1 file:

```bash
wrangler d1 migrations apply vibesdk-db --local
```

Expected: one migration applied (0010).

- [ ] **Step 5: Add the services**

Create `worker/database/services/StripeConnectService.ts`:

```ts
/** D1 reads and writes for sellers' Stripe Connect accounts. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { SellerFlags } from '../../services/payments/stripe-client';

export class StripeConnectService extends BaseService {
    async getByUser(userId: string): Promise<schema.StripeConnectAccount | null> {
        const row = await this.database
            .select()
            .from(schema.stripeConnectAccounts)
            .where(eq(schema.stripeConnectAccounts.userId, userId))
            .get();
        return row ?? null;
    }

    async getByAccountId(stripeAccountId: string): Promise<schema.StripeConnectAccount | null> {
        const row = await this.database
            .select()
            .from(schema.stripeConnectAccounts)
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId))
            .get();
        return row ?? null;
    }

    async create(input: { userId: string; stripeAccountId: string; flags: SellerFlags }): Promise<void> {
        const now = new Date();
        await this.database
            .insert(schema.stripeConnectAccounts)
            .values({ userId: input.userId, stripeAccountId: input.stripeAccountId, ...input.flags, createdAt: now, updatedAt: now });
    }

    async updateFlags(stripeAccountId: string, flags: SellerFlags): Promise<void> {
        await this.database
            .update(schema.stripeConnectAccounts)
            .set({ ...flags, updatedAt: new Date() })
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId));
    }
}
```

In `worker/database/index.ts`, export `StripeConnectService` next to the other services, following the file's existing export style.

In `worker/database/services/TemplateService.ts`, add these exported types:

```ts
export interface StripePurchaseRecord {
    listingId: string;
    sourceAppId: string;
    versionId: string | null;
    userId: string;
    priceCents: number;
    platformFeeCents: number;
    sellerAmountCents: number;
    currency: string;
    checkoutSessionId: string;
    paymentIntentId: string | null;
    sellerStripeAccountId: string;
}

export interface SaleRow {
    purchaseId: string;
    appId: string;
    appTitle: string;
    buyerEmail: string | null;
    priceCents: number;
    platformFeeCents: number | null;
    createdAt: Date | null;
}
```

Add to `CreatorListingRow`: `grossCents: number; feeCents: number; earningsCents: number;`. In `listByCreator`'s select, add:

```ts
                grossCents: sql<number>`(select coalesce(sum(purchase.price_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
                feeCents: sql<number>`(select coalesce(sum(purchase.platform_fee_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
                earningsCents: sql<number>`(select coalesce(sum(purchase.seller_amount_cents), 0) from template_purchases as purchase where purchase.template_id = ${schema.templates.id} and purchase.provider = 'stripe')`,
```

Add these methods:

```ts
    /** Record a paid Stripe Checkout session; false when this session or this buyer's purchase already exists. */
    async recordStripePurchase(input: StripePurchaseRecord): Promise<boolean> {
        const inserted = await this.database
            .insert(schema.templatePurchases)
            .values({
                id: generateId(),
                templateId: input.listingId,
                sourceAppId: input.sourceAppId,
                versionId: input.versionId,
                userId: input.userId,
                priceCents: input.priceCents,
                provider: 'stripe',
                stripeCheckoutSessionId: input.checkoutSessionId,
                stripePaymentIntentId: input.paymentIntentId,
                platformFeeCents: input.platformFeeCents,
                sellerAmountCents: input.sellerAmountCents,
                currency: input.currency,
                sellerStripeAccountId: input.sellerStripeAccountId,
                createdAt: new Date(),
            })
            .onConflictDoNothing()
            .returning({ id: schema.templatePurchases.id });
        return inserted.length > 0;
    }

    /** The latest Stripe sales, newest first, for the admin sales list. */
    async listRecentSales(limit: number): Promise<SaleRow[]> {
        return this.database
            .select({
                purchaseId: schema.templatePurchases.id,
                appId: schema.apps.id,
                appTitle: schema.apps.title,
                buyerEmail: schema.users.email,
                priceCents: schema.templatePurchases.priceCents,
                platformFeeCents: schema.templatePurchases.platformFeeCents,
                createdAt: schema.templatePurchases.createdAt,
            })
            .from(schema.templatePurchases)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templatePurchases.templateId))
            .innerJoin(schema.apps, eq(schema.apps.id, schema.templates.sourceAppId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templatePurchases.userId))
            .where(eq(schema.templatePurchases.provider, 'stripe'))
            .orderBy(desc(schema.templatePurchases.createdAt))
            .limit(limit)
            .all();
    }

    async sumPlatformFees(): Promise<number> {
        const row = await this.database
            .select({ total: sql<number>`coalesce(sum(${schema.templatePurchases.platformFeeCents}), 0)` })
            .from(schema.templatePurchases)
            .where(eq(schema.templatePurchases.provider, 'stripe'))
            .get();
        return row?.total ?? 0;
    }
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run worker/database/payments-schema.test.ts worker/database/templates-schema.test.ts`
Expected: PASS.

Run: `npx tsc -p tsconfig.worker.json --noEmit`
Expected: clean. `toOwnerPaidListing` and `getMyPaidListings` in the publishing controller still compile, because the new row fields are additive.

- [ ] **Step 7: Commit**

```bash
git add worker/database/schema.ts migrations/ worker/database/services/StripeConnectService.ts worker/database/services/TemplateService.ts worker/database/index.ts worker/database/payments-schema.test.ts
git commit -m "feat(payments): seller stripe accounts and stripe purchase records"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 3: Guaranteed admin access

**Files:**
- Create: `worker/services/auth/admin-access.ts` and `worker/services/auth/admin-access.test.ts`
- Modify: `worker/database/services/UserService.ts`
- Modify: `worker/middleware/auth/routeAuth.ts`
- Modify: `worker/api/controllers/appView/controller.ts`

**Interfaces:**
- Produces:
  - `PLATFORM_ADMIN_EMAILS: readonly string[]`;
  - `isPlatformAdminDecision(role: string | null, identities: Array<{ email: string | null; emailVerified: boolean | null }>): boolean`;
  - `UserService.isPlatformAdmin(userId): Promise<boolean>`;
  - `checkAdminRole` and `canModerate` both use `isPlatformAdmin`.

- [ ] **Step 1: Write the failing test**

Create `worker/services/auth/admin-access.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PLATFORM_ADMIN_EMAILS, isPlatformAdminDecision } from './admin-access';

describe('isPlatformAdminDecision', () => {
	it('names the owner as the platform admin', () => {
		expect(PLATFORM_ADMIN_EMAILS).toEqual(['alastrat@pluriza.com']);
	});

	it('grants admin from the role', () => {
		expect(isPlatformAdminDecision('admin', [])).toBe(true);
	});

	it('grants admin from a provider-verified admin email, in any case', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'Alastrat@Pluriza.com', emailVerified: true }])).toBe(true);
	});

	it('never grants admin from an unverified email', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'alastrat@pluriza.com', emailVerified: false }])).toBe(false);
		expect(isPlatformAdminDecision('user', [{ email: 'alastrat@pluriza.com', emailVerified: null }])).toBe(false);
	});

	it('ignores other verified emails', () => {
		expect(isPlatformAdminDecision('user', [{ email: 'someone@pluriza.com', emailVerified: true }])).toBe(false);
		expect(isPlatformAdminDecision(null, [{ email: null, emailVerified: true }])).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run worker/services/auth/admin-access.test.ts`
Expected: FAIL, because the module doesn't exist.

- [ ] **Step 3: Implement the decision and use it**

Create `worker/services/auth/admin-access.ts`:

```ts
/**
 * Who is a platform admin: anyone with the admin role, or the owner signing
 * in through a provider (Google, GitHub, Cloudflare) that verified their
 * email. Email and password sign-up never grants admin, because those
 * addresses are not verified.
 */

export const PLATFORM_ADMIN_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

export function isPlatformAdminDecision(
	role: string | null,
	identities: Array<{ email: string | null; emailVerified: boolean | null }>,
): boolean {
	if (role === 'admin') return true;
	return identities.some(
		(identity) =>
			identity.emailVerified === true &&
			identity.email !== null &&
			PLATFORM_ADMIN_EMAILS.includes(identity.email.toLowerCase()),
	);
}
```

In `worker/database/services/UserService.ts`, add next to `getRole`:

```ts
    /** Admin by role, or by a provider-verified sign-in with a platform admin email. */
    async isPlatformAdmin(userId: string): Promise<boolean> {
        const [role, identities] = await Promise.all([
            this.getRole(userId),
            this.database
                .select({ email: schema.userOauthIdentities.email, emailVerified: schema.userOauthIdentities.emailVerified })
                .from(schema.userOauthIdentities)
                .where(eq(schema.userOauthIdentities.userId, userId))
                .all(),
        ]);
        return isPlatformAdminDecision(role, identities);
    }
```

Import `isPlatformAdminDecision` from `'../../services/auth/admin-access'`. Make sure `eq` and `schema` are imported; they already are if `getRole` uses them.

In `worker/middleware/auth/routeAuth.ts`, change `checkAdminRole`'s body to `return await new UserService(env).isPlatformAdmin(user.id);`, keeping the try/catch.

In `worker/api/controllers/appView/controller.ts`, change `new UserService(env).getRole(userId).then((role) => role === 'admin')` to `new UserService(env).isPlatformAdmin(userId)`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run worker/services/auth/admin-access.test.ts worker/middleware/auth/routeAuth.test.ts worker/api/controllers/appView/app-reuse-wiring.test.ts`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 5: Commit**

```bash
git add worker/services/auth worker/database/services/UserService.ts worker/middleware/auth/routeAuth.ts worker/api/controllers/appView/controller.ts
git commit -m "feat(auth): grant admin from a provider-verified owner email"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---
### Task 4: Seller onboarding, webhook and fulfillment

**Files:**
- Create: `worker/services/payments/config.ts`
- Create: `worker/services/payments/fulfill.ts` and `fulfill.test.ts`
- Create: `worker/api/controllers/payments/types.ts`
- Create: `worker/api/controllers/payments/connectController.ts`
- Create: `worker/api/controllers/payments/webhook.ts`
- Create: `worker/api/routes/paymentsRoutes.ts`
- Create: `worker/api/controllers/payments/payments-wiring.test.ts`
- Modify: `worker/api/routes/index.ts` and `worker/app.ts`

**Interfaces:**
- Consumes: the Task 1 client and webhook helpers, `StripeConnectService` and `TemplateService.recordStripePurchase` (Task 2), and `platformFeeCents` (Task 1).
- Produces:
  - **Messages** (`config.ts`): `PAYMENTS_NOT_CONFIGURED_MESSAGE`, `SELLER_NOT_ONBOARDED_MESSAGE`, `SELLER_NOT_READY_MESSAGE`, `STRIPE_REQUEST_FAILED_MESSAGE`, `ALREADY_OWNED_MESSAGE` and `PAYMENT_INCOMPLETE_MESSAGE`.
  - **Config:** `stripeFromEnv(env): StripeClient | null`.
  - **Fulfillment** (`fulfill.ts`): `fulfillCheckoutSession(deps: FulfillDeps, session: StripeCheckoutSession): Promise<FulfillResult>`, plus the type guards `isCheckoutSession` and `isStripeAccount`.
  - **Routes:**
    - `POST /api/stripe/connect/onboarding`, `GET /api/stripe/connect/status` and `POST /api/stripe/connect/dashboard` (signed in);
    - `POST /api/stripe/webhook` (public, exempt from CSRF).
  - **Types:** `StripeConnectStatusData` and `StripeLinkData`.

- [ ] **Step 1: Write the failing fulfillment and wiring tests**

Create `worker/services/payments/fulfill.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import { fulfillCheckoutSession, isCheckoutSession, isStripeAccount, type FulfillDeps } from './fulfill';
import type { StripeCheckoutSession } from './stripe-client';

const PAID: StripeCheckoutSession = {
	id: 'cs_1',
	url: null,
	payment_status: 'paid',
	status: 'complete',
	client_reference_id: 'buyer1',
	metadata: { appId: 'app1', listingId: 'l1', versionId: 'v2', buyerUserId: 'buyer1', sellerStripeAccountId: 'acct_1' },
	amount_total: 2900,
	currency: 'usd',
	payment_intent: 'pi_1',
};

function harness(listingExists = true) {
	const sessions = new Set<string>();
	const records: StripePurchaseRecord[] = [];
	const deps: FulfillDeps = {
		listingExists: async () => listingExists,
		recordStripePurchase: async (record) => {
			if (sessions.has(record.checkoutSessionId)) return false;
			sessions.add(record.checkoutSessionId);
			records.push(record);
			return true;
		},
	};
	return { deps, records };
}

describe('fulfillCheckoutSession', () => {
	it('records the price, the 5% fee and the seller amount', async () => {
		const { deps, records } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		expect(records).toEqual([
			{
				listingId: 'l1',
				sourceAppId: 'app1',
				versionId: 'v2',
				userId: 'buyer1',
				priceCents: 2900,
				platformFeeCents: 145,
				sellerAmountCents: 2755,
				currency: 'usd',
				checkoutSessionId: 'cs_1',
				paymentIntentId: 'pi_1',
				sellerStripeAccountId: 'acct_1',
			},
		]);
	});

	it('records a session once', async () => {
		const { deps, records } = harness();
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('recorded');
		expect(await fulfillCheckoutSession(deps, PAID)).toBe('already-recorded');
		expect(records).toHaveLength(1);
	});

	it('ignores unpaid sessions, foreign sessions and deleted listings', async () => {
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, payment_status: 'unpaid' })).toBe('not-paid');
		expect(await fulfillCheckoutSession(harness().deps, { ...PAID, metadata: {} })).toBe('not-ours');
		expect(await fulfillCheckoutSession(harness(false).deps, PAID)).toBe('not-ours');
	});
});

describe('type guards', () => {
	it('recognizes Checkout sessions and accounts in webhook payloads', () => {
		expect(isCheckoutSession(PAID)).toBe(true);
		expect(isCheckoutSession({ id: 'cs_1' })).toBe(false);
		expect(isStripeAccount({ id: 'acct_1', details_submitted: true, charges_enabled: true, payouts_enabled: true })).toBe(true);
		expect(isStripeAccount({ id: 'acct_1' })).toBe(false);
	});
});
```

Create `worker/api/controllers/payments/payments-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/paymentsRoutes.ts', '/worker/api/routes/index.ts', '/worker/app.ts', '/worker/api/controllers/payments/webhook.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('payments routes', () => {
	it('keeps seller onboarding behind sign-in and the webhook public', () => {
		const routes = source('/worker/api/routes/paymentsRoutes.ts').split('\n');
		for (const path of ["'/api/stripe/connect/onboarding'", "'/api/stripe/connect/status'", "'/api/stripe/connect/dashboard'"]) {
			expect(routes.find((line) => line.includes(path))).toContain('setAuthLevel(AuthConfig.authenticated)');
		}
		expect(routes.find((line) => line.includes("'/api/stripe/webhook'"))).toContain('setAuthLevel(AuthConfig.public)');
		expect(source('/worker/api/routes/index.ts')).toContain('setupPaymentsRoutes(app)');
	});

	it('exempts only the webhook from CSRF, because Stripe signs it instead', () => {
		expect(source('/worker/app.ts')).toContain("pathname === '/api/stripe/webhook'");
	});

	it('verifies the signature before reading the event', () => {
		const webhook = source('/worker/api/controllers/payments/webhook.ts');
		expect(webhook.indexOf('verifyStripeSignature(')).toBeGreaterThan(-1);
		expect(webhook.indexOf('verifyStripeSignature(')).toBeLessThan(webhook.indexOf('parseStripeEvent('));
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/payments/fulfill.test.ts worker/api/controllers/payments/payments-wiring.test.ts`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Add the config, fulfillment and type guards**

Create `worker/services/payments/config.ts`:

```ts
/** Whether this deployment takes payments, and the user-facing payment messages. */

import { createStripeClient, type StripeClient } from './stripe-client';

export const PAYMENTS_NOT_CONFIGURED_MESSAGE = "Payments aren't set up on this deployment";
export const SELLER_NOT_ONBOARDED_MESSAGE = 'Connect Stripe to get paid before setting a price';
export const SELLER_NOT_READY_MESSAGE = "This seller can't receive payments right now";
export const STRIPE_REQUEST_FAILED_MESSAGE = "Stripe couldn't complete the request; try again";
export const ALREADY_OWNED_MESSAGE = 'You already own this site';
export const PAYMENT_INCOMPLETE_MESSAGE = "This payment isn't complete yet";

/** A Stripe client when the secret key is set; null on deployments without payments. */
export function stripeFromEnv(env: Env): StripeClient | null {
	return env.STRIPE_SECRET_KEY ? createStripeClient(env.STRIPE_SECRET_KEY) : null;
}
```

Create `worker/services/payments/fulfill.ts`:

```ts
/** Record a paid Checkout session as a purchase. The webhook and the return confirmation share it. */

import { platformFeeCents } from '../../../shared/types/templates';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import type { StripeAccount, StripeCheckoutSession } from './stripe-client';

export interface FulfillDeps {
	listingExists(listingId: string): Promise<boolean>;
	/** False when the session (or this buyer's purchase) is already recorded. */
	recordStripePurchase(record: StripePurchaseRecord): Promise<boolean>;
}

export type FulfillResult = 'recorded' | 'already-recorded' | 'not-paid' | 'not-ours';

export async function fulfillCheckoutSession(deps: FulfillDeps, session: StripeCheckoutSession): Promise<FulfillResult> {
	const metadata = session.metadata ?? {};
	const listingId = metadata.listingId;
	const appId = metadata.appId;
	const buyerUserId = metadata.buyerUserId;
	const sellerStripeAccountId = metadata.sellerStripeAccountId;
	if (!listingId || !appId || !buyerUserId || !sellerStripeAccountId || session.amount_total === null) return 'not-ours';
	if (session.payment_status !== 'paid') return 'not-paid';
	if (!(await deps.listingExists(listingId))) return 'not-ours';

	const priceCents = session.amount_total;
	const fee = platformFeeCents(priceCents);
	const recorded = await deps.recordStripePurchase({
		listingId,
		sourceAppId: appId,
		versionId: metadata.versionId ?? null,
		userId: buyerUserId,
		priceCents,
		platformFeeCents: fee,
		sellerAmountCents: priceCents - fee,
		currency: session.currency ?? 'usd',
		checkoutSessionId: session.id,
		paymentIntentId: session.payment_intent,
		sellerStripeAccountId,
	});
	return recorded ? 'recorded' : 'already-recorded';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export function isCheckoutSession(value: unknown): value is StripeCheckoutSession {
	return isRecord(value) && typeof value.id === 'string' && typeof value.payment_status === 'string';
}

export function isStripeAccount(value: unknown): value is StripeAccount {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.details_submitted === 'boolean' &&
		typeof value.charges_enabled === 'boolean' &&
		typeof value.payouts_enabled === 'boolean'
	);
}
```

- [ ] **Step 4: Add the onboarding controller and the webhook handler**

Create `worker/api/controllers/payments/types.ts`:

```ts
/** API types for Stripe Connect onboarding. */

export interface StripeConnectStatusData {
    /** This deployment has Stripe keys. */
    configured: boolean;
    /** The user has started Stripe onboarding. */
    connected: boolean;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
    /** Stripe can transfer sale proceeds to this seller; required to sell. */
    transfersActive: boolean;
}

export interface StripeLinkData {
    url: string;
}
```

Create `worker/api/controllers/payments/connectController.ts`:

```ts
/** Seller onboarding with Stripe Connect Express: start or resume onboarding, read status, open the dashboard. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { StripeConnectService } from '../../../database';
import { StripeApiError, accountFlags } from '../../../services/payments/stripe-client';
import { PAYMENTS_NOT_CONFIGURED_MESSAGE, STRIPE_REQUEST_FAILED_MESSAGE, stripeFromEnv } from '../../../services/payments/config';
import type { StripeConnectStatusData, StripeLinkData } from './types';

const NOT_CONNECTED: Omit<StripeConnectStatusData, 'configured'> = {
    connected: false,
    detailsSubmitted: false,
    payoutsEnabled: false,
    transfersActive: false,
};

export class StripeConnectController extends BaseController {
    static logger = createLogger('StripeConnectController');

    /** Create the seller's Express account on first use and return a Stripe-hosted onboarding link. */
    static async startOnboarding(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeLinkData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return StripeConnectController.createErrorResponse<StripeLinkData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const user = context.user!;
            const accounts = new StripeConnectService(env);
            let accountId = (await accounts.getByUser(user.id))?.stripeAccountId;
            if (!accountId) {
                const created = await stripe.createExpressAccount({ email: user.email, userId: user.id });
                await accounts.create({ userId: user.id, stripeAccountId: created.id, flags: accountFlags(created) });
                accountId = created.id;
            }
            const origin = new URL(request.url).origin;
            const link = await stripe.createAccountLink({
                accountId,
                refreshUrl: `${origin}/profile?tab=paid&stripe=refresh`,
                returnUrl: `${origin}/profile?tab=paid&stripe=return`,
            });
            return StripeConnectController.createSuccessResponse<StripeLinkData>({ url: link.url });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe onboarding failed', { status: error.status, code: error.code, message: error.message });
                return StripeConnectController.createErrorResponse<StripeLinkData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error starting Stripe onboarding', error);
            return StripeConnectController.createErrorResponse<StripeLinkData>('Failed to start Stripe onboarding', 500);
        }
    }

    /** The seller's payout readiness, refreshed from Stripe; falls back to the stored flags if Stripe fails. */
    static async getStatus(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) {
                return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({ configured: false, ...NOT_CONNECTED });
            }
            const accounts = new StripeConnectService(env);
            const stored = await accounts.getByUser(context.user!.id);
            if (!stored) {
                return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({ configured: true, ...NOT_CONNECTED });
            }
            let flags = {
                detailsSubmitted: stored.detailsSubmitted,
                chargesEnabled: stored.chargesEnabled,
                payoutsEnabled: stored.payoutsEnabled,
                transfersActive: stored.transfersActive,
            };
            try {
                flags = accountFlags(await stripe.retrieveAccount(stored.stripeAccountId));
                await accounts.updateFlags(stored.stripeAccountId, flags);
            } catch (error) {
                this.logger.warn('Could not refresh the Stripe account; using stored flags', error);
            }
            return StripeConnectController.createSuccessResponse<StripeConnectStatusData>({
                configured: true,
                connected: true,
                detailsSubmitted: flags.detailsSubmitted,
                payoutsEnabled: flags.payoutsEnabled,
                transfersActive: flags.transfersActive,
            });
        } catch (error) {
            this.logger.error('Error loading Stripe status', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to load your Stripe status', 500);
        }
    }

    /** A one-time link to the seller's Stripe Express dashboard. */
    static async dashboardLink(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<StripeLinkData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return StripeConnectController.createErrorResponse<StripeLinkData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const stored = await new StripeConnectService(env).getByUser(context.user!.id);
            if (!stored || !stored.detailsSubmitted) {
                return StripeConnectController.createErrorResponse<StripeLinkData>('Finish Stripe onboarding first', 400);
            }
            const link = await stripe.createLoginLink(stored.stripeAccountId);
            return StripeConnectController.createSuccessResponse<StripeLinkData>({ url: link.url });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe dashboard link failed', { status: error.status, code: error.code });
                return StripeConnectController.createErrorResponse<StripeLinkData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error creating Stripe dashboard link', error);
            return StripeConnectController.createErrorResponse<StripeLinkData>('Failed to open the Stripe dashboard', 500);
        }
    }
}
```

Create `worker/api/controllers/payments/webhook.ts`:

```ts
/**
 * Stripe webhook: verifies the signature, then records paid Checkout
 * sessions and refreshes sellers' payout flags. Public and exempt from CSRF;
 * the signature is the authentication.
 */

import { createLogger } from '../../../logger';
import { StripeConnectService, TemplateService } from '../../../database';
import { accountFlags } from '../../../services/payments/stripe-client';
import { parseStripeEvent, verifyStripeSignature, type StripeEvent } from '../../../services/payments/webhook';
import { fulfillCheckoutSession, isCheckoutSession, isStripeAccount } from '../../../services/payments/fulfill';

const logger = createLogger('StripeWebhook');

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
    const secret = env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return new Response('Payments are not configured', { status: 400 });
    const payload = await request.text();
    const valid = await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), secret, Math.floor(Date.now() / 1000));
    if (!valid) return new Response('Invalid signature', { status: 400 });
    const event = parseStripeEvent(payload);
    if (!event) return new Response('Malformed event', { status: 400 });
    try {
        await dispatchStripeEvent(env, event);
    } catch (error) {
        logger.error('Stripe webhook handling failed', { type: event.type, id: event.id, error });
        return new Response('Webhook handling failed', { status: 500 });
    }
    return Response.json({ received: true });
}

async function dispatchStripeEvent(env: Env, event: StripeEvent): Promise<void> {
    const object = event.data.object;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        if (!isCheckoutSession(object)) return;
        const listings = new TemplateService(env);
        const result = await fulfillCheckoutSession(
            {
                listingExists: async (listingId) => (await listings.getListing(listingId)) !== null,
                recordStripePurchase: (record) => listings.recordStripePurchase(record),
            },
            object,
        );
        logger.info('Checkout session handled', { id: object.id, result });
        return;
    }
    if (event.type === 'account.updated' && isStripeAccount(object)) {
        await new StripeConnectService(env).updateFlags(object.id, accountFlags(object));
    }
}
```

- [ ] **Step 5: Register the routes and exempt the webhook from CSRF**

Create `worker/api/routes/paymentsRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { StripeConnectController } from '../controllers/payments/connectController';
import { handleStripeWebhook } from '../controllers/payments/webhook';

/** Stripe Connect seller onboarding and the Stripe webhook. */
export function setupPaymentsRoutes(app: Hono<AppEnv>): void {
    app.post('/api/stripe/connect/onboarding', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.startOnboarding));
    app.get('/api/stripe/connect/status', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.getStatus));
    app.post('/api/stripe/connect/dashboard', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.dashboardLink));
    app.post('/api/stripe/webhook', setAuthLevel(AuthConfig.public), (c) => handleStripeWebhook(c.req.raw, c.env));
}
```

In `worker/api/routes/index.ts`, import `setupPaymentsRoutes` and call `setupPaymentsRoutes(app);` right after `setupPublishingRoutes(app);`, under the comment `// Stripe Connect onboarding and webhook`.

In `worker/app.ts`, in the CSRF middleware, right after the WebSocket-upgrade skip, add:

```ts
        // Stripe signs its webhook; it cannot carry a CSRF token.
        if (new URL(c.req.url).pathname === '/api/stripe/webhook') {
            return next();
        }
```

The wiring test looks for `pathname === '/api/stripe/webhook'`. If you assign the pathname to a local `pathname` variable first, keep that exact comparison text.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run worker/services/payments worker/api/controllers/payments`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 7: Commit**

```bash
git add worker/services/payments worker/api/controllers/payments worker/api/routes/paymentsRoutes.ts worker/api/routes/index.ts worker/app.ts
git commit -m "feat(payments): stripe connect onboarding and a signed webhook that records sales"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 5: Checkout, confirmation, the publish gate and sales data

**Files:**
- Create: `worker/services/payments/checkout.ts` and `checkout.test.ts`
- Modify: `worker/services/templates/publish.ts` and `publish.test.ts`
- Modify: `worker/api/controllers/publishing/controller.ts`, `types.ts` and `adminController.ts`
- Modify: `worker/api/routes/publishingRoutes.ts` and `worker/api/controllers/publishing/publishing-routes-wiring.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2 and 4, and the Discover `publishSite` and `PublishingController`.
- Produces:
  - **Decisions:** `checkoutDecision(input): CheckoutDecision` and `confirmDecision(session, expected): ConfirmDecision`.
  - **`PublishDeps.sellerPayouts`:** `sellerPayouts(): Promise<'ready' | 'not-configured' | 'not-onboarded'>`.
  - **Routes:**
    - `POST /api/apps/:id/purchases` now returns `SiteCheckoutData { checkoutUrl: string }`;
    - `POST /api/apps/:id/purchases/confirm` with `{ sessionId }` returns `ConfirmPurchaseData { purchased: true }`;
    - `GET /api/admin/sales` returns `AdminSalesData`.
  - **`MyPaidListing`** gains `grossCents`, `feeCents` and `earningsCents`.

- [ ] **Step 1: Write the failing tests**

Create `worker/services/payments/checkout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkoutDecision, confirmDecision, type CheckoutInput } from './checkout';
import { ALREADY_OWNED_MESSAGE, PAYMENT_INCOMPLETE_MESSAGE, SELLER_NOT_READY_MESSAGE } from './config';
import { SITE_NOT_YET_AVAILABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE } from '../templates/reuse';
import type { StripeCheckoutSession } from './stripe-client';

const READY: CheckoutInput = {
	appPublic: true,
	removed: false,
	listing: { status: 'listed', currentVersionId: 'v2', priceCents: 2900 },
	isCreator: false,
	hasPurchase: false,
	sellerTransfersActive: true,
};

describe('checkoutDecision', () => {
	it('lets a buyer pay for an approved paid site', () => {
		expect(checkoutDecision(READY)).toEqual({ ok: true });
	});

	it('refuses hidden, free, not-yet-approved, own and already-owned sites', () => {
		expect(checkoutDecision({ ...READY, appPublic: false })).toEqual({ ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE });
		expect(checkoutDecision({ ...READY, removed: true })).toEqual({ ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE });
		expect(checkoutDecision({ ...READY, listing: null })).toEqual({ ok: false, status: 400, error: 'This site is free' });
		expect(checkoutDecision({ ...READY, listing: { status: 'listed', currentVersionId: null, priceCents: 0 } })).toEqual({
			ok: false,
			status: 409,
			error: SITE_NOT_YET_AVAILABLE_MESSAGE,
		});
		expect(checkoutDecision({ ...READY, listing: { status: 'unlisted', currentVersionId: 'v1', priceCents: 2900 } })).toEqual({
			ok: false,
			status: 400,
			error: 'This site is free',
		});
		expect(checkoutDecision({ ...READY, isCreator: true })).toEqual({ ok: false, status: 400, error: 'You published this site' });
		expect(checkoutDecision({ ...READY, hasPurchase: true })).toEqual({ ok: false, status: 400, error: ALREADY_OWNED_MESSAGE });
	});

	it('refuses checkout when the seller cannot receive transfers', () => {
		expect(checkoutDecision({ ...READY, sellerTransfersActive: false })).toEqual({
			ok: false,
			status: 409,
			error: SELLER_NOT_READY_MESSAGE,
		});
	});
});

describe('confirmDecision', () => {
	const session: StripeCheckoutSession = {
		id: 'cs_1',
		url: null,
		payment_status: 'paid',
		status: 'complete',
		client_reference_id: 'buyer1',
		metadata: { appId: 'app1' },
		amount_total: 2900,
		currency: 'usd',
		payment_intent: 'pi_1',
	};

	it('confirms the buyer own paid session', () => {
		expect(confirmDecision(session, { appId: 'app1', userId: 'buyer1' })).toEqual({ ok: true });
	});

	it('refuses a session that belongs to another buyer or site', () => {
		const forbidden = { ok: false, status: 403, error: 'This payment belongs to someone else' };
		expect(confirmDecision(session, { appId: 'app1', userId: 'someone' })).toEqual(forbidden);
		expect(confirmDecision(session, { appId: 'app2', userId: 'buyer1' })).toEqual(forbidden);
	});

	it('waits for an unpaid session', () => {
		expect(confirmDecision({ ...session, payment_status: 'unpaid' }, { appId: 'app1', userId: 'buyer1' })).toEqual({
			ok: false,
			status: 409,
			error: PAYMENT_INCOMPLETE_MESSAGE,
		});
	});
});
```

In `worker/services/templates/publish.test.ts`:
- add `sellerPayouts?: 'ready' | 'not-configured' | 'not-onboarded';` to `Setup`;
- add `sellerPayouts: async () => setup.sellerPayouts ?? 'ready',` to the harness `deps`;
- add the import `import { PAYMENTS_NOT_CONFIGURED_MESSAGE, SELLER_NOT_ONBOARDED_MESSAGE } from '../payments/config';`;
- append to the `describe('publishSite', ...)` block:

```ts
	it('refuses a paid publish until the seller can receive payments', async () => {
		const notOnboarded = harness({ sellerPayouts: 'not-onboarded' });
		expect(await publishSite(notOnboarded.deps, PAID)).toEqual({ ok: false, status: 400, error: SELLER_NOT_ONBOARDED_MESSAGE });
		const notConfigured = harness({ sellerPayouts: 'not-configured' });
		expect(await publishSite(notConfigured.deps, PAID)).toEqual({ ok: false, status: 400, error: PAYMENTS_NOT_CONFIGURED_MESSAGE });
		expect([...notOnboarded.calls, ...notConfigured.calls]).toEqual([]);
	});

	it('publishes a free site without asking about payouts', async () => {
		const { deps } = harness({ sellerPayouts: 'not-configured' });
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/payments/checkout.test.ts worker/services/templates/publish.test.ts`
Expected: FAIL, because `./checkout` is missing and the payout gate does not exist.

- [ ] **Step 3: Implement the decisions and the gate**

Create `worker/services/payments/checkout.ts`:

```ts
/** Who may pay for a site, and whether a returning buyer's Checkout session is theirs and paid. Pure. */

import type { TemplateListingStatus } from '../../../shared/types/templates';
import { SITE_NOT_YET_AVAILABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE } from '../templates/reuse';
import { ALREADY_OWNED_MESSAGE, PAYMENT_INCOMPLETE_MESSAGE, SELLER_NOT_READY_MESSAGE } from './config';
import type { StripeCheckoutSession } from './stripe-client';

export interface CheckoutInput {
	appPublic: boolean;
	removed: boolean;
	listing: { status: TemplateListingStatus; currentVersionId: string | null; priceCents: number } | null;
	isCreator: boolean;
	hasPurchase: boolean;
	sellerTransfersActive: boolean;
}

export type CheckoutDecision = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };
export type ConfirmDecision = { ok: true } | { ok: false; status: 403 | 409; error: string };

export function checkoutDecision(input: CheckoutInput): CheckoutDecision {
	if (!input.appPublic || input.removed) return { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
	if (input.listing?.status === 'listed' && input.listing.currentVersionId === null) {
		return { ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE };
	}
	const paid = input.listing !== null && input.listing.status === 'listed' && input.listing.currentVersionId !== null;
	if (!paid) return { ok: false, status: 400, error: 'This site is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You published this site' };
	if (input.hasPurchase) return { ok: false, status: 400, error: ALREADY_OWNED_MESSAGE };
	if (!input.sellerTransfersActive) return { ok: false, status: 409, error: SELLER_NOT_READY_MESSAGE };
	return { ok: true };
}

export function confirmDecision(
	session: StripeCheckoutSession,
	expected: { appId: string; userId: string },
): ConfirmDecision {
	if (session.metadata?.appId !== expected.appId || session.client_reference_id !== expected.userId) {
		return { ok: false, status: 403, error: 'This payment belongs to someone else' };
	}
	if (session.payment_status !== 'paid') return { ok: false, status: 409, error: PAYMENT_INCOMPLETE_MESSAGE };
	return { ok: true };
}
```

In `worker/services/templates/publish.ts`:
- add to `PublishDeps`:

```ts
	/** Whether the owner can be paid: Stripe configured and their account able to receive transfers. */
	sellerPayouts(): Promise<'ready' | 'not-configured' | 'not-onboarded'>;
```

- import `PAYMENTS_NOT_CONFIGURED_MESSAGE` and `SELLER_NOT_ONBOARDED_MESSAGE` from `'../payments/config'`;
- just before the `try {` of the paid branch, insert:

```ts
	const payouts = await deps.sellerPayouts();
	if (payouts === 'not-configured') return { ok: false, status: 400, error: PAYMENTS_NOT_CONFIGURED_MESSAGE };
	if (payouts === 'not-onboarded') return { ok: false, status: 400, error: SELLER_NOT_ONBOARDED_MESSAGE };
```

- [ ] **Step 4: Wire checkout, confirmation, the gate and sales into the controllers**

In `worker/api/controllers/publishing/types.ts`:
- replace `SitePurchaseData` with:

```ts
export interface SiteCheckoutData {
    /** Stripe Checkout page to send the buyer to. */
    checkoutUrl: string;
}

export interface ConfirmPurchaseRequest {
    sessionId: string;
}

export interface ConfirmPurchaseData {
    purchased: true;
}

export interface SaleView {
    purchaseId: string;
    appId: string;
    appTitle: string;
    buyerEmail: string | null;
    priceCents: number;
    platformFeeCents: number;
    soldAt: string | null;
}

export interface AdminSalesData {
    sales: SaleView[];
    totalFeesCents: number;
}
```

- add to `MyPaidListing`: `grossCents: number; feeCents: number; earningsCents: number;`.

In `worker/api/controllers/publishing/controller.ts`:
- **Imports:**
  - `StripeConnectService` from `'../../../database'`;
  - `accountFlags` and `StripeApiError` from `'../../../services/payments/stripe-client'`;
  - `PAYMENTS_NOT_CONFIGURED_MESSAGE`, `STRIPE_REQUEST_FAILED_MESSAGE` and `stripeFromEnv` from `'../../../services/payments/config'`;
  - `checkoutDecision` and `confirmDecision` from `'../../../services/payments/checkout'`;
  - `fulfillCheckoutSession` from `'../../../services/payments/fulfill'`;
  - `platformFeeCents` from `'../../../../shared/types/templates'`;
  - replace `SitePurchaseData` with `SiteCheckoutData`, `ConfirmPurchaseData` and `ConfirmPurchaseRequest` in the types import;
  - remove the `purchaseDecision` import if it is now unused.
- **Seller readiness:** add this private static helper, refreshing from Stripe when the stored flag is false:

```ts
    /** The seller's Stripe account when it can receive transfers, refreshing a stale flag from Stripe. */
    private static async readySellerAccount(env: Env, userId: string): Promise<string | null> {
        const stripe = stripeFromEnv(env);
        const accounts = new StripeConnectService(env);
        const stored = await accounts.getByUser(userId);
        if (!stripe || !stored) return null;
        if (stored.transfersActive) return stored.stripeAccountId;
        const flags = accountFlags(await stripe.retrieveAccount(stored.stripeAccountId));
        await accounts.updateFlags(stored.stripeAccountId, flags);
        return flags.transfersActive ? stored.stripeAccountId : null;
    }
```

- **Publish gate:** add to the object returned by `publishDeps`:

```ts
            async sellerPayouts() {
                if (!stripeFromEnv(env)) return 'not-configured';
                return (await PublishingController.readySellerAccount(env, userId)) ? 'ready' : 'not-onboarded';
            },
```

- **Checkout:** replace the whole `purchase` method with:

```ts
    /** Start a Stripe Checkout session for an approved paid site; the seller gets the price minus Estori's 5%. */
    static async purchase(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SiteCheckoutData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return PublishingController.createErrorResponse<SiteCheckoutData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const user = context.user!;
            const appId = context.pathParams.id;
            const app = await new AppService(env).getReuseSource(appId);
            const listings = new TemplateService(env);
            const listing = app ? await listings.getListingByApp(appId) : null;
            const isCreator = app?.userId === user.id;
            const hasPurchase = listing ? await listings.hasPurchase(listing.id, user.id) : false;
            const sellerAccountId =
                listing && !isCreator && !hasPurchase ? await PublishingController.readySellerAccount(env, listing.creatorUserId) : null;
            const decision = checkoutDecision({
                appPublic: app?.visibility === 'public',
                removed: app?.removedFromDiscoverAt != null,
                listing: listing ? { status: listing.status, currentVersionId: listing.currentVersionId, priceCents: listing.priceCents } : null,
                isCreator,
                hasPurchase,
                sellerTransfersActive: sellerAccountId !== null,
            });
            if (!decision.ok) return PublishingController.createErrorResponse<SiteCheckoutData>(decision.error, decision.status);
            if (!app || !listing || !listing.currentVersionId || !sellerAccountId) {
                throw new Error('Checkout decision allowed an incomplete listing');
            }
            const origin = new URL(request.url).origin;
            const session = await stripe.createCheckoutSession({
                productName: app.title,
                priceCents: listing.priceCents,
                feeCents: platformFeeCents(listing.priceCents),
                destinationAccountId: sellerAccountId,
                buyerUserId: user.id,
                buyerEmail: user.email,
                successUrl: `${origin}/app/${appId}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${origin}/app/${appId}`,
                metadata: {
                    appId,
                    listingId: listing.id,
                    versionId: listing.currentVersionId,
                    buyerUserId: user.id,
                    sellerStripeAccountId: sellerAccountId,
                },
            });
            if (!session.url) throw new Error('Stripe returned no Checkout URL');
            return PublishingController.createSuccessResponse<SiteCheckoutData>({ checkoutUrl: session.url });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe checkout failed', { status: error.status, code: error.code, message: error.message });
                return PublishingController.createErrorResponse<SiteCheckoutData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error starting checkout', error);
            return PublishingController.createErrorResponse<SiteCheckoutData>('Failed to start checkout', 500);
        }
    }

    /** Record the purchase when a buyer returns from Stripe Checkout; the webhook does the same, once. */
    static async confirmPurchase(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<ConfirmPurchaseData>>> {
        try {
            const stripe = stripeFromEnv(env);
            if (!stripe) return PublishingController.createErrorResponse<ConfirmPurchaseData>(PAYMENTS_NOT_CONFIGURED_MESSAGE, 400);
            const bodyResult = await PublishingController.parseJsonBody<ConfirmPurchaseRequest>(request);
            if (!bodyResult.success) return bodyResult.response! as ControllerResponse<ApiResponse<ConfirmPurchaseData>>;
            const sessionId = bodyResult.data?.sessionId;
            if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
                return PublishingController.createErrorResponse<ConfirmPurchaseData>('sessionId is required', 400);
            }
            const session = await stripe.retrieveCheckoutSession(sessionId);
            const decision = confirmDecision(session, { appId: context.pathParams.id, userId: context.user!.id });
            if (!decision.ok) return PublishingController.createErrorResponse<ConfirmPurchaseData>(decision.error, decision.status);
            const listings = new TemplateService(env);
            await fulfillCheckoutSession(
                {
                    listingExists: async (listingId) => (await listings.getListing(listingId)) !== null,
                    recordStripePurchase: (record) => listings.recordStripePurchase(record),
                },
                session,
            );
            return PublishingController.createSuccessResponse<ConfirmPurchaseData>({ purchased: true });
        } catch (error) {
            if (error instanceof StripeApiError) {
                this.logger.warn('Stripe confirmation failed', { status: error.status, code: error.code });
                return PublishingController.createErrorResponse<ConfirmPurchaseData>(STRIPE_REQUEST_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error confirming purchase', error);
            return PublishingController.createErrorResponse<ConfirmPurchaseData>('Failed to confirm the purchase', 500);
        }
    }
```

- **Earnings:** in `getMyPaidListings`, add `grossCents: row.grossCents, feeCents: row.feeCents, earningsCents: row.earningsCents,` to each mapped listing.

In `worker/api/controllers/publishing/adminController.ts`, add:

```ts
    /** The latest Stripe sales and Estori's total fees. */
    static async listSales(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<AdminSalesData>>> {
        try {
            const listings = new TemplateService(env);
            const [rows, totalFeesCents] = await Promise.all([listings.listRecentSales(50), listings.sumPlatformFees()]);
            return ReviewAdminController.createSuccessResponse<AdminSalesData>({
                sales: rows.map((row) => ({
                    purchaseId: row.purchaseId,
                    appId: row.appId,
                    appTitle: row.appTitle,
                    buyerEmail: row.buyerEmail,
                    priceCents: row.priceCents,
                    platformFeeCents: row.platformFeeCents ?? 0,
                    soldAt: row.createdAt ? row.createdAt.toISOString() : null,
                })),
                totalFeesCents,
            });
        } catch (error) {
            this.logger.error('Error listing sales', error);
            return ReviewAdminController.createErrorResponse<AdminSalesData>('Failed to load sales', 500);
        }
    }
```

and add `AdminSalesData` to its types import.

In `worker/api/routes/publishingRoutes.ts`:
- after the purchases line, add:

```ts
    app.post('/api/apps/:id/purchases/confirm', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.confirmPurchase));
```

- in the admin block, add:

```ts
    app.get('/api/admin/sales', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listSales));
```

In `publishing-routes-wiring.test.ts`, change `expect(adminLines).toHaveLength(7);` to `expect(adminLines).toHaveLength(8);`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run worker/services/payments worker/services/templates/publish.test.ts worker/api/controllers/publishing`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 6: Commit**

```bash
git add worker/services/payments/checkout.ts worker/services/payments/checkout.test.ts worker/services/templates/publish.ts worker/services/templates/publish.test.ts worker/api/controllers/publishing worker/api/routes/publishingRoutes.ts
git commit -m "feat(payments): checkout with a 5% fee, return confirmation and the seller payout gate"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 6: Frontend payments data and the buy flow

**Files:**
- Modify: `src/api-types.ts` and `src/lib/api-client.ts`
- Create: `src/hooks/use-payments.ts`
- Modify: `src/hooks/use-publishing.ts` (remove `usePurchaseSite`)
- Modify: `src/lib/query-keys.ts`
- Modify: `src/components/publishing/UseSiteButton.tsx`
- Modify: `src/routes/reuse-guard.test.ts`
- Create: `src/routes/payments-guard.test.ts`

**Interfaces:**
- Produces:
  - **API client:** `apiClient.startStripeOnboarding()`, `getStripeConnectStatus()`, `getStripeDashboardLink()`, `createSiteCheckout(appId)`, `confirmSitePurchase(appId, sessionId)` and `getAdminSales()`.
  - **Hooks:** `useStripeConnectStatus(enabled)`, `useStartStripeOnboarding()`, `useStripeDashboardLink()`, `useCreateSiteCheckout()`, `useConfirmSitePurchase()` and `useAdminSales()`.
  - **Query keys:** `queryKeys.account.payments.{all, status, sales}`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/payments-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/publishing/UseSiteButton.tsx', '/src/hooks/use-payments.ts', '/src/hooks/use-publishing.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('paying for a site', () => {
	it('sends the buyer to Stripe Checkout and confirms on return', () => {
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('window.location.assign(result.checkoutUrl)');
		expect(button).toContain("searchParams.get('purchase') === 'success'");
		expect(button).toContain("searchParams.get('session_id')");
		expect(button).toContain('Secure checkout with Stripe');
		expect(button).not.toContain('test mode');
	});

	it('no longer records purchases without payment', () => {
		expect(source('/src/hooks/use-publishing.ts')).not.toContain('usePurchaseSite');
		expect(source('/src/hooks/use-payments.ts')).toContain('confirmSitePurchase(');
	});
});
```

In `src/routes/reuse-guard.test.ts`, replace `expect(button).toContain("Payments are in test mode. You won't be charged.");` with `expect(button).toContain('Secure checkout with Stripe');`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/routes/payments-guard.test.ts src/routes/reuse-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Types, client, keys and hooks**

In `src/api-types.ts`:
- in the `publishing/types` export block, replace `SitePurchaseData` with `AdminSalesData`, `ConfirmPurchaseData`, `ConfirmPurchaseRequest`, `SaleView` and `SiteCheckoutData`;
- add:

```ts
export type { StripeConnectStatusData, StripeLinkData } from 'worker/api/controllers/payments/types';
export { PLATFORM_FEE_PERCENT, platformFeeCents } from '../shared/types/templates.js';
```

In `src/lib/api-client.ts`:
- update the type imports to match;
- replace `purchaseSite` with:

```ts
	/** Start Stripe Checkout for a paid site; the response carries the Checkout page URL. */
	async createSiteCheckout(appId: string): Promise<ApiResponse<SiteCheckoutData>> {
		return this.request<SiteCheckoutData>(`/api/apps/${appId}/purchases`, { method: 'POST' });
	}

	/** Record the purchase after the buyer returns from Stripe Checkout. */
	async confirmSitePurchase(appId: string, sessionId: string): Promise<ApiResponse<ConfirmPurchaseData>> {
		const body: ConfirmPurchaseRequest = { sessionId };
		return this.request<ConfirmPurchaseData>(`/api/apps/${appId}/purchases/confirm`, { method: 'POST', body });
	}

	async startStripeOnboarding(): Promise<ApiResponse<StripeLinkData>> {
		return this.request<StripeLinkData>('/api/stripe/connect/onboarding', { method: 'POST' });
	}

	async getStripeConnectStatus(): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/status');
	}

	async getStripeDashboardLink(): Promise<ApiResponse<StripeLinkData>> {
		return this.request<StripeLinkData>('/api/stripe/connect/dashboard', { method: 'POST' });
	}

	/** Admins only; quiet because non-admins get 403. */
	async getAdminSales(): Promise<ApiResponse<AdminSalesData>> {
		return this.request<AdminSalesData>('/api/admin/sales', {}, true);
	}
```

In `src/lib/query-keys.ts`, add to `account`:

```ts
		/** Seller payout status and admin sales: never persisted. */
		payments: {
			all: () => [...queryKeys.account.all, 'payments'] as const,
			status: (userId?: string | null) => [...queryKeys.account.payments.all(), 'status', userId ?? 'anonymous'] as const,
			sales: () => [...queryKeys.account.payments.all(), 'sales'] as const,
		},
```

In `src/hooks/use-publishing.ts`, delete `usePurchaseSite`.

Create `src/hooks/use-payments.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import type { ApiResponse } from '@/api-types';

async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}

export function useStripeConnectStatus(enabled: boolean) {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.payments.status(user?.id),
		queryFn: () => unwrap(apiClient.getStripeConnectStatus(), 'Failed to load your Stripe status'),
		enabled: enabled && !!user,
		retry: false,
	});
}

/** Starts or resumes Stripe-hosted onboarding; the caller sends the browser to the returned URL. */
export function useStartStripeOnboarding() {
	return useMutation({
		mutationFn: () => unwrap(apiClient.startStripeOnboarding(), 'Failed to start Stripe onboarding'),
	});
}

export function useStripeDashboardLink() {
	return useMutation({
		mutationFn: () => unwrap(apiClient.getStripeDashboardLink(), 'Failed to open the Stripe dashboard'),
	});
}

/** Creates a Stripe Checkout session; the caller sends the browser to `checkoutUrl`. */
export function useCreateSiteCheckout() {
	return useMutation({
		mutationFn: (appId: string) => unwrap(apiClient.createSiteCheckout(appId), 'Failed to start checkout'),
	});
}

/** Records a purchase on return from Checkout; app details and lists refresh so "Use this site" appears. */
export function useConfirmSitePurchase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { appId: string; sessionId: string }) =>
			unwrap(apiClient.confirmSitePurchase(input.appId, input.sessionId), 'Failed to confirm your payment'),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.account.apps.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.account.publishing.all() }),
			]),
	});
}

export function useAdminSales() {
	return useQuery({
		queryKey: queryKeys.account.payments.sales(),
		queryFn: () => unwrap(apiClient.getAdminSales(), 'Failed to load sales'),
		retry: false,
	});
}
```

- [ ] **Step 4: Buy through Stripe Checkout**

In `src/components/publishing/UseSiteButton.tsx`:
- **Imports:**
  - replace `usePurchaseSite` from `@/hooks/use-publishing` with `useConfirmSitePurchase` and `useCreateSiteCheckout` from `@/hooks/use-payments`;
  - add `useSearchParams` from `react-router`, and `useRef` to the React import.
- **Body:** replace `const purchase = usePurchaseSite();` with:

```tsx
	const checkout = useCreateSiteCheckout();
	const confirm = useConfirmSitePurchase();
	const [searchParams, setSearchParams] = useSearchParams();
	const confirmedSession = useRef<string | null>(null);

	// Back from Stripe Checkout: record the payment, then drop the query params.
	useEffect(() => {
		const sessionId = searchParams.get('session_id');
		if (searchParams.get('purchase') === 'success' && sessionId && confirmedSession.current !== sessionId) {
			confirmedSession.current = sessionId;
			confirm.mutate(
				{ appId: app.id, sessionId },
				{
					onSuccess: () => toast.success(`Payment received. You can use ${app.title} now.`),
					onError: (error) => toast.error(error.message),
					onSettled: () => {
						const next = new URLSearchParams(searchParams);
						next.delete('purchase');
						next.delete('session_id');
						setSearchParams(next, { replace: true });
					},
				},
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [searchParams]);
```

- **Buy branch:** in the `needsPurchase` branch, replace the `buy` function and the returned JSX with:

```tsx
		const buy = () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			checkout.mutate(app.id, {
				onSuccess: (result) => window.location.assign(result.checkoutUrl),
				onError: (error) => toast.error(error.message),
			});
		};
		return (
			<div className="flex items-center gap-2">
				<span className="text-xs text-kumo-subtle">Secure checkout with Stripe</span>
				<Button size="sm" variant="primary" loading={checkout.isPending || confirm.isPending} onClick={buy}>
					Buy for {price}
				</Button>
			</div>
		);
```

If the repo's ESLint config has no `react-hooks/exhaustive-deps` rule, delete the disable comment.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/routes/payments-guard.test.ts src/routes/reuse-guard.test.ts src/lib`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts src/hooks/use-payments.ts src/hooks/use-publishing.ts src/components/publishing/UseSiteButton.tsx src/routes/payments-guard.test.ts src/routes/reuse-guard.test.ts
git commit -m "feat(payments): pay for a site with stripe checkout and confirm on return"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 7: Seller payouts, the publish gate in the dialog, earnings and admin sales

**Files:**
- Create: `src/components/payments/PayoutsCard.tsx`
- Modify: `src/components/publishing/PublishDialog.tsx`
- Modify: `src/components/publishing/PaidListingsList.tsx`
- Modify: `src/routes/profile.tsx`
- Modify: `src/routes/admin/reviews.tsx`
- Modify: `src/routes/payments-guard.test.ts` (append)

**Interfaces:**
- Consumes: the Task 6 hooks, `formatTemplatePrice` and `PLATFORM_FEE_PERCENT`.
- Produces: `<PayoutsCard />`.

- [ ] **Step 1: Extend the guard test**

Append to `src/routes/payments-guard.test.ts`:

```ts
const sellerSources = import.meta.glob<string>(
	[
		'/src/components/payments/PayoutsCard.tsx',
		'/src/components/publishing/PublishDialog.tsx',
		'/src/components/publishing/PaidListingsList.tsx',
		'/src/routes/profile.tsx',
		'/src/routes/admin/reviews.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function sellerSource(path: string): string {
	const text = sellerSources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('getting paid', () => {
	it('connects Stripe from the profile and opens the dashboard once set up', () => {
		const card = sellerSource('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain('Connect Stripe');
		expect(card).toContain('Open Stripe dashboard');
		expect(card).toContain('window.location.assign(');
		expect(sellerSource('/src/routes/profile.tsx')).toContain('<PayoutsCard />');
	});

	it('asks for Stripe before a paid publish and states the fee', () => {
		const dialog = sellerSource('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('Connect Stripe to sell this site');
		expect(dialog).toContain('PLATFORM_FEE_PERCENT');
		expect(dialog).not.toContain('test mode');
	});

	it('shows sellers their earnings and admins the sales and fees', () => {
		expect(sellerSource('/src/components/publishing/PaidListingsList.tsx')).toContain('listing.earningsCents');
		const reviews = sellerSource('/src/routes/admin/reviews.tsx');
		expect(reviews).toContain('useAdminSales()');
		expect(reviews).toContain('totalFeesCents');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/payments-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: The payouts card**

Create `src/components/payments/PayoutsCard.tsx`:

```tsx
import { toast } from 'sonner';
import { Badge, Button, Loader } from '@cloudflare/kumo';
import { useStartStripeOnboarding, useStripeConnectStatus, useStripeDashboardLink } from '@/hooks/use-payments';
import { PLATFORM_FEE_PERCENT } from '@/api-types';

/** "Get paid with Stripe": connect or finish Stripe onboarding, then open the Stripe dashboard. */
export function PayoutsCard() {
	const status = useStripeConnectStatus(true);
	const onboarding = useStartStripeOnboarding();
	const dashboard = useStripeDashboardLink();

	const startOnboarding = () =>
		onboarding.mutate(undefined, {
			onSuccess: (link) => window.location.assign(link.url),
			onError: (error) => toast.error(error.message),
		});
	const openDashboard = () =>
		dashboard.mutate(undefined, {
			onSuccess: (link) => window.location.assign(link.url),
			onError: (error) => toast.error(error.message),
		});

	if (status.isLoading) return <Loader />;
	if (status.isError) return <p className="text-sm text-kumo-subtle">{status.error.message}</p>;
	const data = status.data;
	if (!data?.configured) {
		return <p className="text-sm text-kumo-subtle">Payments aren't set up on this deployment.</p>;
	}

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid gap-0.5">
				<span className="text-sm font-medium text-kumo-default">Get paid with Stripe</span>
				<span className="text-sm text-kumo-subtle">
					Buyers pay through Stripe. You receive the price minus Estori's {PLATFORM_FEE_PERCENT}% fee.
				</span>
			</div>
			{data.transfersActive ? (
				<div className="flex items-center gap-2">
					<Badge variant="success">Payouts active</Badge>
					<Button size="sm" variant="secondary" loading={dashboard.isPending} onClick={openDashboard}>
						Open Stripe dashboard
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-2">
					{data.connected && <Badge variant="warning">Setup incomplete</Badge>}
					<Button size="sm" variant="primary" loading={onboarding.isPending} onClick={startOnboarding}>
						{data.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
					</Button>
				</div>
			)}
		</div>
	);
}
```

In `src/routes/profile.tsx`, add `import { PayoutsCard } from '@/components/payments/PayoutsCard';`, and render `<PayoutsCard />` above `<PaidListingsList />` inside the `paid` tab's `LayerCard.Primary`, wrapped in `<div className="grid gap-4">...</div>`. If the profile reads its active tab from component state, also initialize it from `?tab=paid` when present, so Stripe's return URL opens the right tab. Use the existing `useSearchParams` if the file has it; otherwise add it.

- [ ] **Step 4: The publish dialog gate**

In `src/components/publishing/PublishDialog.tsx`:
- **Imports:** add `useStartStripeOnboarding` and `useStripeConnectStatus` from `@/hooks/use-payments`, and `PLATFORM_FEE_PERCENT` to the `@/api-types` import.
- **Gate:** in `PublishForm`, add:

```tsx
	const payouts = useStripeConnectStatus(priceCents > 0);
	const onboarding = useStartStripeOnboarding();
	const paid = priceCents > 0;
	const sellerReady = !paid || payouts.data?.transfersActive === true;
```

- **Paid note:** replace the paid note paragraph (`{priceCents > 0 && (<p ...>An admin reviews ...</p>)}`) with:

```tsx
			{paid && (
				<p className="text-xs text-kumo-subtle">
					An admin reviews the price before anyone can use your site. Estori keeps {PLATFORM_FEE_PERCENT}% of each
					sale.
				</p>
			)}
			{paid && payouts.data && !payouts.data.configured && (
				<p className="text-sm text-kumo-subtle">Payments aren't set up on this deployment.</p>
			)}
			{paid && payouts.data?.configured && !payouts.data.transfersActive && (
				<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring ring-kumo-hairline">
					<span className="text-sm text-kumo-default">Connect Stripe to sell this site</span>
					<Button
						size="sm"
						variant="secondary"
						loading={onboarding.isPending}
						onClick={() =>
							onboarding.mutate(undefined, {
								onSuccess: (link) => window.location.assign(link.url),
								onError: (error) => toast.error(error.message),
							})
						}
					>
						{payouts.data.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
					</Button>
				</div>
			)}
```

- **Publish button:** change its `disabled` to `disabled={!consent || !sellerReady}`.

- [ ] **Step 5: Earnings and admin sales**

In `src/components/publishing/PaidListingsList.tsx`, import `formatTemplatePrice` from `@/api-types`. In `PaidListingRow`, replace the subtitle paragraph with:

```tsx
				<p className="text-sm text-kumo-subtle">
					{listing.buyerCount} {listing.buyerCount === 1 ? 'buyer' : 'buyers'} · Sales{' '}
					{formatTemplatePrice(listing.grossCents)} · Estori fee {formatTemplatePrice(listing.feeCents)} · You earn{' '}
					{formatTemplatePrice(listing.earningsCents)}
					{view?.detail ? ` · ${view.detail}` : ''}
				</p>
```

(`formatTemplatePrice(0)` reads "Free". For a money amount of zero, show `$0` instead: add a local `formatMoney(cents)` that returns `'$0'` for 0 and otherwise `formatTemplatePrice(cents)`, and use it for these three values.)

In `src/routes/admin/reviews.tsx`:
- import `useAdminSales` from `@/hooks/use-payments`;
- add this component:

```tsx
/** The latest Stripe sales and Estori's total fees. */
function SalesSection() {
	const sales = useAdminSales();
	if (sales.isLoading) return <Loader />;
	if (sales.isError || !sales.data) return null;
	const { sales: rows, totalFeesCents } = sales.data;
	return (
		<section className="grid gap-3 pt-4">
			<div className="grid gap-1">
				<h2 className="text-xl font-semibold text-kumo-strong">Sales</h2>
				<p className="text-sm text-kumo-subtle">Estori fees so far: {totalFeesCents > 0 ? formatTemplatePrice(totalFeesCents) : '$0'}</p>
			</div>
			{rows.length === 0 ? (
				<Empty size="sm" title="No sales yet" description="Paid sites bought through Stripe show up here." />
			) : (
				rows.map((sale) => (
					<div key={sale.purchaseId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 ring ring-kumo-hairline">
						<Link to={`/app/${sale.appId}`} className="text-sm font-medium text-kumo-default underline-offset-2 hover:underline">
							{sale.appTitle}
						</Link>
						<span className="text-sm text-kumo-subtle">
							{sale.buyerEmail ?? 'Unknown buyer'} · {formatTemplatePrice(sale.priceCents)} · fee{' '}
							{formatTemplatePrice(sale.platformFeeCents)}
							{sale.soldAt ? ` · ${new Date(sale.soldAt).toLocaleString()}` : ''}
						</span>
					</div>
				))
			)}
		</section>
	);
}
```

- render `<SalesSection />` after the pending reviews list, inside the `pending.data ? (...)` branch, so it only shows for admins.

- [ ] **Step 6: Verify the frontend**

Run: `npx vitest run src/routes/payments-guard.test.ts src/routes/reviews-guard.test.ts src/routes/publishing-guard.test.ts src/routes/reuse-guard.test.ts`
Expected: PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: only the 4 accepted artifacts-viewer errors.

Run eslint on the files changed in this plan; expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/payments src/components/publishing src/routes/profile.tsx src/routes/admin/reviews.tsx src/routes/payments-guard.test.ts
git commit -m "feat(payments): seller payouts card, stripe gate on paid publishing, earnings and admin sales"
```

(Append the harness `Co-Authored-By` trailer to the message.)

---

### Task 8: Local end-to-end in Stripe test mode

The controller runs this task. It needs the dev server, the Stripe CLI and the browser pane.

- [ ] **Step 1: Stack and webhook forwarding**

1. Start the dev server and the capture sidecar, as in the Discover plan Task 14.
2. Start webhook forwarding in the background:

```bash
K=$(grep -E '^STRIPE_SECRET_KEY=' .dev.vars | cut -d= -f2- | tr -d '"'); stripe listen --api-key "$K" --forward-to localhost:8100/api/stripe/webhook --events checkout.session.completed,checkout.session.async_payment_succeeded,account.updated
```

3. The CLI prints a session webhook signing secret. Never print the key or the secret into the transcript.
4. Read the secret with `stripe listen --api-key "$K" --print-secret`, and write it to `.dev.vars` as `STRIPE_WEBHOOK_SECRET`. Keep the previous value commented above it, with a note that it is the dashboard endpoint's secret.
5. Restart the dev server so it picks up the new secret.

- [ ] **Step 2: Test users and a seller account**

1. Create local test accounts on localhost: a second buyer, `templates-buyer2@example.test`, and `alastrat@pluriza.com`.
   - Generate the passwords and record them in `.superpowers/realtest/local-accounts.md`; never print them.
   - Set `role = 'admin'` for `alastrat@pluriza.com` in the local D1. Locally there is no OAuth provider, so the role grants access.
2. Link the creator `templates-creator@example.test` to the platform's existing verified Express test account. Insert a `stripe_connect_accounts` row into the local D1 with that account id.
3. Open `/profile?tab=paid` as the creator.
   Expected: "Payouts active". The status endpoint refreshed the flags from Stripe.
4. As the buyer, click "Connect Stripe" on the profile.
   Expected: the API returns a `connect.stripe.com` onboarding URL. Only check the response; don't fill Stripe's form.

- [ ] **Step 3: Sell, approve and buy**

1. As the creator, publish a deployed app at $29.
   Expected: the dialog has no Stripe prompt, because the creator is ready. Before the link in Step 2, the dialog showed "Connect Stripe to sell this site" and the API returned 400 with `SELLER_NOT_ONBOARDED_MESSAGE`.
2. As alastrat@pluriza.com (admin), approve it at `/admin/reviews`.
3. As the buyer, open the app and click "Buy for $29". The browser goes to Stripe Checkout in test mode. Pay with test card 4242 4242 4242 4242, any future expiry, any CVC and any ZIP.
4. Expected on return:
   - the toast "Payment received";
   - the button becomes "Use this site";
   - D1 has one `template_purchases` row with `provider = 'stripe'`, `price_cents = 2900`, `platform_fee_cents = 145` and `seller_amount_cents = 2755`;
   - the Stripe CLI shows `checkout.session.completed` delivered with 200;
   - still one row, not two.
5. Verify in Stripe test mode through the API:
   - the PaymentIntent has `application_fee_amount = 145`;
   - its `transfer_data.destination` is the seller account;
   - an application fee object of 145 exists.
6. Use the purchased site with a description. The copy comes from the approved snapshot.
7. As `templates-buyer2`, buy the same site with test card 5555 5555 5555 4444. A second purchase row appears.
8. Try a declined card (4000 0000 0000 0002) as a third buyer. Expected: Stripe shows the decline, and nothing is recorded.

- [ ] **Step 4: Earnings, sales and admin access**

1. As the creator, the profile shows 2 buyers, sales $58, Estori fee $2.90 and earnings $55.10.
2. As the admin, `/admin/reviews` lists both sales with total fees of $2.90.
3. Sign in as alastrat@pluriza.com locally and open `/admin/reviews`. Expected: the queue loads.

- [ ] **Step 5: Record**

Ledger `Task 8: complete` with the outcomes and any `Ruling:` lines. Stop the `stripe listen` process when done.
