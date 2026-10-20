# PostHog Analytics, Monitoring and Feature Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estori sends product analytics, session replays and errors to PostHog. It alerts on outages, errors and AI cost, and evaluates feature flags from a typed registry.

**Architecture:**
- **Worker code** lives in `worker/services/posthog/`, one module per concern:
  - config;
  - a request scope that hands work to `waitUntil`;
  - a batching capture client and typed analytics over it;
  - the `/ingest` proxy;
  - error reporting;
  - flag evaluation;
  - session telemetry;
  - the heartbeat.
- **Two registries in shared code,** used by the Worker and the app: the event catalog (`shared/types/analytics-events.ts`) and the flag registry (`shared/types/feature-flags.ts`).
- **The browser** loads posthog-js through `estori.app/ingest`. It gets its client flags and the analytics setting with the signed-in session.
- **Nothing is sent without `POSTHOG_PROJECT_KEY`,** and every flag is then off: nothing rolled out, nothing paused, billing on its own switches. Each task is safe to merge before the owner sets PostHog up.

**Tech Stack:** Cloudflare Workers (`node:async_hooks` AsyncLocalStorage under `nodejs_compat`, `env` from `cloudflare:workers`), Hono, D1 via Drizzle, Durable Objects (ThinkAgent, CodeGeneratorAgent), React 19, TanStack Query, posthog-js, `@posthog/cli`, vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-19-posthog-analytics-monitoring-flags-design.md`

**When:** implement after store drafts and billing merge into main.
- **From store drafts,** the plan assumes `worker/agents/think/draft-tools.ts`, `worker/api/controllers/drafts/controller.ts` and `src/components/drafts/DraftSwitcher.tsx`.
- **From billing** (`docs/superpowers/plans/2026-10-19-billing-subscriptions.md`), it assumes:
  - `worker/services/billing/` with `flag.ts` (`isBillingOn`), `account.ts` (`loadAccount`, `resolvePlan`), `gates.ts`, `events.ts`, `credit-notices.ts` and `wiring.ts`;
  - `BillingService` and `PlanAdminService`;
  - the billing and limits controllers.
- **If a billing name differs** from what a task says, follow billing's code and keep the task's behaviour.
- Branch `feat/posthog` from that main.

**Two pull requests.**
- **Pull request 1:** Tasks 1–17.
- **Task 18** runs on staging, after pull request 1 merges and the owner finishes the PostHog setup (spec section 16).
- **Pull request 2:** Task 19, which removes Sentry.

## Global Constraints

- **Code rules:**
  - No `any`.
  - No emojis in code, comments or copy.
  - Seller-facing copy follows `src/routes/copy-rules.ts`: no AI assistant or supplier names. "The AI" is fine.
- **PostHog hosts are constants** in `worker/services/posthog/config.ts`:
  - ingest `us.i.posthog.com`;
  - assets `us-assets.i.posthog.com`;
  - UI `https://us.posthog.com`.
  - The browser's `api_host` is `/ingest`.
- **Never to PostHog:** an email address, a name, a username or an avatar. This covers event properties, person properties and exceptions.
  - Worker exceptions replace emails with `[email]`.
  - Worker exceptions never send the logger's structured data.
  - **From the browser:** no page text, input value, element attribute or iframe; and no URL query or fragment, in events or replay data. `$pathname` stays.
- **Opted-out people,** by the setting or GPC: only `build_finished`'s `credits_used` is sent, under `opted-out`, with no person. Every other event about them stops.
- **Never on these pages:** posthog-js runs on estori.app only. It never runs on generated stores, previews, live stores, sellers' domains or the checkout page.
- **Analytics never breaks a request.** Capture and flag calls never throw.
  - Capture timeout 3 s.
  - Flags: timeout 1.5 s; cache 60 s per user and plan; failures cached 10 s.
  - Worker errors: one event per minute per fingerprint, 30 a minute per isolate.
- **No logger in the logger's path:** `config.ts`, `client.ts`, `request-scope.ts` and `server-errors.ts` in `worker/services/posthog/` never import `worker/logger`, because the logger imports them. They report their own trouble with `console.warn`.
- **Names come from the registries only:** event names and properties from `shared/types/analytics-events.ts`, flag keys from `shared/types/feature-flags.ts`.
- **Every flag defaults off.** Flags only ever turn something on (`billing`) or pause something (the `-paused` flags).
  - Pausing is a pause flag at 100%.
  - A missing, disabled or errored flag, or PostHog down, rolls nothing out and pauses nothing.
  - `billing` is also on with `BILLING=on`, or for a user in `BILLING_USER_IDS`.
- **No D1 migration.** The analytics setting lives in `users.preferences` JSON.
- **Commits:** subjects are lowercase after the type. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `.dev.vars` or `bun.lockb`;
  - anything under `.superpowers/` or `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx` or `wrangler.jsonc`, which carry local changes;
  - the untracked `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.
- **Tests:**
  - Run from the repo root, as `rtk proxy bun run test -- <files>`.
  - Run a few files at a time: many at once exhausts ports.
  - Type-check with `bun run typecheck`.
- **Before each pull request:** `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check` and `bun run test` (sharded).
- **Don't merge a pull request.** The owner merges.
- **Secrets:** never print a PostHog key in chat or logs. Never read `.dev.vars` aloud.

## Review Focus

1. **No request scope.** Controller tests pass `{}` as the `ExecutionContext`, and Durable Objects have no request.
   - **Expect:** capture, flags and error reports never throw, and still send from Durable Objects.
   - **Guarded by:** the request-scope tests in Task 2, and the `{}` context in Task 6's and Task 11's controller tests.
2. **A path that tries to leave PostHog,** such as `/ingest//attacker.example/collect` or an encoded variant.
   - **Expect:** the proxy only ever calls PostHog's two hosts.
   - **Guarded by:** "never leaves PostHog" in Task 3.
3. **PostHog hanging while someone signs in.** The profile, login and register answers wait on flags.
   - **Expect:** an answer within the 1.5 s timeout, with every flag off, so nothing is paused, and billing on its own switches.
   - **Guarded by:** the hang test in Task 5.
4. **An error storm, or PostHog itself failing:** a loop logging one error thousands of times, or the batch request failing.
   - **Expect:** one event a minute per error and 30 a minute at most. No error log from the PostHog client, which would feed the reporter.
   - **Guarded by:** the reporter tests in Task 4 and the import guard in Tasks 2 and 4.
5. **Two people on one browser:** A signs out and B signs in without a reload.
   - **Expect:** B's events never join A's PostHog person.
   - **Guarded by:** the reset-before-identify guard in Task 7.

---

### Task 1: The event catalog and the flag registry

**Files:**
- Create `shared/types/analytics-events.ts`. Test: `shared/types/analytics-events.test.ts`.
- Create `shared/types/feature-flags.ts`. Test: `shared/types/feature-flags.test.ts`.
- Create `shared/types/telemetry.ts` (API shapes only).
- Modify `src/api-types.ts`: re-export the three.

**Interfaces:**
- **Consumes:** `StoreMode` from `shared/types/store-payments.ts`, `SellerLevel` from `shared/types/seller-levels.ts`.
- **Produces:**
  - `analytics-events.ts`:
    - `SYSTEM_DISTINCT_ID = 'estori-system'`, `OPTED_OUT_DISTINCT_ID = 'opted-out'`;
    - `AMOUNT_BANDS`, `AmountBand`, `amountBand(cents: number): AmountBand`;
    - `SignInMethod`, `PersonProperties`;
    - `ServerEventCatalog`, `ServerEventName`, `ServerEventProperties<N>`, `BillingEventName`;
    - `ServerEventDefinition { description; subject; costFields? }`, `SERVER_EVENTS`, `SERVER_EVENT_NAMES`.
  - `feature-flags.ts`: `FlagKind = 'rollout' | 'pause'`, `FlagDefinition`, `FEATURE_FLAGS`, `FlagKey`, `FlagValues`, `ClientFlagKey`, `ClientFlagValues`, `FLAG_KEYS`, `isFlagKey(value: string): value is FlagKey`, `defaultFlagValues(): FlagValues`, `clientFlagValues(values: FlagValues): ClientFlagValues`.
  - `telemetry.ts`: `PostHogBrowserConfig`, `TelemetryConfigData`, `SessionTelemetry`, `AnalyticsOptOutSource`, `AnalyticsPreferenceData`, `GPC_ANALYTICS_MESSAGE`, `AdminFlagRow`, `AdminFlagsData`.

- [ ] **Step 1: Write the failing tests**

`shared/types/analytics-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SERVER_EVENTS, SERVER_EVENT_NAMES, amountBand } from './analytics-events';

describe('the server event catalog', () => {
	it('names every event in snake_case and describes it', () => {
		for (const name of SERVER_EVENT_NAMES) {
			expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/);
			expect(SERVER_EVENTS[name].description.length, name).toBeGreaterThan(10);
		}
	});

	it('holds the billing events by the names the billing spec uses', () => {
		expect(SERVER_EVENT_NAMES).toEqual(
			expect.arrayContaining(['subscription_started', 'subscription_changed', 'subscription_cancelled', 'subscription_payment_failed', 'credits_limit_reached']),
		);
	});

	it('ties every event to a person except the heartbeat', () => {
		expect(SERVER_EVENT_NAMES.filter((name) => SERVER_EVENTS[name].subject === 'system')).toEqual(['heartbeat']);
	});

	it("keeps only a build's credits for people who turned analytics off", () => {
		expect(SERVER_EVENT_NAMES.filter((name) => SERVER_EVENTS[name].costFields !== undefined)).toEqual(['build_finished']);
		expect(SERVER_EVENTS.build_finished.costFields).toEqual(['credits_used']);
	});
});

describe('amount bands', () => {
	it('puts a total in its band in US dollars, a lower edge in the band above', () => {
		expect(amountBand(0)).toBe('under_25');
		expect(amountBand(2_499)).toBe('under_25');
		expect(amountBand(2_500)).toBe('25_to_100');
		expect(amountBand(9_999)).toBe('25_to_100');
		expect(amountBand(10_000)).toBe('100_to_250');
		expect(amountBand(25_000)).toBe('250_to_1000');
		expect(amountBand(100_000)).toBe('1000_plus');
	});
});
```

`shared/types/feature-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, FLAG_KEYS, clientFlagValues, defaultFlagValues, isFlagKey } from './feature-flags';

describe('the flag registry', () => {
	it('holds billing and the four pause flags, keys in kebab case', () => {
		expect(FLAG_KEYS).toEqual(['billing', 'store-drafts-paused', 'live-store-payments-paused', 'catalog-paused', 'session-replay-paused']);
		for (const key of FLAG_KEYS) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
	});

	it('names every pause flag for what it pauses, and only those', () => {
		for (const key of FLAG_KEYS) expect(FEATURE_FLAGS[key].kind === 'pause', key).toBe(key.endsWith('-paused'));
		expect(FEATURE_FLAGS.billing.kind).toBe('rollout');
	});

	it('defaults every flag off, so a missing, disabled or errored flag changes nothing', () => {
		expect(defaultFlagValues()).toEqual({
			billing: false,
			'store-drafts-paused': false,
			'live-store-payments-paused': false,
			'catalog-paused': false,
			'session-replay-paused': false,
		});
	});

	it('sends only client-visible flags to the browser', () => {
		const all = { billing: true, 'store-drafts-paused': true, 'live-store-payments-paused': true, 'catalog-paused': true, 'session-replay-paused': true };
		expect(clientFlagValues(all)).toEqual({ billing: true, 'store-drafts-paused': true, 'catalog-paused': true, 'session-replay-paused': true });
	});

	it('recognizes registry keys only', () => {
		expect(isFlagKey('billing')).toBe(true);
		expect(isFlagKey('catalog')).toBe(false);
		expect(isFlagKey('toString')).toBe(false);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- shared/types/analytics-events.test.ts shared/types/feature-flags.test.ts`
Expected: FAIL, "Failed to resolve import ./analytics-events" and "./feature-flags".

- [ ] **Step 3: Write `shared/types/analytics-events.ts`** (exact copy; the catalog is the spec's table)

```ts
/**
 * Estori's server events: the one list of what the Worker sends to PostHog, with each event's properties. Names are
 * snake_case. Properties never hold an email address or a person's name. Types, not interfaces, so each fits
 * PostHog's JSON properties.
 */

import type { SellerLevel } from './seller-levels';
import type { StoreMode } from './store-payments';

/** The distinct id of events about Estori itself, such as the heartbeat and Worker errors. */
export const SYSTEM_DISTINCT_ID = 'estori-system';
/** The one distinct id of the cost fields still sent for people who turned analytics off; never a person. */
export const OPTED_OUT_DISTINCT_ID = 'opted-out';

export const AMOUNT_BANDS = ['under_25', '25_to_100', '100_to_250', '250_to_1000', '1000_plus'] as const;
export type AmountBand = (typeof AMOUNT_BANDS)[number];

/** A total's band in US dollars; a lower edge belongs to the band above it. */
export function amountBand(cents: number): AmountBand {
	if (cents < 2_500) return 'under_25';
	if (cents < 10_000) return '25_to_100';
	if (cents < 25_000) return '100_to_250';
	if (cents < 100_000) return '250_to_1000';
	return '1000_plus';
}

export type SignInMethod = 'password' | 'google' | 'github' | 'cloudflare';

/** What Estori keeps on each person in PostHog. */
export type PersonProperties = {
	/** The account's plan from billing's plan resolution: basic, premium or enterprise. */
	plan: string;
	/** Premium's credit tier, 1 to 4; null on other plans. */
	tier: number | null;
	seller_level: 'none' | SellerLevel;
	/** YYYY-MM-DD, UTC; set once. */
	signup_date: string;
	has_live_store: boolean;
};

export type ServerEventCatalog = {
	account_created: { method: SignInMethod };
	email_confirmed: Record<string, never>;
	signed_in: { method: SignInMethod };
	build_started: { app_id: string; model: string; first_build: boolean };
	build_finished: {
		app_id: string;
		model: string;
		first_build: boolean;
		outcome: 'completed' | 'failed';
		steps: number;
		/** Every Think build runs on Estori's gateway, so every credit is Estori's cost. */
		credits_used: number;
		duration_ms: number;
	};
	store_published: { app_id: string; first_publish: boolean; draft: 'main' | 'other' };
	store_unpublished: { app_id: string };
	payments_ready: Record<string, never>;
	sale_completed: {
		app_id: string;
		mode: StoreMode;
		total_band: AmountBand;
		application_fee_cents: number;
		has_catalog_items: boolean;
		first_sale: boolean;
	};
	catalog_order_placed: { app_id: string; item_count: number };
	template_sold: { listing_id: string; price_cents: number; platform_fee_cents: number };
	subscription_started: { tier: number };
	subscription_changed: { from_tier: number; to_tier: number; direction: 'up' | 'down' };
	subscription_cancelled: { tier: number | null; reason: 'seller' | 'payment_failed' | 'admin' };
	subscription_payment_failed: { tier: number | null; attempt: number };
	credits_limit_reached: { plan: string; tier: number | null; threshold: 80 | 100 };
	heartbeat: {
		healthy: boolean;
		app_ok: boolean;
		database_ok: boolean;
		/** Null when no live store exists to check. */
		stores_ok: boolean | null;
		failed: string[];
		duration_ms: number;
	};
};

export type ServerEventName = keyof ServerEventCatalog;
export type ServerEventProperties<N extends ServerEventName> = ServerEventCatalog[N];
export type BillingEventName = 'subscription_started' | 'subscription_changed' | 'subscription_cancelled' | 'subscription_payment_failed' | 'credits_limit_reached';

export interface ServerEventDefinition {
	description: string;
	subject: 'person' | 'system';
	/** Sent without a person when the user turned analytics off, under OPTED_OUT_DISTINCT_ID; every other field is dropped. */
	costFields?: readonly string[];
}

export const SERVER_EVENTS: Readonly<Record<ServerEventName, ServerEventDefinition>> = {
	account_created: { description: 'A password sign-up, or a provider sign-in that creates the account.', subject: 'person' },
	email_confirmed: { description: 'A confirmation link confirmed the account email.', subject: 'person' },
	signed_in: { description: 'A sign-in to an existing account.', subject: 'person' },
	build_started: { description: 'The AI started a turn on a store.', subject: 'person' },
	build_finished: { description: 'An AI turn ended, with its steps and credits.', subject: 'person', costFields: ['credits_used'] },
	store_published: { description: 'A store was published to its live address.', subject: 'person' },
	store_unpublished: { description: 'A live store was taken offline.', subject: 'person' },
	payments_ready: { description: "The seller's Stripe account can take store payments.", subject: 'person' },
	sale_completed: { description: 'A store order was recorded, once per order.', subject: 'person' },
	catalog_order_placed: { description: "A paid order's catalog lines went to the supplier flow.", subject: 'person' },
	template_sold: { description: "A paid site's sale was recorded.", subject: 'person' },
	subscription_started: { description: 'Premium started, from the checkout-completed webhook.', subject: 'person' },
	subscription_changed: { description: "Premium's tier changed, from the subscription-updated webhook.", subject: 'person' },
	subscription_cancelled: { description: 'Premium ended: cancelled by the seller, after failed payments, or by an admin.', subject: 'person' },
	subscription_payment_failed: { description: 'A Premium renewal payment failed, from the invoice-failed webhook.', subject: 'person' },
	credits_limit_reached: { description: "A monthly credit pool reached 80% or 100%, alongside billing's notice.", subject: 'person' },
	heartbeat: { description: 'The 15-minute health check of the app, database and stores.', subject: 'system' },
};

export const SERVER_EVENT_NAMES = Object.keys(SERVER_EVENTS) as ServerEventName[];
```

- [ ] **Step 4: Write `shared/types/feature-flags.ts`** (exact copy)

```ts
/**
 * Product rollouts and pauses, evaluated in PostHog (worker/services/posthog/flags.ts). Secrets and infrastructure
 * toggles stay env vars. Every flag defaults off: a flag only ever turns something on or pauses something. PostHog
 * leaves disabled flags out of its answer, so a missing, disabled or errored flag, or a PostHog outage, changes
 * nothing. Pausing means the pause flag at 100%.
 */

export type FlagKind = 'rollout' | 'pause';

export interface FlagDefinition {
	description: string;
	kind: FlagKind;
	/** Sent to the browser with the signed-in session; server-only flags never leave the Worker. */
	clientVisible: boolean;
}

export const FEATURE_FLAGS = {
	billing: {
		description: 'Plans, subscriptions and the billing page. Also on with BILLING=on, or for a user in BILLING_USER_IDS.',
		kind: 'rollout',
		clientVisible: true,
	},
	'store-drafts-paused': { description: 'Pauses starting new drafts of a store. Drafts that exist keep working.', kind: 'pause', clientVisible: true },
	'live-store-payments-paused': {
		description: 'Pauses real payments on live stores, which also need LIVE_STORE_PAYMENTS=on.',
		kind: 'pause',
		clientVisible: false,
	},
	'catalog-paused': {
		description: 'Pauses selling catalog products: checkout, the AI catalog tools and the catalog page. Paid orders still go to the supplier.',
		kind: 'pause',
		clientVisible: true,
	},
	'session-replay-paused': { description: 'Pauses session replay in the browser.', kind: 'pause', clientVisible: true },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FEATURE_FLAGS;
export type FlagValues = Record<FlagKey, boolean>;
export type ClientFlagKey = { [K in FlagKey]: (typeof FEATURE_FLAGS)[K]['clientVisible'] extends true ? K : never }[FlagKey];
export type ClientFlagValues = Record<ClientFlagKey, boolean>;

export const FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FlagKey[];

export function isFlagKey(value: string): value is FlagKey {
	return Object.hasOwn(FEATURE_FLAGS, value);
}

/** Every flag off: nothing rolled out, nothing paused. */
export function defaultFlagValues(): FlagValues {
	return Object.fromEntries(FLAG_KEYS.map((key) => [key, false])) as FlagValues;
}

export function clientFlagValues(values: FlagValues): ClientFlagValues {
	const visible = FLAG_KEYS.filter((key): key is ClientFlagKey => FEATURE_FLAGS[key].clientVisible);
	return Object.fromEntries(visible.map((key) => [key, values[key]])) as ClientFlagValues;
}
```

- [ ] **Step 5: Write `shared/types/telemetry.ts`** (exact copy)

```ts
/** What the API answers for analytics, the analytics setting and flags. */

import type { ClientFlagValues, FlagKey, FlagKind } from './feature-flags';

/** What posthog-js needs; `apiHost` is Estori's own `/ingest` proxy. */
export interface PostHogBrowserConfig {
	projectKey: string;
	apiHost: string;
	uiHost: string;
	environment: string;
}

/** `GET /api/telemetry/config`. A null `posthog` means analytics is off on this deployment. */
export interface TelemetryConfigData {
	posthog: PostHogBrowserConfig | null;
	/** `session-replay-paused` for visitors who aren't signed in. */
	replayPaused: boolean;
}

/** Sent with the signed-in session, so flag-dependent UI renders once. */
export interface SessionTelemetry {
	flags: ClientFlagValues;
	analyticsOptOut: boolean;
}

export type AnalyticsOptOutSource = 'settings' | 'gpc';

/** `GET` and `PUT /api/user/analytics`. */
export interface AnalyticsPreferenceData {
	optedOut: boolean;
	source: AnalyticsOptOutSource | null;
	/** This request carried the browser's Global Privacy Control signal, so analytics can't be turned on. */
	gpc: boolean;
}

export const GPC_ANALYTICS_MESSAGE = "Your browser's Global Privacy Control setting is on, so analytics stays off.";

export interface AdminFlagRow {
	key: FlagKey;
	description: string;
	kind: FlagKind;
	clientVisible: boolean;
	value: boolean;
	/** PostHog answered for this flag; false means it's off. */
	inPostHog: boolean;
}

/** `GET /api/admin/flags`: every registry flag, evaluated for one user. */
export interface AdminFlagsData {
	userId: string;
	/** posthog: PostHog answered; defaults: it didn't, so every flag is off; off: no project key on this deployment. */
	source: 'posthog' | 'defaults' | 'off';
	flags: AdminFlagRow[];
}
```

- [ ] **Step 6: Re-export from `src/api-types.ts`**, beside the other `shared/types` exports:

```ts
export type { AmountBand, PersonProperties, ServerEventName, ServerEventProperties } from '../shared/types/analytics-events.js';
export type { ClientFlagKey, ClientFlagValues, FlagKey, FlagKind, FlagValues } from '../shared/types/feature-flags.js';
export { FEATURE_FLAGS, FLAG_KEYS } from '../shared/types/feature-flags.js';
export type {
	AdminFlagRow,
	AdminFlagsData,
	AnalyticsOptOutSource,
	AnalyticsPreferenceData,
	PostHogBrowserConfig,
	SessionTelemetry,
	TelemetryConfigData,
} from '../shared/types/telemetry.js';
export { GPC_ANALYTICS_MESSAGE } from '../shared/types/telemetry.js';
```

- [ ] **Step 7: Run the tests and the type check**

Run: `rtk proxy bun run test -- shared/types/analytics-events.test.ts shared/types/feature-flags.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add shared/types/analytics-events.ts shared/types/analytics-events.test.ts shared/types/feature-flags.ts shared/types/feature-flags.test.ts shared/types/telemetry.ts src/api-types.ts
git commit -m "feat(analytics): the server event catalog and the feature flag registry, every flag off by default

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: The server capture client

**Files:**
- Create in `worker/services/posthog/`:
  - `config.ts` (test `config.test.ts`);
  - `request-scope.ts` (test `request-scope.test.ts`);
  - `client.ts` (test `client.test.ts`);
  - `analytics.ts` (test `analytics.test.ts`);
  - `import-guard.test.ts`;
  - `entry-wiring.test.ts`.
- Create `worker/database/services/AnalyticsPersonService.ts`. Test: `worker/database/services/analytics-person.sql.test.ts`. Export it from `worker/database/index.ts`.
- Modify `worker/index.ts`: run `fetch` and `scheduled` in the request scope.
- Modify `worker/types/env.d.ts` and `.dev.vars.example`.

**Interfaces:**
- **Consumes:** Task 1's catalog.
- **Produces:**
  - `config.ts`:
    - `POSTHOG_INGEST_HOST`, `POSTHOG_ASSET_HOST`, `POSTHOG_UI_ORIGIN`, `INGEST_PATH`;
    - `PostHogConfig { projectKey; environment; release }`;
    - `posthogConfig(env): PostHogConfig | null`;
    - `browserConfig(config): PostHogBrowserConfig | null`.
  - `request-scope.ts`: `runInRequestScope<T>(ctx: { waitUntil?: ... } | undefined, run: () => T): T`, `keepAlive(work: Promise<unknown>): void`.
  - `client.ts`:
    - `EventValue`, `CaptureInput { event; distinctId; properties; personless?; anonymousCost? }`;
    - `PostHogClientDeps`;
    - `PostHogClient` with `capture(input): void` and `flush(): Promise<void>`;
    - `CAPTURE_TIMEOUT_MS`, `MAX_QUEUED_EVENTS`, `BATCH_URL`.
  - `analytics.ts`:
    - `PersonUpdate { set?; setOnce? }`;
    - `ServerAnalytics.capture<N>(name: N, distinctId: string, properties: ServerEventProperties<N>, person?: PersonUpdate): void`;
    - `analyticsOver(client)`, `serverAnalytics(env: Env): ServerAnalytics`;
    - an event with catalog `costFields` carries `anonymousCost`: only those fields, sent under `OPTED_OUT_DISTINCT_ID` when its person turned analytics off.
  - `AnalyticsPersonService`:
    - `optedOutAmong(userIds): Promise<Set<string>>`;
    - `preference(userId): Promise<{ optedOut: boolean; source: AnalyticsOptOutSource | null }>`;
    - `setPreference(userId, optedOut, source, now): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { browserConfig, posthogConfig } from './config';

describe('PostHog config', () => {
	it('is off without a project key, so local development and tests send nothing', () => {
		expect(posthogConfig({ ENVIRONMENT: 'dev' })).toBeNull();
		expect(posthogConfig({ POSTHOG_PROJECT_KEY: '   ', ENVIRONMENT: 'prod' })).toBeNull();
	});

	it('names the environment and the Worker version', () => {
		expect(posthogConfig({ POSTHOG_PROJECT_KEY: ' phc_abc ', ENVIRONMENT: 'staging', CF_VERSION_METADATA: { id: 'ver-1' } })).toEqual({
			projectKey: 'phc_abc',
			environment: 'staging',
			release: 'ver-1',
		});
		expect(posthogConfig({ POSTHOG_PROJECT_KEY: 'phc_abc' })).toEqual({ projectKey: 'phc_abc', environment: 'dev', release: null });
	});

	it('gives the browser the key, the /ingest proxy and the US UI host', () => {
		expect(browserConfig(posthogConfig({ POSTHOG_PROJECT_KEY: 'phc_abc', ENVIRONMENT: 'prod' }))).toEqual({
			projectKey: 'phc_abc',
			apiHost: '/ingest',
			uiHost: 'https://us.posthog.com',
			environment: 'prod',
		});
		expect(browserConfig(null)).toBeNull();
	});
});
```

`worker/services/posthog/request-scope.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { keepAlive, runInRequestScope } from './request-scope';

describe('the request scope', () => {
	it("hands work to the request's waitUntil, across awaits", async () => {
		const kept: Promise<unknown>[] = [];
		await runInRequestScope({ waitUntil: (work: Promise<unknown>) => kept.push(work) }, async () => {
			await Promise.resolve();
			keepAlive(Promise.resolve('sent'));
		});
		expect(kept).toHaveLength(1);
	});

	it('runs without a waitUntil, as controller tests pass {} and Durable Objects have no request', async () => {
		expect(runInRequestScope({} as ExecutionContext, () => 7)).toBe(7);
		expect(runInRequestScope(undefined, () => 8)).toBe(8);
		expect(() => keepAlive(Promise.reject(new Error('PostHog down')))).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it('never hands a rejecting promise to waitUntil', async () => {
		const kept: Promise<unknown>[] = [];
		runInRequestScope({ waitUntil: (work: Promise<unknown>) => kept.push(work) }, () => keepAlive(Promise.reject(new Error('boom'))));
		await expect(kept[0]).resolves.toBeUndefined();
	});
});
```

`worker/services/posthog/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PostHogClient, MAX_QUEUED_EVENTS } from './client';
import type { PostHogConfig } from './config';

const CONFIG: PostHogConfig = { projectKey: 'phc_test', environment: 'staging', release: 'ver-1' };
const NOW = new Date('2026-10-19T12:00:00.000Z');

type SentBatch = { api_key: string; batch: Array<{ event: string; distinct_id: string; timestamp: string; properties: Record<string, unknown> }> };

function harness(options: {
	config?: PostHogConfig | null;
	optedOut?: (ids: readonly string[]) => Promise<ReadonlySet<string>>;
	respond?: (init: RequestInit | undefined) => Promise<Response>;
} = {}) {
	const requests: Array<{ url: string; body: SentBatch }> = [];
	const kept: Promise<unknown>[] = [];
	const lookedUp: string[][] = [];
	const client = new PostHogClient({
		config: options.config === undefined ? CONFIG : options.config,
		fetcher: async (input, init) => {
			requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as SentBatch });
			return options.respond ? options.respond(init) : new Response('{"status":1}', { status: 200 });
		},
		optedOut: async (ids) => {
			lookedUp.push([...ids]);
			return options.optedOut ? options.optedOut(ids) : new Set<string>();
		},
		keepAlive: (work) => {
			kept.push(work);
		},
		now: () => NOW,
		timeoutMs: 20,
	});
	return { client, requests, lookedUp, settle: () => Promise.all(kept) };
}

describe('the PostHog capture client', () => {
	it('sends events captured together as one batch, after the response, with the environment and release', async () => {
		const { client, requests, settle } = harness();
		client.capture({ event: 'store_published', distinctId: 'user_1', properties: { app_id: 'app_1' } });
		client.capture({ event: 'store_unpublished', distinctId: 'user_1', properties: { app_id: 'app_2' } });
		expect(requests).toHaveLength(0);
		await settle();
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe('https://us.i.posthog.com/batch/');
		expect(requests[0].body.api_key).toBe('phc_test');
		expect(requests[0].body.batch.map((event) => event.event)).toEqual(['store_published', 'store_unpublished']);
		expect(requests[0].body.batch[0]).toEqual({
			event: 'store_published',
			distinct_id: 'user_1',
			timestamp: '2026-10-19T12:00:00.000Z',
			properties: { app_id: 'app_1', environment: 'staging', release: 'ver-1', $lib: 'estori-worker' },
		});
	});

	it('sends nothing without a project key', async () => {
		const { client, requests, settle } = harness({ config: null });
		client.capture({ event: 'email_confirmed', distinctId: 'user_1', properties: {} });
		await settle();
		await client.flush();
		expect(requests).toEqual([]);
	});

	it('drops the events of people who turned analytics off', async () => {
		const { client, requests, lookedUp, settle } = harness({ optedOut: async () => new Set(['user_2']) });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		client.capture({ event: 'signed_in', distinctId: 'user_2', properties: { method: 'google' } });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		await settle();
		expect(lookedUp).toEqual([['user_1', 'user_2']]);
		expect(requests[0].body.batch.map((event) => event.distinct_id)).toEqual(['user_1', 'user_1']);
	});

	it("still counts an opted-out person's build credits, under the opted-out id, with no person and nothing else", async () => {
		const { client, requests, settle } = harness({ optedOut: async () => new Set(['user_2']) });
		const build = { app_id: 'app_9', model: 'm', first_build: false, outcome: 'completed', steps: 4, credits_used: 12, duration_ms: 900, $set: { plan: 'basic' } };
		client.capture({ event: 'build_finished', distinctId: 'user_2', properties: build, anonymousCost: { credits_used: 12 } });
		client.capture({ event: 'build_finished', distinctId: 'user_1', properties: build, anonymousCost: { credits_used: 12 } });
		await settle();
		expect(requests[0].body.batch.map((event) => [event.distinct_id, event.properties])).toEqual([
			['opted-out', { credits_used: 12, environment: 'staging', release: 'ver-1', $lib: 'estori-worker', $process_person_profile: false }],
			['user_1', { ...build, environment: 'staging', release: 'ver-1', $lib: 'estori-worker' }],
		]);
	});

	it('treats everyone as opted out when the setting cannot be read: cost fields only, and system events as usual', async () => {
		const { client, requests, settle } = harness({ optedOut: async () => Promise.reject(new Error('D1 down')) });
		client.capture({ event: 'signed_in', distinctId: 'user_1', properties: { method: 'password' } });
		client.capture({ event: 'build_finished', distinctId: 'user_1', properties: { credits_used: 7, app_id: 'app_1' }, anonymousCost: { credits_used: 7 } });
		client.capture({ event: 'heartbeat', distinctId: 'estori-system', properties: { healthy: true }, personless: true });
		await settle();
		expect(requests[0].body.batch.map((event) => [event.event, event.distinct_id])).toEqual([
			['build_finished', 'opted-out'],
			['heartbeat', 'estori-system'],
		]);
		expect(requests[0].body.batch[0].properties).not.toHaveProperty('app_id');
		expect(requests[0].body.batch[1]).toMatchObject({ properties: { $process_person_profile: false } });
	});

	it('never looks system events up', async () => {
		const { client, lookedUp, settle } = harness();
		client.capture({ event: '$exception', distinctId: 'estori-system', properties: {}, personless: true });
		await settle();
		expect(lookedUp).toEqual([]);
	});

	it.each([
		['an error answer', async () => new Response('busy', { status: 503 })],
		['a network failure', async () => Promise.reject(new Error('connection reset'))],
		[
			'a hang',
			(init: RequestInit | undefined) =>
				new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
		],
	])('never throws after %s', async (_name, respond) => {
		const { client, settle } = harness({ respond });
		client.capture({ event: 'email_confirmed', distinctId: 'user_1', properties: {} });
		await expect(settle()).resolves.toBeDefined();
	});

	it('holds at most 100 unsent events, so a runaway loop cannot grow without bound', async () => {
		const { client, requests, settle } = harness();
		for (let i = 0; i < MAX_QUEUED_EVENTS + 50; i++) client.capture({ event: 'email_confirmed', distinctId: `user_${i}`, properties: {} });
		await settle();
		expect(requests[0].body.batch).toHaveLength(MAX_QUEUED_EVENTS);
	});
});
```

`worker/services/posthog/analytics.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { analyticsOver, serverAnalytics } from './analytics';
import type { CaptureInput } from './client';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('typed server analytics', () => {
	it('sends a catalog event, with person properties as $set and $set_once', () => {
		const captured: CaptureInput[] = [];
		analyticsOver({ capture: (input) => captured.push(input) }).capture(
			'account_created',
			'user_1',
			{ method: 'google' },
			{ set: { plan: 'basic', has_live_store: false }, setOnce: { signup_date: '2026-10-19' } },
		);
		expect(captured).toEqual([
			{
				event: 'account_created',
				distinctId: 'user_1',
				personless: false,
				properties: { method: 'google', $set: { plan: 'basic', has_live_store: false }, $set_once: { signup_date: '2026-10-19' } },
			},
		]);
	});

	it("marks a build's credits as the only fields kept for someone who opted out", () => {
		const captured: CaptureInput[] = [];
		const build = { app_id: 'app_1', model: 'm', first_build: true, outcome: 'completed', steps: 3, credits_used: 8.4, duration_ms: 50 } as const;
		const analytics = analyticsOver({ capture: (input) => captured.push(input) });
		analytics.capture('build_finished', 'user_1', build);
		analytics.capture('signed_in', 'user_1', { method: 'password' });
		expect(captured.map((input) => input.anonymousCost)).toEqual([{ credits_used: 8.4 }, undefined]);
	});

	it('sends system events without a person profile', () => {
		const captured: CaptureInput[] = [];
		analyticsOver({ capture: (input) => captured.push(input) }).capture('heartbeat', SYSTEM_DISTINCT_ID, {
			healthy: true,
			app_ok: true,
			database_ok: true,
			stores_ok: null,
			failed: [],
			duration_ms: 12,
		});
		expect(captured[0]).toMatchObject({ event: 'heartbeat', distinctId: 'estori-system', personless: true });
	});

	it('sends nothing without a project key', async () => {
		const fetchMock = vi.fn(async () => new Response('{}'));
		vi.stubGlobal('fetch', fetchMock);
		serverAnalytics({ ENVIRONMENT: 'dev' } as unknown as Env).capture('email_confirmed', 'user_1', {});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
```

`worker/database/services/analytics-person.sql.test.ts` (each test makes its own writes; the pool rolls each test back):

```ts
/** The analytics setting on real SQL: kept in `users.preferences` beside whatever else is there. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';
import { AnalyticsPersonService } from './AnalyticsPersonService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['ana_1', 'ana_2', 'ana_3']) await insertUser(db, id);
	await db.prepare(`UPDATE users SET preferences = '{"theme":"dark"}' WHERE id = 'ana_3'`).run();
	await db.prepare(`UPDATE users SET preferences = NULL WHERE id = 'ana_2'`).run();
});

describe('the analytics setting', () => {
	it('starts on, with no source', async () => {
		expect(await new AnalyticsPersonService(envWith(db)).preference('ana_1')).toEqual({ optedOut: false, source: null });
	});

	it('stores an opt-out with its source, keeping other preferences, even from an empty column', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_3', true, 'gpc', new Date());
		await people.setPreference('ana_2', true, 'settings', new Date());
		expect(await people.preference('ana_3')).toEqual({ optedOut: true, source: 'gpc' });
		expect(await people.preference('ana_2')).toEqual({ optedOut: true, source: 'settings' });
		const row = await db.prepare(`SELECT json_extract(preferences, '$.theme') AS theme FROM users WHERE id = 'ana_3'`).first<{ theme: string }>();
		expect(row?.theme).toBe('dark');
	});

	it('finds who opted out among more ids than D1 binds at once', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_2', true, 'settings', new Date());
		await people.setPreference('ana_3', true, 'gpc', new Date());
		const ids = [...Array.from({ length: 120 }, (_, i) => `missing_${i}`), 'ana_1', 'ana_2', 'ana_3'];
		expect([...(await people.optedOutAmong(ids))].sort()).toEqual(['ana_2', 'ana_3']);
		expect(await people.optedOutAmong([])).toEqual(new Set());
	});

	it('turns analytics back on and clears the source', async () => {
		const people = new AnalyticsPersonService(envWith(db));
		await people.setPreference('ana_1', true, 'settings', new Date());
		await people.setPreference('ana_1', false, 'settings', new Date());
		expect(await people.preference('ana_1')).toEqual({ optedOut: false, source: null });
		expect(await people.optedOutAmong(['ana_1'])).toEqual(new Set());
	});
});
```

`worker/services/posthog/import-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

/** The logger imports these modules, so they must never import it back, nor log errors that would report again. */
const sources = import.meta.glob<string>(
	['/worker/services/posthog/config.ts', '/worker/services/posthog/client.ts', '/worker/services/posthog/request-scope.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

describe("the logger's own path to PostHog", () => {
	it('never imports the logger and never logs an error', () => {
		expect(Object.keys(sources)).toHaveLength(3);
		for (const [path, text] of Object.entries(sources)) {
			expect(text, path).not.toMatch(/from '[^']*logger'/);
			expect(text, path).not.toContain('.error(');
		}
	});
});
```

`worker/services/posthog/entry-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/index.ts'], { query: '?raw', import: 'default', eager: true });
const index = sources['/worker/index.ts'] ?? '';

describe('the Worker entry and the request scope', () => {
	it('runs every request in the scope, so analytics sends after the response', () => {
		expect(index).toContain('runInRequestScope(ctx, ');
		expect(index).toContain('handleFetch(request, env, ctx)');
	});

	it('runs the scheduled work in the scope too', () => {
		const scheduled = index.slice(index.indexOf('async scheduled('));
		expect(scheduled.indexOf('runInRequestScope(ctx, ')).toBeLessThan(scheduled.indexOf('runCatalogSchedule('));
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog worker/database/services/analytics-person.sql.test.ts`
Expected: FAIL. The new modules don't exist, and `worker/index.ts` has no `runInRequestScope`.

- [ ] **Step 3: Write `worker/services/posthog/config.ts`**

```ts
/** Where PostHog lives and whether this deployment talks to it. Never imports the logger: the logger imports this. */

import type { PostHogBrowserConfig } from '../../../shared/types/telemetry';

export const POSTHOG_INGEST_HOST = 'us.i.posthog.com';
export const POSTHOG_ASSET_HOST = 'us-assets.i.posthog.com';
export const POSTHOG_UI_ORIGIN = 'https://us.posthog.com';
/** The browser's PostHog traffic goes through Estori's own domain at this path (proxy.ts). */
export const INGEST_PATH = '/ingest';

export interface PostHogConfig {
	projectKey: string;
	environment: string;
	/** The Worker version, on every server event. */
	release: string | null;
}

type ConfigEnv = { POSTHOG_PROJECT_KEY?: string; ENVIRONMENT?: string; CF_VERSION_METADATA?: { id: string } };

/** Null without a project key: nothing is sent, and every flag is off. */
export function posthogConfig(env: ConfigEnv): PostHogConfig | null {
	const projectKey = env.POSTHOG_PROJECT_KEY?.trim();
	if (!projectKey) return null;
	return { projectKey, environment: env.ENVIRONMENT || 'dev', release: env.CF_VERSION_METADATA?.id ?? null };
}

export function browserConfig(config: PostHogConfig | null): PostHogBrowserConfig | null {
	return config ? { projectKey: config.projectKey, apiHost: INGEST_PATH, uiHost: POSTHOG_UI_ORIGIN, environment: config.environment } : null;
}
```

- [ ] **Step 4: Write `worker/services/posthog/request-scope.ts`**

```ts
/**
 * The request a piece of work belongs to, so analytics can send after the response through that request's
 * `waitUntil`. Durable Objects have no request scope; there the work runs on its own, since an object stays alive
 * while it has pending work. Never imports the logger: the logger's error path uses this.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

type WaitUntil = (work: Promise<unknown>) => void;

const scope = new AsyncLocalStorage<WaitUntil>();

export function runInRequestScope<T>(ctx: { waitUntil?: WaitUntil } | undefined, run: () => T): T {
	// Bound: workerd refuses an unbound waitUntil. Tests pass {} as the context, which has none.
	const waitUntil = typeof ctx?.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : null;
	return waitUntil ? scope.run(waitUntil, run) : run();
}

/** Keeps work running after the response. Never rejects, so a failure can't surface as an unhandled rejection. */
export function keepAlive(work: Promise<unknown>): void {
	const settled = work.then(
		() => undefined,
		() => undefined,
	);
	scope.getStore()?.(settled);
}
```

- [ ] **Step 5: Write `worker/services/posthog/client.ts`**

```ts
/**
 * A small PostHog capture client. It queues events and sends those captured in the same tick as one batch, after the
 * response. For people who turned analytics off it sends only an event's cost fields, under one shared id with no
 * person, and drops every other event; when the setting can't be read, everyone counts as opted out. It never throws
 * and never logs an error: the logger's error path uses it, so it warns on the console instead.
 */

import { OPTED_OUT_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { POSTHOG_INGEST_HOST, type PostHogConfig } from './config';

/** JSON values; undefined ones are left out when the batch is serialized. */
export type EventValue = string | number | boolean | null | undefined | EventValue[] | { [key: string]: EventValue };

export interface CaptureInput {
	event: string;
	distinctId: string;
	properties: Record<string, EventValue>;
	/** Events about Estori itself: no person profile and no analytics setting to check. */
	personless?: boolean;
	/** What is still sent, with no person, when this person turned analytics off: the catalog's cost fields. */
	anonymousCost?: Record<string, EventValue>;
}

export interface PostHogClientDeps {
	config: PostHogConfig | null;
	fetcher: typeof fetch;
	/** The ids among these that turned analytics off. A rejection counts everyone in the batch as opted out. */
	optedOut(userIds: readonly string[]): Promise<ReadonlySet<string>>;
	/** Keeps sending alive after the response (request-scope.ts). */
	keepAlive(work: Promise<unknown>): void;
	now(): Date;
	timeoutMs?: number;
}

export const CAPTURE_TIMEOUT_MS = 3_000;
/** A runaway loop can't hold more than this many unsent events. */
export const MAX_QUEUED_EVENTS = 100;
export const BATCH_URL = `https://${POSTHOG_INGEST_HOST}/batch/`;

interface QueuedEvent extends CaptureInput {
	timestamp: string;
}

function warn(msg: string, detail: Record<string, EventValue>): void {
	console.warn(JSON.stringify({ level: 'warn', component: 'PostHog', msg, ...detail }));
}

function reason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class PostHogClient {
	private queue: QueuedEvent[] = [];
	private flushScheduled = false;

	constructor(private readonly deps: PostHogClientDeps) {}

	capture(input: CaptureInput): void {
		if (!this.deps.config || this.queue.length >= MAX_QUEUED_EVENTS) return;
		this.queue.push({ ...input, timestamp: this.deps.now().toISOString() });
		if (this.flushScheduled) return;
		this.flushScheduled = true;
		this.deps.keepAlive(Promise.resolve().then(() => this.flush()));
	}

	async flush(): Promise<void> {
		this.flushScheduled = false;
		const config = this.deps.config;
		const events = this.queue.splice(0);
		if (!config || events.length === 0) return;
		try {
			const sendable = await this.withoutOptedOut(events);
			if (sendable.length === 0) return;
			const response = await this.deps.fetcher(BATCH_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ api_key: config.projectKey, batch: sendable.map((event) => batchEvent(event, config)) }),
				signal: AbortSignal.timeout(this.deps.timeoutMs ?? CAPTURE_TIMEOUT_MS),
			});
			if (!response.ok) warn('PostHog refused a batch', { status: response.status, events: sendable.length });
		} catch (error) {
			warn('PostHog capture failed', { error: reason(error), events: events.length });
		}
	}

	private async withoutOptedOut(events: QueuedEvent[]): Promise<QueuedEvent[]> {
		const people = [...new Set(events.filter((event) => !event.personless).map((event) => event.distinctId))];
		if (people.length === 0) return events;
		let optedOut: ReadonlySet<string> | null = null;
		try {
			optedOut = await this.deps.optedOut(people);
		} catch (error) {
			warn('Could not read analytics settings; treating everyone as opted out', { error: reason(error) });
		}
		return events.flatMap((event): QueuedEvent[] => {
			if (event.personless || (optedOut !== null && !optedOut.has(event.distinctId))) return [event];
			// Opted out: only the cost fields, under the shared id, so the AI budget still counts everyone.
			if (!event.anonymousCost) return [];
			return [{ event: event.event, distinctId: OPTED_OUT_DISTINCT_ID, properties: event.anonymousCost, personless: true, timestamp: event.timestamp }];
		});
	}
}

function batchEvent(event: QueuedEvent, config: PostHogConfig) {
	return {
		event: event.event,
		distinct_id: event.distinctId,
		timestamp: event.timestamp,
		properties: {
			...event.properties,
			environment: config.environment,
			...(config.release ? { release: config.release } : {}),
			$lib: 'estori-worker',
			...(event.personless ? { $process_person_profile: false } : {}),
		},
	};
}
```

- [ ] **Step 6: Write `worker/database/services/AnalyticsPersonService.ts`**

```ts
/** What analytics needs from a user's record. The analytics setting lives in `users.preferences` JSON. */

import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import type { AnalyticsOptOutSource } from '../../../shared/types/telemetry';

/** D1 binds at most 100 values per statement. */
const ID_CHUNK = 50;
const OPT_OUT = sql`json_extract(${schema.users.preferences}, '$.analyticsOptOut')`;
const OPT_OUT_SOURCE = sql`json_extract(${schema.users.preferences}, '$.analyticsOptOutSource')`;

export class AnalyticsPersonService extends BaseService {
	async optedOutAmong(userIds: readonly string[]): Promise<Set<string>> {
		const found = new Set<string>();
		for (let start = 0; start < userIds.length; start += ID_CHUNK) {
			const rows = await this.database
				.select({ id: schema.users.id })
				.from(schema.users)
				.where(and(inArray(schema.users.id, userIds.slice(start, start + ID_CHUNK)), sql`${OPT_OUT} = 1`))
				.all();
			for (const row of rows) found.add(row.id);
		}
		return found;
	}

	async preference(userId: string): Promise<{ optedOut: boolean; source: AnalyticsOptOutSource | null }> {
		const row = await this.database
			.select({ optedOut: sql<number | null>`${OPT_OUT}`, source: sql<string | null>`${OPT_OUT_SOURCE}` })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.get();
		const optedOut = row?.optedOut === 1;
		const source = row?.source === 'settings' || row?.source === 'gpc' ? row.source : null;
		return { optedOut, source: optedOut ? source : null };
	}

	/** Keeps every other preference; turning analytics on clears the source. */
	async setPreference(userId: string, optedOut: boolean, source: AnalyticsOptOutSource, now: Date): Promise<void> {
		await this.database
			.update(schema.users)
			.set({
				preferences: sql`json_set(coalesce(${schema.users.preferences}, '{}'), '$.analyticsOptOut', json(${optedOut ? 'true' : 'false'}), '$.analyticsOptOutSource', ${optedOut ? source : null})`,
				updatedAt: now,
			})
			.where(eq(schema.users.id, userId))
			.run();
	}
}
```

Export it from `worker/database/index.ts`, beside the other services: `export { AnalyticsPersonService } from './services/AnalyticsPersonService';`.

- [ ] **Step 7: Write `worker/services/posthog/analytics.ts`**

```ts
/** Estori's typed server analytics: the catalog's names and properties only, over the capture client. */

import { SERVER_EVENTS, type PersonProperties, type ServerEventName, type ServerEventProperties } from '../../../shared/types/analytics-events';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { PostHogClient, type CaptureInput, type EventValue } from './client';
import { posthogConfig } from './config';
import { keepAlive } from './request-scope';

export interface PersonUpdate {
	set?: Partial<PersonProperties>;
	setOnce?: Partial<PersonProperties>;
}

export interface ServerAnalytics {
	capture<N extends ServerEventName>(name: N, distinctId: string, properties: ServerEventProperties<N>, person?: PersonUpdate): void;
}

export function analyticsOver(client: Pick<PostHogClient, 'capture'>): ServerAnalytics {
	return {
		capture(name, distinctId, properties, person) {
			const fields: Record<string, EventValue> = { ...properties };
			const props: Record<string, EventValue> = { ...fields };
			if (person?.set) props.$set = person.set;
			if (person?.setOnce) props.$set_once = person.setOnce;
			const definition = SERVER_EVENTS[name];
			const input: CaptureInput = { event: name, distinctId, properties: props, personless: definition.subject === 'system' };
			if (definition.costFields) input.anonymousCost = Object.fromEntries(definition.costFields.map((field) => [field, fields[field]]));
			client.capture(input);
		},
	};
}

/** A client for this request or Durable Object call; events captured in one tick go out together. */
export function serverAnalytics(env: Env): ServerAnalytics {
	return analyticsOver(
		new PostHogClient({
			config: posthogConfig(env),
			fetcher: (input, init) => fetch(input, init),
			optedOut: (userIds) => new AnalyticsPersonService(env).optedOutAmong(userIds),
			keepAlive,
			now: () => new Date(),
		}),
	);
}
```

- [ ] **Step 8: Run every request in the scope** (`worker/index.ts`)
  1. Import `runInRequestScope` from `./services/posthog/request-scope`.
  2. Move the body of `worker.fetch` unchanged into `async function handleFetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>`, above `const worker`.
  3. Replace the handlers:

```ts
const worker = {
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return runInRequestScope(ctx, () => handleFetch(request, env, ctx));
	},
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		runInRequestScope(ctx, () => {
			ctx.waitUntil(runCatalogSchedule(controller.cron, env));
			ctx.waitUntil(runStorePaymentsSchedule(controller.cron, env));
			ctx.waitUntil(runLiveStoresSchedule(controller.cron, env));
			ctx.waitUntil(runShopperEmailSchedule(controller.cron, env));
		});
	},
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 9: Declare the vars.**

In `worker/types/env.d.ts`, after `STRIPE_CONNECT_WEBHOOK_SECRET`:

```ts
		// PostHog's project key for this environment; unset, nothing is sent and every flag is off.
		POSTHOG_PROJECT_KEY?: string;
		// Outside production only: flag values that win over PostHog, such as "billing=on,catalog-paused=on".
		FEATURE_FLAG_OVERRIDES?: string;
```

In `.dev.vars.example`, under `# Feature flags`:

```
# PostHog: unset, local development sends nothing. Use the staging project's key to try analytics locally.
#POSTHOG_PROJECT_KEY=""
# Flag values for local development, e.g. "billing=on,catalog-paused=on"; production ignores them.
#FEATURE_FLAG_OVERRIDES=""
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog worker/database/services/analytics-person.sql.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add worker/services/posthog worker/database/services/AnalyticsPersonService.ts worker/database/services/analytics-person.sql.test.ts worker/database/index.ts worker/index.ts worker/types/env.d.ts .dev.vars.example
git commit -m "feat(analytics): a batching posthog capture client that sends after the response and skips people who opted out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: The `/ingest` proxy

**Files:**
- Create `worker/services/posthog/proxy.ts`. Test: `worker/services/posthog/proxy.test.ts`.
- Modify `worker/index.ts`: route `/ingest` before the public site.
- Modify `worker/services/public-site/sitemap.ts` (`PRIVATE_PATHS`) and `worker/services/public-site/sitemap.test.ts`.
- Modify `worker/services/posthog/entry-wiring.test.ts`.

**Interfaces:**
- **Consumes:** `INGEST_PATH`, `POSTHOG_INGEST_HOST`, `POSTHOG_ASSET_HOST` and `posthogConfig` from Task 2.
- **Produces:**
  - `isIngestPath(pathname: string): boolean`;
  - `ingestTarget(url: URL): URL`;
  - `proxyPostHog(request: Request, env: Env, fetcher?: typeof fetch): Promise<Response>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/proxy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ingestTarget, isIngestPath, proxyPostHog } from './proxy';

const ENV = { POSTHOG_PROJECT_KEY: 'phc_test', ENVIRONMENT: 'prod' } as unknown as Env;

function recorder(upstream = () => new Response('ok', { status: 200, headers: { 'Set-Cookie': 'ph=1', 'Content-Type': 'text/plain' } })) {
	const calls: Array<{ url: string; init: RequestInit<RequestInitCfProperties> }> = [];
	const fetcher: typeof fetch = async (input, init) => {
		calls.push({ url: String(input), init: init ?? {} });
		return upstream();
	};
	return { calls, fetcher };
}

const at = (path: string, init?: RequestInit) => new Request(`https://estori.app${path}`, init);

describe('the /ingest proxy', () => {
	it('sends events to the ingest host and scripts and config to the asset host, keeping the query', () => {
		expect(ingestTarget(new URL('https://estori.app/ingest/e/?ip=1&ver=1.2')).toString()).toBe('https://us.i.posthog.com/e/?ip=1&ver=1.2');
		expect(ingestTarget(new URL('https://estori.app/ingest/static/recorder.js?v=1')).toString()).toBe('https://us-assets.i.posthog.com/static/recorder.js?v=1');
		expect(ingestTarget(new URL('https://estori.app/ingest/array/phc_test/config.js')).toString()).toBe('https://us-assets.i.posthog.com/array/phc_test/config.js');
		expect(ingestTarget(new URL('https://estori.app/ingest')).toString()).toBe('https://us.i.posthog.com/');
	});

	it('never leaves PostHog, whatever the path says', () => {
		for (const path of ['/ingest//attacker.example/collect', '/ingest/%2F%2Fattacker.example/x', '/ingest/@attacker.example/x', '/ingest/..%2F..%2Fapi/auth/profile']) {
			expect(ingestTarget(new URL(`https://estori.app${path}`)).hostname, path).toBe('us.i.posthog.com');
		}
	});

	it('matches /ingest and below only', () => {
		expect(isIngestPath('/ingest')).toBe(true);
		expect(isIngestPath('/ingest/e/')).toBe(true);
		expect(isIngestPath('/ingestion')).toBe(false);
		expect(isIngestPath('/api/ingest')).toBe(false);
	});

	it('forwards the body, safe headers and the client IP, and never cookies, Authorization or the staging key', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(
			at('/ingest/e/?compression=gzip-js', {
				method: 'POST',
				body: 'payload',
				headers: {
					'Content-Type': 'text/plain',
					'User-Agent': 'Browser/1.0',
					Cookie: 'accessToken=secret; estori_staging=digest',
					Authorization: 'Bearer secret',
					'x-estori-staging-key': 'staging-secret',
					'CF-Connecting-IP': '203.0.113.9',
				},
			}),
			ENV,
			fetcher,
		);
		const sent = new Headers(calls[0].init.headers);
		expect(calls[0].url).toBe('https://us.i.posthog.com/e/?compression=gzip-js');
		expect(calls[0].init.method).toBe('POST');
		expect(sent.get('content-type')).toBe('text/plain');
		expect(sent.get('user-agent')).toBe('Browser/1.0');
		expect(sent.get('x-forwarded-for')).toBe('203.0.113.9');
		for (const name of ['cookie', 'authorization', 'x-estori-staging-key', 'cf-connecting-ip']) expect(sent.has(name), name).toBe(false);
		expect(await new Response(calls[0].init.body).text()).toBe('payload');
	});

	it('takes no cookie back from PostHog', async () => {
		const { fetcher } = recorder();
		const response = await proxyPostHog(at('/ingest/flags/?v=2', { method: 'POST', body: '{}' }), ENV, fetcher);
		expect(response.status).toBe(200);
		expect(response.headers.get('set-cookie')).toBeNull();
		expect(response.headers.get('content-type')).toBe('text/plain');
	});

	it('caches versioned scripts but not remote config or events', async () => {
		const { calls, fetcher } = recorder();
		await proxyPostHog(at('/ingest/static/recorder.js?v=1'), ENV, fetcher);
		await proxyPostHog(at('/ingest/array/phc_test/config.js'), ENV, fetcher);
		await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), ENV, fetcher);
		expect(calls.map((call) => call.init.cf ?? null)).toEqual([{ cacheEverything: true, cacheTtl: 3600 }, null, null]);
	});

	it('answers 404 without a project key and 405 for other methods, calling nobody', async () => {
		const { calls, fetcher } = recorder();
		expect((await proxyPostHog(at('/ingest/e/', { method: 'POST', body: '{}' }), { ENVIRONMENT: 'prod' } as unknown as Env, fetcher)).status).toBe(404);
		expect((await proxyPostHog(at('/ingest/e/', { method: 'DELETE' }), ENV, fetcher)).status).toBe(405);
		expect(calls).toEqual([]);
	});
});
```

In `worker/services/public-site/sitemap.test.ts`, change the expected `disallowed` list to `['/api/', '/admin/', '/chat/', '/apps', '/settings', '/profile', '/ingest/']`.

In `worker/services/posthog/entry-wiring.test.ts`, add:

```ts
	it('sends /ingest to PostHog before the public site, on the main domain only', () => {
		const main = index.slice(index.indexOf('if (isMainDomainRequest) {'));
		expect(main.indexOf('if (isIngestPath(pathname))')).toBeGreaterThan(-1);
		expect(main.indexOf('if (isIngestPath(pathname))')).toBeLessThan(main.indexOf('return servePublicSite('));
		expect(index).toContain('return proxyPostHog(request, env);');
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/proxy.test.ts worker/services/posthog/entry-wiring.test.ts worker/services/public-site/sitemap.test.ts`
Expected: FAIL. `./proxy` doesn't resolve, the wiring is missing, and `/ingest/` isn't disallowed.

- [ ] **Step 3: Write `worker/services/posthog/proxy.ts`**

```ts
/**
 * Estori's own route to PostHog for the browser: /ingest/* on estori.app. Scripts and remote config come from
 * PostHog's asset host, everything else from its ingest host. posthog-js, bundled from npm, lazy-loads recorder.js
 * and its exception script from `<api_host>/static`, so they come through here too and the CSP needs no PostHog
 * host. Only a short list of headers goes out, so no session cookie, Authorization header or staging key reaches
 * PostHog, and no cookie comes back.
 */

import { INGEST_PATH, POSTHOG_ASSET_HOST, POSTHOG_INGEST_HOST, posthogConfig } from './config';

const ASSET_PATHS = ['/static/', '/array/'] as const;
const FORWARDED_HEADERS = ['accept', 'accept-encoding', 'accept-language', 'content-encoding', 'content-type', 'origin', 'referer', 'user-agent'] as const;
const ALLOWED_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'OPTIONS']);
/** Versioned scripts only: remote config under /array/ must follow setting changes. */
const STATIC_CACHE_SECONDS = 3600;

export function isIngestPath(pathname: string): boolean {
	return pathname === INGEST_PATH || pathname.startsWith(`${INGEST_PATH}/`);
}

/** PostHog's URL for an /ingest request. The host is fixed; setting a URL's pathname can never change its host. */
export function ingestTarget(url: URL): URL {
	const path = url.pathname.slice(INGEST_PATH.length) || '/';
	const host = ASSET_PATHS.some((prefix) => path.startsWith(prefix)) ? POSTHOG_ASSET_HOST : POSTHOG_INGEST_HOST;
	const target = new URL(`https://${host}/`);
	target.pathname = path;
	target.search = url.search;
	return target;
}

export async function proxyPostHog(request: Request, env: Env, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<Response> {
	if (!posthogConfig(env)) return new Response('Not found', { status: 404 });
	if (!ALLOWED_METHODS.has(request.method)) return new Response('Method not allowed', { status: 405 });
	const target = ingestTarget(new URL(request.url));
	const headers = new Headers();
	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	const ip = request.headers.get('CF-Connecting-IP');
	if (ip) headers.set('X-Forwarded-For', ip);
	const cacheable = request.method === 'GET' && target.pathname.startsWith('/static/');
	const upstream = await fetcher(target.toString(), {
		method: request.method,
		headers,
		body: request.method === 'POST' ? request.body : undefined,
		redirect: 'manual',
		...(cacheable ? { cf: { cacheEverything: true, cacheTtl: STATIC_CACHE_SECONDS } } : {}),
	});
	const responseHeaders = new Headers(upstream.headers);
	responseHeaders.delete('set-cookie');
	return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}
```

- [ ] **Step 4: Route it.**

In `worker/index.ts`:
1. Import `isIngestPath` and `proxyPostHog` from `./services/posthog/proxy`.
2. In the `isMainDomainRequest` branch, right before `if (!pathname.startsWith('/api/'))`, add:

```ts
			// The browser's PostHog traffic, through Estori's own domain (services/posthog/proxy.ts).
			if (isIngestPath(pathname)) {
				return proxyPostHog(request, env);
			}
```

In `worker/services/public-site/sitemap.ts`, add `'/ingest/'` to the end of `PRIVATE_PATHS`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/proxy.test.ts worker/services/posthog/entry-wiring.test.ts worker/services/public-site`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/services/posthog/proxy.ts worker/services/posthog/proxy.test.ts worker/services/posthog/entry-wiring.test.ts worker/index.ts worker/services/public-site/sitemap.ts worker/services/public-site/sitemap.test.ts
git commit -m "feat(analytics): proxy the browser's posthog traffic through estori.app/ingest without cookies or auth headers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Worker errors to PostHog

**Files:**
- Create `worker/services/posthog/server-errors.ts`. Test: `worker/services/posthog/server-errors.test.ts`.
- Modify `worker/logger/core.ts` (`error()`). Test: `worker/logger/core-errors.test.ts`.
- Create `worker/api/unhandled-error.ts`. Test: `worker/api/unhandled-error.test.ts`.
- Modify `worker/app.ts`: `app.onError(unhandledApiError)`.
- Modify `worker/index.ts`: log an unhandled request error.
- Modify `worker/services/posthog/import-guard.test.ts` and `entry-wiring.test.ts`.

**Interfaces:**
- **Consumes:** `PostHogClient`, `CaptureInput`, `EventValue`, `posthogConfig` and `keepAlive` from Task 2; `SYSTEM_DISTINCT_ID` from Task 1.
- **Produces:**
  - `ServerErrorInput { component: string; message: string; error?: Error }`;
  - `ExceptionFrame`;
  - `parseStack(stack?: string): ExceptionFrame[]`;
  - `scrubEmails(text: string): string`;
  - `errorFingerprint(input): string`;
  - `exceptionProperties(input): Record<string, EventValue>`;
  - `ErrorReporter` with `report(input): void`;
  - `reportServerError(input): void`;
  - `ERRORS_PER_MINUTE = 30`, `REPEAT_WINDOW_MS = 60_000`;
  - `unhandledApiError: ErrorHandler<AppEnv>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/server-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ErrorReporter, errorFingerprint, exceptionProperties, parseStack, reportServerError, scrubEmails } from './server-errors';
import type { CaptureInput } from './client';

const STACK = [
	'TypeError: x is undefined',
	'    at readSlug (index.js:120:15)',
	'    at async LiveStoreController.publish (index.js:300:9)',
	'    at index.js:10:1',
].join('\n');

describe('stack frames', () => {
	it('reads V8 frames, oldest call first and the throwing frame last', () => {
		expect(parseStack(STACK)).toEqual([
			{ platform: 'custom', lang: 'javascript', function: '?', filename: 'index.js', lineno: 10, colno: 1, in_app: true },
			{ platform: 'custom', lang: 'javascript', function: 'LiveStoreController.publish', filename: 'index.js', lineno: 300, colno: 9, in_app: true },
			{ platform: 'custom', lang: 'javascript', function: 'readSlug', filename: 'index.js', lineno: 120, colno: 15, in_app: true },
		]);
	});

	it('answers no frames for a missing or unreadable stack', () => {
		expect(parseStack(undefined)).toEqual([]);
		expect(parseStack('Error: no frames here')).toEqual([]);
	});
});

describe('exception events', () => {
	it('carries the type, the message and the log line with emails removed, and the component', () => {
		const error = new TypeError('No user ana@example.com');
		error.stack = STACK;
		expect(exceptionProperties({ component: 'AuthController', message: 'Registration error for bob.smith@example.org', error })).toEqual({
			component: 'AuthController',
			log_message: 'Registration error for [email]',
			$exception_level: 'error',
			$exception_list: [
				{ type: 'TypeError', value: 'No user [email]', mechanism: { handled: true, synthetic: false }, stacktrace: { type: 'raw', frames: parseStack(STACK) } },
			],
		});
	});

	it('makes the log line the exception when no error was given, marked synthetic', () => {
		expect(exceptionProperties({ component: 'StripeWebhook', message: 'Stripe webhook rejected' }).$exception_list).toEqual([
			{ type: 'Error', value: 'Stripe webhook rejected', mechanism: { handled: true, synthetic: true }, stacktrace: { type: 'raw', frames: [] } },
		]);
	});

	it('removes email addresses wherever they appear', () => {
		expect(scrubEmails('From <ana+shop@example.co.uk>, to "x@y.io"')).toBe('From <[email]>, to "[email]"');
	});

	it('treats errors that differ only in ids and numbers as one', () => {
		const a = errorFingerprint({ component: 'Runner', message: 'step failed', error: new Error('Order ord_8f3a9c21d0 failed after 3 attempts') });
		const b = errorFingerprint({ component: 'Runner', message: 'step failed', error: new Error('Order ord_1b2c3d4e5f failed after 4 attempts') });
		expect(a).toBe(b);
		expect(errorFingerprint({ component: 'Other', message: 'step failed', error: new Error('Order ord_1 failed') })).not.toBe(a);
	});
});

describe('the error reporter', () => {
	function reporter(send: (input: CaptureInput) => void = () => undefined) {
		let now = 0;
		const sent: CaptureInput[] = [];
		const errors = new ErrorReporter(
			(input) => {
				sent.push(input);
				send(input);
			},
			{ perMinute: 30, repeatWindowMs: 60_000 },
			() => now,
		);
		return { errors, sent, advance: (ms: number) => (now += ms) };
	}

	it('sends a personless $exception from the system id', () => {
		const { errors, sent } = reporter();
		errors.report({ component: 'AuthController', message: 'Registration error', error: new Error('boom') });
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ event: '$exception', distinctId: 'estori-system', personless: true });
	});

	it('sends a repeated error once a minute', () => {
		const { errors, sent, advance } = reporter();
		for (let i = 0; i < 1_000; i++) errors.report({ component: 'Loop', message: 'tick failed', error: new Error(`tick ${i} failed`) });
		expect(sent).toHaveLength(1);
		advance(60_000);
		errors.report({ component: 'Loop', message: 'tick failed', error: new Error('tick 1001 failed') });
		expect(sent).toHaveLength(2);
	});

	it('sends at most 30 errors a minute', () => {
		const { errors, sent, advance } = reporter();
		for (let i = 0; i < 50; i++) errors.report({ component: `Component${'x'.repeat(i)}`, message: 'failed' });
		expect(sent).toHaveLength(30);
		advance(60_000);
		errors.report({ component: 'Fresh', message: 'failed' });
		expect(sent).toHaveLength(31);
	});

	it('never throws, even when sending does', () => {
		const { errors } = reporter(() => {
			throw new Error('PostHog client broke');
		});
		expect(() => errors.report({ component: 'A', message: 'b' })).not.toThrow();
	});

	it('is a quiet no-op without a project key', () => {
		expect(() => reportServerError({ component: 'Test', message: 'nothing configured' })).not.toThrow();
	});
});
```

`worker/logger/core-errors.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportServerError } = vi.hoisted(() => ({ reportServerError: vi.fn() }));
vi.mock('../services/posthog/server-errors', () => ({ reportServerError }));

const { createLogger } = await import('./core');

describe('the logger and PostHog', () => {
	beforeEach(() => {
		reportServerError.mockClear();
	});

	it('reports each error with its component, message and error', () => {
		const error = new TypeError('kaput');
		createLogger('AuthController').error('Registration error', error, { userId: 'u1' });
		expect(reportServerError).toHaveBeenCalledWith({ component: 'AuthController', message: 'Registration error', error });
	});

	it("takes the error from the data's error field, as most calls log it", () => {
		const error = new Error('D1 timeout');
		createLogger('StripeWebhook').error('Stripe webhook handling failed', { type: 'charge.updated', id: 'evt_1', error });
		expect(reportServerError).toHaveBeenCalledWith({ component: 'StripeWebhook', message: 'Stripe webhook handling failed', error });
	});

	it('reports an error logged without one', () => {
		createLogger('StripeWebhook').error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set');
		expect(reportServerError).toHaveBeenCalledWith({ component: 'StripeWebhook', message: 'Stripe webhook rejected: STRIPE_WEBHOOK_SECRET is not set', error: undefined });
	});

	it('reports nothing for warnings and info', () => {
		createLogger('Quiet').warn('slow');
		createLogger('Quiet').info('fine');
		expect(reportServerError).not.toHaveBeenCalled();
	});
});
```

`worker/api/unhandled-error.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from '../types/appenv';

const { reportServerError } = vi.hoisted(() => ({ reportServerError: vi.fn() }));
vi.mock('../services/posthog/server-errors', () => ({ reportServerError }));

const { unhandledApiError } = await import('./unhandled-error');

function app() {
	const routes = new Hono<AppEnv>();
	routes.get('/api/boom', () => {
		throw new TypeError('kaput');
	});
	routes.get('/api/teapot', () => {
		throw new HTTPException(418, { message: 'short and stout' });
	});
	routes.onError(unhandledApiError);
	return routes;
}

describe('an error no route handled', () => {
	it('is reported and answered as a plain 500', async () => {
		const response = await app().request('/api/boom');
		expect(response.status).toBe(500);
		expect(await response.json()).toMatchObject({ success: false, error: { message: 'Internal server error' } });
		expect(reportServerError).toHaveBeenCalledWith(expect.objectContaining({ component: 'UnhandledApiError', message: 'Unhandled API error' }));
	});

	it("keeps an HTTPException's own answer and reports nothing", async () => {
		reportServerError.mockClear();
		const response = await app().request('/api/teapot');
		expect(response.status).toBe(418);
		expect(reportServerError).not.toHaveBeenCalled();
	});
});
```

Add `'/worker/services/posthog/server-errors.ts'` to the glob in `import-guard.test.ts`, and make its count `4`.

Add to `entry-wiring.test.ts`:

```ts
	it('logs a request error no handler caught, then rethrows it', () => {
		const fetchHandler = index.slice(index.indexOf('fetch(request: Request, env: Env, ctx: ExecutionContext)'));
		expect(fetchHandler).toContain("logger.error('Unhandled request error'");
		expect(fetchHandler).toContain('throw error;');
	});
```

And in a new `worker/api/app-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/app.ts'], { query: '?raw', import: 'default', eager: true });

describe('the Hono app', () => {
	it('reports errors no route handled', () => {
		expect(sources['/worker/app.ts']).toContain('app.onError(unhandledApiError);');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/server-errors.test.ts worker/logger/core-errors.test.ts worker/api/unhandled-error.test.ts worker/api/app-wiring.test.ts`
Expected: FAIL. `./server-errors` and `./unhandled-error` don't resolve, and the logger doesn't report.

Run: `rtk proxy bun run test -- worker/services/posthog/import-guard.test.ts worker/services/posthog/entry-wiring.test.ts`
Expected: FAIL. The guard can't find `server-errors.ts`, and the request error isn't logged.

- [ ] **Step 3: Write `worker/services/posthog/server-errors.ts`**

```ts
/**
 * Worker errors to PostHog as `$exception` events. The logger's error path and unhandled API errors report here.
 * A repeated error goes once a minute, and at most 30 go a minute per isolate, so a loop can't flood PostHog. Email
 * addresses are removed, and the logger's structured data is never sent. It reads its key from the Worker's env, so
 * Durable Objects report too. Never imports the logger, which imports this.
 */

import { env } from 'cloudflare:workers';
import { SYSTEM_DISTINCT_ID } from '../../../shared/types/analytics-events';
import { PostHogClient, type CaptureInput, type EventValue } from './client';
import { posthogConfig } from './config';
import { keepAlive } from './request-scope';

export interface ServerErrorInput {
	component: string;
	message: string;
	error?: Error;
}

/** A type, not an interface, so frames fit the event's JSON properties. */
export type ExceptionFrame = {
	platform: 'custom';
	lang: 'javascript';
	function: string;
	filename: string;
	lineno: number;
	colno: number;
	in_app: boolean;
};

export const ERRORS_PER_MINUTE = 30;
export const REPEAT_WINDOW_MS = 60_000;
const MINUTE_MS = 60_000;
const MAX_FINGERPRINTS = 500;
const FRAME_LINE = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;

export function scrubEmails(text: string): string {
	return text.replace(EMAIL, '[email]');
}

/** V8 stack lines as PostHog's raw frames: oldest call first, the throwing frame last. */
export function parseStack(stack: string | undefined): ExceptionFrame[] {
	const frames: ExceptionFrame[] = [];
	for (const line of (stack ?? '').split('\n')) {
		const match = FRAME_LINE.exec(line);
		if (!match) continue;
		const [, fn, filename, lineno, colno] = match;
		frames.push({
			platform: 'custom',
			lang: 'javascript',
			function: fn ? fn.replace(/^async /, '') : '?',
			filename,
			lineno: Number(lineno),
			colno: Number(colno),
			in_app: !filename.includes('node_modules'),
		});
	}
	return frames.reverse();
}

/** Errors that differ only in ids and numbers share a fingerprint. */
export function errorFingerprint(input: ServerErrorInput): string {
	const value = (input.error?.message || input.message).replace(/\b\w*\d\w*\b/g, '#');
	return `${input.component}|${input.error?.name || 'Error'}|${value}`;
}

export function exceptionProperties(input: ServerErrorInput): Record<string, EventValue> {
	const error = input.error;
	return {
		component: input.component,
		log_message: scrubEmails(input.message),
		$exception_level: 'error',
		$exception_list: [
			{
				type: error?.name || 'Error',
				value: scrubEmails(error?.message || input.message),
				mechanism: { handled: true, synthetic: error === undefined },
				stacktrace: { type: 'raw', frames: parseStack(error?.stack) },
			},
		],
	};
}

export class ErrorReporter {
	private readonly lastSent = new Map<string, number>();
	private windowStartMs = Number.NEGATIVE_INFINITY;
	private sentInWindow = 0;

	constructor(
		private readonly send: (input: CaptureInput) => void,
		private readonly limits: { perMinute: number; repeatWindowMs: number },
		private readonly nowMs: () => number = Date.now,
	) {}

	report(input: ServerErrorInput): void {
		try {
			const now = this.nowMs();
			const fingerprint = errorFingerprint(input);
			const last = this.lastSent.get(fingerprint);
			if (last !== undefined && now - last < this.limits.repeatWindowMs) return;
			if (now - this.windowStartMs >= MINUTE_MS) {
				this.windowStartMs = now;
				this.sentInWindow = 0;
			}
			if (this.sentInWindow >= this.limits.perMinute) return;
			this.sentInWindow += 1;
			if (this.lastSent.size >= MAX_FINGERPRINTS) this.lastSent.clear();
			this.lastSent.set(fingerprint, now);
			this.send({ event: '$exception', distinctId: SYSTEM_DISTINCT_ID, personless: true, properties: exceptionProperties(input) });
		} catch {
			// Reporting an error must never raise one.
		}
	}
}

let isolateClient: { projectKey: string; client: PostHogClient } | null = null;

/** The isolate's own client, built on first use, so no request is needed. */
function sendFromIsolate(input: CaptureInput): void {
	const config = posthogConfig(env);
	if (!config) return;
	if (isolateClient?.projectKey !== config.projectKey) {
		isolateClient = {
			projectKey: config.projectKey,
			client: new PostHogClient({ config, fetcher: (request, init) => fetch(request, init), optedOut: async () => new Set<string>(), keepAlive, now: () => new Date() }),
		};
	}
	isolateClient.client.capture(input);
}

const reporter = new ErrorReporter(sendFromIsolate, { perMinute: ERRORS_PER_MINUTE, repeatWindowMs: REPEAT_WINDOW_MS });

export function reportServerError(input: ServerErrorInput): void {
	reporter.report(input);
}
```

- [ ] **Step 4: Report from the logger.**

In `worker/logger/core.ts`:
1. Import `reportServerError` from `'../services/posthog/server-errors'`.
2. Replace `error()`:

```ts
	error(message: string, ...args: unknown[]): void {
		const { data, error } = this.processArgsWithError(args);
		Sentry.captureException(error || new Error(message), { extra: data });
		// Most calls pass the error inside their data, as `{ error }`.
		const reported = error ?? (data.error instanceof Error ? data.error : undefined);
		reportServerError({ component: this.component, message, error: reported });
		this.log('error', message, data, error);
	}
```

Sentry's line stays until Task 19. It is a no-op today.

- [ ] **Step 5: Write `worker/api/unhandled-error.ts`**

```ts
/** The answer to an error no route handled: logged, and so reported to PostHog, then answered as a plain 500. */

import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createLogger } from '../logger';
import type { AppEnv } from '../types/appenv';
import { errorResponse } from './responses';

const logger = createLogger('UnhandledApiError');

export const unhandledApiError: ErrorHandler<AppEnv> = (error, c) => {
	if (error instanceof HTTPException) return error.getResponse();
	logger.error('Unhandled API error', error, { method: c.req.method, path: new URL(c.req.url).pathname });
	return errorResponse('Internal server error', 500);
};
```

In `worker/app.ts`:
1. Import `unhandledApiError` from `'./api/unhandled-error'`.
2. Add `app.onError(unhandledApiError);` right after `setupRoutes(app);`.

- [ ] **Step 6: Log a request error no handler caught.** In `worker/index.ts`, make `fetch`:

```ts
	fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return runInRequestScope(ctx, async () => {
			try {
				return await handleFetch(request, env, ctx);
			} catch (error) {
				logger.error('Unhandled request error', error, { path: new URL(request.url).pathname });
				throw error;
			}
		});
	},
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog worker/logger worker/api/unhandled-error.test.ts worker/api/app-wiring.test.ts`
Expected: PASS.

Run: `bun run typecheck && bun run bundle:check`
Expected: no errors. The bundle resolves `cloudflare:workers`.

- [ ] **Step 8: Commit**

```bash
git add worker/services/posthog worker/logger/core.ts worker/logger/core-errors.test.ts worker/api/unhandled-error.ts worker/api/unhandled-error.test.ts worker/api/app-wiring.test.ts worker/app.ts worker/index.ts
git commit -m "feat(errors): worker errors go to posthog as exceptions, once a minute each, without emails or log data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Server flag evaluation

**Files:**
- Create `worker/services/posthog/flags.ts`. Test: `worker/services/posthog/flags.test.ts`.
- Create `worker/services/posthog/person.ts` with `accountPlanOf`. Test: `worker/services/posthog/account-plan.sql.test.ts`. Task 10 adds to the module.

**Interfaces:**
- **Consumes:**
  - Task 1's registry; `posthogConfig` and `POSTHOG_INGEST_HOST` from Task 2;
  - billing (merged first): `isBillingOn(env, userId)` from `worker/services/billing/flag.ts`; `resolvePlan` from `worker/services/billing/account.ts`; `BillingService.subscriptionOf` and `PlanAdminService.latestOverride`.
- **Produces:**
  - constants: `FLAG_CACHE_MS = 60_000`, `FLAG_FAILURE_CACHE_MS = 10_000`, `FLAG_TIMEOUT_MS = 1_500`, `FLAGS_URL`, `ANONYMOUS_FLAG_SUBJECT = 'anonymous-visitor'`;
  - `FlagSubject { distinctId: string; plan(): Promise<string> }`, the plan read only when PostHog is asked;
  - `FlagEvaluation { values: FlagValues; source: 'posthog' | 'defaults' | 'off'; inPostHog: FlagKey[] }`;
  - `FlagEvaluator` with `evaluate(subject): Promise<FlagEvaluation>`;
  - `parseFlagOverrides(text?)`, `flagOverridesOf(env)`, `readFlagsAnswer(body)`;
  - `flagsFor(env: Env, userId: string | null): Promise<FlagEvaluation>`, with `billing` also on when `isBillingOn(env, userId)`;
  - `isFlagOn(env: Env, key: FlagKey, userId: string | null): Promise<boolean>`;
  - in `person.ts`: `AccountPlan { plan: string; tier: number | null }` and `accountPlanOf(env: Env, userId: string | null): Promise<AccountPlan>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/flags.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlagKey, FlagValues } from '../../../shared/types/feature-flags';
import { FlagEvaluator, flagOverridesOf, flagsFor, isFlagOn, parseFlagOverrides, type FlagSubject } from './flags';
import type { PostHogConfig } from './config';

const CONFIG: PostHogConfig = { projectKey: 'phc_test', environment: 'prod', release: null };
const USER: FlagSubject = { distinctId: 'user_1', plan: async () => 'basic' };
const OFF: FlagValues = { billing: false, 'store-drafts-paused': false, 'live-store-payments-paused': false, 'catalog-paused': false, 'session-replay-paused': false };

function flagsAnswer(flags: Partial<Record<FlagKey, boolean>>, errorsWhileComputingFlags = false): Response {
	return Response.json({
		flags: Object.fromEntries(Object.entries(flags).map(([key, enabled]) => [key, { key, enabled, reason: { code: 'condition_match' }, metadata: { id: 1, version: 1 } }])),
		errorsWhileComputingFlags,
		requestId: 'req-1',
	});
}

function evaluator(respond: (init: RequestInit | undefined) => Promise<Response>, overrides: Partial<FlagValues> = {}) {
	let now = 0;
	const requests: Array<{ url: string; body: unknown }> = [];
	const flags = new FlagEvaluator({
		config: CONFIG,
		fetcher: async (input, init) => {
			requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
			return respond(init);
		},
		nowMs: () => now,
		overrides,
		timeoutMs: 20,
	});
	return { flags, requests, advance: (ms: number) => (now += ms) };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('server flag evaluation', () => {
	it('asks PostHog for the user, with the plan for targeting, and reads each registry flag', async () => {
		const { flags, requests } = evaluator(async () => flagsAnswer({ billing: true, 'catalog-paused': true }));
		const evaluation = await flags.evaluate(USER);
		expect(requests).toEqual([
			{ url: 'https://us.i.posthog.com/flags?v=2', body: { api_key: 'phc_test', distinct_id: 'user_1', person_properties: { plan: 'basic' } } },
		]);
		expect(evaluation).toEqual({ values: { ...OFF, billing: true, 'catalog-paused': true }, source: 'posthog', inPostHog: ['billing', 'catalog-paused'] });
	});

	it('reads a pause flag that PostHog leaves out, because it is disabled or deleted, as not paused', async () => {
		const { flags } = evaluator(async () => flagsAnswer({}));
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'posthog', inPostHog: [] });
	});

	it('caches each user for 60 seconds, reading the plan only when it asks PostHog', async () => {
		let planReads = 0;
		const subject: FlagSubject = { distinctId: 'user_1', plan: async () => (planReads++, 'basic') };
		const { flags, requests, advance } = evaluator(async () => flagsAnswer({ billing: true }));
		await flags.evaluate(subject);
		await flags.evaluate(subject);
		expect([requests.length, planReads]).toEqual([1, 1]);
		await flags.evaluate({ distinctId: 'user_2', plan: async () => 'premium' });
		expect(requests).toHaveLength(2);
		advance(60_000);
		await flags.evaluate(subject);
		expect([requests.length, planReads]).toEqual([3, 2]);
	});

	it.each([
		['an error answer', async () => new Response('down', { status: 503 })],
		['a network failure', async () => Promise.reject(new Error('connection reset'))],
		['a quota-limited answer', async () => Response.json({ flags: {}, quotaLimited: ['feature_flags'], errorsWhileComputingFlags: false })],
		['an answer computed with errors', async () => flagsAnswer({ billing: true, 'catalog-paused': true }, true)],
		['an answer that is not JSON', async () => new Response('<html>', { status: 200 })],
	])('turns every flag off after %s, so nothing is paused or rolled out, and asks again after 10 seconds', async (_name, respond) => {
		const { flags, requests, advance } = evaluator(respond);
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'defaults', inPostHog: [] });
		advance(9_999);
		await flags.evaluate(USER);
		expect(requests).toHaveLength(1);
		advance(1);
		await flags.evaluate(USER);
		expect(requests).toHaveLength(2);
	});

	it('answers within its timeout when PostHog hangs, so sign-in never waits on it', async () => {
		const { flags } = evaluator((init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))));
		const started = Date.now();
		expect((await flags.evaluate(USER)).source).toBe('defaults');
		expect(Date.now() - started).toBeLessThan(1_000);
	});

	it('answers every flag off without a project key, asking nobody', async () => {
		const fetcher = vi.fn<typeof fetch>();
		const flags = new FlagEvaluator({ config: null, fetcher, nowMs: () => 0, overrides: {} });
		expect(await flags.evaluate(USER)).toEqual({ values: OFF, source: 'off', inPostHog: [] });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('lets overrides win over PostHog', async () => {
		const { flags } = evaluator(async () => flagsAnswer({ billing: false }), { billing: true, 'catalog-paused': true });
		expect((await flags.evaluate(USER)).values).toEqual({ ...OFF, billing: true, 'catalog-paused': true });
	});
});

describe('flag overrides', () => {
	it('reads on and off pairs, ignoring unknown keys and values', () => {
		expect(parseFlagOverrides('billing=on, catalog-paused=on,nope=on,store-drafts-paused=maybe,')).toEqual({ billing: true, 'catalog-paused': true });
		expect(parseFlagOverrides(undefined)).toEqual({});
	});

	it('applies outside production only', () => {
		expect(flagOverridesOf({ ENVIRONMENT: 'prod', FEATURE_FLAG_OVERRIDES: 'billing=on' })).toEqual({});
		expect(flagOverridesOf({ ENVIRONMENT: 'staging', FEATURE_FLAG_OVERRIDES: 'billing=on' })).toEqual({ billing: true });
	});
});

describe('flags for a user or a visitor', () => {
	it("evaluates a signed-in user with their plan, and a visitor as the shared anonymous subject", async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => flagsAnswer({ 'session-replay-paused': true }));
		vi.stubGlobal('fetch', fetchMock);
		const env = { POSTHOG_PROJECT_KEY: 'phc_flags_for', ENVIRONMENT: 'prod' } as unknown as Env;
		expect((await flagsFor(env, 'user_9')).values['session-replay-paused']).toBe(true);
		expect(await isFlagOn(env, 'session-replay-paused', null)).toBe(true);
		const subjects = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { distinct_id: string; person_properties: { plan: string } });
		// No billing tables in this env, so the user's plan falls back to Basic.
		expect(subjects.map((body) => [body.distinct_id, body.person_properties.plan])).toEqual([
			['user_9', 'basic'],
			['anonymous-visitor', 'none'],
		]);
	});
});

describe('the billing flag', () => {
	it("keeps billing's own switches: BILLING=on, or an account in BILLING_USER_IDS, whatever PostHog says", async () => {
		const noKey = { ENVIRONMENT: 'prod' };
		expect(await isFlagOn({ ...noKey, BILLING: 'on' } as unknown as Env, 'billing', 'user_1')).toBe(true);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1, user_2' } as unknown as Env, 'billing', 'user_2')).toBe(true);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1' } as unknown as Env, 'billing', 'user_3')).toBe(false);
		expect(await isFlagOn({ ...noKey, BILLING_USER_IDS: 'user_1' } as unknown as Env, 'billing', null)).toBe(false);
		vi.stubGlobal('fetch', vi.fn(async () => flagsAnswer({ billing: false })));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_off', ENVIRONMENT: 'prod', BILLING: 'on' } as unknown as Env, 'billing', 'user_3')).toBe(true);
	});

	it('adds accounts PostHog targets, and never drops a paying seller when PostHog fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => flagsAnswer({ billing: true })));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_on', ENVIRONMENT: 'prod' } as unknown as Env, 'billing', 'user_4')).toBe(true);
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('PostHog down'))));
		expect(await isFlagOn({ POSTHOG_PROJECT_KEY: 'phc_billing_down', ENVIRONMENT: 'prod', BILLING_USER_IDS: 'user_5' } as unknown as Env, 'billing', 'user_5')).toBe(true);
	});
});
```

`worker/services/posthog/account-plan.sql.test.ts`:

```ts
/** The plan flags and person properties use: billing's own resolution, on real SQL. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { accountPlanOf } from './person';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	for (const id of ['plan_1', 'plan_2', 'plan_admin']) await insertUser(db, id);
});

describe("an account's plan", () => {
	it('is Basic with no subscription or override, and what billing resolves otherwise', async () => {
		expect(await accountPlanOf(envWith(db), 'plan_1')).toEqual({ plan: 'basic', tier: null });
		await new PlanAdminService(envWith(db)).addOverride({ userId: 'plan_2', plan: 'premium', tier: 2, limits: {}, until: null, adminUserId: 'plan_admin', reason: 'Partner', now: new Date() });
		expect(await accountPlanOf(envWith(db), 'plan_2')).toEqual({ plan: 'premium', tier: 2 });
	});

	it("is none for a visitor, and Basic when billing's tables can't be read", async () => {
		expect(await accountPlanOf(envWith(db), null)).toEqual({ plan: 'none', tier: null });
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database);
		expect(await accountPlanOf(broken, 'plan_1')).toEqual({ plan: 'basic', tier: null });
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/flags.test.ts worker/services/posthog/account-plan.sql.test.ts`
Expected: FAIL, "Failed to resolve import ./flags" and "./person".

- [ ] **Step 3: Write `worker/services/posthog/person.ts`**

```ts
/** What flags and person properties know about an account's plan. */

import { BillingService } from '../../database/services/BillingService';
import { PlanAdminService } from '../../database/services/PlanAdminService';
import { resolvePlan } from '../billing/account';

export interface AccountPlan {
	plan: string;
	tier: number | null;
}

/**
 * The plan billing resolves from the subscription and any admin override. It reads the tables directly, not through
 * `loadAccount`, because `loadAccount` asks the billing flag, which asks this. A visitor has none; a read that fails
 * answers Basic.
 */
export async function accountPlanOf(env: Env, userId: string | null): Promise<AccountPlan> {
	if (!userId) return { plan: 'none', tier: null };
	try {
		const [subscription, override] = await Promise.all([new BillingService(env).subscriptionOf(userId), new PlanAdminService(env).latestOverride(userId)]);
		const resolved = resolvePlan({ subscription, override, nowMs: Date.now() });
		return { plan: resolved.plan, tier: resolved.tier };
	} catch {
		return { plan: 'basic', tier: null };
	}
}
```

`person.ts` and billing's `account.ts` import each other through `flags.ts` once Task 9 moves `loadAccount` onto `isFlagOn`. Each side uses the other only inside functions, so the cycle is safe. Never call either at module top level.

- [ ] **Step 4: Write `worker/services/posthog/flags.ts`**

```ts
/**
 * Feature flags from PostHog, for the registry in shared/types/feature-flags.ts. Every flag defaults off, so a flag
 * PostHog leaves out (disabled or deleted), a failure, a timeout, a quota-limited answer or one computed with errors
 * pauses nothing and rolls nothing out. Answers are cached in the isolate for 60 s per user; failures for 10 s.
 * Outside production, FEATURE_FLAG_OVERRIDES wins. Billing's own switches keep billing on whatever PostHog says.
 * Nothing here throws.
 */

import { FLAG_KEYS, defaultFlagValues, isFlagKey, type FlagKey, type FlagValues } from '../../../shared/types/feature-flags';
import { isBillingOn } from '../billing/flag';
import { POSTHOG_INGEST_HOST, posthogConfig, type PostHogConfig } from './config';
import { accountPlanOf } from './person';

export const FLAG_CACHE_MS = 60_000;
export const FLAG_FAILURE_CACHE_MS = 10_000;
export const FLAG_TIMEOUT_MS = 1_500;
export const FLAGS_URL = `https://${POSTHOG_INGEST_HOST}/flags?v=2`;
/** Visitors who aren't signed in share one subject, so a flag's global setting reaches them. */
export const ANONYMOUS_FLAG_SUBJECT = 'anonymous-visitor';
const MAX_CACHED_SUBJECTS = 1_000;

export interface FlagSubject {
	distinctId: string;
	/** Read only when PostHog is asked, so a cached answer costs no plan lookup. */
	plan(): Promise<string>;
}

export interface FlagEvaluation {
	values: FlagValues;
	/** posthog: PostHog answered; defaults: it didn't, so every flag is off; off: no project key. */
	source: 'posthog' | 'defaults' | 'off';
	/** Flags PostHog answered for; the rest are off. */
	inPostHog: FlagKey[];
}

export interface FlagEvaluatorDeps {
	config: PostHogConfig | null;
	fetcher: typeof fetch;
	nowMs(): number;
	overrides: Partial<FlagValues>;
	timeoutMs?: number;
}

/** "billing=on,catalog-paused=on"; unknown keys and values are ignored. */
export function parseFlagOverrides(text: string | undefined): Partial<FlagValues> {
	const overrides: Partial<FlagValues> = {};
	for (const pair of (text ?? '').split(',')) {
		const [key, value] = pair.split('=').map((part) => part.trim());
		if (key && isFlagKey(key) && (value === 'on' || value === 'off')) overrides[key] = value === 'on';
	}
	return overrides;
}

export function flagOverridesOf(env: { ENVIRONMENT?: string; FEATURE_FLAG_OVERRIDES?: string }): Partial<FlagValues> {
	return env.ENVIRONMENT === 'prod' ? {} : parseFlagOverrides(env.FEATURE_FLAG_OVERRIDES);
}

/**
 * The registry flags in a /flags?v=2 answer. Null, a failure, when it isn't one, when PostHog paused flags for quota,
 * or when it reports errors while computing them: those values can't be trusted.
 */
export function readFlagsAnswer(body: unknown): Partial<FlagValues> | null {
	if (typeof body !== 'object' || body === null) return null;
	const answer = body as { flags?: unknown; quotaLimited?: unknown; errorsWhileComputingFlags?: unknown };
	if (Array.isArray(answer.quotaLimited) && answer.quotaLimited.includes('feature_flags')) return null;
	if (answer.errorsWhileComputingFlags === true) return null;
	if (typeof answer.flags !== 'object' || answer.flags === null) return null;
	const flags = answer.flags as Record<string, unknown>;
	const values: Partial<FlagValues> = {};
	for (const key of FLAG_KEYS) {
		const enabled = (flags[key] as { enabled?: unknown } | undefined)?.enabled;
		if (typeof enabled === 'boolean') values[key] = enabled;
	}
	return values;
}

export class FlagEvaluator {
	private readonly cache = new Map<string, { evaluation: FlagEvaluation; expiresAtMs: number }>();

	constructor(private readonly deps: FlagEvaluatorDeps) {}

	async evaluate(subject: FlagSubject): Promise<FlagEvaluation> {
		const config = this.deps.config;
		if (!config) return this.withOverrides({ values: defaultFlagValues(), source: 'off', inPostHog: [] });
		const cached = this.cache.get(subject.distinctId);
		if (cached && cached.expiresAtMs > this.deps.nowMs()) return this.withOverrides(cached.evaluation);
		const answered = await this.ask(config, subject);
		const evaluation: FlagEvaluation = answered
			? { values: { ...defaultFlagValues(), ...answered }, source: 'posthog', inPostHog: FLAG_KEYS.filter((flag) => flag in answered) }
			: { values: defaultFlagValues(), source: 'defaults', inPostHog: [] };
		this.remember(subject.distinctId, evaluation, answered ? FLAG_CACHE_MS : FLAG_FAILURE_CACHE_MS);
		return this.withOverrides(evaluation);
	}

	private async ask(config: PostHogConfig, subject: FlagSubject): Promise<Partial<FlagValues> | null> {
		try {
			const response = await this.deps.fetcher(FLAGS_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ api_key: config.projectKey, distinct_id: subject.distinctId, person_properties: { plan: await subject.plan() } }),
				signal: AbortSignal.timeout(this.deps.timeoutMs ?? FLAG_TIMEOUT_MS),
			});
			return response.ok ? readFlagsAnswer(await response.json()) : null;
		} catch {
			return null;
		}
	}

	private remember(key: string, evaluation: FlagEvaluation, forMs: number): void {
		this.cache.delete(key);
		if (this.cache.size >= MAX_CACHED_SUBJECTS) {
			const oldest = this.cache.keys().next();
			if (!oldest.done) this.cache.delete(oldest.value);
		}
		this.cache.set(key, { evaluation, expiresAtMs: this.deps.nowMs() + forMs });
	}

	private withOverrides(evaluation: FlagEvaluation): FlagEvaluation {
		if (Object.keys(this.deps.overrides).length === 0) return evaluation;
		return { ...evaluation, values: { ...evaluation.values, ...this.deps.overrides } };
	}
}

let isolate: { projectKey: string | null; overrides: string; evaluator: FlagEvaluator } | null = null;

/** One evaluator per isolate, so its cache serves every request; rebuilt when the key or overrides change. */
function evaluatorFor(env: Env): FlagEvaluator {
	const config = posthogConfig(env);
	const projectKey = config?.projectKey ?? null;
	const overrides = env.ENVIRONMENT === 'prod' ? '' : (env.FEATURE_FLAG_OVERRIDES ?? '');
	if (!isolate || isolate.projectKey !== projectKey || isolate.overrides !== overrides) {
		isolate = {
			projectKey,
			overrides,
			evaluator: new FlagEvaluator({ config, fetcher: (input, init) => fetch(input, init), nowMs: Date.now, overrides: flagOverridesOf(env) }),
		};
	}
	return isolate.evaluator;
}

export async function flagsFor(env: Env, userId: string | null): Promise<FlagEvaluation> {
	let evaluation: FlagEvaluation;
	try {
		evaluation = await evaluatorFor(env).evaluate({ distinctId: userId ?? ANONYMOUS_FLAG_SUBJECT, plan: async () => (await accountPlanOf(env, userId)).plan });
	} catch {
		evaluation = { values: { ...defaultFlagValues(), ...flagOverridesOf(env) }, source: 'defaults', inPostHog: [] };
	}
	// Billing shipped first behind BILLING and BILLING_USER_IDS. PostHog can add accounts, never take a paying seller out.
	if (!evaluation.values.billing && isBillingOn(env, userId)) return { ...evaluation, values: { ...evaluation.values, billing: true } };
	return evaluation;
}

export async function isFlagOn(env: Env, key: FlagKey, userId: string | null): Promise<boolean> {
	return (await flagsFor(env, userId)).values[key];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/flags.test.ts worker/services/posthog/account-plan.sql.test.ts worker/services/billing`
Expected: PASS, billing's own tests included.

- [ ] **Step 6: Commit**

```bash
git add worker/services/posthog/flags.ts worker/services/posthog/flags.test.ts worker/services/posthog/person.ts worker/services/posthog/account-plan.sql.test.ts
git commit -m "feat(flags): evaluate the flag registry in posthog, every flag off when it can't answer, billing's switches kept

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Session telemetry and the config endpoint

**Files:**
- Create `worker/services/posthog/session.ts`. Test: `worker/services/posthog/session.sql.test.ts`.
- Create `worker/api/controllers/telemetry/controller.ts`. Test: `worker/api/controllers/telemetry/controller.test.ts`.
- Create `worker/api/routes/telemetryRoutes.ts`. Modify `worker/api/routes/index.ts` to register it.
- Modify `worker/api/controllers/auth/controller.ts`: `register`, `login`, `getProfile` and `handleOAuthCallback`.
- Modify `worker/types/auth-types.ts` (`SessionResponse`) and `src/api-types.ts` (`ProfileResponseData`).
- Test: `worker/api/controllers/auth/telemetry-wiring.test.ts`.

**Interfaces:**
- **Consumes:** `flagsFor` from Task 5; `AnalyticsPersonService` and the config helpers from Task 2; `clientFlagValues` and the telemetry types from Task 1.
- **Produces:**
  - `gpcSignal(request: Request): boolean`;
  - `honorAnalyticsChoice(env: Env, request: Request, userId: string): Promise<boolean>`, which answers whether analytics is off and stores a GPC signal;
  - `sessionTelemetry(env: Env, request: Request, userId: string): Promise<SessionTelemetry>`;
  - `TelemetryController.config` at `GET /api/telemetry/config` (public);
  - `SessionResponse.telemetry?` and `ProfileResponseData.telemetry`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/session.sql.test.ts`:

```ts
/** Session telemetry on real SQL: client flags, and the analytics setting with GPC honored. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { honorAnalyticsChoice, sessionTelemetry } from './session';

let db: D1Database;
const get = (headers: Record<string, string> = {}) => new Request('https://estori.app/api/auth/profile', { headers });

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'tel_1');
});

describe('session telemetry', () => {
	it('carries the client flags, and analytics on, for a new user', async () => {
		expect(await sessionTelemetry(envWith(db, { ENVIRONMENT: 'dev' }), get(), 'tel_1')).toEqual({
			flags: { billing: false, 'store-drafts-paused': false, 'catalog-paused': false, 'session-replay-paused': false },
			analyticsOptOut: false,
		});
	});

	it('stores a GPC signal as the opt-out, before anything is sent', async () => {
		const env = envWith(db, { ENVIRONMENT: 'dev' });
		expect((await sessionTelemetry(env, get({ 'Sec-GPC': '1' }), 'tel_1')).analyticsOptOut).toBe(true);
		expect(await new AnalyticsPersonService(env).preference('tel_1')).toEqual({ optedOut: true, source: 'gpc' });
	});

	it('keeps a choice made in settings', async () => {
		const env = envWith(db, { ENVIRONMENT: 'dev' });
		await new AnalyticsPersonService(env).setPreference('tel_1', true, 'settings', new Date());
		expect(await honorAnalyticsChoice(env, get(), 'tel_1')).toBe(true);
		expect(await new AnalyticsPersonService(env).preference('tel_1')).toEqual({ optedOut: true, source: 'settings' });
	});

	it('treats analytics as off when the setting cannot be read', async () => {
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database, { ENVIRONMENT: 'dev' });
		expect(await honorAnalyticsChoice(broken, get(), 'tel_1')).toBe(true);
	});

	it('honors local flag overrides', async () => {
		const telemetry = await sessionTelemetry(envWith(db, { ENVIRONMENT: 'dev', FEATURE_FLAG_OVERRIDES: 'store-drafts-paused=on' }), get(), 'tel_1');
		expect(telemetry.flags['store-drafts-paused']).toBe(true);
	});
});
```

`worker/api/controllers/telemetry/controller.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelemetryController } from './controller';
import type { RouteContext } from '../../types/route-context';

const request = new Request('https://estori.app/api/telemetry/config');

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the telemetry config', () => {
	it('gives the browser nothing to load without a project key, with replay not paused', async () => {
		const response = await TelemetryController.config(request, { ENVIRONMENT: 'dev' } as unknown as Env, {} as ExecutionContext, {} as RouteContext);
		expect(await response.json()).toMatchObject({ success: true, data: { posthog: null, replayPaused: false } });
	});

	it("gives the browser the key, the proxy path, the UI host and the visitors' replay pause", async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Response.json({ flags: { 'session-replay-paused': { key: 'session-replay-paused', enabled: true } } })));
		const env = { POSTHOG_PROJECT_KEY: 'phc_config', ENVIRONMENT: 'staging' } as unknown as Env;
		const response = await TelemetryController.config(request, env, {} as ExecutionContext, {} as RouteContext);
		expect((await response.json()).data).toEqual({
			posthog: { projectKey: 'phc_config', apiHost: '/ingest', uiHost: 'https://us.posthog.com', environment: 'staging' },
			replayPaused: true,
		});
	});
});
```

`worker/api/controllers/auth/telemetry-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/controllers/auth/controller.ts'], { query: '?raw', import: 'default', eager: true });
const auth = sources['/worker/api/controllers/auth/controller.ts'] ?? '';

function method(signature: string): string {
	const start = auth.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = auth.indexOf('\n    static ', start + signature.length);
	return auth.slice(start, next === -1 ? undefined : next);
}

describe('the session carries telemetry', () => {
	it('on sign-up, sign-in and the profile', () => {
		for (const signature of ['static async register(', 'static async login(', 'static async getProfile(']) {
			expect(method(signature), signature).toContain('sessionTelemetry(env, request, ');
		}
	});

	it('stores a GPC signal on a provider sign-in', () => {
		expect(method('static async handleOAuthCallback(')).toContain('await honorAnalyticsChoice(env, request, result.user.id)');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/session.sql.test.ts worker/api/controllers/telemetry worker/api/controllers/auth/telemetry-wiring.test.ts`
Expected: FAIL. `./session` and `./controller` don't resolve, and the auth controller doesn't send telemetry.

- [ ] **Step 3: Write `worker/services/posthog/session.ts`**

```ts
/** What the signed-in session carries for analytics: the client flags, and the analytics setting with GPC honored. */

import { clientFlagValues } from '../../../shared/types/feature-flags';
import type { SessionTelemetry } from '../../../shared/types/telemetry';
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import { createLogger } from '../../logger';
import { flagsFor } from './flags';

const logger = createLogger('SessionTelemetry');

/** The browser's Global Privacy Control signal. */
export function gpcSignal(request: Request): boolean {
	return request.headers.get('Sec-GPC') === '1';
}

/**
 * Whether analytics is off for this user. A GPC signal is stored as the account's opt-out first, so the server's own
 * events stop too. When the setting can't be read it answers true: privacy wins.
 */
export async function honorAnalyticsChoice(env: Env, request: Request, userId: string): Promise<boolean> {
	try {
		const people = new AnalyticsPersonService(env);
		if ((await people.preference(userId)).optedOut) return true;
		if (!gpcSignal(request)) return false;
		await people.setPreference(userId, true, 'gpc', new Date());
		return true;
	} catch (error) {
		logger.warn('Could not read the analytics setting; treating analytics as off', { userId, error });
		return true;
	}
}

export async function sessionTelemetry(env: Env, request: Request, userId: string): Promise<SessionTelemetry> {
	const analyticsOptOut = await honorAnalyticsChoice(env, request, userId);
	const { values } = await flagsFor(env, userId);
	return { flags: clientFlagValues(values), analyticsOptOut };
}
```

- [ ] **Step 4: Write the controller and the route**

`worker/api/controllers/telemetry/controller.ts`:

```ts
/** Analytics for the browser: PostHog's config, the user's analytics setting, and the flags admin view. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import type { TelemetryConfigData } from '../../../../shared/types/telemetry';
import { browserConfig, posthogConfig } from '../../../services/posthog/config';
import { flagsFor } from '../../../services/posthog/flags';

export class TelemetryController extends BaseController {
	/** GET /api/telemetry/config: what the browser needs to load PostHog, and whether replay is paused for visitors who aren't signed in. */
	static async config(_request: Request, env: Env, _ctx: ExecutionContext, _context: RouteContext): Promise<ControllerResponse<ApiResponse<TelemetryConfigData>>> {
		const { values } = await flagsFor(env, null);
		return this.createSuccessResponse({ posthog: browserConfig(posthogConfig(env)), replayPaused: values['session-replay-paused'] });
	}
}
```

`worker/api/routes/telemetryRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { TelemetryController } from '../controllers/telemetry/controller';

/** PostHog's config for the browser, the user's analytics setting, and the flags admin view. */
export function setupTelemetryRoutes(app: Hono<AppEnv>): void {
    app.get('/api/telemetry/config', setAuthLevel(AuthConfig.public), adaptController(TelemetryController, TelemetryController.config));
}
```

In `worker/api/routes/index.ts`:
1. Import `setupTelemetryRoutes`.
2. Call it right after `setupCapabilitiesRoutes(app);`, with the comment `// PostHog config, the analytics setting and the flags admin view`.

- [ ] **Step 5: Send telemetry with the session**

`worker/types/auth-types.ts`:
1. Import `type { SessionTelemetry }` from `'../../shared/types/telemetry'`.
2. Add to `SessionResponse`:

```ts
	/** Client flags and the analytics setting; sent with sign-in and sign-up answers. */
	telemetry?: SessionTelemetry;
```

`src/api-types.ts`: make `ProfileResponseData`:

```ts
export type ProfileResponseData = {
  user: AuthUser;
  sessionId: string;
  telemetry: SessionTelemetry;
};
```

`worker/api/controllers/auth/controller.ts`: import `honorAnalyticsChoice` and `sessionTelemetry` from `'../../../services/posthog/session'`. Then:

- **In `register` and `login`,** build the response with the telemetry:

```ts
            const telemetry = await sessionTelemetry(env, request, result.user.id);
            const response = AuthController.createSuccessResponse({
                ...formatAuthResponse(result.user, result.sessionId, result.expiresAt),
                telemetry,
            });
```

- **`getProfile`** takes `request` and `env`, no longer `_request` and `_env`, and answers:

```ts
            return AuthController.createSuccessResponse({
                user: mapUserResponse(routeContext.user),
                sessionId: routeContext.sessionId,
                telemetry: await sessionTelemetry(env, request, routeContext.user.id),
            });
```

- **In `handleOAuthCallback`,** right after `const result = await authService.handleOAuthCallback(...)`:

```ts
            // A GPC signal on this navigation becomes the account's opt-out before anything is sent.
            await honorAnalyticsChoice(env, request, result.user.id);
```

**If an existing test fake answers without `user`:** check `worker/api/controllers/auth/controller.test.ts`. If its `mockHandleOAuthCallback` values have no `user`, give them `user: { id: 'user-1', email: 'user@example.com' }`. `honorAnalyticsChoice` never throws, even without a database.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/session.sql.test.ts worker/api/controllers/telemetry worker/api/controllers/auth`
Expected: PASS, including the existing auth controller tests.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/services/posthog/session.ts worker/services/posthog/session.sql.test.ts worker/api/controllers/telemetry worker/api/routes/telemetryRoutes.ts worker/api/routes/index.ts worker/api/controllers/auth/controller.ts worker/api/controllers/auth/telemetry-wiring.test.ts worker/api/controllers/auth/controller.test.ts worker/types/auth-types.ts src/api-types.ts
git commit -m "feat(analytics): the session carries client flags and the analytics setting, and gpc becomes the account's opt-out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: PostHog in the browser

**Files:**
- Add the dependency: `bun add posthog-js`.
- Create:
  - `src/lib/analytics/posthog-options.ts` (test `src/lib/analytics/posthog-options.test.ts`);
  - `src/lib/analytics/posthog-browser.ts`;
  - `src/components/analytics/PostHogSync.tsx`;
  - `src/hooks/use-flag.ts`;
  - `src/hooks/use-telemetry.ts`;
  - the guard test `src/components/analytics/analytics-guard.test.ts`.
- Modify:
  - `src/contexts/auth-context.tsx`;
  - `src/App.tsx`;
  - `src/lib/api-client.ts` and `src/lib/query-keys.ts`;
  - `src/components/ErrorBoundary.tsx`.

**Interfaces:**
- **Consumes:**
  - `TelemetryConfigData`, `SessionTelemetry` and `ClientFlagKey` from `@/api-types`;
  - `GET /api/telemetry/config` and `ProfileResponseData.telemetry` from Task 6.
- **Produces:**
  - `REPLAY_PAUSED_PATHS = ['/orders', '/emails', '/profile', '/settings', '/admin']`, which covers `/settings/billing` and the payments setup page (`/profile?tab=paid`);
  - `replayPausedOn(pathname): boolean`;
  - `withoutQuery(url): string`, `stripUrlQueries(event: CaptureResult | null): CaptureResult | null`;
  - `AnalyticsState { gpc; optedOut; replay }`;
  - `posthogInitOptions(config, state): Partial<PostHogConfig>`;
  - `globalPrivacyControl(nav): boolean`;
  - `captureBrowserException(error: unknown): void` and `applyAnalyticsChoice(optedOut: boolean): void`;
  - `useFlag(key: ClientFlagKey): boolean`, off unless the session says on;
  - `useTelemetryConfig()`;
  - `useAuth().telemetry: SessionTelemetry | null`;
  - `queryKeys.platform.telemetry()`, `apiClient.getTelemetryConfig()`.

- [ ] **Step 1: Write the failing tests**

`src/lib/analytics/posthog-options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CaptureResult } from 'posthog-js';
import { globalPrivacyControl, posthogInitOptions, replayPausedOn, stripUrlQueries, withoutQuery } from './posthog-options';

const CONFIG = { projectKey: 'phc_test', apiHost: '/ingest', uiHost: 'https://us.posthog.com', environment: 'prod' };

describe('posthog-js options', () => {
	it('talks to /ingest, records layouts and clicks but no page text, no input values and no iframe, and asks PostHog for no flags', () => {
		expect(posthogInitOptions(CONFIG, { gpc: false, optedOut: false, replay: true })).toEqual({
			api_host: '/ingest',
			ui_host: 'https://us.posthog.com',
			person_profiles: 'identified_only',
			capture_pageview: 'history_change',
			capture_pageleave: 'if_capture_pageview',
			autocapture: true,
			mask_all_text: true,
			mask_all_element_attributes: true,
			capture_exceptions: true,
			advanced_disable_feature_flags: true,
			disable_surveys: true,
			disable_session_recording: false,
			session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'iframe' },
			before_send: stripUrlQueries,
			opt_out_capturing_by_default: false,
		});
	});

	it('starts opted out under GPC or the account setting, and without replay when it is paused', () => {
		expect(posthogInitOptions(CONFIG, { gpc: true, optedOut: false, replay: true }).opt_out_capturing_by_default).toBe(true);
		expect(posthogInitOptions(CONFIG, { gpc: false, optedOut: true, replay: true }).opt_out_capturing_by_default).toBe(true);
		expect(posthogInitOptions(CONFIG, { gpc: false, optedOut: false, replay: false }).disable_session_recording).toBe(true);
	});

	it('pauses replay on orders, emails, profile and payments setup, settings and billing, and admin pages only', () => {
		for (const path of ['/orders', '/orders/ord_1', '/emails', '/profile', '/settings', '/settings/billing', '/admin/reviews', '/admin/flags']) {
			expect(replayPausedOn(path), path).toBe(true);
		}
		for (const path of ['/', '/chat/abc', '/settingsx', '/discover', '/pricing', '/catalog', '/apps']) expect(replayPausedOn(path), path).toBe(false);
	});

	it('drops the query and fragment of every captured address, replay data included, and keeps the path', () => {
		const event = {
			uuid: 'u1',
			event: '$pageview',
			properties: {
				$current_url: 'https://estori.app/reset-password?token=secret#top',
				$pathname: '/reset-password',
				$referrer: 'https://estori.app/verify-email?token=other',
				$snapshot_data: [
					{ type: 4, data: { href: 'https://estori.app/chat/new?query=Build%20a%20tea%20store', width: 1280, height: 800 } },
					{ type: 3, data: { source: 2 } },
				],
			},
			$set: { $current_url: 'https://estori.app/settings?tab=keys' },
			$set_once: { $initial_current_url: 'https://estori.app/?ref=launch' },
		} as unknown as CaptureResult;
		const sent = stripUrlQueries(event);
		expect(sent?.properties).toMatchObject({ $current_url: 'https://estori.app/reset-password', $pathname: '/reset-password', $referrer: 'https://estori.app/verify-email' });
		expect(sent?.properties.$snapshot_data[0].data.href).toBe('https://estori.app/chat/new');
		expect(sent?.$set).toEqual({ $current_url: 'https://estori.app/settings' });
		expect(sent?.$set_once).toEqual({ $initial_current_url: 'https://estori.app/' });
		expect(stripUrlQueries(null)).toBeNull();
		expect(withoutQuery('https://estori.app/discover')).toBe('https://estori.app/discover');
	});

	it('reads GPC only when the browser says true', () => {
		expect(globalPrivacyControl({ globalPrivacyControl: true } as Navigator & { globalPrivacyControl?: boolean })).toBe(true);
		expect(globalPrivacyControl({} as Navigator)).toBe(false);
	});
});
```

`src/components/analytics/analytics-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/analytics/PostHogSync.tsx', '/src/App.tsx', '/src/components/ErrorBoundary.tsx', '/src/contexts/auth-context.tsx', '/src/hooks/use-flag.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('PostHog in the browser', () => {
	const sync = source('/src/components/analytics/PostHogSync.tsx');

	it('identifies people by user id only, never by email, name or username', () => {
		expect(sync).toContain('posthog.identify(userId)');
		expect(sync).not.toMatch(/email|displayName|username/);
	});

	it('starts a new anonymous person on sign-out, and before another account is identified', () => {
		const reset = sync.indexOf('posthog.reset()');
		expect(reset).toBeGreaterThan(-1);
		expect(reset).toBeLessThan(sync.indexOf('posthog.identify(userId)'));
	});

	it('pauses replay on the paused paths and when the pause flag is on, and resumes it under the sampling rules', () => {
		expect(sync).toContain("telemetry?.flags['session-replay-paused']");
		expect(sync).toContain('config.data?.replayPaused');
		expect(sync).toContain('replayPausedOn(pathname)');
		expect(sync).toContain('posthog.stopSessionRecording()');
		expect(sync).toContain('posthog.startSessionRecording()');
	});

	it('is mounted once, inside the auth provider', () => {
		const app = source('/src/App.tsx');
		const mounted = app.indexOf('<PostHogSync />');
		expect(mounted).toBeGreaterThan(app.indexOf('<AuthProvider>'));
		expect(mounted).toBeLessThan(app.indexOf('</AuthProvider>'));
	});

	it('reports what the error boundary catches', () => {
		expect(source('/src/components/ErrorBoundary.tsx')).toContain('captureBrowserException(');
	});

	it('keeps the session telemetry from the profile and sign-in answers, and reads a flag as off without it', () => {
		const auth = source('/src/contexts/auth-context.tsx');
		expect(auth.match(/telemetry: data\.telemetry \?\? null/g)?.length).toBe(2);
		expect(source('/src/hooks/use-flag.ts')).toContain('return telemetry?.flags[key] ?? false;');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- src/lib/analytics src/components/analytics`
Expected: FAIL. `./posthog-options` doesn't resolve, and the sources don't exist.

- [ ] **Step 3: Add posthog-js.** Run `bun add posthog-js`, then `bun run typecheck`. The next steps use `capture_pageview: 'history_change'`, `capture_exceptions` and `before_send`. If the type check rejects any of them, the installed version is too old: install the latest.

posthog-js from npm lazy-loads `recorder.js` and its exception-capture script from `<api_host>/static`, that is `/ingest/static`, through Task 3's proxy. So the app's CSP needs no PostHog host.

- [ ] **Step 4: Write `src/lib/analytics/posthog-options.ts`**

```ts
import type { CaptureResult, PostHogConfig } from 'posthog-js';
import type { PostHogBrowserConfig } from '@/api-types';

/**
 * Recording stops on these paths and below them: orders, shopper emails, the profile with its payments setup
 * (`/profile?tab=paid`), settings with billing (`/settings/billing`), and admin pages.
 */
export const REPLAY_PAUSED_PATHS = ['/orders', '/emails', '/profile', '/settings', '/admin'] as const;

/** Address properties that lose their query; `$pathname` is kept as it is. */
const URL_PROPERTIES = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer', '$session_entry_url', '$session_entry_referrer'] as const;
/** rrweb's meta event, which records the page's address. */
const RRWEB_META = 4;

export function replayPausedOn(pathname: string): boolean {
	return REPLAY_PAUSED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** An address without its query and fragment, where reset and confirmation tokens, and prompts, travel. */
export function withoutQuery(url: string): string {
	const cut = url.search(/[?#]/);
	return cut === -1 ? url : url.slice(0, cut);
}

function stripAddresses(record: Record<string, unknown> | undefined): void {
	if (!record) return;
	for (const key of URL_PROPERTIES) {
		const value = record[key];
		if (typeof value === 'string') record[key] = withoutQuery(value);
	}
}

function isMetaEvent(value: unknown): value is { type: number; data: { href: string } } {
	if (typeof value !== 'object' || value === null) return false;
	const event = value as { type?: unknown; data?: { href?: unknown } };
	return event.type === RRWEB_META && typeof event.data?.href === 'string';
}

/** posthog-js `before_send`: every captured address leaves the browser without its query, replay data included. */
export function stripUrlQueries(event: CaptureResult | null): CaptureResult | null {
	if (!event) return null;
	stripAddresses(event.properties);
	stripAddresses(event.$set);
	stripAddresses(event.$set_once);
	const snapshots: unknown = event.properties?.$snapshot_data;
	if (Array.isArray(snapshots)) {
		for (const item of snapshots) if (isMetaEvent(item)) item.data.href = withoutQuery(item.data.href);
	}
	return event;
}

export interface AnalyticsState {
	/** The browser's Global Privacy Control signal. */
	gpc: boolean;
	/** The signed-in user's analytics setting. */
	optedOut: boolean;
	/** Whether this page may record: replay isn't paused by its flag, and the path isn't a paused one. */
	replay: boolean;
}

export function posthogInitOptions(config: PostHogBrowserConfig, state: AnalyticsState): Partial<PostHogConfig> {
	return {
		api_host: config.apiHost,
		ui_host: config.uiHost,
		person_profiles: 'identified_only',
		capture_pageview: 'history_change',
		capture_pageleave: 'if_capture_pageview',
		autocapture: true,
		// Clicks are recorded by where they land, never by what the element says or links to.
		mask_all_text: true,
		mask_all_element_attributes: true,
		capture_exceptions: true,
		advanced_disable_feature_flags: true,
		disable_surveys: true,
		disable_session_recording: !state.replay,
		// Layouts and clicks, not what's written: all text and inputs masked. Every iframe is blocked, since the
		// editor's preview carries a signed preview token in its address.
		session_recording: { maskAllInputs: true, maskTextSelector: '*', blockSelector: 'iframe' },
		before_send: stripUrlQueries,
		opt_out_capturing_by_default: state.gpc || state.optedOut,
	};
}

/** `navigator.globalPrivacyControl`, which only some browsers have. */
export function globalPrivacyControl(nav: Navigator & { globalPrivacyControl?: boolean }): boolean {
	return nav.globalPrivacyControl === true;
}
```

If the type check says `session_recording` has no `blockSelector` in the installed version, use its `blockClass` instead. Then give both preview iframes in `src/routes/chat/components/preview-iframe.tsx` that class. Do the same for the iframes in `src/components/site-page/DevicePreview.tsx` and `src/routes/emails/template-editor.tsx`, and change the test to match.

- [ ] **Step 5: Write `src/lib/analytics/posthog-browser.ts`**

```ts
import posthog from 'posthog-js';

/** Errors React caught before they reached the window; uncaught ones posthog-js captures itself. */
export function captureBrowserException(error: unknown): void {
	if (!posthog.__loaded) return;
	posthog.captureException(error instanceof Error ? error : new Error(String(error)));
}

/** The analytics setting, applied in this browser right away. */
export function applyAnalyticsChoice(optedOut: boolean): void {
	if (!posthog.__loaded) return;
	if (optedOut) posthog.opt_out_capturing();
	else posthog.opt_in_capturing();
}
```

- [ ] **Step 6: Carry the telemetry in the session** (`src/contexts/auth-context.tsx`)
1. Import `SessionTelemetry` from `'../api-types'`.
2. Add `telemetry: SessionTelemetry | null;` to `CachedAuthSession` and to `AuthContextType`. Document it on `AuthContextType` as "Client flags and the analytics setting; null when signed out".
3. In `buildSessionFromProfile` and in `buildSessionFromLogin`, add `telemetry: data.telemetry ?? null,`.
4. In the provider, add `const telemetry = cachedSession?.telemetry ?? null;`. Put `telemetry` in the context value and in its `useMemo` dependencies.

- [ ] **Step 7: Write the hooks and the API call**
- **`src/lib/query-keys.ts`:** add `telemetry: () => [...queryKeys.platform.all, 'telemetry'] as const,` under `platform`.
- **`src/lib/api-client.ts`:** add, near `getCapabilities`:

```ts
	/** PostHog's config for this deployment; quiet, since the app works without it. */
	async getTelemetryConfig(): Promise<ApiResponse<TelemetryConfigData>> {
		return this.request<TelemetryConfigData>('/api/telemetry/config', undefined, true);
	}
```

**`src/hooks/use-telemetry.ts`:**

```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

/** PostHog's config for this deployment; the same for every viewer. */
export function useTelemetryConfig() {
	return useQuery({
		queryKey: queryKeys.platform.telemetry(),
		queryFn: () => unwrap(apiClient.getTelemetryConfig(), "Couldn't load the analytics config"),
		staleTime: 10 * 60_000,
		retry: false,
	});
}
```

`src/hooks/use-flag.ts`:

```ts
import type { ClientFlagKey } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';

/** A client-visible flag for the signed-in user, sent with the session; off when signed out, like every flag's default. */
export function useFlag(key: ClientFlagKey): boolean {
	const { telemetry } = useAuth();
	return telemetry?.flags[key] ?? false;
}
```

- [ ] **Step 8: Write `src/components/analytics/PostHogSync.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import posthog from 'posthog-js';
import { useAuth } from '@/contexts/auth-context';
import { useTelemetryConfig } from '@/hooks/use-telemetry';
import { globalPrivacyControl, posthogInitOptions, replayPausedOn } from '@/lib/analytics/posthog-options';

/** Loads PostHog once the config and the session are known, then keeps its identity, consent and replay in step. */
export function PostHogSync() {
	const config = useTelemetryConfig();
	const { user, telemetry, isLoading } = useAuth();
	const { pathname } = useLocation();
	const loaded = useRef(false);
	const identifiedAs = useRef<string | null>(null);
	const posthogConfig = config.data?.posthog ?? null;
	const gpc = globalPrivacyControl(navigator);
	const optedOut = gpc || (telemetry?.analyticsOptOut ?? false);
	const replayPaused = user ? (telemetry?.flags['session-replay-paused'] ?? false) : (config.data?.replayPaused ?? false);
	const replay = !replayPaused;
	const userId = user?.id ?? null;

	useEffect(() => {
		if (loaded.current || !posthogConfig || isLoading) return;
		posthog.init(posthogConfig.projectKey, posthogInitOptions(posthogConfig, { gpc, optedOut, replay: replay && !replayPausedOn(window.location.pathname) }));
		loaded.current = true;
	}, [posthogConfig, isLoading, gpc, optedOut, replay]);

	useEffect(() => {
		if (!loaded.current || userId === identifiedAs.current) return;
		// Signing out, or another account signing in on this browser, starts a new anonymous person first.
		if (identifiedAs.current !== null) posthog.reset();
		if (userId) posthog.identify(userId);
		identifiedAs.current = userId;
	}, [userId, posthogConfig, isLoading]);

	useEffect(() => {
		if (!loaded.current) return;
		if (optedOut) posthog.opt_out_capturing();
		else if (posthog.has_opted_out_capturing()) posthog.opt_in_capturing();
	}, [optedOut, posthogConfig, isLoading]);

	useEffect(() => {
		if (!loaded.current || optedOut) return;
		if (!replay || replayPausedOn(pathname)) posthog.stopSessionRecording();
		// Without arguments, starting again obeys the project's sampling and triggers.
		else if (!posthog.sessionRecordingStarted()) posthog.startSessionRecording();
	}, [pathname, replay, optedOut, posthogConfig, isLoading]);

	return null;
}
```

- [ ] **Step 9: Mount it and report boundary errors**
- **`src/App.tsx`:** render `<PostHogSync />` right after `<AppsQuerySync />`, inside `<AuthProvider>`.
- **`src/components/ErrorBoundary.tsx`:**
  1. Import `captureBrowserException` from `@/lib/analytics/posthog-browser`.
  2. Pass `onError={(error) => captureBrowserException(error)}` to `<Sentry.ErrorBoundary>`.
  3. Task 19 replaces the Sentry boundary.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/lib/analytics src/components/analytics src/lib/query-keys.test.ts`
Expected: PASS.

Run: `bun run typecheck && npx eslint src/components/analytics src/lib/analytics src/hooks/use-flag.ts src/hooks/use-telemetry.ts src/contexts/auth-context.tsx`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add package.json bun.lock src/lib/analytics src/components/analytics src/hooks/use-flag.ts src/hooks/use-telemetry.ts src/contexts/auth-context.tsx src/App.tsx src/lib/api-client.ts src/lib/query-keys.ts src/components/ErrorBoundary.tsx
git commit -m "feat(analytics): posthog-js on estori.app with pageviews, text-free replay, query-free urls and flags from the session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The analytics setting

**Files:**
- Modify `worker/api/controllers/telemetry/controller.ts`: `getAnalyticsPreference` and `setAnalyticsPreference`.
- Modify `worker/api/routes/telemetryRoutes.ts`: `GET` and `PUT /api/user/analytics`, authenticated.
- Test: `worker/api/controllers/telemetry/preference.sql.test.ts`.
- Create `src/components/analytics/AnalyticsPreferenceCard.tsx`.
- Modify `src/routes/settings/index.tsx`, `src/hooks/use-telemetry.ts`, `src/lib/api-client.ts` and `src/lib/query-keys.ts`.
- Test: `src/components/analytics/analytics-setting-guard.test.ts`.

**Interfaces:**
- **Consumes:**
  - `AnalyticsPersonService`, from Task 2;
  - `honorAnalyticsChoice` and `gpcSignal`, from Task 6;
  - `applyAnalyticsChoice`, from Task 7;
  - `AnalyticsPreferenceData` and `GPC_ANALYTICS_MESSAGE`, from Task 1.
- **Produces:**
  - `TelemetryController.getAnalyticsPreference` and `setAnalyticsPreference`;
  - `apiClient.getAnalyticsPreference()` and `apiClient.setAnalyticsPreference(optedOut)`;
  - `useAnalyticsPreference()` and `useSetAnalyticsPreference()`;
  - `queryKeys.account.analytics(userId)`;
  - `AnalyticsPreferenceCard`.

- [ ] **Step 1: Write the failing tests**

`worker/api/controllers/telemetry/preference.sql.test.ts`:

```ts
/** The analytics setting's API on real SQL; each test's writes are rolled back after it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../../../database/test-support/real-d1';
import { TelemetryController } from './controller';
import type { RouteContext } from '../../types/route-context';
import { GPC_ANALYTICS_MESSAGE } from '../../../../shared/types/telemetry';

let db: D1Database;
const context = { user: { id: 'pref_1', email: 'pref_1@example.test' } } as unknown as RouteContext;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'pref_1');
});

function read(headers: Record<string, string> = {}) {
	return TelemetryController.getAnalyticsPreference(new Request('https://estori.app/api/user/analytics', { headers }), envWith(db), {} as ExecutionContext, context);
}

function write(body: unknown, headers: Record<string, string> = {}) {
	const request = new Request('https://estori.app/api/user/analytics', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
	return TelemetryController.setAnalyticsPreference(request, envWith(db), {} as ExecutionContext, context);
}

describe('the analytics setting API', () => {
	it('starts on', async () => {
		expect((await (await read()).json()).data).toEqual({ optedOut: false, source: null, gpc: false });
	});

	it('turns analytics off from settings, and on again', async () => {
		expect((await (await write({ optedOut: true })).json()).data).toEqual({ optedOut: true, source: 'settings', gpc: false });
		expect((await (await read()).json()).data).toEqual({ optedOut: true, source: 'settings', gpc: false });
		expect((await (await write({ optedOut: false })).json()).data).toEqual({ optedOut: false, source: null, gpc: false });
	});

	it('stores a GPC signal when read, and refuses to turn analytics on while it is sent', async () => {
		expect((await (await read({ 'Sec-GPC': '1' })).json()).data).toEqual({ optedOut: true, source: 'gpc', gpc: true });
		const refused = await write({ optedOut: false }, { 'Sec-GPC': '1' });
		expect(refused.status).toBe(409);
		expect((await refused.json()).error.message).toBe(GPC_ANALYTICS_MESSAGE);
	});

	it('refuses a body without a yes or no', async () => {
		expect((await write({ optedOut: 'yes' })).status).toBe(400);
		expect((await write({})).status).toBe(400);
	});
});
```

`src/components/analytics/analytics-setting-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/analytics/AnalyticsPreferenceCard.tsx', '/src/routes/settings/index.tsx', '/src/hooks/use-telemetry.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the analytics setting', () => {
	const card = source('/src/components/analytics/AnalyticsPreferenceCard.tsx');

	it('is a card in Settings', () => {
		expect(source('/src/routes/settings/index.tsx')).toContain('<AnalyticsPreferenceCard />');
	});

	it('says what is shared and that the email and name never are', () => {
		expect(card).toContain('Share usage analytics with');
		expect(card).toContain("recordings of some sessions that show layouts and clicks but not");
		expect(card).toContain('Your email and name are never shared.');
	});

	it("can't turn analytics on while the browser sends GPC, and says why", () => {
		expect(card).toContain('GPC_ANALYTICS_MESSAGE');
		expect(card).toContain('disabled={!data || data.gpc || update.isPending}');
	});

	it('applies the choice in this browser and refreshes the session', () => {
		const hooks = source('/src/hooks/use-telemetry.ts');
		expect(hooks).toContain('applyAnalyticsChoice(data.optedOut)');
		expect(hooks).toContain('await refreshUser()');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/api/controllers/telemetry/preference.sql.test.ts src/components/analytics/analytics-setting-guard.test.ts`
Expected: FAIL. The controller has no `getAnalyticsPreference`, and the card doesn't exist.

- [ ] **Step 3: Add the endpoints.** In `TelemetryController`:

```ts
	/** GET /api/user/analytics. Reading it with a GPC signal stores the opt-out. */
	static async getAnalyticsPreference(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AnalyticsPreferenceData>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<AnalyticsPreferenceData>('Unauthorized', 401);
		try {
			const optedOut = await honorAnalyticsChoice(env, request, user.id);
			const { source } = await new AnalyticsPersonService(env).preference(user.id);
			return this.createSuccessResponse({ optedOut, source: optedOut ? source : null, gpc: gpcSignal(request) });
		} catch (error) {
			return this.handleError(error, 'read the analytics setting') as ControllerResponse<ApiResponse<AnalyticsPreferenceData>>;
		}
	}

	/** PUT /api/user/analytics with `{ optedOut }`. Analytics can't be turned on while the browser sends GPC. */
	static async setAnalyticsPreference(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AnalyticsPreferenceData>>> {
		const user = context.user;
		if (!user) return this.createErrorResponse<AnalyticsPreferenceData>('Unauthorized', 401);
		const body = await this.parseJsonBody<{ optedOut?: unknown }>(request);
		const optedOut = body.success ? body.data?.optedOut : undefined;
		if (typeof optedOut !== 'boolean') return this.createErrorResponse<AnalyticsPreferenceData>('Say whether analytics is on or off.', 400);
		const gpc = gpcSignal(request);
		if (!optedOut && gpc) return this.createErrorResponse<AnalyticsPreferenceData>(GPC_ANALYTICS_MESSAGE, 409);
		try {
			await new AnalyticsPersonService(env).setPreference(user.id, optedOut, 'settings', new Date());
			return this.createSuccessResponse({ optedOut, source: optedOut ? 'settings' : null, gpc });
		} catch (error) {
			return this.handleError(error, 'save the analytics setting') as ControllerResponse<ApiResponse<AnalyticsPreferenceData>>;
		}
	}
```

The controller needs these imports: `AnalyticsPreferenceData` and `GPC_ANALYTICS_MESSAGE` from `shared/types/telemetry`, `AnalyticsPersonService`, and `gpcSignal` and `honorAnalyticsChoice` from `services/posthog/session`.

In `telemetryRoutes.ts`:

```ts
    app.get('/api/user/analytics', setAuthLevel(AuthConfig.authenticated), adaptController(TelemetryController, TelemetryController.getAnalyticsPreference));
    app.put('/api/user/analytics', setAuthLevel(AuthConfig.authenticated), adaptController(TelemetryController, TelemetryController.setAnalyticsPreference));
```

- [ ] **Step 4: The client side**

- **`src/lib/query-keys.ts`,** under `account`:

```ts
		/** The user's analytics setting: never persisted, like the rest of `account`. */
		analytics: (userId?: string | null) => [...queryKeys.account.all, 'analytics', userId ?? 'anonymous'] as const,
```

- **`src/lib/api-client.ts`:**

```ts
	async getAnalyticsPreference(): Promise<ApiResponse<AnalyticsPreferenceData>> {
		return this.request<AnalyticsPreferenceData>('/api/user/analytics');
	}

	/** Quiet: the settings card shows its own error. */
	async setAnalyticsPreference(optedOut: boolean): Promise<ApiResponse<AnalyticsPreferenceData>> {
		return this.request<AnalyticsPreferenceData>('/api/user/analytics', { method: 'PUT', body: { optedOut } }, true);
	}
```

- **`src/hooks/use-telemetry.ts`,** added:

```ts
export function useAnalyticsPreference() {
	const { user, isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.analytics(user?.id),
		queryFn: () => unwrap(apiClient.getAnalyticsPreference(), "Couldn't load your analytics setting"),
		enabled: isAuthenticated,
		retry: false,
	});
}

export function useSetAnalyticsPreference() {
	const queryClient = useQueryClient();
	const { user, refreshUser } = useAuth();
	return useMutation({
		mutationFn: (optedOut: boolean) => unwrap(apiClient.setAnalyticsPreference(optedOut), "Couldn't save your analytics setting"),
		onSuccess: async (data) => {
			queryClient.setQueryData(queryKeys.account.analytics(user?.id), data);
			applyAnalyticsChoice(data.optedOut);
			await refreshUser();
		},
		onError: (error: Error) => toast.error(error.message),
	});
}
```

The hooks need `useMutation`, `useQueryClient`, `toast` from `sonner`, `useAuth` and `applyAnalyticsChoice`.

**`src/components/analytics/AnalyticsPreferenceCard.tsx`:**

```tsx
import { LayerCard } from '@cloudflare/kumo';
import { ChartBar } from 'lucide-react';
import { GPC_ANALYTICS_MESSAGE } from '@/api-types';
import { BRAND } from '@/brand';
import { Switch } from '@/components/ui/switch';
import { useAnalyticsPreference, useSetAnalyticsPreference } from '@/hooks/use-telemetry';

export function AnalyticsPreferenceCard() {
	const preference = useAnalyticsPreference();
	const update = useSetAnalyticsPreference();
	const data = preference.data;
	return (
		<LayerCard id="analytics">
			<LayerCard.Secondary className="font-funky-mono tracking-tighter">
				<div className="flex items-center gap-2">
					<span className="flex items-center">
						<ChartBar className="size-4" />
					</span>
					<span>Analytics</span>
				</div>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="flex items-start justify-between gap-4">
					<div className="grid gap-1.5">
						<h4 className="text-sm font-medium text-kumo-default">Share usage analytics with {BRAND.name}</h4>
						<p className="text-sm text-kumo-subtle">
							{BRAND.name} uses the pages you visit, where you click, recordings of some sessions that show layouts and clicks but not
							what's written, and error reports to fix problems and improve the product. Your email and name are never shared.
						</p>
						{data?.gpc && <p className="text-sm text-kumo-subtle">{GPC_ANALYTICS_MESSAGE}</p>}
					</div>
					<Switch
						checked={data ? !data.optedOut : false}
						disabled={!data || data.gpc || update.isPending}
						onCheckedChange={(checked) => update.mutate(!checked)}
						aria-label={`Share usage analytics with ${BRAND.name}`}
					/>
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}
```

**`src/routes/settings/index.tsx`:** import the card, and render `<AnalyticsPreferenceCard />` right after the Account `LayerCard`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/api/controllers/telemetry src/components/analytics src/routes/account-honesty-guard.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/api/controllers/telemetry worker/api/routes/telemetryRoutes.ts src/components/analytics src/routes/settings/index.tsx src/hooks/use-telemetry.ts src/lib/api-client.ts src/lib/query-keys.ts
git commit -m "feat(analytics): an analytics switch in settings that stops browser and server events, kept off under gpc

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Flags at work

**Files:**
- **Server:**
  - `worker/api/handlers/store-platform.ts`: `live-store-payments-paused`;
  - `worker/services/store-payments/catalog-locks.ts` (new test `worker/services/store-payments/catalog-locks.test.ts`): `catalog-paused` at checkout;
  - `worker/agents/think/catalog-tools.ts` and `catalog-tools.test.ts`: `catalog-paused` in the AI's tools;
  - `worker/agents/think/draft-tools.ts` and `draft-tools.test.ts`: `store-drafts-paused` in `create_draft`;
  - `worker/agents/think/ThinkAgent.ts`: pass the checks in;
  - `worker/api/controllers/drafts/controller.ts` and `controller.test.ts`: `store-drafts-paused` on `POST`;
  - billing's flag checks, which move from `isBillingOn` to the `billing` flag: `worker/services/billing/account.ts` (`loadAccount`), `worker/services/billing/gates.ts` (`checkPromptPlan`), `worker/api/controllers/billing/controller.ts` (every `POST`) and `worker/api/controllers/limits/controller.ts` (`getPublicPlan`);
  - `shared/types/drafts.ts`: `STORE_DRAFTS_PAUSED_MESSAGE`;
  - `shared/types/catalog.ts`: `CATALOG_PAUSED_MESSAGE`.
- **Browser:**
  - `src/components/drafts/DraftSwitcher.tsx`;
  - `src/components/layout/app-sidebar.tsx`;
  - `src/routes/catalog/index.tsx`.
- **Tests:**
  - `worker/api/handlers/live-payments-flag.test.ts`;
  - `worker/services/billing/billing-flag-wiring.test.ts`;
  - `src/components/drafts/drafts-guard.test.ts`;
  - new `src/routes/catalog-flag-guard.test.ts`.

**Interfaces:**
- **Consumes:** `isFlagOn` from Task 5, whose `billing` keeps billing's env switches; `useFlag` from Task 7.
- **Produces:**
  - `STORE_DRAFTS_PAUSED_MESSAGE = 'Starting new drafts is paused right now.'`;
  - `CATALOG_PAUSED_MESSAGE = "Estori's catalog is paused right now, so catalog products can't be added to stores."`;
  - `lockCatalogPricesFor(env, catalogVariantIds, shipToCountry, sellerUserId)`;
  - `CatalogToolDeps.paused(): Promise<boolean>` and `catalogToolDepsFromEnv(env, userId)`;
  - `createDraftTools({ getStub, draftsPaused })`.

Every check reads "paused" as the flag being on. A pause flag PostHog leaves out, or PostHog being down, pauses nothing.

- [ ] **Step 1: Write the failing tests**

`worker/services/store-payments/catalog-locks.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isFlagOn, lockCatalogPrices } = vi.hoisted(() => ({ isFlagOn: vi.fn(), lockCatalogPrices: vi.fn() }));
vi.mock('../posthog/flags', () => ({ isFlagOn }));
vi.mock('../catalog/offers', () => ({ lockCatalogPrices }));

const { lockCatalogPricesFor } = await import('./catalog-locks');
const env = {} as Env;

describe('catalog prices at checkout', () => {
	beforeEach(() => {
		isFlagOn.mockReset();
		lockCatalogPrices.mockReset();
	});

	it("locks the catalog's prices while the catalog isn't paused, asking for the store's seller", async () => {
		isFlagOn.mockResolvedValue(false);
		lockCatalogPrices.mockResolvedValue([{ ok: true, catalogVariantId: 'cv_1', supplier: 'cjdropshipping', supplierVariantId: 'cj_1', lockedCatalogPriceCents: 1200 }]);
		expect(await lockCatalogPricesFor(env, ['cv_1'], 'US', 'seller_1')).toHaveLength(1);
		expect(isFlagOn).toHaveBeenCalledWith(env, 'catalog-paused', 'seller_1');
	});

	it('reads every catalog item as sold out while the catalog is paused, locking nothing', async () => {
		isFlagOn.mockResolvedValue(true);
		expect(await lockCatalogPricesFor(env, ['cv_1', 'cv_2'], 'US', 'seller_1')).toEqual([
			{ ok: false, catalogVariantId: 'cv_1', reason: 'unavailable' },
			{ ok: false, catalogVariantId: 'cv_2', reason: 'unavailable' },
		]);
		expect(lockCatalogPrices).not.toHaveBeenCalled();
	});
});
```

In `worker/agents/think/catalog-tools.test.ts`:
1. Give every existing fake `deps` a `paused: async () => false`.
2. Import `CATALOG_PAUSED_MESSAGE` from `shared/types/catalog`, and add:

```ts
	it('answers that the catalog is paused, searching nothing, while the pause flag is on', async () => {
		const search = vi.fn(async () => []);
		const tools = createCatalogTools({ search, get: async () => null, paused: async () => true });
		const answer = await tools.search_catalog.execute?.({ query: 'mug' }, { toolCallId: 't1', messages: [] });
		expect(String(answer)).toContain(CATALOG_PAUSED_MESSAGE);
		expect(search).not.toHaveBeenCalled();
	});
```

In `worker/agents/think/draft-tools.test.ts`:
1. Give every existing `createDraftTools({ getStub })` call `draftsPaused: async () => false`.
2. Import `STORE_DRAFTS_PAUSED_MESSAGE` from `shared/types/drafts`, and add:

```ts
	it('refuses to start a draft while starting drafts is paused, touching nothing', async () => {
		const createDraft = vi.fn();
		const tools = createDraftTools({ getStub: async () => ({ createDraft }) as never, draftsPaused: async () => true });
		const answer = await tools.create_draft.execute?.({ name: 'Typo fix', from: 'live' }, { toolCallId: 't1', messages: [] });
		expect(String(answer)).toContain(STORE_DRAFTS_PAUSED_MESSAGE);
		expect(createDraft).not.toHaveBeenCalled();
	});
```

If `GetStub` in `draft-tools.ts` isn't async, match the existing tests' fake.

In `worker/api/controllers/drafts/controller.test.ts`:
1. Mock `'../../../services/posthog/flags'` with `isFlagOn: vi.fn(async () => true)`, through `vi.hoisted`.
2. Add:

```ts
describe('starting a draft while drafts are paused', () => {
	it('is refused with 403 before the agent is asked', async () => {
		const { DraftsController } = await import('./controller');
		const env = { SPACE_DO: { idFromName: (name: string) => name, get: () => ({ listDrafts: async () => SNAPSHOT }) } } as unknown as Env;
		const request = new Request('https://estori.app/api/stores/app_1/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Sale' }) });
		const response = await DraftsController.create(request, env, {} as ExecutionContext, { pathParams: { id: 'app_1' }, user: { id: 'seller_1' } } as unknown as RouteContext);
		expect(response.status).toBe(403);
		expect((await response.json()).error.message).toBe(STORE_DRAFTS_PAUSED_MESSAGE);
		expect(isFlagOn).toHaveBeenCalledWith(env, 'store-drafts-paused', 'seller_1');
		expect(getAgentStub).not.toHaveBeenCalled();
	});
});
```

`getAgentStub` here is the mocked one from `vi.mock('../../../agents', ...)`. Import it from `'../../../agents'` after the mock.

`worker/api/handlers/live-payments-flag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/handlers/store-platform.ts'], { query: '?raw', import: 'default', eager: true });
const platform = sources['/worker/api/handlers/store-platform.ts'] ?? '';

describe('real payments on live stores', () => {
	it('need LIVE_STORE_PAYMENTS on and the pause flag off, checked for the seller', () => {
		expect(platform).toContain("env.LIVE_STORE_PAYMENTS === 'on' && !(await isFlagOn(env, 'live-store-payments-paused', sellerUserId))");
		expect(platform).toContain('livePayments: await livePaymentsOn(env, sellerIdOf(target))');
	});

	it("lock catalog prices for the store's seller", () => {
		expect(platform).toContain('lockCatalogPricesFor(env, ids, country, sellerIdOf(target))');
	});
});
```

`worker/services/billing/billing-flag-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

/** Billing's checks read the billing flag, which keeps BILLING and BILLING_USER_IDS and adds PostHog's targeting. */
const sources = import.meta.glob<string>(
	[
		'/worker/services/billing/account.ts',
		'/worker/services/billing/gates.ts',
		'/worker/api/controllers/billing/controller.ts',
		'/worker/api/controllers/limits/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

describe("billing's flag checks", () => {
	it("read the billing flag, never billing's env switches directly", () => {
		expect(Object.keys(sources)).toHaveLength(4);
		for (const [path, text] of Object.entries(sources)) {
			expect(text, path).not.toContain('isBillingOn(');
			expect(text, path).toContain("isFlagOn(env, 'billing', ");
		}
	});
});
```

In `src/components/drafts/drafts-guard.test.ts`, add:

```ts
	it('hides starting drafts while drafts are paused, and the switcher when Main is the only draft', () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		expect(switcher).toContain("const draftsPaused = useFlag('store-drafts-paused');");
		expect(switcher).toContain('if (draftsPaused && snapshot.drafts.length === 1) return null;');
		expect(switcher).toMatch(/\{!draftsPaused && \(\s*<>\s*<Button[^>]*onClick=\{\(\) => startNaming\(\)\}/);
	});
```

Add `'/src/components/drafts/DraftSwitcher.tsx'` to that file's glob if it isn't there.

`src/routes/catalog-flag-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/components/layout/app-sidebar.tsx', '/src/routes/catalog/index.tsx'], { query: '?raw', import: 'default', eager: true });

describe('the catalog pause in the app', () => {
	it('hides both catalog links in the sidebar while the catalog is paused', () => {
		const sidebar = sources['/src/components/layout/app-sidebar.tsx'] ?? '';
		expect(sidebar).toContain("const catalogPaused = useFlag('catalog-paused');");
		expect(sidebar.match(/\{user && !catalogPaused && \(/g)?.length).toBe(2);
	});

	it('shows the catalog page as paused', () => {
		const page = sources['/src/routes/catalog/index.tsx'] ?? '';
		expect(page).toContain("useFlag('catalog-paused')");
		expect(page).toContain('title="The catalog is paused"');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/store-payments/catalog-locks.test.ts worker/agents/think/catalog-tools.test.ts worker/agents/think/draft-tools.test.ts worker/services/billing/billing-flag-wiring.test.ts`
Expected: FAIL. The flag checks don't exist yet.

Run: `rtk proxy bun run test -- worker/api/controllers/drafts worker/api/handlers/live-payments-flag.test.ts src/components/drafts src/routes/catalog-flag-guard.test.ts`
Expected: FAIL, for the same reason.

- [ ] **Step 3: Add the messages.**
- In `shared/types/drafts.ts`: `export const STORE_DRAFTS_PAUSED_MESSAGE = 'Starting new drafts is paused right now.';`
- In `shared/types/catalog.ts`: `export const CATALOG_PAUSED_MESSAGE = "Estori's catalog is paused right now, so catalog products can't be added to stores.";`
- Re-export both from `src/api-types.ts` beside their files' other exports.

- [ ] **Step 4: Pause on the server**

**`worker/services/store-payments/catalog-locks.ts`:**

```ts
/** Catalog price locks for checkout, from the catalog's current offers; every item reads as sold out while the catalog is paused. */

import { lockCatalogPrices } from '../catalog/offers';
import { isFlagOn } from '../posthog/flags';
import type { CatalogLock } from './pricing';

export async function lockCatalogPricesFor(env: Env, catalogVariantIds: readonly string[], shipToCountry: string, sellerUserId: string): Promise<readonly CatalogLock[]> {
	if (await isFlagOn(env, 'catalog-paused', sellerUserId)) {
		return catalogVariantIds.map((catalogVariantId) => ({ ok: false, catalogVariantId, reason: 'unavailable' }));
	}
	return lockCatalogPrices(env, { catalogVariantIds, shipToCountry });
}
```

**`worker/api/handlers/store-platform.ts`:**
1. Import `isFlagOn`.
2. Make the live-payments check async:

```ts
/** Real payments need Estori's switch on and live store payments not paused. */
async function livePaymentsOn(env: Env, sellerUserId: string): Promise<boolean> {
	return env.LIVE_STORE_PAYMENTS === 'on' && !(await isFlagOn(env, 'live-store-payments-paused', sellerUserId));
}
```

3. In `checkoutModeFor`, pass `livePayments: await livePaymentsOn(env, sellerIdOf(target))`.
4. In `serveCheckout`, change the lock dependency to `lockCatalogPrices: (ids, country) => lockCatalogPricesFor(env, ids, country, sellerIdOf(target)),`.

**`worker/agents/think/catalog-tools.ts`:**
1. Add `paused(): Promise<boolean>` to `CatalogToolDeps`.
2. At the top of both tools' `execute`:

```ts
				if (await deps.paused()) return JSON.stringify({ paused: true, message: `${CATALOG_PAUSED_MESSAGE} Build the store with the seller's own products.` });
```

3. `catalogToolDepsFromEnv` takes `(env: Env, userId: string | null)` and adds `paused: () => isFlagOn(env, 'catalog-paused', userId)`.

**`worker/agents/think/draft-tools.ts`:**
1. The options become `{ getStub: GetStub; draftsPaused: () => Promise<boolean> }`.
2. At the top of `create_draft`'s `execute`:

```ts
				if (await draftsPaused()) return `${STORE_DRAFTS_PAUSED_MESSAGE} Keep working in the current draft.`;
```

**`worker/agents/think/ThinkAgent.ts`,** in `getTools()`:
1. Read `const userId = this.getConfig<ThinkAgentConfig>()?.userId ?? null;` once.
2. Pass `...createDraftTools({ getStub: () => this.getSpaceStub(), draftsPaused: () => isFlagOn(this.env, 'store-drafts-paused', userId) })`.
3. Pass `...createCatalogTools(catalogToolDepsFromEnv(this.env, userId))`.
4. Reuse `userId` in the payments tool's call.

**`worker/api/controllers/drafts/controller.ts`:** `create`'s change refuses before the agent:

```ts
		return this.respond(env, context.pathParams.id, async (_space, appId) => {
			if ('error' in parsed) return { error: parsed.error, status: 400 };
			if (await isFlagOn(env, 'store-drafts-paused', context.user?.id ?? null)) return { error: STORE_DRAFTS_PAUSED_MESSAGE, status: 403 };
			return (await getAgentStub(env, appId)).createDraft(parsed.name, parsed.from);
		});
```

**Billing's checks.** Each `isBillingOn(env, X)` becomes `(await isFlagOn(env, 'billing', X))`, importing `isFlagOn` from `worker/services/posthog/flags`. That covers `loadAccount`'s "billing off" branch, `checkPromptPlan`'s first line, the billing controller's `POST` guard and `getPublicPlan`'s `billing` field. All four are already async.
- **Billing's behaviour without PostHog** stays as it was: the flag answers billing's own switches when no project key is set. With a key, PostHog can add accounts but never remove one.
- **What stays:** `isBillingOn` remains in `worker/services/billing/flag.ts` and its test; `flags.ts` uses it. Then run `grep -rn "isBillingOn(" worker`: it must list only those three files.

- [ ] **Step 5: Pause in the browser**
- **`DraftSwitcher.tsx`:**
  1. Add `const draftsPaused = useFlag('store-drafts-paused');` with the other hooks.
  2. Right after `if (!snapshot || !active) return null;`, add `if (draftsPaused && snapshot.drafts.length === 1) return null;`.
  3. Wrap the "New draft" `<Button>` and the `atLimit` note in `{!draftsPaused && (<>...</>)}`.
- **`app-sidebar.tsx`:**
  1. Add `const catalogPaused = useFlag('catalog-paused');` beside the component's other hooks.
  2. Change both `{user && (` blocks that render the catalog link (`id="catalog-link"`) to `{user && !catalogPaused && (`.
- **`src/routes/catalog/index.tsx`:** in the page component, before the products render:

```tsx
	const catalogPaused = useFlag('catalog-paused');
	...
	if (catalogPaused) {
		return <Empty title="The catalog is paused" description="Catalog products can't be added to stores right now. Stores that already sell them keep taking and shipping orders." />;
	}
```

Keep the page's existing heading and `<title>` around it. Call the hooks before the early return.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/store-payments worker/agents/think/catalog-tools.test.ts worker/agents/think/draft-tools.test.ts worker/services/billing`
Expected: PASS, billing's own tests included.

Run: `rtk proxy bun run test -- worker/api/controllers/drafts worker/api/controllers/billing worker/api/controllers/limits worker/api/handlers src/components/drafts src/routes/catalog-flag-guard.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add shared/types/drafts.ts shared/types/catalog.ts src/api-types.ts worker/services/store-payments/catalog-locks.ts worker/services/store-payments/catalog-locks.test.ts worker/api/handlers/store-platform.ts worker/api/handlers/live-payments-flag.test.ts worker/agents/think/catalog-tools.ts worker/agents/think/catalog-tools.test.ts worker/agents/think/draft-tools.ts worker/agents/think/draft-tools.test.ts worker/agents/think/ThinkAgent.ts worker/api/controllers/drafts worker/services/billing/account.ts worker/services/billing/gates.ts worker/services/billing/billing-flag-wiring.test.ts worker/api/controllers/billing/controller.ts worker/api/controllers/limits/controller.ts src/components/drafts src/components/layout/app-sidebar.tsx src/routes/catalog/index.tsx src/routes/catalog-flag-guard.test.ts
git commit -m "feat(flags): pause flags for live store payments, the catalog and new drafts, and billing reads its flag

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Account and build events

**Files:**
- **Person properties:**
  - modify `worker/database/services/AnalyticsPersonService.ts` (`personFacts`);
  - modify `worker/services/posthog/person.ts` (`personUpdateOf`);
  - test `worker/services/posthog/person.sql.test.ts`.
- **Build events:**
  - create `worker/agents/think/build-events.ts`, tested in `worker/agents/think/build-events.test.ts`;
  - modify `worker/agents/think/ThinkAgent.ts` (the turn meter, `getTurnUsage`);
  - modify `worker/agents/core/behaviors/think.ts` (`runPrompt`, `ThinkAgentStub`);
  - test `worker/agents/think/build-events-wiring.test.ts`.
- **Accounts:**
  - modify `worker/database/services/AuthService.ts`: `verifyEmail` answers the user id, and provider sign-ins answer `isNewUser`;
  - tests `worker/database/services/email-confirmation.test.ts` and `worker/database/services/oauth-autolink.test.ts`;
  - modify `worker/api/controllers/auth/controller.ts`, tested in `worker/api/controllers/auth/account-events.test.ts`.

**Interfaces:**
- **Consumes:**
  - `serverAnalytics`, `PersonUpdate` and `AnalyticsPersonService`, from Task 2;
  - `accountPlanOf`, from Task 5;
  - `sessionTelemetry` and `honorAnalyticsChoice`, from Task 6.
- **Produces:**
  - `AnalyticsPersonService.personFacts(userId)`, answering `{ createdAt: Date | null; sellerLevel: SellerLevel | null; hasLiveStore: boolean } | null`;
  - `personUpdateOf(env: Env, userId: string): Promise<PersonUpdate>`, which never throws;
  - `TurnUsage { steps; credits }`, `turnUsageOf(meter)`;
  - `buildStartedProperties(input)`, `buildFinishedProperties(input)`;
  - `ThinkAgent.getTurnUsage(): Promise<TurnUsage | null>`;
  - `AuthService.verifyEmail(token): Promise<string>`;
  - `AuthResult.isNewUser` set on provider sign-ins.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/person.sql.test.ts`:

```ts
/** Person properties on real SQL; each test's writes are rolled back after it. */
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertApp, insertUser, migratedD1 } from '../../database/test-support/real-d1';
import { personUpdateOf } from './person';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'per_1');
	await insertUser(db, 'per_2');
});

describe('person properties', () => {
	it('sets the plan and tier, the seller level and whether a store is live, and the signup date once', async () => {
		await db.prepare(`UPDATE users SET created_at = ? WHERE id = 'per_1'`).bind(Date.UTC(2026, 9, 19, 15) / 1000).run();
		await db.prepare(`INSERT INTO stripe_connect_accounts (user_id, stripe_account_id, seller_level) VALUES ('per_1', 'acct_per_1', 'established')`).run();
		await insertApp(db, { id: 'app_per', userId: 'per_1' });
		await db
			.prepare(`INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES ('app_per', 'per-store', 'live', 'c0ffee', 1, 1, 1)`)
			.run();
		expect(await personUpdateOf(envWith(db), 'per_1')).toEqual({
			set: { plan: 'basic', tier: null, seller_level: 'established', has_live_store: true },
			setOnce: { signup_date: '2026-10-19' },
		});
	});

	it('reads a new account as Basic, not a seller and without a live store; an unreadable creation time sets no date', async () => {
		expect(await personUpdateOf(envWith(db), 'per_2')).toEqual({ set: { plan: 'basic', tier: null, seller_level: 'none', has_live_store: false } });
	});

	it('answers nothing for an unknown user or a database that fails', async () => {
		expect(await personUpdateOf(envWith(db), 'nobody')).toEqual({});
		const broken = envWith({ prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database);
		expect(await personUpdateOf(broken, 'per_1')).toEqual({});
	});
});
```

`worker/agents/think/build-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildFinishedProperties, buildStartedProperties, turnUsageOf } from './build-events';

describe('build events', () => {
	it('start with the app, the model and whether it is the first build', () => {
		expect(buildStartedProperties({ appId: 'app_1', model: 'gemini-3.6-flash', firstBuild: true })).toEqual({ app_id: 'app_1', model: 'gemini-3.6-flash', first_build: true });
	});

	it("finish with the outcome, the steps, credits at the turn's model price and the duration", () => {
		const usage = turnUsageOf({ steps: 7, creditCost: 1.2 });
		expect(usage).toEqual({ steps: 7, credits: 8.4 });
		expect(buildFinishedProperties({ appId: 'app_1', model: 'gemini-3.6-flash', firstBuild: false, completed: true, usage, startedAtMs: 1_000, nowMs: 61_000 })).toEqual({
			app_id: 'app_1',
			model: 'gemini-3.6-flash',
			first_build: false,
			outcome: 'completed',
			steps: 7,
			credits_used: 8.4,
			duration_ms: 60_000,
		});
	});

	it('record a failed turn with no usage as zero steps and credits', () => {
		expect(buildFinishedProperties({ appId: 'app_1', model: 'm', firstBuild: true, completed: false, usage: null, startedAtMs: 5, nowMs: 5 })).toMatchObject({
			outcome: 'failed',
			steps: 0,
			credits_used: 0,
			duration_ms: 0,
		});
	});
});
```

`worker/agents/think/build-events-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/think/ThinkAgent.ts', '/worker/agents/core/behaviors/think.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	const to = text.indexOf(end, from + start.length);
	if (to === -1) throw new Error(`Marker not found: ${end}`);
	return text.slice(from, to);
}

describe('build analytics wiring', () => {
	const agent = source('/worker/agents/think/ThinkAgent.ts');
	const host = source('/worker/agents/core/behaviors/think.ts');

	it('counts every step of a turn and answers the usage to the host', () => {
		expect(between(agent, 'override async beforeTurn(', 'override getSkills(')).toContain('this.turnMeter = null;');
		expect(between(agent, 'override async beforeStep(', 'if (ctx.stepNumber')).toContain('this.turnMeter.steps += 1;');
		expect(agent).toContain('async getTurnUsage(): Promise<TurnUsage | null>');
	});

	it('sends build_started before the turn, and build_finished after it, failed or not', () => {
		const run = between(host, 'private async runPrompt(', 'private async captureTurnReferences(');
		expect(run.indexOf('this.startBuildAnalytics()')).toBeLessThan(run.indexOf('await stub.chat(message, forwarder)'));
		expect(between(run, '} finally {', 'if (turnError !== undefined)')).toContain('await build.finish(chatFinished && turnError === undefined, stub);');
	});
});
```

`worker/api/controllers/auth/account-events.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '../../../../shared/types/legal';
import type { RouteContext } from '../../types/route-context';

const recorded = vi.hoisted(() => ({ calls: [] as string[], events: [] as Array<{ name: string; userId: string; properties: unknown }> }));
const auth = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), verifyEmail: vi.fn(), handleOAuthCallback: vi.fn(), getPendingLinkUserId: vi.fn(async () => null) }));

vi.mock('../../../database/services/AuthService', () => ({ AuthService: vi.fn().mockImplementation(() => auth) }));
vi.mock('../../../services/posthog/session', () => ({
	sessionTelemetry: async () => {
		recorded.calls.push('telemetry');
		return { flags: { billing: false, 'store-drafts-paused': false, 'catalog-paused': false, 'session-replay-paused': false }, analyticsOptOut: false };
	},
	honorAnalyticsChoice: async () => {
		recorded.calls.push('gpc');
		return false;
	},
}));
vi.mock('../../../services/posthog/person', () => ({ personUpdateOf: async () => ({ set: { plan: 'basic' } }) }));
vi.mock('../../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({
		capture: (name: string, userId: string, properties: unknown) => {
			recorded.calls.push(`capture:${name}`);
			recorded.events.push({ name, userId, properties });
		},
	}),
}));

const { AuthController } = await import('./controller');

const env = { ENVIRONMENT: 'dev', JWT_SECRET: 'Test-Secret-1234567890-abcdefghijklmnop-!@#$' } as unknown as Env;
const SESSION = { user: { id: 'user-1', email: 'ana@example.test' }, sessionId: 's1', expiresAt: null, accessToken: 'token' };
const post = (path: string, body: unknown) =>
	new Request(`https://estori.app${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
	recorded.calls.length = 0;
	recorded.events.length = 0;
});

describe('account events', () => {
	it('sends account_created on a password sign-up, after GPC is honored, without the email', async () => {
		auth.register.mockResolvedValue(SESSION);
		await AuthController.register(post('/api/auth/register', { email: 'ana@example.test', password: 'A-strong-pass-123!', acceptedTermsVersion: TERMS_VERSION }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.calls).toEqual(['telemetry', 'capture:account_created']);
		expect(recorded.events).toEqual([{ name: 'account_created', userId: 'user-1', properties: { method: 'password' } }]);
		expect(JSON.stringify(recorded.events)).not.toContain('ana@example.test');
	});

	it('sends signed_in on a password sign-in', async () => {
		auth.login.mockResolvedValue(SESSION);
		await AuthController.login(post('/api/auth/login', { email: 'ana@example.test', password: 'whatever' }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.events).toEqual([{ name: 'signed_in', userId: 'user-1', properties: { method: 'password' } }]);
	});

	it('sends email_confirmed for the confirmed user, after GPC is honored', async () => {
		auth.verifyEmail.mockResolvedValue('user-1');
		await AuthController.verifyEmail(post('/api/auth/verify-email', { token: 'raw-token' }), env, {} as ExecutionContext, {} as RouteContext);
		expect(recorded.calls).toEqual(['gpc', 'capture:email_confirmed']);
	});

	it('sends account_created for a new provider account and signed_in for a returning one', async () => {
		auth.handleOAuthCallback.mockResolvedValueOnce({ ...SESSION, isNewUser: true }).mockResolvedValueOnce({ ...SESSION, isNewUser: false });
		const callback = new Request('https://estori.app/api/auth/callback/google?code=c&state=s');
		const context = { pathParams: { provider: 'google' }, queryParams: new URL(callback.url).searchParams } as unknown as RouteContext;
		await AuthController.handleOAuthCallback(callback, env, {} as ExecutionContext, context);
		await AuthController.handleOAuthCallback(callback, env, {} as ExecutionContext, context);
		expect(recorded.events.map((event) => [event.name, event.properties])).toEqual([
			['account_created', { method: 'google' }],
			['signed_in', { method: 'google' }],
		]);
		expect(recorded.calls.indexOf('gpc')).toBeLessThan(recorded.calls.indexOf('capture:account_created'));
	});
});
```

In `worker/database/services/oauth-autolink.test.ts`, add:

```ts
describe('provider sign-in that creates the account', () => {
	it('answers that the user is new', async () => {
		const created: Row = { ...existingAccount(1), id: 'user-new', password_hash: null, provider: 'google', provider_id: 'google-123' };
		const states = rowsByTable({ oauth_states: stateRow('google') });
		// The email lookup finds nobody; the read-back after the insert finds the new user.
		const { d1 } = recordingD1((sql) => {
			const lower = sql.toLowerCase();
			if (lower.includes('from "users"') && lower.includes('"users"."id"')) return rowsByTable({ users: created })(sql);
			return states(sql);
		});
		vi.spyOn(AuthService.prototype, 'getOauthProvider').mockResolvedValue(fakeProvider('google'));
		const env = { DB: d1, JWT_SECRET: 'test-only-jwt-secret-of-at-least-32-characters', ENVIRONMENT: 'dev' } as unknown as Env;
		const result = await new AuthService(env).handleOAuthCallback('google', 'code-1', 'state-1', callbackRequest('google'));
		expect(result.isNewUser).toBe(true);
		expect(result.user.id).toBe('user-new');
	});
});
```

In the existing confirmed-account test, also run `handleOAuthCallback` once through `new AuthService(env)`, and assert `isNewUser` is `false`. If the session service reads `users` too, widen the rows function so any users-by-id select answers `created`.

In `worker/database/services/email-confirmation.test.ts`, the test that confirms an address (`await auth.verifyEmail('some-token')`, near line 155) now asserts the answer is that user's id.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/person.sql.test.ts worker/agents/think/build-events.test.ts worker/agents/think/build-events-wiring.test.ts`
Expected: FAIL. `personUpdateOf` and `./build-events` don't exist.

Run: `rtk proxy bun run test -- worker/api/controllers/auth/account-events.test.ts worker/database/services/oauth-autolink.test.ts worker/database/services/email-confirmation.test.ts`
Expected: FAIL. No events are captured yet, `isNewUser` is unset, and `verifyEmail` answers nothing.

- [ ] **Step 3: Person properties**

In `AnalyticsPersonService`:

```ts
	/** What person properties are built from; null when the user doesn't exist. */
	async personFacts(userId: string): Promise<{ createdAt: Date | null; sellerLevel: SellerLevel | null; hasLiveStore: boolean } | null> {
		const user = await this.database.select({ createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, userId)).get();
		if (!user) return null;
		const seller = await this.database
			.select({ level: schema.stripeConnectAccounts.sellerLevel })
			.from(schema.stripeConnectAccounts)
			.where(eq(schema.stripeConnectAccounts.userId, userId))
			.get();
		const live = await this.database
			.select({ appId: schema.liveStores.appId })
			.from(schema.liveStores)
			.innerJoin(schema.apps, eq(schema.apps.id, schema.liveStores.appId))
			.where(and(eq(schema.apps.userId, userId), eq(schema.liveStores.status, 'live')))
			.limit(1)
			.get();
		// Rows created with the column's text default read as an invalid date.
		const createdAt = user.createdAt && !Number.isNaN(user.createdAt.getTime()) ? user.createdAt : null;
		return { createdAt, sellerLevel: seller?.level ?? null, hasLiveStore: live !== undefined };
	}
```

In `worker/services/posthog/person.ts`, add:

```ts
import { AnalyticsPersonService } from '../../database/services/AnalyticsPersonService';
import type { PersonUpdate } from './analytics';

/** The person properties to set with an event about this user; empty when they can't be read, never throwing. */
export async function personUpdateOf(env: Env, userId: string): Promise<PersonUpdate> {
	try {
		const facts = await new AnalyticsPersonService(env).personFacts(userId);
		if (!facts) return {};
		const { plan, tier } = await accountPlanOf(env, userId);
		const update: PersonUpdate = { set: { plan, tier, seller_level: facts.sellerLevel ?? 'none', has_live_store: facts.hasLiveStore } };
		if (facts.createdAt) update.setOnce = { signup_date: facts.createdAt.toISOString().slice(0, 10) };
		return update;
	} catch {
		return {};
	}
}
```

- [ ] **Step 4: Build events**

**`worker/agents/think/build-events.ts`:**

```ts
/** The properties of a build's start and finish; the Think host sends them (core/behaviors/think.ts). */

import type { ServerEventProperties } from '../../../shared/types/analytics-events';

/**
 * One turn's usage, from ThinkAgent: its steps, priced at the turn's model credit cost. Think always runs on Estori's
 * gateway (behaviors/think.ts configureThinkAgent), so every credit is Estori's cost.
 */
export interface TurnUsage {
	steps: number;
	credits: number;
}

export function turnUsageOf(meter: { steps: number; creditCost: number }): TurnUsage {
	return { steps: meter.steps, credits: Math.round(meter.steps * meter.creditCost * 100) / 100 };
}

export function buildStartedProperties(input: { appId: string; model: string; firstBuild: boolean }): ServerEventProperties<'build_started'> {
	return { app_id: input.appId, model: input.model, first_build: input.firstBuild };
}

export function buildFinishedProperties(input: {
	appId: string;
	model: string;
	firstBuild: boolean;
	completed: boolean;
	usage: TurnUsage | null;
	startedAtMs: number;
	nowMs: number;
}): ServerEventProperties<'build_finished'> {
	return {
		app_id: input.appId,
		model: input.model,
		first_build: input.firstBuild,
		outcome: input.completed ? 'completed' : 'failed',
		steps: input.usage?.steps ?? 0,
		credits_used: input.usage?.credits ?? 0,
		duration_ms: Math.max(0, input.nowMs - input.startedAtMs),
	};
}
```

**`ThinkAgent.ts`:** import `turnUsageOf` and `type TurnUsage` from `./build-events`. Then:
1. Add the field:

```ts
	/** The current turn's steps and their price; the host reads it when the turn ends (getTurnUsage). */
	private turnMeter: { steps: number; creditCost: number } | null = null;
```

2. In `beforeTurn` (as billing left it):
   - set `this.turnMeter = null;` beside `this.turnUsage = null;`;
   - inside `if (config)`, right after `creditCost` is resolved, set `this.turnMeter = { steps: 0, creditCost };`. The meter doesn't depend on billing's metering setup, so a turn whose setup fails still reports its steps.
3. At the top of `beforeStep`, add `if (this.turnMeter) this.turnMeter.steps += 1;`.
4. Add the RPC:

```ts
	/** RPC for the host: the turn's steps and credits, read when the turn ends. */
	async getTurnUsage(): Promise<TurnUsage | null> {
		return this.turnMeter ? turnUsageOf(this.turnMeter) : null;
	}
```

**`core/behaviors/think.ts`:** import `serverAnalytics` from `worker/services/posthog/analytics`, and `buildStartedProperties`, `buildFinishedProperties` and `type TurnUsage` from `../../think/build-events`. Then:
1. Add `getTurnUsage: () => Promise<TurnUsage | null>;` to `ThinkAgentStub`.
2. Add the helper:

```ts
	/** Sends `build_started` now, and answers how to send `build_finished` with the turn's usage. Never throws. */
	private startBuildAnalytics(): { finish(completed: boolean, stub: ThinkAgentStub): Promise<void> } {
		const userId = this.state.metadata?.userId;
		const appId = this.getAgentId();
		const model = resolveThinkModel(this.state.thinkModelId).id;
		const firstBuild = !this.isMVPGenerated();
		const startedAtMs = Date.now();
		const analytics = serverAnalytics(this.env);
		if (userId) analytics.capture('build_started', userId, buildStartedProperties({ appId, model, firstBuild }));
		return {
			finish: async (completed, stub) => {
				if (!userId) return;
				const usage = await stub.getTurnUsage().catch(() => null);
				analytics.capture('build_finished', userId, buildFinishedProperties({ appId, model, firstBuild, completed, usage, startedAtMs, nowMs: Date.now() }));
			},
		};
	}
```

3. In `runPrompt`:
   - start with `const build = this.startBuildAnalytics();`;
   - declare `let chatFinished = false;` before the `try`;
   - after `await stub.chat(message, forwarder);`, set `chatFinished = true;`;
   - in the `finally`, after `await this.cancelUnfinishedMerge();`, add `await build.finish(chatFinished && turnError === undefined, stub);`.

- [ ] **Step 5: Account events**

**`AuthService.ts`:**
1. `findOrCreateOAuthUser` answers `Promise<{ user: schema.User; created: boolean }>`:
   - `created: true` only from the `createOAuthUser` branch;
   - every other branch wraps its user as `{ user, created: false }`.
2. `handleOAuthCallback` destructures `{ user, created }` and adds `isNewUser: created` to its result.
3. `verifyEmail` answers `Promise<string>` and ends with `return user.id;`.

**`worker/api/controllers/auth/controller.ts`:** import `serverAnalytics` and `personUpdateOf`. Then:

- **`register`,** right after `const telemetry = ...`:

```ts
            serverAnalytics(env).capture('account_created', result.user.id, { method: 'password' }, await personUpdateOf(env, result.user.id));
```

- **`login`:** the same, with `'signed_in'`.
- **`verifyEmail`:**

```ts
            const userId = await new AuthService(env).verifyEmail(parsed.data.token);
            await honorAnalyticsChoice(env, request, userId);
            serverAnalytics(env).capture('email_confirmed', userId, {});
```

- **`handleOAuthCallback`,** right after the `honorAnalyticsChoice` line from Task 6:

```ts
            serverAnalytics(env).capture(result.isNewUser ? 'account_created' : 'signed_in', result.user.id, { method: validatedProvider }, await personUpdateOf(env, result.user.id));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/person.sql.test.ts worker/agents/think/build-events.test.ts worker/agents/think/build-events-wiring.test.ts worker/agents/think/build-progress-wiring.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/api/controllers/auth worker/database/services/oauth-autolink.test.ts worker/database/services/email-confirmation.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/database/services/AnalyticsPersonService.ts worker/services/posthog/person.ts worker/services/posthog/person.sql.test.ts worker/agents/think/build-events.ts worker/agents/think/build-events.test.ts worker/agents/think/build-events-wiring.test.ts worker/agents/think/ThinkAgent.ts worker/agents/core/behaviors/think.ts worker/database/services/AuthService.ts worker/database/services/oauth-autolink.test.ts worker/database/services/email-confirmation.test.ts worker/api/controllers/auth/controller.ts worker/api/controllers/auth/account-events.test.ts
git commit -m "feat(analytics): account and build events, with credits per build and person properties

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Store and money events

**Files:**
- Create `worker/services/posthog/commerce-events.ts`. Test: `worker/services/posthog/commerce-events.test.ts`.
- Modify `worker/database/services/StripeConnectService.ts` (`updateFlags`). Test: `worker/database/services/stripe-connect-ready.sql.test.ts`.
- Modify `worker/database/services/StoreOrderService.ts` (`sellerOrderCount`). Test: `worker/database/services/seller-order-count.sql.test.ts`.
- Modify `worker/services/store-payments/wiring.ts` and `worker/services/payments/purchase-wiring.ts`. Test: `worker/services/posthog/commerce-wiring.test.ts`.
- Modify `worker/api/controllers/liveStores/controller.ts` and `controller.sql.test.ts`.

**Interfaces:**
- **Consumes:** `serverAnalytics` from Task 2; `personUpdateOf` from Task 10; `amountBand` from Task 1; `MAIN_DRAFT_ID` from `shared/types/drafts.ts`.
- **Produces:**
  - `saleCompletedProperties(order: NewStoreOrder, firstSale: boolean)`;
  - `catalogOrderPlacedProperties(paid: PaidCatalogCheckout)`;
  - `templateSoldProperties(record: StripePurchaseRecord)`;
  - `stripeReady(flags): boolean`;
  - `StripeConnectService.updateFlags(...)`, now answering `Promise<{ userId: string; becameReady: boolean } | null>`;
  - `StoreOrderService.sellerOrderCount(sellerUserId, mode): Promise<number>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/commerce-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { catalogOrderPlacedProperties, saleCompletedProperties, stripeReady, templateSoldProperties } from './commerce-events';
import type { NewStoreOrder } from '../store-payments/store';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';

const ORDER = {
	appId: 'app_1',
	mode: 'live',
	totalCents: 4_250,
	applicationFeeCents: 2_249,
	items: [
		{ lineNo: 1, kind: 'own', productId: 'p1', variantId: 'v1', name: 'Mug', quantity: 1, unitPriceCents: 1_500, catalogVariantId: null, lockedCatalogPriceCents: null },
		{ lineNo: 2, kind: 'catalog', productId: 'p2', variantId: 'v2', name: 'Tee', quantity: 2, unitPriceCents: 1_375, catalogVariantId: 'cv_2', lockedCatalogPriceCents: 900 },
	],
} as unknown as NewStoreOrder;

describe('store and money events', () => {
	it("give a sale's total as a band, Estori's fee exact, and whether it is the first", () => {
		expect(saleCompletedProperties(ORDER, true)).toEqual({ app_id: 'app_1', mode: 'live', total_band: '25_to_100', application_fee_cents: 2_249, has_catalog_items: true, first_sale: true });
		expect(saleCompletedProperties({ ...ORDER, items: [ORDER.items[0]] }, false)).toMatchObject({ has_catalog_items: false, first_sale: false });
	});

	it('count the catalog units handed to the supplier flow', () => {
		const paid = { storeAppId: 'app_1', cart: { lines: [{ kind: 'own', quantity: 3 }, { kind: 'catalog', quantity: 2 }, { kind: 'catalog', quantity: 1 }] } } as unknown as PaidCatalogCheckout;
		expect(catalogOrderPlacedProperties(paid)).toEqual({ app_id: 'app_1', item_count: 3 });
	});

	it('give a template sale its public price and the platform fee', () => {
		expect(templateSoldProperties({ listingId: 'lst_1', priceCents: 4_900, platformFeeCents: 490 } as StripePurchaseRecord)).toEqual({ listing_id: 'lst_1', price_cents: 4_900, platform_fee_cents: 490 });
	});

	it("call a Stripe account ready once Stripe's side of store payments is complete", () => {
		const ready = { detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };
		expect(stripeReady(ready)).toBe(true);
		for (const missing of Object.keys(ready) as Array<keyof typeof ready>) expect(stripeReady({ ...ready, [missing]: false }), missing).toBe(false);
	});
});
```

`worker/database/services/stripe-connect-ready.sql.test.ts`:

```ts
/** Payments readiness on real SQL: payments_ready goes once, when Stripe first makes the account ready. */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { envWith, insertUser, migratedD1 } from '../test-support/real-d1';

const captured = vi.hoisted((): Array<[string, string]> => []);
vi.mock('../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string) => captured.push([name, userId]) }),
}));

const { StripeConnectService } = await import('./StripeConnectService');

const NOT_READY = { detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false, transfersActive: false, cardPaymentsActive: false };
const READY = { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, transfersActive: true, cardPaymentsActive: true };
let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'ready_1');
});

describe('payments readiness', () => {
	it('sends payments_ready once, on the update that makes the account ready', async () => {
		const accounts = new StripeConnectService(envWith(db));
		await accounts.create({ userId: 'ready_1', stripeAccountId: 'acct_ready', flags: NOT_READY });
		expect(await accounts.updateFlags('acct_ready', { ...NOT_READY, detailsSubmitted: true })).toEqual({ userId: 'ready_1', becameReady: false });
		expect(await accounts.updateFlags('acct_ready', READY)).toEqual({ userId: 'ready_1', becameReady: true });
		expect(await accounts.updateFlags('acct_ready', READY)).toEqual({ userId: 'ready_1', becameReady: false });
		expect(captured).toEqual([['payments_ready', 'ready_1']]);
	});

	it('answers null for an account Estori does not know', async () => {
		expect(await new StripeConnectService(envWith(db)).updateFlags('acct_unknown', READY)).toBeNull();
	});
});
```

`worker/database/services/seller-order-count.sql.test.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { envWith, insertStoreOrder, insertUser, migratedD1 } from '../test-support/real-d1';
import { StoreOrderService } from './StoreOrderService';

let db: D1Database;

beforeAll(async () => {
	db = await migratedD1();
	await insertUser(db, 'count_1');
});

describe("a seller's order count", () => {
	it('counts the orders of one mode, so the first live sale is first even after test sales', async () => {
		const orders = new StoreOrderService(envWith(db));
		expect(await orders.sellerOrderCount('count_1', 'live')).toBe(0);
		await insertStoreOrder(db, { id: 'ord_t1', sellerUserId: 'count_1', mode: 'test', orderNumber: 1, totalCents: 1_000, createdAt: new Date() });
		await insertStoreOrder(db, { id: 'ord_t2', sellerUserId: 'count_1', mode: 'test', orderNumber: 2, totalCents: 1_000, createdAt: new Date() });
		await insertStoreOrder(db, { id: 'ord_l1', sellerUserId: 'count_1', mode: 'live', orderNumber: 1, totalCents: 1_000, createdAt: new Date() });
		expect(await orders.sellerOrderCount('count_1', 'test')).toBe(2);
		expect(await orders.sellerOrderCount('count_1', 'live')).toBe(1);
	});
});
```

`worker/services/posthog/commerce-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/services/store-payments/wiring.ts', '/worker/services/payments/purchase-wiring.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function between(text: string, start: string, end: string): string {
	const from = text.indexOf(start);
	if (from === -1) throw new Error(`Marker not found: ${start}`);
	return text.slice(from, text.indexOf(end, from + start.length));
}

const wiring = sources['/worker/services/store-payments/wiring.ts'] ?? '';
const purchases = sources['/worker/services/payments/purchase-wiring.ts'] ?? '';

describe('money events are sent where records are first written', () => {
	it('sends sale_completed once per order, from both the webhook and the return page', () => {
		const record = between(wiring, 'recordOrder: async (order) => {', 'notifyNewOrder:');
		expect(record).toContain("if (recorded === 'recorded') {");
		expect(record).toContain("capture('sale_completed', order.sellerUserId, saleCompletedProperties(order, firstSale))");
		expect(record).toContain('sellerOrderCount(order.sellerUserId, order.mode)');
	});

	it('sends catalog_order_placed when the catalog lines are first recorded', () => {
		const handOff = between(wiring, 'handOffCatalogLines: async (paid) => {', 'settleSale:');
		expect(handOff).toContain("if (recorded.result === 'recorded' && recorded.orderId) {");
		expect(handOff).toContain("capture('catalog_order_placed', paid.sellerUserId, catalogOrderPlacedProperties(paid))");
	});

	it("sends template_sold to the listing's seller when a paid site sale is first recorded", () => {
		const record = between(purchases, 'recordStripePurchase: async (record) => {', 'sessionRecorded:');
		expect(record).toContain('if (recorded) {');
		expect(record).toContain("capture('template_sold', seller.userId, templateSoldProperties(record))");
	});
});
```

In `worker/api/controllers/liveStores/controller.sql.test.ts`:
1. Add the mocks:

```ts
const captured = vi.hoisted((): Array<[string, string, unknown]> => []);
vi.mock('../../../services/posthog/analytics', () => ({
	serverAnalytics: () => ({ capture: (name: string, userId: string, properties: unknown) => captured.push([name, userId, properties]) }),
}));
vi.mock('../../../services/posthog/person', () => ({ personUpdateOf: async () => ({ set: { has_live_store: true } }) }));
```

2. Clear `captured` in `beforeEach`.
3. In `publishAs`, add `user: { id: appId === 'app_tea' ? 'seller_1' : 'seller_2' }` to the context.
4. Add:

```ts
	it('sends store_published, the first time as the first publish, naming the draft', async () => {
		const { namespace } = spaces();
		await publishAs('app_tea', 'northwind-tea', namespace);
		await publishAs('app_tea', 'northwind-tea', namespace, 'typo');
		expect(captured).toEqual([
			['store_published', 'seller_1', { app_id: 'app_tea', first_publish: true, draft: 'main' }],
			['store_published', 'seller_1', { app_id: 'app_tea', first_publish: false, draft: 'other' }],
		]);
	});
```

5. In the test where another store takes the slug, also expect `captured` to be empty.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/commerce-events.test.ts worker/services/posthog/commerce-wiring.test.ts worker/database/services/stripe-connect-ready.sql.test.ts`
Expected: FAIL. The module, the readiness answer and the captures don't exist yet.

Run: `rtk proxy bun run test -- worker/database/services/seller-order-count.sql.test.ts worker/api/controllers/liveStores/controller.sql.test.ts`
Expected: FAIL, for the same reason.

- [ ] **Step 3: Write `worker/services/posthog/commerce-events.ts`**

```ts
/** The properties of store and money events, from the records the payment flows already hold. */

import { amountBand, type ServerEventProperties } from '../../../shared/types/analytics-events';
import type { StripePurchaseRecord } from '../../database/services/TemplateService';
import type { PaidCatalogCheckout } from '../catalog/record';
import type { SellerFlags } from '../payments/stripe-client';
import type { NewStoreOrder } from '../store-payments/store';

/** A seller's sales are their business data: the total goes as a band, Estori's own fee exact. */
export function saleCompletedProperties(order: NewStoreOrder, firstSale: boolean): ServerEventProperties<'sale_completed'> {
	return {
		app_id: order.appId,
		mode: order.mode,
		total_band: amountBand(order.totalCents),
		application_fee_cents: order.applicationFeeCents,
		has_catalog_items: order.items.some((item) => item.kind === 'catalog'),
		first_sale: firstSale,
	};
}

export function catalogOrderPlacedProperties(paid: PaidCatalogCheckout): ServerEventProperties<'catalog_order_placed'> {
	const units = paid.cart.lines.filter((line) => line.kind === 'catalog').reduce((total, line) => total + line.quantity, 0);
	return { app_id: paid.storeAppId, item_count: units };
}

/** Listing prices are public, so they go exact. */
export function templateSoldProperties(record: StripePurchaseRecord): ServerEventProperties<'template_sold'> {
	return { listing_id: record.listingId, price_cents: record.priceCents, platform_fee_cents: record.platformFeeCents };
}

/** Stripe's side of payments setup is done: the account can take store payments and be paid out. The selling terms are separate. */
export function stripeReady(flags: Pick<SellerFlags, 'detailsSubmitted' | 'cardPaymentsActive' | 'transfersActive' | 'payoutsEnabled'>): boolean {
	return flags.detailsSubmitted && flags.cardPaymentsActive && flags.transfersActive && flags.payoutsEnabled;
}
```

- [ ] **Step 4: Send the events where records are first written**

**`StripeConnectService.updateFlags`.** Four callers refresh flags: the webhook, the payouts status, publishing and checkout. So the change to ready is detected once, here.

```ts
    /** Stores Stripe's flags; the update that first makes the account ready sends `payments_ready`. Null for an unknown account. */
    async updateFlags(stripeAccountId: string, flags: SellerFlags): Promise<{ userId: string; becameReady: boolean } | null> {
        const before = await this.getByAccountId(stripeAccountId);
        await this.database
            .update(schema.stripeConnectAccounts)
            .set({ ...flags, updatedAt: new Date() })
            .where(eq(schema.stripeConnectAccounts.stripeAccountId, stripeAccountId));
        if (!before) return null;
        const becameReady = !stripeReady(before) && stripeReady(flags);
        if (becameReady) serverAnalytics(this.env).capture('payments_ready', before.userId, {});
        return { userId: before.userId, becameReady };
    }
```

The callers ignore the answer. Their `await` stays as it is.

**`StoreOrderService`:**

```ts
    /** How many orders the seller's stores have recorded in this mode; 1 right after their first sale. */
    async sellerOrderCount(sellerUserId: string, mode: StoreMode): Promise<number> {
        const row = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(schema.storeOrders)
            .where(and(eq(schema.storeOrders.sellerUserId, sellerUserId), eq(schema.storeOrders.mode, mode)))
            .get();
        return row?.count ?? 0;
    }
```

**`recordStoreOrderDeps`** in `worker/services/store-payments/wiring.ts`. `returnPageRecordDeps` spreads it, so both paths send.

```ts
		recordOrder: async (order) => {
			const recorded = await orders.recordOrder(order);
			if (recorded === 'recorded') {
				const firstSale = (await orders.sellerOrderCount(order.sellerUserId, order.mode).catch(() => 0)) === 1;
				serverAnalytics(env).capture('sale_completed', order.sellerUserId, saleCompletedProperties(order, firstSale));
			}
			return recorded;
		},
```

```ts
		handOffCatalogLines: async (paid) => {
			const recorded = await recordPaidCatalogOrder({ store: new CatalogOrderService(env), newId: generateId, now: () => new Date() }, paid);
			if (recorded.result === 'recorded' && recorded.orderId) {
				serverAnalytics(env).capture('catalog_order_placed', paid.sellerUserId, catalogOrderPlacedProperties(paid));
				await scheduleCatalogPlacement(env, recorded.orderId);
			}
		},
```

**`fulfillDepsFromEnv`** in `worker/services/payments/purchase-wiring.ts`:

```ts
		recordStripePurchase: async (record) => {
			const recorded = await listings.recordStripePurchase(record);
			if (recorded) {
				const seller = await new StripeConnectService(env).getByAccountId(record.sellerStripeAccountId).catch(() => null);
				if (seller) serverAnalytics(env).capture('template_sold', seller.userId, templateSoldProperties(record));
			}
			return recorded;
		},
```

**`LiveStoreController`.** Import `serverAnalytics`, `personUpdateOf` and `MAIN_DRAFT_ID`. Then:
- **In `publish`:**
  1. Right before `space.publishDraft(draftId)`, add `const firstPublish = (await stores.getByApp(appId)) === null;`.
  2. After the `slug-taken` check, add:

```ts
            const ownerId = context.user?.id;
            if (ownerId) {
                const draft = published.draftId === MAIN_DRAFT_ID ? 'main' : 'other';
                serverAnalytics(env).capture('store_published', ownerId, { app_id: appId, first_publish: firstPublish, draft }, await personUpdateOf(env, ownerId));
            }
```

- **In `offline`,** after `takeStoreOffline(...)`, add:

```ts
            const ownerId = context.user?.id;
            if (ownerId) serverAnalytics(env).capture('store_unpublished', ownerId, { app_id: appId }, await personUpdateOf(env, ownerId));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/commerce-events.test.ts worker/services/posthog/commerce-wiring.test.ts worker/database/services/stripe-connect-ready.sql.test.ts worker/database/services/stripe-connect.sql.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- worker/database/services/seller-order-count.sql.test.ts worker/api/controllers/liveStores worker/services/store-payments/wiring.test.ts worker/services/payments`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/services/posthog/commerce-events.ts worker/services/posthog/commerce-events.test.ts worker/services/posthog/commerce-wiring.test.ts worker/database/services/StripeConnectService.ts worker/database/services/stripe-connect-ready.sql.test.ts worker/database/services/StoreOrderService.ts worker/database/services/seller-order-count.sql.test.ts worker/services/store-payments/wiring.ts worker/services/payments/purchase-wiring.ts worker/api/controllers/liveStores
git commit -m "feat(analytics): publish, payments ready, sale, catalog order and template sale events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Billing events

Billing merged before this plan and sends no analytics. This task adds its five events at billing's own points, named in the billing plan (`docs/superpowers/plans/2026-10-19-billing-subscriptions.md`, Tasks 4, 5, 7 and 8). Each goes out only after billing records the thing that triggers it the first time, so Stripe's retries never count twice.

**Files:**
- Create `worker/services/posthog/billing-events.ts`. Test: `worker/services/posthog/billing-events.test.ts`.
- Modify billing's code:
  - `worker/services/billing/events.ts`: `BillingEventDeps` gains `track`; `applySubscription` calls it after `recordEvent`;
  - `worker/services/billing/wiring.ts`: `billingEventDepsFromEnv` provides `track`;
  - `worker/services/billing/credit-notices.ts`: `CreditNoticeDeps` gains `reached`; `noticeCreditUse` calls it when the notice is sent; `creditNoticeDepsFromEnv` provides it;
  - `worker/services/payments/stripe-client.ts`: `StripeInvoice` gains `attempt_count?: number`, which Stripe's invoice object carries.
- Test: `worker/services/billing/events-analytics.test.ts`. Billing's existing fakes of `BillingEventDeps` and `CreditNoticeDeps` get a no-op `track` and `reached`.

**Interfaces:**
- **Consumes:**
  - from billing: `applySubscription(deps, input)`, `BillingEventDeps`, `noticeCreditUse(deps, use, claimedHere)`, `CreditNoticeDeps`, `CreditUse`, `claimAndSendNotice`, `SubscriptionRecord`, `StripeSubscription`, `StripeInvoice`;
  - `serverAnalytics` (Task 2), `accountPlanOf` (Task 5), `personUpdateOf` (Task 10).
- **Produces:**
  - `BillingAnalyticsEvent`, a union of `{ name; properties }` over the five billing events;
  - `subscriptionEventsFor(input: { previous: SubscriptionRecord | null; next: SubscriptionRecord; eventType: string; invoice: StripeInvoice | null }): BillingAnalyticsEvent[]`;
  - `cancelReasonOf(previous: SubscriptionRecord | null): 'seller' | 'payment_failed' | 'admin'`;
  - `BillingEventDeps.track(userId: string, events: readonly BillingAnalyticsEvent[]): Promise<void>`, which never throws;
  - `CreditNoticeDeps.reached(use: CreditUse, threshold: 80 | 100): Promise<void>`, which never throws.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/billing-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cancelReasonOf, subscriptionEventsFor } from './billing-events';
import type { SubscriptionRecord } from '../../database/schema';
import type { StripeInvoice } from '../payments/stripe-client';

function record(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
	return { userId: 'u1', stripeSubscriptionId: 'sub_1', status: 'active', tier: 3, cancelAtPeriodEnd: false, ...overrides } as SubscriptionRecord;
}

const failedInvoice = { id: 'in_2', amount_paid: 0, attempt_count: 2 } as StripeInvoice;

describe('billing events', () => {
	it('starts Premium from a completed checkout only, with its tier', () => {
		expect(subscriptionEventsFor({ previous: null, next: record(), eventType: 'checkout.session.completed', invoice: null })).toEqual([{ name: 'subscription_started', properties: { tier: 3 } }]);
		expect(subscriptionEventsFor({ previous: null, next: record(), eventType: 'customer.subscription.created', invoice: null })).toEqual([]);
		expect(subscriptionEventsFor({ previous: null, next: record({ status: 'incomplete' }), eventType: 'checkout.session.completed', invoice: null })).toEqual([]);
	});

	it('records a tier change once, on the update that first stores the new tier, up or down', () => {
		expect(subscriptionEventsFor({ previous: record({ tier: 1 }), next: record({ tier: 3 }), eventType: 'customer.subscription.updated', invoice: null })).toEqual([
			{ name: 'subscription_changed', properties: { from_tier: 1, to_tier: 3, direction: 'up' } },
		]);
		expect(subscriptionEventsFor({ previous: record({ tier: 4 }), next: record({ tier: 2 }), eventType: 'customer.subscription.updated', invoice: null })[0]).toMatchObject({ properties: { direction: 'down' } });
		expect(subscriptionEventsFor({ previous: record(), next: record(), eventType: 'customer.subscription.updated', invoice: null })).toEqual([]);
		expect(subscriptionEventsFor({ previous: record({ stripeSubscriptionId: 'sub_0', tier: 1 }), next: record(), eventType: 'customer.subscription.updated', invoice: null })).toEqual([]);
	});

	it('records the end of Premium once, with why it ended', () => {
		expect(subscriptionEventsFor({ previous: record({ cancelAtPeriodEnd: true }), next: record({ status: 'canceled', cancelAtPeriodEnd: true }), eventType: 'customer.subscription.deleted', invoice: null })).toEqual([
			{ name: 'subscription_cancelled', properties: { tier: 3, reason: 'seller' } },
		]);
		expect(subscriptionEventsFor({ previous: record({ status: 'canceled' }), next: record({ status: 'canceled' }), eventType: 'repair', invoice: null })).toEqual([]);
		expect(cancelReasonOf(record({ status: 'past_due' }))).toBe('payment_failed');
		expect(cancelReasonOf(record({ status: 'unpaid' }))).toBe('payment_failed');
		expect(cancelReasonOf(record({ cancelAtPeriodEnd: true }))).toBe('seller');
		// Sellers can only cancel at the period's end, so an immediate cancel came from an admin or the Stripe Dashboard.
		expect(cancelReasonOf(record())).toBe('admin');
	});

	it("records a failed renewal with Stripe's attempt number", () => {
		expect(subscriptionEventsFor({ previous: record(), next: record({ status: 'past_due' }), eventType: 'invoice.payment_failed', invoice: failedInvoice })).toEqual([
			{ name: 'subscription_payment_failed', properties: { tier: 3, attempt: 2 } },
		]);
		expect(subscriptionEventsFor({ previous: record(), next: record(), eventType: 'invoice.payment_failed', invoice: { ...failedInvoice, attempt_count: undefined } })[0]).toMatchObject({ properties: { attempt: 1 } });
	});
});
```

`worker/services/billing/events-analytics.test.ts`:

```ts
/** Billing's events reach PostHog only after billing_events records the Stripe event the first time. */
import { describe, expect, it } from 'vitest';
import { applySubscription, type BillingEventDeps } from './events';
import type { BillingAnalyticsEvent } from '../posthog/billing-events';
import type { StripeSubscription } from '../payments/stripe-client';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const START = Date.parse('2026-10-05T10:00:00Z') / 1000;
const END = Date.parse('2026-11-05T10:00:00Z') / 1000;
const SUBSCRIPTION = {
	id: 'sub_1',
	customer: 'cus_1',
	status: 'active',
	created: START,
	cancel_at_period_end: false,
	cancel_at: null,
	metadata: { estori_user_id: 'u1' },
	schedule: null,
	items: { data: [{ id: 'si_1', price: { id: 'price_t3' }, current_period_start: START, current_period_end: END }] },
} as StripeSubscription;
const TARGET = { subscriptionId: 'sub_1', expectedUserId: 'u1', invoice: null };

function harness(options: { failRecord?: boolean } = {}) {
	const recorded = new Set<string>();
	const tracked: Array<[string, BillingAnalyticsEvent[]]> = [];
	const deps: BillingEventDeps = {
		stripe: { retrieveSubscription: async () => SUBSCRIPTION },
		store: {
			eventSeen: async (eventId) => recorded.has(eventId),
			userOfCustomer: async () => 'u1',
			subscriptionOf: async () => null,
			sentNoticeKeys: async () => new Set<string>(),
			recordEvent: async (input) => {
				if (options.failRecord) throw new Error('D1 batch failed');
				recorded.add(input.event.id);
			},
		},
		tierOf: (price) => (price.id === 'price_t3' ? 3 : null),
		notify: async () => undefined,
		alert: async () => undefined,
		track: async (userId, events) => {
			tracked.push([userId, [...events]]);
		},
		nowMs: () => NOW,
	};
	return { deps, tracked };
}

describe('billing events to PostHog', () => {
	it('sends subscription_started once for a completed checkout, and nothing on the retry', async () => {
		const { deps, tracked } = harness();
		expect(await applySubscription(deps, { eventId: 'evt_1', eventType: 'checkout.session.completed', ...TARGET })).toBe('applied');
		expect(await applySubscription(deps, { eventId: 'evt_1', eventType: 'checkout.session.completed', ...TARGET })).toBe('duplicate');
		expect(tracked).toEqual([['u1', [{ name: 'subscription_started', properties: { tier: 3 } }]]]);
	});

	it('sends nothing when the event fails to record, so the retry is the one that counts', async () => {
		const { deps, tracked } = harness({ failRecord: true });
		await expect(applySubscription(deps, { eventId: 'evt_2', eventType: 'checkout.session.completed', ...TARGET })).rejects.toThrow('D1 batch failed');
		expect(tracked).toEqual([]);
	});
});
```

Adjust the fake's shapes to billing's actual `BillingEventDeps` and `StripeSubscription` if they differ. Keep the two assertions.

In billing's `credit-notices` test, add one case for each outcome:
- `reached` is called with `(use, 80)` when `claimAndSendNotice` answers `'sent'` for `credits_80`, and with `100` for `credits_100`;
- it isn't called when the answer is `'already-sent'` or `'not-sent'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/billing-events.test.ts worker/services/billing/events-analytics.test.ts worker/services/billing`
Expected: FAIL. `./billing-events` doesn't resolve, and `BillingEventDeps` has no `track`.

- [ ] **Step 3: Write `worker/services/posthog/billing-events.ts`**

```ts
/**
 * Billing's five events, from the subscription rows billing writes. Billing calls these only after it records the
 * Stripe event the first time, so a retry never counts twice.
 */

import type { BillingEventName, ServerEventProperties } from '../../../shared/types/analytics-events';
import type { SubscriptionRecord } from '../../database/schema';
import type { StripeInvoice } from '../payments/stripe-client';

export type BillingAnalyticsEvent = { [N in BillingEventName]: { name: N; properties: ServerEventProperties<N> } }[BillingEventName];

const LIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing']);

/** Sellers can only cancel at the period's end; an immediate cancel came from an admin or the Stripe Dashboard. */
export function cancelReasonOf(previous: SubscriptionRecord | null): 'seller' | 'payment_failed' | 'admin' {
	if (previous?.status === 'past_due' || previous?.status === 'unpaid') return 'payment_failed';
	if (previous?.cancelAtPeriodEnd) return 'seller';
	return 'admin';
}

export function subscriptionEventsFor(input: {
	previous: SubscriptionRecord | null;
	next: SubscriptionRecord;
	eventType: string;
	invoice: StripeInvoice | null;
}): BillingAnalyticsEvent[] {
	const { previous, next, eventType, invoice } = input;
	const events: BillingAnalyticsEvent[] = [];
	const live = LIVE_STATUSES.has(next.status);
	if (eventType === 'checkout.session.completed' && live && next.tier !== null) {
		events.push({ name: 'subscription_started', properties: { tier: next.tier } });
	}
	// Whichever event first stores the new tier sends it, normally customer.subscription.updated.
	const sameSubscription = previous !== null && previous.stripeSubscriptionId === next.stripeSubscriptionId;
	if (sameSubscription && live && previous.tier !== null && next.tier !== null && previous.tier !== next.tier) {
		events.push({ name: 'subscription_changed', properties: { from_tier: previous.tier, to_tier: next.tier, direction: next.tier > previous.tier ? 'up' : 'down' } });
	}
	if (next.status === 'canceled' && previous?.status !== 'canceled') {
		events.push({ name: 'subscription_cancelled', properties: { tier: next.tier ?? previous?.tier ?? null, reason: cancelReasonOf(previous) } });
	}
	if (eventType === 'invoice.payment_failed' && invoice) {
		events.push({ name: 'subscription_payment_failed', properties: { tier: next.tier, attempt: invoice.attempt_count ?? 1 } });
	}
	return events;
}
```

- [ ] **Step 4: Wire it into billing**

**`worker/services/billing/events.ts`:**
1. Add to `BillingEventDeps`: `track(userId: string, events: readonly BillingAnalyticsEvent[]): Promise<void>`.
2. In `applySubscription`, right after step 8's `recordEvent(...)` succeeds and before `deps.notify(...)`:

```ts
	await deps.track(claimed, subscriptionEventsFor({ previous: stored, next: incoming, eventType, invoice }));
```

   The `'duplicate'`, `'ignored'` and `'refused'` paths never reach it, and a failed `recordEvent` throws before it.

**`worker/services/billing/wiring.ts`,** in `billingEventDepsFromEnv`:

```ts
		// Plan and tier come from the row just written, so the person shows the new plan.
		track: async (userId, events) => {
			if (events.length === 0) return;
			const analytics = serverAnalytics(env);
			const person = await personUpdateOf(env, userId);
			for (const event of events) analytics.capture(event.name, userId, event.properties, person);
		},
```

**`worker/services/billing/credit-notices.ts`:**
1. Add `reached(use: CreditUse, threshold: 80 | 100): Promise<void>` to `CreditNoticeDeps`.
2. In `noticeCreditUse`, keep `claimAndSendNotice`'s answer, and send the event with the notice:

```ts
	const outcome = await claimAndSendNotice(deps, use.userId, { key, email: { kind, credits: use.limit, renewsAt: use.renewsAt } });
	// Sent once per period and threshold: the notice's claim in billing_notices keeps it to one.
	if (outcome === 'sent') await deps.reached(use, kind === 'credits_100' ? 100 : 80);
```

3. In `creditNoticeDepsFromEnv`, add:

```ts
		reached: async (use, threshold) => {
			const { plan, tier } = await accountPlanOf(env, use.userId);
			serverAnalytics(env).capture('credits_limit_reached', use.userId, { plan, tier, threshold }, await personUpdateOf(env, use.userId));
		},
```

**`worker/services/payments/stripe-client.ts`:** add `attempt_count?: number;` to `StripeInvoice`, with the comment "How many times Stripe has tried to collect this invoice".

`serverAnalytics`, `personUpdateOf` and `accountPlanOf` never throw, so `track` and `reached` never fail a webhook or a turn.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/billing-events.test.ts worker/services/billing/events-analytics.test.ts worker/services/billing worker/api/controllers/payments`
Expected: PASS, billing's webhook and repair tests included.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add worker/services/posthog/billing-events.ts worker/services/posthog/billing-events.test.ts worker/services/billing worker/services/payments/stripe-client.ts
git commit -m "feat(analytics): billing's subscription and credit events, sent once each after billing records them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: The heartbeat

**Files:**
- Create `worker/services/posthog/heartbeat.ts`. Test: `worker/services/posthog/heartbeat.test.ts`.
- Modify `worker/database/services/LiveStoreService.ts` (`newestLiveSlug`) and `worker/database/services/live-stores.sql.test.ts`.
- Modify `worker/index.ts` (`scheduled`) and `worker/services/posthog/entry-wiring.test.ts`.

**Interfaces:**
- **Consumes:** `serverAnalytics` from Task 2; `SYSTEM_DISTINCT_ID` from Task 1; `storeHostConfig` from `worker/services/live-stores/hosts.ts`.
- **Produces:**
  - `HEARTBEAT_CRON = '*/15 * * * *'`, `CHECK_TIMEOUT_MS = 10_000`;
  - `HeartbeatDeps`;
  - `runHeartbeatChecks(deps): Promise<ServerEventProperties<'heartbeat'>>`;
  - `runHeartbeat(cron: string, env: Env, fetchApp: (request: Request) => Promise<Response>): Promise<void>`;
  - `LiveStoreService.newestLiveSlug(): Promise<string | null>`.

- [ ] **Step 1: Write the failing tests**

`worker/services/posthog/heartbeat.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_CRON, runHeartbeatChecks, type HeartbeatDeps } from './heartbeat';

function deps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps & { requests: Request[] } {
	const requests: Request[] = [];
	return {
		requests,
		fetchApp: async (request) => {
			requests.push(request);
			return new URL(request.url).pathname === '/api/health' ? Response.json({ status: 'ok' }) : new Response('<html>', { status: 200 });
		},
		queryDatabase: async () => undefined,
		newestLiveSlug: async () => 'northwind-tea',
		appOrigin: 'https://estori.app',
		storesDomain: 'estori.shop',
		stagingKey: null,
		nowMs: () => 0,
		timeoutMs: 20,
		...overrides,
	};
}

describe('the heartbeat checks', () => {
	it('checks the app, the database and the newest live store through the Worker itself', async () => {
		const run = deps();
		expect(await runHeartbeatChecks(run)).toEqual({ healthy: true, app_ok: true, database_ok: true, stores_ok: true, failed: [], duration_ms: 0 });
		expect(run.requests.map((request) => request.url)).toEqual(['https://estori.app/api/health', 'https://northwind-tea.estori.shop/']);
	});

	it('names each failing check: a 500, an unhealthy answer, a database error, a hang', async () => {
		const failing = await runHeartbeatChecks(
			deps({
				fetchApp: async (request) => (new URL(request.url).pathname === '/api/health' ? Response.json({ status: 'degraded' }) : new Response('down', { status: 502 })),
				queryDatabase: async () => {
					throw new Error('D1 unavailable');
				},
			}),
		);
		expect(failing).toMatchObject({ healthy: false, app_ok: false, database_ok: false, stores_ok: false, failed: ['app', 'database', 'stores'] });
		const hanging = await runHeartbeatChecks(deps({ queryDatabase: () => new Promise(() => undefined) }));
		expect(hanging).toMatchObject({ healthy: false, database_ok: false, failed: ['database'] });
	});

	it('skips the store check without a stores domain or a live store', async () => {
		expect((await runHeartbeatChecks(deps({ storesDomain: null }))).stores_ok).toBeNull();
		expect((await runHeartbeatChecks(deps({ newestLiveSlug: async () => null }))).stores_ok).toBeNull();
	});

	it("sends staging's key, so the gate lets the in-process checks through", async () => {
		const run = deps({ stagingKey: 'staging-key' });
		await runHeartbeatChecks(run);
		expect(run.requests.every((request) => request.headers.get('x-estori-staging-key') === 'staging-key')).toBe(true);
	});
});

const configs = import.meta.glob<string>(['/wrangler.estori.jsonc', '/wrangler.estori-staging.jsonc'], { query: '?raw', import: 'default', eager: true });

describe('the heartbeat cron', () => {
	it('is a cron both Estori environments schedule', () => {
		expect(Object.keys(configs)).toHaveLength(2);
		for (const [path, text] of Object.entries(configs)) expect(text, path).toContain(`"${HEARTBEAT_CRON}"`);
	});
});
```

In `worker/database/services/live-stores.sql.test.ts`, add a test with two live stores and one offline, with different `published_at`. `newestLiveSlug()` answers the live one published last, and `null` when none is live. Follow the file's existing insert helpers.

In `entry-wiring.test.ts`, add:

```ts
	it('runs the heartbeat from the cron, checking the app through its own fetch handler', () => {
		expect(index).toContain('ctx.waitUntil(runHeartbeat(controller.cron, env, (request) => worker.fetch(request, env, ctx)));');
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/services/posthog/heartbeat.test.ts worker/services/posthog/entry-wiring.test.ts worker/database/services/live-stores.sql.test.ts`
Expected: FAIL. `./heartbeat` and `newestLiveSlug` don't exist yet.

- [ ] **Step 3: Write `worker/services/posthog/heartbeat.ts`**

```ts
/**
 * The uptime heartbeat. Every 15 minutes the cron checks the app, the database and the newest live store from inside
 * the Worker, then sends a `heartbeat` event. PostHog alerts when heartbeats stop or report a failing check.
 */

import { SYSTEM_DISTINCT_ID, type ServerEventProperties } from '../../../shared/types/analytics-events';
import { LiveStoreService } from '../../database/services/LiveStoreService';
import { createLogger } from '../../logger';
import { getProtocolForHost } from '../../utils/urls';
import { storeHostConfig } from '../live-stores/hosts';
import { serverAnalytics } from './analytics';

export const HEARTBEAT_CRON = '*/15 * * * *';
export const CHECK_TIMEOUT_MS = 10_000;
const STAGING_KEY_HEADER = 'x-estori-staging-key';

const logger = createLogger('Heartbeat');

export interface HeartbeatDeps {
	/** The Worker's own fetch handler, called in-process. */
	fetchApp(request: Request): Promise<Response>;
	queryDatabase(): Promise<void>;
	newestLiveSlug(): Promise<string | null>;
	appOrigin: string;
	storesDomain: string | null;
	/** Staging's gate key, sent so the in-process requests pass the gate. */
	stagingKey: string | null;
	nowMs(): number;
	timeoutMs?: number;
}

async function passes(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<boolean>((resolve) => {
		timer = setTimeout(() => resolve(false), timeoutMs);
	});
	try {
		return await Promise.race([check().catch(() => false), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

export async function runHeartbeatChecks(deps: HeartbeatDeps): Promise<ServerEventProperties<'heartbeat'>> {
	const startedMs = deps.nowMs();
	const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
	const headers: Record<string, string> = deps.stagingKey ? { [STAGING_KEY_HEADER]: deps.stagingKey } : {};
	const [appOk, databaseOk] = await Promise.all([
		passes(async () => {
			const response = await deps.fetchApp(new Request(`${deps.appOrigin}/api/health`, { headers }));
			if (response.status !== 200) return false;
			const body: unknown = await response.json();
			return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'ok';
		}, timeoutMs),
		passes(async () => {
			await deps.queryDatabase();
			return true;
		}, timeoutMs),
	]);
	let storesOk: boolean | null = null;
	const slug = deps.storesDomain ? await deps.newestLiveSlug().catch(() => null) : null;
	if (slug && deps.storesDomain) {
		const storeUrl = `${getProtocolForHost(deps.storesDomain)}://${slug}.${deps.storesDomain}/`;
		storesOk = await passes(async () => (await deps.fetchApp(new Request(storeUrl, { headers }))).status < 500, timeoutMs);
	}
	const failed = [...(appOk ? [] : ['app']), ...(databaseOk ? [] : ['database']), ...(storesOk === false ? ['stores'] : [])];
	return { healthy: failed.length === 0, app_ok: appOk, database_ok: databaseOk, stores_ok: storesOk, failed, duration_ms: deps.nowMs() - startedMs };
}

export async function runHeartbeat(cron: string, env: Env, fetchApp: (request: Request) => Promise<Response>): Promise<void> {
	if (cron !== HEARTBEAT_CRON) return;
	const properties = await runHeartbeatChecks({
		fetchApp,
		queryDatabase: async () => {
			await env.DB.prepare('SELECT 1').first();
		},
		newestLiveSlug: () => new LiveStoreService(env).newestLiveSlug(),
		appOrigin: `${getProtocolForHost(env.CUSTOM_DOMAIN)}://${env.CUSTOM_DOMAIN}`,
		storesDomain: storeHostConfig(env).storesDomain,
		stagingKey: env.STAGING_GATE_KEY?.trim() || null,
		nowMs: Date.now,
	});
	serverAnalytics(env).capture('heartbeat', SYSTEM_DISTINCT_ID, properties);
	if (!properties.healthy) logger.warn('A heartbeat check failed', { failed: properties.failed });
}
```

`getProtocolForHost` answers `http` only for localhost addresses, so the test's store URL is `https`.

- [ ] **Step 4: The live store lookup and the cron.**

In `LiveStoreService`:

```ts
    /** The live store published most recently, for the heartbeat's store check; null when none is live. */
    async newestLiveSlug(): Promise<string | null> {
        const row = await this.database
            .select({ slug: schema.liveStores.slug })
            .from(schema.liveStores)
            .where(eq(schema.liveStores.status, 'live'))
            .orderBy(desc(schema.liveStores.publishedAt))
            .limit(1)
            .get();
        return row?.slug ?? null;
    }
```

In `worker/index.ts`:
1. Import `runHeartbeat`.
2. Add it to the scheduled work in the request scope:

```ts
			ctx.waitUntil(runHeartbeat(controller.cron, env, (request) => worker.fetch(request, env, ctx)));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/services/posthog/heartbeat.test.ts worker/services/posthog/entry-wiring.test.ts worker/database/services/live-stores.sql.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/services/posthog/heartbeat.ts worker/services/posthog/heartbeat.test.ts worker/services/posthog/entry-wiring.test.ts worker/database/services/LiveStoreService.ts worker/database/services/live-stores.sql.test.ts worker/index.ts
git commit -m "feat(monitoring): a 15 minute heartbeat that checks the app, database and a live store from inside the worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Source maps from CI

**Files:**
- Add the dev dependency, pinned to an exact version: `bun add -d -E @posthog/cli`.
- Create `scripts/posthog-sourcemaps.ts`. Test: `scripts/posthog-sourcemaps.test.ts`.
- Modify `package.json` (`build`).
- Modify `vite.config.ts` (hidden client maps).
- Modify `.github/workflows/deploy-estori-reusable.yml` (deploy step env).

**Interfaces:**
- **Consumes:** nothing.
- **Produces:**
  - `ASSETS_DIR = 'dist/client/assets'`;
  - `CLI_TOKEN_VAR = 'POSTHOG_CLI_TOKEN'` and `CLI_PROJECT_VAR = 'POSTHOG_CLI_ENV_ID'`: the variables the pinned CLI reads, confirmed in Step 4;
  - `uploadCommands(env: Record<string, string | undefined>, assetsDir: string): string[][]`;
  - `isSourceMap(file: string): boolean`.

- [ ] **Step 1: Write the failing test** (`scripts/posthog-sourcemaps.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { CLI_PROJECT_VAR, CLI_TOKEN_VAR, isSourceMap, uploadCommands } from './posthog-sourcemaps';

const packageJson = import.meta.glob<string>(['/package.json'], { query: '?raw', import: 'default', eager: true })['/package.json'] ?? '';

describe('source maps for PostHog', () => {
	it("uploads only with both of the CLI's credentials, injecting chunk ids before uploading", () => {
		expect(uploadCommands({}, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1' }, 'dist/client/assets')).toEqual([]);
		expect(uploadCommands({ [CLI_TOKEN_VAR]: 'phx_1', [CLI_PROJECT_VAR]: '123' }, 'dist/client/assets')).toEqual([
			['sourcemap', 'inject', '--directory', 'dist/client/assets'],
			['sourcemap', 'upload', '--directory', 'dist/client/assets', '--release-name', 'estori'],
		]);
	});

	it('deletes maps and nothing else', () => {
		expect(isSourceMap('assets/index-abc.js.map')).toBe(true);
		expect(isSourceMap('assets/index-abc.js')).toBe(false);
		expect(isSourceMap('assets/sitemap.xml')).toBe(false);
	});

	it('runs after every build, so maps are never deployed', () => {
		expect(packageJson).toContain('"build": "bun run --cwd space build && vite build && bun scripts/posthog-sourcemaps.ts"');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- scripts/posthog-sourcemaps.test.ts`
Expected: FAIL, "Failed to resolve import ./posthog-sourcemaps".

- [ ] **Step 3: Write `scripts/posthog-sourcemaps.ts`**

```ts
/**
 * After the build: uploads the browser bundle's source maps to PostHog when CI has its credentials, then deletes every
 * map, so none is ever served. Without credentials (local builds, CI checks) it only deletes them. A failed upload
 * warns and never blocks a deploy.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSETS_DIR = 'dist/client/assets';
/** The personal API key and project id variables the pinned @posthog/cli reads; the deploy workflow maps GitHub's names to them. */
export const CLI_TOKEN_VAR = 'POSTHOG_CLI_TOKEN';
export const CLI_PROJECT_VAR = 'POSTHOG_CLI_ENV_ID';

export function uploadCommands(env: Record<string, string | undefined>, assetsDir: string): string[][] {
	if (!env[CLI_TOKEN_VAR] || !env[CLI_PROJECT_VAR]) return [];
	return [
		['sourcemap', 'inject', '--directory', assetsDir],
		['sourcemap', 'upload', '--directory', assetsDir, '--release-name', 'estori'],
	];
}

export function isSourceMap(file: string): boolean {
	return file.endsWith('.map');
}

async function main(): Promise<void> {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const clientDir = path.join(root, 'dist', 'client');
	// Loaded here, since the Workers test pool that tests this file has no child processes or file system.
	const { spawnSync } = await import('node:child_process');
	const { readdirSync, rmSync } = await import('node:fs');
	const cli = path.join(root, 'node_modules', '.bin', 'posthog-cli');
	for (const args of uploadCommands(process.env, path.join(root, ASSETS_DIR))) {
		const run = spawnSync(cli, args, { stdio: 'inherit', env: process.env });
		if (run.status !== 0) {
			console.warn(`posthog-cli ${args.slice(0, 2).join(' ')} failed; deploying without uploaded source maps`);
			break;
		}
	}
	const maps = readdirSync(clientDir, { recursive: true, encoding: 'utf8' }).filter(isSourceMap);
	for (const map of maps) rmSync(path.join(clientDir, map));
	console.log(`Source maps: deleted ${maps.length} from dist/client`);
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('posthog-sourcemaps.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
```

- [ ] **Step 4: Wire it in**
- **`package.json`:** the `build` script becomes `"bun run --cwd space build && vite build && bun scripts/posthog-sourcemaps.ts"`.
- **The CLI:**
  1. Run `bun add -d -E @posthog/cli`, which pins the exact version. Then run `node_modules/.bin/posthog-cli --version`. If that fails, Bun skipped the package's install script: add `"trustedDependencies": ["@posthog/cli"]` to `package.json` and install again.
  2. Find the variable names this version reads for the personal API key and the project, in `node_modules/.bin/posthog-cli sourcemap upload --help` and the package's README. Versions known so far read `POSTHOG_CLI_TOKEN` and `POSTHOG_CLI_ENV_ID`; PostHog's docs page names `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID`.
  3. If the pinned version reads other names, change `CLI_TOKEN_VAR` and `CLI_PROJECT_VAR`, the test, and the workflow mapping below to match. Record the version and the names in the commit message.
- **`vite.config.ts`:** replace the commented-out `build` block with:

```ts
	environments: {
		// Hidden maps for PostHog error tracking; uploaded and deleted after the build (scripts/posthog-sourcemaps.ts).
		client: { build: { sourcemap: 'hidden' } },
	},
```

- **`.github/workflows/deploy-estori-reusable.yml`:** add to the "Deploy via deploy script" step's `env`. The GitHub names stay as the owner sets them (spec section 16), mapped onto the CLI's own:

```yaml
          # Uploads the browser's source maps to PostHog during the build; without them the maps are only deleted.
          # The left side is what the pinned @posthog/cli reads (scripts/posthog-sourcemaps.ts).
          POSTHOG_CLI_TOKEN: ${{ secrets.POSTHOG_CLI_API_KEY }}
          POSTHOG_CLI_ENV_ID: ${{ vars.POSTHOG_CLI_PROJECT_ID }}
```

- [ ] **Step 5: Verify**

Run: `rtk proxy bun run test -- scripts/posthog-sourcemaps.test.ts`
Expected: PASS.

Run: `npx vite build && ls dist/client/assets/*.js.map | head -3`
Expected: map files are listed. The client build makes them, and the JS has no `sourceMappingURL` comment (`grep -L sourceMappingURL dist/client/assets/*.js` lists every JS file).

Run: `bun run build && find dist -name '*.map' | wc -l`
Expected: `0`. The script deleted them, and printed "Source maps: deleted N from dist/client".

Then check the Worker bundle under `dist/` (not `dist/client`) is not minified. Function names should read as in the source, which is what makes Worker stacks readable without maps (spec section 7). If it is minified, stop and report it.

- [ ] **Step 6: Commit**

```bash
git add scripts/posthog-sourcemaps.ts scripts/posthog-sourcemaps.test.ts package.json bun.lock vite.config.ts .github/workflows/deploy-estori-reusable.yml
git commit -m "build(errors): upload hidden browser source maps to posthog from deploys and never serve them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: The flags admin page and the flag sync script

**Files:**
- Modify `worker/api/controllers/telemetry/controller.ts` (`adminFlags`, `adminFlagRows`) and `worker/api/routes/telemetryRoutes.ts` (`GET /api/admin/flags`, admin only). Test: `worker/api/controllers/telemetry/admin-flags.test.ts`.
- Create `src/routes/admin/flags.tsx`. Modify `src/routes.tsx`, `src/hooks/use-telemetry.ts`, `src/lib/api-client.ts` and `src/lib/query-keys.ts`. Test: `src/routes/admin-flags-guard.test.ts`.
- Create `scripts/posthog-sync-flags.ts`. Test: `scripts/posthog-sync-flags.test.ts`.

**Interfaces:**
- **Consumes:** `flagsFor` and `FlagEvaluation` from Task 5; `AdminFlagsData` and `AdminFlagRow` from Task 1.
- **Produces:**
  - `adminFlagRows(evaluation: FlagEvaluation): AdminFlagRow[]`;
  - `TelemetryController.adminFlags`;
  - `apiClient.getAdminFlags(userId: string | null)`;
  - `useAdminFlags(userId: string | null)`;
  - `queryKeys.account.adminFlags(userId)`;
  - `flagsToCreate(existingKeys: ReadonlySet<string>): NewPostHogFlag[]`.

- [ ] **Step 1: Write the failing tests**

`worker/api/controllers/telemetry/admin-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TelemetryController, adminFlagRows } from './controller';
import type { RouteContext } from '../../types/route-context';

describe('the flags admin view', () => {
	it('lists every registry flag with its value and whether PostHog answered for it', () => {
		const rows = adminFlagRows({
			values: { billing: true, 'store-drafts-paused': false, 'live-store-payments-paused': false, 'catalog-paused': true, 'session-replay-paused': false },
			source: 'posthog',
			inPostHog: ['billing', 'catalog-paused'],
		});
		expect(rows.map((row) => row.key)).toEqual(['billing', 'store-drafts-paused', 'live-store-payments-paused', 'catalog-paused', 'session-replay-paused']);
		expect(rows[0]).toEqual({
			key: 'billing',
			description: 'Plans, subscriptions and the billing page. Also on with BILLING=on, or for a user in BILLING_USER_IDS.',
			kind: 'rollout',
			clientVisible: true,
			value: true,
			inPostHog: true,
		});
		expect(rows[2]).toMatchObject({ key: 'live-store-payments-paused', kind: 'pause', clientVisible: false, value: false, inPostHog: false });
		expect(rows[3]).toMatchObject({ key: 'catalog-paused', kind: 'pause', value: true, inPostHog: true });
	});

	it("evaluates for the user asked about, or the admin, and says when PostHog isn't set up", async () => {
		const context = { user: { id: 'admin_1' }, queryParams: new URLSearchParams('userId=%20seller_9%20') } as unknown as RouteContext;
		const response = await TelemetryController.adminFlags(new Request('https://estori.app/api/admin/flags?userId=seller_9'), { ENVIRONMENT: 'dev' } as unknown as Env, {} as ExecutionContext, context);
		expect((await response.json()).data).toMatchObject({ userId: 'seller_9', source: 'off' });
		const mine = await TelemetryController.adminFlags(new Request('https://estori.app/api/admin/flags'), { ENVIRONMENT: 'dev' } as unknown as Env, {} as ExecutionContext, { user: { id: 'admin_1' }, queryParams: new URLSearchParams() } as unknown as RouteContext);
		expect((await mine.json()).data.userId).toBe('admin_1');
	});
});
```

`scripts/posthog-sync-flags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flagsToCreate } from './posthog-sync-flags';

describe('syncing flags to PostHog', () => {
	it('creates only the missing flags, every one at 0%, so nothing is rolled out or paused until someone raises it', () => {
		const created = flagsToCreate(new Set(['billing', 'some-other-flag']));
		expect(created.map((flag) => [flag.key, flag.filters.groups[0].rollout_percentage])).toEqual([
			['store-drafts-paused', 0],
			['live-store-payments-paused', 0],
			['catalog-paused', 0],
			['session-replay-paused', 0],
		]);
		expect(created[0]).toEqual({
			key: 'store-drafts-paused',
			name: 'Pauses starting new drafts of a store. Drafts that exist keep working.',
			active: true,
			filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
		});
	});

	it('creates nothing when every flag exists', () => {
		expect(flagsToCreate(new Set(['billing', 'store-drafts-paused', 'live-store-payments-paused', 'catalog-paused', 'session-replay-paused']))).toEqual([]);
	});
});
```

`src/routes/admin-flags-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/admin/flags.tsx', '/src/routes.tsx'], { query: '?raw', import: 'default', eager: true });

describe('the flags admin page', () => {
	const page = sources['/src/routes/admin/flags.tsx'] ?? '';

	it('is behind sign-in at /admin/flags', () => {
		expect(sources['/src/routes.tsx']).toMatch(/path: 'admin\/flags',\s*element: \(\s*<ProtectedRoute>\s*<AdminFlagsPage \/>/);
	});

	it('shows values only, and sends edits to PostHog', () => {
		expect(page).toContain('Change flags in PostHog.');
		expect(page).not.toMatch(/useMutation|onCheckedChange/);
	});

	it("says when every flag is off, and why", () => {
		expect(page).toContain("PostHog isn't set up on this deployment, so every flag is off: nothing is rolled out or paused.");
		expect(page).toContain("PostHog didn't answer, so every flag is off: nothing is rolled out or paused.");
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/api/controllers/telemetry/admin-flags.test.ts scripts/posthog-sync-flags.test.ts src/routes/admin-flags-guard.test.ts`
Expected: FAIL. `adminFlagRows`, the script and the page don't exist yet.

- [ ] **Step 3: The endpoint.** In the telemetry controller:

```ts
/** Every registry flag beside its live value. */
export function adminFlagRows(evaluation: FlagEvaluation): AdminFlagRow[] {
	return FLAG_KEYS.map((key) => ({
		key,
		description: FEATURE_FLAGS[key].description,
		kind: FEATURE_FLAGS[key].kind,
		clientVisible: FEATURE_FLAGS[key].clientVisible,
		value: evaluation.values[key],
		inPostHog: evaluation.inPostHog.includes(key),
	}));
}
```

```ts
	/** GET /api/admin/flags?userId=: every flag's live value for that user, or for the admin asking. Read-only. */
	static async adminFlags(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<AdminFlagsData>>> {
		const userId = context.queryParams.get('userId')?.trim().slice(0, 64) || context.user?.id;
		if (!userId) return this.createErrorResponse<AdminFlagsData>('Unauthorized', 401);
		const evaluation = await flagsFor(env, userId);
		return this.createSuccessResponse({ userId, source: evaluation.source, flags: adminFlagRows(evaluation) });
	}
```

In `telemetryRoutes.ts`:

```ts
    app.get('/api/admin/flags', setAuthLevel(AuthConfig.admin), adaptController(TelemetryController, TelemetryController.adminFlags));
```

- [ ] **Step 4: The page**

- **`src/lib/query-keys.ts`,** under `account`:

```ts
		/** The flags admin view, per user looked up: never persisted. */
		adminFlags: (userId: string | null) => [...queryKeys.account.all, 'admin-flags', userId ?? 'me'] as const,
```

- **`src/lib/api-client.ts`:**

```ts
	/** Every flag's live value for a user, or for the admin; quiet because non-admins get 403. */
	async getAdminFlags(userId: string | null): Promise<ApiResponse<AdminFlagsData>> {
		const query = userId ? `?userId=${encodeURIComponent(userId)}` : '';
		return this.request<AdminFlagsData>(`/api/admin/flags${query}`, {}, true);
	}
```

- **`src/hooks/use-telemetry.ts`:**

```ts
export function useAdminFlags(userId: string | null) {
	return useQuery({
		queryKey: queryKeys.account.adminFlags(userId),
		queryFn: () => unwrap(apiClient.getAdminFlags(userId), "Couldn't load flags"),
		retry: false,
	});
}
```

- **`src/routes/admin/flags.tsx`:** follow `src/routes/admin/early-access.tsx` for the layout, `<title>`, loading and the 403 "Admins only" state. The page has:
  - a "Reviews" link back;
  - the heading "Feature flags";
  - the intro "Each flag's live value for one user. Change flags in PostHog.";
  - a form with an `Input` (placeholder "User id, or blank for you") and a "Show flags" `Button`. Submitting sets the user id, trimmed, or `null` when blank.
  - When `data.source` is `'off'`, the line "PostHog isn't set up on this deployment, so every flag is off: nothing is rolled out or paused."
  - When it is `'defaults'`, the line "PostHog didn't answer, so every flag is off: nothing is rolled out or paused."
  - The note "Every flag is off unless PostHog turns it on. Pause something by raising its pause flag to 100%."
  - A table with the caption "Feature flags for {data.userId}" and these columns:
    - Flag (the key, in `font-mono`);
    - What it does (the description);
    - Kind ("Rollout" or "Pause");
    - In the browser ("Yes" or "No");
    - Value: "On" or "Off" for a rollout, "Paused" or "Not paused" for a pause flag;
    - In PostHog ("Yes", or "No, so off").
- **`src/routes.tsx`:** import the page, and add after the `admin/catalog-orders/:id` route:

```tsx
					{
						path: 'admin/flags',
						element: (
							<ProtectedRoute>
								<AdminFlagsPage />
							</ProtectedRoute>
						),
					},
```

- [ ] **Step 5: Write `scripts/posthog-sync-flags.ts`**

```ts
/**
 * Creates the registry's flags that a PostHog project lacks, every one at 0%: nothing rolled out, nothing paused.
 * Pausing means raising a pause flag to 100% in PostHog. Existing flags are never changed; edits happen in PostHog.
 * Run once per project:
 *   POSTHOG_PERSONAL_API_KEY=... POSTHOG_PROJECT_ID=... bun scripts/posthog-sync-flags.ts
 */

import { FEATURE_FLAGS, FLAG_KEYS, isFlagKey, type FlagKey } from '../shared/types/feature-flags';

const API_ORIGIN = 'https://us.posthog.com';

export interface NewPostHogFlag {
	key: FlagKey;
	/** PostHog shows a flag's name as its description. */
	name: string;
	active: boolean;
	filters: { groups: Array<{ properties: never[]; rollout_percentage: number }> };
}

export function flagsToCreate(existingKeys: ReadonlySet<string>): NewPostHogFlag[] {
	return FLAG_KEYS.filter((key) => !existingKeys.has(key)).map((key) => ({
		key,
		name: FEATURE_FLAGS[key].description,
		active: true,
		filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
	}));
}

async function main(): Promise<void> {
	const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
	const projectId = process.env.POSTHOG_PROJECT_ID;
	if (!apiKey || !projectId) throw new Error('Set POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID');
	const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
	const flagsUrl = `${API_ORIGIN}/api/projects/${encodeURIComponent(projectId)}/feature_flags/`;
	const listed = await fetch(`${flagsUrl}?limit=200`, { headers });
	if (!listed.ok) throw new Error(`Listing flags failed: ${listed.status}`);
	const existing = new Set(((await listed.json()) as { results: Array<{ key: string }> }).results.map((flag) => flag.key));
	for (const flag of flagsToCreate(existing)) {
		const created = await fetch(flagsUrl, { method: 'POST', headers, body: JSON.stringify(flag) });
		if (!created.ok) throw new Error(`Creating ${flag.key} failed: ${created.status} ${await created.text()}`);
		console.log(`Created ${flag.key} at ${flag.filters.groups[0].rollout_percentage}%`);
	}
	console.log(`Already in PostHog, left as they are: ${[...existing].filter(isFlagKey).join(', ') || 'none'}`);
}

// process.argv can be undefined in the Workers test pool, so guard each access.
if (process.argv?.[1]?.endsWith('posthog-sync-flags.ts')) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/api/controllers/telemetry scripts/posthog-sync-flags.test.ts src/routes/admin-flags-guard.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add worker/api/controllers/telemetry worker/api/routes/telemetryRoutes.ts src/routes/admin/flags.tsx src/routes.tsx src/routes/admin-flags-guard.test.ts src/hooks/use-telemetry.ts src/lib/api-client.ts src/lib/query-keys.ts scripts/posthog-sync-flags.ts scripts/posthog-sync-flags.test.ts
git commit -m "feat(flags): a read-only flags page for admins and a script that creates missing flags in posthog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: The privacy policy

**Files:**
- Modify `src/content/legal/privacy.md`.
- Test: `src/content/legal/legal-documents.test.ts`.

**Interfaces:**
- **Consumes:** nothing.
- **Produces:** the policy text below. It is exact copy, fixed by spec section 10. The version stays `2026-10-16`, so nobody is asked to agree again.

- [ ] **Step 1: Write the failing test.** Add to `legal-documents.test.ts`:

```ts
	it('names PostHog for analytics, says no email or name goes to it, and how to turn it off', () => {
		const privacy = LEGAL_DOCUMENTS.privacy.body;
		expect(privacy).toContain('**Usage information.**');
		expect(privacy).toContain("We record layouts and clicks, not what's written on the page or what you type.");
		expect(privacy).toContain('without the part of the address after a question mark');
		expect(privacy).toContain('**PostHog** (hosted in the United States)');
		expect(privacy).toContain("We don't send it your email address or name.");
		expect(privacy).toContain("We use PostHog's analytics cookie and browser storage on estori.app");
		expect(privacy).toContain("We don't use advertising cookies.");
		expect(privacy).not.toContain("We don't use advertising or analytics cookies.");
		expect(privacy).toContain("Stores built with Estori don't load Estori's analytics.");
		expect(privacy).toContain('You can turn analytics off at any time with the Analytics setting in Settings.');
		expect(privacy).toContain('we still count the AI credits your builds use, without anything that identifies you');
		expect(privacy).toContain('Global Privacy Control');
		expect(LEGAL_DOCUMENTS.privacy.version).toBe(TERMS_VERSION);
	});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- src/content/legal/legal-documents.test.ts`
Expected: FAIL on the first missing phrase.

- [ ] **Step 3: Edit `src/content/legal/privacy.md`**
1. **The header:** set `updated:` to the date the pull request opens, written like `October 20, 2026`. Leave `version:` alone.
2. **Section 1:** after the "**Site views.**" paragraph, add:

```markdown
**Usage information.** On estori.app we collect the pages you view, without the part of the address after a question mark, where you click, your device and browser, your approximate location (country and region, from your IP address), errors the Service runs into, and recordings of some sessions. We record layouts and clicks, not what's written on the page or what you type. Recordings skip your orders, shopper emails, profile and payments setup, settings and billing, and admin pages, and they never show the preview of your store. We link this to your account by its id, never by your email address or name. Section 4 says how to turn it off.
```

3. **Section 3:** after the Cloudflare bullet, add:

```markdown
- **PostHog** (hosted in the United States): product analytics, session recordings, error reports and feature flags for estori.app. PostHog receives the usage information in section 1, linked to your account's id. We don't send it your email address or name.
```

4. **Section 4:**
   - change "We use only the cookies the Service needs to work:" to "We use the cookies the Service needs to work:";
   - replace the last sentence, "We don't use advertising or analytics cookies.", with:

```markdown
We use PostHog's analytics cookie and browser storage on estori.app to measure how the Service is used, as section 1 describes. We don't use advertising cookies. To turn analytics off, use the Analytics setting in Settings, or turn on Global Privacy Control in your browser. Stores built with Estori don't load Estori's analytics.
```

5. **Section 6:** after "You can update your account information in Settings.", add:

```markdown
You can turn analytics off at any time with the Analytics setting in Settings. We also treat a Global Privacy Control signal from your browser as a request to turn analytics off, and keep it off for your account. With analytics off, we still count the AI credits your builds use, without anything that identifies you, to manage what the Service costs to run.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk proxy bun run test -- src/content/legal src/lib/legal-document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/legal/privacy.md src/content/legal/legal-documents.test.ts
git commit -m "docs(legal): the privacy policy names posthog, what it gets, and how to turn analytics off

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Local check, CI steps and pull request 1

**Files:** none new. Fix whatever the checks find, each fix with its own failing test first.

- [ ] **Step 1: Restart the dev server on port 8100.** Run it the way this checkout always runs it. Sign in to localhost with the test account from `.superpowers/realtest/local-accounts.md`. Never paste its password into chat.

- [ ] **Step 2: Without a PostHog key** (the default):
  - `curl -s localhost:8100/api/telemetry/config` answers `"posthog":null` and `"replayPaused":false`.
  - The browser's network panel shows no request to `/ingest`. The app works as before: drafts, the catalog and checkout behave as on main, since nothing is paused.
  - Settings shows the Analytics card, and the switch saves. With the browser's GPC on, the card says so and the switch is disabled.
  - `/admin/flags`, as the admin, says "PostHog isn't set up on this deployment, so every flag is off: nothing is rolled out or paused."
  - **Billing's switches:** with `BILLING=on` in `.dev.vars`, `/admin/flags` shows `billing` on; with only your user id in `BILLING_USER_IDS`, it's on for you and off for another id.
  - **Pausing drafts:** with `FEATURE_FLAG_OVERRIDES="store-drafts-paused=on"` in `.dev.vars` and the server restarted:
    - a store with only Main shows no draft switcher;
    - a store with more drafts shows the switcher without "New draft";
    - `POST /api/stores/:id/drafts` answers 403.
  - **Pausing the catalog:** with `catalog-paused=on`, the sidebar has no Catalog link, `/catalog` says "The catalog is paused", and the AI's catalog search answers that it is paused.

- [ ] **Step 3: With the staging project's key** (only if the owner gave one):
  1. Set `POSTHOG_PROJECT_KEY` in `.dev.vars`. Never print it, never paste it.
  2. Restart.
  3. Check:
     - `/ingest/e/` and `/ingest/static/...` answer 200, `recorder.js` included;
     - the request headers PostHog would see carry no cookie;
     - a pageview and a sign-in appear in the staging project's activity, with `environment: dev`;
     - opening `/reset-password?token=anything` sends a pageview whose `$current_url` ends at `/reset-password`.
  4. Remove the key afterwards.

- [ ] **Step 4: The CI steps**

```bash
npx eslint .
```

```bash
bun run typecheck
```

```bash
bun run build
```

```bash
bun run bundle:check
```

```bash
bun run test
```

Expected: all pass. Report the shard totals.

- [ ] **Step 5: Final review.** Run the fresh whole-branch review the execution skill names, with this plan's Review Focus. Fix its Critical and Important findings, each with a failing test first.

- [ ] **Step 6: Open pull request 1 into `main`.**
  1. Push `feat/posthog`.
  2. The description covers:
     - what was built;
     - the spec's section 15 table, by link;
     - the owner steps, spec section 16;
     - that nothing is sent and every flag is off until `POSTHOG_PROJECT_KEY` is set, and billing keeps `BILLING` and `BILLING_USER_IDS`;
     - the local check results and the test totals.
  3. End the description with "Generated with [Claude Code](https://claude.com/claude-code)".
  4. Don't merge.

### Task 18: Staging verification

**Preconditions:**
- Pull request 1 is merged, so main deployed to staging.
- The owner finished spec section 16 steps 1–7 for the staging project, including the flag sync and the session replay trigger groups.

**Files:** none. Record each result for pull request 2's description. A failure gets a fix with a failing test first, in its own pull request.

- [ ] **Step 1: Events.** Unlock `https://staging.estori.app` with the staging key. With the owner, in a fresh browser profile:
  1. Sign up with a new address on the allowlisted domain.
  2. Start a store.
  3. Publish it.
  4. In the staging project's activity, check that each of these arrives with the new user's id and `environment: staging`:
     - `$pageview`s;
     - `account_created`, with `method: password`;
     - `build_started` and `build_finished`, with `credits_used` above 0 and `steps`;
     - `store_published`, with `first_publish: true`.
  5. Open the person: `plan`, `tier`, `seller_level`, `has_live_store` and `signup_date` are set, and there is no email or name.
  6. Every event's `$current_url` has no query. Open `/chat/new?query=test` and check its pageview ends at `/chat/new`.
  7. **Billing,** when billing is on for the test account on staging:
     - buy Premium tier 1 in Stripe test mode: one `subscription_started` with `tier: 1`, and the person's `plan` becomes `premium`;
     - resend the checkout event from the Stripe Dashboard: no second `subscription_started`.

- [ ] **Step 2: Replay.**
  1. Raise the 20% trigger group to 100% for this check.
  2. Type into the build box, chat with the AI, open Orders, then open Settings.
  3. The replay shows layouts and clicks only:
     - no page text and no typed text;
     - the preview is a blocked box;
     - nothing from `/orders` or `/settings`.
  4. In the replay's page addresses there's no query.
  5. Put the group back to 20%.

- [ ] **Step 3: Errors.**
  1. In the browser console on staging, run `setTimeout(() => { throw new Error('posthog staging check') })`. The exception arrives in error tracking, its stack pointing at a source file name from `src/`, not a minified chunk.
  2. In the Cloudflare dashboard, open `estori-staging`'s Workers Logs and filter to `level: error` since the deploy. Each distinct error has a `$exception` in PostHog with the same `component`, at most one a minute. If no error was logged, record "no Worker error observed"; Task 4's tests cover the path.

- [ ] **Step 4: A pause flag.**
  1. Raise `catalog-paused` to 100% in the staging project.
  2. Within a minute, after a reload, the Catalog link is gone, `/catalog` says it is paused, and the AI's catalog search answers paused.
  3. Disable the flag in PostHog, not just lower it. Within a minute the catalog is back: a disabled flag pauses nothing.
  4. Put it back to active at 0%.

- [ ] **Step 5: An alert.**
  1. In the "Heartbeat missing" alert, raise the threshold to "less than 100".
  2. Wait for its next hourly check. The owner gets the email.
  3. Put it back to 2.

- [ ] **Step 6: The setting.**
  1. Turn analytics off in Settings.
  2. Ask the AI for a change, then publish again.
  3. No new event arrives for that user, from the browser or the server.
  4. The one exception: `build_finished` arrives under `opted-out` with only `credits_used`, and no person.

### Task 19: Remove Sentry (pull request 2)

**Preconditions:** Task 18 passed. Branch `chore/remove-sentry` from main.

**Files:**
- **Delete:**
  - `worker/observability/sentry.ts`;
  - `worker/api/controllers/sentry/` and `worker/api/routes/sentryRoutes.ts`;
  - `src/utils/sentry.ts` and `src/hooks/useSentryUser.ts`;
  - `worker/agents/tools/toolkit/feedback.ts`;
  - `worker/database/database-instrumentation.test.ts`.
- **Create:**
  - `worker/observability/security-events.ts`;
  - `worker/services/posthog/no-sentry-guard.test.ts`.
- **Modify:**
  - `worker/api/routes/index.ts`, `worker/logger/core.ts`, `worker/database/database.ts`, `worker/middleware/auth/routeAuth.ts`;
  - `worker/services/csrf/CsrfService.ts`, `worker/services/rate-limit/rateLimits.ts`, `worker/agents/tools/customTools.ts`;
  - `worker/index.ts`, `worker/app.ts`, `worker/types/env.d.ts`;
  - `scripts/deploy.ts`, `scripts/setup.ts`, `vite.config.ts`;
  - `src/main.tsx`, `src/contexts/auth-context.tsx`, `src/components/ErrorBoundary.tsx`;
  - `package.json` and `bun.lock`.
- **Leave alone:** `.github/workflows/deploy-staging.yml` and `deploy-release-live.yml`. They are upstream's, and the staging spec left them untouched.

**Interfaces:**
- **Consumes:** `captureBrowserException` from Task 7.
- **Produces:** `logSecurityEvent(type: SecurityEventType, data?: Record<string, unknown>): void`.

- [ ] **Step 1: Write the failing guard** (`worker/services/posthog/no-sentry-guard.test.ts`)

```ts
import { describe, expect, it } from 'vitest';

const touched = import.meta.glob<string>(
	[
		'/package.json',
		'/vite.config.ts',
		'/scripts/deploy.ts',
		'/scripts/setup.ts',
		'/worker/index.ts',
		'/worker/app.ts',
		'/worker/types/env.d.ts',
		'/worker/logger/core.ts',
		'/worker/database/database.ts',
		'/worker/middleware/auth/routeAuth.ts',
		'/worker/services/csrf/CsrfService.ts',
		'/worker/services/rate-limit/rateLimits.ts',
		'/worker/api/routes/index.ts',
		'/worker/agents/tools/customTools.ts',
		'/src/main.tsx',
		'/src/contexts/auth-context.tsx',
		'/src/components/ErrorBoundary.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const deleted = import.meta.glob([
	'/worker/observability/sentry.ts',
	'/worker/api/routes/sentryRoutes.ts',
	'/worker/api/controllers/sentry/*.ts',
	'/src/utils/sentry.ts',
	'/src/hooks/useSentryUser.ts',
	'/worker/agents/tools/toolkit/feedback.ts',
]);

describe('Sentry is gone, with PostHog in its place', () => {
	it('leaves no Sentry import, call, secret or package behind', () => {
		expect(Object.keys(touched)).toHaveLength(17);
		for (const [path, text] of Object.entries(touched)) expect(text, path).not.toMatch(/sentry/i);
	});

	it('deletes the Sentry-only files', () => {
		expect(Object.keys(deleted)).toEqual([]);
	});

	it('reports what the error boundary catches to PostHog', () => {
		expect(touched['/src/components/ErrorBoundary.tsx']).toMatch(/componentDidCatch\(error: Error\): void \{\s*captureBrowserException\(error\);/);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- worker/services/posthog/no-sentry-guard.test.ts`
Expected: FAIL. Every file still mentions Sentry.

- [ ] **Step 3: Remove Sentry**
1. Run `bun remove @sentry/cloudflare @sentry/react`.
2. Delete the files listed above, and remove `setupSentryRoutes` from `worker/api/routes/index.ts`.
3. **`worker/logger/core.ts`:** drop the Sentry import and the `Sentry.captureException` line. `reportServerError` stays.
4. **`worker/database/database.ts`:**
   - drop the Sentry import, `instrumentedBindings` and `instrumentOnce`;
   - the constructor uses `env.DB` directly: `this.d1 = env.DB; this.db = drizzle(env.DB, { schema });`.
5. **`worker/middleware/auth/routeAuth.ts`:** drop the import and both `Sentry.setUser(...)` lines.
6. **Security events:** create `worker/observability/security-events.ts`:

```ts
/** Security events (CSRF violations, rate limits): structured warnings in Workers Logs. */

import { createLogger } from '../logger';

export type SecurityEventType = 'csrf_violation' | 'rate_limit_exceeded' | 'auth_violation' | 'oauth_state_mismatch' | 'jwt_invalid';

const logger = createLogger('SecurityEvent');

export function logSecurityEvent(type: SecurityEventType, data: Record<string, unknown> = {}): void {
	logger.warn(`Security event: ${type}`, { securityEvent: type, ...data });
}
```

   In `CsrfService.ts` and `rateLimits.ts`, replace each `captureSecurityEvent(type, data, options?)` with `logSecurityEvent(type, data)`.
7. **`worker/agents/tools/customTools.ts`:** drop `toolFeedbackDefinition` and its import.
8. **Leftover lines:**
   - `worker/index.ts` and `worker/app.ts`: delete the commented-out Sentry lines;
   - `vite.config.ts`: delete the `sentryVitePlugin` comments;
   - `worker/types/env.d.ts`: delete `SENTRY_DSN`;
   - `scripts/deploy.ts`: delete `'SENTRY_DSN'` from `secretVars`;
   - `scripts/setup.ts`: delete it from the list near line 1152.
9. **`src/main.tsx`:** drop `initSentry`. **`src/contexts/auth-context.tsx`:** drop `useSentryUser` and its call.
10. **`src/components/ErrorBoundary.tsx`:** becomes a class boundary. Import `Component` from `react` and `captureBrowserException` from `@/lib/analytics/posthog-browser`. Keep `ErrorFallback` as it is.

```tsx
interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error): void {
		captureBrowserException(error);
	}

	render() {
		return this.state.error ? <ErrorFallback error={this.state.error} resetError={() => this.setState({ error: null })} /> : this.props.children;
	}
}
```

- [ ] **Step 4: Run the tests and the CI steps**

Run: `rtk proxy bun run test -- worker/services/posthog worker/services/csrf worker/services/rate-limit worker/database worker/logger`
Expected: PASS.

Then run the CI steps from Task 17 Step 4. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A worker/observability worker/api/controllers/sentry worker/api/routes worker/logger/core.ts worker/database/database.ts worker/database/database-instrumentation.test.ts worker/middleware/auth/routeAuth.ts worker/services/csrf/CsrfService.ts worker/services/rate-limit/rateLimits.ts worker/services/posthog/no-sentry-guard.test.ts worker/agents/tools worker/index.ts worker/app.ts worker/types/env.d.ts scripts/deploy.ts scripts/setup.ts vite.config.ts src/main.tsx src/contexts/auth-context.tsx src/components/ErrorBoundary.tsx src/utils/sentry.ts src/hooks/useSentryUser.ts package.json bun.lock
git commit -m "chore(errors): remove the unused sentry wiring now that posthog reports errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Open pull request 2 into `main`.**
  - The description lists what was removed and Task 18's results, one line each.
  - End it with "Generated with [Claude Code](https://claude.com/claude-code)".
  - Don't merge.
