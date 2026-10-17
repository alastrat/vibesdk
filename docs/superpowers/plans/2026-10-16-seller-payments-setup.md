# Seller Payments Setup, Alerts and Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A store takes payments only after its seller has accepted the selling terms and finished Stripe's setup, including card payments and a verified bank account. Estori is always the seller's platform, never the merchant of record. Owner alerts reach an inbox, and the legal pages describe selling in your own store.

**Architecture:**
- **Readiness rule.** One pure rule, `sellerSetupStep`, turns the seller's readiness into the next missing step. Checkout, the Payouts card and a new agent tool all ask it.
- **Stored readiness.** The selling-terms agreement is stored on the user, and card payments is stored with the Connect account. Checkout reads the Stripe account live, as today.
- **Alerts.** One alert service emails a dedicated recipient list, throttled once a day per kind and subject. The catalog runner, the supplier adapter and a new daily health job use it.

**Tech Stack:**
- Cloudflare Workers, D1 with Drizzle (drizzle-kit migrations), KV;
- the Stripe REST client in `worker/services/payments/stripe-client.ts`;
- React 19 with `@cloudflare/kumo` and TanStack Query;
- Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-16-seller-risk-safeguards-design.md`. This plan implements sections 3, 8 and 9 and their data in section 10. Sections 4–7 follow in `2026-10-16-seller-money-rules.md` and `2026-10-16-seller-levels-and-limits.md`.

## Global Constraints

- Never use `any`. Frontend imports shared types from `@/api-types`.
- No emojis in code, comments or copy. Comments say what and why, not narration.
- Commit subjects are lowercase after the type prefix and end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never commit `.dev.vars`, `bun.lockb`, anything under `.superpowers/`, `src/routes/landing/LandingPage.tsx` or the local overrides in `wrangler.jsonc`.
- Run tests with `rtk proxy npx vitest run <paths>`, in small batches. Before a run, wait until `netstat -an | grep -c TIME_WAIT` is under 1500.
- Migrations: run `rtk proxy npm run db:generate -- --name <name>`. Apply the SQL to the local dev D1 with sqlite3, together with its `d1_migrations` row, in one transaction against `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<db>.sqlite`, as 0016–0019 were.
- Public pages never name a supplier or an AI assistant. `src/routes/copy-rules.ts` lists the supplier names.
- Shopper-facing refusals use `STORE_CHECKOUT_MESSAGES` and never reveal an internal reason (spec section 3).
- Owner alerts go to `PLATFORM_ALERT_EMAILS`, initially `['alastrat@pluriza.com']`, kept apart from `PLATFORM_ADMIN_EMAILS` (spec section 8).
- `SELLER_TERMS_VERSION` and `TERMS_VERSION` both become `'2026-10-16'` (spec section 9).

## Review Focus

1. **A seller whose Stripe account loses card payments or payouts after they once worked.** Checkout must refuse at once, because it reads Stripe live, and the Payouts card must show the step again. Task 4 pins checkout.
2. **The selling terms changing again later.** A seller who accepted an older `SELLER_TERMS_VERSION` must be asked again before their store takes another payment, without touching their Stripe account. Tasks 1 and 3 pin this.
3. **Alert email failures.** A missing `EMAIL` binding or a send error must never break the runner step or the cron that raised the alert. The alert is logged either way. Task 7 pins this.
4. **The same late order raising an alert every day.** It may raise one alert a day, by design. A throttle key that also included the time or the message would mean one email per run. Task 7 pins the key shape.
5. **A seller who connected Stripe before this change,** for template sales, and never accepted the selling terms. Their paid-site sales keep working. Only store checkout asks for the selling terms. Task 4 pins this.

## Rulings carried into this plan

- **Ruling: one migration per plan (0020 here) instead of spec section 10's single 0020.**
  - Why: each plan ships working software and its own schema.
  - Cost if wrong: none.
- **Ruling: the `cost-above-locked` and `extra-charge` alerts are deferred to the supplier adapters spec.**
  - Why: they need the locked cost on each supplier order line and CJ charge data. That spec redefines both, at the owner's request (2026-10-16).
  - Cost if wrong: until then, Estori could pay a supplier more than the catalog price it collected, with no alert. Offers older than 72 hours already stop selling.
- **Ruling: the selling-terms step comes before Stripe for every seller, including paid-site sellers.**
  - Why: the Payouts card is shared, and one agreement covers all selling.
  - Cost if wrong: paid-site sellers who already connected see one extra checkbox.

---

### Task 1: The seller setup rule

**Files:**
- Create: `shared/types/seller-setup.ts`
- Modify: `src/api-types.ts` (re-export)
- Test: `shared/types/seller-setup.test.ts`

**Interfaces:**
- Produces:
  - `SELLER_TERMS_VERSION: '2026-10-16'`;
  - `SellerSetupStep = 'accept-terms' | 'finish-stripe' | 'bank-account'`;
  - `SELLER_SETUP_MESSAGES: Record<SellerSetupStep, string>`;
  - `interface SellerReadiness { termsAccepted; connected; detailsSubmitted; cardPaymentsActive; transfersActive; payoutsEnabled }` (all boolean);
  - `sellerSetupStep(readiness): SellerSetupStep | null`;
  - `isCurrentSellerTermsVersion(version: unknown): boolean`;
  - `SELLER_SETUP_PATH = '/profile?tab=paid'`.

- [ ] **Step 1: Write the failing test**

```ts
// shared/types/seller-setup.test.ts
import { describe, expect, it } from 'vitest';
import { SELLER_SETUP_MESSAGES, SELLER_TERMS_VERSION, isCurrentSellerTermsVersion, sellerSetupStep, type SellerReadiness } from './seller-setup';

const READY: SellerReadiness = {
	termsAccepted: true,
	connected: true,
	detailsSubmitted: true,
	cardPaymentsActive: true,
	transfersActive: true,
	payoutsEnabled: true,
};

describe('sellerSetupStep', () => {
	it('lets a fully set-up seller take payments', () => {
		expect(sellerSetupStep(READY)).toBeNull();
	});

	it('asks for the selling terms before anything at Stripe', () => {
		expect(sellerSetupStep({ ...READY, termsAccepted: false, connected: false })).toBe('accept-terms');
	});

	it("sends the seller back to Stripe until details, card payments and transfers are all in place", () => {
		for (const gap of ['connected', 'detailsSubmitted', 'cardPaymentsActive', 'transfersActive'] as const) {
			expect(sellerSetupStep({ ...READY, [gap]: false })).toBe('finish-stripe');
		}
	});

	it('asks for a verified bank account last', () => {
		expect(sellerSetupStep({ ...READY, payoutsEnabled: false })).toBe('bank-account');
	});

	it('names each step in plain words', () => {
		expect(SELLER_SETUP_MESSAGES).toEqual({
			'accept-terms': 'Accept the selling terms',
			'finish-stripe': 'Finish your Stripe setup',
			'bank-account': 'Add and verify a bank account',
		});
	});

	it('accepts only the current selling terms version', () => {
		expect(SELLER_TERMS_VERSION).toBe('2026-10-16');
		expect(isCurrentSellerTermsVersion('2026-10-16')).toBe(true);
		expect(isCurrentSellerTermsVersion('2026-10-13')).toBe(false);
		expect(isCurrentSellerTermsVersion(null)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run shared/types/seller-setup.test.ts`
Expected: FAIL, "Failed to load url ./seller-setup".

- [ ] **Step 3: Write minimal implementation**

```ts
// shared/types/seller-setup.ts
/** What a seller needs before their stores take payments, and the next step to show them. */

export const SELLER_TERMS_VERSION = '2026-10-16';

/** Where a seller finishes payments setup: the Payouts card on their profile. */
export const SELLER_SETUP_PATH = '/profile?tab=paid';

export const SELLER_SETUP_STEPS = ['accept-terms', 'finish-stripe', 'bank-account'] as const;
export type SellerSetupStep = (typeof SELLER_SETUP_STEPS)[number];

export const SELLER_SETUP_MESSAGES: Readonly<Record<SellerSetupStep, string>> = {
	'accept-terms': 'Accept the selling terms',
	'finish-stripe': 'Finish your Stripe setup',
	'bank-account': 'Add and verify a bank account',
};

export interface SellerReadiness {
	termsAccepted: boolean;
	/** The seller has a Stripe Connect account. */
	connected: boolean;
	detailsSubmitted: boolean;
	/** The seller can be the merchant of record; Estori never is for a store sale. */
	cardPaymentsActive: boolean;
	transfersActive: boolean;
	/** Needs a verified bank account, which Stripe debits to recover a negative balance. */
	payoutsEnabled: boolean;
}

/** The first step still missing, or null when the seller's stores can take payments. */
export function sellerSetupStep(readiness: SellerReadiness): SellerSetupStep | null {
	if (!readiness.termsAccepted) return 'accept-terms';
	if (!readiness.connected || !readiness.detailsSubmitted || !readiness.cardPaymentsActive || !readiness.transfersActive) return 'finish-stripe';
	if (!readiness.payoutsEnabled) return 'bank-account';
	return null;
}

export function isCurrentSellerTermsVersion(version: unknown): boolean {
	return version === SELLER_TERMS_VERSION;
}
```

In `src/api-types.ts`, next to the other `shared/types` re-exports, add:

```ts
export type { SellerReadiness, SellerSetupStep } from '../shared/types/seller-setup.js';
export { SELLER_SETUP_MESSAGES, SELLER_SETUP_PATH, SELLER_TERMS_VERSION, sellerSetupStep } from '../shared/types/seller-setup.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run shared/types/seller-setup.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add shared/types/seller-setup.ts shared/types/seller-setup.test.ts src/api-types.ts
git commit -m "feat(payments): the seller setup rule a store needs before taking payments"
```

### Task 2: Store card payments and the selling-terms agreement

**Files:**
- Modify: `worker/database/schema.ts` (`users`, `stripeConnectAccounts`)
- Modify: `worker/services/payments/stripe-client.ts` (`SellerFlags`, `accountFlags`, new `sellerReadiness`)
- Create: `migrations/0020_seller_setup.sql` (generated)
- Test: `worker/database/seller-setup-schema.test.ts`, `worker/services/payments/stripe-client.test.ts`

**Interfaces:**
- Consumes: `SellerReadiness` (Task 1).
- Produces:
  - `SellerFlags` gains `cardPaymentsActive: boolean`;
  - `sellerReadiness(flags: SellerFlags | null, termsAccepted: boolean): SellerReadiness`;
  - columns `users.seller_terms_version` (text, nullable), `users.seller_terms_accepted_at` (timestamp, nullable) and `stripe_connect_accounts.card_payments_active` (boolean, default false).

- [ ] **Step 1: Write the failing tests**

```ts
// worker/database/seller-setup-schema.test.ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('seller setup schema', () => {
	it('records the selling-terms agreement on users, empty for everyone today', () => {
		const columns = getTableConfig(schema.users).columns;
		expect(columns.find((column) => column.name === 'seller_terms_version')?.notNull).toBe(false);
		expect(columns.find((column) => column.name === 'seller_terms_accepted_at')?.notNull).toBe(false);
	});

	it('stores whether the Connect account takes card payments, off until Stripe says so', () => {
		expect(schema.stripeConnectAccounts.cardPaymentsActive.default).toBe(false);
		expect(schema.stripeConnectAccounts.cardPaymentsActive.notNull).toBe(true);
	});

	it('ships the three columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `seller_terms_version` text');
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `seller_terms_accepted_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `stripe_connect_accounts` ADD `card_payments_active` integer DEFAULT false NOT NULL');
	});
});
```

In `worker/services/payments/stripe-client.test.ts`, replace the `accountFlags` describe block with:

```ts
describe('accountFlags', () => {
	it('reads payout readiness and card payments from the account', () => {
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
			cardPaymentsActive: false,
		});
		expect(accountFlags({ ...account, capabilities: { transfers: 'active', card_payments: 'active' } }).cardPaymentsActive).toBe(true);
		expect(accountFlags({ ...account, capabilities: undefined })).toMatchObject({ transfersActive: false, cardPaymentsActive: false });
	});
});

describe('sellerReadiness', () => {
	const FLAGS = { detailsSubmitted: true, chargesEnabled: true, payoutsEnabled: true, transfersActive: true, cardPaymentsActive: true };

	it('combines the stored flags with the selling-terms agreement', () => {
		expect(sellerReadiness(FLAGS, true)).toEqual({
			termsAccepted: true,
			connected: true,
			detailsSubmitted: true,
			cardPaymentsActive: true,
			transfersActive: true,
			payoutsEnabled: true,
		});
	});

	it('reads a seller with no Connect account as not connected', () => {
		expect(sellerReadiness(null, true)).toEqual({
			termsAccepted: true,
			connected: false,
			detailsSubmitted: false,
			cardPaymentsActive: false,
			transfersActive: false,
			payoutsEnabled: false,
		});
	});
});
```

Add `sellerReadiness` to that file's import from `./stripe-client`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/database/seller-setup-schema.test.ts worker/services/payments/stripe-client.test.ts`
Expected: FAIL. `cardPaymentsActive` is undefined on the schema, the migration strings are missing, `accountFlags` lacks `cardPaymentsActive`, and `sellerReadiness` isn't exported.

- [ ] **Step 3: Implement**

In `worker/database/schema.ts`:
- In `users`, after `termsVersion: text('terms_version'),`, add:

```ts
    /** The selling-terms version the user agreed to before their stores take payments; null until they do. */
    sellerTermsVersion: text('seller_terms_version'),
    sellerTermsAcceptedAt: integer('seller_terms_accepted_at', { mode: 'timestamp' }),
```

- In `stripeConnectAccounts`, after `transfersActive`, add:

```ts
    /** The seller can be the merchant of record (on_behalf_of); store checkout requires it. */
    cardPaymentsActive: integer('card_payments_active', { mode: 'boolean' }).notNull().default(false),
```

In `worker/services/payments/stripe-client.ts`:
- Add `cardPaymentsActive: boolean;` to `SellerFlags`.
- In `accountFlags`, add `cardPaymentsActive: account.capabilities?.card_payments === 'active',`.
- Import `SellerReadiness` from `'../../../shared/types/seller-setup'`, and add after `accountFlags`:

```ts
/** The seller's readiness to take store payments, from their stored or fresh flags; null flags mean no Connect account. */
export function sellerReadiness(flags: SellerFlags | null, termsAccepted: boolean): SellerReadiness {
	return {
		termsAccepted,
		connected: flags !== null,
		detailsSubmitted: flags?.detailsSubmitted ?? false,
		cardPaymentsActive: flags?.cardPaymentsActive ?? false,
		transfersActive: flags?.transfersActive ?? false,
		payoutsEnabled: flags?.payoutsEnabled ?? false,
	};
}
```

`StripeConnectService.create` and `updateFlags` spread `SellerFlags` into the row, so the new column is written with no further change. `StripeConnectController.getStatus` builds `flags` from the stored row field by field. Add `cardPaymentsActive: stored.cardPaymentsActive,` there; Task 3 replaces that method anyway.

- [ ] **Step 4: Generate the migration and apply it locally**

Run: `rtk proxy npm run db:generate -- --name seller_setup`
Expected: `migrations/0020_seller_setup.sql` with exactly the three `ALTER TABLE ... ADD` statements.

Apply it to the local D1 with sqlite3: the SQL and its `d1_migrations` row, in one transaction.

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/database/seller-setup-schema.test.ts worker/services/payments/stripe-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/database/schema.ts worker/services/payments/stripe-client.ts worker/services/payments/stripe-client.test.ts worker/database/seller-setup-schema.test.ts worker/api/controllers/payments/connectController.ts migrations/0020_seller_setup.sql migrations/meta/
git commit -m "feat(payments): store card payments and the selling-terms agreement"
```

### Task 3: Accept the selling terms, and report the next setup step

**Files:**
- Create: `worker/database/services/SellerTermsService.ts`
- Modify: `worker/database/index.ts` (export)
- Modify: `worker/api/controllers/payments/connectController.ts`, `worker/api/controllers/payments/types.ts`, `worker/api/routes/paymentsRoutes.ts`
- Modify: `src/lib/api-client.ts`
- Test: `worker/database/services/SellerTermsService.test.ts`, `worker/api/controllers/payments/payments-wiring.test.ts`

**Interfaces:**
- Consumes: `sellerReadiness`, `accountFlags` (Task 2); `sellerSetupStep`, `isCurrentSellerTermsVersion`, `SELLER_TERMS_VERSION` (Task 1).
- Produces:
  - `SellerTermsService.accept(userId: string, version: unknown, now: Date): Promise<boolean>`;
  - `SellerTermsService.hasAccepted(userId: string): Promise<boolean>`;
  - `StripeConnectStatusData` gains `cardPaymentsActive: boolean`, `sellerTermsAccepted: boolean`, `setupStep: SellerSetupStep | null`;
  - route `POST /api/stripe/connect/terms` with body `{ version: string }`, returning `StripeConnectStatusData`;
  - `apiClient.acceptSellerTerms(version: string)`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/database/services/SellerTermsService.test.ts
import { describe, expect, it } from 'vitest';
import { SellerTermsService } from './SellerTermsService';
import { recordingD1 } from '../test-support/recording-d1';

describe('SellerTermsService', () => {
	it('records the current version and the time', async () => {
		const { d1, statements } = recordingD1();
		const terms = new SellerTermsService({ DB: d1 } as unknown as Env);

		expect(await terms.accept('u1', '2026-10-16', new Date(1_800_000_000_000))).toBe(true);
		const update = statements.find((entry) => entry.sql.toLowerCase().startsWith('update "users"'));
		expect(update?.sql).toContain('"seller_terms_version"');
		expect(update?.sql).toContain('"seller_terms_accepted_at"');
		expect(update?.params).toContain('2026-10-16');
		expect(update?.params).toContain('u1');
	});

	it('refuses an old or missing version without writing', async () => {
		const { d1, statements } = recordingD1();
		const terms = new SellerTermsService({ DB: d1 } as unknown as Env);

		expect(await terms.accept('u1', '2026-10-13', new Date())).toBe(false);
		expect(await terms.accept('u1', undefined, new Date())).toBe(false);
		expect(statements).toHaveLength(0);
	});

	it('reads an agreement as current only for the current version', async () => {
		expect(await new SellerTermsService({ DB: recordingD1([['2026-10-16']]).d1 } as unknown as Env).hasAccepted('u1')).toBe(true);
		expect(await new SellerTermsService({ DB: recordingD1([['2026-10-13']]).d1 } as unknown as Env).hasAccepted('u1')).toBe(false);
		expect(await new SellerTermsService({ DB: recordingD1([]).d1 } as unknown as Env).hasAccepted('u1')).toBe(false);
	});
});
```

In `worker/api/controllers/payments/payments-wiring.test.ts`, add a case inside its describe block. The file reads route and controller sources as raw text, so follow its existing pattern: use the `source(...)` helper it already defines, and add the paths below to its glob list if they aren't there.

```ts
	it('takes the selling-terms agreement before Stripe, and reports the next setup step', () => {
		const routes = source('/worker/api/routes/paymentsRoutes.ts');
		expect(routes).toContain("app.post('/api/stripe/connect/terms', setAuthLevel(AuthConfig.authenticated)");
		const controller = source('/worker/api/controllers/payments/connectController.ts');
		expect(controller).toContain('Accept the selling terms first');
		expect(controller).toContain('setupStep: sellerSetupStep(readiness)');
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/database/services/SellerTermsService.test.ts worker/api/controllers/payments/payments-wiring.test.ts`
Expected: FAIL. The module isn't found, and the route and strings are missing.

- [ ] **Step 3: Implement**

```ts
// worker/database/services/SellerTermsService.ts
/** The seller's agreement to the selling terms, required before their stores take payments. */

import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { SELLER_TERMS_VERSION, isCurrentSellerTermsVersion } from '../../../shared/types/seller-setup';

export class SellerTermsService extends BaseService {
	/** Records the agreement; false, with nothing written, when the version isn't the current one. */
	async accept(userId: string, version: unknown, now: Date): Promise<boolean> {
		if (!isCurrentSellerTermsVersion(version)) return false;
		await this.database
			.update(schema.users)
			.set({ sellerTermsVersion: SELLER_TERMS_VERSION, sellerTermsAcceptedAt: now, updatedAt: now })
			.where(eq(schema.users.id, userId))
			.run();
		return true;
	}

	async hasAccepted(userId: string): Promise<boolean> {
		const row = await this.database
			.select({ version: schema.users.sellerTermsVersion })
			.from(schema.users)
			.where(eq(schema.users.id, userId))
			.get();
		return isCurrentSellerTermsVersion(row?.version);
	}
}
```

In `worker/database/index.ts`, add `export { SellerTermsService } from './services/SellerTermsService';` next to `StripeConnectService`.

In `worker/api/controllers/payments/types.ts`, import `SellerSetupStep` from `'../../../../shared/types/seller-setup'` and extend `StripeConnectStatusData`:

```ts
    /** Stripe lets the seller be the merchant of record; store checkout requires it. */
    cardPaymentsActive: boolean;
    sellerTermsAccepted: boolean;
    /** The next step before the seller's stores take payments; null when they're ready. */
    setupStep: SellerSetupStep | null;
```

Then rework `worker/api/controllers/payments/connectController.ts`:

```ts
import { SellerTermsService, StripeConnectService } from '../../../database';
import { StripeApiError, accountFlags, sellerReadiness, type SellerFlags } from '../../../services/payments/stripe-client';
import { sellerSetupStep } from '../../../../shared/types/seller-setup';

const ACCEPT_TERMS_FIRST_MESSAGE = 'Accept the selling terms first';

/** The status for a seller with these flags (null: no Connect account) and selling-terms agreement. */
function statusOf(flags: SellerFlags | null, termsAccepted: boolean): StripeConnectStatusData {
    const readiness = sellerReadiness(flags, termsAccepted);
    return {
        configured: true,
        connected: readiness.connected,
        detailsSubmitted: readiness.detailsSubmitted,
        payoutsEnabled: readiness.payoutsEnabled,
        transfersActive: readiness.transfersActive,
        cardPaymentsActive: readiness.cardPaymentsActive,
        sellerTermsAccepted: termsAccepted,
        setupStep: sellerSetupStep(readiness),
    };
}
```

Replace `NOT_CONNECTED` and the body of `getStatus` with a shared loader. It refreshes the flags from Stripe, falls back to stored flags if Stripe fails, and reads as not connected when Stripe no longer has the account:

```ts
    private static async loadStatus(env: Env, userId: string): Promise<StripeConnectStatusData> {
        const termsAccepted = await new SellerTermsService(env).hasAccepted(userId);
        const stripe = stripeFromEnv(env);
        if (!stripe) return { ...statusOf(null, termsAccepted), configured: false };
        const accounts = new StripeConnectService(env);
        const stored = await accounts.getByUser(userId);
        if (!stored) return statusOf(null, termsAccepted);
        let flags: SellerFlags = {
            detailsSubmitted: stored.detailsSubmitted,
            chargesEnabled: stored.chargesEnabled,
            payoutsEnabled: stored.payoutsEnabled,
            transfersActive: stored.transfersActive,
            cardPaymentsActive: stored.cardPaymentsActive,
        };
        try {
            const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
            if (!account) return statusOf(null, termsAccepted);
            flags = accountFlags(account);
            await accounts.updateFlags(stored.stripeAccountId, flags);
        } catch (error) {
            this.logger.warn('Could not refresh the Stripe account; using stored flags', error);
        }
        return statusOf(flags, termsAccepted);
    }

    static async getStatus(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            return StripeConnectController.createSuccessResponse(await StripeConnectController.loadStatus(env, context.user!.id));
        } catch (error) {
            this.logger.error('Error loading Stripe status', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to load your Stripe status', 500);
        }
    }

    /** Record the seller's agreement to the current selling terms, then return their status. */
    static async acceptSellerTerms(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<StripeConnectStatusData>>> {
        try {
            const body = await StripeConnectController.parseJsonBody<{ version?: unknown }>(request);
            if (!body.success) return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Send the terms version you agreed to', 400);
            const accepted = await new SellerTermsService(env).accept(context.user!.id, body.data?.version, new Date());
            if (!accepted) return StripeConnectController.createErrorResponse<StripeConnectStatusData>('The selling terms were updated; reload the page to agree to the latest version', 400);
            return StripeConnectController.createSuccessResponse(await StripeConnectController.loadStatus(env, context.user!.id));
        } catch (error) {
            this.logger.error('Error recording the selling-terms agreement', error);
            return StripeConnectController.createErrorResponse<StripeConnectStatusData>('Failed to record your agreement', 500);
        }
    }
```

In `startOnboarding`, right after `const user = context.user!;`, add:

```ts
            if (!(await new SellerTermsService(env).hasAccepted(user.id))) {
                return StripeConnectController.createErrorResponse<StripeLinkData>(ACCEPT_TERMS_FIRST_MESSAGE, 400);
            }
```

In `worker/api/routes/paymentsRoutes.ts`, add after the status route:

```ts
    app.post('/api/stripe/connect/terms', setAuthLevel(AuthConfig.authenticated), adaptController(StripeConnectController, StripeConnectController.acceptSellerTerms));
```

In `src/lib/api-client.ts`, next to `getStripeConnectStatus`:

```ts
	async acceptSellerTerms(version: string): Promise<ApiResponse<StripeConnectStatusData>> {
		return this.request<StripeConnectStatusData>('/api/stripe/connect/terms', { method: 'POST', body: JSON.stringify({ version }) });
	}
```

Check how `this.request` sets JSON headers elsewhere in the file. `acceptTerms` at line ~1424 is the model, so match its body form exactly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/database/services/SellerTermsService.test.ts worker/api/controllers/payments/payments-wiring.test.ts`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors. `getStatus`'s old `NOT_CONNECTED` object is gone.

- [ ] **Step 5: Commit**

```bash
git add worker/database/services/SellerTermsService.ts worker/database/services/SellerTermsService.test.ts worker/database/index.ts worker/api/controllers/payments/ worker/api/routes/paymentsRoutes.ts src/lib/api-client.ts
git commit -m "feat(payments): sellers accept the selling terms before stripe, and see their next setup step"
```

### Task 4: Store checkout requires a finished setup, with the seller always the merchant

**Files:**
- Modify: `worker/services/store-payments/checkout.ts`
- Modify: `worker/services/payments/stripe-client.ts` (`StoreCheckoutSessionInput`, `createStoreCheckoutSession`)
- Modify: `worker/api/handlers/store-platform.ts` (`sellerAccount`, `serveStoreInfo`)
- Test: `worker/services/store-payments/checkout.test.ts`, `worker/services/payments/stripe-client.test.ts`

**Interfaces:**
- Consumes: `SellerReadiness`, `sellerSetupStep` (Task 1); `sellerReadiness`, `accountFlags` (Task 2); `SellerTermsService.hasAccepted` (Task 3).
- Produces:
  - `StartCheckoutDeps.sellerAccount(): Promise<{ stripeAccountId: string; readiness: SellerReadiness } | null>`;
  - `StoreCheckoutSessionInput` no longer has `sellerIsMerchant`, and the session always sets `on_behalf_of`.

- [ ] **Step 1: Write the failing tests**

In `worker/services/store-payments/checkout.test.ts`:
- Add `import type { SellerReadiness } from '../../../shared/types/seller-setup';`.
- Add above `fakeDeps`:

```ts
const READY: SellerReadiness = { termsAccepted: true, connected: true, detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };
```

- Change the default `sellerAccount` in `fakeDeps` to `async () => ({ stripeAccountId: 'acct_1', readiness: READY })`.
- In 'refuses public previews, live keys and sellers who cannot take payments, before pricing', replace the case that had `paymentsEnabled: false` with these four:

```ts
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, termsAccepted: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, cardPaymentsActive: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, transfersActive: false } }) }, 'payments_unavailable'],
			[{}, { sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, payoutsEnabled: false } }) }, 'payments_unavailable'],
```

- Replace 'makes the seller the merchant only when their account takes card payments' with:

```ts
	it('never makes Estori the merchant: a session goes out only for a seller who can be one', async () => {
		const ready = fakeDeps();
		await startStoreCheckout(ready.deps, INPUT);
		expect(ready.sessions).toHaveLength(1);
		expect('sellerIsMerchant' in ready.sessions[0]).toBe(false);

		const transfersOnly = fakeDeps({ sellerAccount: async () => ({ stripeAccountId: 'acct_1', readiness: { ...READY, cardPaymentsActive: false } }) });
		expect(await startStoreCheckout(transfersOnly.deps, INPUT)).toEqual({ ok: false, reason: 'payments_unavailable', message: "This store can't take payments right now." });
		expect(transfersOnly.sessions).toHaveLength(0);
	});
```

In `worker/services/payments/stripe-client.test.ts` ('store checkout sessions'):
- Remove `sellerIsMerchant: true,` from `INPUT`.
- Delete the test "leaves the seller out as merchant when their account can't take card payments yet".
- Keep 'charges the priced lines and shipping, with the fee and the seller as merchant'. It already expects `payment_intent_data[on_behalf_of]=acct_1`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/store-payments/checkout.test.ts worker/services/payments/stripe-client.test.ts`
Expected: FAIL. `readiness` isn't read, so the four seller cases pass checkout. The session still carries `sellerIsMerchant`. `tsc` also flags the removed field.

- [ ] **Step 3: Implement**

In `worker/services/store-payments/checkout.ts`:
- Import `sellerSetupStep` and `type SellerReadiness` from `'../../../shared/types/seller-setup'`.
- Change the dep to:

```ts
	/** The seller's Stripe account and how far their payments setup has come; null when they never connected Stripe. */
	sellerAccount(): Promise<{ stripeAccountId: string; readiness: SellerReadiness } | null>;
```

- Replace `if (!seller?.paymentsEnabled) return refusal('payments_unavailable');` with:

```ts
	// The seller must be able to be the merchant of record, with a bank account Stripe can recover from.
	if (!seller || sellerSetupStep(seller.readiness) !== null) return refusal('payments_unavailable');
```

- Delete `sellerIsMerchant: seller.cardPaymentsActive,` from the `createSession` call.

In `worker/services/payments/stripe-client.ts`:
- Delete the `sellerIsMerchant` field and its comment from `StoreCheckoutSessionInput`.
- In `createStoreCheckoutSession`, set `on_behalf_of: input.sellerStripeAccountId,`.
- Keep the comment above the method, "The seller is the merchant of record (on_behalf_of)".

In `worker/api/handlers/store-platform.ts`:
- Import `SellerTermsService` from the database barrel, `sellerReadiness` from the Stripe client, and `sellerSetupStep` and `type SellerReadiness` from `shared/types/seller-setup`.
- Replace `sellerAccount` and its comment:

```ts
/**
 * The seller's Connect account and payments readiness. Checkout reads the account live from Stripe, and rewrites stored
 * flags older than the freshness window; the store's info, which runs on every page load, reads the stored flags only.
 */
async function sellerAccount(env: Env, userId: string, stripe: StripeClient | null): Promise<{ stripeAccountId: string; readiness: SellerReadiness } | null> {
	const accounts = new StripeConnectService(env);
	const stored = await accounts.getByUser(userId);
	if (!stored) return null;
	const termsAccepted = await new SellerTermsService(env).hasAccepted(userId);
	if (!stripe) return { stripeAccountId: stored.stripeAccountId, readiness: sellerReadiness(stored, termsAccepted) };
	const account = await accounts.forgetIfMissing(stored, (accountId) => stripe.retrieveAccount(accountId));
	if (!account) return null;
	const fresh = accountFlags(account);
	if (Date.now() - (stored.updatedAt?.getTime() ?? 0) > SELLER_FLAGS_MAX_AGE_MS) await accounts.updateFlags(stored.stripeAccountId, fresh);
	return { stripeAccountId: stored.stripeAccountId, readiness: sellerReadiness(fresh, termsAccepted) };
}
```

`stored` is a `StripeConnectAccount` row. It carries every `SellerFlags` field, so it can be passed directly.

In `serveStoreInfo`, replace the last line with:

```ts
	return json(storeInfoOf(parsed.manifest, seller !== null && sellerSetupStep(seller.readiness) === null));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/store-payments/checkout.test.ts worker/services/payments/stripe-client.test.ts worker/api/handlers`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/services/store-payments/checkout.ts worker/services/store-payments/checkout.test.ts worker/services/payments/stripe-client.ts worker/services/payments/stripe-client.test.ts worker/api/handlers/store-platform.ts
git commit -m "feat(store-payments): checkout needs a finished seller setup, and the seller is always the merchant"
```

### Task 5: The payments setup step in the app

**Files:**
- Modify: `src/components/payments/PayoutsCard.tsx`
- Create: `src/components/payments/PaymentsSetupPrompt.tsx`
- Modify: `src/hooks/use-payments.ts` (`useAcceptSellerTerms`)
- Modify: `src/routes/home.tsx` (render the prompt under `BuildBox`)
- Test: `src/components/payments/payments-setup.test.ts`

**Interfaces:**
- Consumes: `apiClient.acceptSellerTerms`, the `StripeConnectStatusData` fields (Task 3); `SELLER_SETUP_MESSAGES`, `SELLER_TERMS_VERSION`, `SELLER_SETUP_PATH` (Task 1).
- Produces: `useAcceptSellerTerms()`; `<PaymentsSetupPrompt />`.

- [ ] **Step 1: Write the failing test**

```ts
// src/components/payments/payments-setup.test.ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/payments/PayoutsCard.tsx', '/src/components/payments/PaymentsSetupPrompt.tsx', '/src/hooks/use-payments.ts', '/src/routes/home.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('payments setup', () => {
	it('asks for the selling terms before Stripe, and names every next step', () => {
		const card = source('/src/components/payments/PayoutsCard.tsx');
		expect(card).toContain("data.setupStep === 'accept-terms'");
		expect(card).toContain('SELLER_SETUP_MESSAGES[data.setupStep]');
		expect(card).toContain('acceptTerms.mutate(SELLER_TERMS_VERSION');
		expect(card).toContain('I agree to the selling terms');
		expect(card).toContain('href="/terms"');
		expect(card).toContain('Ready to take payments');
	});

	it('records the agreement through the API and refreshes the status', () => {
		const hooks = source('/src/hooks/use-payments.ts');
		expect(hooks).toContain('export function useAcceptSellerTerms(');
		expect(hooks).toContain('apiClient.acceptSellerTerms(version)');
		expect(hooks).toContain('queryKeys.account.payments.status(');
	});

	it('offers setup after sign-up on the home page, once, until the seller dismisses it', () => {
		const prompt = source('/src/components/payments/PaymentsSetupPrompt.tsx');
		expect(prompt).toContain('SELLER_SETUP_PATH');
		expect(prompt).toContain("'estori:payments-setup-dismissed'");
		expect(prompt).toContain('try {');
		expect(prompt).toContain('status.data.connected');
		expect(source('/src/routes/home.tsx')).toContain('<PaymentsSetupPrompt />');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run src/components/payments/payments-setup.test.ts`
Expected: FAIL, "Source not found: /src/components/payments/PaymentsSetupPrompt.tsx".

- [ ] **Step 3: Implement**

In `src/hooks/use-payments.ts`, add:

```ts
export function useAcceptSellerTerms() {
	const queryClient = useQueryClient();
	const { user } = useAuth();
	return useMutation({
		mutationFn: (version: string) => unwrap(apiClient.acceptSellerTerms(version), 'Failed to record your agreement'),
		onSuccess: (status) => queryClient.setQueryData(queryKeys.account.payments.status(user?.id), status),
	});
}
```

Reuse the imports already in the file: `useMutation`, `useQueryClient`, `useAuth`, `unwrap`. Add any that are missing from the same modules the file already uses.

Replace the body of `src/components/payments/PayoutsCard.tsx` from `const verifying = ...` to the end with:

```tsx
	const step = data.setupStep;
	const verifying = step === 'finish-stripe' && data.connected && data.detailsSubmitted;

	return (
		<div className="grid gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid gap-0.5">
				<span className="text-sm font-medium text-kumo-default">Get paid with Stripe</span>
				<span className="text-sm text-kumo-subtle">
					Your stores and paid sites take payments through Stripe. Paid sites pay Estori's {PLATFORM_FEE_LABEL} fee.
				</span>
			</div>
			{step === null ? (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="success">Ready to take payments</Badge>
					<Button size="sm" variant="secondary" loading={dashboard.isPending} onClick={openDashboard}>
						Open Stripe dashboard
					</Button>
				</div>
			) : data.setupStep === 'accept-terms' ? (
				<div className="grid gap-2">
					<span className="text-sm text-kumo-default">{SELLER_SETUP_MESSAGES[data.setupStep]}</span>
					<label className="flex items-start gap-2 text-sm text-kumo-default">
						<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
						<span>
							I agree to the selling terms in the{' '}
							<a href="/terms" target="_blank" rel="noreferrer" className="underline">
								Terms of Service
							</a>
							, section 10, including how refunds, disputes and Stripe's account fees are paid.
						</span>
					</label>
					<div>
						<Button
							size="sm"
							variant="primary"
							disabled={!agreed}
							loading={acceptTerms.isPending || onboarding.isPending}
							onClick={() =>
								acceptTerms.mutate(SELLER_TERMS_VERSION, {
									onSuccess: () => onboarding.start(),
									onError: (error) => toast.error(error.message),
								})
							}
						>
							Agree and continue to Stripe
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={verifying ? 'info' : 'warning'}>{verifying ? 'Waiting for Stripe' : SELLER_SETUP_MESSAGES[step]}</Badge>
					<Button size="sm" variant="primary" loading={onboarding.isPending} onClick={onboarding.start}>
						{data.connected ? 'Continue Stripe setup' : 'Connect Stripe'}
					</Button>
				</div>
			)}
		</div>
	);
}
```

At the top of `PayoutsCard`:
- Add `const [agreed, setAgreed] = useState(false);` and `const acceptTerms = useAcceptSellerTerms();`.
- Import `useState` from `react`, and `Checkbox` from `@/components/ui/checkbox` (as `TermsGate` does).
- Import `SELLER_SETUP_MESSAGES` and `SELLER_TERMS_VERSION` from `@/api-types`.

Create `src/components/payments/PaymentsSetupPrompt.tsx`:

```tsx
import { useState } from 'react';
import { LinkButton } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { useStripeConnectStatus } from '@/hooks/use-payments';
import { SELLER_SETUP_PATH } from '@/api-types';

const DISMISSED_KEY = 'estori:payments-setup-dismissed';

function readDismissed(): boolean {
	try {
		return window.localStorage.getItem(DISMISSED_KEY) === '1';
	} catch {
		return false;
	}
}

/** After sign-up: offers payments setup to a signed-in user with no Stripe account, until they set up or dismiss it. */
export function PaymentsSetupPrompt() {
	const { user } = useAuth();
	const signedIn = !!user && !user.isAnonymous;
	const status = useStripeConnectStatus(signedIn);
	const [dismissed, setDismissed] = useState(readDismissed);

	if (!signedIn || dismissed || !status.data?.configured || status.data.connected) return null;

	const dismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(DISMISSED_KEY, '1');
		} catch {
			// Browser storage may be off; the prompt just returns next visit.
		}
	};

	return (
		<div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-4 py-3 ring ring-kumo-hairline">
			<span className="text-sm text-kumo-default">Want your stores to take payments? Set up payments when you're ready to sell.</span>
			<div className="flex items-center gap-2">
				<button type="button" className="text-sm text-kumo-subtle underline" onClick={dismiss}>
					Not now
				</button>
				<LinkButton size="sm" variant="primary" href={SELLER_SETUP_PATH}>
					Set up payments
				</LinkButton>
			</div>
		</div>
	);
}
```

In `src/routes/home.tsx`, import `PaymentsSetupPrompt` from `@/components/payments/PaymentsSetupPrompt` and render `<PaymentsSetupPrompt />` right after `<BuildBox />`.

- [ ] **Step 4: Run tests and the app typecheck**

Run: `rtk proxy npx vitest run src/components/payments/payments-setup.test.ts src/routes/payments-guard.test.ts`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.app.json --noEmit`
Expected: only the 4 existing errors in `packages/artifacts-viewer`.

- [ ] **Step 5: Commit**

```bash
git add src/components/payments/ src/hooks/use-payments.ts src/routes/home.tsx
git commit -m "feat(payments): the payments setup step, with the selling terms before stripe"
```

### Task 6: The agent tells the seller what's missing

**Files:**
- Create: `worker/agents/think/payments-setup-tool.ts`
- Modify: `worker/agents/think/ThinkAgent.ts` (register the tool)
- Modify: `worker/agents/think/skills/store-checkout/SKILL.md`
- Test: `worker/agents/think/payments-setup-tool.test.ts`, `worker/agents/think/store-checkout-skill.test.ts`

**Interfaces:**
- Consumes: `sellerReadiness` (Task 2); `SellerTermsService` (Task 3); `sellerSetupStep`, `SELLER_SETUP_MESSAGES`, `SELLER_SETUP_PATH` (Task 1).
- Produces:
  - `createPaymentsSetupTool(deps: PaymentsSetupDeps): { get_payments_setup: Tool }`;
  - `PaymentsSetupDeps { readiness(): Promise<SellerReadiness | null> }`;
  - `paymentsSetupDepsFromEnv(env: Env, userId: string | null): PaymentsSetupDeps`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/agents/think/payments-setup-tool.test.ts
import { describe, expect, it } from 'vitest';
import type { ToolExecutionOptions } from 'ai';
import { createPaymentsSetupTool } from './payments-setup-tool';
import type { SellerReadiness } from '../../../shared/types/seller-setup';

const READY: SellerReadiness = { termsAccepted: true, connected: true, detailsSubmitted: true, cardPaymentsActive: true, transfersActive: true, payoutsEnabled: true };
const OPTIONS = { toolCallId: 't1', messages: [] } as unknown as ToolExecutionOptions;

async function run(readiness: SellerReadiness | null): Promise<unknown> {
	const { get_payments_setup } = createPaymentsSetupTool({ readiness: async () => readiness });
	const output = await get_payments_setup.execute?.({}, OPTIONS);
	return JSON.parse(String(output));
}

describe('get_payments_setup', () => {
	it('says a ready seller can take payments', async () => {
		expect(await run(READY)).toEqual({ ready: true });
	});

	it('names the next step and where to finish it', async () => {
		expect(await run({ ...READY, payoutsEnabled: false })).toEqual({ ready: false, nextStep: 'Add and verify a bank account', setupPath: '/profile?tab=paid' });
		expect(await run(null)).toEqual({ ready: false, nextStep: 'Accept the selling terms', setupPath: '/profile?tab=paid' });
	});
});
```

The `run(null)` case covers a seller with no account who also never accepted the terms: the deps return null, and the tool treats that as not connected and not accepted.

In `worker/agents/think/store-checkout-skill.test.ts`, add:

```ts
	it("checks the owner's payments setup before promising checkout", () => {
		expect(SKILL).toContain('get_payments_setup');
		expect(SKILL).toContain('setupPath');
	});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/agents/think/payments-setup-tool.test.ts worker/agents/think/store-checkout-skill.test.ts`
Expected: FAIL. The module isn't found, and the skill doesn't name the tool.

- [ ] **Step 3: Implement**

```ts
// worker/agents/think/payments-setup-tool.ts
/** `get_payments_setup`: whether the app's owner can take store payments yet, and the next step if not. */

import { tool, type Tool } from 'ai';
import { z } from 'zod';
import { SELLER_SETUP_MESSAGES, SELLER_SETUP_PATH, sellerSetupStep, type SellerReadiness } from '../../../shared/types/seller-setup';
import { SellerTermsService, StripeConnectService } from '../../database';
import { sellerReadiness } from '../../services/payments/stripe-client';

export interface PaymentsSetupDeps {
	/** Null when the owner is unknown. */
	readiness(): Promise<SellerReadiness | null>;
}

const NOT_STARTED: SellerReadiness = { termsAccepted: false, connected: false, detailsSubmitted: false, cardPaymentsActive: false, transfersActive: false, payoutsEnabled: false };

export function createPaymentsSetupTool(deps: PaymentsSetupDeps): { get_payments_setup: Tool } {
	return {
		get_payments_setup: tool({
			description: [
				"Check whether this app's owner can take payments in their store yet.",
				'Call it before telling the user checkout works. When ready is false, tell them their next step in plain words,',
				'and that they finish it at setupPath in Estori. Until then the store shows that checkout is unavailable.',
			].join(' '),
			inputSchema: z.object({}),
			execute: async () => {
				const step = sellerSetupStep((await deps.readiness()) ?? NOT_STARTED);
				if (step === null) return JSON.stringify({ ready: true });
				return JSON.stringify({ ready: false, nextStep: SELLER_SETUP_MESSAGES[step], setupPath: SELLER_SETUP_PATH });
			},
		}),
	};
}

/** Reads the stored flags, which `account.updated` keeps current; checkout itself always asks Stripe. */
export function paymentsSetupDepsFromEnv(env: Env, userId: string | null): PaymentsSetupDeps {
	return {
		readiness: async () => {
			if (!userId) return null;
			const [stored, termsAccepted] = await Promise.all([new StripeConnectService(env).getByUser(userId), new SellerTermsService(env).hasAccepted(userId)]);
			return sellerReadiness(stored, termsAccepted);
		},
	};
}
```

In `worker/agents/think/ThinkAgent.ts`:
- Import `createPaymentsSetupTool` and `paymentsSetupDepsFromEnv`.
- In `getTools()`, after `...createCatalogTools(catalogToolDepsFromEnv(this.env)),`, add:

```ts
			...createPaymentsSetupTool(paymentsSetupDepsFromEnv(this.env, this.getConfig<ThinkAgentConfig>()?.userId ?? null)),
```

In `worker/agents/think/skills/store-checkout/SKILL.md`, add a section before the testing paragraph (the one that starts "In the preview, the store's owner pays with Stripe's test cards"):

```markdown
## Before promising checkout

Call `get_payments_setup` once when the user asks for checkout or payments. When `ready` is false, finish building the
store as usual, then tell the user in one sentence what's left, using `nextStep`, and that they finish it in Estori at
`setupPath`. Never ask for their Stripe or bank details yourself.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/agents/think/payments-setup-tool.test.ts worker/agents/think/store-checkout-skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/payments-setup-tool.ts worker/agents/think/payments-setup-tool.test.ts worker/agents/think/ThinkAgent.ts worker/agents/think/skills/store-checkout/SKILL.md worker/agents/think/store-checkout-skill.test.ts
git commit -m "feat(agents): tell the seller what payments setup still needs"
```

### Task 7: Owner alert emails

**Files:**
- Create: `worker/services/alerts/platform-alerts.ts`
- Modify: `worker/services/email/templates.ts` (`platformAlertEmail`)
- Modify: `worker/services/catalog/CatalogOrderRunner.ts`, `worker/services/catalog/runner.ts` (alert type), `worker/services/catalog/cj/adapter.ts` (`SupplierAlert` kind type)
- Test: `worker/services/alerts/platform-alerts.test.ts`, `worker/services/email/templates.test.ts`

**Interfaces:**
- Produces:
  - `PLATFORM_ALERT_EMAILS: readonly string[]`;
  - `PLATFORM_ALERT_KINDS` and `PlatformAlertKind`;
  - `interface PlatformAlert { kind: PlatformAlertKind; subject: string; message: string; details?: ReadonlyArray<readonly [string, string]> }`;
  - `sendPlatformAlert(deps: PlatformAlertDeps, alert: PlatformAlert): Promise<'sent' | 'throttled' | 'not-sent'>`;
  - `platformAlertsFromEnv(env: Env): (alert: PlatformAlert) => Promise<void>`;
  - `platformAlertEmail(to: string, alert: PlatformAlert, label: string): OutgoingEmail`.
- `RunnerDeps.alert` keeps its shape `{ kind; orderId; message }`, with `kind: PlatformAlertKind`.
- Plans 2 and 3 append kinds to `PLATFORM_ALERT_KINDS` and `ALERT_LABELS`.

- [ ] **Step 1: Write the failing tests**

```ts
// worker/services/alerts/platform-alerts.test.ts
import { describe, expect, it } from 'vitest';
import { ALERT_THROTTLE_SECONDS, PLATFORM_ALERT_EMAILS, sendPlatformAlert, type PlatformAlert, type PlatformAlertDeps } from './platform-alerts';
import { PLATFORM_ADMIN_EMAILS } from '../auth/admin-access';
import type { OutgoingEmail } from '../email/types';

function fakeDeps(overrides: Partial<PlatformAlertDeps> = {}) {
	const kv = new Map<string, { value: string; ttl: number }>();
	const sent: OutgoingEmail[] = [];
	const logged: PlatformAlert[] = [];
	const deps: PlatformAlertDeps = {
		throttle: {
			get: async (key) => kv.get(key)?.value ?? null,
			put: async (key, value, options) => void kv.set(key, { value, ttl: options.expirationTtl }),
		},
		sender: { send: async (email) => void sent.push(email) },
		recipients: ['ops@example.test', 'owner@example.test'],
		log: (alert) => void logged.push(alert),
		...overrides,
	};
	return { deps, kv, sent, logged };
}

const ALERT: PlatformAlert = { kind: 'needs-attention', subject: 'co_1', message: 'Placement failed 6 times' };

describe('sendPlatformAlert', () => {
	it('emails every recipient and remembers the kind and subject for a day', async () => {
		const { deps, kv, sent, logged } = fakeDeps();
		expect(await sendPlatformAlert(deps, ALERT)).toBe('sent');
		expect(sent.map((email) => email.to)).toEqual(['ops@example.test', 'owner@example.test']);
		expect(sent[0].subject).toContain('co_1');
		expect(kv.get('alert:needs-attention:co_1')?.ttl).toBe(ALERT_THROTTLE_SECONDS);
		expect(logged).toEqual([ALERT]);
	});

	it('sends the same kind and subject once a day, whatever the message, and other subjects at once', async () => {
		const { deps, sent, logged } = fakeDeps();
		await sendPlatformAlert(deps, ALERT);
		expect(await sendPlatformAlert(deps, { ...ALERT, message: 'Placement failed 7 times' })).toBe('throttled');
		expect(await sendPlatformAlert(deps, { ...ALERT, subject: 'co_2' })).toBe('sent');
		expect(sent).toHaveLength(4);
		expect(logged).toHaveLength(3);
	});

	it('logs, sends nothing and throttles nothing without an email sender', async () => {
		const { deps, kv, logged } = fakeDeps({ sender: null });
		expect(await sendPlatformAlert(deps, ALERT)).toBe('not-sent');
		expect(logged).toHaveLength(1);
		expect(kv.size).toBe(0);
	});

	it('has its own recipients, apart from the admin list', () => {
		expect(PLATFORM_ALERT_EMAILS).toEqual(['alastrat@pluriza.com']);
		expect(PLATFORM_ALERT_EMAILS).not.toBe(PLATFORM_ADMIN_EMAILS);
	});
});
```

In `worker/services/email/templates.test.ts`, add:

```ts
describe('platformAlertEmail', () => {
	it('names the alert, its subject and details, and escapes them', () => {
		const email = platformAlertEmail('ops@example.test', { kind: 'not-shipped', subject: 'co_<1>', message: 'Placed 6 days ago', details: [['Order', 'co_<1>']] }, "An order hasn't shipped");
		expect(email.to).toBe('ops@example.test');
		expect(email.subject).toBe("Estori alert: An order hasn't shipped (co_<1>)");
		expect(email.text).toContain('Placed 6 days ago');
		expect(email.text).toContain('Order: co_<1>');
		expect(email.html).toContain('co_&lt;1&gt;');
	});
});
```

Add `platformAlertEmail` to that file's import from `./templates`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/alerts/platform-alerts.test.ts worker/services/email/templates.test.ts`
Expected: FAIL. The module isn't found, and `platformAlertEmail` isn't exported.

- [ ] **Step 3: Implement**

In `worker/services/email/templates.ts`, import `type PlatformAlert` from `'../alerts/platform-alerts'` and add:

```ts
/** An alert for the people who run Estori: what happened, to which order or product, and what's known. */
export function platformAlertEmail(to: string, alert: PlatformAlert, label: string): OutgoingEmail {
	return renderEmail({
		to,
		subject: `Estori alert: ${label} (${alert.subject})`,
		heading: label,
		body: alert.message,
		details: [['About', alert.subject], ...(alert.details ?? [])],
		footer: 'Each alert repeats at most once a day for the same order or product.',
	});
}
```

```ts
// worker/services/alerts/platform-alerts.ts
/** Alerts for the people who run Estori: logged always, emailed once a day per kind and subject. */

import { createLogger } from '../../logger';
import { createEmailSender } from '../email/sender';
import { platformAlertEmail } from '../email/templates';
import type { EmailSender } from '../email/types';

/** Who receives alerts; apart from the admin list, so an admin email change doesn't move them. */
export const PLATFORM_ALERT_EMAILS: readonly string[] = ['alastrat@pluriza.com'];

export const ALERT_THROTTLE_SECONDS = 24 * 60 * 60;

export const PLATFORM_ALERT_KINDS = [
	'needs-attention',
	'refund-failed',
	'runner-step-failed',
	'held-order',
	'low-balance',
	'supplier-account',
	'lines-mismatch',
	'supplier-cancelled',
	'refresh-stalled',
	'not-shipped',
	'not-delivered',
] as const;
export type PlatformAlertKind = (typeof PLATFORM_ALERT_KINDS)[number];

const ALERT_LABELS: Readonly<Record<PlatformAlertKind, string>> = {
	'needs-attention': 'A catalog order needs you',
	'refund-failed': 'A refund failed',
	'runner-step-failed': 'A catalog order step failed',
	'held-order': 'The supplier is holding an order',
	'low-balance': 'The supplier balance is low',
	'supplier-account': 'The supplier account needs attention',
	'lines-mismatch': "A supplier order doesn't match what was sold",
	'supplier-cancelled': 'The supplier cancelled an order',
	'refresh-stalled': 'The catalog stopped refreshing',
	'not-shipped': "An order hasn't shipped",
	'not-delivered': "An order hasn't been delivered",
};

export interface PlatformAlert {
	kind: PlatformAlertKind;
	/** What the alert is about, such as an order or product id; one email a day per kind and subject. */
	subject: string;
	message: string;
	details?: ReadonlyArray<readonly [string, string]>;
}

export interface PlatformAlertDeps {
	throttle: {
		get(key: string): Promise<string | null>;
		put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
	};
	sender: EmailSender | null;
	recipients: readonly string[];
	log(alert: PlatformAlert): void;
}

export async function sendPlatformAlert(deps: PlatformAlertDeps, alert: PlatformAlert): Promise<'sent' | 'throttled' | 'not-sent'> {
	deps.log(alert);
	const key = `alert:${alert.kind}:${alert.subject}`;
	if (await deps.throttle.get(key)) return 'throttled';
	if (!deps.sender || deps.recipients.length === 0) return 'not-sent';
	for (const to of deps.recipients) await deps.sender.send(platformAlertEmail(to, alert, ALERT_LABELS[alert.kind]));
	await deps.throttle.put(key, '1', { expirationTtl: ALERT_THROTTLE_SECONDS });
	return 'sent';
}

const logger = createLogger('PlatformAlerts');

/** Never throws: an alert that can't be emailed is still logged, and the caller carries on. */
export function platformAlertsFromEnv(env: Env): (alert: PlatformAlert) => Promise<void> {
	const deps: PlatformAlertDeps = {
		throttle: env.VibecoderStore,
		sender: createEmailSender(env),
		recipients: PLATFORM_ALERT_EMAILS,
		log: (alert) => logger.error('Platform alert', alert),
	};
	return async (alert) => {
		try {
			await sendPlatformAlert(deps, alert);
		} catch (error) {
			logger.error('Could not email a platform alert', { alert, error });
		}
	};
}
```

`env.VibecoderStore` is a `KVNamespace`. Its `get(key)` and `put(key, value, { expirationTtl })` match the `throttle` shape. If TypeScript rejects the assignment because of overloads, pass `{ get: (key) => env.VibecoderStore.get(key), put: (key, value, options) => env.VibecoderStore.put(key, value, options) }`.

Wire the catalog code:
- In `worker/services/catalog/runner.ts`, import `type PlatformAlertKind` and type `alert(alert: { kind: PlatformAlertKind; orderId: string; message: string }): Promise<void>;`.
- In `worker/services/catalog/cj/adapter.ts`, type `SupplierAlert.kind` as `Extract<PlatformAlertKind, 'held-order' | 'low-balance' | 'supplier-account' | 'lines-mismatch'>`.
- In `worker/services/catalog/CatalogOrderRunner.ts`, replace the logging-only `alert` in `runnerDeps` with:

```ts
	const sendAlert = platformAlertsFromEnv(env);
	const alert: RunnerDeps['alert'] = (event) => sendAlert({ kind: event.kind, subject: event.orderId, message: event.message });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/alerts worker/services/email/templates.test.ts worker/services/catalog/runner.test.ts worker/services/catalog/cj`
Expected: PASS.

Run: `rtk proxy npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add worker/services/alerts/ worker/services/email/templates.ts worker/services/email/templates.test.ts worker/services/catalog/CatalogOrderRunner.ts worker/services/catalog/runner.ts worker/services/catalog/cj/adapter.ts
git commit -m "feat(alerts): email owner alerts once a day per kind and subject"
```

### Task 8: Cancellation alerts and the daily catalog health check

**Files:**
- Modify: `worker/services/catalog/runner.ts` (`sync`)
- Create: `worker/services/catalog/health.ts`
- Modify: `worker/database/services/CatalogProductService.ts` (`refreshHealth`), `worker/database/services/CatalogOrderService.ts` (`lateItems`)
- Modify: `worker/services/catalog/scheduler.ts`
- Test: `worker/services/catalog/runner.test.ts`, `worker/services/catalog/health.test.ts`

**Interfaces:**
- Consumes: `PlatformAlert`, `platformAlertsFromEnv` (Task 7).
- Produces:
  - `CATALOG_HEALTH_CRON = '35 6 * * *'`;
  - `runCatalogHealth(deps: CatalogHealthDeps, nowMs: number): Promise<number>`, returning the number of alerts raised;
  - `CatalogProductService.refreshHealth(): Promise<{ activeProducts: number; lastRefreshAt: Date | null }>`;
  - `CatalogOrderService.lateItems(status: 'placed' | 'shipped', before: Date): Promise<string[]>`, returning order ids, distinct, up to 100.

- [ ] **Step 1: Write the failing tests**

In `worker/services/catalog/runner.test.ts`, change 'refunds items the supplier cancels after payment' to destructure `alerts` as well. Then add at its end:

```ts
		expect(alerts).toContain('supplier-cancelled');
```

```ts
// worker/services/catalog/health.test.ts
import { describe, expect, it } from 'vitest';
import { runCatalogHealth, type CatalogHealthDeps } from './health';
import type { PlatformAlert } from '../alerts/platform-alerts';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function fakeDeps(overrides: Partial<CatalogHealthDeps> = {}) {
	const alerts: PlatformAlert[] = [];
	const asked: Array<{ status: string; before: number }> = [];
	const deps: CatalogHealthDeps = {
		refreshHealth: async () => ({ activeProducts: 6, lastRefreshAt: new Date(NOW - 2 * 60 * 60 * 1000) }),
		lateItems: async (status, before) => {
			asked.push({ status, before: before.getTime() });
			return [];
		},
		alert: async (alert) => void alerts.push(alert),
		...overrides,
	};
	return { deps, alerts, asked };
}

describe('runCatalogHealth', () => {
	it('raises nothing for a healthy catalog, and looks back 5 days for shipping and 30 for delivery', async () => {
		const { deps, alerts, asked } = fakeDeps();
		expect(await runCatalogHealth(deps, NOW)).toBe(0);
		expect(alerts).toEqual([]);
		expect(asked).toEqual([
			{ status: 'placed', before: NOW - 5 * DAY },
			{ status: 'shipped', before: NOW - 30 * DAY },
		]);
	});

	it('alerts when no product refreshed in 24 hours, or never', async () => {
		for (const lastRefreshAt of [new Date(NOW - DAY - 1), null]) {
			const { deps, alerts } = fakeDeps({ refreshHealth: async () => ({ activeProducts: 6, lastRefreshAt }) });
			await runCatalogHealth(deps, NOW);
			expect(alerts.map((alert) => [alert.kind, alert.subject])).toEqual([['refresh-stalled', 'catalog']]);
		}
	});

	it('stays quiet about refreshes while the catalog has no active products', async () => {
		const { deps, alerts } = fakeDeps({ refreshHealth: async () => ({ activeProducts: 0, lastRefreshAt: null }) });
		await runCatalogHealth(deps, NOW);
		expect(alerts).toEqual([]);
	});

	it('alerts once per late order, for shipping and for delivery', async () => {
		const { deps, alerts } = fakeDeps({ lateItems: async (status) => (status === 'placed' ? ['co_1', 'co_2'] : ['co_3']) });
		expect(await runCatalogHealth(deps, NOW)).toBe(3);
		expect(alerts.map((alert) => [alert.kind, alert.subject])).toEqual([
			['not-shipped', 'co_1'],
			['not-shipped', 'co_2'],
			['not-delivered', 'co_3'],
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run worker/services/catalog/runner.test.ts worker/services/catalog/health.test.ts`
Expected: FAIL. `supplier-cancelled` is missing from the alerts, and `./health` isn't found.

- [ ] **Step 3: Implement**

In `worker/services/catalog/runner.ts`'s `sync`, right after `await deps.store.patchItems(patches);`, add:

```ts
			if (update.kind === 'cancelled') await deps.alert({ kind: 'supplier-cancelled', orderId: state.orderId, message: update.reason });
```

```ts
// worker/services/catalog/health.ts
/** The daily catalog health check: a stalled refresh, and orders late to ship or to arrive. */

import type { PlatformAlert } from '../alerts/platform-alerts';

export const CATALOG_HEALTH_CRON = '35 6 * * *';
const DAY_MS = 24 * 60 * 60 * 1000;
export const REFRESH_STALLED_AFTER_MS = DAY_MS;
export const NOT_SHIPPED_AFTER_MS = 5 * DAY_MS;
export const NOT_DELIVERED_AFTER_MS = 30 * DAY_MS;

export interface CatalogHealthDeps {
	refreshHealth(): Promise<{ activeProducts: number; lastRefreshAt: Date | null }>;
	/** Distinct catalog order ids with an item in this status since before this time. */
	lateItems(status: 'placed' | 'shipped', before: Date): Promise<string[]>;
	alert(alert: PlatformAlert): Promise<void>;
}

/** Returns how many alerts it raised; the alert service throttles repeats to one a day each. */
export async function runCatalogHealth(deps: CatalogHealthDeps, nowMs: number): Promise<number> {
	const alerts: PlatformAlert[] = [];
	const refresh = await deps.refreshHealth();
	if (refresh.activeProducts > 0 && (refresh.lastRefreshAt === null || nowMs - refresh.lastRefreshAt.getTime() > REFRESH_STALLED_AFTER_MS)) {
		alerts.push({ kind: 'refresh-stalled', subject: 'catalog', message: 'No catalog product refreshed in the last 24 hours, so offers will stop selling after 72.' });
	}
	for (const orderId of await deps.lateItems('placed', new Date(nowMs - NOT_SHIPPED_AFTER_MS))) {
		alerts.push({ kind: 'not-shipped', subject: orderId, message: 'An item was placed with the supplier more than 5 days ago and has no tracking yet.' });
	}
	for (const orderId of await deps.lateItems('shipped', new Date(nowMs - NOT_DELIVERED_AFTER_MS))) {
		alerts.push({ kind: 'not-delivered', subject: orderId, message: 'An item shipped more than 30 days ago and hasn\'t been delivered.' });
	}
	for (const alert of alerts) await deps.alert(alert);
	return alerts.length;
}
```

In `worker/database/services/CatalogProductService.ts`, add a method using the file's existing drizzle imports (add `count`, `max` and `eq` from `drizzle-orm` if missing):

```ts
    /** How many products sell, and when any product last refreshed from the supplier. */
    async refreshHealth(): Promise<{ activeProducts: number; lastRefreshAt: Date | null }> {
        const row = await this.database
            .select({ active: count(), last: max(schema.catalogProducts.detailsRefreshedAt) })
            .from(schema.catalogProducts)
            .where(eq(schema.catalogProducts.status, 'active'))
            .get();
        return { activeProducts: row?.active ?? 0, lastRefreshAt: row?.last ?? null };
    }
```

Check the schema's property names for `details_refreshed_at` and `status` on `catalogProducts`, and use them as written there.

In `worker/database/services/CatalogOrderService.ts`, add, again with the file's drizzle imports (`and`, `eq`, `lt`):

```ts
    /** Orders with an item in this status since before `before`: late to ship ('placed') or to arrive ('shipped'). */
    async lateItems(status: 'placed' | 'shipped', before: Date): Promise<string[]> {
        const rows = await this.database
            .selectDistinct({ orderId: schema.catalogOrderItems.orderId })
            .from(schema.catalogOrderItems)
            .where(and(eq(schema.catalogOrderItems.status, status), lt(schema.catalogOrderItems.updatedAt, before)))
            .limit(100)
            .all();
        return rows.map((row) => row.orderId);
    }
```

In `worker/services/catalog/scheduler.ts`:
- Import `CATALOG_HEALTH_CRON` and `runCatalogHealth` from `./health`, and `platformAlertsFromEnv` from `'../alerts/platform-alerts'`.
- Add to `runCatalogSchedule`:

```ts
	if (cron === CATALOG_HEALTH_CRON) {
		const products = new CatalogProductService(env);
		const orders = new CatalogOrderService(env);
		const raised = await runCatalogHealth(
			{ refreshHealth: () => products.refreshHealth(), lateItems: (status, before) => orders.lateItems(status, before), alert: platformAlertsFromEnv(env) },
			Date.now(),
		);
		if (raised > 0) logger.warn('Catalog health check raised alerts', { raised });
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run worker/services/catalog/runner.test.ts worker/services/catalog/health.test.ts worker/database/services/CatalogOrderService.test.ts worker/database/services/CatalogProductService.test.ts scripts/estori-config.test.ts`
Expected: PASS. The config test already asserts the `35 6 * * *` cron.

- [ ] **Step 5: Commit**

```bash
git add worker/services/catalog/runner.ts worker/services/catalog/runner.test.ts worker/services/catalog/health.ts worker/services/catalog/health.test.ts worker/database/services/CatalogProductService.ts worker/database/services/CatalogOrderService.ts worker/services/catalog/scheduler.ts
git commit -m "feat(catalog): alert on supplier cancellations, a stalled refresh and late orders"
```

### Task 9: The legal pages for selling in your own store

**Files:**
- Modify: `src/content/legal/terms.md`, `src/content/legal/privacy.md`, `src/content/legal/refunds.md`
- Modify: `shared/types/legal.ts` (`TERMS_VERSION`)
- Test: `src/content/legal/legal-documents.test.ts`

**Interfaces:**
- Consumes: `SELLER_TERMS_VERSION` (Task 1). The Terms page's section 10 is what the Payouts card links to.
- Produces: `TERMS_VERSION = '2026-10-16'`. Every signed-in user agrees again through the existing `TermsGate`.

- [ ] **Step 1: Write the failing test**

Add to `src/content/legal/legal-documents.test.ts`. Add `SELLER_TERMS_VERSION` to the imports from `'../../../shared/types/seller-setup'`, and `SUPPLIER_NAMES` from `'../../routes/copy-rules'`.

```ts
	it('adds selling in your own store as section 10, in the version sellers agree to', () => {
		const terms = LEGAL_DOCUMENTS.terms;
		expect(terms.version).toBe('2026-10-16');
		expect(SELLER_TERMS_VERSION).toBe(terms.version);
		expect(terms.body).toContain('## 10. Selling in your own store');
		expect(terms.body).toContain('## 21. Contact');
		for (const promise of [
			'You are the merchant of record for your store',
			'you pay the whole refund',
			'the dispute fee Stripe charges',
			'from your later sales',
			'Stripe may debit the bank account',
			'$2 for each month in which you receive a payout',
			'0.25% plus 25 cents for each payout',
			'New sellers start with lower limits',
		]) {
			expect(terms.body).toContain(promise);
		}
		expect(terms.body).toContain('Globalink is the merchant of record for purchases of paid sites');
	});

	it("tells shoppers whose data goes where, and leaves store purchases to the store's policy", () => {
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('**Fulfillment partners**');
		expect(LEGAL_DOCUMENTS.privacy.body).toContain('Shoppers who pay at a store');
		expect(LEGAL_DOCUMENTS.refunds.body).toContain("follow that store's own refund policy");
		for (const slug of LEGAL_SLUGS) {
			for (const name of SUPPLIER_NAMES) expect(LEGAL_DOCUMENTS[slug].body.toLowerCase()).not.toContain(name);
		}
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run src/content/legal/legal-documents.test.ts`
Expected: FAIL. The version is still 2026-10-13 and section 10 is missing.

- [ ] **Step 3: Implement**

In `shared/types/legal.ts`, set `export const TERMS_VERSION = '2026-10-16';`.

In `src/content/legal/terms.md`:
- Set the front matter to `version: 2026-10-16` and `updated: October 16, 2026`.
- Renumber sections 10 to 20 as 11 to 21. Only sections 5 and 6 are referenced by number in the text, so no other edits are needed.
- Insert after section 9:

```markdown
## 10. Selling in your own store

This section applies when a store you build on Estori takes payments from shoppers. Sections 7 to 9 cover paid sites.

**You are the seller.** You are the merchant of record for your store's sales. You sell to your shoppers under your store's name, and you're responsible for your products, prices and store policies, for delivering orders and for answering your shoppers. We provide the software, take payments for you through Stripe and, for products you sell from the Estori catalog, buy and ship them for you.

**Setting up payments.** Your store takes payments only after you accept these terms, finish Stripe's setup with card payments active, and add a bank account Stripe has verified.

**What each sale costs.** We keep our fee from each sale: card processing, plus the catalog price of any catalog products in the order. When a card costs more to process than our standard rate, for example a card from another country, we take the difference from that sale. You also pay what Stripe charges for your account, currently $2 for each month in which you receive a payout, and 0.25% plus 25 cents for each payout. You choose how often you're paid.

**Refunds you give.** When you refund a shopper, you pay the whole refund, including the catalog price and card processing of what you refund. A refund goes through only when your Stripe balance can cover it.

**Disputes.** If a shopper disputes a payment with their bank, you pay the disputed amount and the dispute fee Stripe charges. We take the amount back from the sale when the dispute opens, and return it if the dispute is decided in your favor.

**How we recover what you owe.** We recover what you owe under this section from the sale it relates to, from your Stripe balance and from your later sales. If your Stripe balance becomes negative, Stripe may debit the bank account you connected.

**Payouts and limits.** We set how long your sales wait before payout, and how large your store's orders and weekly sales can be, based on your history with us. New sellers start with lower limits and a longer wait, and both improve as your record grows. A store that reaches a limit stops taking new orders until the limit allows them again.

**Orders we hold.** We may hold an order that our payment checks flag as risky before we buy its catalog products. If we can't clear it within 24 hours, we refund its catalog products to the shopper.
```

In `src/content/legal/privacy.md`:
- Set the front matter to `version: 2026-10-16` and `updated: October 16, 2026`.
- In section 3, replace the Stripe bullet and add the fulfillment bullet after it:

```markdown
- **Stripe**: payments, seller onboarding and payouts. Stripe receives buyers', shoppers' and sellers' email addresses, shoppers' shipping addresses, and the payment and payout details people give Stripe directly.
- **Fulfillment partners**: when a store sells products from the Estori catalog, the shopper's name, shipping address, email and phone number go to the partner that ships the order.
```

- At the end of section 10 ("Your store's visitors"), add:

```markdown
Shoppers who pay at a store give their name, email, shipping address and card details to Stripe at checkout. We receive the name, email and shipping address to record the order, deliver catalog products and show the order to the store's owner, who sells to them.
```

In `src/content/legal/refunds.md`:
- Set the front matter to `version: 2026-10-16` and `updated: October 16, 2026`.
- Append to the first paragraph:

```markdown
 Purchases from a store built on Estori are sold by that store's owner, and follow that store's own refund policy.
```

Keep it in the same paragraph, joined by the leading space.

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run src/content/legal src/components/auth worker/database/terms-schema.test.ts src/lib/legal-document.test.ts`
Expected: PASS. `legal-document.test.ts` uses its own literal sample and doesn't depend on `TERMS_VERSION`. If an auth test pins `2026-10-13`, update it to `TERMS_VERSION`.

- [ ] **Step 5: Commit**

```bash
git add src/content/legal/ shared/types/legal.ts
git commit -m "docs(legal): selling in your own store, shoppers' data, and store refunds"
```

---

## Finish

- Run the whole suite in the batches from the Global Constraints, and `tsc` for the worker and app configs.
- **Local check on port 8100:**
  1. The creator test account's Payouts card shows "Accept the selling terms".
  2. Agreeing leads to Stripe onboarding.
  3. A store preview's checkout answers "This store can't take payments right now" until card payments and the bank account are active.
  4. Have the owner finish the test seller's card payments with Stripe's test identity values. Claude doesn't enter them.
- Ledger every deviation as a `Ruling:` line. Then hand off to `2026-10-16-seller-money-rules.md`.
