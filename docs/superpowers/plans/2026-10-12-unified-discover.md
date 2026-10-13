# One Discover Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Discover and templates into one gallery. Every published (public) site can be reused to start a new app; free sites copy the creator's latest deploy, and paid sites copy an admin-approved frozen version.

**Architecture:**
- **Publishing:** the existing visibility endpoint becomes the single publishing action. It takes reuse consent, a category and a price.
- **Paid sites:** a paid publish reuses the `feat/templates` snapshot, capture and review machinery. The `templates*` tables now model one paid listing per app.
- **Using a site:** the start is resolved in the worker before any app is created. The worker hands the new Think agent the files to copy: the live deploy for free sites, the R2 snapshot for paid ones. Seeding, deploy and the personalization turn work as on `feat/templates`.

**Tech Stack:**
- Cloudflare Workers with Hono routes, D1 and drizzle, R2, and Durable Objects (the Think agent and SpaceDO);
- React 19, TanStack Query 5 and Kumo UI;
- vitest on the Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-12-unified-discover-design.md`. It replaces `docs/superpowers/specs/2026-10-12-templates-design.md`, the spec behind the earlier commits on this branch.

## Global Constraints

**Repo rules and commands:**
- Follow `CLAUDE.md`:
  - never use `any`;
  - the frontend imports types only from `@/api-types`;
  - no emojis, and no TODOs or placeholders;
  - keep comments concise and about purpose;
  - React components are PascalCase.tsx, and utilities and hooks kebab-case.ts.
- Never stage or commit `wrangler.jsonc`, `.dev.vars` or `bun.lockb`, which are local-only changes in this worktree. Commit with explicit paths.
- **Commit messages:** use conventional commits, and end each one with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** run only the files a step names (`npx vitest run <files>`). Never run the whole suite in one command; it exhausts local ports.
- **Typecheck:**
  - worker: `npx tsc -p tsconfig.worker.json --noEmit`;
  - frontend: `npx tsc -p tsconfig.app.json --noEmit`, whose only accepted errors are the 4 pre-existing ones in `packages/artifacts-viewer`.

**Values from the spec, used verbatim:**
- Prices in cents: `0, 900, 1900, 2900, 4900`. Purchases are test mode only (`provider: 'test'`, no charge).
- Categories: `store, landing, portfolio, restaurant, saas, services, other`. The category is optional and is stored as null when not chosen.
- Snapshot limits: 500 files and 10 MB. The exclusions and secret patterns are unchanged from `worker/services/templates/snapshot.ts`.
- **User-facing messages** (exact text):
  - `This site is no longer available`
  - `Buy this site before using it`
  - `This site isn't available to use yet`
  - `This site can't be reused right now`
  - `Confirm that others may copy and adapt this site`
  - `Sites can have at most 500 files and 10 MB to be published`
  - `{path} looks like it contains a secret key; remove it and redeploy`
- **Personalization:** the hidden instruction for the first turn is `This app started as a copy of the site {title}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: {description}. Keep none of the original site's copy. Then deploy.`
- **Migration 0009** is regenerated, not stacked on. It keeps `UPDATE users SET role = 'admin' WHERE email = 'alastrat@pluriza.com'`.

**Typecheck across tasks:**
- Tasks 1-8 change the backend in layers, so the worker typecheck is expected to fail between them. It must be clean at the end of Task 8.
- Tasks 9-13 change the frontend in layers, so the app typecheck is expected to fail between them. It must be clean, apart from the 4 accepted errors, at the end of Task 13.
- Every task's own named tests must pass when the task ends.

## Rulings made while planning

Each ends with its cost if wrong.

- **Use count:**
  - Discover already counts how many apps were made from an app (`forkCount`: apps whose `parent_app_id` is that app). Reuse sets `parentAppId`, so that count is the use count. No `reuseCount` column is added.
  - Cost: a reused app that is later deleted stops counting.
- **Use button on Discover cards:**
  - Cards stay plain links to the app page; a button inside the card's `<a>` would be invalid HTML. Cards show the price badge and use count, and "Use this site" lives on the app page. The home strip links to the app page with `?use=1`, which opens the use dialog directly.
  - Cost: one extra click from Discover.
- **Knowing an app is reusable without asking its agent:**
  - Think deploys now stamp `apps.lastDeployedAt`, which was never written before.
  - The app details endpoint, which already calls the agent, also stamps it for apps deployed before this change.
  - Discover's reusable flag and the home strip read that column.
  - Cost: an app published before this change shows no badge or strip entry until someone opens its page or the owner redeploys.
- **Who reads the files:** the worker reads them (live tree or R2 snapshot) during the start request and passes them to the agent in its init arguments, so the agent never reaches into another app's workspace.
  - Cost: up to 10 MB passes through one RPC call.
- **Consent on later changes:** the dialog pre-ticks the consent box when an already-public app changes its settings, because the owner gave consent when publishing.
  - Cost: none; the API still requires `reuseConsent: true`.

## Review Focus

These failure modes are the most likely to hurt someone using this; each is pinned by a test in the task named.

1. **A paid publish that fails** (capture, snapshot or R2) on an app that is already public and free must leave it reusable for free. Task 3 has the test `publish.test.ts > keeps a free public site reusable when the paid submission fails`.
2. **Switching a paid site back to free while an update is in review:** the update is withdrawn and the site is reusable live at once. Task 3 has the test `publish.test.ts > unlists the paid listing when the owner switches to free`. Task 5 has `TemplateService.setListingStatus`, which withdraws pending versions in the same batch.
3. **An admin-removed site opened by a direct link:** using it returns 404 "This site is no longer available", and no app is created. Task 2 has `reuse.test.ts > hides removed sites`, and Task 4 has `start.test.ts > refuses a site an admin removed`.
4. **An owner using their own paid site before its first approval** gets 409, not 402 and not a free copy. Task 2 has `reuse.test.ts > keeps a paid site unusable until its first approval, even for the owner`.
5. **Reusing a site published before this change** that contains a `.env` file or a hard-coded key never yields an app with that content. A key fails with "This site can't be reused right now"; env files are dropped. Task 4 has `start.test.ts > drops env files from a free copy` and `start.test.ts > refuses a free site whose files contain a secret`.

---

### Task 1: Data model and migration 0009

**Files:**
- Modify: `shared/types/templates.ts`
- Modify: `worker/database/schema.ts`
- Delete and regenerate: `migrations/0009_bored_warstar.sql`, `migrations/meta/0009_snapshot.json`, and the idx-9 entry of `migrations/meta/_journal.json`
- Test: `worker/database/templates-schema.test.ts` (rewritten)

**Interfaces:**
- Produces:
  - `DISCOVER_PRICING_FILTERS` and `type DiscoverPricing` in `shared/types/templates.ts`.
  - `apps` columns `category`, `reuseConsentAt`, `removedFromDiscoverAt`, `removedFromDiscoverBy` and `removedFromDiscoverReason`.
  - `templates` columns `id`, `sourceAppId` (not null, unique), `creatorUserId`, `currentVersionId`, `status` (default `'listed'`), `priceCents` (approved price, default 0), `createdAt` and `updatedAt`.
  - `templateVersions.priceCents` (not null).
  - `templatePurchases.templateId` (nullable, on delete set null).

- [ ] **Step 1: Write the failing schema test**

Replace the whole of `worker/database/templates-schema.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';

const migrations = import.meta.glob<string>('/migrations/*.sql', {
	query: '?raw',
	import: 'default',
	eager: true,
});
const allMigrationSql = Object.values(migrations).join('\n');

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
	return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
	return getTableConfig(table).columns.map((column) => column.name);
}

describe('publishing schema', () => {
	it('gives every user a role that defaults to user', () => {
		expect(schema.users.role.enumValues).toEqual(['user', 'admin']);
		expect(schema.users.role.notNull).toBe(true);
		expect(schema.users.role.default).toBe('user');
	});

	it('stores the publishing choices and admin removal on the app', () => {
		expect(schema.apps.category.enumValues).toEqual([
			'store',
			'landing',
			'portfolio',
			'restaurant',
			'saas',
			'services',
			'other',
		]);
		expect(schema.apps.category.notNull).toBe(false);
		expect(schema.apps.reuseConsentAt.name).toBe('reuse_consent_at');
		expect(schema.apps.removedFromDiscoverAt.notNull).toBe(false);
		expect(schema.apps.removedFromDiscoverBy.name).toBe('removed_from_discover_by');
		expect(schema.apps.removedFromDiscoverReason.name).toBe('removed_from_discover_reason');
		expect(schema.apps.fromTemplateVersionId.notNull).toBe(false);
	});

	it('keeps one paid listing per app and takes its name from the app', () => {
		expect(schema.templates.sourceAppId.notNull).toBe(true);
		expect(indexNamed(schema.templates, 'templates_source_app_unique_idx')?.config.unique).toBe(true);
		for (const dropped of ['slug', 'name', 'description', 'category', 'use_count']) {
			expect(columnNames(schema.templates)).not.toContain(dropped);
		}
		expect(schema.templates.status.default).toBe('listed');
		expect(schema.templates.priceCents.default).toBe(0);
	});

	it('records the price each version asks for', () => {
		expect(schema.templateVersions.priceCents.notNull).toBe(true);
		expect(
			indexNamed(schema.templateVersions, 'template_versions_template_version_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templateVersions.status.default).toBe('pending');
	});

	it('keeps purchases when a listing is deleted', () => {
		expect(schema.templatePurchases.templateId.notNull).toBe(false);
		const listingKey = getTableConfig(schema.templatePurchases).foreignKeys.find(
			(key) => key.reference().foreignTable === schema.templates,
		);
		expect(listingKey?.onDelete).toBe('set null');
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test']);
	});

	it('ships the tables and columns in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `templates`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_versions`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_purchases`');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `category` text');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `reuse_consent_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `removed_from_discover_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `from_template_version_id` text');
		expect(allMigrationSql).toMatch(/ALTER TABLE `users` ADD `role` text[^;]*DEFAULT 'user'/);
	});

	it('promotes the platform admin account', () => {
		expect(allMigrationSql).toContain(
			"UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';",
		);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run worker/database/templates-schema.test.ts`
Expected: FAIL. `schema.apps.category` is undefined, and `templates` still has `slug`.

- [ ] **Step 3: Add the pricing filter values**

In `shared/types/templates.ts`, add after the `TEMPLATE_PAYMENT_PROVIDERS` block:

```ts
/** Discover's pricing filter. */
export const DISCOVER_PRICING_FILTERS = ['all', 'free', 'paid'] as const;
export type DiscoverPricing = (typeof DISCOVER_PRICING_FILTERS)[number];
```

- [ ] **Step 4: Change the schema**

In `worker/database/schema.ts`, in the `apps` table, replace:

```ts
    parentAppId: text('parent_app_id'), // If forked from another app
    fromTemplateVersionId: text('from_template_version_id'), // Template version this app started from
```

with:

```ts
    parentAppId: text('parent_app_id'), // Forked from, or started from by reuse
    fromTemplateVersionId: text('from_template_version_id'), // Approved paid version this app was copied from

    // Discover: the owner's category and consent to reuse, and admin removal.
    category: text('category', { enum: TEMPLATE_CATEGORIES }),
    reuseConsentAt: integer('reuse_consent_at', { mode: 'timestamp' }),
    removedFromDiscoverAt: integer('removed_from_discover_at', { mode: 'timestamp' }),
    removedFromDiscoverBy: text('removed_from_discover_by'),
    removedFromDiscoverReason: text('removed_from_discover_reason'),
```

Replace the whole `templates` table definition, including its doc comment, with:

```ts
/**
 * Paid listings - one per app whose owner set a price. Name, description and
 * category come from the app; the approved version and its price live here.
 */
export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    sourceAppId: text('source_app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
    creatorUserId: text('creator_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // Null until an admin approves the first version.
    currentVersionId: text('current_version_id'),
    // `unlisted` while the app is free again; a new listing starts unlisted until its first submission is stored.
    status: text('status', { enum: TEMPLATE_LISTING_STATUSES }).notNull().default('listed'),
    // The approved version's price in US cents; 0 before the first approval.
    priceCents: integer('price_cents').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    creatorIdx: index('templates_creator_idx').on(table.creatorUserId),
    sourceAppIdx: uniqueIndex('templates_source_app_unique_idx').on(table.sourceAppId),
}));
```

In `templateVersions`, add after `mobileShotKey`:

```ts
    // The price this submission asks for; approval copies it to the listing.
    priceCents: integer('price_cents').notNull(),
```

In `templatePurchases`, replace the `templateId` line with:

```ts
    // Kept when the listing is deleted with its app.
    templateId: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
```

and change its doc comment to: `Template purchases table - Who may use a paid site. Recorded with the 'test' provider (no charge) until a payment provider is connected.`

- [ ] **Step 5: Regenerate migration 0009**

Run:

```bash
rm migrations/0009_bored_warstar.sql migrations/meta/0009_snapshot.json
python3 -I - <<'EOF'
import json
path = 'migrations/meta/_journal.json'
journal = json.load(open(path))
journal['entries'] = [entry for entry in journal['entries'] if entry['idx'] != 9]
open(path, 'w').write(json.dumps(journal, indent=2) + '\n')
EOF
npm run db:generate
python3 -I - <<'EOF'
import glob
[path] = glob.glob('migrations/0009_*.sql')
with open(path, 'a') as f:
    f.write("\n--> statement-breakpoint\nUPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';\n")
print(path)
EOF
```

Expected: one new `migrations/0009_<name>.sql` containing:
- `CREATE TABLE` for `template_purchases`, `template_versions` and `templates`, with no `slug` column;
- `ALTER TABLE apps ADD` for `category`, `from_template_version_id`, `removed_from_discover_at`, `removed_from_discover_by`, `removed_from_discover_reason` and `reuse_consent_at`;
- `ALTER TABLE users ADD role`;
- the appended `UPDATE`.

`git diff migrations/meta/_journal.json` shows only the idx-9 entry's `tag` and `when` changing.

- [ ] **Step 6: Reset the local database to the new 0009**

Stop the local dev server first. Then run:

```bash
npx wrangler d1 execute vibesdk-db --local --command "DROP TABLE IF EXISTS template_purchases; DROP TABLE IF EXISTS template_versions; DROP TABLE IF EXISTS templates; ALTER TABLE apps DROP COLUMN from_template_version_id; ALTER TABLE users DROP COLUMN role; DELETE FROM d1_migrations WHERE name = '0009_bored_warstar.sql';"
npm run db:migrate:local
npx wrangler d1 execute vibesdk-db --local --command "UPDATE users SET role = 'admin' WHERE email = 'templates-admin@example.test';"
```

Expected: the migrate command applies exactly one migration, the new 0009. The last command restores the local test admin (local only, not in a migration).

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run worker/database/templates-schema.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Commit**

```bash
git add shared/types/templates.ts worker/database/schema.ts worker/database/templates-schema.test.ts migrations/
git commit -m "feat(discover): store publishing choices on apps and paid listings per app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Publishing and reuse rules

**Files:**
- Create: `worker/services/templates/reuse.ts`
- Create: `worker/services/templates/reuse.test.ts`
- Modify: `worker/services/templates/catalog.ts` (rewritten)
- Modify: `worker/services/templates/catalog.test.ts` (rewritten)
- Modify: `worker/services/templates/snapshot.ts`
- Modify: `worker/services/templates/snapshot.test.ts` (append)
- Modify: `worker/services/templates/submit.ts` (one message)

**Interfaces:**
- Consumes: `DISCOVER_PRICING_FILTERS` and `DiscoverPricing` (Task 1).
- Produces, from `reuse.ts`:
  - the message constants `SITE_UNAVAILABLE_MESSAGE`, `SITE_PURCHASE_REQUIRED_MESSAGE`, `SITE_NOT_YET_AVAILABLE_MESSAGE`, `SITE_NOT_REUSABLE_MESSAGE`, `REUSE_CONSENT_REQUIRED_MESSAGE`, `NOT_THINK_REASON` and `NOT_DEPLOYED_REASON`;
  - `type PublishRequest = { visibility: 'private' } | { visibility: 'public'; category: TemplateCategory | null; priceCents: number }`, with `parsePublishRequest(body: unknown): Validation<PublishRequest>`;
  - `publishEligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null`;
  - `interface ListingState { status; currentVersionId; priceCents; pendingPriceCents }`, with `planPublish(listing: ListingState | null, priceCents: number): PublishPlan`;
  - `interface ReuseInput`, with `reuseDecision(input: ReuseInput): ReuseDecision`;
  - `parseDiscoverRemoval(body: unknown): Validation<DiscoverRemoval>`;
  - `parseDiscoverFilters(params: URLSearchParams): Validation<DiscoverFilters>`.
- Produces, from `catalog.ts` (kept):
  - `Validation<T>`, `MAX_REJECTION_REASON_LENGTH` and `VERSION_IN_REVIEW_ERROR`;
  - `isTemplateCategory`, `isTemplatePrice` and `purchaseDecision`;
  - `canSubmitNewVersion`, `canWithdraw` and `canReview`;
  - `parseRejectionReason`, `supersededVersionId` and `isTemplateShotKind`.
- Produces, from `snapshot.ts`: `bundleToFiles(bundle: TemplateBundle): TreeFile[]`, and `TEMPLATE_LIMIT_ERROR` set to the new text.

- [ ] **Step 1: Write the failing reuse-rule tests**

Create `worker/services/templates/reuse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	NOT_DEPLOYED_REASON,
	NOT_THINK_REASON,
	REUSE_CONSENT_REQUIRED_MESSAGE,
	SITE_NOT_REUSABLE_MESSAGE,
	SITE_NOT_YET_AVAILABLE_MESSAGE,
	SITE_PURCHASE_REQUIRED_MESSAGE,
	SITE_UNAVAILABLE_MESSAGE,
	parseDiscoverFilters,
	parseDiscoverRemoval,
	parsePublishRequest,
	planPublish,
	publishEligibilityReason,
	reuseDecision,
	type ListingState,
	type ReuseInput,
} from './reuse';
import { VERSION_IN_REVIEW_ERROR } from './catalog';

describe('parsePublishRequest', () => {
	it('makes an app private with nothing else', () => {
		expect(parsePublishRequest({ visibility: 'private' })).toEqual({ ok: true, value: { visibility: 'private' } });
	});

	it('requires consent to publish', () => {
		expect(parsePublishRequest({ visibility: 'public', priceCents: 0 })).toEqual({
			ok: false,
			error: REUSE_CONSENT_REQUIRED_MESSAGE,
		});
	});

	it('stores no category when none is chosen and treats a missing price as free', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true })).toEqual({
			ok: true,
			value: { visibility: 'public', category: null, priceCents: 0 },
		});
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: null })).toEqual({
			ok: true,
			value: { visibility: 'public', category: null, priceCents: 0 },
		});
	});

	it('accepts a category and an allowed price', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: 'store', priceCents: 2900 })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'store', priceCents: 2900 },
		});
	});

	it('rejects unknown categories, prices and visibilities', () => {
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, category: 'blog' })).toEqual({
			ok: false,
			error: 'Choose a category',
		});
		expect(parsePublishRequest({ visibility: 'public', reuseConsent: true, priceCents: 1000 })).toEqual({
			ok: false,
			error: 'Choose a price',
		});
		expect(parsePublishRequest({ visibility: 'team' })).toEqual({
			ok: false,
			error: 'Visibility must be either "private" or "public"',
		});
	});
});

describe('publishEligibilityReason', () => {
	it('allows deployed Think apps only', () => {
		expect(publishEligibilityReason('think', true)).toBeNull();
		expect(publishEligibilityReason('think', false)).toBe(NOT_DEPLOYED_REASON);
		expect(publishEligibilityReason('phasic', true)).toBe(NOT_THINK_REASON);
	});
});

describe('planPublish', () => {
	const approved: ListingState = { status: 'listed', currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null };

	it('publishes free with nothing to unlist when there is no listing', () => {
		expect(planPublish(null, 0)).toEqual({ kind: 'free', unlistListing: false });
	});

	it('unlists a listed paid listing when the owner switches to free', () => {
		expect(planPublish(approved, 0)).toEqual({ kind: 'free', unlistListing: true });
	});

	it('submits and lists on the first paid publish', () => {
		expect(planPublish(null, 2900)).toEqual({ kind: 'paid', submitVersion: true, listListing: true });
	});

	it('asks for a new review when a free site goes back to paid', () => {
		expect(planPublish({ ...approved, status: 'unlisted' }, 2900)).toEqual({
			kind: 'paid',
			submitVersion: true,
			listListing: true,
		});
	});

	it('changes nothing for an approved listing at the same price', () => {
		expect(planPublish(approved, 2900)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
	});

	it('submits a new version for a new price', () => {
		expect(planPublish(approved, 4900)).toEqual({ kind: 'paid', submitVersion: true, listListing: false });
	});

	it('resubmits a listing whose first version was rejected', () => {
		expect(planPublish({ status: 'listed', currentVersionId: null, priceCents: 0, pendingPriceCents: null }, 900)).toEqual({
			kind: 'paid',
			submitVersion: true,
			listListing: false,
		});
	});

	it('keeps a version in review at its price and refuses a different one', () => {
		const inReview: ListingState = { ...approved, pendingPriceCents: 4900 };
		expect(planPublish(inReview, 4900)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(inReview, 1900)).toEqual({ kind: 'conflict', error: VERSION_IN_REVIEW_ERROR });
	});
});

describe('reuseDecision', () => {
	const free: ReuseInput = {
		visibility: 'public',
		removedFromDiscover: false,
		isThink: true,
		deployedCommit: 'abc',
		listing: null,
		isOwner: false,
		hasPurchase: false,
	};

	it('copies the latest deploy of a free site', () => {
		expect(reuseDecision(free)).toEqual({ ok: true, source: 'live', commit: 'abc' });
	});

	it('copies a free site whose paid listing is unlisted', () => {
		expect(reuseDecision({ ...free, listing: { status: 'unlisted', currentVersionId: 'v1' } })).toEqual({
			ok: true,
			source: 'live',
			commit: 'abc',
		});
	});

	it('hides private sites, even from their owner', () => {
		expect(reuseDecision({ ...free, visibility: 'private', isOwner: true })).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('hides removed sites', () => {
		expect(reuseDecision({ ...free, removedFromDiscover: true })).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('refuses free sites that are not deployed Think apps', () => {
		expect(reuseDecision({ ...free, isThink: false })).toEqual({ ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE });
		expect(reuseDecision({ ...free, deployedCommit: null })).toEqual({
			ok: false,
			status: 400,
			error: SITE_NOT_REUSABLE_MESSAGE,
		});
	});

	it('keeps a paid site unusable until its first approval, even for the owner', () => {
		const pending: ReuseInput = { ...free, isOwner: true, listing: { status: 'listed', currentVersionId: null } };
		expect(reuseDecision(pending)).toEqual({ ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE });
	});

	it('asks for a purchase of an approved paid site', () => {
		const paid: ReuseInput = { ...free, listing: { status: 'listed', currentVersionId: 'v2' } };
		expect(reuseDecision(paid)).toEqual({ ok: false, status: 402, error: SITE_PURCHASE_REQUIRED_MESSAGE });
		expect(reuseDecision({ ...paid, hasPurchase: true })).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
		expect(reuseDecision({ ...paid, isOwner: true })).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
	});

	it('copies the approved snapshot of a paid site even after the source stops being a deployed Think app', () => {
		const paid: ReuseInput = {
			...free,
			isThink: false,
			deployedCommit: null,
			hasPurchase: true,
			listing: { status: 'listed', currentVersionId: 'v2' },
		};
		expect(reuseDecision(paid)).toEqual({ ok: true, source: 'snapshot', versionId: 'v2' });
	});
});

describe('parseDiscoverRemoval', () => {
	it('requires a reason to remove and none to restore', () => {
		expect(parseDiscoverRemoval({ removed: true, reason: '  Copied brand  ' })).toEqual({
			ok: true,
			value: { removed: true, reason: 'Copied brand' },
		});
		expect(parseDiscoverRemoval({ removed: true })).toEqual({
			ok: false,
			error: 'A reason is required to remove a site from Discover',
		});
		expect(parseDiscoverRemoval({ removed: false })).toEqual({ ok: true, value: { removed: false } });
		expect(parseDiscoverRemoval({})).toEqual({ ok: false, error: 'removed must be true or false' });
	});

	it('caps the reason length', () => {
		expect(parseDiscoverRemoval({ removed: true, reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});
});

describe('parseDiscoverFilters', () => {
	it('defaults to every category, all prices and every site', () => {
		expect(parseDiscoverFilters(new URLSearchParams())).toEqual({
			ok: true,
			value: { category: null, pricing: 'all', reusableOnly: false },
		});
	});

	it('reads category, pricing and the reusable flag', () => {
		expect(parseDiscoverFilters(new URLSearchParams('category=store&pricing=paid&reusableOnly=true'))).toEqual({
			ok: true,
			value: { category: 'store', pricing: 'paid', reusableOnly: true },
		});
	});

	it('rejects unknown values', () => {
		expect(parseDiscoverFilters(new URLSearchParams('category=blog'))).toEqual({ ok: false, error: 'Unknown category' });
		expect(parseDiscoverFilters(new URLSearchParams('pricing=cheap'))).toEqual({
			ok: false,
			error: 'pricing must be all, free or paid',
		});
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run worker/services/templates/reuse.test.ts`
Expected: FAIL with "Failed to load url ./reuse".

- [ ] **Step 3: Rewrite `catalog.ts` to the rules that remain**

Replace the whole of `worker/services/templates/catalog.ts` with:

```ts
/**
 * Paid-listing review and purchase rules. Pure, so each rule is unit-tested.
 * Publishing and reuse rules live in reuse.ts.
 */

import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type TemplateCategory,
	type TemplateShotKind,
	type TemplateVersionStatus,
} from '../../../shared/types/templates';

export const MAX_REJECTION_REASON_LENGTH = 500;
export const VERSION_IN_REVIEW_ERROR = 'An update is already in review; withdraw it first';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export type PurchaseDecision = { ok: true; alreadyOwned: boolean } | { ok: false; status: 400; error: string };

interface PurchaseInput {
	/** The approved price; 0 for a free site. */
	priceCents: number;
	isCreator: boolean;
	hasPurchase: boolean;
}

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

function trimmedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

export function isTemplateCategory(value: unknown): value is TemplateCategory {
	return typeof value === 'string' && (TEMPLATE_CATEGORIES as readonly string[]).includes(value);
}

export function isTemplatePrice(value: unknown): value is number {
	return typeof value === 'number' && (TEMPLATE_PRICE_OPTIONS_CENTS as readonly number[]).includes(value);
}

/** Whether a user can buy a site; buying one already owned succeeds without a new record. */
export function purchaseDecision(input: PurchaseInput): PurchaseDecision {
	if (input.priceCents === 0) return { ok: false, status: 400, error: 'This site is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You published this site' };
	return { ok: true, alreadyOwned: input.hasPurchase };
}

/** A listing takes a new version only while none is in review. */
export function canSubmitNewVersion(statuses: readonly TemplateVersionStatus[]): boolean {
	return !statuses.includes('pending');
}

export function canWithdraw(status: TemplateVersionStatus): boolean {
	return status === 'pending';
}

export function canReview(status: TemplateVersionStatus): boolean {
	return status === 'pending';
}

export function parseRejectionReason(body: unknown): Validation<string> {
	const reason = trimmedString(field(body, 'reason'));
	if (reason.length === 0) {
		return { ok: false, error: 'A reason is required to reject this version' };
	}
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: reason };
}

/** The version an approval supersedes: the listing's current one, when it differs. */
export function supersededVersionId(currentVersionId: string | null, approvedVersionId: string): string | null {
	return currentVersionId && currentVersionId !== approvedVersionId ? currentVersionId : null;
}

export function isTemplateShotKind(value: string): value is TemplateShotKind {
	return value === 'desktop' || value === 'mobile';
}
```

- [ ] **Step 4: Create `reuse.ts`**

Create `worker/services/templates/reuse.ts`:

```ts
/**
 * Discover publishing and reuse rules:
 * - what a publish request asks for, and what publishing does to a paid listing;
 * - whether a site can be reused, and from which files;
 * - admin removal and Discover's filters.
 * Pure, so every rule is unit-tested.
 */

import {
	DISCOVER_PRICING_FILTERS,
	type DiscoverPricing,
	type TemplateCategory,
	type TemplateListingStatus,
} from '../../../shared/types/templates';
import {
	MAX_REJECTION_REASON_LENGTH,
	VERSION_IN_REVIEW_ERROR,
	isTemplateCategory,
	isTemplatePrice,
	type Validation,
} from './catalog';

export const SITE_UNAVAILABLE_MESSAGE = 'This site is no longer available';
export const SITE_PURCHASE_REQUIRED_MESSAGE = 'Buy this site before using it';
export const SITE_NOT_YET_AVAILABLE_MESSAGE = "This site isn't available to use yet";
export const SITE_NOT_REUSABLE_MESSAGE = "This site can't be reused right now";
export const REUSE_CONSENT_REQUIRED_MESSAGE = 'Confirm that others may copy and adapt this site';
export const NOT_THINK_REASON = 'Only apps built with the current builder can be published';
export const NOT_DEPLOYED_REASON = 'Deploy your app before publishing it';

export type PublishRequest =
	| { visibility: 'private' }
	| { visibility: 'public'; category: TemplateCategory | null; priceCents: number };

/** A paid listing as publishing sees it. */
export interface ListingState {
	status: TemplateListingStatus;
	currentVersionId: string | null;
	/** The approved version's price; 0 before the first approval. */
	priceCents: number;
	/** The price asked by the version in review, or null when none is in review. */
	pendingPriceCents: number | null;
}

export type PublishPlan =
	| { kind: 'free'; unlistListing: boolean }
	| { kind: 'paid'; submitVersion: boolean; listListing: boolean }
	| { kind: 'conflict'; error: string };

export interface ReuseInput {
	visibility: 'private' | 'public';
	removedFromDiscover: boolean;
	isThink: boolean;
	deployedCommit: string | null;
	listing: { status: TemplateListingStatus; currentVersionId: string | null } | null;
	isOwner: boolean;
	hasPurchase: boolean;
}

export type ReuseDecision =
	| { ok: true; source: 'live'; commit: string }
	| { ok: true; source: 'snapshot'; versionId: string }
	| { ok: false; status: 400 | 402 | 404 | 409; error: string };

export type DiscoverRemoval = { removed: true; reason: string } | { removed: false };

export interface DiscoverFilters {
	category: TemplateCategory | null;
	pricing: DiscoverPricing;
	reusableOnly: boolean;
}

function field(body: unknown, key: string): unknown {
	return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[key] : undefined;
}

export function parsePublishRequest(body: unknown): Validation<PublishRequest> {
	const visibility = field(body, 'visibility');
	if (visibility === 'private') return { ok: true, value: { visibility: 'private' } };
	if (visibility !== 'public') return { ok: false, error: 'Visibility must be either "private" or "public"' };
	if (field(body, 'reuseConsent') !== true) return { ok: false, error: REUSE_CONSENT_REQUIRED_MESSAGE };

	const category = field(body, 'category');
	if (category !== undefined && category !== null && !isTemplateCategory(category)) {
		return { ok: false, error: 'Choose a category' };
	}
	const rawPrice = field(body, 'priceCents');
	const priceCents = rawPrice === undefined ? 0 : rawPrice;
	if (!isTemplatePrice(priceCents)) return { ok: false, error: 'Choose a price' };

	return {
		ok: true,
		value: { visibility: 'public', category: isTemplateCategory(category) ? category : null, priceCents },
	};
}

/** Why an app cannot be published, or null when it can. */
export function publishEligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null {
	if (behaviorType !== 'think') return NOT_THINK_REASON;
	return hasDeployedCommit ? null : NOT_DEPLOYED_REASON;
}

/** What publishing an app as public at `priceCents` does to its paid listing. */
export function planPublish(listing: ListingState | null, priceCents: number): PublishPlan {
	if (priceCents === 0) return { kind: 'free', unlistListing: listing?.status === 'listed' };
	if (!listing || listing.status === 'unlisted') return { kind: 'paid', submitVersion: true, listListing: true };
	if (listing.pendingPriceCents !== null) {
		return listing.pendingPriceCents === priceCents
			? { kind: 'paid', submitVersion: false, listListing: false }
			: { kind: 'conflict', error: VERSION_IN_REVIEW_ERROR };
	}
	const approvedAtThisPrice = listing.currentVersionId !== null && listing.priceCents === priceCents;
	return { kind: 'paid', submitVersion: !approvedAtThisPrice, listListing: false };
}

/** Whether a user can start a new app from a site, and which files it copies. */
export function reuseDecision(input: ReuseInput): ReuseDecision {
	if (input.visibility !== 'public' || input.removedFromDiscover) {
		return { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
	}
	if (input.listing?.status === 'listed') {
		const versionId = input.listing.currentVersionId;
		if (!versionId) return { ok: false, status: 409, error: SITE_NOT_YET_AVAILABLE_MESSAGE };
		if (!input.isOwner && !input.hasPurchase) {
			return { ok: false, status: 402, error: SITE_PURCHASE_REQUIRED_MESSAGE };
		}
		return { ok: true, source: 'snapshot', versionId };
	}
	if (!input.isThink || !input.deployedCommit) {
		return { ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE };
	}
	return { ok: true, source: 'live', commit: input.deployedCommit };
}

export function parseDiscoverRemoval(body: unknown): Validation<DiscoverRemoval> {
	const removed = field(body, 'removed');
	if (removed === false) return { ok: true, value: { removed: false } };
	if (removed !== true) return { ok: false, error: 'removed must be true or false' };
	const rawReason = field(body, 'reason');
	const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
	if (reason.length === 0) return { ok: false, error: 'A reason is required to remove a site from Discover' };
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: { removed: true, reason } };
}

/** Discover's category, pricing and reusable filters from a query string. */
export function parseDiscoverFilters(params: URLSearchParams): Validation<DiscoverFilters> {
	const category = params.get('category');
	if (category !== null && category !== '' && !isTemplateCategory(category)) {
		return { ok: false, error: 'Unknown category' };
	}
	const pricing = DISCOVER_PRICING_FILTERS.find((value) => value === (params.get('pricing') ?? 'all'));
	if (!pricing) return { ok: false, error: 'pricing must be all, free or paid' };
	const reusable = params.get('reusableOnly');
	return {
		ok: true,
		value: {
			category: isTemplateCategory(category) ? category : null,
			pricing,
			reusableOnly: reusable === 'true' || reusable === '1',
		},
	};
}
```

- [ ] **Step 5: Rewrite the catalog tests for the remaining rules**

Replace the whole of `worker/services/templates/catalog.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import {
	canReview,
	canSubmitNewVersion,
	canWithdraw,
	isTemplateCategory,
	isTemplatePrice,
	isTemplateShotKind,
	parseRejectionReason,
	purchaseDecision,
	supersededVersionId,
} from './catalog';
import { formatTemplatePrice } from '../../../shared/types/templates';

describe('isTemplateCategory and isTemplatePrice', () => {
	it('accepts only the listed values', () => {
		expect(isTemplateCategory('restaurant')).toBe(true);
		expect(isTemplateCategory('blog')).toBe(false);
		expect(isTemplatePrice(0)).toBe(true);
		expect(isTemplatePrice(4900)).toBe(true);
		expect(isTemplatePrice(1000)).toBe(false);
		expect(isTemplatePrice('900')).toBe(false);
	});
});

describe('purchaseDecision', () => {
	it('sells approved paid sites to others and keeps an earlier purchase', () => {
		expect(purchaseDecision({ priceCents: 2900, isCreator: false, hasPurchase: false })).toEqual({
			ok: true,
			alreadyOwned: false,
		});
		expect(purchaseDecision({ priceCents: 2900, isCreator: false, hasPurchase: true })).toEqual({
			ok: true,
			alreadyOwned: true,
		});
	});

	it('refuses free sites and the creator', () => {
		expect(purchaseDecision({ priceCents: 0, isCreator: false, hasPurchase: false })).toEqual({
			ok: false,
			status: 400,
			error: 'This site is free',
		});
		expect(purchaseDecision({ priceCents: 2900, isCreator: true, hasPurchase: false })).toEqual({
			ok: false,
			status: 400,
			error: 'You published this site',
		});
	});
});

describe('version state rules', () => {
	it('allows one version in review at a time', () => {
		expect(canSubmitNewVersion(['approved', 'rejected'])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'pending'])).toBe(false);
	});

	it('withdraws and reviews only pending versions', () => {
		expect(canWithdraw('pending')).toBe(true);
		expect(canWithdraw('approved')).toBe(false);
		expect(canReview('pending')).toBe(true);
		expect(canReview('withdrawn')).toBe(false);
	});

	it('supersedes the current version only when another one is approved', () => {
		expect(supersededVersionId('v1', 'v2')).toBe('v1');
		expect(supersededVersionId('v2', 'v2')).toBeNull();
		expect(supersededVersionId(null, 'v2')).toBeNull();
	});
});

describe('parseRejectionReason', () => {
	it('requires a trimmed reason under 500 characters', () => {
		expect(parseRejectionReason({ reason: '  Copied brand  ' })).toEqual({ ok: true, value: 'Copied brand' });
		expect(parseRejectionReason({ reason: '   ' })).toEqual({
			ok: false,
			error: 'A reason is required to reject this version',
		});
		expect(parseRejectionReason({ reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});
});

describe('isTemplateShotKind', () => {
	it('names the two screenshots', () => {
		expect(isTemplateShotKind('desktop')).toBe(true);
		expect(isTemplateShotKind('mobile')).toBe(true);
		expect(isTemplateShotKind('tablet')).toBe(false);
	});
});

describe('formatTemplatePrice', () => {
	it('formats free and whole-dollar prices', () => {
		expect(formatTemplatePrice(0)).toBe('Free');
		expect(formatTemplatePrice(2900)).toBe('$29');
		expect(formatTemplatePrice(950)).toBe('$9.50');
	});
});
```

- [ ] **Step 6: Add `bundleToFiles` and the new limit message to the snapshot module**

In `worker/services/templates/snapshot.ts`, change:

```ts
export const TEMPLATE_LIMIT_ERROR = 'Templates can have at most 500 files and 10 MB';
```

to:

```ts
export const TEMPLATE_LIMIT_ERROR = 'Sites can have at most 500 files and 10 MB to be published';
```

Replace the final `return entries.map(...)` block of `parseBundle` and add `bundleToFiles` above `parseBundle`, so the end of the file reads:

```ts
/** Decode a bundle into files, validating every path before anything is written. */
export function bundleToFiles(bundle: TemplateBundle): TreeFile[] {
	return bundle.files.map((file) => {
		if (!isSafeSeedPath(file.path)) {
			throw new Error(`Template snapshot has an unsafe path: ${file.path}`);
		}
		const bytes = file.encoding === 'base64' ? base64ToUint8Array(file.content) : new TextEncoder().encode(file.content);
		return { path: file.path, bytes };
	});
}

/** Parse a stored `files.json`, validating every path again before it is used. */
export function parseBundle(json: string): TreeFile[] {
	const parsed: unknown = JSON.parse(json);
	const candidate = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined;
	if (!Array.isArray(candidate)) throw new Error('Template snapshot is malformed');
	const entries: unknown[] = candidate;
	if (!entries.every(isBundleFile)) throw new Error('Template snapshot is malformed');
	if (entries.length > MAX_TEMPLATE_FILES) throw new Error(TEMPLATE_LIMIT_ERROR);
	return bundleToFiles({ files: entries });
}
```

Append to `worker/services/templates/snapshot.test.ts`:

```ts
describe('bundleToFiles', () => {
	it('returns the kept files byte for byte', () => {
		const encoder = new TextEncoder();
		const files = [
			{ path: '/index.html', bytes: encoder.encode('<h1>Hi</h1>') },
			{ path: '/.env', bytes: encoder.encode('SECRET=1') },
			{ path: '/logo.png', bytes: new Uint8Array([0x89, 0x50, 0x00, 0xff]) },
		];
		const snapshot = buildSnapshot(files);
		if (!snapshot.ok) throw new Error(snapshot.error);
		expect(bundleToFiles(snapshot.bundle)).toEqual([
			{ path: 'index.html', bytes: files[0].bytes },
			{ path: 'logo.png', bytes: files[2].bytes },
		]);
	});

	it('refuses an unsafe path', () => {
		expect(() => bundleToFiles({ files: [{ path: '../x', encoding: 'utf8', content: '' }] })).toThrow(
			'Template snapshot has an unsafe path: ../x',
		);
	});
});
```

Add `bundleToFiles` to that test file's import from `./snapshot`. If `buildSnapshot` or `describe` is not imported yet, add it.

- [ ] **Step 7: Update the save message**

In `worker/services/templates/submit.ts`, change:

```ts
export const SAVE_FAILED_MESSAGE = "Couldn't save your template; try again";
```

to:

```ts
export const SAVE_FAILED_MESSAGE = "Couldn't save your site for review; try again";
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run worker/services/templates/reuse.test.ts worker/services/templates/catalog.test.ts worker/services/templates/snapshot.test.ts worker/services/templates/submit.test.ts`
Expected: PASS for all four files.

- [ ] **Step 9: Commit**

```bash
git add worker/services/templates/reuse.ts worker/services/templates/reuse.test.ts worker/services/templates/catalog.ts worker/services/templates/catalog.test.ts worker/services/templates/snapshot.ts worker/services/templates/snapshot.test.ts worker/services/templates/submit.ts
git commit -m "feat(discover): rules for publishing, reusing and removing sites

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Publish orchestration

**Files:**
- Create: `worker/services/templates/publish.ts`
- Test: `worker/services/templates/publish.test.ts`

**Interfaces:**
- Consumes:
  - `planPublish`, `publishEligibilityReason`, `PublishRequest`, `ListingState` and `NOT_DEPLOYED_REASON` (Task 2);
  - `buildSnapshot` and `TreeFile` (snapshot.ts);
  - `TemplateSubmissionError` and `READ_FAILED_MESSAGE` (submit.ts);
  - `TemplateSource` from `worker/agents/core/types.ts` (exists: `{ commit: string; previewUrl: string }`).
- Produces:
  - `interface PublishDeps`;
  - `publishSite(deps: PublishDeps, request: PublishRequest): Promise<PublishOutcome>`, where `PublishOutcome = { ok: true; inReview: boolean } | { ok: false; status: 400 | 409 | 500; error: string }`.

- [ ] **Step 1: Write the failing tests**

Create `worker/services/templates/publish.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TemplateSource } from '../../agents/core/types';
import { NOT_DEPLOYED_REASON, NOT_THINK_REASON, type ListingState, type PublishRequest } from './reuse';
import { VERSION_IN_REVIEW_ERROR } from './catalog';
import { publishSite, type PublishDeps } from './publish';
import { SCREENSHOT_FAILED_MESSAGE, TemplateSubmissionError } from './submit';
import type { TreeFile } from './snapshot';

const SOURCE: TemplateSource = { commit: 'c1', previewUrl: 'https://preview.test/' };
const FILES: TreeFile[] = [{ path: '/index.html', bytes: new TextEncoder().encode('<h1>Hi</h1>') }];
const FREE: PublishRequest = { visibility: 'public', category: 'landing', priceCents: 0 };
const PAID: PublishRequest = { visibility: 'public', category: 'store', priceCents: 2900 };

interface Setup {
	listing?: { id: string; state: ListingState } | null;
	behaviorType?: string;
	source?: TemplateSource | null;
	files?: TreeFile[];
	submitError?: Error;
}

function harness(setup: Setup = {}) {
	const calls: string[] = [];
	const deps: PublishDeps = {
		loadListing: async () => setup.listing ?? null,
		loadSource: async () => ({
			behaviorType: setup.behaviorType ?? 'think',
			source: setup.source === undefined ? SOURCE : setup.source,
		}),
		readTree: async () => setup.files ?? FILES,
		createListing: async () => {
			calls.push('createListing');
			return 'new-listing';
		},
		setListingStatus: async (listingId, status) => {
			calls.push(`setListingStatus:${listingId}:${status}`);
		},
		submitVersion: async (listingId, _source, priceCents) => {
			calls.push(`submitVersion:${listingId}:${priceCents}`);
			if (setup.submitError) throw setup.submitError;
		},
		applyVisibility: async (request) => {
			calls.push(`applyVisibility:${request.visibility}`);
		},
	};
	return { deps, calls };
}

const APPROVED: { id: string; state: ListingState } = {
	id: 'l1',
	state: { status: 'listed', currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null },
};

describe('publishSite', () => {
	it('makes an app private without touching its listing', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, { visibility: 'private' })).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:private']);
	});

	it('refuses apps that are not deployed Think apps', async () => {
		const legacy = harness({ behaviorType: 'phasic', source: null });
		expect(await publishSite(legacy.deps, FREE)).toEqual({ ok: false, status: 400, error: NOT_THINK_REASON });
		const undeployed = harness({ source: null });
		expect(await publishSite(undeployed.deps, FREE)).toEqual({ ok: false, status: 400, error: NOT_DEPLOYED_REASON });
		expect([...legacy.calls, ...undeployed.calls]).toEqual([]);
	});

	it('publishes a free site after checking its files', async () => {
		const { deps, calls } = harness();
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:public']);
	});

	it('refuses a free site whose files contain a secret', async () => {
		const secret = new TextEncoder().encode('const key = "sk-ant-' + 'a'.repeat(40) + '";');
		const { deps, calls } = harness({ files: [{ path: '/src/app.js', bytes: secret }] });
		expect(await publishSite(deps, FREE)).toEqual({
			ok: false,
			status: 400,
			error: 'src/app.js looks like it contains a secret key; remove it and redeploy',
		});
		expect(calls).toEqual([]);
	});

	it('unlists the paid listing when the owner switches to free', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, FREE)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['setListingStatus:l1:unlisted', 'applyVisibility:public']);
	});

	it('submits, lists and publishes on the first paid publish', async () => {
		const { deps, calls } = harness();
		expect(await publishSite(deps, PAID)).toEqual({ ok: true, inReview: true });
		expect(calls).toEqual([
			'createListing',
			'submitVersion:new-listing:2900',
			'setListingStatus:new-listing:listed',
			'applyVisibility:public',
		]);
	});

	it('keeps a free public site reusable when the paid submission fails', async () => {
		const { deps, calls } = harness({ submitError: new TemplateSubmissionError(SCREENSHOT_FAILED_MESSAGE, 400) });
		expect(await publishSite(deps, PAID)).toEqual({ ok: false, status: 400, error: SCREENSHOT_FAILED_MESSAGE });
		expect(calls).toEqual(['createListing', 'submitVersion:new-listing:2900']);
	});

	it('saves settings without a new review when the approved price stays', async () => {
		const { deps, calls } = harness({ listing: APPROVED });
		expect(await publishSite(deps, PAID)).toEqual({ ok: true, inReview: false });
		expect(calls).toEqual(['applyVisibility:public']);
	});

	it('refuses a new price while another one is in review', async () => {
		const inReview = { id: 'l1', state: { ...APPROVED.state, pendingPriceCents: 4900 } };
		const { deps, calls } = harness({ listing: inReview });
		expect(await publishSite(deps, PAID)).toEqual({ ok: false, status: 409, error: VERSION_IN_REVIEW_ERROR });
		expect(calls).toEqual([]);
	});

	it('lets errors other than submission errors reach the caller', async () => {
		const { deps } = harness({ submitError: new Error('R2 down') });
		await expect(publishSite(deps, PAID)).rejects.toThrow('R2 down');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/templates/publish.test.ts`
Expected: FAIL with "Failed to load url ./publish".

- [ ] **Step 3: Implement `publish.ts`**

Create `worker/services/templates/publish.ts`:

```ts
/**
 * Publishing an app: make it private, or public with consent, a category and
 * a price. A paid publish stores a version for admin review before anything
 * else changes, so a failed submission never makes a site reusable for free.
 * Dependencies are injected so the ordering rules are tested.
 */

import type { TemplateSource } from '../../agents/core/types';
import { buildSnapshot, type TreeFile } from './snapshot';
import { READ_FAILED_MESSAGE, TemplateSubmissionError } from './submit';
import { NOT_DEPLOYED_REASON, planPublish, publishEligibilityReason, type ListingState, type PublishRequest } from './reuse';

export interface PublishDeps {
	/** The app's paid listing, or null when it never had a price. */
	loadListing(): Promise<{ id: string; state: ListingState } | null>;
	loadSource(): Promise<{ behaviorType: string; source: TemplateSource | null }>;
	readTree(commit: string): Promise<TreeFile[]>;
	/** Create an unlisted listing and return its id. */
	createListing(): Promise<string>;
	/** Unlisting also withdraws a version in review. */
	setListingStatus(listingId: string, status: 'listed' | 'unlisted'): Promise<void>;
	/** Store the deployed commit as a pending version at this price; throws TemplateSubmissionError. */
	submitVersion(listingId: string, source: TemplateSource, priceCents: number): Promise<void>;
	applyVisibility(request: PublishRequest): Promise<void>;
}

export type PublishOutcome =
	| { ok: true; inReview: boolean }
	| { ok: false; status: 400 | 409 | 500; error: string };

export async function publishSite(deps: PublishDeps, request: PublishRequest): Promise<PublishOutcome> {
	if (request.visibility === 'private') {
		await deps.applyVisibility(request);
		return { ok: true, inReview: false };
	}

	const { behaviorType, source } = await deps.loadSource();
	const ineligible = publishEligibilityReason(behaviorType, source !== null);
	if (ineligible || !source) return { ok: false, status: 400, error: ineligible ?? NOT_DEPLOYED_REASON };

	const listing = await deps.loadListing();
	const plan = planPublish(listing?.state ?? null, request.priceCents);
	if (plan.kind === 'conflict') return { ok: false, status: 409, error: plan.error };

	if (plan.kind === 'free') {
		let files: TreeFile[];
		try {
			files = await deps.readTree(source.commit);
		} catch {
			return { ok: false, status: 500, error: READ_FAILED_MESSAGE };
		}
		const snapshot = buildSnapshot(files);
		if (!snapshot.ok) return { ok: false, status: 400, error: snapshot.error };
		if (plan.unlistListing && listing) await deps.setListingStatus(listing.id, 'unlisted');
		await deps.applyVisibility(request);
		return { ok: true, inReview: false };
	}

	try {
		const listingId = listing?.id ?? (await deps.createListing());
		if (plan.submitVersion) await deps.submitVersion(listingId, source, request.priceCents);
		if (plan.listListing) await deps.setListingStatus(listingId, 'listed');
	} catch (error) {
		if (error instanceof TemplateSubmissionError) return { ok: false, status: error.status, error: error.message };
		throw error;
	}
	await deps.applyVisibility(request);
	return { ok: true, inReview: plan.submitVersion || listing?.state.pendingPriceCents != null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run worker/services/templates/publish.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add worker/services/templates/publish.ts worker/services/templates/publish.test.ts
git commit -m "feat(discover): publish a site free or paid without leaking a paid site

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Resolving a reuse start

**Files:**
- Modify: `worker/agents/core/types.ts` (add `ReuseSeed`; `TemplateSeed` stays until Task 6)
- Modify: `worker/services/templates/start.ts` (rewritten)
- Modify: `worker/services/templates/start.test.ts` (rewritten)
- Delete: `worker/services/templates/fixtures.ts`, if nothing else imports it after the rewrite. Run `grep -rn "templates/fixtures" worker` to check.

**Interfaces:**
- Consumes:
  - `reuseDecision`, `SITE_UNAVAILABLE_MESSAGE` and `SITE_NOT_REUSABLE_MESSAGE` (Task 2);
  - `buildSnapshot`, `bundleToFiles` and `TreeFile` (Task 2);
  - the `Template` and `TemplateVersion` row types (Task 1).
- Produces:
  - `interface ReuseSeed { sourceAppId: string; sourceTitle: string; versionId: string | null; files: Array<{ path: string; bytes: Uint8Array }> }` in `worker/agents/core/types.ts`;
  - `interface ReuseSourceApp { id; userId: string | null; title; visibility: 'private' | 'public'; removedFromDiscoverAt: Date | null }`;
  - `interface ReuseLookup`;
  - `resolveReuseStart(lookup: ReuseLookup, sourceAppId: unknown, userId: string): Promise<ReuseStartResult>`.

- [ ] **Step 1: Add the seed type**

In `worker/agents/core/types.ts`, add after the `TemplateSeed` interface:

```ts
/** The site a new Think app is copied from, with the files to copy. */
export interface ReuseSeed {
    sourceAppId: string;
    sourceTitle: string;
    /** The approved paid version copied, or null for a free site's latest deploy. */
    versionId: string | null;
    files: Array<{ path: string; bytes: Uint8Array }>;
}
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `worker/services/templates/start.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { Template, TemplateVersion } from '../../database/schema';
import { resolveReuseStart, type ReuseLookup, type ReuseSourceApp } from './start';
import {
	SITE_NOT_REUSABLE_MESSAGE,
	SITE_NOT_YET_AVAILABLE_MESSAGE,
	SITE_PURCHASE_REQUIRED_MESSAGE,
	SITE_UNAVAILABLE_MESSAGE,
} from './reuse';
import type { TreeFile } from './snapshot';

const encoder = new TextEncoder();
const LIVE_FILES: TreeFile[] = [
	{ path: '/index.html', bytes: encoder.encode('<h1>Lumen</h1>') },
	{ path: '/.env', bytes: encoder.encode('TOKEN=abc') },
];
const SNAPSHOT_FILES: TreeFile[] = [{ path: 'index.html', bytes: encoder.encode('<h1>Approved</h1>') }];

const APP: ReuseSourceApp = {
	id: 'app1',
	userId: 'owner',
	title: 'Lumen Yoga',
	visibility: 'public',
	removedFromDiscoverAt: null,
};

function listing(overrides: Partial<Template> = {}): Template {
	return {
		id: 'l1',
		sourceAppId: 'app1',
		creatorUserId: 'owner',
		currentVersionId: 'v2',
		status: 'listed',
		priceCents: 2900,
		createdAt: null,
		updatedAt: null,
		...overrides,
	};
}

function version(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
	return {
		id: 'v2',
		templateId: 'l1',
		version: 2,
		sourceCommit: 'c2',
		snapshotKey: 'templates/l1/v2/files.json',
		fileCount: 1,
		totalBytes: 10,
		desktopShotKey: 'd',
		mobileShotKey: 'm',
		priceCents: 2900,
		status: 'approved',
		rightsConfirmedAt: new Date(0),
		reviewedBy: 'admin',
		reviewedAt: new Date(0),
		rejectionReason: null,
		createdAt: null,
		...overrides,
	};
}

interface Setup {
	app?: ReuseSourceApp | null;
	listing?: Template | null;
	version?: TemplateVersion | null;
	purchased?: boolean;
	behaviorType?: string;
	deployedCommit?: string | null;
	liveFiles?: TreeFile[];
}

function lookup(setup: Setup = {}) {
	const purchaseChecks: string[] = [];
	const value: ReuseLookup = {
		getSourceApp: async () => (setup.app === undefined ? APP : setup.app),
		getListingByApp: async () => setup.listing ?? null,
		getVersion: async () => (setup.version === undefined ? version() : setup.version),
		hasPurchase: async (listingId, userId) => {
			purchaseChecks.push(`${listingId}:${userId}`);
			return setup.purchased ?? false;
		},
		getAgentFacts: async () => ({
			behaviorType: setup.behaviorType ?? 'think',
			deployedCommit: setup.deployedCommit === undefined ? 'c9' : setup.deployedCommit,
		}),
		readLiveTree: async () => setup.liveFiles ?? LIVE_FILES,
		readSnapshot: async () => SNAPSHOT_FILES,
	};
	return { value, purchaseChecks };
}

describe('resolveReuseStart', () => {
	it('refuses a missing or malformed source', async () => {
		const unavailable = { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };
		expect(await resolveReuseStart(lookup().value, undefined, 'buyer')).toEqual(unavailable);
		expect(await resolveReuseStart(lookup({ app: null }).value, 'app1', 'buyer')).toEqual(unavailable);
	});

	it('refuses a site an admin removed', async () => {
		const removed = lookup({ app: { ...APP, removedFromDiscoverAt: new Date(0) } });
		expect(await resolveReuseStart(removed.value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});

	it('copies the latest deploy of a free site', async () => {
		const result = await resolveReuseStart(lookup().value, 'app1', 'buyer');
		expect(result).toEqual({
			ok: true,
			seed: {
				sourceAppId: 'app1',
				sourceTitle: 'Lumen Yoga',
				versionId: null,
				files: [{ path: 'index.html', bytes: LIVE_FILES[0].bytes }],
			},
		});
	});

	it('drops env files from a free copy', async () => {
		const result = await resolveReuseStart(lookup().value, 'app1', 'buyer');
		if (!result.ok) throw new Error(result.error);
		expect(result.seed.files.map((file) => file.path)).toEqual(['index.html']);
	});

	it('refuses a free site whose files contain a secret', async () => {
		const secret = encoder.encode('const key = "sk-ant-' + 'a'.repeat(40) + '";');
		const result = await resolveReuseStart(
			lookup({ liveFiles: [{ path: '/app.js', bytes: secret }] }).value,
			'app1',
			'buyer',
		);
		expect(result).toEqual({ ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE });
	});

	it('refuses a free site that is not a deployed Think app', async () => {
		expect(await resolveReuseStart(lookup({ behaviorType: 'phasic' }).value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 400,
			error: SITE_NOT_REUSABLE_MESSAGE,
		});
	});

	it('refuses a paid site before its first approval, also for the owner', async () => {
		const pending = lookup({ listing: listing({ currentVersionId: null }) });
		expect(await resolveReuseStart(pending.value, 'app1', 'owner')).toEqual({
			ok: false,
			status: 409,
			error: SITE_NOT_YET_AVAILABLE_MESSAGE,
		});
	});

	it('asks a non-owner to buy an approved paid site', async () => {
		const paid = lookup({ listing: listing() });
		expect(await resolveReuseStart(paid.value, 'app1', 'buyer')).toEqual({
			ok: false,
			status: 402,
			error: SITE_PURCHASE_REQUIRED_MESSAGE,
		});
		expect(paid.purchaseChecks).toEqual(['l1:buyer']);
	});

	it('copies the approved snapshot for a buyer and for the owner', async () => {
		const expected = {
			ok: true,
			seed: { sourceAppId: 'app1', sourceTitle: 'Lumen Yoga', versionId: 'v2', files: SNAPSHOT_FILES },
		};
		expect(await resolveReuseStart(lookup({ listing: listing(), purchased: true }).value, 'app1', 'buyer')).toEqual(
			expected,
		);
		const owner = lookup({ listing: listing() });
		expect(await resolveReuseStart(owner.value, 'app1', 'owner')).toEqual(expected);
		expect(owner.purchaseChecks).toEqual([]);
	});

	it('refuses a paid site whose approved version is gone', async () => {
		expect(await resolveReuseStart(lookup({ listing: listing(), version: null }).value, 'app1', 'owner')).toEqual({
			ok: false,
			status: 404,
			error: SITE_UNAVAILABLE_MESSAGE,
		});
	});
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run worker/services/templates/start.test.ts`
Expected: FAIL, because `resolveReuseStart` is not exported.

- [ ] **Step 4: Implement the resolution**

Replace the whole of `worker/services/templates/start.ts` with:

```ts
/** Resolve the site a user asked to start from into the files the new app copies. */

import type { ReuseSeed } from '../../agents/core/types';
import type { Template, TemplateVersion } from '../../database/schema';
import { buildSnapshot, bundleToFiles, type TreeFile } from './snapshot';
import { SITE_NOT_REUSABLE_MESSAGE, SITE_UNAVAILABLE_MESSAGE, reuseDecision } from './reuse';

export const SITE_READ_FAILED_MESSAGE = "Couldn't read this site's files; try again";

export interface ReuseSourceApp {
	id: string;
	userId: string | null;
	title: string;
	visibility: 'private' | 'public';
	removedFromDiscoverAt: Date | null;
}

export interface ReuseLookup {
	getSourceApp(appId: string): Promise<ReuseSourceApp | null>;
	getListingByApp(appId: string): Promise<Template | null>;
	getVersion(versionId: string): Promise<TemplateVersion | null>;
	hasPurchase(listingId: string, userId: string): Promise<boolean>;
	/** The source's builder and deployed commit; `unknown` and null when its agent can't be reached. */
	getAgentFacts(appId: string): Promise<{ behaviorType: string; deployedCommit: string | null }>;
	readLiveTree(appId: string, commit: string): Promise<TreeFile[]>;
	readSnapshot(snapshotKey: string): Promise<TreeFile[]>;
}

export type ReuseStartResult =
	| { ok: true; seed: ReuseSeed }
	| { ok: false; status: 400 | 402 | 404 | 409 | 500; error: string };

const UNAVAILABLE: ReuseStartResult = { ok: false, status: 404, error: SITE_UNAVAILABLE_MESSAGE };

export async function resolveReuseStart(
	lookup: ReuseLookup,
	sourceAppId: unknown,
	userId: string,
): Promise<ReuseStartResult> {
	if (typeof sourceAppId !== 'string' || sourceAppId.length === 0) return UNAVAILABLE;
	const app = await lookup.getSourceApp(sourceAppId);
	if (!app) return UNAVAILABLE;

	const isOwner = app.userId === userId;
	const listing = await lookup.getListingByApp(app.id);
	const paidInEffect = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
	const [facts, hasPurchase] = await Promise.all([
		lookup.getAgentFacts(app.id),
		paidInEffect && !isOwner ? lookup.hasPurchase(listing.id, userId) : Promise.resolve(false),
	]);

	const decision = reuseDecision({
		visibility: app.visibility,
		removedFromDiscover: app.removedFromDiscoverAt !== null,
		isThink: facts.behaviorType === 'think',
		deployedCommit: facts.deployedCommit,
		listing: listing ? { status: listing.status, currentVersionId: listing.currentVersionId } : null,
		isOwner,
		hasPurchase,
	});
	if (!decision.ok) return decision;

	if (decision.source === 'snapshot') {
		const version = await lookup.getVersion(decision.versionId);
		if (!version || version.status !== 'approved') return UNAVAILABLE;
		const files = await lookup.readSnapshot(version.snapshotKey);
		return { ok: true, seed: { sourceAppId: app.id, sourceTitle: app.title, versionId: version.id, files } };
	}

	let tree: TreeFile[];
	try {
		tree = await lookup.readLiveTree(app.id, decision.commit);
	} catch {
		return { ok: false, status: 500, error: SITE_READ_FAILED_MESSAGE };
	}
	const snapshot = buildSnapshot(tree);
	if (!snapshot.ok) return { ok: false, status: 400, error: SITE_NOT_REUSABLE_MESSAGE };
	return {
		ok: true,
		seed: { sourceAppId: app.id, sourceTitle: app.title, versionId: null, files: bundleToFiles(snapshot.bundle) },
	};
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/services/templates/start.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Delete the unused fixtures**

Run: `grep -rn "templates/fixtures" worker src`. If it prints nothing, run `git rm worker/services/templates/fixtures.ts`. If something still imports it, leave the file; Task 7 removes the last importer and deletes it there.

- [ ] **Step 7: Commit**

```bash
git add worker/agents/core/types.ts worker/services/templates/start.ts worker/services/templates/start.test.ts
git commit -m "feat(discover): resolve which files a reused site copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(If Step 6 deleted `fixtures.ts`, `git rm` has already staged the deletion.)

---
### Task 5: Database services

**Files:**
- Modify: `worker/database/services/TemplateService.ts` (rewritten)
- Create: `worker/database/discover-conditions.ts`
- Test: `worker/database/discover-conditions.test.ts`
- Modify: `worker/database/services/AppService.ts`
- Modify: `worker/database/types.ts`

**Interfaces:**
- Consumes: the Task 1 schema, and `DiscoverFilters` (Task 2).
- Produces:
  - **`TemplateService`:**
    - reads: `getListing(listingId)`, `getListingByApp(appId)`, `getVersion(versionId)` and `listVersions(listingId)`, newest first;
    - `getPendingVersion(listingId)`, `nextVersionNumber(listingId)`, `insertVersion(version)` and `countBuyers(listingId)`;
    - listings: `createListing({ sourceAppId, creatorUserId }): Promise<string>`, which creates it unlisted, and `setListingStatus(listingId, status)`, which withdraws pending versions when unlisting;
    - `listByCreator(userId): Promise<CreatorListingRow[]>`, `listPending(): Promise<PendingVersionRow[]>` and `getVersionWithListing(versionId): Promise<ListingVersionRow | null>`;
    - review: `approveVersion({ listingId, versionId, supersedeVersionId, reviewerId }): Promise<boolean>`, which copies the version's price to the listing, plus `rejectVersion` and `withdrawVersion`, which keep their current signatures;
    - purchases: `hasPurchase(listingId, userId)` and `recordPurchase({ listingId, userId, priceCents })`.
  - **`AppService`:**
    - `getReuseSource(appId)`, `getPublishingState(appId)`, `setRemovedFromDiscover(appId, removal | null): Promise<boolean>` and `getStartedFrom(appId)`;
    - `updateAppVisibility(appId, userId, visibility, publishing?: { category: TemplateCategory | null; reuseConsentAt: Date })`;
    - `getPublicApps({ ..., discover?: DiscoverFilters })`, which fills `paidPriceCents` and `paidInReview`.
  - **`EnhancedAppData`** gains optional `paidPriceCents?: number | null` and `paidInReview?: boolean`.
  - **`discover-conditions.ts`:** `discoverConditions(filters: DiscoverFilters | undefined): SQL[]`, `paidPriceSubquery` and `paidInReviewSubquery`.

- [ ] **Step 1: Write the failing Discover SQL test**

Create `worker/database/discover-conditions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { and } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { discoverConditions } from './discover-conditions';
import type { DiscoverFilters } from '../services/templates/reuse';

const dialect = new SQLiteSyncDialect();
const ALL: DiscoverFilters = { category: null, pricing: 'all', reusableOnly: false };

function render(filters: DiscoverFilters | undefined) {
	const where = and(...discoverConditions(filters));
	if (!where) throw new Error('no conditions');
	return dialect.sqlToQuery(where);
}

describe('discoverConditions', () => {
	it('always hides sites an admin removed', () => {
		expect(render(undefined).sql).toContain('removed_from_discover_at" is null');
		expect(render(ALL).sql).toContain('removed_from_discover_at" is null');
	});

	it('filters by category', () => {
		const query = render({ ...ALL, category: 'store' });
		expect(query.sql).toContain('"category" = ?');
		expect(query.params).toContain('store');
	});

	it('treats a site without a listed paid listing as free', () => {
		const query = render({ ...ALL, pricing: 'free' });
		expect(query.sql).toContain('not exists (select 1 from templates as listing where listing.source_app_id =');
		expect(query.sql).toContain("listing.status = 'listed'");
	});

	it('treats a site with an approved listed listing as paid', () => {
		const query = render({ ...ALL, pricing: 'paid' });
		expect(query.sql).toContain('exists (select 1 from templates as listing');
		expect(query.sql).toContain('listing.current_version_id is not null');
	});

	it('limits reusable sites to recorded deploys without a first review pending', () => {
		const query = render({ ...ALL, reusableOnly: true });
		expect(query.sql).toContain('last_deployed_at" is not null');
		expect(query.sql).toContain('listing.current_version_id is null');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run worker/database/discover-conditions.test.ts`
Expected: FAIL with "Failed to load url ./discover-conditions".

- [ ] **Step 3: Implement the Discover conditions**

Create `worker/database/discover-conditions.ts`:

```ts
/**
 * Discover's SQL: which public apps show, and how each app's paid listing
 * affects pricing and reuse. A paid listing counts only while it is listed.
 */

import { eq, sql, type SQL } from 'drizzle-orm';
import * as schema from './schema';
import type { DiscoverFilters } from '../services/templates/reuse';

const listedListing = sql`select 1 from templates as listing where listing.source_app_id = ${schema.apps.id} and listing.status = 'listed'`;

/** The approved price of a listed paid listing, or null for a free site. */
export const paidPriceSubquery = sql<number | null>`(select listing.price_cents from templates as listing where listing.source_app_id = ${schema.apps.id} and listing.status = 'listed' and listing.current_version_id is not null)`;

/** 1 while a listed paid listing waits for its first approval. */
export const paidInReviewSubquery = sql<number>`exists (${listedListing} and listing.current_version_id is null)`;

export function discoverConditions(filters: DiscoverFilters | undefined): SQL[] {
	const conditions: SQL[] = [sql`${schema.apps.removedFromDiscoverAt} is null`];
	if (!filters) return conditions;
	if (filters.category) conditions.push(eq(schema.apps.category, filters.category));
	if (filters.pricing === 'free') conditions.push(sql`not exists (${listedListing})`);
	if (filters.pricing === 'paid') {
		conditions.push(sql`exists (${listedListing} and listing.current_version_id is not null)`);
	}
	if (filters.reusableOnly) {
		conditions.push(sql`${schema.apps.lastDeployedAt} is not null`);
		conditions.push(sql`not exists (${listedListing} and listing.current_version_id is null)`);
	}
	return conditions;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/database/discover-conditions.test.ts`
Expected: PASS, 5 tests. If drizzle renders column references with different quoting than the assertions expect, adjust only the quoting in the assertions, never the conditions.

- [ ] **Step 5: Rewrite `TemplateService` for paid listings**

Replace the whole of `worker/database/services/TemplateService.ts` with:

```ts
/**
 * D1 reads and writes for paid listings, their versions and purchases. A
 * listing belongs to one app, which supplies its title and category.
 * Decisions live in services/templates/catalog.ts and reuse.ts; this service
 * only moves rows.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { TemplateListingStatus } from '../../../shared/types/templates';

export interface ListingVersionRow {
    listing: schema.Template;
    version: schema.TemplateVersion;
}

export interface PendingVersionRow extends ListingVersionRow {
    appTitle: string;
    creatorName: string | null;
    creatorEmail: string | null;
}

export interface CreatorListingRow {
    listing: schema.Template;
    appTitle: string;
    buyerCount: number;
    /** Newest first. */
    versions: schema.TemplateVersion[];
}

const buyerCountSql = sql<number>`(select count(*) from template_purchases as purchase where purchase.template_id = ${schema.templates.id})`;

export class TemplateService extends BaseService {
    async getListing(listingId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.id, listingId)).get();
        return row ?? null;
    }

    async getListingByApp(appId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.sourceAppId, appId)).get();
        return row ?? null;
    }

    /** Create an unlisted listing for an app; it is listed once its first version is stored. */
    async createListing(input: { sourceAppId: string; creatorUserId: string }): Promise<string> {
        const id = generateId();
        const now = new Date();
        await this.database.insert(schema.templates).values({
            id,
            sourceAppId: input.sourceAppId,
            creatorUserId: input.creatorUserId,
            status: 'unlisted',
            createdAt: now,
            updatedAt: now,
        });
        return id;
    }

    /** List a listing, or unlist it and withdraw any version still in review. */
    async setListingStatus(listingId: string, status: TemplateListingStatus): Promise<void> {
        const update = this.database
            .update(schema.templates)
            .set({ status, updatedAt: new Date() })
            .where(eq(schema.templates.id, listingId));
        if (status === 'listed') {
            await update;
            return;
        }
        const withdraw = this.database
            .update(schema.templateVersions)
            .set({ status: 'withdrawn' })
            .where(and(eq(schema.templateVersions.templateId, listingId), eq(schema.templateVersions.status, 'pending')));
        await this.database.batch([update, withdraw]);
    }

    async getVersion(versionId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /** Versions of a listing, newest first. */
    async listVersions(listingId: string): Promise<schema.TemplateVersion[]> {
        return this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, listingId))
            .orderBy(desc(schema.templateVersions.version))
            .all();
    }

    async getPendingVersion(listingId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(and(eq(schema.templateVersions.templateId, listingId), eq(schema.templateVersions.status, 'pending')))
            .get();
        return row ?? null;
    }

    async nextVersionNumber(listingId: string): Promise<number> {
        const row = await this.database
            .select({ latest: sql<number | null>`max(${schema.templateVersions.version})` })
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, listingId))
            .get();
        return (row?.latest ?? 0) + 1;
    }

    async insertVersion(version: schema.NewTemplateVersion): Promise<void> {
        await this.database.insert(schema.templateVersions).values(version);
    }

    async countBuyers(listingId: string): Promise<number> {
        const row = await this.database
            .select({ count: sql<number>`count(*)` })
            .from(schema.templatePurchases)
            .where(eq(schema.templatePurchases.templateId, listingId))
            .get();
        return row?.count ?? 0;
    }

    async listByCreator(userId: string): Promise<CreatorListingRow[]> {
        const listings = await this.database
            .select({ listing: schema.templates, appTitle: schema.apps.title, buyerCount: buyerCountSql })
            .from(schema.templates)
            .innerJoin(schema.apps, eq(schema.apps.id, schema.templates.sourceAppId))
            .where(eq(schema.templates.creatorUserId, userId))
            .orderBy(desc(schema.templates.createdAt))
            .all();
        if (listings.length === 0) return [];
        const versions = await this.database
            .select()
            .from(schema.templateVersions)
            .where(inArray(schema.templateVersions.templateId, listings.map((row) => row.listing.id)))
            .orderBy(desc(schema.templateVersions.version))
            .all();
        return listings.map((row) => ({
            ...row,
            versions: versions.filter((version) => version.templateId === row.listing.id),
        }));
    }

    /** Versions waiting for review, oldest first. */
    async listPending(): Promise<PendingVersionRow[]> {
        return this.database
            .select({
                listing: schema.templates,
                version: schema.templateVersions,
                appTitle: schema.apps.title,
                creatorName: schema.users.displayName,
                creatorEmail: schema.users.email,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .innerJoin(schema.apps, eq(schema.apps.id, schema.templates.sourceAppId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.status, 'pending'))
            .orderBy(schema.templateVersions.createdAt)
            .limit(100)
            .all();
    }

    async getVersionWithListing(versionId: string): Promise<ListingVersionRow | null> {
        const row = await this.database
            .select({ listing: schema.templates, version: schema.templateVersions })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /**
     * Approve a version: it becomes the listing's current version and its
     * price the listing's price, and the previous approved version is
     * superseded. Returns false when the version was no longer pending.
     */
    async approveVersion(input: {
        listingId: string;
        versionId: string;
        supersedeVersionId: string | null;
        reviewerId: string;
    }): Promise<boolean> {
        const now = new Date();
        // Evaluated inside the batch, so the follow-up statements only apply
        // when the approval above them took effect.
        const nowApproved = sql`exists (select 1 from template_versions as approved_version where approved_version.id = ${input.versionId} and approved_version.status = 'approved')`;
        const approve = this.database
            .update(schema.templateVersions)
            .set({ status: 'approved', reviewedBy: input.reviewerId, reviewedAt: now })
            .where(and(eq(schema.templateVersions.id, input.versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        const publish = this.database
            .update(schema.templates)
            .set({
                currentVersionId: input.versionId,
                priceCents: sql`(select approved_price.price_cents from template_versions as approved_price where approved_price.id = ${input.versionId})`,
                updatedAt: now,
            })
            .where(and(eq(schema.templates.id, input.listingId), nowApproved));
        if (input.supersedeVersionId) {
            const supersede = this.database
                .update(schema.templateVersions)
                .set({ status: 'superseded' })
                .where(and(
                    eq(schema.templateVersions.id, input.supersedeVersionId),
                    eq(schema.templateVersions.status, 'approved'),
                    nowApproved,
                ));
            const [approved] = await this.database.batch([approve, supersede, publish]);
            return approved.length > 0;
        }
        const [approved] = await this.database.batch([approve, publish]);
        return approved.length > 0;
    }

    /** Returns false when the version was no longer pending. */
    async rejectVersion(versionId: string, reviewerId: string, reason: string): Promise<boolean> {
        const changed = await this.database
            .update(schema.templateVersions)
            .set({ status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        return changed.length > 0;
    }

    /** Returns false when the version was no longer pending. */
    async withdrawVersion(versionId: string): Promise<boolean> {
        const changed = await this.database
            .update(schema.templateVersions)
            .set({ status: 'withdrawn' })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')))
            .returning({ id: schema.templateVersions.id });
        return changed.length > 0;
    }

    async hasPurchase(listingId: string, userId: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templatePurchases.id })
            .from(schema.templatePurchases)
            .where(and(eq(schema.templatePurchases.templateId, listingId), eq(schema.templatePurchases.userId, userId)))
            .get();
        return row !== undefined;
    }

    /** Record a test-mode purchase (no charge). Buying twice keeps the first record. */
    async recordPurchase(input: { listingId: string; userId: string; priceCents: number }): Promise<void> {
        await this.database
            .insert(schema.templatePurchases)
            .values({
                id: generateId(),
                templateId: input.listingId,
                userId: input.userId,
                priceCents: input.priceCents,
                provider: 'test',
                createdAt: new Date(),
            })
            .onConflictDoNothing();
    }
}
```

- [ ] **Step 6: Extend `AppService` and the shared row types**

In `worker/database/types.ts`:
- add the import `import type { DiscoverFilters } from '../services/templates/reuse';`;
- add to `EnhancedAppData`:

```ts
    /** The approved price of a listed paid listing; null or absent for a free site. */
    paidPriceCents?: number | null;
    /** A listed paid listing is waiting for its first approval. */
    paidInReview?: boolean;
```

- add to `PublicAppQueryOptions` (the interface that extends `BaseAppQueryOptions` with `userId`):

```ts
    discover?: DiscoverFilters;
```

In `worker/database/services/AppService.ts`:
- add the imports `import type { TemplateCategory } from '../../../shared/types/templates';` and `import { discoverConditions, paidInReviewSubquery, paidPriceSubquery } from '../discover-conditions';`. Also add `DiscoverFilters` as a type import from `'../../services/templates/reuse'`.
- add to the `RankedAppQueryResult` interface (the one declaring `forkCount: number;`):

```ts
    paidPriceCents: number | null;
    paidInReview: number;
```

- in `getPublicApps`, add `discover` to the destructured options. Change `this.buildPublicAppConditions(framework, search)` to `this.buildPublicAppConditions(framework, search, discover)`. In the `appsWithAnalytics` mapping, add after `forkCount`:

```ts
                    paidPriceCents: row.paidPriceCents ?? null,
                    paidInReview: Boolean(row.paidInReview),
```

- replace `buildPublicAppConditions` with:

```ts
    private buildPublicAppConditions(
        framework?: string,
        search?: string,
        discover?: DiscoverFilters,
    ): WhereCondition[] {
        const whereConditions: WhereCondition[] = [
            // Only show public apps or apps from anonymous users
            or(
                eq(schema.apps.visibility, 'public'),
                isNull(schema.apps.userId)
            ),
            or(
                eq(schema.apps.status, 'completed'),
                eq(schema.apps.status, 'generating')
            ),
            // Use shared helper for common filters
            ...this.buildCommonAppFilters(framework, search),
            ...discoverConditions(discover),
        ];

        return whereConditions.filter(Boolean);
    }
```

- in `executeRankedQuery`, add these two fields to each of the three `.select({...})` objects (popular, trending, and the recent/starred branch):

```ts
                        paidPriceCents: paidPriceSubquery,
                        paidInReview: paidInReviewSubquery,
```

- replace `updateAppVisibility` with:

```ts
    /**
     * Update app visibility with ownership check. Publishing also records the
     * owner's category and consent to reuse.
     */
    async updateAppVisibility(
        appId: string,
        userId: string,
        visibility: 'private' | 'public',
        publishing?: { category: TemplateCategory | null; reuseConsentAt: Date },
    ): Promise<AppVisibilityUpdateResult> {
        // Check if app exists and user owns it
        const existingApp = await this.database
            .select({
                id: schema.apps.id,
                title: schema.apps.title,
                userId: schema.apps.userId,
                visibility: schema.apps.visibility
            })
            .from(schema.apps)
            .where(eq(schema.apps.id, appId))
            .limit(1);

        if (existingApp.length === 0) {
            return { success: false, error: 'App not found' };
        }

        if (existingApp[0].userId !== userId) {
            return { success: false, error: 'You can only change visibility of your own apps' };
        }

        // Bump `previewVersion` on every visibility change so outstanding
        // space-preview tokens (which embed the value at mint) are revoked
        // immediately after a public->private toggle.
        const updatedApps = await this.database
            .update(schema.apps)
            .set({
                visibility,
                ...(publishing ? { category: publishing.category, reuseConsentAt: publishing.reuseConsentAt } : {}),
                previewVersion: sql`${schema.apps.previewVersion} + 1`,
                updatedAt: new Date()
            })
            .where(eq(schema.apps.id, appId))
            .returning({
                id: schema.apps.id,
                title: schema.apps.title,
                visibility: schema.apps.visibility,
                updatedAt: schema.apps.updatedAt
            });

        if (updatedApps.length === 0) {
            return { success: false, error: 'Failed to update app visibility' };
        }

        return { success: true, app: updatedApps[0] };
    }

    /** What resolving a reuse start needs from the source app. */
    async getReuseSource(appId: string): Promise<{
        id: string;
        userId: string | null;
        title: string;
        visibility: 'private' | 'public';
        removedFromDiscoverAt: Date | null;
    } | null> {
        const row = await this.database
            .select({
                id: schema.apps.id,
                userId: schema.apps.userId,
                title: schema.apps.title,
                visibility: schema.apps.visibility,
                removedFromDiscoverAt: schema.apps.removedFromDiscoverAt,
            })
            .from(schema.apps)
            .where(eq(schema.apps.id, appId))
            .get();
        return row ?? null;
    }

    /** The owner's publishing choices and any admin removal. */
    async getPublishingState(appId: string): Promise<{
        visibility: 'private' | 'public';
        category: TemplateCategory | null;
        removedFromDiscoverAt: Date | null;
        removedFromDiscoverReason: string | null;
    } | null> {
        const row = await this.database
            .select({
                visibility: schema.apps.visibility,
                category: schema.apps.category,
                removedFromDiscoverAt: schema.apps.removedFromDiscoverAt,
                removedFromDiscoverReason: schema.apps.removedFromDiscoverReason,
            })
            .from(schema.apps)
            .where(eq(schema.apps.id, appId))
            .get();
        return row ?? null;
    }

    /** Hide an app from Discover and block its reuse, or restore it. False when the app doesn't exist. */
    async setRemovedFromDiscover(appId: string, removal: { by: string; reason: string } | null): Promise<boolean> {
        const changed = await this.database
            .update(schema.apps)
            .set(removal
                ? { removedFromDiscoverAt: new Date(), removedFromDiscoverBy: removal.by, removedFromDiscoverReason: removal.reason }
                : { removedFromDiscoverAt: null, removedFromDiscoverBy: null, removedFromDiscoverReason: null })
            .where(eq(schema.apps.id, appId))
            .returning({ id: schema.apps.id });
        return changed.length > 0;
    }

    /** The app another app was started from, for its "Started from" line. */
    async getStartedFrom(appId: string): Promise<{
        id: string;
        title: string;
        creatorName: string | null;
        visibility: 'private' | 'public';
        removedFromDiscoverAt: Date | null;
    } | null> {
        const row = await this.database
            .select({
                id: schema.apps.id,
                title: schema.apps.title,
                creatorName: schema.users.displayName,
                visibility: schema.apps.visibility,
                removedFromDiscoverAt: schema.apps.removedFromDiscoverAt,
            })
            .from(schema.apps)
            .leftJoin(schema.users, eq(schema.users.id, schema.apps.userId))
            .where(eq(schema.apps.id, appId))
            .get();
        return row ?? null;
    }
```

`this.database` in `AppService` is the drizzle D1 instance used by the other methods in the file. If the file reads through a different accessor, use that accessor instead; keep each query's shape.

- [ ] **Step 7: Typecheck the two services**

Run: `npx tsc -p tsconfig.worker.json --noEmit 2>&1 | grep -E "TemplateService.ts|AppService.ts|discover-conditions.ts|database/types.ts"`
Expected: no output. Errors elsewhere are expected until Task 8 (see Global Constraints).

- [ ] **Step 8: Run the tests**

Run: `npx vitest run worker/database/discover-conditions.test.ts worker/database/templates-schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add worker/database/services/TemplateService.ts worker/database/discover-conditions.ts worker/database/discover-conditions.test.ts worker/database/services/AppService.ts worker/database/types.ts
git commit -m "feat(discover): paid listing storage and Discover filters in D1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Seeding a new app from a published site

**Files:**
- Modify: `worker/agents/core/types.ts` (remove `TemplateSeed`; `AgentInitArgs.templateSeed` becomes `reuseSeed`)
- Modify: `worker/agents/core/state.ts` (`TemplateStart` becomes `ReuseStart`)
- Rename: `worker/agents/think/template-start.ts` to `worker/agents/think/site-start.ts`, and `template-start.test.ts` to `site-start.test.ts`
- Modify: `worker/agents/think/turn-message.ts` and `turn-message.test.ts`
- Modify: `worker/agents/core/behaviors/think.ts` and `worker/agents/core/behaviors/base.ts`
- Modify: `worker/agents/core/codingAgent.ts`
- Create: `worker/services/templates/reuse-lookup.ts`
- Modify: `worker/api/controllers/agent/controller.ts` and `worker/api/controllers/agent/types.ts`
- Rename and rewrite the wiring test: `worker/api/controllers/agent/template-start-wiring.test.ts` becomes `site-start-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `ReuseSeed`, `resolveReuseStart` and `ReuseLookup` (Task 4);
  - `AppService.getReuseSource` and `AppService.updateApp` (Task 5, and existing);
  - `TemplateService.getListingByApp`, `getVersion` and `hasPurchase` (Task 5);
  - `getAgentStubLightweight` and `getSpaceTemplateStub` from `worker/agents` (existing);
  - `readTemplateSnapshot` from `store.ts` (existing).
- Produces:
  - `AgentInitArgs.reuseSeed?: ReuseSeed`;
  - `ThinkState.reuseStart?: ReuseStart`, where `ReuseStart = { sourceAppId: string; sourceTitle: string; versionId: string | null }`;
  - `CodeGeneratorAgent.getDeployedCommit(): Promise<string | null>`;
  - the request body field `sourceAppId?: string` on `POST /api/agent`;
  - `createReuseLookup(env: Env): ReuseLookup`;
  - from `site-start.ts`: `siteStartInstruction(title, description)`, `siteCopyQuery(title)` and `initialProjectTitle(query, siteTitle, deriveTitle)`;
  - `buildTurnMessage({ ..., siteStart?: { title: string } })`.

- [ ] **Step 1: Write the failing wording and wiring tests**

Run `git mv worker/agents/think/template-start.ts worker/agents/think/site-start.ts` and `git mv worker/agents/think/template-start.test.ts worker/agents/think/site-start.test.ts`. Then replace the whole of `site-start.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { initialProjectTitle, siteCopyQuery, siteStartInstruction } from './site-start';

const derive = (text: string) => `derived:${text}`;

describe('siteStartInstruction', () => {
	it('writes the personalization instruction verbatim', () => {
		expect(siteStartInstruction('Fernwood', 'A bakery in Lisbon')).toBe(
			"This app started as a copy of the site Fernwood. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: A bakery in Lisbon. Keep none of the original site's copy. Then deploy.",
		);
	});
});

describe('siteCopyQuery', () => {
	it('stores a non-empty query for an exact copy', () => {
		expect(siteCopyQuery('Fernwood')).toBe('Start from Fernwood');
	});
});

describe('initialProjectTitle', () => {
	it('titles an exact copy after the site', () => {
		expect(initialProjectTitle('', 'Fernwood', derive)).toBe('Fernwood copy');
		expect(initialProjectTitle('   ', 'Fernwood', derive)).toBe('Fernwood copy');
	});

	it('titles a described start from the description', () => {
		expect(initialProjectTitle('A bakery in Lisbon', 'Fernwood', derive)).toBe('derived:A bakery in Lisbon');
	});

	it('keeps the default title without a site', () => {
		expect(initialProjectTitle('', undefined, derive)).toBe('derived:project');
	});
});
```

In `worker/agents/think/turn-message.test.ts`:
- change the import `import { templateStartInstruction } from './template-start';` to `import { siteStartInstruction } from './site-start';`;
- replace the `describe('buildTurnMessage on a template start', ...)` block with:

```ts
describe('buildTurnMessage on a site start', () => {
	it('adds the hidden personalization instruction right after the visible text', () => {
		const message = buildTurnMessage({
			id: 'm1',
			text: 'A bakery in Lisbon',
			images: [],
			references: [],
			siteStart: { title: 'Fernwood' },
		});
		expect(message.parts).toEqual([
			{ type: 'text', text: 'A bakery in Lisbon' },
			{
				type: 'text',
				text: siteStartInstruction('Fernwood', 'A bakery in Lisbon'),
				providerMetadata: { estori: { hidden: true } },
			},
		]);
		expect(isHiddenPart(message.parts[1])).toBe(true);
	});
});
```

Run `git mv worker/api/controllers/agent/template-start-wiring.test.ts worker/api/controllers/agent/site-start-wiring.test.ts`. Then replace its whole content with:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/controllers/agent/controller.ts',
		'/worker/agents/core/behaviors/think.ts',
		'/worker/agents/core/codingAgent.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('starting an app from a published site', () => {
	const controller = source('/worker/api/controllers/agent/controller.ts');
	const think = source('/worker/agents/core/behaviors/think.ts');
	const agent = source('/worker/agents/core/codingAgent.ts');

	it('resolves the site before spending an app-creation credit or creating an agent', () => {
		const resolve = controller.indexOf('resolveReuseStart(createReuseLookup(env), body.sourceAppId, user.id)');
		expect(resolve).toBeGreaterThan(-1);
		expect(resolve).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(resolve).toBeLessThan(controller.indexOf('const agentId = generateId()'));
	});

	it('passes the files to the Think agent and keeps no separate use counter', () => {
		expect(controller).toContain('thinkModelId: thinkModel.id, reuseSeed');
		expect(controller).not.toContain('incrementUseCount');
		expect(controller).not.toContain('templateSeed');
	});

	it('seeds the workspace from the site instead of an empty space', () => {
		expect(think).toContain('await this.seedFromSite(reuseSeed, described)');
		expect(think).toContain('space.importFiles(seed.files, `Start from ${seed.sourceTitle}`)');
		expect(think).toContain('if (!described) this.setMVPGenerated()');
		expect(think).toContain('siteCopyQuery(reuseSeed.sourceTitle)');
		expect(think).not.toContain('readTemplateSnapshot');
	});

	it('records the site start before the system prompt is built', () => {
		const initialize = think.slice(think.indexOf('async initialize('), think.indexOf('private async configureThinkAgent('));
		const record = initialize.indexOf('reuseStart: reuseSeed');
		expect(record).toBeGreaterThan(-1);
		expect(record).toBeLessThan(initialize.indexOf('await this.configureThinkAgent();'));
	});

	it('tells the model to rewrite a copy instead of asking clarifying questions', () => {
		const prompt = think.slice(think.indexOf('private buildSystemPrompt('), think.indexOf('private async seedEmptySpace('));
		expect(prompt).toContain('this.state.reuseStart');
		expect(prompt).toContain("'## Started from a published site'");
		expect(prompt).toContain('without calling \\`ask_questions\\`');
		expect(prompt).toContain("'## Clarify before building'");
	});

	it('personalizes only the first turn', () => {
		expect(think).toContain('this.isMVPGenerated() || !this.state.reuseStart ? undefined');
	});

	it('records where a copy came from on the saved app', () => {
		expect(agent).toContain('parentAppId: reuseStart?.sourceAppId ?? null');
		expect(agent).toContain('fromTemplateVersionId: reuseStart?.versionId ?? null');
		expect(agent).toContain("status: this.state.mvpGenerated ? 'completed' : 'generating'");
	});

	it('stamps the app row on every deploy so Discover knows the site is deployed', () => {
		expect(think.split('this.recordDeployedCommit(').length - 1).toBe(2);
		expect(think).toContain('lastDeployedAt: new Date()');
		expect(think).not.toContain('this.setState({ ...this.state, lastDeployedCommit: commitHash })');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/agents/think/site-start.test.ts worker/agents/think/turn-message.test.ts worker/api/controllers/agent/site-start-wiring.test.ts`
Expected: FAIL. `siteStartInstruction` is not exported, and the wiring markers are missing.

- [ ] **Step 3: Rewrite the site-start helpers and the turn message**

Replace the whole of `worker/agents/think/site-start.ts` with:

```ts
/**
 * Starting a Think app from a published site: the hidden instruction for the
 * personalization turn and the app's first title.
 */

export function siteStartInstruction(siteTitle: string, description: string): string {
	return `This app started as a copy of the site ${siteTitle}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: ${description}. Keep none of the original site's copy. Then deploy.`;
}

/** The query stored for an exact copy: the agent treats an empty query as uninitialized. */
export function siteCopyQuery(siteTitle: string): string {
	return `Start from ${siteTitle}`;
}

/** Title from the prompt, or "{site} copy" for an exact copy with no prompt. */
export function initialProjectTitle(
	query: string,
	siteTitle: string | undefined,
	deriveTitle: (text: string) => string,
): string {
	if (query.trim()) return deriveTitle(query);
	if (siteTitle) return `${siteTitle} copy`;
	return deriveTitle('project');
}
```

In `worker/agents/think/turn-message.ts`:
- change `import { templateStartInstruction } from './template-start';` to `import { siteStartInstruction } from './site-start';`;
- in `TurnMessageInput`, replace the `templateStart?: { name: string };` field and its comment with:

```ts
	/** The published site this app was copied from; set only on its first turn. */
	siteStart?: { title: string };
```

- in `buildTurnMessage`, rename the destructured `templateStart` to `siteStart`, and change the push line to:

```ts
	if (siteStart) parts.push(hiddenText(siteStartInstruction(siteStart.title, text)));
```

- [ ] **Step 4: Replace the seed and state types**

In `worker/agents/core/types.ts`, delete the `TemplateSeed` interface and its doc comment. In `AgentInitArgs`, replace:

```ts
    /** Start from this template version instead of an empty workspace. */
    templateSeed?: TemplateSeed;
```

with:

```ts
    /** Start from a published site's files instead of an empty workspace. */
    reuseSeed?: ReuseSeed;
```

In `worker/agents/core/state.ts`, replace the `TemplateStart` interface with:

```ts
/** The published site a Think app was copied from. */
export interface ReuseStart {
    sourceAppId: string;
    sourceTitle: string;
    /** The approved paid version copied, or null for a free site's latest deploy. */
    versionId: string | null;
}
```

and replace the `templateStart?: TemplateStart;` field and its comment in `ThinkState` with:

```ts
    /** Set when the app was copied from a published site; its first turn personalizes the copy. */
    reuseStart?: ReuseStart;
```

- [ ] **Step 5: Update the Think behavior**

In `worker/agents/core/behaviors/think.ts`:

1. Imports:
   - change `import { AgentInitArgs, DeploymentTarget, TemplateSeed, TemplateSource } from '../types';` to `import { AgentInitArgs, DeploymentTarget, ReuseSeed, TemplateSource } from '../types';`;
   - delete `import { readTemplateSnapshot } from 'worker/services/templates/store';`;
   - change `import { initialProjectTitle, templateCopyQuery } from '../../think/template-start';` to `import { initialProjectTitle, siteCopyQuery } from '../../think/site-start';`.
2. In `initialize`:
   - destructure `reuseSeed` instead of `templateSeed`;
   - replace the three lines computing `baseName`, `described` and `storedQuery` with:

```ts
		const baseName = (query || reuseSeed?.sourceTitle || 'project').toString();
		const described = query.trim().length > 0;
		const storedQuery = !described && reuseSeed ? siteCopyQuery(reuseSeed.sourceTitle) : query;
```

   - change the title line to `title: initialProjectTitle(query, reuseSeed?.sourceTitle, deriveProjectTitle),`;
   - replace the `templateStart: ...` state line and its comment with:

```ts
			// Set before the agent is configured, because the system prompt depends on it.
			reuseStart: reuseSeed
				? { sourceAppId: reuseSeed.sourceAppId, sourceTitle: reuseSeed.sourceTitle, versionId: reuseSeed.versionId }
				: undefined,
```

   - replace the seeding branch with:

```ts
		if (reuseSeed) {
			await this.seedFromSite(reuseSeed, described);
		} else {
			await this.seedEmptySpace();
		}
```

3. In `buildSystemPrompt`, replace the `templateStart` / `startGuidance` block's first branch with:

```ts
		const reuseStart = this.state.reuseStart;
		const startGuidance = reuseStart
			? [
					'## Started from a published site',
					`This app started as a copy of the published site "${reuseStart.sourceTitle}". Its files already contain a complete, working site. When the user describes their business, rewrite the existing site for it in that same turn without calling \`ask_questions\`: infer anything they did not say and invent plausible business names, product names, prices and copy that fit their description. Keep the layout, components, styles and working features.`,
				]
			: [
```

   Keep the existing `'## Clarify before building'` array as the `else` branch, unchanged.
4. Replace the whole `seedFromTemplate` method, with its doc comment, by:

```ts
	/**
	 * Start the workspace from a published site: the usual empty seed, the
	 * site's files as one commit, then a deploy so the preview shows the copy
	 * before any model turn. Throws when the copy cannot be made, which fails
	 * initialization before the app is saved.
	 */
	private async seedFromSite(seed: ReuseSeed, described: boolean): Promise<void> {
		await this.seedEmptySpace();
		await this.callSpace((space) => space.importFiles(seed.files, `Start from ${seed.sourceTitle}`));
		const previewUrl = await this.deployCurrentBranch();
		if (!previewUrl) throw new Error(`${seed.sourceTitle} could not be deployed`);
		if (!described) this.setMVPGenerated();
	}
```

5. Next to `getTemplateSource`, add:

```ts
	override async getDeployedCommit(): Promise<string | null> {
		return this.state.lastDeployedCommit ?? null;
	}

	/** Remember the deployed commit and stamp the app row; Discover reads the stamp to know the site is deployed. */
	private recordDeployedCommit(commit: string): void {
		this.setState({ ...this.state, lastDeployedCommit: commit });
		void new AppService(this.env).updateApp(this.getAgentId(), { lastDeployedAt: new Date() });
	}
```

6. Replace `this.setState({ ...this.state, lastDeployedCommit: commitHash });` with `this.recordDeployedCommit(commitHash);`, and `this.setState({ ...this.state, lastDeployedCommit: result.commit_hash });` with `this.recordDeployedCommit(result.commit_hash);`.
7. Replace the first-turn line `const templateStart = this.isMVPGenerated() ? undefined : this.state.templateStart;` and its use with:

```ts
					const siteStart =
						this.isMVPGenerated() || !this.state.reuseStart ? undefined : { title: this.state.reuseStart.sourceTitle };
					const message = buildTurnMessage({ id: generateNanoId(), text: compiled, images, references, siteStart });
```

In `worker/agents/core/behaviors/base.ts`, add next to `getTemplateSource`:

```ts
    /** The last deployed commit; only Think apps record one. */
    public async getDeployedCommit(): Promise<string | null> {
        return null;
    }
```

- [ ] **Step 6: Record the origin on the saved app and expose the deployed commit**

In `worker/agents/core/codingAgent.ts`:
- next to `getTemplateSource`, add:

```ts
    /** The last deployed commit; null unless a deployed Think app. */
    async getDeployedCommit(): Promise<string | null> {
        return this.behavior.getDeployedCommit();
    }
```

- in `saveToDatabase`, replace `const fromTemplateVersionId = 'templateStart' in state ? state.templateStart?.versionId ?? null : null;` with `const reuseStart = 'reuseStart' in state ? state.reuseStart : undefined;`, and replace the `fromTemplateVersionId,` property in `createApp({...})` with:

```ts
            parentAppId: reuseStart?.sourceAppId ?? null,
            fromTemplateVersionId: reuseStart?.versionId ?? null,
```

- [ ] **Step 7: Resolve the start in the agent controller**

Create `worker/services/templates/reuse-lookup.ts`:

```ts
/** The D1, agent, workspace and R2 reads behind resolveReuseStart. */

import { AppService, TemplateService } from '../../database';
import { getAgentStubLightweight, getSpaceTemplateStub } from '../../agents';
import { readTemplateSnapshot } from './store';
import type { ReuseLookup } from './start';

export function createReuseLookup(env: Env): ReuseLookup {
	const apps = new AppService(env);
	const listings = new TemplateService(env);
	return {
		getSourceApp: (appId) => apps.getReuseSource(appId),
		getListingByApp: (appId) => listings.getListingByApp(appId),
		getVersion: (versionId) => listings.getVersion(versionId),
		hasPurchase: (listingId, userId) => listings.hasPurchase(listingId, userId),
		async getAgentFacts(appId) {
			try {
				const agent = await getAgentStubLightweight(env, appId);
				const [behaviorType, deployedCommit] = await Promise.all([agent.getBehaviorType(), agent.getDeployedCommit()]);
				return { behaviorType, deployedCommit };
			} catch {
				return { behaviorType: 'unknown', deployedCommit: null };
			}
		},
		async readLiveTree(appId, commit) {
			const space = getSpaceTemplateStub(env, appId);
			if (!space) throw new Error('The site workspace is unavailable');
			return space.readTreeAtCommit(commit);
		},
		readSnapshot: (snapshotKey) => readTemplateSnapshot(env.TEMPLATES_BUCKET, snapshotKey),
	};
}
```

`getAgentStubLightweight` is exported from `worker/agents/index.ts`; the app view controller already uses it. If its return type lacks `getDeployedCommit`, it is the same `CodeGeneratorAgent` stub, so the method added in Step 6 is available.

In `worker/api/controllers/agent/types.ts`, replace the `templateId?: string;` field and its comment with:

```ts
    /** Start from this published site (Think apps only); the query may then be empty. */
    sourceAppId?: string;
```

In `worker/api/controllers/agent/controller.ts`:
- **imports:**
  - change `type TemplateSeed` to `type ReuseSeed`;
  - change `import { AppService, ModelConfigService, TemplateService } from '../../../database';` back to `import { AppService, ModelConfigService } from '../../../database';`;
  - replace `import { resolveTemplateStart } from '../../../services/templates/start';` with:

```ts
import { resolveReuseStart } from '../../../services/templates/start';
import { createReuseLookup } from '../../../services/templates/reuse-lookup';
```

- rename `startsFromTemplate` to `startsFromSite`, defined as `body.sourceAppId !== undefined`;
- replace the `templateSeed` block with:

```ts
            let reuseSeed: ReuseSeed | undefined;
            if (startsFromSite) {
                const start = await resolveReuseStart(createReuseLookup(env), body.sourceAppId, user.id);
                if (!start.ok) {
                    return CodingAgentController.createErrorResponse(start.error, start.status);
                }
                reuseSeed = start.seed;
            }
```

- change `const behaviorType: BehaviorType = templateSeed ? 'think' : resolveBehaviorType(body);` to use `reuseSeed`;
- change `{ ...baseInitArgs, thinkModelId: thinkModel.id, templateSeed }` to `{ ...baseInitArgs, thinkModelId: thinkModel.id, reuseSeed }`;
- delete the whole `if (templateSeed) { await new TemplateService(env).incrementUseCount(...) ... }` block inside the background initialization.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run worker/agents/think/site-start.test.ts worker/agents/think/turn-message.test.ts worker/api/controllers/agent/site-start-wiring.test.ts worker/agents/think/reference-transport-wiring.test.ts`
Expected: PASS for all four files.

Run: `npx tsc -p tsconfig.worker.json --noEmit 2>&1 | grep -E "agents/|controllers/agent/|reuse-lookup"`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add worker/agents worker/services/templates/reuse-lookup.ts worker/api/controllers/agent
git commit -m "feat(discover): seed a new app from a published site's files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Publishing and admin API

**Files:**
- Create: `worker/api/controllers/publishing/types.ts`
- Create: `worker/api/controllers/publishing/publishingDto.ts`
- Create: `worker/api/controllers/publishing/publishingDto.test.ts`
- Create: `worker/api/controllers/publishing/controller.ts`
- Create: `worker/api/controllers/publishing/adminController.ts`
- Create: `worker/api/routes/publishingRoutes.ts`
- Create: `worker/api/controllers/publishing/publishing-routes-wiring.test.ts`
- Modify: `worker/api/routes/index.ts`
- Modify: `worker/api/routes/appRoutes.ts` (remove the visibility route)
- Modify: `worker/api/controllers/apps/controller.ts` (remove `updateAppVisibility`)
- Delete:
  - `worker/api/routes/templateRoutes.ts`;
  - `worker/api/controllers/templates/` (every file);
  - `worker/services/templates/fixtures.ts`, if it still exists.

**Interfaces:**
- Consumes:
  - `publishSite` and `PublishDeps` (Task 3);
  - `parsePublishRequest`, `publishEligibilityReason`, `parseDiscoverRemoval` and `SITE_UNAVAILABLE_MESSAGE` (Task 2);
  - `canSubmitNewVersion`, `canWithdraw`, `canReview`, `purchaseDecision`, `parseRejectionReason`, `supersededVersionId`, `isTemplateShotKind` and `VERSION_IN_REVIEW_ERROR` (Task 2);
  - `submitTemplateVersion`, `TemplateSubmissionError` and `READ_FAILED_MESSAGE` (submit.ts);
  - `r2TemplateStore`, `readTemplateSnapshot`, `templateImageResponse` and `createTemplateShotCapturer` (existing);
  - the `TemplateService` and `AppService` methods (Task 5), and `getDeployedCommit` (Task 6).
- Produces the routes:
  - `PUT /api/apps/:id/visibility` (owner);
  - `GET /api/apps/:id/publishing` (owner);
  - `POST /api/apps/:id/paid-listing/versions` (owner);
  - `POST /api/apps/:id/paid-listing/versions/:versionId/withdraw` (owner);
  - `POST /api/apps/:id/purchases` (signed in);
  - `GET /api/paid-listings/mine` (signed in);
  - `GET /api/admin/reviews`;
  - `GET /api/admin/template-versions/:id/files`, `GET /api/admin/template-versions/:id/file?path=` and `GET /api/admin/template-versions/:id/screenshots/:kind`;
  - `POST /api/admin/template-versions/:id/approve` and `POST /api/admin/template-versions/:id/reject`;
  - `PUT /api/admin/apps/:id/discover`.
- Produces the response types listed in Step 3.

- [ ] **Step 1: Write the failing DTO and route-wiring tests**

Create `worker/api/controllers/publishing/publishingDto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Template, TemplateVersion } from '../../../database/schema';
import { toOwnerPaidListing, toPendingReview } from './publishingDto';

const listing: Template = {
	id: 'l1',
	sourceAppId: 'app1',
	creatorUserId: 'owner',
	currentVersionId: null,
	status: 'listed',
	priceCents: 0,
	createdAt: null,
	updatedAt: null,
};

const version: TemplateVersion = {
	id: 'v1',
	templateId: 'l1',
	version: 1,
	sourceCommit: 'c1',
	snapshotKey: 'templates/l1/v1/files.json',
	fileCount: 5,
	totalBytes: 2048,
	desktopShotKey: 'templates/l1/v1/desktop.jpg',
	mobileShotKey: 'templates/l1/v1/mobile.jpg',
	priceCents: 2900,
	status: 'pending',
	rightsConfirmedAt: new Date(0),
	reviewedBy: null,
	reviewedAt: null,
	rejectionReason: null,
	createdAt: new Date(0),
};

describe('toOwnerPaidListing', () => {
	it('has no approved price before the first approval', () => {
		const view = toOwnerPaidListing(listing, [version], 0);
		expect(view.approvedPriceCents).toBeNull();
		expect(view.versions).toEqual([
			{
				id: 'v1',
				version: 1,
				priceCents: 2900,
				status: 'pending',
				rejectionReason: null,
				submittedAt: new Date(0).toISOString(),
				reviewedAt: null,
			},
		]);
	});

	it('reports the approved price once a version is current', () => {
		const view = toOwnerPaidListing({ ...listing, currentVersionId: 'v1', priceCents: 2900 }, [], 3);
		expect(view.approvedPriceCents).toBe(2900);
		expect(view.buyerCount).toBe(3);
	});
});

describe('toPendingReview', () => {
	it('shows the asked price and never exposes storage keys', () => {
		const review = toPendingReview({
			listing,
			version,
			appTitle: 'North Ridge',
			creatorName: null,
			creatorEmail: 'c@example.test',
		});
		expect(review).toMatchObject({
			versionId: 'v1',
			appId: 'app1',
			appTitle: 'North Ridge',
			priceCents: 2900,
			creatorName: 'Unknown',
			desktopShotUrl: '/api/admin/template-versions/v1/screenshots/desktop',
		});
		expect(JSON.stringify(review)).not.toContain('templates/l1');
	});
});
```

Create `worker/api/controllers/publishing/publishing-routes-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/publishingRoutes.ts', '/worker/api/routes/index.ts', '/worker/api/routes/appRoutes.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('publishing routes', () => {
	const routes = source('/worker/api/routes/publishingRoutes.ts');
	const lines = routes.split('\n');

	it('puts every admin route behind the admin auth level', () => {
		const adminLines = lines.filter((line) => line.includes("'/api/admin/"));
		expect(adminLines).toHaveLength(7);
		for (const line of adminLines) expect(line).toContain('setAuthLevel(AuthConfig.admin)');
	});

	it('lets only the owner publish and manage a paid listing', () => {
		for (const path of [
			"'/api/apps/:id/visibility'",
			"'/api/apps/:id/publishing'",
			"'/api/apps/:id/paid-listing/versions'",
			"'/api/apps/:id/paid-listing/versions/:versionId/withdraw'",
		]) {
			const line = lines.find((candidate) => candidate.includes(path));
			expect(line).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		}
	});

	it('replaces the old visibility route and registers before the app routes', () => {
		expect(source('/worker/api/routes/appRoutes.ts')).not.toContain("'/:id/visibility'");
		const index = source('/worker/api/routes/index.ts');
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeGreaterThan(-1);
		expect(index.indexOf('setupPublishingRoutes(app)')).toBeLessThan(index.indexOf('setupAppRoutes(app)'));
		expect(index).not.toContain('setupTemplateRoutes');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/api/controllers/publishing/publishingDto.test.ts worker/api/controllers/publishing/publishing-routes-wiring.test.ts`
Expected: FAIL. `./publishingDto` is missing and `publishingRoutes.ts` does not exist.

- [ ] **Step 3: Add the API types**

Create `worker/api/controllers/publishing/types.ts`:

```ts
/** API types for publishing sites, paid listings, purchases and admin review. */

import type {
    TemplateCategory,
    TemplateListingStatus,
    TemplateVersionStatus,
} from '../../../../shared/types/templates';

export interface PublishSiteRequest {
    visibility: 'private' | 'public';
    reuseConsent?: boolean;
    category?: TemplateCategory | null;
    priceCents?: number;
}

export interface PublishSiteData {
    visibility: 'private' | 'public';
    /** A paid version is waiting for an admin. */
    inReview: boolean;
    message: string;
}

export interface PaidListingVersionView {
    id: string;
    version: number;
    priceCents: number;
    status: TemplateVersionStatus;
    rejectionReason: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
}

export interface OwnerPaidListing {
    id: string;
    status: TemplateListingStatus;
    /** The approved price, or null before the first approval. */
    approvedPriceCents: number | null;
    currentVersionId: string | null;
    buyerCount: number;
    /** Newest first. */
    versions: PaidListingVersionView[];
}

export interface SitePublishingData {
    visibility: 'private' | 'public';
    category: TemplateCategory | null;
    /** Why the app can't be published now, or null when it can. */
    ineligibleReason: string | null;
    listing: OwnerPaidListing | null;
    removedFromDiscover: { reason: string | null } | null;
}

export interface PaidVersionActionData {
    versionId: string;
    status: TemplateVersionStatus;
}

export interface SitePurchaseData {
    appId: string;
    purchased: true;
    testMode: true;
}

export interface MyPaidListing extends OwnerPaidListing {
    appId: string;
    appTitle: string;
}

export interface MyPaidListingsData {
    listings: MyPaidListing[];
}

export interface PendingReview {
    versionId: string;
    version: number;
    listingId: string;
    appId: string;
    appTitle: string;
    priceCents: number;
    fileCount: number;
    totalBytes: number;
    creatorName: string;
    creatorEmail: string | null;
    submittedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PendingReviewsData {
    reviews: PendingReview[];
}

export interface ReviewVersionFilesData {
    files: Array<{ path: string; bytes: number }>;
}

export interface ReviewVersionFileData {
    path: string;
    bytes: number;
    binary: boolean;
    content: string | null;
}

export interface RejectVersionRequest {
    reason: string;
}

export interface DiscoverRemovalRequest {
    removed: boolean;
    reason?: string;
}

export interface DiscoverRemovalData {
    appId: string;
    removed: boolean;
}
```

- [ ] **Step 4: Add the DTO projections**

Create `worker/api/controllers/publishing/publishingDto.ts`:

```ts
/**
 * Response projections for publishing and review endpoints: the single
 * source of truth for which listing fields leave the worker.
 */

import type { TemplateShotKind } from '../../../../shared/types/templates';
import type { Template, TemplateVersion } from '../../../database/schema';
import type { PendingVersionRow } from '../../../database/services/TemplateService';
import type { OwnerPaidListing, PaidListingVersionView, PendingReview } from './types';

const UNKNOWN_CREATOR = 'Unknown';

function isoDate(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

export function reviewScreenshotUrl(versionId: string, kind: TemplateShotKind): string {
    return `/api/admin/template-versions/${versionId}/screenshots/${kind}`;
}

export function toPaidListingVersion(version: TemplateVersion): PaidListingVersionView {
    return {
        id: version.id,
        version: version.version,
        priceCents: version.priceCents,
        status: version.status,
        rejectionReason: version.rejectionReason,
        submittedAt: isoDate(version.createdAt),
        reviewedAt: isoDate(version.reviewedAt),
    };
}

export function toOwnerPaidListing(listing: Template, versions: TemplateVersion[], buyerCount: number): OwnerPaidListing {
    return {
        id: listing.id,
        status: listing.status,
        approvedPriceCents: listing.currentVersionId ? listing.priceCents : null,
        currentVersionId: listing.currentVersionId,
        buyerCount,
        versions: [...versions].sort((a, b) => b.version - a.version).map(toPaidListingVersion),
    };
}

export function toPendingReview(row: PendingVersionRow): PendingReview {
    return {
        versionId: row.version.id,
        version: row.version.version,
        listingId: row.listing.id,
        appId: row.listing.sourceAppId,
        appTitle: row.appTitle,
        priceCents: row.version.priceCents,
        fileCount: row.version.fileCount,
        totalBytes: row.version.totalBytes,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        creatorEmail: row.creatorEmail,
        submittedAt: isoDate(row.version.createdAt),
        desktopShotUrl: reviewScreenshotUrl(row.version.id, 'desktop'),
        mobileShotUrl: reviewScreenshotUrl(row.version.id, 'mobile'),
    };
}
```

- [ ] **Step 5: Add the owner and buyer controller**

Create `worker/api/controllers/publishing/controller.ts`:

```ts
/**
 * Publishing endpoints: make an app public or private, manage its paid
 * listing, and buy a paid site. Review endpoints live in adminController.ts.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService, TemplateService } from '../../../database';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { getAgentStub, getAgentStubLightweight, getSpaceTemplateStub, type SpaceTemplateStub } from '../../../agents';
import type { TemplateSource } from '../../../agents/core/types';
import { generateId } from '../../../utils/idGenerator';
import { VERSION_IN_REVIEW_ERROR, canSubmitNewVersion, canWithdraw, purchaseDecision } from '../../../services/templates/catalog';
import {
    NOT_DEPLOYED_REASON,
    SITE_UNAVAILABLE_MESSAGE,
    parsePublishRequest,
    publishEligibilityReason,
    type PublishRequest,
} from '../../../services/templates/reuse';
import { publishSite, type PublishDeps } from '../../../services/templates/publish';
import { READ_FAILED_MESSAGE, TemplateSubmissionError, submitTemplateVersion } from '../../../services/templates/submit';
import { r2TemplateStore } from '../../../services/templates/store';
import { createTemplateShotCapturer } from '../../../services/templates/capture';
import { toOwnerPaidListing } from './publishingDto';
import type {
    MyPaidListingsData,
    PaidVersionActionData,
    PublishSiteData,
    PublishSiteRequest,
    SitePublishingData,
    SitePurchaseData,
} from './types';

function publishMessage(request: PublishRequest, inReview: boolean): string {
    if (request.visibility === 'private') return 'Your site is private';
    if (inReview) return 'Your site is public. Others can use it once an admin approves the price.';
    return request.priceCents > 0 ? 'Your publishing settings are saved' : 'Your site is public and others can reuse it';
}

export class PublishingController extends BaseController {
    static logger = createLogger('PublishingController');

    /** Make an app public (with consent, category and price) or private. */
    static async updateVisibility(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PublishSiteData>>> {
        try {
            const bodyResult = await PublishingController.parseJsonBody<PublishSiteRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<PublishSiteData>>;
            }
            const parsed = parsePublishRequest(bodyResult.data);
            if (!parsed.ok) {
                return PublishingController.createErrorResponse<PublishSiteData>(parsed.error, 400);
            }
            const outcome = await publishSite(
                PublishingController.publishDeps(env, context, context.pathParams.id),
                parsed.value,
            );
            if (!outcome.ok) {
                return PublishingController.createErrorResponse<PublishSiteData>(outcome.error, outcome.status);
            }
            return PublishingController.createSuccessResponse<PublishSiteData>({
                visibility: parsed.value.visibility,
                inReview: outcome.inReview,
                message: publishMessage(parsed.value, outcome.inReview),
            });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PublishingController.createErrorResponse<PublishSiteData>(error, 429);
            }
            this.logger.error('Error publishing site', error);
            return PublishingController.createErrorResponse<PublishSiteData>('Failed to update app visibility', 500);
        }
    }

    /** Publishing choices, eligibility, paid listing and removal for one of the owner's apps. */
    static async getPublishing(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePublishingData>>> {
        try {
            const appId = context.pathParams.id;
            const listings = new TemplateService(env);
            const [state, listing, facts] = await Promise.all([
                new AppService(env).getPublishingState(appId),
                listings.getListingByApp(appId),
                PublishingController.loadFacts(env, appId),
            ]);
            if (!state) {
                return PublishingController.createErrorResponse<SitePublishingData>('App not found', 404);
            }
            const [versions, buyerCount] = listing
                ? await Promise.all([listings.listVersions(listing.id), listings.countBuyers(listing.id)])
                : [[], 0];
            return PublishingController.createSuccessResponse<SitePublishingData>({
                visibility: state.visibility,
                category: state.category,
                ineligibleReason: publishEligibilityReason(facts.behaviorType, facts.deployedCommit !== null),
                listing: listing ? toOwnerPaidListing(listing, versions, buyerCount) : null,
                removedFromDiscover: state.removedFromDiscoverAt ? { reason: state.removedFromDiscoverReason } : null,
            });
        } catch (error) {
            this.logger.error('Error loading publishing state', error);
            return PublishingController.createErrorResponse<SitePublishingData>('Failed to load publishing settings', 500);
        }
    }

    /** Store the latest deploy of a paid site as a new version for review. */
    static async submitPaidUpdate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const appId = context.pathParams.id;
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            if (!listing || listing.status !== 'listed') {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Set a price for this site first', 400);
            }
            const versions = await listings.listVersions(listing.id);
            if (!canSubmitNewVersion(versions.map((version) => version.status))) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(VERSION_IN_REVIEW_ERROR, 409);
            }
            const source = await (await getAgentStub(env, appId)).getTemplateSource();
            if (!source) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(NOT_DEPLOYED_REASON, 400);
            }
            const priceCents = versions[0]?.priceCents ?? listing.priceCents;
            const versionId = await PublishingController.submitVersion(
                env,
                context,
                listing.id,
                source,
                priceCents,
                getSpaceTemplateStub(env, appId),
            );
            return PublishingController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'pending' });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PublishingController.createErrorResponse<PaidVersionActionData>(error, 429);
            }
            if (error instanceof TemplateSubmissionError) {
                this.logger.warn('Paid update failed', { status: error.status, message: error.message, cause: error.cause });
                return PublishingController.createErrorResponse<PaidVersionActionData>(error.message, error.status);
            }
            this.logger.error('Error submitting paid update', error);
            return PublishingController.createErrorResponse<PaidVersionActionData>('Failed to send the update for review', 500);
        }
    }

    static async withdrawPaidVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PaidVersionActionData>>> {
        try {
            const { id: appId, versionId } = context.pathParams;
            const listings = new TemplateService(env);
            const [listing, version] = await Promise.all([listings.getListingByApp(appId), listings.getVersion(versionId)]);
            if (!listing || !version || version.templateId !== listing.id) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Version not found', 404);
            }
            if (!canWithdraw(version.status)) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('Only versions in review can be withdrawn', 400);
            }
            if (!(await listings.withdrawVersion(versionId))) {
                return PublishingController.createErrorResponse<PaidVersionActionData>('This version is no longer in review', 409);
            }
            return PublishingController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'withdrawn' });
        } catch (error) {
            this.logger.error('Error withdrawing paid version', error);
            return PublishingController.createErrorResponse<PaidVersionActionData>('Failed to withdraw the version', 500);
        }
    }

    /** Record a test-mode purchase (no charge) of an approved paid site. */
    static async purchase(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePurchaseData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;
            const app = await new AppService(env).getReuseSource(appId);
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return PublishingController.createErrorResponse<SitePurchaseData>(SITE_UNAVAILABLE_MESSAGE, 404);
            }
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            const paid = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
            const hasPurchase = paid ? await listings.hasPurchase(listing.id, user.id) : false;
            const decision = purchaseDecision({
                priceCents: paid ? listing.priceCents : 0,
                isCreator: app.userId === user.id,
                hasPurchase,
            });
            if (!decision.ok) {
                return PublishingController.createErrorResponse<SitePurchaseData>(decision.error, decision.status);
            }
            if (paid && !decision.alreadyOwned) {
                await listings.recordPurchase({ listingId: listing.id, userId: user.id, priceCents: listing.priceCents });
            }
            return PublishingController.createSuccessResponse<SitePurchaseData>({ appId, purchased: true, testMode: true });
        } catch (error) {
            this.logger.error('Error buying site', error);
            return PublishingController.createErrorResponse<SitePurchaseData>('Failed to buy the site', 500);
        }
    }

    static async getMyPaidListings(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyPaidListingsData>>> {
        try {
            const rows = await new TemplateService(env).listByCreator(context.user!.id);
            return PublishingController.createSuccessResponse<MyPaidListingsData>({
                listings: rows.map((row) => ({
                    ...toOwnerPaidListing(row.listing, row.versions, row.buyerCount),
                    appId: row.listing.sourceAppId,
                    appTitle: row.appTitle,
                })),
            });
        } catch (error) {
            this.logger.error('Error loading paid listings', error);
            return PublishingController.createErrorResponse<MyPaidListingsData>('Failed to load your paid listings', 500);
        }
    }

    private static async loadFacts(env: Env, appId: string): Promise<{ behaviorType: string; deployedCommit: string | null }> {
        try {
            const agent = await getAgentStubLightweight(env, appId);
            const [behaviorType, deployedCommit] = await Promise.all([agent.getBehaviorType(), agent.getDeployedCommit()]);
            return { behaviorType, deployedCommit };
        } catch {
            return { behaviorType: 'unknown', deployedCommit: null };
        }
    }

    private static publishDeps(env: Env, context: RouteContext, appId: string): PublishDeps {
        const userId = context.user!.id;
        const apps = new AppService(env);
        const listings = new TemplateService(env);
        const space = getSpaceTemplateStub(env, appId);
        return {
            async loadListing() {
                const listing = await listings.getListingByApp(appId);
                if (!listing) return null;
                const pending = await listings.getPendingVersion(listing.id);
                return {
                    id: listing.id,
                    state: {
                        status: listing.status,
                        currentVersionId: listing.currentVersionId,
                        priceCents: listing.priceCents,
                        pendingPriceCents: pending?.priceCents ?? null,
                    },
                };
            },
            async loadSource() {
                const agent = await getAgentStub(env, appId);
                const behaviorType = await agent.getBehaviorType();
                return { behaviorType, source: behaviorType === 'think' ? await agent.getTemplateSource() : null };
            },
            async readTree(commit) {
                if (!space) throw new Error('The app workspace is unavailable');
                return space.readTreeAtCommit(commit);
            },
            createListing: () => listings.createListing({ sourceAppId: appId, creatorUserId: userId }),
            setListingStatus: (listingId, status) => listings.setListingStatus(listingId, status),
            async submitVersion(listingId, source, priceCents) {
                await PublishingController.submitVersion(env, context, listingId, source, priceCents, space);
            },
            async applyVisibility(request) {
                const result = await apps.updateAppVisibility(
                    appId,
                    userId,
                    request.visibility,
                    request.visibility === 'public' ? { category: request.category, reuseConsentAt: new Date() } : undefined,
                );
                if (!result.success) throw new Error(result.error ?? 'Failed to update app visibility');
                if (request.visibility === 'public') await apps.updateApp(appId, { lastDeployedAt: new Date() });
            },
        };
    }

    /** Store the deployed commit as a pending version; rate limited like submissions. Returns the version id. */
    private static async submitVersion(
        env: Env,
        context: RouteContext,
        listingId: string,
        source: TemplateSource,
        priceCents: number,
        space: SpaceTemplateStub | null,
    ): Promise<string> {
        if (!space) throw new TemplateSubmissionError(READ_FAILED_MESSAGE, 500);
        await RateLimitService.enforceTemplateSubmissionRateLimit(env, context.config.security.rateLimit, context.user!);
        const listings = new TemplateService(env);
        const version = await listings.nextVersionNumber(listingId);
        const now = new Date();
        const record = await submitTemplateVersion(
            {
                readTree: (commit) => space.readTreeAtCommit(commit),
                captureShot: createTemplateShotCapturer(env, PublishingController.logger),
                store: r2TemplateStore(env.TEMPLATES_BUCKET),
                onCleanupError: (error) => PublishingController.logger.warn('Paid version cleanup failed', error),
                recordVersion: (submission) =>
                    listings.insertVersion({
                        id: submission.versionId,
                        templateId: submission.templateId,
                        version,
                        priceCents,
                        sourceCommit: submission.sourceCommit,
                        snapshotKey: submission.snapshotKey,
                        fileCount: submission.fileCount,
                        totalBytes: submission.totalBytes,
                        desktopShotKey: submission.desktopShotKey,
                        mobileShotKey: submission.mobileShotKey,
                        status: 'pending',
                        rightsConfirmedAt: now,
                        createdAt: now,
                    }),
            },
            source,
            { templateId: listingId, versionId: generateId() },
        );
        return record.versionId;
    }
}
```

If `SpaceTemplateStub` is not exported as a type from `worker/agents/index.ts`, export it there; it is declared in that file. `enforceTemplateSubmissionRateLimit`'s third parameter is the authenticated user object the old templates controller passed (`context.user!`).

- [ ] **Step 6: Add the admin controller**

Create `worker/api/controllers/publishing/adminController.ts`. Copy `worker/api/controllers/templates/adminController.ts` with these exact changes:
- **Class:** rename it to `ReviewAdminController` and its logger to `createLogger('ReviewAdminController')`.
- **Imports:**
  - `toPendingTemplateVersion` from `'./templateDto'` becomes `toPendingReview` from `'./publishingDto'`;
  - the type imports become `PendingReviewsData`, `RejectVersionRequest`, `PaidVersionActionData`, `ReviewVersionFileData` and `ReviewVersionFilesData` from `'./types'`;
  - also import `AppService` from `'../../../database'` and `parseDiscoverRemoval` from `'../../../services/templates/reuse'`.
- **`listPending`:** returns `ControllerResponse<ApiResponse<PendingReviewsData>>` with `{ reviews: rows.map(toPendingReview) }`. The error message is unchanged.
- **Type swaps:** `TemplateVersionFilesData` becomes `ReviewVersionFilesData`, `TemplateVersionFileData` becomes `ReviewVersionFileData`, `TemplateVersionActionData` becomes `PaidVersionActionData`, and `RejectTemplateRequest` becomes `RejectVersionRequest`.
- **`approveVersion` body:**

```ts
            const versionId = context.pathParams.id;
            const listings = new TemplateService(env);
            const row = await listings.getVersionWithListing(versionId);
            if (!row) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Version not found', 404);
            }
            if (!canReview(row.version.status)) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>('Only versions in review can be approved', 400);
            }
            const approved = await listings.approveVersion({
                listingId: row.listing.id,
                versionId,
                supersedeVersionId: supersededVersionId(row.listing.currentVersionId, versionId),
                reviewerId: context.user!.id,
            });
            if (!approved) {
                return ReviewAdminController.createErrorResponse<PaidVersionActionData>(NO_LONGER_IN_REVIEW_MESSAGE, 409);
            }
            return ReviewAdminController.createSuccessResponse<PaidVersionActionData>({ versionId, status: 'approved' });
```

- **Not-found messages:** every `'Template version not found'` becomes `'Version not found'`.
- **New method,** added before `loadSnapshot`:

```ts
    /** Hide a public site from Discover and block its reuse, or restore it. */
    static async setDiscoverRemoval(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<DiscoverRemovalData>>> {
        try {
            const appId = context.pathParams.id;
            const bodyResult = await ReviewAdminController.parseJsonBody<DiscoverRemovalRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<DiscoverRemovalData>>;
            }
            const removal = parseDiscoverRemoval(bodyResult.data);
            if (!removal.ok) {
                return ReviewAdminController.createErrorResponse<DiscoverRemovalData>(removal.error, 400);
            }
            const changed = await new AppService(env).setRemovedFromDiscover(
                appId,
                removal.value.removed ? { by: context.user!.id, reason: removal.value.reason } : null,
            );
            if (!changed) {
                return ReviewAdminController.createErrorResponse<DiscoverRemovalData>('App not found', 404);
            }
            return ReviewAdminController.createSuccessResponse<DiscoverRemovalData>({ appId, removed: removal.value.removed });
        } catch (error) {
            this.logger.error('Error changing Discover removal', error);
            return ReviewAdminController.createErrorResponse<DiscoverRemovalData>('Failed to change the removal', 500);
        }
    }
```

  This method also needs `DiscoverRemovalData` and `DiscoverRemovalRequest` added to the `'./types'` import.

- [ ] **Step 7: Register the routes and remove the old ones**

Create `worker/api/routes/publishingRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { PublishingController } from '../controllers/publishing/controller';
import { ReviewAdminController } from '../controllers/publishing/adminController';

/** Publishing, paid listings, purchases, and admin review and moderation. */
export function setupPublishingRoutes(app: Hono<AppEnv>): void {
    // Owner publishing and paid listing
    app.put('/api/apps/:id/visibility', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.updateVisibility));
    app.get('/api/apps/:id/publishing', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.getPublishing));
    app.post('/api/apps/:id/paid-listing/versions', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.submitPaidUpdate));
    app.post('/api/apps/:id/paid-listing/versions/:versionId/withdraw', setAuthLevel(AuthConfig.ownerOnly), adaptController(PublishingController, PublishingController.withdrawPaidVersion));

    // Buyers and creators
    app.post('/api/apps/:id/purchases', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.purchase));
    app.get('/api/paid-listings/mine', setAuthLevel(AuthConfig.authenticated), adaptController(PublishingController, PublishingController.getMyPaidListings));

    // Admin review and moderation
    app.get('/api/admin/reviews', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listPending));
    app.get('/api/admin/template-versions/:id/files', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.listVersionFiles));
    app.get('/api/admin/template-versions/:id/file', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.readVersionFile));
    app.get('/api/admin/template-versions/:id/screenshots/:kind', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.serveVersionScreenshot));
    app.post('/api/admin/template-versions/:id/approve', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.approveVersion));
    app.post('/api/admin/template-versions/:id/reject', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.rejectVersion));
    app.put('/api/admin/apps/:id/discover', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.setDiscoverRemoval));
}
```

In `worker/api/routes/index.ts`, replace `import { setupTemplateRoutes } from './templateRoutes';` with `import { setupPublishingRoutes } from './publishingRoutes';`, and `setupTemplateRoutes(app);` with `setupPublishingRoutes(app);`. Update the comment above it to say "Publishing, paid listings and review (before app routes so the visibility route is matched here)".

In `worker/api/routes/appRoutes.ts`, delete the `// Update app visibility - OWNER ONLY` comment and the `appRouter.put('/:id/visibility', ...)` line. In `worker/api/controllers/apps/controller.ts`, delete the `updateAppVisibility` static method. Then remove any import it left unused, such as `UpdateAppVisibilityData` and `Visibility`, if nothing else uses them.

Delete the old template API:

```bash
git rm -r worker/api/controllers/templates worker/api/routes/templateRoutes.ts
git rm -q --ignore-unmatch worker/services/templates/fixtures.ts
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run worker/api/controllers/publishing/publishingDto.test.ts worker/api/controllers/publishing/publishing-routes-wiring.test.ts worker/middleware/auth/routeAuth.test.ts`
Expected: PASS for all three files.

Run: `npx tsc -p tsconfig.worker.json --noEmit 2>&1 | grep -E "controllers/publishing|publishingRoutes|routes/index|appRoutes|controllers/apps/"`
Expected: no output. `appView` errors remain until Task 8.

- [ ] **Step 9: Commit**

```bash
git add worker/api/controllers/publishing worker/api/routes/publishingRoutes.ts worker/api/routes/index.ts worker/api/routes/appRoutes.ts worker/api/controllers/apps/controller.ts worker/agents/index.ts
git commit -m "feat(discover): publishing, paid listing, purchase and review endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: App details and the Discover API

**Files:**
- Modify: `worker/api/controllers/appView/types.ts` and `worker/api/controllers/appView/controller.ts`
- Modify: `worker/database/types.ts` (`PublicAppListData`)
- Modify: `worker/api/controllers/apps/publicAppDto.ts`
- Modify: `worker/api/controllers/apps/controller.ts` (`getPublicApps`)
- Create: `worker/api/controllers/apps/discover-dto.test.ts`
- Create: `worker/api/controllers/appView/app-reuse-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `reuseDecision` and `parseDiscoverFilters` (Task 2);
  - `TemplateService.getListingByApp` and `hasPurchase`, and `AppService.getStartedFrom` and `updateApp` (Task 5);
  - `getDeployedCommit` (Task 6);
  - `UserService.getRole` (existing).
- Produces:
  - **`AppDetailsData`** gains `reuse: AppReuseView | null`, `startedFrom: StartedFromView | null`, `canModerate: boolean` and `removedFromDiscover: { reason: string | null } | null`, and loses `fromTemplate`.
  - **`PublicAppListData`** gains `category`, `priceCents: number | null`, `inReview: boolean` and `reusable: boolean`.
  - **`GET /api/apps/public`** accepts `category`, `pricing` and `reusableOnly`.

- [ ] **Step 1: Write the failing DTO and wiring tests**

Create `worker/api/controllers/apps/discover-dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { EnhancedAppData } from '../../../database/types';
import { toPublicAppListItem } from './publicAppDto';

function app(overrides: Partial<EnhancedAppData> = {}): EnhancedAppData {
	return {
		id: 'app1',
		title: 'Lumen Yoga',
		description: null,
		iconUrl: null,
		originalPrompt: 'secret prompt',
		finalPrompt: null,
		framework: '',
		userId: 'owner',
		sessionToken: null,
		visibility: 'public',
		status: 'completed',
		deploymentId: 'dep1',
		githubRepositoryUrl: null,
		githubRepositoryVisibility: null,
		isArchived: false,
		isFeatured: false,
		version: 1,
		parentAppId: null,
		fromTemplateVersionId: null,
		category: 'landing',
		reuseConsentAt: new Date(0),
		removedFromDiscoverAt: null,
		removedFromDiscoverBy: null,
		removedFromDiscoverReason: null,
		previewVersion: 0,
		screenshotUrl: null,
		screenshotCapturedAt: null,
		createdAt: new Date(0),
		updatedAt: new Date(0),
		lastDeployedAt: new Date(0),
		userName: 'Creator',
		userAvatar: null,
		starCount: 0,
		userStarred: false,
		userFavorited: false,
		...overrides,
	};
}

describe('toPublicAppListItem for Discover', () => {
	it('marks a deployed free site reusable with no price', () => {
		expect(toPublicAppListItem(app())).toMatchObject({ category: 'landing', priceCents: null, inReview: false, reusable: true });
	});

	it('shows the approved price of a paid site', () => {
		expect(toPublicAppListItem(app({ paidPriceCents: 2900 }))).toMatchObject({ priceCents: 2900, reusable: true });
	});

	it('is not reusable while a paid site waits for its first approval or before a recorded deploy', () => {
		expect(toPublicAppListItem(app({ paidInReview: true })).reusable).toBe(false);
		expect(toPublicAppListItem(app({ lastDeployedAt: null })).reusable).toBe(false);
	});

	it('never exposes the prompt, owner or deployment', () => {
		const item = JSON.stringify(toPublicAppListItem(app()));
		expect(item).not.toContain('secret prompt');
		expect(item).not.toContain('dep1');
		expect(item).not.toContain('"userId"');
	});
});
```

If `schema.App` has columns that the fixture above lacks, add them with null or default values; the typecheck in Step 7 lists any that are missing. Never remove a property the test asserts on.

Create `worker/api/controllers/appView/app-reuse-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/controllers/appView/controller.ts', '/worker/api/controllers/apps/controller.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('app details for reuse', () => {
	const view = source('/worker/api/controllers/appView/controller.ts');

	it('reads the deployed commit with the other agent facts', () => {
		expect(view).toContain('agentStub.getDeployedCommit()');
	});

	it('decides what the viewer can do with the shared reuse rule', () => {
		expect(view).toContain('reuseDecision({');
		expect(view).toContain('startedFrom:');
		expect(view).toContain('canModerate');
		expect(view).not.toContain('fromTemplate');
	});

	it('records a deploy the app row has not seen yet', () => {
		expect(view).toContain("ctx.waitUntil(appService.updateApp(appResult.id, { lastDeployedAt: new Date() }))");
	});
});

describe('Discover listing', () => {
	it('parses and passes the Discover filters', () => {
		const apps = source('/worker/api/controllers/apps/controller.ts');
		expect(apps).toContain('parseDiscoverFilters(url.searchParams)');
		expect(apps).toContain('discover: discover.value');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/api/controllers/apps/discover-dto.test.ts worker/api/controllers/appView/app-reuse-wiring.test.ts`
Expected: FAIL, because the list item has no `reusable` field and the wiring markers are missing.

- [ ] **Step 3: Extend the public list item**

In `worker/database/types.ts`:
- add `| 'category'` to the `Pick<EnhancedAppData, ...>` list of `PublicAppListData`;
- turn the type into an intersection by appending after the closing `>`:

```ts
 & {
    /** The approved price of a paid site, or null for a free one. */
    priceCents: number | null;
    /** A paid site waiting for its first approval. */
    inReview: boolean;
    /** Others can start a new app from it now. */
    reusable: boolean;
};
```

In `worker/api/controllers/apps/publicAppDto.ts`, add to the object returned by `toPublicAppListItem`, after `framework`:

```ts
        category: app.category,
        priceCents: app.paidPriceCents ?? null,
        inReview: app.paidInReview ?? false,
        reusable: app.visibility === 'public' && app.lastDeployedAt !== null && !(app.paidInReview ?? false),
```

- [ ] **Step 4: Accept the Discover filters**

In `worker/api/controllers/apps/controller.ts` `getPublicApps`:
- add `import { parseDiscoverFilters } from '../../../services/templates/reuse';`;
- after the `parsePublicAppsQuery` validation block, add:

```ts
            const discover = parseDiscoverFilters(url.searchParams);
            if (!discover.ok) {
                return AppController.createErrorResponse<PublicAppsData>(discover.error, 400);
            }
```

- add `discover: discover.value,` to the options passed to `appService.getPublicApps({...})`.

- [ ] **Step 5: Add the reuse view to app details**

In `worker/api/controllers/appView/types.ts`:
- remove the `TemplateOrigin` import and the `fromTemplate` field;
- add:

```ts
/** What the viewer can do with a published site. */
export interface AppReuseView {
    /** The viewer can start a new app from this site now. */
    canUse: boolean;
    /** The site is paid and the viewer hasn't bought it. */
    needsPurchase: boolean;
    /** The approved price, or null for a free site. */
    priceCents: number | null;
    /** Why the site can't be used, shown to its owner; null when it can be or only needs a purchase. */
    unavailableReason: string | null;
}

/** The published site an app was copied from. */
export interface StartedFromView {
    appId: string;
    title: string;
    creatorName: string;
    /** The source is still public and in Discover. */
    available: boolean;
}
```

- add to `AppDetailsData`, where `fromTemplate` was:

```ts
    /** Null for private apps. */
    reuse: AppReuseView | null;
    startedFrom: StartedFromView | null;
    /** The viewer is an admin and may remove the site from Discover. */
    canModerate: boolean;
    /** Shown to the owner and admins only. */
    removedFromDiscover: { reason: string | null } | null;
```

In `worker/api/controllers/appView/controller.ts`:
- **Imports:**
  - replace `import { TemplateService } from '../../../database';` with `import { TemplateService, UserService } from '../../../database';`;
  - delete the `toTemplateOrigin` import;
  - add `import { reuseDecision } from '../../../services/templates/reuse';`;
  - add `AppReuseView` and `StartedFromView` to the existing type import from `'./types'`;
  - make sure `EnhancedAppData` is imported as a type from `'../../../database/types'`.
- **Context parameter:** rename `_ctx: ExecutionContext` to `ctx: ExecutionContext` in `getAppDetails`.
- **Agent facts:** declare `let deployedCommit: string | null = null;` next to `let behaviorType`. Add `agentStub.getDeployedCommit()` as a fourth element of the `Promise.all`, and assign `deployedCommit` from it alongside the other three.
- **Response:** replace the `origin` computation and the `fromTemplate: ...` property with:

```ts
            const [reuse, startedFrom, canModerate] = await Promise.all([
                AppViewController.loadReuseView(env, appResult, userId, behaviorType, deployedCommit),
                AppViewController.loadStartedFrom(env, appResult.parentAppId),
                userId ? new UserService(env).getRole(userId).then((role) => role === 'admin') : Promise.resolve(false),
            ]);
            if (behaviorType === 'think' && deployedCommit && !appResult.lastDeployedAt) {
                ctx.waitUntil(appService.updateApp(appResult.id, { lastDeployedAt: new Date() }));
            }
```

  and add to `responseData`:

```ts
                reuse,
                startedFrom,
                canModerate,
                removedFromDiscover:
                    (isOwner || canModerate) && appResult.removedFromDiscoverAt
                        ? { reason: appResult.removedFromDiscoverReason }
                        : null,
```

- **Helpers:** add these static methods to `AppViewController`:

```ts
    private static async loadReuseView(
        env: Env,
        app: EnhancedAppData,
        userId: string | undefined,
        behaviorType: BehaviorType | null,
        deployedCommit: string | null,
    ): Promise<AppReuseView | null> {
        if (app.visibility !== 'public') return null;
        const listings = new TemplateService(env);
        const listing = await listings.getListingByApp(app.id);
        const paid = listing !== null && listing.status === 'listed' && listing.currentVersionId !== null;
        const isOwner = !!userId && app.userId === userId;
        const hasPurchase = paid && userId && !isOwner ? await listings.hasPurchase(listing.id, userId) : false;
        const decision = reuseDecision({
            visibility: app.visibility,
            removedFromDiscover: app.removedFromDiscoverAt !== null,
            isThink: behaviorType === 'think',
            deployedCommit,
            listing: listing ? { status: listing.status, currentVersionId: listing.currentVersionId } : null,
            isOwner,
            hasPurchase,
        });
        return {
            canUse: decision.ok,
            needsPurchase: !decision.ok && decision.status === 402,
            priceCents: paid ? listing.priceCents : null,
            unavailableReason: decision.ok || decision.status === 402 ? null : decision.error,
        };
    }

    private static async loadStartedFrom(env: Env, parentAppId: string | null): Promise<StartedFromView | null> {
        if (!parentAppId) return null;
        try {
            const row = await new AppService(env).getStartedFrom(parentAppId);
            if (!row) return null;
            return {
                appId: row.id,
                title: row.title,
                creatorName: row.creatorName ?? 'Unknown',
                available: row.visibility === 'public' && row.removedFromDiscoverAt === null,
            };
        } catch (error) {
            AppViewController.logger.warn('Could not load the source of a copied app', error);
            return null;
        }
    }
```

`BehaviorType` is already imported in this controller. If `appResult`'s type does not expose `parentAppId`, `removedFromDiscoverAt` or `removedFromDiscoverReason`, those come from `schema.App`, which `EnhancedAppData` extends.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run worker/api/controllers/apps/discover-dto.test.ts worker/api/controllers/appView/app-reuse-wiring.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the whole backend**

Run: `npx tsc -p tsconfig.worker.json --noEmit`
Expected: no errors. The worker typecheck must be clean from here on.

Run these in three separate commands:
- `npx vitest run worker/services/templates worker/database`
- `npx vitest run worker/api worker/middleware`
- `npx vitest run worker/agents/think`

Expected: PASS for all three.

- [ ] **Step 8: Commit**

```bash
git add worker/api/controllers/appView worker/api/controllers/apps worker/database/types.ts
git commit -m "feat(discover): reuse, origin and moderation on app details; Discover filters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Frontend data layer

**Files:**
- Modify: `src/api-types.ts`
- Modify: `src/lib/api-client.ts`
- Modify: `src/lib/query-keys.ts` and `src/lib/query-keys.test.ts` (rewritten)
- Create: `src/hooks/use-publishing.ts`
- Create: `src/lib/reuse-start.ts` and `src/lib/reuse-start.test.ts`
- Create: `src/lib/paid-listing-display.ts` and `src/lib/paid-listing-display.test.ts`

**Interfaces:**
- Consumes: the Task 7 and Task 8 API types.
- Produces:
  - **API client:**
    - `apiClient.publishSite(appId, body)`, `getSitePublishing(appId)`, `submitPaidUpdate(appId)` and `withdrawPaidVersion(appId, versionId)`;
    - `purchaseSite(appId)` and `getMyPaidListings()`;
    - `getPendingReviews()`, `getReviewVersionFiles(versionId)`, `getReviewVersionFile(versionId, path)`, `approveReviewVersion(versionId)` and `rejectReviewVersion(versionId, reason)`;
    - `setDiscoverRemoval(appId, body)`;
    - `getPublicApps({ ..., category, pricing, reusableOnly })`.
  - **Hooks:**
    - `useSitePublishing(appId, enabled)`, `usePublishSite(appId)`, `useSubmitPaidUpdate(appId)` and `useWithdrawPaidVersion(appId)`;
    - `usePurchaseSite()` and `useMyPaidListings()`;
    - `usePendingReviews()`, `useReviewVersionFiles(versionId)`, `useReviewVersionFile(versionId, path)` and `useReviewVersion()`;
    - `useSetDiscoverRemoval()`.
  - **Helpers:** `reuseStartPath({ sourceAppId, description, modelId })`, `paidListingStatusView(listing)` and `formatFileSize(bytes)`.
  - **Query keys:** `queryKeys.apps.strip()`, and `queryKeys.account.publishing.{all, app, mine, reviews, versionFiles, versionFile}`. `PaginatedAppsListFilters` gains `category` and `pricing`.

- [ ] **Step 1: Write the failing helper and key tests**

Create `src/lib/reuse-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reuseStartPath } from './reuse-start';

describe('reuseStartPath', () => {
	it('starts a Think session from the site with the trimmed description and model', () => {
		const path = reuseStartPath({ sourceAppId: 'app1', description: '  A bakery  ', modelId: 'anthropic/claude-sonnet-5-5' });
		const url = new URL(path, 'http://localhost');
		expect(url.pathname).toBe('/chat/new');
		expect(url.searchParams.get('source')).toBe('app1');
		expect(url.searchParams.get('query')).toBe('A bakery');
		expect(url.searchParams.get('behaviorType')).toBe('think');
		expect(url.searchParams.get('model')).toBe('anthropic/claude-sonnet-5-5');
	});

	it('leaves the model out when none is picked', () => {
		expect(new URL(reuseStartPath({ sourceAppId: 'app1', description: '' }), 'http://localhost').searchParams.has('model')).toBe(
			false,
		);
	});
});
```

Create `src/lib/paid-listing-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { OwnerPaidListing, PaidListingVersionView } from '@/api-types';
import { formatFileSize, paidListingStatusView } from './paid-listing-display';

function version(overrides: Partial<PaidListingVersionView>): PaidListingVersionView {
	return {
		id: 'v1',
		version: 1,
		priceCents: 2900,
		status: 'pending',
		rejectionReason: null,
		submittedAt: null,
		reviewedAt: null,
		...overrides,
	};
}

function listing(overrides: Partial<OwnerPaidListing>): OwnerPaidListing {
	return {
		id: 'l1',
		status: 'listed',
		approvedPriceCents: null,
		currentVersionId: null,
		buyerCount: 0,
		versions: [],
		...overrides,
	};
}

describe('paidListingStatusView', () => {
	it('shows nothing for a site that went back to free', () => {
		expect(paidListingStatusView(listing({ status: 'unlisted' }))).toBeNull();
	});

	it('shows the price in review before the first approval', () => {
		expect(paidListingStatusView(listing({ versions: [version({})] }))).toEqual({
			label: 'Price in review',
			variant: 'warning',
			detail: '$29 is waiting for an admin',
			pendingVersionId: 'v1',
		});
	});

	it('shows the rejection reason', () => {
		expect(
			paidListingStatusView(listing({ versions: [version({ status: 'rejected', rejectionReason: 'Copied brand' })] })),
		).toEqual({ label: 'Rejected', variant: 'error', detail: 'Copied brand', pendingVersionId: null });
	});

	it('shows the approved price and an update in review', () => {
		const approved = listing({
			approvedPriceCents: 2900,
			currentVersionId: 'v1',
			versions: [version({ id: 'v2', version: 2 }), version({ status: 'approved' })],
		});
		expect(paidListingStatusView(approved)).toEqual({
			label: 'Approved at $29',
			variant: 'success',
			detail: 'Version 2 is in review',
			pendingVersionId: 'v2',
		});
	});
});

describe('formatFileSize', () => {
	it('formats bytes, kilobytes and megabytes', () => {
		expect(formatFileSize(512)).toBe('512 B');
		expect(formatFileSize(2048)).toBe('2.0 KB');
		expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB');
	});
});
```

Replace the whole of `src/lib/query-keys.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { queryPersistOptions } from './query-client';
import { queryKeys } from './query-keys';

const { shouldDehydrateQuery } = queryPersistOptions.dehydrateOptions;

function persisted(queryKey: readonly unknown[]): boolean {
	return shouldDehydrateQuery({ queryKey, state: { status: 'success' } });
}

describe('publishing query keys', () => {
	it.each([
		['app', queryKeys.account.publishing.app('app1')],
		['mine', queryKeys.account.publishing.mine('user1')],
		['reviews', queryKeys.account.publishing.reviews()],
		['version files', queryKeys.account.publishing.versionFiles('v1')],
		['version file', queryKeys.account.publishing.versionFile('v1', 'src/index.ts')],
	])('keeps the private %s cache out of storage and under the account prefix', (_name, key) => {
		expect(key.slice(0, queryKeys.account.publishing.all().length)).toEqual(queryKeys.account.publishing.all());
		expect(key[0]).toBe(queryKeys.account.all[0]);
		expect(persisted(key)).toBe(false);
	});

	it('keeps the Discover strip under the public apps prefix', () => {
		expect(queryKeys.apps.strip().slice(0, queryKeys.apps.all.length)).toEqual(queryKeys.apps.all);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/reuse-start.test.ts src/lib/paid-listing-display.test.ts src/lib/query-keys.test.ts`
Expected: FAIL, because the modules and keys are missing.

- [ ] **Step 3: Re-export the new types**

In `src/api-types.ts`:
- delete the whole template `export type { ... } from 'worker/api/controllers/templates/types';` block, and the two `shared/types/templates.js` export lines that follow it;
- add:

```ts
export type {
	DiscoverRemovalData,
	DiscoverRemovalRequest,
	MyPaidListing,
	MyPaidListingsData,
	OwnerPaidListing,
	PaidListingVersionView,
	PaidVersionActionData,
	PendingReview,
	PendingReviewsData,
	PublishSiteData,
	PublishSiteRequest,
	RejectVersionRequest,
	ReviewVersionFileData,
	ReviewVersionFilesData,
	SitePublishingData,
	SitePurchaseData,
} from 'worker/api/controllers/publishing/types';
export type {
	DiscoverPricing,
	TemplateCategory,
	TemplateListingStatus,
	TemplateVersionStatus,
} from '../shared/types/templates.js';
export {
	DISCOVER_PRICING_FILTERS,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	formatTemplatePrice,
} from '../shared/types/templates.js';
```

- add `AppReuseView` and `StartedFromView` to the existing `export type { ... } from 'worker/api/controllers/appView/types';` block.

- [ ] **Step 4: Replace the client methods**

In `src/lib/api-client.ts`:
- **Type imports:** remove the template type imports (`AppTemplateData` through `TemplateVersionFilesData`, at the top of the import list) and `UpdateAppVisibilityData`. Add `DiscoverPricing`, `DiscoverRemovalData`, `DiscoverRemovalRequest`, `MyPaidListingsData`, `PaidVersionActionData`, `PendingReviewsData`, `PublishSiteData`, `PublishSiteRequest`, `RejectVersionRequest`, `ReviewVersionFileData`, `ReviewVersionFilesData`, `SitePublishingData`, `SitePurchaseData` and `TemplateCategory`, all from `'@/api-types'`.
- **`PublicAppsParams`:** add:

```ts
	category?: TemplateCategory;
	pricing?: DiscoverPricing;
	reusableOnly?: boolean;
```

- **`getPublicApps`:** add after the `search` line:

```ts
		if (params?.category) queryParams.set('category', params.category);
		if (params?.pricing && params.pricing !== 'all') queryParams.set('pricing', params.pricing);
		if (params?.reusableOnly) queryParams.set('reusableOnly', 'true');
```

- **Visibility:** delete the `updateAppVisibility` method.
- **Template block:** replace the whole `// Template API Methods` block, from `getTemplates` through `rejectTemplateVersion`, with:

```ts
	// ===============================
	// Publishing and reuse API Methods
	// ===============================

	/** Make an app public (with consent, category and price) or private. */
	async publishSite(appId: string, body: PublishSiteRequest): Promise<ApiResponse<PublishSiteData>> {
		return this.request<PublishSiteData>(`/api/apps/${appId}/visibility`, { method: 'PUT', body });
	}

	/** Publishing settings for one of the owner's apps; quiet because non-owners get 403. */
	async getSitePublishing(appId: string): Promise<ApiResponse<SitePublishingData>> {
		return this.request<SitePublishingData>(`/api/apps/${appId}/publishing`, {}, true);
	}

	async submitPaidUpdate(appId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/apps/${appId}/paid-listing/versions`, { method: 'POST' });
	}

	async withdrawPaidVersion(appId: string, versionId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/apps/${appId}/paid-listing/versions/${versionId}/withdraw`, {
			method: 'POST',
		});
	}

	/** Buy a paid site. Payments are in test mode: the purchase is recorded without a charge. */
	async purchaseSite(appId: string): Promise<ApiResponse<SitePurchaseData>> {
		return this.request<SitePurchaseData>(`/api/apps/${appId}/purchases`, { method: 'POST' });
	}

	async getMyPaidListings(): Promise<ApiResponse<MyPaidListingsData>> {
		return this.request<MyPaidListingsData>('/api/paid-listings/mine');
	}

	/** Review queue; quiet because non-admins get 403 and the page explains it. */
	async getPendingReviews(): Promise<ApiResponse<PendingReviewsData>> {
		return this.request<PendingReviewsData>('/api/admin/reviews', {}, true);
	}

	async getReviewVersionFiles(versionId: string): Promise<ApiResponse<ReviewVersionFilesData>> {
		return this.request<ReviewVersionFilesData>(`/api/admin/template-versions/${versionId}/files`);
	}

	async getReviewVersionFile(versionId: string, path: string): Promise<ApiResponse<ReviewVersionFileData>> {
		return this.request<ReviewVersionFileData>(
			`/api/admin/template-versions/${versionId}/file?path=${encodeURIComponent(path)}`,
		);
	}

	async approveReviewVersion(versionId: string): Promise<ApiResponse<PaidVersionActionData>> {
		return this.request<PaidVersionActionData>(`/api/admin/template-versions/${versionId}/approve`, { method: 'POST' });
	}

	async rejectReviewVersion(versionId: string, reason: string): Promise<ApiResponse<PaidVersionActionData>> {
		const body: RejectVersionRequest = { reason };
		return this.request<PaidVersionActionData>(`/api/admin/template-versions/${versionId}/reject`, {
			method: 'POST',
			body,
		});
	}

	/** Admins only: hide a public site from Discover and block its reuse, or restore it. */
	async setDiscoverRemoval(appId: string, body: DiscoverRemovalRequest): Promise<ApiResponse<DiscoverRemovalData>> {
		return this.request<DiscoverRemovalData>(`/api/admin/apps/${appId}/discover`, { method: 'PUT', body });
	}
```

- [ ] **Step 5: Replace the query keys**

In `src/lib/query-keys.ts`:
- **Imports and types:**
  - delete `import type { TemplateCategory } from '@/api-types';` and the `TemplateGalleryFilters` type;
  - add `category: string;` and `pricing: string;` to `PaginatedAppsListFilters`.
- **`apps` group:** add `strip: () => [...queryKeys.apps.all, 'strip'] as const,`.
- **Delete** the top-level `templates` group.
- **Account keys:** replace the `account.templates` group with:

```ts
		/** Publishing, paid-listing and review data: never persisted, and dropped on logout with the rest of `account`. */
		publishing: {
			all: () => [...queryKeys.account.all, 'publishing'] as const,
			app: (appId: string) => [...queryKeys.account.publishing.all(), 'app', appId] as const,
			mine: (userId?: string | null) =>
				[...queryKeys.account.publishing.all(), 'mine', userId ?? 'anonymous'] as const,
			reviews: () => [...queryKeys.account.publishing.all(), 'reviews'] as const,
			versionFiles: (versionId: string) => [...queryKeys.account.publishing.all(), 'version-files', versionId] as const,
			versionFile: (versionId: string, path: string) =>
				[...queryKeys.account.publishing.all(), 'version-file', versionId, path] as const,
		},
```

In `src/hooks/use-paginated-apps.ts`:
- add to `UsePaginatedAppsOptions`:

```ts
	/** Discover's category and pricing filters; ignored for user lists. */
	category?: TemplateCategory | null;
	pricing?: DiscoverPricing;
```

  and add both types to the `@/api-types` import;
- in `listFilters`, add `category: options.category ?? 'all',` and `pricing: options.pricing ?? 'all',`, and add `options.category` and `options.pricing` to its dependency array;
- in `fetchPaginatedAppsPage`:
  - add a `discover: { category: TemplateCategory | null; pricing: DiscoverPricing }` parameter after `filters`;
  - add `category: type === 'public' ? discover.category ?? undefined : undefined,` and `pricing: type === 'public' ? discover.pricing : undefined,` to `params`;
  - pass `{ category: options.category ?? null, pricing: options.pricing ?? 'all' }` from the `queryFn` call.

- [ ] **Step 6: Add the hooks and helpers**

Create `src/hooks/use-publishing.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import type { ApiResponse, DiscoverRemovalRequest, PublishSiteRequest } from '@/api-types';

/** The data of a successful response, or an error carrying the server's message. */
async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}

/** Publishing changes Discover, app details and the owner's lists, so all three refresh. */
function usePublishingMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.account.publishing.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.account.apps.all() }),
				queryClient.invalidateQueries({ queryKey: queryKeys.apps.all }),
			]),
	});
}

export function useSitePublishing(appId: string | undefined, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.account.publishing.app(appId ?? ''),
		queryFn: () => unwrap(apiClient.getSitePublishing(appId!), 'Failed to load publishing settings'),
		enabled: enabled && !!appId,
		retry: false,
	});
}

export function usePublishSite(appId: string | undefined) {
	return usePublishingMutation((body: PublishSiteRequest) => {
		if (!appId) throw new Error('App ID is required');
		return unwrap(apiClient.publishSite(appId, body), 'Failed to update app visibility');
	});
}

export function useSubmitPaidUpdate(appId: string) {
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.submitPaidUpdate(appId), 'Failed to send the update for review'),
	);
}

export function useWithdrawPaidVersion(appId: string) {
	return usePublishingMutation((versionId: string) =>
		unwrap(apiClient.withdrawPaidVersion(appId, versionId), 'Failed to withdraw the version'),
	);
}

export function usePurchaseSite() {
	return usePublishingMutation((appId: string) => unwrap(apiClient.purchaseSite(appId), 'Failed to buy the site'));
}

export function useMyPaidListings() {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.publishing.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyPaidListings(), 'Failed to load your paid listings'),
		enabled: !!user,
	});
}

export function usePendingReviews() {
	return useQuery({
		queryKey: queryKeys.account.publishing.reviews(),
		queryFn: () => unwrap(apiClient.getPendingReviews(), 'Failed to load the review queue'),
		retry: false,
	});
}

export function useReviewVersionFiles(versionId: string | null) {
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFiles(versionId ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFiles(versionId!), 'Failed to load the files'),
		enabled: !!versionId,
	});
}

export function useReviewVersionFile(versionId: string, path: string | null) {
	return useQuery({
		queryKey: queryKeys.account.publishing.versionFile(versionId, path ?? ''),
		queryFn: () => unwrap(apiClient.getReviewVersionFile(versionId, path!), 'Failed to load the file'),
		enabled: !!path,
	});
}

export type VersionReview =
	| { versionId: string; decision: 'approve' }
	| { versionId: string; decision: 'reject'; reason: string };

export function useReviewVersion() {
	return usePublishingMutation((review: VersionReview) =>
		review.decision === 'approve'
			? unwrap(apiClient.approveReviewVersion(review.versionId), 'Failed to approve the version')
			: unwrap(apiClient.rejectReviewVersion(review.versionId, review.reason), 'Failed to reject the version'),
	);
}

export function useSetDiscoverRemoval() {
	return usePublishingMutation((input: { appId: string; body: DiscoverRemovalRequest }) =>
		unwrap(apiClient.setDiscoverRemoval(input.appId, input.body), 'Failed to change the removal'),
	);
}
```

Create `src/lib/reuse-start.ts`:

```ts
/** Chat URL that starts a new app from a published site; the chat page creates the session. */
export function reuseStartPath(input: { sourceAppId: string; description: string; modelId?: string }): string {
	const params = new URLSearchParams();
	params.set('source', input.sourceAppId);
	params.set('query', input.description.trim());
	params.set('projectType', 'app');
	params.set('behaviorType', 'think');
	if (input.modelId) params.set('model', input.modelId);
	return `/chat/new?${params.toString()}`;
}
```

Create `src/lib/paid-listing-display.ts`:

```ts
import { formatTemplatePrice, type OwnerPaidListing, type PaidListingVersionView } from '@/api-types';

export interface PaidListingStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
}

function rejectedDetail(latest: PaidListingVersionView | undefined): string | null {
	if (latest?.status !== 'rejected') return null;
	return latest.rejectionReason
		? `Version ${latest.version} was rejected: ${latest.rejectionReason}`
		: `Version ${latest.version} was rejected`;
}

/** How the owner's paid listing stands; null when the site is free again. */
export function paidListingStatusView(listing: OwnerPaidListing): PaidListingStatusView | null {
	if (listing.status === 'unlisted') return null;
	const pending = listing.versions.find((version) => version.status === 'pending');
	const latest = listing.versions[0];
	if (listing.approvedPriceCents !== null) {
		return {
			label: `Approved at ${formatTemplatePrice(listing.approvedPriceCents)}`,
			variant: 'success',
			detail: pending ? `Version ${pending.version} is in review` : rejectedDetail(latest),
			pendingVersionId: pending?.id ?? null,
		};
	}
	if (pending) {
		return {
			label: 'Price in review',
			variant: 'warning',
			detail: `${formatTemplatePrice(pending.priceCents)} is waiting for an admin`,
			pendingVersionId: pending.id,
		};
	}
	if (latest?.status === 'rejected') {
		return { label: 'Rejected', variant: 'error', detail: latest.rejectionReason, pendingVersionId: null };
	}
	return { label: 'Not submitted', variant: 'secondary', detail: null, pendingVersionId: null };
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/lib/reuse-start.test.ts src/lib/paid-listing-display.test.ts src/lib/query-keys.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts src/lib/query-keys.test.ts src/hooks/use-publishing.ts src/hooks/use-paginated-apps.ts src/lib/reuse-start.ts src/lib/reuse-start.test.ts src/lib/paid-listing-display.ts src/lib/paid-listing-display.test.ts
git commit -m "feat(discover): frontend client, hooks and helpers for publishing and reuse

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Publish dialog and owner controls

**Files:**
- Create: `src/components/publishing/PublishDialog.tsx`
- Create: `src/components/publishing/SiteReuseBar.tsx`
- Create: `src/components/publishing/StartedFromLine.tsx`
- Modify: `src/routes/app/index.tsx`
- Modify: `src/routes/chat/chat.tsx`
- Modify: `src/routes/chat/components/deployment-controls.tsx`
- Modify: `src/hooks/use-app.ts` (delete `useUpdateAppVisibility`)
- Create: `src/routes/publishing-guard.test.ts`
- Delete:
  - `src/components/templates/SubmitTemplateDialog.tsx`;
  - `src/components/templates/AppTemplateBar.tsx`;
  - `src/components/templates/TemplateOriginLine.tsx`;
  - `src/routes/templates-creator-guard.test.ts`.

**Interfaces:**
- Consumes the Task 9 hooks and helpers.
- Produces:
  - `<PublishDialog appId open onOpenChange />`;
  - `<SiteReuseBar app isOwner />`;
  - `<StartedFromLine startedFrom />`;
  - a new `onPublish?: () => void` prop on `DeploymentControls`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/publishing-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/deployment-controls.tsx',
		'/src/components/publishing/PublishDialog.tsx',
		'/src/components/publishing/SiteReuseBar.tsx',
		'/src/hooks/use-app.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('publishing a site', () => {
	it('asks for consent, a category and a price before an app goes public', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('Others may copy and adapt this site.');
		expect(dialog).toContain('TEMPLATE_PRICE_OPTIONS_CENTS.map');
		expect(dialog).toContain('TEMPLATE_CATEGORIES.map');
		expect(dialog).toContain("onSubmit({ visibility: 'private' })");
		expect(dialog).toContain('disabled={!consent}');
	});

	it('routes every Make public control through the dialog', () => {
		expect(source('/src/routes/app/index.tsx')).toContain('<PublishDialog');
		expect(source('/src/routes/app/index.tsx')).not.toContain('useUpdateAppVisibility');
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('<PublishDialog');
		expect(chat).toContain('onPublish={() => setIsPublishDialogOpen(true)}');
		expect(chat).not.toContain('SubmitTemplateDialog');
		expect(chat).not.toContain('Submit as template');
		const controls = source('/src/routes/chat/components/deployment-controls.tsx');
		expect(controls).toContain('onPublish?.()');
		expect(controls).toContain("apiClient.publishSite(appId, { visibility: 'private' })");
		expect(source('/src/hooks/use-app.ts')).not.toContain('useUpdateAppVisibility');
	});

	it('shows the owner the paid review status and admins the removal action', () => {
		const bar = source('/src/components/publishing/SiteReuseBar.tsx');
		expect(bar).toContain('Removed from Discover by an admin');
		expect(bar).toContain('Send update for review');
		expect(bar).toContain('Remove from Discover');
		expect(bar).toContain('Restore to Discover');
		expect(source('/src/routes/app/index.tsx')).toContain('<SiteReuseBar');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/publishing-guard.test.ts`
Expected: FAIL with "Source not found: /src/components/publishing/PublishDialog.tsx".

- [ ] **Step 3: Create the publish dialog**

Create `src/components/publishing/PublishDialog.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Loader } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePublishSite, useSitePublishing } from '@/hooks/use-publishing';
import {
	formatTemplatePrice,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type PublishSiteRequest,
	type SitePublishingData,
	type TemplateCategory,
} from '@/api-types';

const NO_CATEGORY = 'none';

interface PublishDialogProps {
	appId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Make an app public with consent, a category and a price; change those settings; or make it private. */
export function PublishDialog({ appId, open, onOpenChange }: PublishDialogProps) {
	const publishing = useSitePublishing(appId, open);
	const publish = usePublishSite(appId);
	const data = publishing.data;
	const isPublic = data?.visibility === 'public';

	const submit = (body: PublishSiteRequest) =>
		publish.mutate(body, {
			onSuccess: (result) => {
				toast.success(result.message);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{isPublic ? 'Publishing settings' : 'Make public'}</DialogTitle>
					<DialogDescription>
						Public sites appear in Discover, where anyone can start a new app from a copy of yours. A paid site can be
						used once an Estori admin approves its price.
					</DialogDescription>
				</DialogHeader>
				{publishing.isLoading ? (
					<div className="flex justify-center py-6">
						<Loader />
					</div>
				) : publishing.isError ? (
					<p className="text-sm text-kumo-subtle">{publishing.error.message}</p>
				) : data && !isPublic && data.ineligibleReason ? (
					<p className="text-sm text-kumo-subtle">{data.ineligibleReason}</p>
				) : data ? (
					<PublishForm data={data} pending={publish.isPending} onSubmit={submit} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** The price the owner last asked for, so reopening the dialog never resets a paid site to free. */
function savedPrice(data: SitePublishingData): number {
	const listing = data.listing;
	if (!listing || listing.status !== 'listed') return 0;
	return listing.versions[0]?.priceCents ?? listing.approvedPriceCents ?? 0;
}

interface PublishFormProps {
	data: SitePublishingData;
	pending: boolean;
	onSubmit: (body: PublishSiteRequest) => void;
}

/** Mounted only while the form shows, so each open starts from the saved settings. */
function PublishForm({ data, pending, onSubmit }: PublishFormProps) {
	const isPublic = data.visibility === 'public';
	const [category, setCategory] = useState<TemplateCategory | typeof NO_CATEGORY>(data.category ?? NO_CATEGORY);
	const [priceCents, setPriceCents] = useState<number>(savedPrice(data));
	// An already-public site was published with consent; changing its settings keeps it.
	const [consent, setConsent] = useState(isPublic);

	const publish = () =>
		onSubmit({
			visibility: 'public',
			reuseConsent: consent,
			category: category === NO_CATEGORY ? null : category,
			priceCents,
		});

	return (
		<div className="grid gap-4">
			{isPublic && data.ineligibleReason && <p className="text-sm text-kumo-subtle">{data.ineligibleReason}</p>}
			<div className="grid grid-cols-2 gap-3">
				<div className="grid gap-1.5">
					<span className="text-sm font-medium text-kumo-default">Category</span>
					<Select
						value={category}
						onValueChange={(value) => {
							if (value === NO_CATEGORY) {
								setCategory(NO_CATEGORY);
								return;
							}
							const match = TEMPLATE_CATEGORIES.find((candidate) => candidate === value);
							if (match) setCategory(match);
						}}
					>
						<SelectTrigger aria-label="Category">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_CATEGORY}>No category</SelectItem>
							{TEMPLATE_CATEGORIES.map((value) => (
								<SelectItem key={value} value={value}>
									{TEMPLATE_CATEGORY_LABELS[value]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-1.5">
					<span className="text-sm font-medium text-kumo-default">Price</span>
					<Select value={String(priceCents)} onValueChange={(value) => setPriceCents(Number(value))}>
						<SelectTrigger aria-label="Price">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TEMPLATE_PRICE_OPTIONS_CENTS.map((value) => (
								<SelectItem key={value} value={String(value)}>
									{formatTemplatePrice(value)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			{priceCents > 0 && (
				<p className="text-xs text-kumo-subtle">
					An admin reviews the price before anyone can use your site. Payments are in test mode, so buyers aren't
					charged yet.
				</p>
			)}
			<label className="flex items-start gap-2 text-sm text-kumo-default">
				<Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
				<span>Others may copy and adapt this site.</span>
			</label>
			<div className="flex justify-end gap-2">
				{isPublic && (
					<Button variant="secondary" disabled={pending} onClick={() => onSubmit({ visibility: 'private' })}>
						Make private
					</Button>
				)}
				<Button variant="primary" loading={pending} disabled={!consent} onClick={publish}>
					{isPublic ? 'Save' : 'Publish'}
				</Button>
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Create the origin line and the app page bar**

Create `src/components/publishing/StartedFromLine.tsx`:

```tsx
import { Link } from 'react-router';
import type { StartedFromView } from '@/api-types';

export function StartedFromLine({ startedFrom }: { startedFrom: StartedFromView }) {
	if (!startedFrom.available) {
		return <p className="text-sm text-kumo-subtle">Started from a site that is no longer available</p>;
	}
	return (
		<p className="text-sm text-kumo-subtle">
			Started from{' '}
			<Link to={`/app/${startedFrom.appId}`} className="text-kumo-default underline-offset-2 hover:underline">
				{startedFrom.title}
			</Link>{' '}
			by {startedFrom.creatorName}
		</p>
	);
}
```

Create `src/components/publishing/SiteReuseBar.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, InputArea } from '@cloudflare/kumo';
import {
	useSetDiscoverRemoval,
	useSitePublishing,
	useSubmitPaidUpdate,
	useWithdrawPaidVersion,
} from '@/hooks/use-publishing';
import { paidListingStatusView } from '@/lib/paid-listing-display';
import type { AppDetailsData } from '@/api-types';
import { StartedFromLine } from './StartedFromLine';

interface SiteReuseBarProps {
	app: Pick<AppDetailsData, 'id' | 'visibility' | 'startedFrom' | 'canModerate' | 'removedFromDiscover'>;
	isOwner: boolean;
}

/** The app page strip: where the app came from, the owner's paid listing, and admin moderation. */
export function SiteReuseBar({ app, isOwner }: SiteReuseBarProps) {
	const isPublic = app.visibility === 'public';
	const showOwner = isOwner && isPublic;
	const showModeration = app.canModerate && isPublic;
	if (!app.startedFrom && !showOwner && !showModeration && !app.removedFromDiscover) return null;

	return (
		<div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b bg-kumo-base px-4 py-2">
			{app.startedFrom ? <StartedFromLine startedFrom={app.startedFrom} /> : <span />}
			<div className="flex flex-wrap items-center gap-2">
				{app.removedFromDiscover && (
					<span className="text-sm text-kumo-danger">
						Removed from Discover by an admin
						{app.removedFromDiscover.reason ? `: ${app.removedFromDiscover.reason}` : ''}
					</span>
				)}
				{showOwner && <OwnerPaidListing appId={app.id} />}
				{showModeration && <DiscoverModeration appId={app.id} removed={app.removedFromDiscover !== null} />}
			</div>
		</div>
	);
}

function OwnerPaidListing({ appId }: { appId: string }) {
	const publishing = useSitePublishing(appId, true);
	const submitUpdate = useSubmitPaidUpdate(appId);
	const withdraw = useWithdrawPaidVersion(appId);
	const listing = publishing.data?.listing ?? null;
	const view = listing ? paidListingStatusView(listing) : null;
	if (!listing || !view) return null;

	const pendingVersionId = view.pendingVersionId;
	const canSendUpdate = listing.approvedPriceCents !== null && pendingVersionId === null;

	return (
		<>
			<Badge variant={view.variant}>{view.label}</Badge>
			{view.detail && <span className="text-sm text-kumo-subtle">{view.detail}</span>}
			{pendingVersionId && (
				<Button
					size="sm"
					variant="secondary"
					loading={withdraw.isPending}
					onClick={() =>
						withdraw.mutate(pendingVersionId, {
							onSuccess: () => toast.success('The version was withdrawn'),
							onError: (error) => toast.error(error.message),
						})
					}
				>
					Withdraw
				</Button>
			)}
			{canSendUpdate && (
				<Button
					size="sm"
					variant="secondary"
					loading={submitUpdate.isPending}
					onClick={() =>
						submitUpdate.mutate(undefined, {
							onSuccess: () => toast.success('Your latest deploy was sent for review'),
							onError: (error) => toast.error(error.message),
						})
					}
				>
					Send update for review
				</Button>
			)}
		</>
	);
}

function DiscoverModeration({ appId, removed }: { appId: string; removed: boolean }) {
	const removal = useSetDiscoverRemoval();
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState('');

	if (removed) {
		return (
			<Button
				size="sm"
				variant="secondary"
				loading={removal.isPending}
				onClick={() =>
					removal.mutate(
						{ appId, body: { removed: false } },
						{
							onSuccess: () => toast.success('Restored to Discover'),
							onError: (error) => toast.error(error.message),
						},
					)
				}
			>
				Restore to Discover
			</Button>
		);
	}
	if (!open) {
		return (
			<Button size="sm" variant="secondary-destructive" onClick={() => setOpen(true)}>
				Remove from Discover
			</Button>
		);
	}
	return (
		<div className="flex flex-wrap items-end gap-2">
			<InputArea
				id={`discover-removal-${appId}`}
				label="Reason the owner will see"
				value={reason}
				maxLength={500}
				onChange={(event) => setReason(event.target.value)}
			/>
			<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
				Cancel
			</Button>
			<Button
				size="sm"
				variant="destructive"
				disabled={!reason.trim()}
				loading={removal.isPending}
				onClick={() =>
					removal.mutate(
						{ appId, body: { removed: true, reason } },
						{
							onSuccess: () => {
								toast.success('Removed from Discover');
								setOpen(false);
							},
							onError: (error) => toast.error(error.message),
						},
					)
				}
			>
				Remove
			</Button>
		</div>
	);
}
```

- [ ] **Step 5: Wire the app page**

In `src/routes/app/index.tsx`:
- **Imports:** replace `import { AppTemplateBar } from '@/components/templates/AppTemplateBar';` with:

```tsx
import { PublishDialog } from '@/components/publishing/PublishDialog';
import { SiteReuseBar } from '@/components/publishing/SiteReuseBar';
```

- **Remove the old toggle:**
  - delete `useUpdateAppVisibility` from the `@/hooks/use-app` import;
  - delete the `const { mutateAsync: updateVisibility, isPending: isUpdatingVisibility } = useUpdateAppVisibility(app?.id);` lines;
  - delete the whole `handleToggleVisibility` callback.
- **State:** add `const [publishOpen, setPublishOpen] = useState(false);` next to the other `useState` calls.
- **Header button:** replace the owner's Make public / Make private `Button` in the header `trailing` with:

```tsx
					{isSignedIn && isOwner && (
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setPublishOpen(true)}
							icon={
								app.visibility === 'private' ? (
									<LockOpen className="size-3.5" weight="duotone" />
								) : (
									<Lock className="size-3.5" weight="duotone" />
								)
							}
						>
							{app.visibility === 'private' ? 'Make public' : 'Publishing'}
						</Button>
					)}
```

- **Header dependencies:** remove `isUpdatingVisibility` and `handleToggleVisibility` from the header `useMemo` dependency array.
- **Bar:** replace the `<AppTemplateBar ... />` element with:

```tsx
			<SiteReuseBar app={app} isOwner={isOwner} />
			{isOwner && <PublishDialog appId={app.id} open={publishOpen} onOpenChange={setPublishOpen} />}
```

- **Cleanup:** if `isThink` and `ApiError` are now unused in this file, delete their declaration and import.

- [ ] **Step 6: Wire chat and the deployment controls**

In `src/routes/chat/chat.tsx`:
- **Imports:**
  - delete `useUpdateAppVisibility` from the `@/hooks/use-app` import;
  - add `import { usePublishSite } from '@/hooks/use-publishing';` and `import { PublishDialog } from '@/components/publishing/PublishDialog';`;
  - delete the `SubmitTemplateDialog` import, and `SquaresFourIcon` if it is now unused.
- **Hook:** replace `const { mutateAsync: updateVisibility, isPending: isUpdatingVisibility } = useUpdateAppVisibility(app?.id);` with:

```tsx
	const { mutateAsync: publishSite, isPending: isUpdatingVisibility } = usePublishSite(app?.id);
```

- **Callback:** replace the `handleToggleVisibility` callback with:

```tsx
	const handleMakePrivate = useCallback(async () => {
		if (!app || !user || !isOwner) {
			toast.add({
				title: 'You can only change visibility of your own apps',
				variant: 'error',
			});
			return;
		}
		try {
			const result = await publishSite({ visibility: 'private' });
			toast.add({ title: result.message, variant: 'success' });
		} catch (error) {
			console.error('Error updating app visibility:', error);
			toast.add({
				title: error instanceof Error ? error.message : 'Failed to update visibility',
				variant: 'error',
			});
		}
	}, [app, user, isOwner, publishSite, toast]);
```

  and replace every remaining `handleToggleVisibility` reference: the Make private dropdown item's `onClick` and the header dependency array.
- **State:** rename `isTemplateDialogOpen` / `setIsTemplateDialogOpen` to `isPublishDialogOpen` / `setIsPublishDialogOpen`.
- **Header button:** the "Make public" `Button` in the header gets `onClick={() => setIsPublishDialogOpen(true)}`. Keep its `disabled` and `loading` bound to `isUpdatingVisibility`.
- **Menu:** delete the `Submit as template` `DropdownMenu.Item`.
- **Dialog:** replace the `<SubmitTemplateDialog ... />` block with:

```tsx
				{app && isOwner && (
					<PublishDialog appId={app.id} open={isPublishDialogOpen} onOpenChange={setIsPublishDialogOpen} />
				)}
```

- **Deployment controls:** add `onPublish={() => setIsPublishDialogOpen(true)}` to the `<DeploymentControls ... />` props.

In `src/routes/chat/components/deployment-controls.tsx`:
- add `onPublish?: () => void;` to the props interface, with the comment `/** Opens the publish dialog; making an app public needs consent, a category and a price. */`, and destructure it;
- replace `handleToggleVisibility` with:

```tsx
	const handleToggleVisibility = async () => {
		if (!appId) {
			toast.error('App ID not found');
			return;
		}
		if (localVisibility === 'private') {
			onPublish?.();
			return;
		}

		try {
			setIsUpdatingVisibility(true);
			const response = await apiClient.publishSite(appId, { visibility: 'private' });
			if (response.success && response.data) {
				setLocalVisibility('private');
				onVisibilityUpdate?.('private');
				toast.success('App is now private');
			} else {
				throw new Error(response.error?.message || 'Failed to update visibility');
			}
		} catch (error) {
			console.error('Error updating app visibility:', error);
			toast.error('Failed to update visibility');
		} finally {
			setIsUpdatingVisibility(false);
		}
	};
```

In `src/hooks/use-app.ts`, delete the whole `useUpdateAppVisibility` function, and remove any imports that only it used.

Delete the replaced components and the obsolete guard:

```bash
git rm src/components/templates/SubmitTemplateDialog.tsx src/components/templates/AppTemplateBar.tsx src/components/templates/TemplateOriginLine.tsx src/routes/templates-creator-guard.test.ts
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/routes/publishing-guard.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/publishing src/routes/app/index.tsx src/routes/chat/chat.tsx src/routes/chat/components/deployment-controls.tsx src/hooks/use-app.ts src/routes/publishing-guard.test.ts
git commit -m "feat(discover): publish dialog, paid listing status and admin removal on the app page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Using a published site

**Files:**
- Create: `src/components/publishing/UseSiteDialog.tsx`
- Create: `src/components/publishing/UseSiteButton.tsx`
- Modify: `src/routes/app/index.tsx`
- Modify: `src/routes/chat/chat.tsx` and `src/routes/chat/hooks/use-chat.ts`
- Create: `src/routes/reuse-guard.test.ts`
- Delete:
  - `src/components/templates/UseTemplateDialog.tsx`;
  - `src/lib/template-start.ts` and `src/lib/template-start.test.ts`;
  - `src/routes/templates-guard.test.ts`.

**Interfaces:**
- Consumes: `AppReuseView` (Task 8), `usePurchaseSite` and `reuseStartPath` (Task 9), and `useAuthGuard` (existing).
- Produces:
  - `<UseSiteButton app autoOpen />`;
  - `<UseSiteDialog sourceAppId sourceTitle open onOpenChange />`;
  - `useChat({ ..., sourceAppId })`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/reuse-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/components/publishing/UseSiteButton.tsx',
		'/src/components/publishing/UseSiteDialog.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('using a published site', () => {
	it('offers Use or Buy on the app page and opens the dialog from ?use=1', () => {
		const app = source('/src/routes/app/index.tsx');
		expect(app).toContain('<UseSiteButton');
		expect(app).toContain("searchParams.get('use') === '1'");
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('reuse.needsPurchase');
		expect(button).toContain('Use this site');
		expect(button).toContain("Payments are in test mode. You won't be charged.");
		expect(button).toContain('requireAuth(');
	});

	it('starts a chat session from the site in the URL', () => {
		expect(source('/src/components/publishing/UseSiteDialog.tsx')).toContain('reuseStartPath(');
		expect(source('/src/routes/chat/chat.tsx')).toContain("searchParams.get('source')");
		const useChat = source('/src/routes/chat/hooks/use-chat.ts');
		expect(useChat).toContain('if (!userQuery && !sourceAppId)');
		expect(useChat).toContain('sourceAppId,');
		expect(useChat).toContain('disableGenerate: Boolean(sourceAppId) && query.length === 0');
		expect(useChat).toContain('if (obj.error)');
		expect(useChat).not.toContain('templateId');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/reuse-guard.test.ts`
Expected: FAIL with "Source not found: /src/components/publishing/UseSiteButton.tsx".

- [ ] **Step 3: Create the use dialog and button**

Create `src/components/publishing/UseSiteDialog.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, InputArea } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ThinkModelPicker } from '@/components/ThinkModelPicker';
import { useFeature } from '@/features';
import { MAX_AGENT_QUERY_LENGTH } from '@/api-types';
import { reuseStartPath } from '@/lib/reuse-start';

interface UseSiteDialogProps {
	sourceAppId: string;
	sourceTitle: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UseSiteDialog({ sourceAppId, sourceTitle, open, onOpenChange }: UseSiteDialogProps) {
	const navigate = useNavigate();
	const { capabilities } = useFeature();
	const [description, setDescription] = useState('');
	const [modelId, setModelId] = useState('');
	const effectiveModel = modelId || capabilities?.defaultThinkModel || '';

	const start = () => {
		onOpenChange(false);
		navigate(reuseStartPath({ sourceAppId, description, modelId: effectiveModel || undefined }), {
			state: { fromPrompt: true },
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Use {sourceTitle}</DialogTitle>
					<DialogDescription>
						Your new app starts as a copy of this site. Describe your business and the agent rewrites the text,
						names, prices and images for you, or leave it empty to keep an exact copy.
					</DialogDescription>
				</DialogHeader>
				<InputArea
					id="reuse-description"
					label="Describe your business (optional)"
					placeholder="A family bakery in Lisbon that sells sourdough and pastries"
					value={description}
					maxLength={MAX_AGENT_QUERY_LENGTH}
					onChange={(event) => setDescription(event.target.value)}
				/>
				<div className="flex items-center justify-between gap-2">
					<ThinkModelPicker
						options={capabilities?.thinkModels ?? []}
						value={effectiveModel}
						onChange={setModelId}
					/>
					<Button variant="primary" onClick={start}>
						Start building
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
```

Create `src/components/publishing/UseSiteButton.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { usePurchaseSite } from '@/hooks/use-publishing';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { formatTemplatePrice, type AppDetailsData } from '@/api-types';
import { UseSiteDialog } from './UseSiteDialog';

interface UseSiteButtonProps {
	app: Pick<AppDetailsData, 'id' | 'title' | 'reuse'>;
	/** Open the dialog on mount, for links from Discover (`?use=1`). */
	autoOpen?: boolean;
}

/** "Use this site", or "Buy for $X" first on a paid site the viewer doesn't own. */
export function UseSiteButton({ app, autoOpen = false }: UseSiteButtonProps) {
	const reuse = app.reuse;
	const purchase = usePurchaseSite();
	const { requireAuth } = useAuthGuard();
	const [open, setOpen] = useState(false);
	const intendedUrl = `/app/${app.id}?use=1`;

	const startUse = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to use this site', intendedUrl })) return;
		setOpen(true);
	};

	useEffect(() => {
		if (autoOpen && reuse?.canUse) startUse();
		// Runs once per page load; the dialog then owns its state.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [autoOpen, reuse?.canUse]);

	if (!reuse || (!reuse.canUse && !reuse.needsPurchase)) return null;

	if (reuse.needsPurchase && reuse.priceCents !== null) {
		const price = formatTemplatePrice(reuse.priceCents);
		const buy = () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			purchase.mutate(app.id, {
				onSuccess: () => toast.success(`You bought ${app.title}. You can use it now.`),
				onError: (error) => toast.error(error.message),
			});
		};
		return (
			<div className="flex items-center gap-2">
				<span className="text-xs text-kumo-subtle">Payments are in test mode. You won't be charged.</span>
				<Button size="sm" variant="primary" loading={purchase.isPending} onClick={buy}>
					Buy for {price}
				</Button>
			</div>
		);
	}

	return (
		<>
			<Button size="sm" variant="primary" onClick={startUse}>
				Use this site
			</Button>
			<UseSiteDialog sourceAppId={app.id} sourceTitle={app.title} open={open} onOpenChange={setOpen} />
		</>
	);
}
```

If the repo's ESLint config does not define `react-hooks/exhaustive-deps`, delete that disable comment.

- [ ] **Step 4: Put the button on the app page**

In `src/routes/app/index.tsx`:
- add `import { UseSiteButton } from '@/components/publishing/UseSiteButton';`;
- make sure `useSearchParams` is imported from `react-router` and `const [searchParams] = useSearchParams();` exists in the component; add it if missing;
- in the header `trailing` fragment, insert before the owner's publish button:

```tsx
					<UseSiteButton app={app} autoOpen={searchParams.get('use') === '1'} />
```

- add `searchParams` to the header `useMemo` dependency array.

- [ ] **Step 5: Start chat sessions from `?source=`**

In `src/routes/chat/chat.tsx`, replace `const urlTemplateId = searchParams.get('template') ?? undefined;` with `const urlSourceAppId = searchParams.get('source') ?? undefined;`, and `templateId: urlTemplateId,` in the `useChat` options with `sourceAppId: urlSourceAppId,`.

In `src/routes/chat/hooks/use-chat.ts`, rename `templateId` to `sourceAppId` throughout: the destructured option, the option type field (comment: `/** Start a new session from this published site; the query may then be empty. */`), `if (!userQuery && !sourceAppId)`, the `createAgentSession({ ..., sourceAppId, ... })` argument, the `disableGenerate: Boolean(sourceAppId) && query.length === 0` connect option, and the dependency array entry.

Delete the replaced files:

```bash
git rm src/components/templates/UseTemplateDialog.tsx src/lib/template-start.ts src/lib/template-start.test.ts src/routes/templates-guard.test.ts
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/routes/reuse-guard.test.ts src/routes/publishing-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/publishing src/routes/app/index.tsx src/routes/chat/chat.tsx src/routes/chat/hooks/use-chat.ts src/routes/reuse-guard.test.ts
git commit -m "feat(discover): use or buy a published site from its page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Discover page, home strip, redirects and sidebar

**Files:**
- Modify: `src/routes/discover/index.tsx`
- Modify: `src/components/shared/AppCard.tsx`
- Create: `src/components/publishing/DiscoverStrip.tsx`
- Modify: `src/routes/home.tsx`
- Modify: `src/routes.tsx`
- Modify: `src/components/layout/app-sidebar.tsx`
- Create: `src/routes/discover-guard.test.ts`
- Delete: `src/routes/templates/` (both pages), `src/components/templates/TemplateCard.tsx` and `src/components/templates/TemplateStrip.tsx`

**Interfaces:**
- Consumes:
  - `usePaginatedApps({ ..., category, pricing })` and `queryKeys.apps.strip()` (Task 9);
  - the `apiClient.getPublicApps` filters (Task 9);
  - the list item fields `priceCents`, `inReview`, `reusable` and `forkCount` (Task 8).
- Produces: `<DiscoverStrip />`, and the redirects `/templates` and `/templates/:slug` to `/discover` and `/admin/templates` to `/admin/reviews`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/discover-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/home.tsx',
		'/src/routes/discover/index.tsx',
		'/src/components/shared/AppCard.tsx',
		'/src/components/publishing/DiscoverStrip.tsx',
		'/src/components/layout/app-sidebar.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('one Discover gallery', () => {
	it('filters Discover by category and price', () => {
		const discover = source('/src/routes/discover/index.tsx');
		expect(discover).toContain('category,');
		expect(discover).toContain('pricing,');
		expect(discover).toContain('DISCOVER_PRICING_FILTERS');
	});

	it('shows the price of paid sites and the use count on cards', () => {
		const card = source('/src/components/shared/AppCard.tsx');
		expect(card).toContain('formatTemplatePrice(');
		expect(card).toContain('STATS_ICONS.forkCount');
	});

	it('starts from a published site on the home page', () => {
		expect(source('/src/routes/home.tsx')).toContain('<DiscoverStrip />');
		const strip = source('/src/components/publishing/DiscoverStrip.tsx');
		expect(strip).toContain('reusableOnly: true');
		expect(strip).toContain('Start from a published site');
		expect(strip).toContain('?use=1');
	});

	it('redirects the old template URLs and drops the Templates entry', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain('<Navigate to="/discover" replace />');
		expect(routes).toContain('<Navigate to="/admin/reviews" replace />');
		expect(routes).toContain("path: 'admin/reviews'");
		expect(source('/src/components/layout/app-sidebar.tsx')).not.toContain("navigate('/templates')");
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/discover-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the Discover filters**

In `src/routes/discover/index.tsx`:
- **Imports:** add `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';`, plus `DISCOVER_PRICING_FILTERS`, `TEMPLATE_CATEGORIES`, `TEMPLATE_CATEGORY_LABELS`, `type DiscoverPricing` and `type TemplateCategory` from `'@/api-types'`.
- **Filter state from the URL,** after `initialSort`:

```tsx
	const categoryParam = searchParams.get('category');
	const category: TemplateCategory | null = TEMPLATE_CATEGORIES.find((value) => value === categoryParam) ?? null;
	const pricing: DiscoverPricing =
		DISCOVER_PRICING_FILTERS.find((value) => value === searchParams.get('pricing')) ?? 'all';
	const setFilter = (key: 'category' | 'pricing', value: string) => {
		const next = new URLSearchParams(searchParams);
		if (value === 'all') next.delete(key);
		else next.set(key, value);
		setSearchParams(next, { replace: true });
	};
```

- **Hook options:** pass `category,` and `pricing,` to `usePaginatedApps({...})`.
- **Header copy:** change the subtitle text to `Explore sites built by the community, and start your own from any of them`.
- **Controls:** after `<AppFiltersForm ... />`, inside the same flex row, insert:

```tsx
						<div className="flex gap-2">
							<Select value={category ?? 'all'} onValueChange={(value) => setFilter('category', value)}>
								<SelectTrigger aria-label="Category" className="w-44">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All categories</SelectItem>
									{TEMPLATE_CATEGORIES.map((value) => (
										<SelectItem key={value} value={value}>
											{TEMPLATE_CATEGORY_LABELS[value]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={pricing} onValueChange={(value) => setFilter('pricing', value)}>
								<SelectTrigger aria-label="Price" className="w-32">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Any price</SelectItem>
									<SelectItem value="free">Free</SelectItem>
									<SelectItem value="paid">Paid</SelectItem>
								</SelectContent>
							</Select>
						</div>
```

- [ ] **Step 4: Show the price and use count on cards**

In `src/components/shared/AppCard.tsx`:
- add `import { Badge } from '@cloudflare/kumo';` if `Badge` is not imported yet, and `import { formatTemplatePrice } from '@/api-types';`;
- change `StatsDisplay` to:

```tsx
const StatsDisplay = ({ stats }: { stats: StatsData }) => (
	<div className="flex items-center gap-3">
		<StatItem icon={STATS_ICONS.starCount} value={stats.starCount || 0} />
		<StatItem icon={STATS_ICONS.viewCount} value={stats.viewCount || 0} />
		<span title="Apps started from this site" className="inline-flex">
			<StatItem icon={STATS_ICONS.forkCount} value={stats.forkCount || 0} />
		</span>
	</div>
);
```

- inside the screenshot container `<div className="relative aspect-[16/10] ...">`, as its last child, add:

```tsx
							{'priceCents' in app && typeof app.priceCents === 'number' && (
								<Badge variant="info" className="absolute right-3 top-3">
									{formatTemplatePrice(app.priceCents)}
								</Badge>
							)}
```

- [ ] **Step 5: Add the home strip**

Create `src/components/publishing/DiscoverStrip.tsx`:

```tsx
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { formatTemplatePrice } from '@/api-types';

/** "Start from a published site" under the home prompt: popular sites anyone can reuse now. */
export function DiscoverStrip() {
	const sites = useQuery({
		queryKey: queryKeys.apps.strip(),
		queryFn: async () => {
			const response = await apiClient.getPublicApps({ sort: 'popular', limit: 6, reusableOnly: true });
			if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to load sites');
			return response.data.apps;
		},
		staleTime: 60_000,
	});
	const apps = sites.data ?? [];
	if (apps.length === 0) return null;

	return (
		<section className="mt-8 grid w-full gap-3">
			<div className="flex items-baseline justify-between">
				<h2 className="text-sm font-medium text-kumo-default">Start from a published site</h2>
				<Link to="/discover" className="text-sm text-kumo-subtle hover:text-kumo-default">
					See all
				</Link>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{apps.map((app) => (
					<Link
						key={app.id}
						to={`/app/${app.id}?use=1`}
						className="group grid gap-2 rounded-xl p-2 ring ring-kumo-hairline hover:ring-kumo-line"
					>
						<div className="aspect-[16/10] overflow-hidden rounded-lg bg-kumo-recessed">
							{app.screenshotUrl && (
								<img src={app.screenshotUrl} alt="" loading="lazy" className="size-full object-cover" />
							)}
						</div>
						<div className="flex items-center justify-between gap-2 px-1">
							<span className="truncate text-sm text-kumo-default">{app.title}</span>
							<span className="shrink-0 text-xs text-kumo-subtle">
								{app.priceCents !== null ? formatTemplatePrice(app.priceCents) : 'Free'}
							</span>
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}
```

`getPublicApps` returns `PublicAppsData`, whose `apps` items are `PublicAppListData`-based and carry `priceCents` after Task 8. If the item type in `PublicAppsData` is a different alias, use that type's `priceCents`; Task 8 added the field at the source.

In `src/routes/home.tsx`, replace `import { TemplateStrip } from '@/components/templates/TemplateStrip';` with `import { DiscoverStrip } from '@/components/publishing/DiscoverStrip';`, and `<TemplateStrip />` with `<DiscoverStrip />`.

- [ ] **Step 6: Redirect the old URLs and drop the sidebar entry**

In `src/routes.tsx`:
- replace the imports of `TemplatesPage`, `TemplateDetailPage` and `AdminTemplatesPage` with `import AdminReviewsPage from './routes/admin/reviews';`, and add `Navigate` to the `react-router` import;
- replace the three template route objects with:

```tsx
			{
				path: 'templates',
				element: <Navigate to="/discover" replace />,
			},
			{
				path: 'templates/:slug',
				element: <Navigate to="/discover" replace />,
			},
			{
				path: 'admin/templates',
				element: <Navigate to="/admin/reviews" replace />,
			},
			{
				path: 'admin/reviews',
				element: (
					<ProtectedRoute>
						<AdminReviewsPage />
					</ProtectedRoute>
				),
			},
```

(`src/routes/admin/reviews.tsx` is created in Task 13. The app typecheck stays red until then, as Global Constraints allow.)

In `src/components/layout/app-sidebar.tsx`, delete the collapsed Templates `Button` and the expanded Templates `Sidebar.MenuButton`, and remove `SquaresFourIcon` from the imports.

Delete the gallery:

```bash
git rm -r src/routes/templates src/components/templates/TemplateCard.tsx src/components/templates/TemplateStrip.tsx
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/routes/discover-guard.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/discover/index.tsx src/components/shared/AppCard.tsx src/components/publishing/DiscoverStrip.tsx src/routes/home.tsx src/routes.tsx src/components/layout/app-sidebar.tsx src/routes/discover-guard.test.ts
git commit -m "feat(discover): one gallery with category and price filters; redirect templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Admin reviews page and the owner's paid listings

**Files:**
- Create: `src/routes/admin/reviews.tsx`
- Create: `src/components/publishing/PaidListingsList.tsx`
- Modify: `src/routes/profile.tsx`
- Create: `src/routes/reviews-guard.test.ts`
- Delete:
  - `src/routes/admin/templates.tsx`;
  - `src/components/templates/` (the remaining `MyTemplatesList.tsx` and `TemplateManageButtons.tsx`);
  - `src/hooks/use-templates.ts`;
  - `src/lib/template-display.ts` and `src/lib/template-display.test.ts`;
  - `src/routes/templates-admin-guard.test.ts`.

**Interfaces:**
- Consumes: `usePendingReviews`, `useReviewVersion`, `useReviewVersionFiles`, `useReviewVersionFile`, `useMyPaidListings` and `useWithdrawPaidVersion`, and `paidListingStatusView` and `formatFileSize` (Task 9).
- Produces: the page `/admin/reviews`, and the profile tab `paid`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/reviews-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes/admin/reviews.tsx', '/src/routes/profile.tsx', '/src/components/publishing/PaidListingsList.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('reviews and paid listings', () => {
	it('lets admins approve or reject a paid version with a reason and read its files', () => {
		const page = source('/src/routes/admin/reviews.tsx');
		expect(page).toContain('usePendingReviews()');
		expect(page).toContain("decision: 'approve'");
		expect(page).toContain("decision: 'reject', reason");
		expect(page).toContain('useReviewVersionFiles(');
		expect(page).toContain('isForbidden(');
	});

	it('lists the owner paid listings on the profile', () => {
		expect(source('/src/routes/profile.tsx')).toContain('<PaidListingsList />');
		expect(source('/src/routes/profile.tsx')).toContain("{ value: 'paid', label: 'Paid listings' }");
		expect(source('/src/components/publishing/PaidListingsList.tsx')).toContain('paidListingStatusView(');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/reviews-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the reviews page**

Run `git mv src/routes/admin/templates.tsx src/routes/admin/reviews.tsx`. Then apply exactly these changes to `src/routes/admin/reviews.tsx`:
- **Imports:**
  - the `@/hooks/use-templates` import becomes `import { usePendingReviews, useReviewVersion, useReviewVersionFile, useReviewVersionFiles } from '@/hooks/use-publishing';`;
  - `formatFileSize` comes from `@/lib/paid-listing-display`;
  - the `@/api-types` import becomes `formatTemplatePrice`, `SecurityError`, `SecurityErrorType` and `type PendingReview`.
- **Delete** the `PublishedTemplates` and `PublishedTemplateRow` components, and the `<PublishedTemplates />` element.
- **Page component:**
  - rename `AdminTemplatesPage` to `AdminReviewsPage`, and `const pending = usePendingTemplateVersions();` to `const pending = usePendingReviews();`;
  - the title is `pageTitle('Reviews')` and the heading `Reviews`;
  - the description is `Approve prices for paid sites. A rejection needs a reason the creator will see. To take a site out of Discover, open it and use Remove from Discover.`;
  - `pending.data.versions` becomes `pending.data.reviews`, and the map renders `<PendingReviewCard key={review.versionId} review={review} />`;
  - the empty state description is `New paid sites and updates will show up here.`
- **Card:** rename `PendingVersionCard` to `PendingReviewCard({ review }: { review: PendingReview })`, and inside it:
  - `useReviewTemplateVersion()` becomes `useReviewVersion()`;
  - `const label = \`${review.appTitle} v${review.version}\`;`;
  - every `version.` field reference becomes `review.`;
  - the approve toast is `` `${label} is approved` ``;
  - the price badge shows `formatTemplatePrice(review.priceCents)`, always with `variant="info"`;
  - the details block becomes:

```tsx
					<div className="grid gap-1 text-sm">
						<p className="text-kumo-subtle">
							{review.fileCount} files · {formatFileSize(review.totalBytes)}
						</p>
						<p className="text-kumo-subtle">
							By {review.creatorName}
							{review.creatorEmail ? ` (${review.creatorEmail})` : ''}
							{review.submittedAt ? ` · submitted ${new Date(review.submittedAt).toLocaleString()}` : ''}
						</p>
						<Link to={`/app/${review.appId}`} className="w-fit text-kumo-default underline-offset-2 hover:underline">
							Open the site
						</Link>
					</div>
```

- **Screenshots:** the image `alt` texts use `review.appTitle`.
- **`SnapshotFiles`:** `useTemplateVersionFiles` becomes `useReviewVersionFiles`, and `useTemplateVersionFile` becomes `useReviewVersionFile`.

- [ ] **Step 4: Create the paid listings list and the profile tab**

Create `src/components/publishing/PaidListingsList.tsx`:

```tsx
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { useMyPaidListings, useWithdrawPaidVersion } from '@/hooks/use-publishing';
import { paidListingStatusView } from '@/lib/paid-listing-display';
import type { MyPaidListing } from '@/api-types';

/** The profile's list of the owner's paid sites, with review status and buyers. */
export function PaidListingsList() {
	const listings = useMyPaidListings();
	if (listings.isLoading) return <Loader />;
	if (listings.isError) return <p className="text-sm text-kumo-subtle">{listings.error.message}</p>;
	const rows = listings.data?.listings ?? [];
	if (rows.length === 0) {
		return (
			<Empty
				size="sm"
				title="No paid sites yet"
				description="Set a price when you make a site public, and it shows up here."
			/>
		);
	}
	return (
		<div className="grid gap-2">
			{rows.map((listing) => (
				<PaidListingRow key={listing.id} listing={listing} />
			))}
		</div>
	);
}

function PaidListingRow({ listing }: { listing: MyPaidListing }) {
	const withdraw = useWithdrawPaidVersion(listing.appId);
	const view = paidListingStatusView(listing);
	const pendingVersionId = view?.pendingVersionId ?? null;

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline">
			<div className="grid min-w-0 gap-0.5">
				<Link
					to={`/app/${listing.appId}`}
					className="truncate text-sm font-medium text-kumo-default underline-offset-2 hover:underline"
				>
					{listing.appTitle}
				</Link>
				<p className="text-sm text-kumo-subtle">
					{listing.buyerCount} {listing.buyerCount === 1 ? 'buyer' : 'buyers'}
					{view?.detail ? ` · ${view.detail}` : ''}
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Badge variant={view?.variant ?? 'secondary'}>{view?.label ?? 'Free'}</Badge>
				{pendingVersionId && (
					<Button
						size="sm"
						variant="secondary"
						loading={withdraw.isPending}
						onClick={() =>
							withdraw.mutate(pendingVersionId, {
								onSuccess: () => toast.success('The version was withdrawn'),
								onError: (error) => toast.error(error.message),
							})
						}
					>
						Withdraw
					</Button>
				)}
			</div>
		</div>
	);
}
```

In `src/routes/profile.tsx`:
- replace `import { MyTemplatesList } from '@/components/templates/MyTemplatesList';` with `import { PaidListingsList } from '@/components/publishing/PaidListingsList';`;
- change the tab item `{ value: 'templates', label: 'Templates' }` to `{ value: 'paid', label: 'Paid listings' }`;
- change the panel `activeTab === 'templates'` to `activeTab === 'paid'`, its secondary title to `Paid listings`, and `<MyTemplatesList />` to `<PaidListingsList />`.

Delete what is left of the old UI:

```bash
git rm -r src/components/templates src/hooks/use-templates.ts src/lib/template-display.ts src/lib/template-display.test.ts src/routes/templates-admin-guard.test.ts
```

- [ ] **Step 5: Verify the whole frontend**

Run: `npx vitest run src/routes/reviews-guard.test.ts src/routes/discover-guard.test.ts src/routes/reuse-guard.test.ts src/routes/publishing-guard.test.ts`
Expected: PASS.

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: only the 4 accepted errors in `packages/artifacts-viewer`.

Run: `npx vitest run src/lib src/routes src/hooks`
Expected: PASS.

Run: `npx eslint $(git diff --name-only --diff-filter=AM $(git merge-base origin/main HEAD)..HEAD | grep -E '^(src|worker|shared)/.*\.(ts|tsx)$')`
Expected: 0 errors. Run it from a bash shell; in zsh, pipe the list through `xargs` instead.

Run `grep -rn "templates/\|use-templates\|TemplateStrip\|UseTemplateDialog\|templateId" src --include=*.ts --include=*.tsx`. Expected: matches only in `src/lib/api-client.ts` for unrelated `SecretTemplates`, if any. Every reference to the old template UI is gone.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/reviews.tsx src/components/publishing/PaidListingsList.tsx src/routes/profile.tsx src/routes/reviews-guard.test.ts
git commit -m "feat(discover): admin reviews page and the owner's paid listings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Local end-to-end verification

The controller runs this task: it needs the local dev server, the capture sidecar, the browser pane and the local test accounts in `.superpowers/realtest/local-accounts.md`.

- [ ] **Step 1: Start the stack**

Start the dev server exactly as recorded in memory: `CLOUDFLARE_API_TOKEN` from `TOKEN_ESTORI_DEPLOY`, the Estori `CLOUDFLARE_ACCOUNT_ID`, and `npm run dev -- --port 8100 --strictPort`. Start `npm run dev:browser`. Then check that `http://localhost:8100/discover` loads.

- [ ] **Step 2: Publish free and reuse**

1. As the creator, open a deployed Think app and click Make public. Tick consent, choose category Landing and price Free, then click Publish.
   Expected:
   - a toast says "Your site is public and others can reuse it";
   - D1 has `apps.visibility = 'public'`, `category = 'landing'`, and `reuse_consent_at` and `last_deployed_at` set.
2. As the buyer, find the site on `/discover` with Category Landing and Price Free. The card shows no price badge and a use count of 0.
3. Open the site and click Use this site. With a description, a new app opens; its preview shows the copy, then the rewrite.
   Expected:
   - no `ask_questions`;
   - `apps.parent_app_id` points to the source;
   - the new app page shows "Started from {title} by Template Creator".
4. Use it again without a description.
   Expected: the exact copy "{title} copy", with status `completed` and no model turn.
5. Back on Discover, the source card's use count is 2.

- [ ] **Step 3: Publish paid, review, buy and use**

1. As the creator, publish a second deployed app at $29.
   Expected:
   - the toast mentions approval;
   - the app page bar shows "Price in review: $29 is waiting for an admin";
   - for the buyer, the app page shows no Use or Buy button;
   - a direct `POST /api/agent` with that `sourceAppId` returns 409 "This site isn't available to use yet".
2. As the admin, open `/admin/reviews`. The version shows screenshots and files. Reject it with a reason.
   Expected: the creator's bar shows "Rejected: {reason}".
3. As the creator, open Publishing and click Save at $29. A new version goes to review. As the admin, approve it.
   Expected: the creator sees "Approved at $29".
4. As the buyer, the card shows the "$29" badge.
   - Use through `/chat/new?source=` before buying returns 402 "Buy this site before using it".
   - Click Buy for $29. A toast confirms, and the button becomes "Use this site".
   - Use it with a description, and the copy comes from the approved snapshot.

- [ ] **Step 4: Paid update, switch to free, removal and private**

1. As the creator, change the paid site, deploy, then click Send update for review.
   Expected: the bar shows "Version 3 is in review", and the buyer still gets the approved version.
2. As the creator, switch the paid site to Free.
   Expected: the pending update is withdrawn, the listing is unlisted, and the buyer can use the latest deploy live.
3. As the admin, open the free site and click Remove from Discover with a reason.
   Expected:
   - it disappears from `/discover`;
   - Use returns 404 "This site is no longer available";
   - the owner sees "Removed from Discover by an admin: {reason}";
   - apps made from it keep working.
   Then click Restore to Discover.
4. As the creator, make a site private.
   Expected: it disappears from Discover, and apps made from it show "Started from a site that is no longer available".

- [ ] **Step 5: Redirects and regressions**

1. `/templates`, `/templates/anything` and `/admin/templates` redirect to `/discover` and `/admin/reviews`.
2. Start a normal app from the home prompt. It still asks clarifying questions for a one-line idea, and builds and deploys.

- [ ] **Step 6: Record**

Record the results in the ledger as `Task 14: complete` with each step's outcome, plus a `Ruling:` line for any deviation. Commit any fix found here with its own failing test first, following the TDD rule.
