# Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship templates end to end:
- owners submit a deployed Think app as a free or paid template;
- the admin (alastrat@pluriza.com) approves or rejects each version;
- approved templates appear in a public gallery;
- anyone signed in starts a new app from a frozen snapshot of a template, with an optional personalization turn;
- paid templates need a purchase first, recorded in test mode with no charge.

**Architecture:**
- **Submitting.** Submission reads the deployed commit's files from SpaceDO, filters and secret-scans them, and captures desktop and phone JPEGs of the preview. It writes `files.json` and both images to R2, then records a `pending` version in D1.
- **Reviewing.** An admin approval publishes the version to the gallery.
- **Starting from a template.** This reuses the existing `POST /api/agent` flow with a `templateId`. The Think behavior seeds the new SpaceDO from the snapshot, commits, and deploys. When the user described their business, the first turn carries a hidden personalization instruction.

**Tech Stack:** Cloudflare Workers, Hono, D1 (drizzle-orm, drizzle-kit), R2, Durable Objects (CodeGeneratorAgent, SpaceDO), isomorphic-git, Browser Rendering (`@cloudflare/puppeteer`), React 19, React Router 7, TanStack Query 5, Kumo UI, Vitest with `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-10-12-templates-design.md`

## Global Constraints

- **Repo hygiene**
  - Work on branch `feat/templates`.
  - Stage files by name. Never run `git add -A` or `git add .`, and never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`.
  - Commit subjects are lowercase conventional commits. Every commit message ends with this trailer line:
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **Code style**
  - No `any`.
  - No emojis in code, comments or UI copy.
  - Comments explain purpose, not narration.
- **Frontend**
  - Import API types from `@/api-types`.
  - API calls live only in `src/lib/api-client.ts`.
- **Limits**
  - 500 files and 10 MB per template version.
  - 5 submissions per user per day.
- **Exact user-facing messages**
  - `Templates can have at most 500 files and 10 MB`
  - `{path} looks like it contains a secret key; remove it and redeploy`
  - `Couldn't capture your site; make sure it's deployed and loads`
  - `This template is no longer available`
- **Categories:** `store`, `landing`, `portfolio`, `restaurant`, `saas`, `services`, `other`.
- **Prices:** one of 0 (free), 900, 1900, 2900 or 4900 cents (USD), set on a template's first submission.
- **Purchases:** paid templates require a purchase before use. A purchase is recorded with provider `test` and no charge, and the UI says `Payments are in test mode. You won't be charged.` A template's creator never needs to buy their own template.
- **Admin:** the migration promotes `alastrat@pluriza.com` to `admin`. No other account becomes an admin.
- **R2 layout:** `templates/<templateId>/<versionId>/files.json`, `desktop.jpg` and `mobile.jpg`, all in `TEMPLATES_BUCKET`.
- **Personalization instruction (verbatim):**
  `This app started from the template {name}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: {description}. Keep none of the template's original copy. Then deploy.`
- **Workspace package:** the worker imports `@space-do/space` from `space/dist`. After editing anything under `space/src`, rebuild with `cd space && node build.mjs`.
- **Tests**
  - Run one file with `npx vitest run <path>`.
  - The test pool (`wrangler.test.jsonc`) has no D1 binding, so put decisions in pure helpers and test those.
  - `worker/api/routes/**` is excluded from Vitest.

## Spec Deviations (rulings)

1. **Starting from a template.** This goes through the existing `POST /api/agent` with a new `templateId` field instead of a separate `POST /api/templates/:id/use`.
   - Why: the chat page already streams agent startup, sends `generate_all`, applies the app-creation rate limit and passes the model choice.
   - Cost if wrong: one thin route added later.
2. **Service tests.** `TemplateService` has no D1-backed tests because the test pool has no D1.
   - Every decision it relies on lives in tested pure helpers (Tasks 2, 3 and 7).
   - The service itself is checked by typecheck and the live checks in Task 15.
3. **Gallery search.** The parameter is `search`, not `q`, so the existing `parsePublicAppsQuery` bounds can be reused.
4. **Added endpoints**, not named in the spec but needed by the UI:
   - `GET /api/apps/:id/template` (owner);
   - `GET /api/templates/mine`;
   - `GET /api/admin/template-versions/:id/files`;
   - `GET /api/admin/template-versions/:id/file?path=` (instead of `files/*path`);
   - `GET /api/admin/template-versions/:id/screenshots/:kind`.
5. **Metadata.** The name, description and category come from a template's first submission. Later submissions only add versions.
   - Why: this avoids unreviewed renames of a published template.
6. **Listing.** Creators can unlist. Only admins can list again, and approving a new version also lists the template.
   - Why: a creator can't undo an admin's unlisting.
7. **Failed seeding.** "Seeding fails, the app is deleted" is met by order. Seeding runs inside agent initialization, before the app row is saved, so a failed seed never creates an app.
8. **Chat entry point.** In chat, "Submit as template" is an item in the header's More actions menu. Think apps' deploy controls live in that header.
9. **Admin page.** It has no navigation link. Admins open `/admin/templates` directly.
10. **Paid templates (scope added by the owner on 2026-10-12).** The spec left payments out. The owner then asked for free and paid test templates.
    - Templates get a `priceCents`, and a `template_purchases` table records who may use a paid template.
    - The buy endpoint records a purchase with provider `test` and charges nothing.
    - A real payment provider replaces that endpoint's body later. The use gate and the data model stay the same.
11. **Admin account.** The template migration ends with `UPDATE users SET role = 'admin' WHERE email = 'alastrat@pluriza.com'`. It does nothing where that account does not exist.

## Review Focus

1. **A second submission while a version is in review.** It is refused with `A version of this template is already in review`.
   - Pinned by the Task 3 test for `canSubmitNewVersion`, plus the Task 8 controller check.
2. **Starting from a template with an empty description.** The result is a deployed copy titled `{name} copy`, and no model turn runs.
   - Pinned by Task 10 tests for `initialProjectTitle` and the build guard.
3. **Binary and non-UTF-8 files.** They keep exact bytes through submit, R2 and seed.
   - Pinned by the Task 2 round-trip test and the Task 4 `readCommitFiles` and `writeWorkdirFiles` tests.
4. **Ordinary config code.** Code that reads keys from the environment is not flagged as a secret.
   - Pinned by Task 2 negative cases.
5. **A template unlisted after a user opened its page, or a paid template used without a purchase.** Starting from it returns `This template is no longer available` (404) or `Buy this template before using it` (402). Either way, no app-creation credit is spent and no agent is created.
   - Pinned by the Task 3 `canUseTemplate` test and the Task 10 ordering guard.

## File Structure

**Shared and database**
- `shared/types/templates.ts`: category, status and role values and their types, shared by the schema, the worker and the UI.
- `worker/database/schema.ts`: the `users.role` and `apps.fromTemplateVersionId` columns, and the `templates` and `templateVersions` tables.
- `migrations/0009_*.sql`: generated by drizzle-kit.

**Template services (`worker/services/templates/`)**
- `snapshot.ts`: snapshot filter, limits, secret scan, bundle encode and decode, and seed path validation (pure).
- `catalog.ts`: submission input, slugs, eligibility, review and listing rules (pure).
- `submit.ts`: the submission orchestration with injected dependencies, plus the R2 key layout.
- `store.ts`: the R2 adapter, the snapshot reader and image responses.
- `capture.ts`: desktop and phone JPEG capture of a deployed preview.

**Database service and auth**
- `worker/database/services/TemplateService.ts`: D1 reads and writes for templates and versions.
- `worker/middleware/auth/routeAuth.ts`: the `admin` auth level.

**API**
- `worker/api/controllers/templates/types.ts`: API types.
- `worker/api/controllers/templates/templateDto.ts`: response projections.
- `worker/api/controllers/templates/galleryQuery.ts`: gallery query bounds.
- `worker/api/controllers/templates/controller.ts`: creator and gallery endpoints.
- `worker/api/controllers/templates/adminController.ts`: review endpoints.
- `worker/api/routes/templateRoutes.ts`: route registration.

**Workspace package**
- `space/src/space/git-objects.ts`: `readCommitFiles` and `writeWorkdirFiles`.
- `space/src/space/durable-object.ts`: the `readTreeAtCommit` and `importFiles` RPCs.

**Agent**
- `worker/agents/think/template-start.ts`: the personalization instruction and the initial title (pure).
- `worker/agents/think/turn-message.ts`: the hidden template part.
- `worker/agents/core/behaviors/think.ts`: seeding from a template and the template source.

**Frontend**
- `src/hooks/use-templates.ts`: queries and mutations.
- `src/lib/template-start.ts`: the chat URL for starting from a template.
- `src/lib/template-status.ts`: the creator status view.
- `src/components/templates/*`: the card, the strip, the use dialog, the submit dialog, the app panel, the origin line and the creator list.
- `src/routes/templates/index.tsx` and `src/routes/templates/detail.tsx`: the gallery pages.
- `src/routes/admin/templates.tsx`: the review queue.

---

### Task 1: Shared template values, schema and migration

**Files:**
- Create: `shared/types/templates.ts`
- Modify: `worker/database/schema.ts`. Change `users` (around line 37), `apps` (around line 204), add a new section after the `apps` table (ends around line 227), and add type exports at the end of the file.
- Generated: `migrations/0009_<name>.sql`, `migrations/meta/0009_snapshot.json`, and an updated `migrations/meta/_journal.json`.
- Test: `worker/database/templates-schema.test.ts`

**Interfaces:**
- Produces, in `shared/types/templates.ts`:
  - `TEMPLATE_CATEGORIES` and `TemplateCategory`;
  - `TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string>`;
  - `TEMPLATE_VERSION_STATUSES` and `TemplateVersionStatus`;
  - `TEMPLATE_LISTING_STATUSES` and `TemplateListingStatus`;
  - `USER_ROLES` and `UserRole`;
  - `TemplateShotKind = 'desktop' | 'mobile'`;
  - `TEMPLATE_PRICE_OPTIONS_CENTS = [0, 900, 1900, 2900, 4900]`;
  - `TEMPLATE_PAYMENT_PROVIDERS = ['test']` and `TemplatePaymentProvider`;
  - `formatTemplatePrice(priceCents: number): string`, which returns `'Free'` or `'$29'`.
- Produces, in `worker/database/schema.ts`:
  - columns `users.role`, `apps.fromTemplateVersionId` and `templates.priceCents`;
  - tables `templates`, `templateVersions` and `templatePurchases`;
  - types `Template`, `NewTemplate`, `TemplateVersion`, `NewTemplateVersion`, `TemplatePurchase` and `NewTemplatePurchase`.

- [ ] **Step 1: Write the failing test**

Create `worker/database/templates-schema.test.ts`:

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

describe('templates schema', () => {
	it('gives every user a role that defaults to user', () => {
		expect(schema.users.role.enumValues).toEqual(['user', 'admin']);
		expect(schema.users.role.notNull).toBe(true);
		expect(schema.users.role.default).toBe('user');
	});

	it('records the template version an app started from', () => {
		expect(schema.apps.fromTemplateVersionId.name).toBe('from_template_version_id');
		expect(schema.apps.fromTemplateVersionId.notNull).toBe(false);
	});

	it('keeps one template per source app behind a unique slug', () => {
		expect(schema.templates.slug.isUnique).toBe(true);
		expect(indexNamed(schema.templates, 'templates_source_app_unique_idx')?.config.unique).toBe(true);
		expect(schema.templates.category.enumValues).toEqual([
			'store',
			'landing',
			'portfolio',
			'restaurant',
			'saas',
			'services',
			'other',
		]);
		expect(schema.templates.status.default).toBe('unlisted');
		expect(schema.templates.priceCents.default).toBe(0);
		expect(schema.templates.priceCents.notNull).toBe(true);
	});

	it('records one purchase per user and template', () => {
		expect(
			indexNamed(schema.templatePurchases, 'template_purchases_template_user_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templatePurchases.provider.enumValues).toEqual(['test']);
	});

	it('numbers versions once per template and starts them pending', () => {
		expect(
			indexNamed(schema.templateVersions, 'template_versions_template_version_unique_idx')?.config.unique,
		).toBe(true);
		expect(schema.templateVersions.status.enumValues).toEqual([
			'pending',
			'approved',
			'rejected',
			'withdrawn',
			'superseded',
		]);
		expect(schema.templateVersions.status.default).toBe('pending');
	});

	it('ships a migration for the new tables and columns', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `templates`');
		expect(allMigrationSql).toContain('CREATE TABLE `template_versions`');
		expect(allMigrationSql).toMatch(/ALTER TABLE `users` ADD `role` text[^;]*DEFAULT 'user'/);
		expect(allMigrationSql).toContain('ALTER TABLE `apps` ADD `from_template_version_id` text');
		expect(allMigrationSql).toContain('CREATE TABLE `template_purchases`');
	});

	it('promotes the platform admin account', () => {
		expect(allMigrationSql).toContain(
			"UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';",
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/database/templates-schema.test.ts`
Expected: FAIL, with `Cannot read properties of undefined (reading 'enumValues')`. `schema.users.role` does not exist yet.

- [ ] **Step 3: Add the shared values**

Create `shared/types/templates.ts`:

```ts
/** Template catalog values shared by the database schema, the worker and the UI. */

export const TEMPLATE_CATEGORIES = [
	'store',
	'landing',
	'portfolio',
	'restaurant',
	'saas',
	'services',
	'other',
] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
	store: 'Store',
	landing: 'Landing page',
	portfolio: 'Portfolio',
	restaurant: 'Restaurant',
	saas: 'SaaS',
	services: 'Services',
	other: 'Other',
};

export const TEMPLATE_VERSION_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'superseded'] as const;
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];

export const TEMPLATE_LISTING_STATUSES = ['listed', 'unlisted'] as const;
export type TemplateListingStatus = (typeof TEMPLATE_LISTING_STATUSES)[number];

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type TemplateShotKind = 'desktop' | 'mobile';

/** Prices a creator can choose, in US cents. 0 means free. */
export const TEMPLATE_PRICE_OPTIONS_CENTS = [0, 900, 1900, 2900, 4900] as const;

/** Where a purchase was paid. `test` records a purchase without charging. */
export const TEMPLATE_PAYMENT_PROVIDERS = ['test'] as const;
export type TemplatePaymentProvider = (typeof TEMPLATE_PAYMENT_PROVIDERS)[number];

export function formatTemplatePrice(priceCents: number): string {
	if (priceCents <= 0) return 'Free';
	const dollars = priceCents / 100;
	return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
```

- [ ] **Step 4: Change the schema**

In `worker/database/schema.ts`, add this import after the existing `drizzle-orm/sqlite-core` import line. The path is relative on purpose, because drizzle-kit loads this file without the `shared` alias.

```ts
import {
    TEMPLATE_CATEGORIES,
    TEMPLATE_LISTING_STATUSES,
    TEMPLATE_PAYMENT_PROVIDERS,
    TEMPLATE_VERSION_STATUSES,
    USER_ROLES,
} from '../../shared/types/templates';
```

In the `users` table, insert this directly after the `aiGatewayEnabled` column:

```ts
    // Platform role; admins review template submissions.
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
```

In the `apps` table, insert this directly after `parentAppId: text('parent_app_id'), // If forked from another app`:

```ts
    fromTemplateVersionId: text('from_template_version_id'), // Template version this app started from
```

Directly after the closing `}));` of the `apps` table, add:

```ts
// ========================================
// TEMPLATES
// ========================================

/**
 * Templates table - Catalog entries, stable across versions. One per source app.
 */
export const templates = sqliteTable('templates', {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    creatorUserId: text('creator_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceAppId: text('source_app_id').references(() => apps.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: text('category', { enum: TEMPLATE_CATEGORIES }).notNull(),
    // Null until an admin approves the first version.
    currentVersionId: text('current_version_id'),
    status: text('status', { enum: TEMPLATE_LISTING_STATUSES }).notNull().default('unlisted'),
    // US cents; 0 is free.
    priceCents: integer('price_cents').notNull().default(0),
    useCount: integer('use_count').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    creatorIdx: index('templates_creator_idx').on(table.creatorUserId),
    sourceAppIdx: uniqueIndex('templates_source_app_unique_idx').on(table.sourceAppId),
    statusCategoryIdx: index('templates_status_category_idx').on(table.status, table.category),
}));

/**
 * Template versions table - One row per submission. Files and screenshots are
 * frozen in R2 under templates/<templateId>/<versionId>/.
 */
export const templateVersions = sqliteTable('template_versions', {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull().references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    sourceCommit: text('source_commit').notNull(),
    snapshotKey: text('snapshot_key').notNull(),
    fileCount: integer('file_count').notNull(),
    totalBytes: integer('total_bytes').notNull(),
    desktopShotKey: text('desktop_shot_key').notNull(),
    mobileShotKey: text('mobile_shot_key').notNull(),
    status: text('status', { enum: TEMPLATE_VERSION_STATUSES }).notNull().default('pending'),
    rightsConfirmedAt: integer('rights_confirmed_at', { mode: 'timestamp' }).notNull(),
    reviewedBy: text('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
    rejectionReason: text('rejection_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    templateVersionIdx: uniqueIndex('template_versions_template_version_unique_idx').on(table.templateId, table.version),
    statusIdx: index('template_versions_status_idx').on(table.status),
}));

/**
 * Template purchases table - Who may use a paid template. Purchases are
 * recorded with the `test` provider (no charge) until a payment provider is
 * connected.
 */
export const templatePurchases = sqliteTable('template_purchases', {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull().references(() => templates.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    priceCents: integer('price_cents').notNull(),
    provider: text('provider', { enum: TEMPLATE_PAYMENT_PROVIDERS }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    templateUserIdx: uniqueIndex('template_purchases_template_user_unique_idx').on(table.templateId, table.userId),
    userIdx: index('template_purchases_user_idx').on(table.userId),
}));
```

At the end of the file, after `export type NewStar = typeof stars.$inferInsert;`, add:

```ts

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type NewTemplateVersion = typeof templateVersions.$inferInsert;
export type TemplatePurchase = typeof templatePurchases.$inferSelect;
export type NewTemplatePurchase = typeof templatePurchases.$inferInsert;
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate`

Expected: drizzle-kit writes `migrations/0009_<random_name>.sql` and `migrations/meta/0009_snapshot.json`, and updates `migrations/meta/_journal.json`.

Open the generated SQL. It must contain only:
- `CREATE TABLE` for `templates`, `template_versions` and `template_purchases`;
- their indexes;
- `ALTER TABLE \`users\` ADD \`role\` text DEFAULT 'user' NOT NULL;`;
- `ALTER TABLE \`apps\` ADD \`from_template_version_id\` text;`.

If it contains statements for anything else, the stored snapshot is stale. In that case, stop and report it. Do not hand-edit unrelated statements.

Then append the admin promotion to the end of that generated `.sql` file. Use exactly these lines; the breakpoint marker keeps drizzle's statement splitting intact:

```sql
--> statement-breakpoint
UPDATE `users` SET `role` = 'admin' WHERE `email` = 'alastrat@pluriza.com';
```

Make sure the line before `--> statement-breakpoint` ends with `;`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run worker/database/templates-schema.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add shared/types/templates.ts worker/database/schema.ts worker/database/templates-schema.test.ts migrations/meta/_journal.json migrations/meta/0009_snapshot.json migrations/0009_*.sql
git commit -m "feat(templates): add template tables, user roles and app template origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Snapshot rules

**Files:**
- Modify: `worker/utils/encoding.ts` (append `uint8ArrayToBase64`).
- Create: `worker/services/templates/snapshot.ts`
- Test: `worker/services/templates/snapshot.test.ts`

**Interfaces:**
- Consumes: `base64ToUint8Array(base64: string): Uint8Array`, already in `worker/utils/encoding.ts`.
- Produces in `worker/utils/encoding.ts`: `uint8ArrayToBase64(bytes: Uint8Array): string`.
- Produces in `snapshot.ts`:
  - constants `MAX_TEMPLATE_FILES = 500`, `MAX_TEMPLATE_BYTES = 10485760`, `TEMPLATE_LIMIT_ERROR` and `EMPTY_TEMPLATE_ERROR`;
  - types `TreeFile { path: string; bytes: Uint8Array }`, `BundleFile { path; encoding: 'utf8' | 'base64'; content }`, `TemplateBundle { files: BundleFile[] }` and `SnapshotResult`;
  - functions:
    - `isExcludedFromSnapshot(path): boolean`;
    - `containsSecret(text): boolean`;
    - `decodeText(bytes): string | null`;
    - `buildSnapshot(files: TreeFile[]): SnapshotResult`;
    - `isSafeSeedPath(path): boolean`;
    - `parseBundle(json: string): TreeFile[]`. Paths are relative, with no leading slash.

- [ ] **Step 1: Write the failing test**

Create `worker/services/templates/snapshot.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	EMPTY_TEMPLATE_ERROR,
	MAX_TEMPLATE_BYTES,
	MAX_TEMPLATE_FILES,
	TEMPLATE_LIMIT_ERROR,
	buildSnapshot,
	isExcludedFromSnapshot,
	isSafeSeedPath,
	parseBundle,
	type TreeFile,
} from './snapshot';

const encoder = new TextEncoder();

function text(path: string, content: string): TreeFile {
	return { path, bytes: encoder.encode(content) };
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);

describe('isExcludedFromSnapshot', () => {
	it.each(['/.git/HEAD', '/.think/space.json', '/.afs/state.json', '/.env', '/.env.local', '/worker/.dev.vars', '/nested/.git/config'])(
		'drops %s',
		(path) => {
			expect(isExcludedFromSnapshot(path)).toBe(true);
		},
	);

	it.each(['/index.html', '/src/env.ts', '/src/config/environment.ts', '/public/.well-known/security.txt'])(
		'keeps %s',
		(path) => {
			expect(isExcludedFromSnapshot(path)).toBe(false);
		},
	);
});

describe('buildSnapshot', () => {
	it('stores text as utf8 and binary as base64, with paths relative to the root', () => {
		const html = '<h1>Café</h1>';
		const result = buildSnapshot([
			text('/index.html', html),
			{ path: '/logo.png', bytes: PNG_BYTES },
			text('/.think/space.json', '{}'),
		]);
		expect(result).toEqual({
			ok: true,
			fileCount: 2,
			totalBytes: encoder.encode(html).byteLength + PNG_BYTES.byteLength,
			bundle: {
				files: [
					{ path: 'index.html', encoding: 'utf8', content: html },
					{ path: 'logo.png', encoding: 'base64', content: 'iVBORw0KGgoA//4=' },
				],
			},
		});
	});

	it('keeps exact bytes through a bundle round trip, including non-UTF-8 text and large binaries', () => {
		const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
		const large = new Uint8Array(300_000).map((_, i) => (i * 7 + 3) % 256);
		const result = buildSnapshot([
			text('/src/app.ts', 'export const x = 1;\n'),
			{ path: '/fonts/a.woff2', bytes: large },
			{ path: '/legacy.txt', bytes: latin1 },
		]);
		if (!result.ok) throw new Error(result.error);

		const restored = parseBundle(JSON.stringify(result.bundle));

		expect(restored.map((file) => file.path)).toEqual(['fonts/a.woff2', 'legacy.txt', 'src/app.ts']);
		expect(restored[0].bytes).toEqual(large);
		expect(restored[1].bytes).toEqual(latin1);
		expect(new TextDecoder().decode(restored[2].bytes)).toBe('export const x = 1;\n');
	});

	it('accepts exactly 500 files', () => {
		const files = Array.from({ length: MAX_TEMPLATE_FILES }, (_, i) => text(`/f${i}.txt`, 'x'));
		expect(buildSnapshot(files)).toMatchObject({ ok: true, fileCount: MAX_TEMPLATE_FILES });
	});

	it('rejects more than 500 files', () => {
		const files = Array.from({ length: MAX_TEMPLATE_FILES + 1 }, (_, i) => text(`/f${i}.txt`, 'x'));
		expect(buildSnapshot(files)).toEqual({ ok: false, error: TEMPLATE_LIMIT_ERROR });
	});

	it('rejects more than 10 MB in total', () => {
		expect(buildSnapshot([{ path: '/big.bin', bytes: new Uint8Array(MAX_TEMPLATE_BYTES + 1) }])).toEqual({
			ok: false,
			error: TEMPLATE_LIMIT_ERROR,
		});
	});

	it('does not count excluded files toward the limits', () => {
		const files = [
			text('/index.html', 'hi'),
			...Array.from({ length: 600 }, (_, i) => text(`/.git/objects/${i}`, 'x')),
		];
		expect(buildSnapshot(files)).toMatchObject({ ok: true, fileCount: 1 });
	});

	it('rejects an app with nothing left to publish', () => {
		expect(buildSnapshot([text('/.think/space.json', '{}')])).toEqual({ ok: false, error: EMPTY_TEMPLATE_ERROR });
	});

	const SECRET_SAMPLES: Array<[string, string]> = [
		['a private key block', '-----BEGIN RSA ' + 'PRIVATE KEY-----\nMIIB'],
		['an AWS access key', 'const id = "AKIA' + 'ABCDEFGHIJKLMNOP";'],
		['a GitHub token', 'token: ghp_' + 'a'.repeat(36)],
		['a GitHub fine-grained token', 'github_pat_' + 'A'.repeat(30)],
		['a Slack token', 'xoxb-' + '1234567890-abc'],
		['a Stripe live key', "stripe('sk_" + 'live_' + '0'.repeat(24) + "')"],
		['an Anthropic key', 'sk-ant-' + 'x'.repeat(40)],
		['an OpenAI key', 'sk-proj-' + 'y'.repeat(40)],
		['an api_key assignment', 'api_key = "' + 'z'.repeat(24) + '"'],
		['a secret assignment', "secret: '" + 'q'.repeat(24) + "'"],
	];

	it.each(SECRET_SAMPLES)('names the file holding %s', (_label, content) => {
		const result = buildSnapshot([text('/index.html', 'ok'), text('/src/config.ts', content)]);
		expect(result).toEqual({
			ok: false,
			error: 'src/config.ts looks like it contains a secret key; remove it and redeploy',
		});
	});

	it.each([
		'const apiKey = import.meta.env.VITE_MAPS_KEY;',
		'secret: process.env.SESSION_SECRET,',
		'const secretMessage = "hi";',
		'<input name="api_key" placeholder="Paste your key">',
	])('does not flag %s', (content) => {
		expect(buildSnapshot([text('/src/config.ts', content)])).toMatchObject({ ok: true });
	});
});

describe('isSafeSeedPath', () => {
	it.each(['index.html', 'src/components/Hero.tsx', 'public/.well-known/security.txt'])('accepts %s', (path) => {
		expect(isSafeSeedPath(path)).toBe(true);
	});

	it.each([
		'',
		'/etc/passwd',
		'../outside.txt',
		'src/../../x',
		'a//b',
		'./a',
		'a\\b',
		'.git/config',
		'.think/space.json',
		'.dev.vars',
		'x'.repeat(513),
	])('rejects %s', (path) => {
		expect(isSafeSeedPath(path)).toBe(false);
	});
});

describe('parseBundle', () => {
	it('rejects a malformed document', () => {
		expect(() => parseBundle('{"files":[{"path":"a.txt"}]}')).toThrow('Template snapshot is malformed');
		expect(() => parseBundle('[]')).toThrow('Template snapshot is malformed');
	});

	it('rejects an unsafe path', () => {
		const json = JSON.stringify({ files: [{ path: '../x', encoding: 'utf8', content: '' }] });
		expect(() => parseBundle(json)).toThrow('Template snapshot has an unsafe path: ../x');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run worker/services/templates/snapshot.test.ts`
Expected: FAIL, with `Failed to resolve import "./snapshot"`.

- [ ] **Step 3: Add the base64 encoder**

Append to `worker/utils/encoding.ts`:

```ts

/** Encode a Uint8Array as base64, in chunks so large files do not overflow the call stack. */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}
```

- [ ] **Step 4: Write the snapshot module**

Create `worker/services/templates/snapshot.ts`:

```ts
/**
 * Template snapshots: the frozen copy of an app's files that a template
 * version publishes. Pure functions, so every rule is unit-tested.
 */

import { base64ToUint8Array, uint8ArrayToBase64 } from '../../utils/encoding';

export const MAX_TEMPLATE_FILES = 500;
export const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;
export const TEMPLATE_LIMIT_ERROR = 'Templates can have at most 500 files and 10 MB';
export const EMPTY_TEMPLATE_ERROR = 'Your app has no files to publish';

/** One file with its exact bytes. Paths read from git start with `/`. */
export interface TreeFile {
	path: string;
	bytes: Uint8Array;
}

export interface BundleFile {
	path: string;
	encoding: 'utf8' | 'base64';
	content: string;
}

/** The `files.json` document stored for each template version. */
export interface TemplateBundle {
	files: BundleFile[];
}

export type SnapshotResult =
	| { ok: true; bundle: TemplateBundle; fileCount: number; totalBytes: number }
	| { ok: false; error: string };

const EXCLUDED_SEGMENTS = new Set(['.git', '.think', '.afs']);

const SECRET_PATTERNS: readonly RegExp[] = [
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bghp_[A-Za-z0-9]{36}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{22,}/,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/,
	/\b[sr]k_live_[A-Za-z0-9]{16,}/,
	/\bsk-ant-[A-Za-z0-9_-]{32,}/,
	/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/,
	/[A-Za-z_]*(?:api[_-]?key|secret)[A-Za-z_]*\s*[:=]\s*["'][^"'\s]{20,}["']/i,
];

function stripLeadingSlashes(path: string): string {
	return path.replace(/^\/+/, '');
}

/** Paths that never enter a snapshot: git and agent bookkeeping, and env files. */
export function isExcludedFromSnapshot(path: string): boolean {
	const segments = stripLeadingSlashes(path).split('/');
	if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return true;
	const name = segments[segments.length - 1] ?? '';
	return name === '.dev.vars' || name.startsWith('.env');
}

export function containsSecret(text: string): boolean {
	return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/** The text of valid UTF-8 without NUL bytes, or null for binary content. */
export function decodeText(bytes: Uint8Array): string | null {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		return text.includes('\u0000') ? null : text;
	} catch {
		return null;
	}
}

/**
 * Filter, limit-check and secret-scan a commit's files, then encode them as a
 * bundle. Text is stored as UTF-8 and everything else as base64, so binary
 * assets keep their exact bytes.
 */
export function buildSnapshot(files: TreeFile[]): SnapshotResult {
	const kept = files
		.filter((file) => !isExcludedFromSnapshot(file.path))
		.sort((a, b) => a.path.localeCompare(b.path));
	const totalBytes = kept.reduce((sum, file) => sum + file.bytes.byteLength, 0);
	if (kept.length > MAX_TEMPLATE_FILES || totalBytes > MAX_TEMPLATE_BYTES) {
		return { ok: false, error: TEMPLATE_LIMIT_ERROR };
	}
	if (kept.length === 0) {
		return { ok: false, error: EMPTY_TEMPLATE_ERROR };
	}

	const bundleFiles: BundleFile[] = [];
	for (const file of kept) {
		const path = stripLeadingSlashes(file.path);
		const text = decodeText(file.bytes);
		if (text === null) {
			bundleFiles.push({ path, encoding: 'base64', content: uint8ArrayToBase64(file.bytes) });
			continue;
		}
		if (containsSecret(text)) {
			return { ok: false, error: `${path} looks like it contains a secret key; remove it and redeploy` };
		}
		bundleFiles.push({ path, encoding: 'utf8', content: text });
	}
	return { ok: true, bundle: { files: bundleFiles }, fileCount: bundleFiles.length, totalBytes };
}

/** Whether a bundle path is safe to write into a new workspace. */
export function isSafeSeedPath(path: string): boolean {
	if (path.length === 0 || path.length > 512) return false;
	if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return false;
	const segments = path.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
	return !isExcludedFromSnapshot(path);
}

function isBundleFile(value: unknown): value is BundleFile {
	if (typeof value !== 'object' || value === null) return false;
	const file = value as Record<string, unknown>;
	return (
		typeof file.path === 'string' &&
		typeof file.content === 'string' &&
		(file.encoding === 'utf8' || file.encoding === 'base64')
	);
}

/** Parse a stored `files.json`, validating every path again before it is used. */
export function parseBundle(json: string): TreeFile[] {
	const parsed: unknown = JSON.parse(json);
	const candidate = typeof parsed === 'object' && parsed !== null ? (parsed as { files?: unknown }).files : undefined;
	if (!Array.isArray(candidate)) throw new Error('Template snapshot is malformed');
	const entries: unknown[] = candidate;
	if (!entries.every(isBundleFile)) throw new Error('Template snapshot is malformed');
	if (entries.length > MAX_TEMPLATE_FILES) throw new Error(TEMPLATE_LIMIT_ERROR);

	return entries.map((file) => {
		if (!isSafeSeedPath(file.path)) {
			throw new Error(`Template snapshot has an unsafe path: ${file.path}`);
		}
		const bytes = file.encoding === 'base64' ? base64ToUint8Array(file.content) : new TextEncoder().encode(file.content);
		return { path: file.path, bytes };
	});
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run worker/services/templates/snapshot.test.ts`
Expected: PASS (all cases, including 10 secret samples and 4 negative samples).

- [ ] **Step 6: Commit**

```bash
git add worker/utils/encoding.ts worker/services/templates/snapshot.ts worker/services/templates/snapshot.test.ts
git commit -m "feat(templates): build and read template snapshots with limits and a secret scan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Catalog rules

**Files:**
- Create: `worker/services/templates/catalog.ts`
- Create: `worker/api/controllers/templates/galleryQuery.ts`
- Test: `worker/services/templates/catalog.test.ts`
- Test: `worker/api/controllers/templates/galleryQuery.test.ts`

**Interfaces:**
- Consumes:
  - `TEMPLATE_CATEGORIES`, `TemplateCategory`, `TemplateVersionStatus` and `TemplateShotKind` from `shared/types/templates.ts` (Task 1);
  - `parsePublicAppsQuery(params: URLSearchParams)` from `worker/api/controllers/apps/publicAppsQuery.ts`.
- Produces, in `catalog.ts`:
  - **Message constants:** `NOT_THINK_REASON`, `NOT_DEPLOYED_REASON`, `VERSION_IN_REVIEW_ERROR`, `RIGHTS_REQUIRED_ERROR`, `TEMPLATE_UNAVAILABLE_MESSAGE` and `PURCHASE_REQUIRED_ERROR`.
  - **Types:**
    - `Validation<T> = { ok: true; value: T } | { ok: false; error: string }`;
    - `TemplateMetadata { name; description; category: TemplateCategory; priceCents: number }`;
    - `ListingDecision`;
    - `PurchaseDecision = { ok: true; alreadyOwned: boolean } | { ok: false; status: 400; error: string }`.
  - **Purchases:**
    - `isTemplatePrice(value: unknown): value is number`;
    - `canUseTemplate(input: { priceCents; isCreator; hasPurchase }): boolean`;
    - `purchaseDecision(input: { priceCents; isCreator; hasPurchase }): PurchaseDecision`.
  - **Input parsing:**
    - `isTemplateCategory(value: unknown): value is TemplateCategory`;
    - `parseRightsConfirmation(body: unknown): Validation<true>`;
    - `parseTemplateMetadata(body: unknown): Validation<TemplateMetadata>`;
    - `parseRejectionReason(body: unknown): Validation<string>`;
    - `parseListingRequest(body: unknown): Validation<boolean>`.
  - **Slugs:**
    - `slugifyTemplateName(name: string): string`;
    - `randomSlugSuffix(): string`;
    - `uniqueTemplateSlug(name, isTaken: (slug: string) => Promise<boolean>, suffix?: () => string): Promise<string>`;
    - `isTemplateSlug(value: string): boolean`.
  - **Version rules:**
    - `eligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null`;
    - `canSubmitNewVersion(statuses: readonly TemplateVersionStatus[]): boolean`;
    - `canWithdraw(status): boolean`;
    - `canReview(status): boolean`;
    - `supersededVersionId(currentVersionId: string | null, approvedVersionId: string): string | null`.
  - **Listing and screenshots:**
    - `listingDecision(input: { isAdmin; isCreator; listed; hasApprovedVersion }): ListingDecision`;
    - `isTemplateShotKind(value: string): value is TemplateShotKind`.
- Produces, in `galleryQuery.ts`:
  - `GalleryQuery { limit; page; offset; search?: string; category?: TemplateCategory }`;
  - `parseGalleryQuery(params: URLSearchParams): Validation<GalleryQuery>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/services/templates/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatTemplatePrice } from '../../../shared/types/templates';
import {
	NOT_DEPLOYED_REASON,
	NOT_THINK_REASON,
	RIGHTS_REQUIRED_ERROR,
	canReview,
	canSubmitNewVersion,
	canUseTemplate,
	canWithdraw,
	eligibilityReason,
	isTemplateShotKind,
	isTemplateSlug,
	listingDecision,
	parseListingRequest,
	parseRejectionReason,
	parseRightsConfirmation,
	parseTemplateMetadata,
	purchaseDecision,
	randomSlugSuffix,
	slugifyTemplateName,
	supersededVersionId,
	uniqueTemplateSlug,
} from './catalog';

const VALID = { name: 'Fernwood', description: 'A cozy merino sock store.', category: 'store', priceCents: 0 };

describe('parseTemplateMetadata', () => {
	it('trims and accepts a complete form', () => {
		expect(
			parseTemplateMetadata({
				name: '  Fernwood Socks ',
				description: ' A cozy merino sock store. ',
				category: 'store',
				priceCents: 2900,
			}),
		).toEqual({
			ok: true,
			value: { name: 'Fernwood Socks', description: 'A cozy merino sock store.', category: 'store', priceCents: 2900 },
		});
	});

	it('treats a missing price as free', () => {
		const { priceCents: _omitted, ...withoutPrice } = VALID;
		expect(parseTemplateMetadata(withoutPrice)).toMatchObject({ ok: true, value: { priceCents: 0 } });
	});

	it.each([
		[{ ...VALID, name: 'ab' }, 'Name must be between 3 and 60 characters'],
		[{ ...VALID, name: 'x'.repeat(61) }, 'Name must be between 3 and 60 characters'],
		[{ ...VALID, description: 'Too short' }, 'Description must be between 10 and 280 characters'],
		[{ ...VALID, description: 'x'.repeat(281) }, 'Description must be between 10 and 280 characters'],
		[{ ...VALID, category: 'blog' }, 'Choose a category'],
		[{ ...VALID, priceCents: 1234 }, 'Choose a price'],
		[{ ...VALID, priceCents: '2900' }, 'Choose a price'],
		[null, 'Name must be between 3 and 60 characters'],
	])('rejects %j', (body, error) => {
		expect(parseTemplateMetadata(body)).toEqual({ ok: false, error });
	});
});

describe('prices and purchases', () => {
	it('formats prices', () => {
		expect(formatTemplatePrice(0)).toBe('Free');
		expect(formatTemplatePrice(2900)).toBe('$29');
		expect(formatTemplatePrice(950)).toBe('$9.50');
	});

	it.each([
		[{ priceCents: 0, isCreator: false, hasPurchase: false }, true],
		[{ priceCents: 2900, isCreator: false, hasPurchase: false }, false],
		[{ priceCents: 2900, isCreator: false, hasPurchase: true }, true],
		[{ priceCents: 2900, isCreator: true, hasPurchase: false }, true],
	])('decides use for %j', (input, allowed) => {
		expect(canUseTemplate(input)).toBe(allowed);
	});

	it.each([
		[{ priceCents: 0, isCreator: false, hasPurchase: false }, { ok: false, status: 400, error: 'This template is free' }],
		[{ priceCents: 2900, isCreator: true, hasPurchase: false }, { ok: false, status: 400, error: 'You created this template' }],
		[{ priceCents: 2900, isCreator: false, hasPurchase: true }, { ok: true, alreadyOwned: true }],
		[{ priceCents: 2900, isCreator: false, hasPurchase: false }, { ok: true, alreadyOwned: false }],
	])('decides a purchase for %j', (input, decision) => {
		expect(purchaseDecision(input)).toEqual(decision);
	});
});

describe('parseRightsConfirmation', () => {
	it('requires the literal true', () => {
		expect(parseRightsConfirmation({ rightsConfirmed: true })).toEqual({ ok: true, value: true });
		expect(parseRightsConfirmation({ rightsConfirmed: 'true' })).toEqual({ ok: false, error: RIGHTS_REQUIRED_ERROR });
		expect(parseRightsConfirmation({})).toEqual({ ok: false, error: RIGHTS_REQUIRED_ERROR });
	});
});

describe('slugs', () => {
	it.each([
		['Fernwood Merino Socks!', 'fernwood-merino-socks'],
		['Café Olé', 'cafe-ole'],
		['日本語', 'template'],
		['a'.repeat(47) + ' b', 'a'.repeat(47)],
	])('slugifies %s', (name, slug) => {
		expect(slugifyTemplateName(name)).toBe(slug);
	});

	it('uses the plain slug when it is free', async () => {
		await expect(uniqueTemplateSlug('Pluriza Home', async () => false)).resolves.toBe('pluriza-home');
	});

	it('adds a suffix when the slug is taken', async () => {
		const taken = new Set(['pluriza-home']);
		await expect(uniqueTemplateSlug('Pluriza Home', async (slug) => taken.has(slug), () => 'k3x9')).resolves.toBe(
			'pluriza-home-k3x9',
		);
	});

	it('gives up after five taken suffixes', async () => {
		await expect(uniqueTemplateSlug('Pluriza Home', async () => true, () => 'aaaa')).rejects.toThrow(
			'Could not find a free template slug',
		);
	});

	it('makes 4-character lowercase suffixes', () => {
		expect(randomSlugSuffix()).toMatch(/^[a-z0-9]{4}$/);
	});

	it('recognizes valid slugs', () => {
		expect(isTemplateSlug('fernwood-socks-k3x9')).toBe(true);
		expect(isTemplateSlug('Fernwood')).toBe(false);
		expect(isTemplateSlug('a--b')).toBe(false);
		expect(isTemplateSlug('../x')).toBe(false);
	});
});

describe('version rules', () => {
	it('explains why an app cannot be submitted', () => {
		expect(eligibilityReason('phasic', true)).toBe(NOT_THINK_REASON);
		expect(eligibilityReason('think', false)).toBe(NOT_DEPLOYED_REASON);
		expect(eligibilityReason('think', true)).toBeNull();
	});

	it('refuses a new version while one is in review', () => {
		expect(canSubmitNewVersion([])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'rejected', 'withdrawn'])).toBe(true);
		expect(canSubmitNewVersion(['approved', 'pending'])).toBe(false);
	});

	it('withdraws and reviews only pending versions', () => {
		expect(canWithdraw('pending')).toBe(true);
		expect(canWithdraw('approved')).toBe(false);
		expect(canReview('pending')).toBe(true);
		expect(canReview('rejected')).toBe(false);
	});

	it('requires a rejection reason', () => {
		expect(parseRejectionReason({ reason: '  Uses a real brand logo ' })).toEqual({ ok: true, value: 'Uses a real brand logo' });
		expect(parseRejectionReason({ reason: '   ' })).toEqual({ ok: false, error: 'A reason is required to reject a template' });
		expect(parseRejectionReason({ reason: 'x'.repeat(501) })).toEqual({
			ok: false,
			error: 'Keep the reason under 500 characters',
		});
	});

	it('supersedes the current version only when it differs', () => {
		expect(supersededVersionId(null, 'v2')).toBeNull();
		expect(supersededVersionId('v1', 'v2')).toBe('v1');
		expect(supersededVersionId('v2', 'v2')).toBeNull();
	});
});

describe('listing', () => {
	it('parses the listed flag', () => {
		expect(parseListingRequest({ listed: false })).toEqual({ ok: true, value: false });
		expect(parseListingRequest({ listed: 'no' })).toEqual({ ok: false, error: 'listed must be true or false' });
	});

	it.each([
		[{ isAdmin: false, isCreator: false, listed: false, hasApprovedVersion: true }, { ok: false, status: 403, error: 'You can only change your own templates' }],
		[{ isAdmin: false, isCreator: true, listed: false, hasApprovedVersion: true }, { ok: true }],
		[{ isAdmin: false, isCreator: true, listed: true, hasApprovedVersion: true }, { ok: false, status: 403, error: 'Submit a new version to publish this template again' }],
		[{ isAdmin: true, isCreator: false, listed: true, hasApprovedVersion: false }, { ok: false, status: 400, error: 'This template has no approved version to publish' }],
		[{ isAdmin: true, isCreator: false, listed: true, hasApprovedVersion: true }, { ok: true }],
	])('decides %j', (input, decision) => {
		expect(listingDecision(input)).toEqual(decision);
	});

	it('knows the screenshot kinds', () => {
		expect(isTemplateShotKind('desktop')).toBe(true);
		expect(isTemplateShotKind('mobile')).toBe(true);
		expect(isTemplateShotKind('tablet')).toBe(false);
	});
});
```

Create `worker/api/controllers/templates/galleryQuery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseGalleryQuery } from './galleryQuery';

describe('parseGalleryQuery', () => {
	it('applies the public listing defaults', () => {
		expect(parseGalleryQuery(new URLSearchParams())).toEqual({
			ok: true,
			value: { limit: 20, page: 1, offset: 0, search: undefined, category: undefined },
		});
	});

	it('accepts a known category and a search term', () => {
		expect(parseGalleryQuery(new URLSearchParams({ category: 'store', search: 'socks', page: '2', limit: '12' }))).toEqual({
			ok: true,
			value: { limit: 12, page: 2, offset: 12, search: 'socks', category: 'store' },
		});
	});

	it('rejects an unknown category', () => {
		expect(parseGalleryQuery(new URLSearchParams({ category: 'blog' }))).toEqual({ ok: false, error: 'Unknown category' });
	});

	it('keeps the public listing bounds on search', () => {
		expect(parseGalleryQuery(new URLSearchParams({ search: '100%' }))).toEqual({
			ok: false,
			error: 'search may not contain wildcard characters',
		});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/services/templates/catalog.test.ts worker/api/controllers/templates/galleryQuery.test.ts`
Expected: FAIL, with `Failed to resolve import "./catalog"` and `Failed to resolve import "./galleryQuery"`.

- [ ] **Step 3: Write the catalog rules**

Create `worker/services/templates/catalog.ts`:

```ts
/**
 * Template catalog rules: submission input, slugs, eligibility, and review
 * and listing decisions. Pure, so each rule is unit-tested.
 */

import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type TemplateCategory,
	type TemplateShotKind,
	type TemplateVersionStatus,
} from '../../../shared/types/templates';

export const MIN_TEMPLATE_NAME_LENGTH = 3;
export const MAX_TEMPLATE_NAME_LENGTH = 60;
export const MIN_TEMPLATE_DESCRIPTION_LENGTH = 10;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 280;
export const MAX_REJECTION_REASON_LENGTH = 500;

export const NOT_THINK_REASON = 'Only apps built with the current builder can become templates';
export const NOT_DEPLOYED_REASON = 'Deploy your app before submitting it as a template';
export const VERSION_IN_REVIEW_ERROR = 'A version of this template is already in review';
export const RIGHTS_REQUIRED_ERROR = 'Confirm that you own the rights to this content';
export const TEMPLATE_UNAVAILABLE_MESSAGE = 'This template is no longer available';
export const PURCHASE_REQUIRED_ERROR = 'Buy this template before using it';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface TemplateMetadata {
	name: string;
	description: string;
	category: TemplateCategory;
	priceCents: number;
}

export type ListingDecision = { ok: true } | { ok: false; status: 400 | 403; error: string };

export type PurchaseDecision = { ok: true; alreadyOwned: boolean } | { ok: false; status: 400; error: string };

interface UseInput {
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

/** The creator's rights confirmation, required on every submission. */
export function parseRightsConfirmation(body: unknown): Validation<true> {
	return field(body, 'rightsConfirmed') === true
		? { ok: true, value: true }
		: { ok: false, error: RIGHTS_REQUIRED_ERROR };
}

export function isTemplatePrice(value: unknown): value is number {
	return typeof value === 'number' && (TEMPLATE_PRICE_OPTIONS_CENTS as readonly number[]).includes(value);
}

/** Name, description, category and price, set by a template's first submission. A missing price is free. */
export function parseTemplateMetadata(body: unknown): Validation<TemplateMetadata> {
	const name = trimmedString(field(body, 'name'));
	const description = trimmedString(field(body, 'description'));
	const category = field(body, 'category');
	const rawPrice = field(body, 'priceCents');
	const priceCents = rawPrice === undefined ? 0 : rawPrice;
	if (name.length < MIN_TEMPLATE_NAME_LENGTH || name.length > MAX_TEMPLATE_NAME_LENGTH) {
		return { ok: false, error: `Name must be between ${MIN_TEMPLATE_NAME_LENGTH} and ${MAX_TEMPLATE_NAME_LENGTH} characters` };
	}
	if (description.length < MIN_TEMPLATE_DESCRIPTION_LENGTH || description.length > MAX_TEMPLATE_DESCRIPTION_LENGTH) {
		return {
			ok: false,
			error: `Description must be between ${MIN_TEMPLATE_DESCRIPTION_LENGTH} and ${MAX_TEMPLATE_DESCRIPTION_LENGTH} characters`,
		};
	}
	if (!isTemplateCategory(category)) {
		return { ok: false, error: 'Choose a category' };
	}
	if (!isTemplatePrice(priceCents)) {
		return { ok: false, error: 'Choose a price' };
	}
	return { ok: true, value: { name, description, category, priceCents } };
}

/** Free templates are open to everyone; paid ones to their creator and buyers. */
export function canUseTemplate(input: UseInput): boolean {
	return input.priceCents === 0 || input.isCreator || input.hasPurchase;
}

/** Whether a user can buy a template; buying one already owned succeeds without a new record. */
export function purchaseDecision(input: UseInput): PurchaseDecision {
	if (input.priceCents === 0) return { ok: false, status: 400, error: 'This template is free' };
	if (input.isCreator) return { ok: false, status: 400, error: 'You created this template' };
	return { ok: true, alreadyOwned: input.hasPurchase };
}

/** Slug from a template name: lowercase ASCII words joined by hyphens, at most 48 characters. */
export function slugifyTemplateName(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
	return slug || 'template';
}

const SLUG_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomSlugSuffix(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(4));
	return Array.from(bytes, (byte) => SLUG_SUFFIX_ALPHABET[byte % SLUG_SUFFIX_ALPHABET.length]).join('');
}

/** The name's slug, or the slug plus a 4-character suffix when it is taken. */
export async function uniqueTemplateSlug(
	name: string,
	isTaken: (slug: string) => Promise<boolean>,
	suffix: () => string = randomSlugSuffix,
): Promise<string> {
	const base = slugifyTemplateName(name);
	if (!(await isTaken(base))) return base;
	for (let attempt = 0; attempt < 5; attempt++) {
		const candidate = `${base}-${suffix()}`;
		if (!(await isTaken(candidate))) return candidate;
	}
	throw new Error('Could not find a free template slug');
}

export function isTemplateSlug(value: string): boolean {
	return value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Why an app cannot be submitted as a template, or null when it can. */
export function eligibilityReason(behaviorType: string, hasDeployedCommit: boolean): string | null {
	if (behaviorType !== 'think') return NOT_THINK_REASON;
	return hasDeployedCommit ? null : NOT_DEPLOYED_REASON;
}

/** A template takes a new version only while none is in review. */
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
		return { ok: false, error: 'A reason is required to reject a template' };
	}
	if (reason.length > MAX_REJECTION_REASON_LENGTH) {
		return { ok: false, error: `Keep the reason under ${MAX_REJECTION_REASON_LENGTH} characters` };
	}
	return { ok: true, value: reason };
}

/** The version an approval supersedes: the template's current one, when it differs. */
export function supersededVersionId(currentVersionId: string | null, approvedVersionId: string): string | null {
	return currentVersionId && currentVersionId !== approvedVersionId ? currentVersionId : null;
}

export function parseListingRequest(body: unknown): Validation<boolean> {
	const listed = field(body, 'listed');
	return typeof listed === 'boolean'
		? { ok: true, value: listed }
		: { ok: false, error: 'listed must be true or false' };
}

/** Creators and admins can unlist; only admins can list, and only a template with an approved version. */
export function listingDecision(input: {
	isAdmin: boolean;
	isCreator: boolean;
	listed: boolean;
	hasApprovedVersion: boolean;
}): ListingDecision {
	if (!input.isAdmin && !input.isCreator) {
		return { ok: false, status: 403, error: 'You can only change your own templates' };
	}
	if (!input.listed) return { ok: true };
	if (!input.isAdmin) {
		return { ok: false, status: 403, error: 'Submit a new version to publish this template again' };
	}
	if (!input.hasApprovedVersion) {
		return { ok: false, status: 400, error: 'This template has no approved version to publish' };
	}
	return { ok: true };
}

export function isTemplateShotKind(value: string): value is TemplateShotKind {
	return value === 'desktop' || value === 'mobile';
}
```

- [ ] **Step 4: Write the gallery query parser**

Create `worker/api/controllers/templates/galleryQuery.ts`:

```ts
/**
 * Bounds for the public template gallery query. Paging and search reuse the
 * public apps limits; the category must be a known one.
 */

import type { TemplateCategory } from '../../../../shared/types/templates';
import { isTemplateCategory, type Validation } from '../../../services/templates/catalog';
import { parsePublicAppsQuery } from '../apps/publicAppsQuery';

export interface GalleryQuery {
	limit: number;
	page: number;
	offset: number;
	search?: string;
	category?: TemplateCategory;
}

export function parseGalleryQuery(params: URLSearchParams): Validation<GalleryQuery> {
	const bounds = parsePublicAppsQuery(params);
	if (!bounds.ok) return { ok: false, error: bounds.error };

	const rawCategory = params.get('category') || undefined;
	if (rawCategory !== undefined && !isTemplateCategory(rawCategory)) {
		return { ok: false, error: 'Unknown category' };
	}
	return { ok: true, value: { ...bounds.value, category: rawCategory } };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/services/templates/catalog.test.ts worker/api/controllers/templates/galleryQuery.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/services/templates/catalog.ts worker/services/templates/catalog.test.ts worker/api/controllers/templates/galleryQuery.ts worker/api/controllers/templates/galleryQuery.test.ts
git commit -m "feat(templates): add catalog rules for submissions, slugs, review and listing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Workspace reads a commit's files and imports files

**Files:**
- Modify: `space/src/space/git-objects.ts` (append after `readBlobBytes`, around line 221)
- Modify: `space/src/space/durable-object.ts`: the import on line 18, plus two RPCs after the `gitCommit` method.
- Test: `space/test/git-objects.test.ts` (append)
- Build: `space/dist` (regenerated, git-ignored)

**Interfaces:**
- Produces, in `git-objects.ts`:
  - `readCommitFiles(fs: FileSystem, commitOid: string): Promise<Array<{ path: string; bytes: Uint8Array }>>`. Paths start with `/` and are sorted.
  - `writeWorkdirFiles(fs: FileSystem, files: Array<{ path: string; bytes: Uint8Array }>, isReserved: (path: string) => boolean): Promise<number>`. It accepts paths with or without a leading `/`.
- Produces, as SpaceDO RPCs:
  - `readTreeAtCommit(commit: string): Promise<Array<{ path: string; bytes: Uint8Array }>>`;
  - `importFiles(files: Array<{ path: string; bytes: Uint8Array }>, message: string): Promise<{ sha: string; message: string }>`.

- [ ] **Step 1: Write the failing tests**

In `space/test/git-objects.test.ts`, add `readCommitFiles` and `writeWorkdirFiles` to the existing import from `"../src/space/git-objects"`. Then append:

```ts
describe("readCommitFiles", () => {
  it("returns the committed bytes, not later working-tree edits", async () => {
    const fs = new InMemoryFs()
    await createGit(fs).init({ defaultBranch: "main" })
    const logo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    await fs.writeFile("/index.html", "<h1>v1</h1>")
    await fs.mkdir("/public", { recursive: true })
    await fs.writeFileBytes("/public/logo.png", logo)
    const commit = await commitAll(fs, "first")
    await fs.writeFile("/index.html", "<h1>uncommitted</h1>")

    const files = await readCommitFiles(fs, commit)

    expect(files.map((file) => file.path)).toEqual(["/index.html", "/public/logo.png"])
    expect(new TextDecoder().decode(files[0].bytes)).toBe("<h1>v1</h1>")
    expect(files[1].bytes).toEqual(logo)
  })
})

describe("writeWorkdirFiles", () => {
  it("writes nested files byte-for-byte and skips reserved paths", async () => {
    const fs = new InMemoryFs()
    const font = new Uint8Array([0, 1, 2, 250])

    const written = await writeWorkdirFiles(
      fs,
      [
        { path: "src/components/Hero.tsx", bytes: new TextEncoder().encode("export {}") },
        { path: "/fonts/a.woff2", bytes: font },
        { path: ".git/config", bytes: new TextEncoder().encode("[core]") },
      ],
      isReserved,
    )

    expect(written).toBe(2)
    expect(await fs.readFile("/src/components/Hero.tsx")).toBe("export {}")
    expect(await fs.readFileBytes("/fonts/a.woff2")).toEqual(font)
    expect(await fs.exists("/.git/config")).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run space/test/git-objects.test.ts`
Expected: FAIL, with `readCommitFiles is not a function` (or a missing-export error).

- [ ] **Step 3: Add the helpers**

Append to `space/src/space/git-objects.ts`, directly after `readBlobBytes`:

```ts

/** Every file in the tree of `commitOid` with its bytes, sorted by path. */
export async function readCommitFiles(
  fs: FileSystem,
  commitOid: string,
): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const tree = await walkTreeFiles(fs, commitOid)
  const files: Array<{ path: string; bytes: Uint8Array }> = []
  for (const [path, entry] of tree) {
    files.push({ path, bytes: await readBlobBytes(fs, entry.oid) })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Write `files` into the working tree as raw bytes, creating parent
 * directories and skipping reserved paths. Returns how many were written.
 */
export async function writeWorkdirFiles(
  fs: FileSystem,
  files: Array<{ path: string; bytes: Uint8Array }>,
  isReserved: (path: string) => boolean,
): Promise<number> {
  let written = 0
  for (const file of files) {
    const path = file.path.startsWith("/") ? file.path : `/${file.path}`
    if (isReserved(path)) continue
    const dir = path.slice(0, path.lastIndexOf("/"))
    if (dir) await fs.mkdir(dir, { recursive: true })
    await fs.writeFileBytes(path, file.bytes)
    written++
  }
  return written
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run space/test/git-objects.test.ts`
Expected: PASS (the existing tests plus the 2 new ones).

- [ ] **Step 5: Add the SpaceDO RPCs**

In `space/src/space/durable-object.ts`, change line 18 to:

```ts
import { readCommitFiles, resolveHead, stageWorkdir, stagedTreeMatchesHead, writeWorkdirFiles } from "./git-objects"
```

Directly after the end of the `gitCommit` method, add:

```ts

  /**
   * Every file in the tree of `commit`, as bytes. Reads git objects, so the
   * result is the committed content even when the working tree has edits.
   */
  async readTreeAtCommit(commit: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
    await this.ensureInit()
    const files = await readCommitFiles(this.fs, commit)
    return files.filter((file) => !isReservedPath(file.path))
  }

  /**
   * Write `files` into the working tree and commit them as one restore point.
   * Starts a new app from a template snapshot.
   */
  async importFiles(
    files: Array<{ path: string; bytes: Uint8Array }>,
    message: string,
  ): Promise<{ sha: string; message: string }> {
    await this.ensureInit()
    await writeWorkdirFiles(this.fs, files, isReservedPath)
    return this.gitCommit(message)
  }
```

- [ ] **Step 6: Rebuild and typecheck the workspace package**

Run: `cd space && node build.mjs && npx tsc --noEmit && cd ..`
Expected: the build finishes and `tsc` prints no errors.

- [ ] **Step 7: Commit**

```bash
git add space/src/space/git-objects.ts space/src/space/durable-object.ts space/test/git-objects.test.ts
git commit -m "feat(space): read a commit's files and import files as one commit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Screenshot capture for phones and JPEG

**Files:**
- Modify: `worker/services/browser-capture/types.ts`: `ScreenshotPayload` (lines 26-33) and the `captureScreenshot` doc comment (around line 160).
- Modify: `worker/services/browser-capture/capture-core.ts`: `runScreenshot` (lines 109-130) and the viewport constants (lines 135-136).
- Test: `worker/services/browser-capture/capture-core.test.ts`

**Interfaces:**
- Produces:
  - `ScreenshotPayload.viewport` gains optional `isMobile` and `hasTouch`;
  - `ScreenshotPayload` gains `format?: 'png' | 'jpeg'` (PNG when omitted);
  - exported `DESKTOP_VIEWPORT = { width: 1280, height: 800 }`;
  - exported `PHONE_VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true }`.

- [ ] **Step 1: Write the failing test**

In `worker/services/browser-capture/capture-core.test.ts`:

1. Change the import line to:

```ts
import { PHONE_VIEWPORT, ReferenceCaptureError, runReferenceCapture, runScreenshot } from './capture-core';
```

2. Add `viewports: unknown[];` to the `FakePage` interface.
3. In `fakePage`, declare `const viewports: unknown[] = [];`.
4. Make `setViewport` record the full viewport:

```ts
		setViewport: async (v) => {
			calls.push(`viewport ${v.width}x${v.height}`);
			viewports.push(v);
		},
```

5. Return `{ page, calls, screenshotOptions, gotoOptions, viewports }`.

Then add this test inside `describe('runScreenshot', ...)`:

```ts
	it('emulates a phone and returns a JPEG when the payload asks for one', async () => {
		const fake = fakePage({ screenshot: 'base64-jpeg' });
		const payload: ScreenshotPayload = { ...PAYLOAD, viewport: PHONE_VIEWPORT, format: 'jpeg' };
		await expect(runScreenshot(fake.page, payload)).resolves.toBe('base64-jpeg');
		expect(fake.viewports).toEqual([{ width: 390, height: 844, isMobile: true, hasTouch: true }]);
		expect(fake.screenshotOptions).toEqual([{ type: 'jpeg', quality: 80, fullPage: false, encoding: 'base64' }]);
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/services/browser-capture/capture-core.test.ts`
Expected: FAIL. `PHONE_VIEWPORT` is undefined, and the screenshot options still say `png`.

- [ ] **Step 3: Extend the payload**

In `worker/services/browser-capture/types.ts`, replace `ScreenshotPayload` with:

```ts
export interface ScreenshotPayload {
	url: string;
	viewport: { width: number; height: number; isMobile?: boolean; hasTouch?: boolean };
	/** Navigation timeout in milliseconds. */
	timeoutMs: number;
	/** Milliseconds to wait after the network goes idle, so late renders land in the image. */
	settleMs: number;
	/** Image format of the returned base64 data; PNG when omitted. */
	format?: 'png' | 'jpeg';
}
```

Change the doc comment above `captureScreenshot(payload: ScreenshotPayload): Promise<string>;` in `BrowserCaptureClient` to:

```ts
	/** Returns a base64 image (no data URL prefix) of the page's viewport, PNG unless the payload asks for JPEG; throws on failure. */
```

- [ ] **Step 4: Update the capture core**

In `worker/services/browser-capture/capture-core.ts`:

1. Rename `DESKTOP` to `DESKTOP_VIEWPORT` and `PHONE` to `PHONE_VIEWPORT`, in their definitions and at every use in this file, and export both:

```ts
export const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
export const PHONE_VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true };
```

2. Above `runScreenshot`, add:

```ts
const SCREENSHOT_JPEG_QUALITY = 80;
```

3. In `runScreenshot`, replace `return await page.screenshot({ type: 'png', fullPage: false, encoding: 'base64' });` with:

```ts
		return await page.screenshot(
			payload.format === 'jpeg'
				? { type: 'jpeg', quality: SCREENSHOT_JPEG_QUALITY, fullPage: false, encoding: 'base64' }
				: { type: 'png', fullPage: false, encoding: 'base64' },
		);
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run worker/services/browser-capture/capture-core.test.ts && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 6: Commit**

```bash
git add worker/services/browser-capture/types.ts worker/services/browser-capture/capture-core.ts worker/services/browser-capture/capture-core.test.ts
git commit -m "feat(capture): capture phone viewports and JPEG screenshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin auth level, submission rate limit and template service

**Files:**
- Modify: `worker/middleware/auth/routeAuth.ts`
- Create: `worker/middleware/auth/routeAuth.test.ts`
- Modify: `worker/database/services/UserService.ts` (add `getRole`)
- Create: `worker/database/services/TemplateService.ts`
- Modify: `worker/database/index.ts` (export `TemplateService`)
- Modify: `worker/services/rate-limit/config.ts` and `worker/services/rate-limit/rateLimits.ts`
- Create: `worker/services/rate-limit/template-submission-limit.test.ts`

**Interfaces:**
- Consumes: the schema tables and types from Task 1, and `TemplateCategory` and `UserRole` from `shared/types/templates.ts`.
- Produces, in `routeAuth.ts`:
  - `AuthLevel` includes `'admin'`;
  - `AuthRequirement.roleCheck?: (user: AuthUser, env: Env) => Promise<boolean>`;
  - `AuthConfig.admin`;
  - `checkAdminRole(user: AuthUser, env: Env): Promise<boolean>`.
- Produces: `UserService.getRole(userId: string): Promise<UserRole | null>`.
- Produces, for rate limiting:
  - `RateLimitType.TEMPLATE_SUBMISSION = 'templateSubmission'`;
  - `RateLimitService.enforceTemplateSubmissionRateLimit(env, config, user): Promise<void>`, which throws `RateLimitExceededError`.
- Produces, in `TemplateService` (`worker/database/services/TemplateService.ts`):
  - **Row types:**
    - `TemplateWithVersion { template: Template; version: TemplateVersion; creatorName: string | null }`;
    - `PendingVersionRow extends TemplateWithVersion { creatorEmail: string | null }`;
    - `CreatorTemplateRow { template: Template; versions: TemplateVersion[] }`;
    - `TemplateOriginRow { slug; name; creatorName: string | null; status: TemplateListingStatus }`;
    - `PublishedQuery { category?; search?; limit; offset }`.
  - **Templates and versions:**
    - `getTemplate(templateId)`, `getTemplateBySourceApp(appId)` and `isSlugTaken(slug)`;
    - `getVersion(versionId)`, `listVersions(templateId)` (newest first) and `nextVersionNumber(templateId)`;
    - `insertSubmission({ template: NewTemplate | null; version: NewTemplateVersion })`;
    - `listByCreator(userId)`.
  - **Review:**
    - `listPending()` and `getVersionWithTemplate(versionId)`;
    - `approveVersion({ templateId, versionId, supersedeVersionId, reviewerId })`;
    - `rejectVersion(versionId, reviewerId, reason)` and `withdrawVersion(versionId)`;
    - `setListing(templateId, listed)`.
  - **Gallery and use:**
    - `listPublished(query): Promise<{ rows: TemplateWithVersion[]; total: number }>`;
    - `getPublishedBySlug(slug)` and `getPublishedById(templateId)`;
    - `incrementUseCount(templateId)`;
    - `getTemplateOrigin(versionId)`.
  - **Purchases:** `hasPurchase(templateId, userId)` and `recordPurchase({ templateId, userId, priceCents })`.

- [ ] **Step 1: Write the failing tests**

Create `worker/middleware/auth/routeAuth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AuthConfig, checkAdminRole, routeAuthChecks, type AuthRequirement } from './routeAuth';
import type { AuthUser } from '../../types/auth-types';

const env = {} as Env;
const member: AuthUser = { id: 'user-1', email: 'member@example.com' };

function adminRequirement(isAdmin: boolean): AuthRequirement {
	return { required: true, level: 'admin', roleCheck: async () => isAdmin };
}

describe('admin routes', () => {
	it('lets admins through', async () => {
		const result = await routeAuthChecks(member, env, adminRequirement(true));
		expect(result.success).toBe(true);
		expect(result.response).toBeUndefined();
	});

	it('refuses signed-in users who are not admins', async () => {
		const result = await routeAuthChecks(member, env, adminRequirement(false));
		expect(result.success).toBe(false);
		expect(result.response?.status).toBe(403);
	});

	it('asks anonymous visitors to sign in', async () => {
		const result = await routeAuthChecks(null, env, adminRequirement(true));
		expect(result.success).toBe(false);
		expect(result.response?.status).toBe(401);
	});

	it('reads the role from the database for the shared admin config', () => {
		expect(AuthConfig.admin.level).toBe('admin');
		expect(AuthConfig.admin.roleCheck).toBe(checkAdminRole);
	});
});
```

If importing `./routeAuth` fails at module load in the test pool, add this before the import of `./routeAuth`:

```ts
vi.mock('../../database', () => ({ AppService: class {}, UserService: class {} }));
```

Also add `vi` to the `vitest` import. The tests themselves stay unchanged.

Create `worker/services/rate-limit/template-submission-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

describe('template submission limit', () => {
	it('allows five submissions per user per day by default', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.TEMPLATE_SUBMISSION]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 5,
			period: 24 * 60 * 60,
		});
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/middleware/auth/routeAuth.test.ts worker/services/rate-limit/template-submission-limit.test.ts`
Expected: FAIL. `checkAdminRole` is not exported, `AuthConfig.admin` is undefined, and `RateLimitType.TEMPLATE_SUBMISSION` is undefined.

- [ ] **Step 3: Add the admin auth level**

In `worker/middleware/auth/routeAuth.ts`:

1. Change the database import to `import { AppService, UserService } from '../../database';`.
2. Replace the `AuthLevel` type and the `AuthRequirement` interface with:

```ts
export type AuthLevel = 'public' | 'authenticated' | 'owner-only' | 'admin';

/**
 * Authentication requirement configuration
 */
export interface AuthRequirement {
    required: boolean;
    level: AuthLevel;
    resourceOwnershipCheck?: (user: AuthUser, params: Record<string, string>, env: Env) => Promise<boolean>;
    /** Platform role check for admin routes; reads the role on every request. */
    roleCheck?: (user: AuthUser, env: Env) => Promise<boolean>;
}
```

3. In `AuthConfig`, after `ownerOnly`, add:

```ts
    // Require the platform admin role (template review)
    admin: {
        required: true,
        level: 'admin' as const,
        roleCheck: checkAdminRole
    },
```

4. In `routeAuthChecks`, directly before `// Default fallback`, add:

```ts
        // For admin routes
        if (requirement.level === 'admin') {
            if (!user) {
                return {
                    success: false,
                    response: createAuthRequiredResponse()
                };
            }
            const isAdmin = requirement.roleCheck ? await requirement.roleCheck(user, env) : false;
            return {
                success: isAdmin,
                response: isAdmin ? undefined : createForbiddenResponse('Admin access required')
            };
        }
```

5. In `enforceAuthRequirement`, change the authentication condition to:

```ts
    if (!user && (requirement.level === 'authenticated' || requirement.level === 'owner-only' || requirement.level === 'admin')) {
```

6. At the end of the file, add:

```ts

/**
 * Check the platform admin role in D1. Read on every request, so a role
 * change takes effect without a new session.
 */
export async function checkAdminRole(user: AuthUser, env: Env): Promise<boolean> {
    try {
        return (await new UserService(env).getRole(user.id)) === 'admin';
    } catch (error) {
        logger.error('Error checking admin role', error);
        return false;
    }
}
```

`AuthConfig` is declared before `checkAdminRole`. That works because the function declaration is hoisted.

In `worker/database/services/UserService.ts`, add this method inside the class, after `findUser`. Add `import type { UserRole } from '../../../shared/types/templates';` at the top, and make sure `eq` is imported from `drizzle-orm`, as it already is if the file uses it.

```ts
    /** The user's platform role, or null when the user does not exist. */
    async getRole(userId: string): Promise<UserRole | null> {
        const row = await this.database
            .select({ role: schema.users.role })
            .from(schema.users)
            .where(eq(schema.users.id, userId))
            .get();
        return row?.role ?? null;
    }
```

If `UserService.ts` imports the schema under a different name than `schema`, use that name.

- [ ] **Step 4: Add the submission rate limit**

In `worker/services/rate-limit/config.ts`:

- add `TEMPLATE_SUBMISSION = 'templateSubmission',` to `RateLimitType`;
- add `[RateLimitType.TEMPLATE_SUBMISSION]: DORateLimitConfig | KVRateLimitConfig;` to `RateLimitSettings`;
- add to `DEFAULT_RATE_LIMIT_SETTINGS`, after `spacePreview`:

```ts
	// Per-user cap on template submissions; each one snapshots the app's
	// files and captures two screenshots.
	templateSubmission: {
		enabled: true,
		store: RateLimitStore.DURABLE_OBJECT,
		limit: 5,
		period: 24 * 60 * 60,
	},
```

In `worker/services/rate-limit/rateLimits.ts`, add after `enforceAppCreationRateLimit`:

```ts
    /**
     * Per-user cap on template submissions. Throws RateLimitExceededError when
     * the user has submitted too many templates in the last 24 hours.
     */
    static async enforceTemplateSubmissionRateLimit(
        env: Env,
        config: RateLimitSettings,
        user: AuthUser,
    ): Promise<void> {
        const limitConfig = config[RateLimitType.TEMPLATE_SUBMISSION];
        if (!limitConfig?.enabled) {
            return;
        }
        const identifier = await this.getUserIdentifier(user);
        const key = this.buildRateLimitKey(RateLimitType.TEMPLATE_SUBMISSION, identifier);
        const result = await this.enforce(env, key, config, RateLimitType.TEMPLATE_SUBMISSION);
        if (!result.success) {
            throw new RateLimitExceededError(
                `Template submission rate limit exceeded. Maximum ${limitConfig.limit} submissions per day`,
                RateLimitType.TEMPLATE_SUBMISSION,
                limitConfig.limit,
                limitConfig.period,
                ['Please try again tomorrow.'],
            );
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run worker/middleware/auth/routeAuth.test.ts worker/services/rate-limit/template-submission-limit.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Write the template service**

Create `worker/database/services/TemplateService.ts`:

```ts
/**
 * D1 reads and writes for templates, their versions and purchases. Decisions
 * (who may do what, which version is superseded) live in
 * services/templates/catalog.ts; this service only moves rows.
 */

import { and, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import type { TemplateCategory, TemplateListingStatus } from '../../../shared/types/templates';

export interface TemplateWithVersion {
    template: schema.Template;
    version: schema.TemplateVersion;
    creatorName: string | null;
}

export interface PendingVersionRow extends TemplateWithVersion {
    creatorEmail: string | null;
}

export interface CreatorTemplateRow {
    template: schema.Template;
    versions: schema.TemplateVersion[];
}

export interface TemplateOriginRow {
    slug: string;
    name: string;
    creatorName: string | null;
    status: TemplateListingStatus;
}

export interface PublishedQuery {
    category?: TemplateCategory;
    search?: string;
    limit: number;
    offset: number;
}

export class TemplateService extends BaseService {
    async getTemplate(templateId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.id, templateId)).get();
        return row ?? null;
    }

    async getTemplateBySourceApp(appId: string): Promise<schema.Template | null> {
        const row = await this.database.select().from(schema.templates).where(eq(schema.templates.sourceAppId, appId)).get();
        return row ?? null;
    }

    async isSlugTaken(slug: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templates.id })
            .from(schema.templates)
            .where(eq(schema.templates.slug, slug))
            .get();
        return row !== undefined;
    }

    async getVersion(versionId: string): Promise<schema.TemplateVersion | null> {
        const row = await this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /** Versions of a template, newest first. */
    async listVersions(templateId: string): Promise<schema.TemplateVersion[]> {
        return this.database
            .select()
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, templateId))
            .orderBy(desc(schema.templateVersions.version))
            .all();
    }

    async nextVersionNumber(templateId: string): Promise<number> {
        const row = await this.database
            .select({ latest: sql<number | null>`max(${schema.templateVersions.version})` })
            .from(schema.templateVersions)
            .where(eq(schema.templateVersions.templateId, templateId))
            .get();
        return (row?.latest ?? 0) + 1;
    }

    /** Insert a submitted version, and the template itself on its first submission. */
    async insertSubmission(input: {
        template: schema.NewTemplate | null;
        version: schema.NewTemplateVersion;
    }): Promise<void> {
        const insertVersion = this.database.insert(schema.templateVersions).values(input.version);
        if (input.template) {
            await this.database.batch([this.database.insert(schema.templates).values(input.template), insertVersion]);
            return;
        }
        await insertVersion;
    }

    async listByCreator(userId: string): Promise<CreatorTemplateRow[]> {
        const templates = await this.database
            .select()
            .from(schema.templates)
            .where(eq(schema.templates.creatorUserId, userId))
            .orderBy(desc(schema.templates.createdAt))
            .all();
        if (templates.length === 0) return [];
        const versions = await this.database
            .select()
            .from(schema.templateVersions)
            .where(inArray(schema.templateVersions.templateId, templates.map((template) => template.id)))
            .orderBy(desc(schema.templateVersions.version))
            .all();
        return templates.map((template) => ({
            template,
            versions: versions.filter((version) => version.templateId === template.id),
        }));
    }

    /** Versions waiting for review, oldest first. */
    async listPending(): Promise<PendingVersionRow[]> {
        return this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
                creatorEmail: schema.users.email,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.status, 'pending'))
            .orderBy(schema.templateVersions.createdAt)
            .limit(100)
            .all();
    }

    async getVersionWithTemplate(versionId: string): Promise<TemplateWithVersion | null> {
        const row = await this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    /** Publish a version: approve it, supersede the previous one, and list the template. */
    async approveVersion(input: {
        templateId: string;
        versionId: string;
        supersedeVersionId: string | null;
        reviewerId: string;
    }): Promise<void> {
        const now = new Date();
        const approve = this.database
            .update(schema.templateVersions)
            .set({ status: 'approved', reviewedBy: input.reviewerId, reviewedAt: now })
            .where(eq(schema.templateVersions.id, input.versionId));
        const publish = this.database
            .update(schema.templates)
            .set({ currentVersionId: input.versionId, status: 'listed', updatedAt: now })
            .where(eq(schema.templates.id, input.templateId));
        if (input.supersedeVersionId) {
            const supersede = this.database
                .update(schema.templateVersions)
                .set({ status: 'superseded' })
                .where(eq(schema.templateVersions.id, input.supersedeVersionId));
            await this.database.batch([approve, supersede, publish]);
            return;
        }
        await this.database.batch([approve, publish]);
    }

    async rejectVersion(versionId: string, reviewerId: string, reason: string): Promise<void> {
        await this.database
            .update(schema.templateVersions)
            .set({ status: 'rejected', reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')));
    }

    async withdrawVersion(versionId: string): Promise<void> {
        await this.database
            .update(schema.templateVersions)
            .set({ status: 'withdrawn' })
            .where(and(eq(schema.templateVersions.id, versionId), eq(schema.templateVersions.status, 'pending')));
    }

    async setListing(templateId: string, listed: boolean): Promise<void> {
        await this.database
            .update(schema.templates)
            .set({ status: listed ? 'listed' : 'unlisted', updatedAt: new Date() })
            .where(eq(schema.templates.id, templateId));
    }

    /** Listed templates with their current version, most used first. */
    async listPublished(query: PublishedQuery): Promise<{ rows: TemplateWithVersion[]; total: number }> {
        const extra: SQL[] = [];
        if (query.category) extra.push(eq(schema.templates.category, query.category));
        if (query.search) {
            const pattern = `%${query.search}%`;
            const matches = or(like(schema.templates.name, pattern), like(schema.templates.description, pattern));
            if (matches) extra.push(matches);
        }
        const where = this.publishedConditions(extra);
        const readDb = this.getReadDb('fast');
        const rows = await readDb
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templates)
            .innerJoin(schema.templateVersions, eq(schema.templateVersions.id, schema.templates.currentVersionId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(where)
            .orderBy(desc(schema.templates.useCount), desc(schema.templates.updatedAt))
            .limit(query.limit)
            .offset(query.offset)
            .all();
        const totalRow = await readDb
            .select({ count: sql<number>`count(*)` })
            .from(schema.templates)
            .where(where)
            .get();
        return { rows, total: totalRow?.count ?? 0 };
    }

    async getPublishedBySlug(slug: string): Promise<TemplateWithVersion | null> {
        return this.findPublished(eq(schema.templates.slug, slug));
    }

    async getPublishedById(templateId: string): Promise<TemplateWithVersion | null> {
        return this.findPublished(eq(schema.templates.id, templateId));
    }

    async incrementUseCount(templateId: string): Promise<void> {
        await this.database
            .update(schema.templates)
            .set({ useCount: sql`${schema.templates.useCount} + 1` })
            .where(eq(schema.templates.id, templateId));
    }

    /** The template an app started from, for the app page. */
    async getTemplateOrigin(versionId: string): Promise<TemplateOriginRow | null> {
        const row = await this.database
            .select({
                slug: schema.templates.slug,
                name: schema.templates.name,
                creatorName: schema.users.displayName,
                status: schema.templates.status,
            })
            .from(schema.templateVersions)
            .innerJoin(schema.templates, eq(schema.templates.id, schema.templateVersions.templateId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(eq(schema.templateVersions.id, versionId))
            .get();
        return row ?? null;
    }

    async hasPurchase(templateId: string, userId: string): Promise<boolean> {
        const row = await this.database
            .select({ id: schema.templatePurchases.id })
            .from(schema.templatePurchases)
            .where(and(eq(schema.templatePurchases.templateId, templateId), eq(schema.templatePurchases.userId, userId)))
            .get();
        return row !== undefined;
    }

    /** Record a test-mode purchase (no charge). Buying twice keeps the first record. */
    async recordPurchase(input: { templateId: string; userId: string; priceCents: number }): Promise<void> {
        await this.database
            .insert(schema.templatePurchases)
            .values({
                id: generateId(),
                templateId: input.templateId,
                userId: input.userId,
                priceCents: input.priceCents,
                provider: 'test',
                createdAt: new Date(),
            })
            .onConflictDoNothing();
    }

    private publishedConditions(extra: SQL[]): SQL | undefined {
        return and(eq(schema.templates.status, 'listed'), isNotNull(schema.templates.currentVersionId), ...extra);
    }

    private async findPublished(condition: SQL): Promise<TemplateWithVersion | null> {
        const row = await this.database
            .select({
                template: schema.templates,
                version: schema.templateVersions,
                creatorName: schema.users.displayName,
            })
            .from(schema.templates)
            .innerJoin(schema.templateVersions, eq(schema.templateVersions.id, schema.templates.currentVersionId))
            .leftJoin(schema.users, eq(schema.users.id, schema.templates.creatorUserId))
            .where(this.publishedConditions([condition]))
            .get();
        return row ?? null;
    }
}
```

In `worker/database/index.ts`, add after the `AppService` export:

```ts
export { TemplateService } from './services/TemplateService';
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

If drizzle rejects a `batch` tuple type, keep the same statements and order but pass the array typed as a non-empty tuple. Do not change the statements.

- [ ] **Step 8: Commit**

```bash
git add worker/middleware/auth/routeAuth.ts worker/middleware/auth/routeAuth.test.ts worker/database/services/UserService.ts worker/database/services/TemplateService.ts worker/database/index.ts worker/services/rate-limit/config.ts worker/services/rate-limit/rateLimits.ts worker/services/rate-limit/template-submission-limit.test.ts
git commit -m "feat(templates): add the admin auth level, submission limit and template service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Submission orchestration and the agent's template source

**Files:**
- Create: `worker/services/templates/submit.ts`
- Create: `worker/services/templates/store.ts`
- Create: `worker/services/templates/capture.ts`
- Test: `worker/services/templates/submit.test.ts`
- Modify: `worker/agents/core/types.ts`: add `TemplateSource` after the `AgentInitArgs` type.
- Modify: `worker/agents/core/behaviors/base.ts`: add `getTemplateSource` after `getBrowserPreviewURL` (around line 1166).
- Modify: `worker/agents/core/behaviors/think.ts`: add the override after `getBrowserPreviewURL` (around line 409).
- Modify: `worker/agents/core/codingAgent.ts`: add the RPC after `getSummary` (around line 389).
- Modify: `worker/agents/index.ts`: replace `getSpaceGitStub` with a generic resolver and add `getSpaceTemplateStub`.

**Interfaces:**
- Consumes:
  - `TreeFile` and `buildSnapshot` from Task 2;
  - `parseBundle` from Task 2;
  - `DESKTOP_VIEWPORT` and `PHONE_VIEWPORT` from Task 5;
  - `getBrowserCaptureClient(env, logger)` from `worker/services/browser-capture/factory.ts`.
- Produces, in `submit.ts`:
  - **Types:**
    - `ShotDevice = 'desktop' | 'phone'`;
    - `TemplateObjectStore { put(key, body: string | Uint8Array, contentType): Promise<void>; delete(keys: string[]): Promise<void> }`;
    - `SubmissionSource { commit; previewUrl }` and `SubmissionIds { templateId; versionId }`;
    - `SubmissionRecord { templateId; versionId; sourceCommit; snapshotKey; desktopShotKey; mobileShotKey; fileCount; totalBytes }`;
    - `SubmissionDeps { readTree(commit): Promise<TreeFile[]>; captureShot(url, device): Promise<Uint8Array>; store: TemplateObjectStore; recordVersion(record): Promise<void> }`.
  - **Errors:** `TemplateSubmissionError(message, status: 400 | 500)`, plus the message constants `SCREENSHOT_FAILED_MESSAGE`, `READ_FAILED_MESSAGE` and `SAVE_FAILED_MESSAGE`.
  - **Functions:**
    - `templateObjectKeys(ids)`;
    - `submitTemplateVersion(deps, source, ids): Promise<SubmissionRecord>`.
- Produces, in `store.ts`:
  - `r2TemplateStore(bucket: R2Bucket): TemplateObjectStore`;
  - `readTemplateSnapshot(bucket, key): Promise<TreeFile[]>`;
  - `templateImageResponse(bucket, key, cacheControl): Promise<Response | null>`.
- Produces, in `capture.ts`: `createTemplateShotCapturer(env, logger): (url: string, device: ShotDevice) => Promise<Uint8Array>`.
- Produces, in `worker/agents/core/types.ts`: `TemplateSource { commit: string; previewUrl: string }`.
- Produces, on the agent and in `worker/agents/index.ts`:
  - `BaseCodingBehavior.getTemplateSource(): Promise<TemplateSource | null>`, overridden in `ThinkCodingBehavior`;
  - `CodeGeneratorAgent.getTemplateSource()` as an RPC;
  - `SpaceTemplateStub` and `getSpaceTemplateStub(env, agentId): SpaceTemplateStub | null`.

- [ ] **Step 1: Write the failing test**

Create `worker/services/templates/submit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	READ_FAILED_MESSAGE,
	SAVE_FAILED_MESSAGE,
	SCREENSHOT_FAILED_MESSAGE,
	TemplateSubmissionError,
	submitTemplateVersion,
	templateObjectKeys,
	type ShotDevice,
	type SubmissionDeps,
	type SubmissionRecord,
	type TemplateObjectStore,
} from './submit';
import type { TreeFile } from './snapshot';

const encoder = new TextEncoder();
const FILES: TreeFile[] = [{ path: '/index.html', bytes: encoder.encode('<h1>Shop</h1>') }];
const IDS = { templateId: 'tpl1', versionId: 'ver1' };
const SOURCE = { commit: 'abc123', previewUrl: 'https://preview.example/app/?t=x' };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

class MemoryStore implements TemplateObjectStore {
	readonly objects = new Map<string, string | Uint8Array>();

	constructor(private readonly failOnKey?: string) {}

	async put(key: string, body: string | Uint8Array): Promise<void> {
		if (key === this.failOnKey) throw new Error('R2 unavailable');
		this.objects.set(key, body);
	}

	async delete(keys: string[]): Promise<void> {
		for (const key of keys) this.objects.delete(key);
	}
}

function setup(overrides: Partial<SubmissionDeps> = {}) {
	const recorded: SubmissionRecord[] = [];
	const store = overrides.store instanceof MemoryStore ? overrides.store : new MemoryStore();
	const deps: SubmissionDeps = {
		readTree: async () => FILES,
		captureShot: async () => JPEG,
		recordVersion: async (record) => {
			recorded.push(record);
		},
		...overrides,
		store,
	};
	return { deps, recorded, store };
}

describe('submitTemplateVersion', () => {
	it('stores the snapshot and both screenshots, then records the version', async () => {
		const { deps, recorded, store } = setup();
		const record = await submitTemplateVersion(deps, SOURCE, IDS);
		const keys = templateObjectKeys(IDS);

		expect(keys).toEqual({
			snapshotKey: 'templates/tpl1/ver1/files.json',
			desktopShotKey: 'templates/tpl1/ver1/desktop.jpg',
			mobileShotKey: 'templates/tpl1/ver1/mobile.jpg',
		});
		expect(JSON.parse(String(store.objects.get(keys.snapshotKey)))).toEqual({
			files: [{ path: 'index.html', encoding: 'utf8', content: '<h1>Shop</h1>' }],
		});
		expect(store.objects.get(keys.desktopShotKey)).toEqual(JPEG);
		expect(store.objects.get(keys.mobileShotKey)).toEqual(JPEG);
		expect(record).toEqual({ ...IDS, ...keys, sourceCommit: 'abc123', fileCount: 1, totalBytes: 13 });
		expect(recorded).toEqual([record]);
	});

	it('captures the desktop and phone views of the deployed preview', async () => {
		const shots: Array<[string, ShotDevice]> = [];
		const { deps } = setup({
			captureShot: async (url, device) => {
				shots.push([url, device]);
				return JPEG;
			},
		});
		await submitTemplateVersion(deps, SOURCE, IDS);
		expect(shots).toEqual([
			[SOURCE.previewUrl, 'desktop'],
			[SOURCE.previewUrl, 'phone'],
		]);
	});

	it('retries a failed capture once', async () => {
		let calls = 0;
		const { deps } = setup({
			captureShot: async () => {
				calls++;
				if (calls === 1) throw new Error('timeout');
				return JPEG;
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).resolves.toMatchObject({ fileCount: 1 });
		expect(calls).toBe(3);
	});

	it('fails with the capture message and leaves nothing behind when a capture fails twice', async () => {
		const { deps, recorded, store } = setup({
			captureShot: async () => {
				throw new Error('blank page');
			},
		});
		const error = await submitTemplateVersion(deps, SOURCE, IDS).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TemplateSubmissionError);
		expect(error).toMatchObject({ message: SCREENSHOT_FAILED_MESSAGE, status: 400 });
		expect(store.objects.size).toBe(0);
		expect(recorded).toEqual([]);
	});

	it('refuses files that look like secrets before capturing anything', async () => {
		const devices: ShotDevice[] = [];
		const { deps, recorded } = setup({
			readTree: async () => [...FILES, { path: '/src/keys.ts', bytes: encoder.encode('const k = "AKIA' + 'ABCDEFGHIJKLMNOP";') }],
			captureShot: async (_url, device) => {
				devices.push(device);
				return JPEG;
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 400,
			message: 'src/keys.ts looks like it contains a secret key; remove it and redeploy',
		});
		expect(devices).toEqual([]);
		expect(recorded).toEqual([]);
	});

	it('removes stored objects and records nothing when a write fails', async () => {
		const { deps, recorded, store } = setup({ store: new MemoryStore('templates/tpl1/ver1/mobile.jpg') });
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: SAVE_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
		expect(recorded).toEqual([]);
	});

	it('removes stored objects when recording the version fails', async () => {
		const { deps, store } = setup({
			recordVersion: async () => {
				throw new Error('D1 error');
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: SAVE_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
	});

	it('reports a read failure without touching storage', async () => {
		const { deps, store } = setup({
			readTree: async () => {
				throw new Error('missing object');
			},
		});
		await expect(submitTemplateVersion(deps, SOURCE, IDS)).rejects.toMatchObject({
			status: 500,
			message: READ_FAILED_MESSAGE,
		});
		expect(store.objects.size).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/services/templates/submit.test.ts`
Expected: FAIL, with `Failed to resolve import "./submit"`.

- [ ] **Step 3: Write the orchestration**

Create `worker/services/templates/submit.ts`:

```ts
/**
 * Submitting an app as a template: snapshot the deployed commit, capture
 * desktop and phone screenshots, store them in R2, then record the version.
 * Dependencies are injected so the ordering and cleanup rules are tested.
 */

import { buildSnapshot, type TreeFile } from './snapshot';

export type ShotDevice = 'desktop' | 'phone';

export const SCREENSHOT_FAILED_MESSAGE = "Couldn't capture your site; make sure it's deployed and loads";
export const READ_FAILED_MESSAGE = "Couldn't read your app's files; try again";
export const SAVE_FAILED_MESSAGE = "Couldn't save your template; try again";

export interface TemplateObjectStore {
	put(key: string, body: string | Uint8Array, contentType: string): Promise<void>;
	delete(keys: string[]): Promise<void>;
}

export interface SubmissionSource {
	commit: string;
	previewUrl: string;
}

export interface SubmissionIds {
	templateId: string;
	versionId: string;
}

export interface SubmissionRecord extends SubmissionIds {
	sourceCommit: string;
	snapshotKey: string;
	desktopShotKey: string;
	mobileShotKey: string;
	fileCount: number;
	totalBytes: number;
}

export interface SubmissionDeps {
	readTree(commit: string): Promise<TreeFile[]>;
	captureShot(url: string, device: ShotDevice): Promise<Uint8Array>;
	store: TemplateObjectStore;
	recordVersion(record: SubmissionRecord): Promise<void>;
}

export class TemplateSubmissionError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 500,
	) {
		super(message);
		this.name = 'TemplateSubmissionError';
	}
}

export function templateObjectKeys(ids: SubmissionIds) {
	const prefix = `templates/${ids.templateId}/${ids.versionId}`;
	return {
		snapshotKey: `${prefix}/files.json`,
		desktopShotKey: `${prefix}/desktop.jpg`,
		mobileShotKey: `${prefix}/mobile.jpg`,
	};
}

async function captureWithRetry(deps: SubmissionDeps, url: string, device: ShotDevice): Promise<Uint8Array> {
	try {
		return await deps.captureShot(url, device);
	} catch {
		try {
			return await deps.captureShot(url, device);
		} catch {
			throw new TemplateSubmissionError(SCREENSHOT_FAILED_MESSAGE, 400);
		}
	}
}

/**
 * Freeze one version of a template. Nothing is recorded unless every object
 * is stored; on any failure after storing begins, the objects are removed.
 */
export async function submitTemplateVersion(
	deps: SubmissionDeps,
	source: SubmissionSource,
	ids: SubmissionIds,
): Promise<SubmissionRecord> {
	let files: TreeFile[];
	try {
		files = await deps.readTree(source.commit);
	} catch {
		throw new TemplateSubmissionError(READ_FAILED_MESSAGE, 500);
	}

	const snapshot = buildSnapshot(files);
	if (!snapshot.ok) throw new TemplateSubmissionError(snapshot.error, 400);

	const desktop = await captureWithRetry(deps, source.previewUrl, 'desktop');
	const mobile = await captureWithRetry(deps, source.previewUrl, 'phone');

	const keys = templateObjectKeys(ids);
	try {
		await deps.store.put(keys.snapshotKey, JSON.stringify(snapshot.bundle), 'application/json');
		await deps.store.put(keys.desktopShotKey, desktop, 'image/jpeg');
		await deps.store.put(keys.mobileShotKey, mobile, 'image/jpeg');
		const record: SubmissionRecord = {
			...ids,
			...keys,
			sourceCommit: source.commit,
			fileCount: snapshot.fileCount,
			totalBytes: snapshot.totalBytes,
		};
		await deps.recordVersion(record);
		return record;
	} catch {
		await deps.store.delete(Object.values(keys)).catch(() => undefined);
		throw new TemplateSubmissionError(SAVE_FAILED_MESSAGE, 500);
	}
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run worker/services/templates/submit.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Add the R2 store and the capture adapter**

Create `worker/services/templates/store.ts`:

```ts
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
```

Create `worker/services/templates/capture.ts`:

```ts
/** JPEG screenshots of a deployed preview for template submissions. */

import type { StructuredLogger } from '../../logger';
import { DESKTOP_VIEWPORT, PHONE_VIEWPORT } from '../browser-capture/capture-core';
import { getBrowserCaptureClient } from '../browser-capture/factory';
import { base64ToUint8Array } from '../../utils/encoding';
import type { ShotDevice } from './submit';

const TEMPLATE_SHOT_TIMEOUT_MS = 15_000;
const TEMPLATE_SHOT_SETTLE_MS = 2_000;

export function createTemplateShotCapturer(
	env: Env,
	logger: StructuredLogger,
): (url: string, device: ShotDevice) => Promise<Uint8Array> {
	const client = getBrowserCaptureClient(env, logger);
	return async (url, device) =>
		base64ToUint8Array(
			await client.captureScreenshot({
				url,
				viewport: device === 'phone' ? PHONE_VIEWPORT : DESKTOP_VIEWPORT,
				timeoutMs: TEMPLATE_SHOT_TIMEOUT_MS,
				settleMs: TEMPLATE_SHOT_SETTLE_MS,
				format: 'jpeg',
			}),
		);
}
```

- [ ] **Step 6: Expose the template source from the agent**

In `worker/agents/core/types.ts`, add after the `AgentInitArgs` type:

```ts

/** What a template submission needs from an app: its deployed commit and a capturable preview URL. */
export interface TemplateSource {
    commit: string;
    previewUrl: string;
}
```

In `worker/agents/core/behaviors/base.ts`:
- add `TemplateSource` to the import from `'../types'` on line 11;
- add this directly after the `getBrowserPreviewURL` method:

```ts

    /** The deployed commit and preview URL for a template submission; only Think apps provide one. */
    public async getTemplateSource(): Promise<TemplateSource | null> {
        return null;
    }
```

In `worker/agents/core/behaviors/think.ts`:
- change line 5 to `import { AgentInitArgs, DeploymentTarget, TemplateSource } from '../types';`;
- add this directly after the `getBrowserPreviewURL` method:

```ts

	override async getTemplateSource(): Promise<TemplateSource | null> {
		const commit = this.state.lastDeployedCommit;
		if (!commit) return null;
		return { commit, previewUrl: await this.getBrowserPreviewURL() };
	}
```

In `worker/agents/core/codingAgent.ts`:
- change `import { ProjectType } from './types';` to `import { ProjectType, TemplateSource } from './types';`;
- add this directly after `getSummary()`:

```ts

    /** Deployed commit and preview URL for a template submission; null unless a deployed Think app. */
    async getTemplateSource(): Promise<TemplateSource | null> {
        return this.behavior.getTemplateSource();
    }
```

In `worker/agents/index.ts`, replace the `getSpaceGitStub` function (keep its doc comment) with:

```ts
export function getSpaceGitStub(env: Env, agentId: string): SpaceGitExportStub | null {
    return getSpaceStub<SpaceGitExportStub>(env, agentId);
}

/** Read access to a think app's committed files, for template submissions. */
export interface SpaceTemplateStub extends DurableObjectStub {
    readTreeAtCommit(commit: string): Promise<Array<{ path: string; bytes: Uint8Array }>>;
}

export function getSpaceTemplateStub(env: Env, agentId: string): SpaceTemplateStub | null {
    return getSpaceStub<SpaceTemplateStub>(env, agentId);
}

/** The SpaceDO for an app; the instance is always keyed by the agent id. */
function getSpaceStub<T extends DurableObjectStub>(env: Env, agentId: string): T | null {
    const ns = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
    if (!ns) return null;
    return ns.get(ns.idFromName(agentId)) as unknown as T;
}
```

- [ ] **Step 7: Typecheck and run the templates tests**

Run: `npm run typecheck && npx vitest run worker/services/templates`
Expected: no type errors; all template service tests pass.

- [ ] **Step 8: Commit**

```bash
git add worker/services/templates/submit.ts worker/services/templates/submit.test.ts worker/services/templates/store.ts worker/services/templates/capture.ts worker/agents/core/types.ts worker/agents/core/behaviors/base.ts worker/agents/core/behaviors/think.ts worker/agents/core/codingAgent.ts worker/agents/index.ts
git commit -m "feat(templates): snapshot, capture and store a submitted template version

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Template API for creators, the gallery and purchases

**Files:**
- Create: `worker/api/controllers/templates/types.ts`
- Create: `worker/api/controllers/templates/templateDto.ts`
- Create: `worker/services/templates/fixtures.ts` (test fixtures, imported only by tests)
- Test: `worker/api/controllers/templates/templateDto.test.ts`
- Create: `worker/api/controllers/templates/controller.ts`
- Create: `worker/api/routes/templateRoutes.ts`
- Modify: `worker/api/routes/index.ts`

**Interfaces:**
- Consumes:
  - Task 3 catalog functions;
  - Task 6 `TemplateService`, `UserService.getRole` and `RateLimitService.enforceTemplateSubmissionRateLimit`;
  - Task 7 `submitTemplateVersion`, `TemplateSubmissionError`, `r2TemplateStore`, `templateImageResponse`, `createTemplateShotCapturer`, `getSpaceTemplateStub` and `CodeGeneratorAgent.getTemplateSource`.
- Produces API types in `types.ts`, all re-exported to the frontend in Task 11:
  - **Gallery:**
    - `PublicTemplateCard` and `PublicTemplateDetail`;
    - `TemplateViewerAccess { isCreator; purchased; canUse }`;
    - `TemplateGalleryParams`, `TemplateGalleryData`, `TemplateDetailData { template; viewer }` and `TemplatePurchaseData`.
  - **Creator:**
    - `TemplateOrigin`;
    - `CreatorTemplateVersion` and `CreatorTemplate`;
    - `AppTemplateData`, `MyTemplatesData`, `SubmitTemplateRequest` and `SubmitTemplateData`;
    - `TemplateVersionActionData`, `TemplateListingRequest` and `TemplateListingData`.
  - **Admin:**
    - `PendingTemplateVersion` and `PendingTemplateVersionsData`;
    - `TemplateVersionFilesData` and `TemplateVersionFileData`;
    - `RejectTemplateRequest`.
- Produces DTO functions:
  - `toPublicTemplateCard`, `toPublicTemplateDetail` and `toCreatorTemplate(template, versions)`;
  - `toPendingTemplateVersion` and `toTemplateOrigin`;
  - `templateScreenshotUrl(templateId, versionId, kind)` and `reviewScreenshotUrl(versionId, kind)`.
- Produces routes:
  - `GET /api/apps/:id/template` (owner) and `POST /api/apps/:id/template-submissions` (owner);
  - `GET /api/templates/mine`;
  - `POST /api/templates/:id/versions/:versionId/withdraw`;
  - `PUT /api/templates/:id/listing`;
  - `POST /api/templates/:id/purchases`;
  - `GET /api/templates`, `GET /api/templates/:slug` and `GET /api/templates/:id/screenshots/:kind` (public).
- Produces: `setupTemplateRoutes(app: Hono<AppEnv>)`.

- [ ] **Step 1: Add the API types**

Create `worker/api/controllers/templates/types.ts`:

```typescript
/**
 * API types for templates: the public gallery, creators, purchases and
 * admin review.
 */

import type {
    TemplateCategory,
    TemplateListingStatus,
    TemplateVersionStatus,
} from '../../../../shared/types/templates';

export interface PublicTemplateCard {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    creatorName: string;
    useCount: number;
    publishedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PublicTemplateDetail extends PublicTemplateCard {
    version: number;
    fileCount: number;
}

/** What the current viewer may do with a template. */
export interface TemplateViewerAccess {
    isCreator: boolean;
    purchased: boolean;
    canUse: boolean;
}

export interface TemplateGalleryParams {
    page?: number;
    limit?: number;
    category?: TemplateCategory;
    search?: string;
}

export interface TemplateGalleryData {
    templates: PublicTemplateCard[];
    total: number;
    page: number;
    hasMore: boolean;
}

export interface TemplateDetailData {
    template: PublicTemplateDetail;
    viewer: TemplateViewerAccess;
}

export interface TemplatePurchaseData {
    templateId: string;
    purchased: true;
    testMode: true;
}

/** The template an app started from, shown on the app page. */
export interface TemplateOrigin {
    slug: string;
    name: string;
    creatorName: string;
    listed: boolean;
}

export interface CreatorTemplateVersion {
    id: string;
    version: number;
    status: TemplateVersionStatus;
    rejectionReason: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
}

export interface CreatorTemplate {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    status: TemplateListingStatus;
    useCount: number;
    currentVersionId: string | null;
    /** Newest first. */
    versions: CreatorTemplateVersion[];
}

export interface AppTemplateData {
    eligible: boolean;
    reason: string | null;
    template: CreatorTemplate | null;
}

export interface MyTemplatesData {
    templates: CreatorTemplate[];
}

export interface SubmitTemplateRequest {
    name?: string;
    description?: string;
    category?: TemplateCategory;
    priceCents?: number;
    rightsConfirmed: boolean;
}

export interface SubmitTemplateData {
    templateId: string;
    versionId: string;
    version: number;
}

export interface TemplateVersionActionData {
    versionId: string;
    status: TemplateVersionStatus;
}

export interface TemplateListingRequest {
    listed: boolean;
}

export interface TemplateListingData {
    templateId: string;
    status: TemplateListingStatus;
}

export interface PendingTemplateVersion {
    versionId: string;
    version: number;
    templateId: string;
    templateName: string;
    templateSlug: string;
    description: string;
    category: TemplateCategory;
    priceCents: number;
    fileCount: number;
    totalBytes: number;
    creatorName: string;
    creatorEmail: string | null;
    sourceAppId: string | null;
    submittedAt: string | null;
    desktopShotUrl: string;
    mobileShotUrl: string;
}

export interface PendingTemplateVersionsData {
    versions: PendingTemplateVersion[];
}

export interface TemplateVersionFilesData {
    files: Array<{ path: string; bytes: number }>;
}

export interface TemplateVersionFileData {
    path: string;
    bytes: number;
    binary: boolean;
    content: string | null;
}

export interface RejectTemplateRequest {
    reason: string;
}
```

- [ ] **Step 2: Write the failing DTO test**

Create `worker/services/templates/fixtures.ts`:

```typescript
/** Row fixtures for template tests. */

import type { Template, TemplateVersion } from '../../database/schema';
import type { TemplateWithVersion } from '../../database/services/TemplateService';

export function makeTemplate(overrides: Partial<Template> = {}): Template {
	return {
		id: 'tpl1',
		slug: 'fernwood-socks',
		creatorUserId: 'creator-private-id',
		sourceAppId: 'app-private-id',
		name: 'Fernwood Socks',
		description: 'A cozy merino sock store.',
		category: 'store',
		currentVersionId: 'ver2',
		status: 'listed',
		priceCents: 2900,
		useCount: 7,
		createdAt: new Date('2026-10-01T00:00:00Z'),
		updatedAt: new Date('2026-10-02T00:00:00Z'),
		...overrides,
	};
}

export function makeVersion(overrides: Partial<TemplateVersion> = {}): TemplateVersion {
	return {
		id: 'ver2',
		templateId: 'tpl1',
		version: 2,
		sourceCommit: 'deadbeefcafe',
		snapshotKey: 'templates/tpl1/ver2/files.json',
		fileCount: 12,
		totalBytes: 34567,
		desktopShotKey: 'templates/tpl1/ver2/desktop.jpg',
		mobileShotKey: 'templates/tpl1/ver2/mobile.jpg',
		status: 'approved',
		rightsConfirmedAt: new Date('2026-10-02T00:00:00Z'),
		reviewedBy: 'admin-private-id',
		reviewedAt: new Date('2026-10-03T00:00:00Z'),
		rejectionReason: null,
		createdAt: new Date('2026-10-02T00:00:00Z'),
		...overrides,
	};
}

export function makeTemplateRow(
	template: Partial<Template> = {},
	version: Partial<TemplateVersion> = {},
	creatorName: string | null = 'Andres',
): TemplateWithVersion {
	return { template: makeTemplate(template), version: makeVersion(version), creatorName };
}
```

Create `worker/api/controllers/templates/templateDto.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { makeTemplate, makeTemplateRow, makeVersion } from '../../../services/templates/fixtures';
import {
    toCreatorTemplate,
    toPendingTemplateVersion,
    toPublicTemplateCard,
    toPublicTemplateDetail,
    toTemplateOrigin,
} from './templateDto';

describe('public template DTOs', () => {
    it('projects only gallery fields', () => {
        expect(toPublicTemplateCard(makeTemplateRow())).toEqual({
            id: 'tpl1',
            slug: 'fernwood-socks',
            name: 'Fernwood Socks',
            description: 'A cozy merino sock store.',
            category: 'store',
            priceCents: 2900,
            creatorName: 'Andres',
            useCount: 7,
            publishedAt: '2026-10-03T00:00:00.000Z',
            desktopShotUrl: '/api/templates/tpl1/screenshots/desktop?v=ver2',
            mobileShotUrl: '/api/templates/tpl1/screenshots/mobile?v=ver2',
        });
    });

    it('never exposes private ids, emails, commits or storage keys', () => {
        const json = JSON.stringify(toPublicTemplateDetail(makeTemplateRow()));
        for (const secret of ['creator-private-id', 'app-private-id', 'admin-private-id', 'deadbeefcafe', 'files.json', 'desktop.jpg']) {
            expect(json).not.toContain(secret);
        }
    });

    it('adds the version and file count on the detail page', () => {
        expect(toPublicTemplateDetail(makeTemplateRow())).toMatchObject({ version: 2, fileCount: 12 });
    });

    it('names an unknown creator', () => {
        expect(toPublicTemplateCard(makeTemplateRow({}, {}, null)).creatorName).toBe('Unknown');
    });
});

describe('creator and review DTOs', () => {
    it('lists a creator template with its newest version first', () => {
        const view = toCreatorTemplate(makeTemplate(), [
            makeVersion({ id: 'ver1', version: 1, status: 'superseded' }),
            makeVersion({ id: 'ver3', version: 3, status: 'pending', reviewedAt: null }),
            makeVersion(),
        ]);
        expect(view.versions.map((version) => version.id)).toEqual(['ver3', 'ver2', 'ver1']);
        expect(view.versions[0]).toEqual({
            id: 'ver3',
            version: 3,
            status: 'pending',
            rejectionReason: null,
            submittedAt: '2026-10-02T00:00:00.000Z',
            reviewedAt: null,
        });
        expect(view).toMatchObject({ priceCents: 2900, status: 'listed', currentVersionId: 'ver2' });
    });

    it('gives reviewers the creator, source app and review screenshots', () => {
        const pending = toPendingTemplateVersion({
            ...makeTemplateRow({}, { id: 'ver3', version: 3, status: 'pending' }),
            creatorEmail: 'creator@example.com',
        });
        expect(pending).toMatchObject({
            versionId: 'ver3',
            version: 3,
            templateId: 'tpl1',
            creatorEmail: 'creator@example.com',
            sourceAppId: 'app-private-id',
            desktopShotUrl: '/api/admin/template-versions/ver3/screenshots/desktop',
            mobileShotUrl: '/api/admin/template-versions/ver3/screenshots/mobile',
        });
    });

    it('describes where an app came from', () => {
        expect(toTemplateOrigin({ slug: 'fernwood-socks', name: 'Fernwood Socks', creatorName: null, status: 'unlisted' })).toEqual({
            slug: 'fernwood-socks',
            name: 'Fernwood Socks',
            creatorName: 'Unknown',
            listed: false,
        });
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run worker/api/controllers/templates/templateDto.test.ts`
Expected: FAIL, with `Failed to resolve import "./templateDto"`.

- [ ] **Step 4: Write the DTOs**

Create `worker/api/controllers/templates/templateDto.ts`:

```typescript
/**
 * Response projections for template endpoints. The single source of truth
 * for which template fields leave the worker; any new public field is added
 * here explicitly.
 */

import type { TemplateShotKind } from '../../../../shared/types/templates';
import type { Template, TemplateVersion } from '../../../database/schema';
import type {
    PendingVersionRow,
    TemplateOriginRow,
    TemplateWithVersion,
} from '../../../database/services/TemplateService';
import type {
    CreatorTemplate,
    PendingTemplateVersion,
    PublicTemplateCard,
    PublicTemplateDetail,
    TemplateOrigin,
} from './types';

const UNKNOWN_CREATOR = 'Unknown';

function isoDate(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

/** Public screenshot of a template's current version; the version id busts caches on a new version. */
export function templateScreenshotUrl(templateId: string, versionId: string, kind: TemplateShotKind): string {
    return `/api/templates/${templateId}/screenshots/${kind}?v=${versionId}`;
}

export function reviewScreenshotUrl(versionId: string, kind: TemplateShotKind): string {
    return `/api/admin/template-versions/${versionId}/screenshots/${kind}`;
}

export function toPublicTemplateCard(row: TemplateWithVersion): PublicTemplateCard {
    return {
        id: row.template.id,
        slug: row.template.slug,
        name: row.template.name,
        description: row.template.description,
        category: row.template.category,
        priceCents: row.template.priceCents,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        useCount: row.template.useCount,
        publishedAt: isoDate(row.version.reviewedAt),
        desktopShotUrl: templateScreenshotUrl(row.template.id, row.version.id, 'desktop'),
        mobileShotUrl: templateScreenshotUrl(row.template.id, row.version.id, 'mobile'),
    };
}

export function toPublicTemplateDetail(row: TemplateWithVersion): PublicTemplateDetail {
    return {
        ...toPublicTemplateCard(row),
        version: row.version.version,
        fileCount: row.version.fileCount,
    };
}

export function toCreatorTemplate(template: Template, versions: TemplateVersion[]): CreatorTemplate {
    return {
        id: template.id,
        slug: template.slug,
        name: template.name,
        description: template.description,
        category: template.category,
        priceCents: template.priceCents,
        status: template.status,
        useCount: template.useCount,
        currentVersionId: template.currentVersionId,
        versions: [...versions]
            .sort((a, b) => b.version - a.version)
            .map((version) => ({
                id: version.id,
                version: version.version,
                status: version.status,
                rejectionReason: version.rejectionReason,
                submittedAt: isoDate(version.createdAt),
                reviewedAt: isoDate(version.reviewedAt),
            })),
    };
}

export function toPendingTemplateVersion(row: PendingVersionRow): PendingTemplateVersion {
    return {
        versionId: row.version.id,
        version: row.version.version,
        templateId: row.template.id,
        templateName: row.template.name,
        templateSlug: row.template.slug,
        description: row.template.description,
        category: row.template.category,
        priceCents: row.template.priceCents,
        fileCount: row.version.fileCount,
        totalBytes: row.version.totalBytes,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        creatorEmail: row.creatorEmail,
        sourceAppId: row.template.sourceAppId,
        submittedAt: isoDate(row.version.createdAt),
        desktopShotUrl: reviewScreenshotUrl(row.version.id, 'desktop'),
        mobileShotUrl: reviewScreenshotUrl(row.version.id, 'mobile'),
    };
}

export function toTemplateOrigin(row: TemplateOriginRow): TemplateOrigin {
    return {
        slug: row.slug,
        name: row.name,
        creatorName: row.creatorName ?? UNKNOWN_CREATOR,
        listed: row.status === 'listed',
    };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run worker/api/controllers/templates/templateDto.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Write the controller**

Create `worker/api/controllers/templates/controller.ts`:

```typescript
/**
 * Template endpoints for creators (submit, withdraw, unlist), buyers and the
 * public gallery. Review endpoints live in adminController.ts.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { TemplateService, UserService } from '../../../database';
import type { NewTemplate } from '../../../database/schema';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { getAgentStub, getSpaceTemplateStub } from '../../../agents';
import type { TemplateSource } from '../../../agents/core/types';
import { generateId } from '../../../utils/idGenerator';
import {
    NOT_DEPLOYED_REASON,
    TEMPLATE_UNAVAILABLE_MESSAGE,
    VERSION_IN_REVIEW_ERROR,
    canSubmitNewVersion,
    canUseTemplate,
    canWithdraw,
    eligibilityReason,
    isTemplateShotKind,
    isTemplateSlug,
    listingDecision,
    parseListingRequest,
    parseRightsConfirmation,
    parseTemplateMetadata,
    purchaseDecision,
    uniqueTemplateSlug,
    type TemplateMetadata,
} from '../../../services/templates/catalog';
import { READ_FAILED_MESSAGE, TemplateSubmissionError, submitTemplateVersion } from '../../../services/templates/submit';
import { r2TemplateStore, templateImageResponse } from '../../../services/templates/store';
import { createTemplateShotCapturer } from '../../../services/templates/capture';
import { parseGalleryQuery } from './galleryQuery';
import { toCreatorTemplate, toPublicTemplateCard, toPublicTemplateDetail } from './templateDto';
import type {
    AppTemplateData,
    MyTemplatesData,
    SubmitTemplateData,
    SubmitTemplateRequest,
    TemplateDetailData,
    TemplateGalleryData,
    TemplateListingData,
    TemplateListingRequest,
    TemplatePurchaseData,
    TemplateVersionActionData,
} from './types';

const PUBLIC_SCREENSHOT_CACHE = 'public, max-age=3600';

export class TemplatesController extends BaseController {
    static logger = createLogger('TemplatesController');

    /** Submission status and eligibility for one of the owner's apps. */
    static async getAppTemplate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<AppTemplateData>>> {
        try {
            const appId = context.pathParams.id;
            const templates = new TemplateService(env);
            const [source, template] = await Promise.all([
                TemplatesController.loadTemplateSource(env, appId),
                templates.getTemplateBySourceApp(appId),
            ]);
            const view = template ? toCreatorTemplate(template, await templates.listVersions(template.id)) : null;
            return TemplatesController.createSuccessResponse<AppTemplateData>({
                eligible: source.source !== null,
                reason: source.reason,
                template: view,
            });
        } catch (error) {
            this.logger.error('Error loading app template', error);
            return TemplatesController.createErrorResponse<AppTemplateData>('Failed to load template status', 500);
        }
    }

    /** Freeze the app's deployed commit as a new pending version. */
    static async submitTemplate(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SubmitTemplateData>>> {
        try {
            const user = context.user!;
            const appId = context.pathParams.id;
            const bodyResult = await TemplatesController.parseJsonBody<SubmitTemplateRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<SubmitTemplateData>>;
            }
            const rights = parseRightsConfirmation(bodyResult.data);
            if (!rights.ok) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(rights.error, 400);
            }

            const templates = new TemplateService(env);
            const existing = await templates.getTemplateBySourceApp(appId);
            let metadata: TemplateMetadata | null = null;
            if (existing) {
                const versions = await templates.listVersions(existing.id);
                if (!canSubmitNewVersion(versions.map((version) => version.status))) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(VERSION_IN_REVIEW_ERROR, 409);
                }
            } else {
                const parsed = parseTemplateMetadata(bodyResult.data);
                if (!parsed.ok) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(parsed.error, 400);
                }
                metadata = parsed.value;
            }

            const { source, reason } = await TemplatesController.loadTemplateSource(env, appId);
            if (!source) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(reason ?? NOT_DEPLOYED_REASON, 400);
            }

            try {
                await RateLimitService.enforceTemplateSubmissionRateLimit(env, context.config.security.rateLimit, user);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return TemplatesController.createErrorResponse<SubmitTemplateData>(error, 429);
                }
                throw error;
            }

            const space = getSpaceTemplateStub(env, appId);
            if (!space) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(READ_FAILED_MESSAGE, 500);
            }

            const ids = { templateId: existing?.id ?? generateId(), versionId: generateId() };
            const version = existing ? await templates.nextVersionNumber(existing.id) : 1;
            const now = new Date();
            const newTemplate: NewTemplate | null = metadata
                ? {
                      id: ids.templateId,
                      slug: await uniqueTemplateSlug(metadata.name, (candidate) => templates.isSlugTaken(candidate)),
                      creatorUserId: user.id,
                      sourceAppId: appId,
                      name: metadata.name,
                      description: metadata.description,
                      category: metadata.category,
                      priceCents: metadata.priceCents,
                      createdAt: now,
                      updatedAt: now,
                  }
                : null;

            const record = await submitTemplateVersion(
                {
                    readTree: (commit) => space.readTreeAtCommit(commit),
                    captureShot: createTemplateShotCapturer(env, TemplatesController.logger),
                    store: r2TemplateStore(env.TEMPLATES_BUCKET),
                    recordVersion: (submission) =>
                        templates.insertSubmission({
                            template: newTemplate,
                            version: {
                                id: submission.versionId,
                                templateId: submission.templateId,
                                version,
                                sourceCommit: submission.sourceCommit,
                                snapshotKey: submission.snapshotKey,
                                fileCount: submission.fileCount,
                                totalBytes: submission.totalBytes,
                                desktopShotKey: submission.desktopShotKey,
                                mobileShotKey: submission.mobileShotKey,
                                status: 'pending',
                                rightsConfirmedAt: now,
                                createdAt: now,
                            },
                        }),
                },
                source,
                ids,
            );

            return TemplatesController.createSuccessResponse<SubmitTemplateData>({
                templateId: record.templateId,
                versionId: record.versionId,
                version,
            });
        } catch (error) {
            if (error instanceof TemplateSubmissionError) {
                return TemplatesController.createErrorResponse<SubmitTemplateData>(error.message, error.status);
            }
            this.logger.error('Error submitting template', error);
            return TemplatesController.createErrorResponse<SubmitTemplateData>('Failed to submit template', 500);
        }
    }

    static async withdrawVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const user = context.user!;
            const { id: templateId, versionId } = context.pathParams;
            const templates = new TemplateService(env);
            const [template, version] = await Promise.all([
                templates.getTemplate(templateId),
                templates.getVersion(versionId),
            ]);
            if (!template || !version || version.templateId !== template.id) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (template.creatorUserId !== user.id) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('You can only change your own templates', 403);
            }
            if (!canWithdraw(version.status)) {
                return TemplatesController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be withdrawn', 400);
            }
            await templates.withdrawVersion(versionId);
            return TemplatesController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'withdrawn' });
        } catch (error) {
            this.logger.error('Error withdrawing template version', error);
            return TemplatesController.createErrorResponse<TemplateVersionActionData>('Failed to withdraw the version', 500);
        }
    }

    static async setListing(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateListingData>>> {
        try {
            const user = context.user!;
            const templateId = context.pathParams.id;
            const bodyResult = await TemplatesController.parseJsonBody<TemplateListingRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<TemplateListingData>>;
            }
            const listed = parseListingRequest(bodyResult.data);
            if (!listed.ok) {
                return TemplatesController.createErrorResponse<TemplateListingData>(listed.error, 400);
            }

            const templates = new TemplateService(env);
            const template = await templates.getTemplate(templateId);
            if (!template) {
                return TemplatesController.createErrorResponse<TemplateListingData>('Template not found', 404);
            }
            const isAdmin = (await new UserService(env).getRole(user.id)) === 'admin';
            const decision = listingDecision({
                isAdmin,
                isCreator: template.creatorUserId === user.id,
                listed: listed.value,
                hasApprovedVersion: template.currentVersionId !== null,
            });
            if (!decision.ok) {
                return TemplatesController.createErrorResponse<TemplateListingData>(decision.error, decision.status);
            }
            await templates.setListing(templateId, listed.value);
            return TemplatesController.createSuccessResponse<TemplateListingData>({
                templateId,
                status: listed.value ? 'listed' : 'unlisted',
            });
        } catch (error) {
            this.logger.error('Error changing template listing', error);
            return TemplatesController.createErrorResponse<TemplateListingData>('Failed to change the listing', 500);
        }
    }

    static async getMyTemplates(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyTemplatesData>>> {
        try {
            const rows = await new TemplateService(env).listByCreator(context.user!.id);
            return TemplatesController.createSuccessResponse<MyTemplatesData>({
                templates: rows.map((row) => toCreatorTemplate(row.template, row.versions)),
            });
        } catch (error) {
            this.logger.error('Error loading creator templates', error);
            return TemplatesController.createErrorResponse<MyTemplatesData>('Failed to load your templates', 500);
        }
    }

    static async listTemplates(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateGalleryData>>> {
        try {
            if (await TemplatesController.isPublicRateLimited(request, env, context)) {
                return TemplatesController.createErrorResponse<TemplateGalleryData>('Too many requests', 429);
            }
            const parsed = parseGalleryQuery(new URL(request.url).searchParams);
            if (!parsed.ok) {
                return TemplatesController.createErrorResponse<TemplateGalleryData>(parsed.error, 400);
            }
            const { rows, total } = await new TemplateService(env).listPublished(parsed.value);
            return TemplatesController.createSuccessResponse<TemplateGalleryData>({
                templates: rows.map(toPublicTemplateCard),
                total,
                page: parsed.value.page,
                hasMore: parsed.value.offset + rows.length < total,
            });
        } catch (error) {
            this.logger.error('Error listing templates', error);
            return TemplatesController.createErrorResponse<TemplateGalleryData>('Failed to load templates', 500);
        }
    }

    static async getTemplate(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateDetailData>>> {
        try {
            if (await TemplatesController.isPublicRateLimited(request, env, context)) {
                return TemplatesController.createErrorResponse<TemplateDetailData>('Too many requests', 429);
            }
            const slug = context.pathParams.slug;
            if (!slug || !isTemplateSlug(slug)) {
                return TemplatesController.createErrorResponse<TemplateDetailData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const templates = new TemplateService(env);
            const row = await templates.getPublishedBySlug(slug);
            if (!row) {
                return TemplatesController.createErrorResponse<TemplateDetailData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const user = await TemplatesController.getOptionalUser(request, env);
            const isCreator = !!user && user.id === row.template.creatorUserId;
            const purchased =
                !!user && !isCreator && row.template.priceCents > 0
                    ? await templates.hasPurchase(row.template.id, user.id)
                    : false;
            return TemplatesController.createSuccessResponse<TemplateDetailData>({
                template: toPublicTemplateDetail(row),
                viewer: {
                    isCreator,
                    purchased,
                    canUse: canUseTemplate({ priceCents: row.template.priceCents, isCreator, hasPurchase: purchased }),
                },
            });
        } catch (error) {
            this.logger.error('Error loading template', error);
            return TemplatesController.createErrorResponse<TemplateDetailData>('Failed to load the template', 500);
        }
    }

    /** Screenshot of a listed template's current version. */
    static async serveScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { id: templateId, kind } = context.pathParams;
            if (!templateId || !kind || !isTemplateShotKind(kind)) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            const row = await new TemplateService(env).getPublishedById(templateId);
            if (!row) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            const key = kind === 'desktop' ? row.version.desktopShotKey : row.version.mobileShotKey;
            const image = await templateImageResponse(env.TEMPLATES_BUCKET, key, PUBLIC_SCREENSHOT_CACHE);
            if (!image) {
                return TemplatesController.createErrorResponse('Screenshot not found', 404);
            }
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving template screenshot', error);
            return TemplatesController.createErrorResponse('Internal server error', 500);
        }
    }

    /** Record a test-mode purchase (no charge) of a paid template. */
    static async purchaseTemplate(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplatePurchaseData>>> {
        try {
            const user = context.user!;
            const templateId = context.pathParams.id;
            const templates = new TemplateService(env);
            const row = await templates.getPublishedById(templateId);
            if (!row) {
                return TemplatesController.createErrorResponse<TemplatePurchaseData>(TEMPLATE_UNAVAILABLE_MESSAGE, 404);
            }
            const isCreator = row.template.creatorUserId === user.id;
            const hasPurchase = await templates.hasPurchase(templateId, user.id);
            const decision = purchaseDecision({ priceCents: row.template.priceCents, isCreator, hasPurchase });
            if (!decision.ok) {
                return TemplatesController.createErrorResponse<TemplatePurchaseData>(decision.error, decision.status);
            }
            if (!decision.alreadyOwned) {
                await templates.recordPurchase({ templateId, userId: user.id, priceCents: row.template.priceCents });
            }
            return TemplatesController.createSuccessResponse<TemplatePurchaseData>({
                templateId,
                purchased: true,
                testMode: true,
            });
        } catch (error) {
            this.logger.error('Error purchasing template', error);
            return TemplatesController.createErrorResponse<TemplatePurchaseData>('Failed to buy the template', 500);
        }
    }

    /** The deployed commit and preview URL of an app, or why it cannot be submitted. */
    private static async loadTemplateSource(
        env: Env,
        appId: string,
    ): Promise<{ source: TemplateSource | null; reason: string | null }> {
        const agent = await getAgentStub(env, appId);
        const behaviorType = await agent.getBehaviorType();
        const source = behaviorType === 'think' ? await agent.getTemplateSource() : null;
        return { source, reason: eligibilityReason(behaviorType, source !== null) };
    }

    private static async isPublicRateLimited(request: Request, env: Env, context: RouteContext): Promise<boolean> {
        const user = await TemplatesController.getOptionalUser(request, env);
        try {
            await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, user, request);
            return false;
        } catch (error) {
            if (error instanceof RateLimitExceededError) return true;
            throw error;
        }
    }
}
```

- [ ] **Step 7: Register the routes**

Create `worker/api/routes/templateRoutes.ts`:

```typescript
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { TemplatesController } from '../controllers/templates/controller';

/**
 * Template routes: creator actions on an app, the public gallery and purchases.
 * `/api/templates/mine` is registered before `/api/templates/:slug`.
 */
export function setupTemplateRoutes(app: Hono<AppEnv>): void {
    // Creator actions on one of their apps
    app.get('/api/apps/:id/template', setAuthLevel(AuthConfig.ownerOnly), adaptController(TemplatesController, TemplatesController.getAppTemplate));
    app.post('/api/apps/:id/template-submissions', setAuthLevel(AuthConfig.ownerOnly), adaptController(TemplatesController, TemplatesController.submitTemplate));

    // Creator and buyer actions on a template
    app.get('/api/templates/mine', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.getMyTemplates));
    app.post('/api/templates/:id/versions/:versionId/withdraw', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.withdrawVersion));
    app.put('/api/templates/:id/listing', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.setListing));
    app.post('/api/templates/:id/purchases', setAuthLevel(AuthConfig.authenticated), adaptController(TemplatesController, TemplatesController.purchaseTemplate));

    // Public gallery
    app.get('/api/templates', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.listTemplates));
    app.get('/api/templates/:id/screenshots/:kind', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.serveScreenshot));
    app.get('/api/templates/:slug', setAuthLevel(AuthConfig.public), adaptController(TemplatesController, TemplatesController.getTemplate));
}
```

In `worker/api/routes/index.ts`:
- add `import { setupTemplateRoutes } from './templateRoutes';` after the `setupAppRoutes` import;
- immediately before the `// App management routes` comment, add:

```typescript
    // Template routes (registered before the /api/apps router so /api/apps/:id/template resolves here)
    setupTemplateRoutes(app);

```

- [ ] **Step 8: Typecheck and run the template tests**

Run: `npm run typecheck && npx vitest run worker/api/controllers/templates worker/services/templates`
Expected: no type errors; all tests pass.

- [ ] **Step 9: Commit**

```bash
git add worker/api/controllers/templates/types.ts worker/api/controllers/templates/templateDto.ts worker/api/controllers/templates/templateDto.test.ts worker/services/templates/fixtures.ts worker/api/controllers/templates/controller.ts worker/api/routes/templateRoutes.ts worker/api/routes/index.ts
git commit -m "feat(templates): add creator, purchase and gallery endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin review endpoints and the app's template origin

**Files:**
- Create: `worker/api/controllers/templates/adminController.ts`
- Modify: `worker/api/routes/templateRoutes.ts`
- Modify: `worker/api/controllers/appView/types.ts` (add `fromTemplate` to `AppDetailsData`)
- Modify: `worker/api/controllers/appView/controller.ts` (fill `fromTemplate`)
- Test: `worker/api/controllers/templates/admin-routes-wiring.test.ts`

**Interfaces:**
- Consumes:
  - from Task 3: `canReview`, `parseRejectionReason`, `supersededVersionId` and `isTemplateShotKind`;
  - from Task 6: `TemplateService.listPending`, `getVersionWithTemplate`, `getVersion`, `approveVersion`, `rejectVersion` and `getTemplateOrigin`;
  - from Task 7: `readTemplateSnapshot` and `templateImageResponse`;
  - from Task 2: `decodeText`;
  - from Task 8: `toPendingTemplateVersion` and `toTemplateOrigin`.
- Produces routes, all `AuthConfig.admin`:
  - `GET /api/admin/templates/pending`;
  - `GET /api/admin/template-versions/:id/files`;
  - `GET /api/admin/template-versions/:id/file?path=`;
  - `GET /api/admin/template-versions/:id/screenshots/:kind`;
  - `POST /api/admin/template-versions/:id/approve`;
  - `POST /api/admin/template-versions/:id/reject`.
- Produces: `AppDetailsData.fromTemplate: TemplateOrigin | null`.

- [ ] **Step 1: Write the failing wiring test**

Route files are excluded from Vitest, so this test reads them as text. Create `worker/api/controllers/templates/admin-routes-wiring.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
    ['/worker/api/routes/templateRoutes.ts', '/worker/api/controllers/appView/controller.ts'],
    { query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
    const text = sources[path];
    if (text === undefined) throw new Error(`Source not found: ${path}`);
    return text;
}

describe('template review routes', () => {
    it('puts every review route behind the admin auth level', () => {
        const routes = source('/worker/api/routes/templateRoutes.ts');
        const adminLines = routes.split('\n').filter((line) => line.includes("'/api/admin/"));
        expect(adminLines).toHaveLength(6);
        for (const line of adminLines) {
            expect(line).toContain('setAuthLevel(AuthConfig.admin)');
        }
    });

    it('shows which template an app started from', () => {
        expect(source('/worker/api/controllers/appView/controller.ts')).toContain(
            'fromTemplate: origin ? toTemplateOrigin(origin) : null',
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run worker/api/controllers/templates/admin-routes-wiring.test.ts`
Expected: FAIL. No admin lines are registered yet, so the length is 0.

- [ ] **Step 3: Write the admin controller**

Create `worker/api/controllers/templates/adminController.ts`:

```typescript
/**
 * Template review for admins: the pending queue, snapshot files, screenshots,
 * and approve or reject decisions.
 */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { TemplateService } from '../../../database';
import type { TemplateVersion } from '../../../database/schema';
import {
    canReview,
    isTemplateShotKind,
    parseRejectionReason,
    supersededVersionId,
} from '../../../services/templates/catalog';
import { decodeText, type TreeFile } from '../../../services/templates/snapshot';
import { readTemplateSnapshot, templateImageResponse } from '../../../services/templates/store';
import { toPendingTemplateVersion } from './templateDto';
import type {
    PendingTemplateVersionsData,
    RejectTemplateRequest,
    TemplateVersionActionData,
    TemplateVersionFileData,
    TemplateVersionFilesData,
} from './types';

const REVIEW_SCREENSHOT_CACHE = 'private, max-age=300';

export class TemplateAdminController extends BaseController {
    static logger = createLogger('TemplateAdminController');

    static async listPending(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PendingTemplateVersionsData>>> {
        try {
            const rows = await new TemplateService(env).listPending();
            return TemplateAdminController.createSuccessResponse<PendingTemplateVersionsData>({
                versions: rows.map(toPendingTemplateVersion),
            });
        } catch (error) {
            this.logger.error('Error listing pending templates', error);
            return TemplateAdminController.createErrorResponse<PendingTemplateVersionsData>('Failed to load the review queue', 500);
        }
    }

    static async listVersionFiles(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionFilesData>>> {
        try {
            const files = await TemplateAdminController.loadSnapshot(env, context.pathParams.id);
            if (!files) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFilesData>('Template version not found', 404);
            }
            return TemplateAdminController.createSuccessResponse<TemplateVersionFilesData>({
                files: files.map((file) => ({ path: file.path, bytes: file.bytes.byteLength })),
            });
        } catch (error) {
            this.logger.error('Error listing template files', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionFilesData>('Failed to read the snapshot', 500);
        }
    }

    static async readVersionFile(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionFileData>>> {
        try {
            const path = new URL(request.url).searchParams.get('path');
            if (!path) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('path is required', 400);
            }
            const files = await TemplateAdminController.loadSnapshot(env, context.pathParams.id);
            const file = files?.find((candidate) => candidate.path === path);
            if (!file) {
                return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('File not found', 404);
            }
            const content = decodeText(file.bytes);
            return TemplateAdminController.createSuccessResponse<TemplateVersionFileData>({
                path: file.path,
                bytes: file.bytes.byteLength,
                binary: content === null,
                content,
            });
        } catch (error) {
            this.logger.error('Error reading template file', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionFileData>('Failed to read the file', 500);
        }
    }

    static async serveVersionScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { id: versionId, kind } = context.pathParams;
            if (!versionId || !kind || !isTemplateShotKind(kind)) {
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const version = await new TemplateService(env).getVersion(versionId);
            if (!version) {
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            const key = kind === 'desktop' ? version.desktopShotKey : version.mobileShotKey;
            const image = await templateImageResponse(env.TEMPLATES_BUCKET, key, REVIEW_SCREENSHOT_CACHE);
            if (!image) {
                return TemplateAdminController.createErrorResponse('Screenshot not found', 404);
            }
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving review screenshot', error);
            return TemplateAdminController.createErrorResponse('Internal server error', 500);
        }
    }

    /** Publish a pending version; it supersedes the template's current version. */
    static async approveVersion(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const templates = new TemplateService(env);
            const row = await templates.getVersionWithTemplate(versionId);
            if (!row) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (!canReview(row.version.status)) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be approved', 400);
            }
            await templates.approveVersion({
                templateId: row.template.id,
                versionId,
                supersedeVersionId: supersededVersionId(row.template.currentVersionId, versionId),
                reviewerId: context.user!.id,
            });
            return TemplateAdminController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'approved' });
        } catch (error) {
            this.logger.error('Error approving template version', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Failed to approve the version', 500);
        }
    }

    static async rejectVersion(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<TemplateVersionActionData>>> {
        try {
            const versionId = context.pathParams.id;
            const bodyResult = await TemplateAdminController.parseJsonBody<RejectTemplateRequest>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<TemplateVersionActionData>>;
            }
            const reason = parseRejectionReason(bodyResult.data);
            if (!reason.ok) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>(reason.error, 400);
            }
            const templates = new TemplateService(env);
            const version = await templates.getVersion(versionId);
            if (!version) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Template version not found', 404);
            }
            if (!canReview(version.status)) {
                return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Only versions in review can be rejected', 400);
            }
            await templates.rejectVersion(versionId, context.user!.id, reason.value);
            return TemplateAdminController.createSuccessResponse<TemplateVersionActionData>({ versionId, status: 'rejected' });
        } catch (error) {
            this.logger.error('Error rejecting template version', error);
            return TemplateAdminController.createErrorResponse<TemplateVersionActionData>('Failed to reject the version', 500);
        }
    }

    private static async loadSnapshot(env: Env, versionId: string): Promise<TreeFile[] | null> {
        const version: TemplateVersion | null = await new TemplateService(env).getVersion(versionId);
        if (!version) return null;
        return readTemplateSnapshot(env.TEMPLATES_BUCKET, version.snapshotKey);
    }
}
```

- [ ] **Step 4: Register the admin routes**

In `worker/api/routes/templateRoutes.ts`:
- add `import { TemplateAdminController } from '../controllers/templates/adminController';`;
- append inside `setupTemplateRoutes`, after the public gallery routes:

```typescript

    // Admin review
    app.get('/api/admin/templates/pending', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.listPending));
    app.get('/api/admin/template-versions/:id/files', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.listVersionFiles));
    app.get('/api/admin/template-versions/:id/file', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.readVersionFile));
    app.get('/api/admin/template-versions/:id/screenshots/:kind', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.serveVersionScreenshot));
    app.post('/api/admin/template-versions/:id/approve', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.approveVersion));
    app.post('/api/admin/template-versions/:id/reject', setAuthLevel(AuthConfig.admin), adaptController(TemplateAdminController, TemplateAdminController.rejectVersion));
```

- [ ] **Step 5: Show the template origin on app details**

In `worker/api/controllers/appView/types.ts`:
- add `import type { TemplateOrigin } from '../templates/types';`;
- add to `AppDetailsData`, after `behaviorType`:

```typescript
    /** The template this app started from, if any. */
    fromTemplate: TemplateOrigin | null;
```

In `worker/api/controllers/appView/controller.ts`:
- add `TemplateService` to the import from the database module. If the file imports `AppService` from `'../../../database/services/AppService'`, add a separate `import { TemplateService } from '../../../database';`;
- add `import { toTemplateOrigin } from '../templates/templateDto';`.

Directly before `const responseData: AppDetailsData = {`, add:

```typescript
            const origin = appResult.fromTemplateVersionId
                ? await new TemplateService(env).getTemplateOrigin(appResult.fromTemplateVersionId)
                : null;
```

Then add this line to the `responseData` object, after `behaviorType,`:

```typescript
                fromTemplate: origin ? toTemplateOrigin(origin) : null,
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run worker/api/controllers/templates && npm run typecheck`
Expected: PASS, with no type errors. If typecheck reports another place that builds an `AppDetailsData` (a fixture or mock), add `fromTemplate: null` there.

- [ ] **Step 7: Commit**

```bash
git add worker/api/controllers/templates/adminController.ts worker/api/controllers/templates/admin-routes-wiring.test.ts worker/api/routes/templateRoutes.ts worker/api/controllers/appView/types.ts worker/api/controllers/appView/controller.ts
git commit -m "feat(templates): add admin review endpoints and the app's template origin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If typecheck required `fromTemplate: null` elsewhere, add those files to this commit.

---

### Task 10: Start a new app from a template

**Files:**
- Modify: `worker/agents/core/types.ts`: add `TemplateSeed`, plus `templateSeed` on `ThinkAgentInitArgs` (lines 61-68).
- Modify: `worker/agents/core/state.ts`: add `TemplateStart`, plus `templateStart` on `ThinkState` (lines 130-147).
- Create: `worker/agents/think/template-start.ts`
- Test: `worker/agents/think/template-start.test.ts`
- Modify: `worker/agents/think/turn-message.ts`
- Test: `worker/agents/think/turn-message.test.ts` (append)
- Create: `worker/services/templates/start.ts`
- Test: `worker/services/templates/start.test.ts`
- Modify: `worker/agents/core/behaviors/think.ts`: `SpaceRpcStub` (line 59), imports, `initialize` (lines 175-232), a new `seedFromTemplate` after `seedEmptySpace`, and `build` (around line 518).
- Modify: `worker/agents/core/codingAgent.ts` (`saveToDatabase`, around line 446)
- Modify: `worker/api/controllers/agent/types.ts` (`CodeGenArgs`)
- Modify: `worker/api/controllers/agent/controller.ts`
- Test: `worker/api/controllers/agent/template-start-wiring.test.ts`

**Interfaces:**
- Consumes:
  - Task 3 `canUseTemplate`, `TEMPLATE_UNAVAILABLE_MESSAGE` and `PURCHASE_REQUIRED_ERROR`;
  - Task 4 SpaceDO `importFiles`;
  - Task 6 `TemplateService.getPublishedById`, `hasPurchase` and `incrementUseCount`;
  - Task 7 `readTemplateSnapshot`;
  - Task 8 fixtures `makeTemplateRow`.
- Produces:
  - in `worker/agents/core/types.ts`: `TemplateSeed { templateId; versionId; name; version: number; snapshotKey }`;
  - in `worker/agents/core/state.ts`: `TemplateStart { templateId; versionId; name }`;
  - `CodeGenArgs.templateId?: string`;
  - in `template-start.ts`:
    - `templateStartInstruction(templateName, description): string`;
    - `initialProjectTitle(query, templateName, deriveTitle): string`;
  - `TurnMessageInput.templateStart?: { name: string }`;
  - in `start.ts`:
    - `TemplateStartLookup`;
    - `TemplateStartResult`;
    - `resolveTemplateStart(lookup, templateId: unknown, userId): Promise<TemplateStartResult>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/agents/think/template-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { initialProjectTitle, templateStartInstruction } from './template-start';

const derive = (text: string) => `derived:${text}`;

describe('templateStartInstruction', () => {
	it('writes the personalization instruction verbatim', () => {
		expect(templateStartInstruction('Fernwood', 'A bakery in Lisbon')).toBe(
			"This app started from the template Fernwood. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: A bakery in Lisbon. Keep none of the template's original copy. Then deploy.",
		);
	});
});

describe('initialProjectTitle', () => {
	it('titles an exact copy after the template', () => {
		expect(initialProjectTitle('', 'Fernwood', derive)).toBe('Fernwood copy');
		expect(initialProjectTitle('   ', 'Fernwood', derive)).toBe('Fernwood copy');
	});

	it('titles a described start from the description', () => {
		expect(initialProjectTitle('A bakery in Lisbon', 'Fernwood', derive)).toBe('derived:A bakery in Lisbon');
	});

	it('keeps the default title without a template', () => {
		expect(initialProjectTitle('', undefined, derive)).toBe('derived:project');
	});
});
```

Append to `worker/agents/think/turn-message.test.ts`. Also add `import { templateStartInstruction } from './template-start';` to its imports.

```ts
describe('buildTurnMessage on a template start', () => {
	it('adds the hidden template instruction right after the visible text', () => {
		const message = buildTurnMessage({
			id: 'm1',
			text: 'A bakery in Lisbon',
			images: [],
			references: [],
			templateStart: { name: 'Fernwood' },
		});
		expect(message.parts).toEqual([
			{ type: 'text', text: 'A bakery in Lisbon' },
			{
				type: 'text',
				text: templateStartInstruction('Fernwood', 'A bakery in Lisbon'),
				providerMetadata: { estori: { hidden: true } },
			},
		]);
		expect(isHiddenPart(message.parts[1])).toBe(true);
	});
});
```

Create `worker/services/templates/start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTemplateRow } from './fixtures';
import { resolveTemplateStart, type TemplateStartLookup } from './start';
import type { TemplateWithVersion } from '../../database/services/TemplateService';

function lookup(row: TemplateWithVersion | null, purchasedBy: string[] = []): TemplateStartLookup {
	return {
		getPublishedById: async () => row,
		hasPurchase: async (_templateId, userId) => purchasedBy.includes(userId),
	};
}

const SEED = {
	templateId: 'tpl1',
	versionId: 'ver2',
	name: 'Fernwood Socks',
	version: 2,
	snapshotKey: 'templates/tpl1/ver2/files.json',
};

describe('resolveTemplateStart', () => {
	it('seeds from the current version of a free template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow({ priceCents: 0 })), 'tpl1', 'buyer')).resolves.toEqual({
			ok: true,
			seed: SEED,
		});
	});

	it.each([undefined, 42, ''])('treats %j as unavailable', async (templateId) => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), templateId, 'buyer')).resolves.toEqual({
			ok: false,
			status: 404,
			error: 'This template is no longer available',
		});
	});

	it('reports an unlisted template as unavailable', async () => {
		await expect(resolveTemplateStart(lookup(null), 'tpl1', 'buyer')).resolves.toEqual({
			ok: false,
			status: 404,
			error: 'This template is no longer available',
		});
	});

	it('requires a purchase for a paid template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), 'tpl1', 'buyer')).resolves.toEqual({
			ok: false,
			status: 402,
			error: 'Buy this template before using it',
		});
	});

	it('lets buyers and the creator use a paid template', async () => {
		await expect(resolveTemplateStart(lookup(makeTemplateRow(), ['buyer']), 'tpl1', 'buyer')).resolves.toMatchObject({ ok: true });
		await expect(resolveTemplateStart(lookup(makeTemplateRow()), 'tpl1', 'creator-private-id')).resolves.toMatchObject({ ok: true });
	});
});
```

Create `worker/api/controllers/agent/template-start-wiring.test.ts`:

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

describe('starting an app from a template', () => {
	const controller = source('/worker/api/controllers/agent/controller.ts');
	const think = source('/worker/agents/core/behaviors/think.ts');

	it('checks the template before spending an app-creation credit or creating an agent', () => {
		const resolve = controller.indexOf('resolveTemplateStart(');
		expect(resolve).toBeGreaterThan(-1);
		expect(resolve).toBeLessThan(controller.indexOf('enforceAppCreationRateLimit('));
		expect(resolve).toBeLessThan(controller.indexOf('const agentId = generateId()'));
	});

	it('passes the seed to the Think agent and counts the use after it initializes', () => {
		expect(controller).toContain('thinkModelId: thinkModel.id, templateSeed');
		expect(controller).toContain('incrementUseCount(templateSeed.templateId)');
	});

	it('seeds the workspace from the template instead of an empty space', () => {
		expect(think).toContain('await this.seedFromTemplate(templateSeed)');
		expect(think).toContain('space.importFiles(files, `Start from template ${seed.name} v${seed.version}`)');
		expect(think).toContain('if (!this.state.query) this.setMVPGenerated()');
	});

	it('personalizes only the first turn', () => {
		expect(think).toContain('const templateStart = this.isMVPGenerated() ? undefined : this.state.templateStart;');
	});

	it('records the template version on the saved app', () => {
		expect(source('/worker/agents/core/codingAgent.ts')).toContain('fromTemplateVersionId');
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run worker/agents/think/template-start.test.ts worker/agents/think/turn-message.test.ts worker/services/templates/start.test.ts worker/api/controllers/agent/template-start-wiring.test.ts`
Expected: FAIL. The imports `./template-start` and `./start` are missing, and the wiring markers are absent.

- [ ] **Step 3: Add the seed and start types**

In `worker/agents/core/types.ts`:
- add `templateSeed` to `ThinkAgentInitArgs`, after `thinkModelId`:

```ts
    /** Start from this template version instead of an empty workspace. */
    templateSeed?: TemplateSeed;
```

- add after the `TemplateSource` interface (from Task 7):

```ts

/** A template version to copy into a new Think app's workspace. */
export interface TemplateSeed {
    templateId: string;
    versionId: string;
    name: string;
    version: number;
    snapshotKey: string;
}
```

In `worker/agents/core/state.ts`:
- add before `export interface ThinkState`:

```ts
/** The template a Think app started from. */
export interface TemplateStart {
    templateId: string;
    versionId: string;
    name: string;
}

```

- add inside `ThinkState`, after `cloudflareDeploymentUrl?: string;`:

```ts
    /** Set when the app started from a template; its first turn personalizes the copy. */
    templateStart?: TemplateStart;
```

- [ ] **Step 4: Write the pure template-start helpers**

Create `worker/agents/think/template-start.ts`:

```ts
/**
 * Starting a Think app from a template: the hidden instruction for the
 * personalization turn and the app's first title.
 */

export function templateStartInstruction(templateName: string, description: string): string {
	return `This app started from the template ${templateName}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: ${description}. Keep none of the template's original copy. Then deploy.`;
}

/** Title from the prompt, or "{template} copy" for an exact copy with no prompt. */
export function initialProjectTitle(
	query: string,
	templateName: string | undefined,
	deriveTitle: (text: string) => string,
): string {
	if (query.trim()) return deriveTitle(query);
	if (templateName) return `${templateName} copy`;
	return deriveTitle('project');
}
```

In `worker/agents/think/turn-message.ts`:
- add `import { templateStartInstruction } from './template-start';`;
- add to `TurnMessageInput`, after `references`:

```ts
	/** The template this app started from; set only on its first turn. */
	templateStart?: { name: string };
```

- change the first two lines of `buildTurnMessage` to:

```ts
export function buildTurnMessage({ id, text, images, references, templateStart }: TurnMessageInput): UIMessage {
	const parts: TurnPart[] = [{ type: 'text', text }];
	if (templateStart) parts.push(hiddenText(templateStartInstruction(templateStart.name, text)));
```

- [ ] **Step 5: Resolve a template start**

Create `worker/services/templates/start.ts`:

```ts
/** Resolve the template a user asked to start from into the seed the agent copies. */

import type { TemplateSeed } from '../../agents/core/types';
import type { TemplateWithVersion } from '../../database/services/TemplateService';
import { PURCHASE_REQUIRED_ERROR, TEMPLATE_UNAVAILABLE_MESSAGE, canUseTemplate } from './catalog';

export interface TemplateStartLookup {
	getPublishedById(templateId: string): Promise<TemplateWithVersion | null>;
	hasPurchase(templateId: string, userId: string): Promise<boolean>;
}

export type TemplateStartResult =
	| { ok: true; seed: TemplateSeed }
	| { ok: false; status: 402 | 404; error: string };

const UNAVAILABLE: TemplateStartResult = { ok: false, status: 404, error: TEMPLATE_UNAVAILABLE_MESSAGE };

export async function resolveTemplateStart(
	lookup: TemplateStartLookup,
	templateId: unknown,
	userId: string,
): Promise<TemplateStartResult> {
	if (typeof templateId !== 'string' || templateId.length === 0) return UNAVAILABLE;
	const row = await lookup.getPublishedById(templateId);
	if (!row) return UNAVAILABLE;

	const isCreator = row.template.creatorUserId === userId;
	const needsPurchase = row.template.priceCents > 0 && !isCreator;
	const hasPurchase = needsPurchase ? await lookup.hasPurchase(row.template.id, userId) : false;
	if (!canUseTemplate({ priceCents: row.template.priceCents, isCreator, hasPurchase })) {
		return { ok: false, status: 402, error: PURCHASE_REQUIRED_ERROR };
	}
	return {
		ok: true,
		seed: {
			templateId: row.template.id,
			versionId: row.version.id,
			name: row.template.name,
			version: row.version.version,
			snapshotKey: row.version.snapshotKey,
		},
	};
}
```

- [ ] **Step 6: Seed the Think workspace from the template**

In `worker/agents/core/behaviors/think.ts`:

1. Add to `SpaceRpcStub`, after `rollbackToCommit`:

```ts
	importFiles: (
		files: Array<{ path: string; bytes: Uint8Array }>,
		message: string,
	) => Promise<{ sha: string; message: string }>;
```

2. Change line 5 to:

```ts
import { AgentInitArgs, DeploymentTarget, TemplateSeed, TemplateSource } from '../types';
```

Then add these imports next to the other `worker/...` imports:

```ts
import { readTemplateSnapshot } from 'worker/services/templates/store';
import { initialProjectTitle } from '../../think/template-start';
```

3. In `initialize`:
- change the destructuring to `const { query, hostname, inferenceContext, sandboxSessionId, thinkModelId, templateSeed } = initArgs;`;
- change `const baseName = (query || 'project').toString();` to `const baseName = (query || templateSeed?.name || 'project').toString();`;
- in the blueprint, change `title: deriveProjectTitle(baseName),` to `title: initialProjectTitle(query, templateSeed?.name, deriveProjectTitle),`;
- replace `await this.seedEmptySpace();` (inside the seed timing block) with:

```ts
		if (templateSeed) {
			await this.seedFromTemplate(templateSeed);
		} else {
			await this.seedEmptySpace();
		}
```

4. Directly after the `seedEmptySpace` method, add:

```ts

	/**
	 * Start the workspace from a template snapshot: the usual empty seed, the
	 * template's files as one commit, then a deploy so the preview shows the
	 * copy before any model turn. Throws when the copy cannot be made, which
	 * fails initialization before the app is saved.
	 */
	private async seedFromTemplate(seed: TemplateSeed): Promise<void> {
		await this.seedEmptySpace();
		const files = await readTemplateSnapshot(this.env.TEMPLATES_BUCKET, seed.snapshotKey);
		await this.callSpace((space) => space.importFiles(files, `Start from template ${seed.name} v${seed.version}`));
		const previewUrl = await this.deployCurrentBranch();
		if (!previewUrl) throw new Error(`The template ${seed.name} could not be deployed`);
		this.setState({
			...this.state,
			templateStart: { templateId: seed.templateId, versionId: seed.versionId, name: seed.name },
		});
		if (!this.state.query) this.setMVPGenerated();
	}
```

5. In `build()`, replace:

```ts
					const message = buildTurnMessage({ id: generateNanoId(), text: compiled, images, references });
```

with:

```ts
					const templateStart = this.isMVPGenerated() ? undefined : this.state.templateStart;
					const message = buildTurnMessage({ id: generateNanoId(), text: compiled, images, references, templateStart });
```

In `worker/agents/core/codingAgent.ts`, inside `saveToDatabase`:
- before `await appService.createApp({`, add:

```ts
        const state = this.state;
        const fromTemplateVersionId = 'templateStart' in state ? state.templateStart?.versionId ?? null : null;
```

- add `fromTemplateVersionId,` to the `createApp` object, after `framework: ...,`.

- [ ] **Step 7: Accept `templateId` on the start endpoint**

In `worker/api/controllers/agent/types.ts`, add to `CodeGenArgs`, after `modelId`:

```ts
    /** Start from this published template (Think apps only); the query may then be empty. */
    templateId?: string;
```

In `worker/api/controllers/agent/controller.ts`:

1. Add these imports:

```ts
import { TemplateService } from '../../../database';
import { resolveTemplateStart } from '../../../services/templates/start';
import type { TemplateSeed } from '../../../agents/core/types';
```

If `AppService` and `ModelConfigService` are already imported from `'../../../database'`, add `TemplateService` to that import instead of a new line.

2. Replace the query presence check:

```ts
            if (typeof query !== 'string' || query.trim().length === 0) {
```

with:

```ts
            const startsFromTemplate = body.templateId !== undefined;
            if (typeof query !== 'string' || (query.trim().length === 0 && !startsFromTemplate)) {
```

3. Directly after `const user = context.user!;`, and before the `try` that calls `enforceAppCreationRateLimit`, add:

```ts
            let templateSeed: TemplateSeed | undefined;
            if (startsFromTemplate) {
                const start = await resolveTemplateStart(new TemplateService(env), body.templateId, user.id);
                if (!start.ok) {
                    return CodingAgentController.createErrorResponse(start.error, start.status);
                }
                templateSeed = start.seed;
            }
```

4. Change `const behaviorType = resolveBehaviorType(body);` to:

```ts
            const behaviorType: BehaviorType = templateSeed ? 'think' : resolveBehaviorType(body);
```

5. Change `? { ...baseInitArgs, thinkModelId: thinkModel.id }` to:

```ts
                ? { ...baseInitArgs, thinkModelId: thinkModel.id, templateSeed }
```

6. In the background block, directly after `await agentPromise;` and before the `this.logger.info(\`Agent ${agentId} initialized successfully\`);` line, add:

```ts
                    if (templateSeed) {
                        await new TemplateService(env).incrementUseCount(templateSeed.templateId).catch((error: unknown) => {
                            this.logger.warn('Failed to count a template use', error);
                        });
                    }
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `npx vitest run worker/agents/think worker/services/templates worker/api/controllers/agent && npm run typecheck`
Expected: all tests pass, including the existing Think tests, with no type errors.

- [ ] **Step 9: Commit**

```bash
git add worker/agents/core/types.ts worker/agents/core/state.ts worker/agents/think/template-start.ts worker/agents/think/template-start.test.ts worker/agents/think/turn-message.ts worker/agents/think/turn-message.test.ts worker/services/templates/start.ts worker/services/templates/start.test.ts worker/agents/core/behaviors/think.ts worker/agents/core/codingAgent.ts worker/api/controllers/agent/types.ts worker/api/controllers/agent/controller.ts worker/api/controllers/agent/template-start-wiring.test.ts
git commit -m "feat(templates): start a new app from a template snapshot with a personalization turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend data layer

**Files:**
- Modify: `src/api-types.ts` (re-exports)
- Modify: `src/lib/api-client.ts` (type imports, plus a new section of methods after `getAppDetails`)
- Modify: `src/lib/query-keys.ts` (template keys)
- Create: `src/hooks/use-templates.ts`
- Create: `src/lib/template-start.ts`
- Test: `src/lib/template-start.test.ts`
- Create: `src/lib/template-display.ts`
- Test: `src/lib/template-display.test.ts`

**Interfaces:**
- Consumes: the API types from Task 8 (`worker/api/controllers/templates/types.ts`) and the shared values from Task 1.
- Produces, from `@/api-types`:
  - every type in `worker/api/controllers/templates/types.ts`;
  - `TemplateCategory`, `TemplateListingStatus` and `TemplateVersionStatus`;
  - `TEMPLATE_CATEGORIES`, `TEMPLATE_CATEGORY_LABELS`, `TEMPLATE_PRICE_OPTIONS_CENTS` and `formatTemplatePrice`.
- Produces, on `apiClient`:
  - **Gallery and use:** `getTemplates(params)`, `getTemplate(slug)` and `purchaseTemplate(templateId)`;
  - **Creator:**
    - `getMyTemplates()`;
    - `getAppTemplate(appId)`, which is quiet on errors;
    - `submitTemplate(appId, body)`;
    - `withdrawTemplateVersion(templateId, versionId)`;
    - `setTemplateListing(templateId, listed)`;
  - **Admin:**
    - `getPendingTemplateVersions()`, which is quiet on errors;
    - `getTemplateVersionFiles(versionId)` and `getTemplateVersionFile(versionId, path)`;
    - `approveTemplateVersion(versionId)` and `rejectTemplateVersion(versionId, reason)`.
- Produces: `queryKeys.templates.*` and `TemplateGalleryFilters { category: TemplateCategory | null; search: string; limit: number }`.
- Produces hooks in `src/hooks/use-templates.ts`:
  - **Queries:** `useTemplateGallery(filters)` (infinite), `useTemplateDetail(slug)`, `useMyTemplates()`, `useAppTemplate(appId, enabled)`, `usePendingTemplateVersions()`, `useTemplateVersionFiles(versionId | null)` and `useTemplateVersionFile(versionId, path | null)`;
  - **Mutations:** `useSubmitTemplate(appId)`, `useWithdrawTemplateVersion()`, `useSetTemplateListing()`, `usePurchaseTemplate()` and `useReviewTemplateVersion()`;
  - **Type:** `TemplateReview`.
- Produces: `templateStartPath({ templateId, description, modelId? }): string`.
- Produces, in `template-display.ts`:
  - `TemplateStatusView { label; variant: 'warning' | 'success' | 'error' | 'secondary'; detail: string | null; pendingVersionId: string | null; canUnlist: boolean }`;
  - `templateStatusView(template: CreatorTemplate): TemplateStatusView`;
  - `formatFileSize(bytes: number): string`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/template-start.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { templateStartPath } from './template-start';

describe('templateStartPath', () => {
	it('builds the chat URL with the template, description and model', () => {
		expect(templateStartPath({ templateId: 'tpl1', description: '  A bakery in Lisbon ', modelId: 'claude-sonnet' })).toBe(
			'/chat/new?template=tpl1&query=A+bakery+in+Lisbon&projectType=app&behaviorType=think&model=claude-sonnet',
		);
	});

	it('starts an exact copy with an empty query', () => {
		expect(templateStartPath({ templateId: 'tpl1', description: '' })).toBe(
			'/chat/new?template=tpl1&query=&projectType=app&behaviorType=think',
		);
	});
});
```

Create `src/lib/template-display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CreatorTemplate, CreatorTemplateVersion } from '@/api-types';
import { formatFileSize, templateStatusView } from './template-display';

function version(overrides: Partial<CreatorTemplateVersion>): CreatorTemplateVersion {
	return {
		id: 'v1',
		version: 1,
		status: 'approved',
		rejectionReason: null,
		submittedAt: null,
		reviewedAt: null,
		...overrides,
	};
}

function template(overrides: Partial<CreatorTemplate>): CreatorTemplate {
	return {
		id: 'tpl1',
		slug: 'fernwood',
		name: 'Fernwood',
		description: 'A cozy merino sock store.',
		category: 'store',
		priceCents: 0,
		status: 'unlisted',
		useCount: 0,
		currentVersionId: null,
		versions: [],
		...overrides,
	};
}

describe('templateStatusView', () => {
	it('shows a first version in review', () => {
		expect(templateStatusView(template({ versions: [version({ id: 'v1', status: 'pending' })] }))).toEqual({
			label: 'In review',
			variant: 'warning',
			detail: 'Version 1 is in review',
			pendingVersionId: 'v1',
			canUnlist: false,
		});
	});

	it('shows a published template with an update in review', () => {
		const view = templateStatusView(
			template({
				status: 'listed',
				currentVersionId: 'v1',
				versions: [version({ id: 'v2', version: 2, status: 'pending' }), version({ id: 'v1' })],
			}),
		);
		expect(view).toEqual({
			label: 'Published',
			variant: 'success',
			detail: 'Version 2 is in review',
			pendingVersionId: 'v2',
			canUnlist: true,
		});
	});

	it('shows the reviewer reason on a rejection', () => {
		expect(
			templateStatusView(template({ versions: [version({ status: 'rejected', rejectionReason: 'Uses a real brand logo' })] })),
		).toMatchObject({ label: 'Rejected', variant: 'error', detail: 'Uses a real brand logo', canUnlist: false });
	});

	it('shows an approved template that was unlisted', () => {
		expect(templateStatusView(template({ currentVersionId: 'v1', versions: [version({})] }))).toMatchObject({
			label: 'Unlisted',
			variant: 'secondary',
		});
	});

	it('shows a withdrawn first version', () => {
		expect(templateStatusView(template({ versions: [version({ status: 'withdrawn' })] }))).toMatchObject({
			label: 'Withdrawn',
			variant: 'secondary',
		});
	});
});

describe('formatFileSize', () => {
	it.each([
		[512, '512 B'],
		[2048, '2.0 KB'],
		[10 * 1024 * 1024, '10.0 MB'],
	])('formats %i bytes', (bytes, text) => {
		expect(formatFileSize(bytes)).toBe(text);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/template-start.test.ts src/lib/template-display.test.ts`
Expected: FAIL, with `Failed to resolve import "./template-start"` and `"./template-display"`.

- [ ] **Step 3: Re-export the types**

In `src/api-types.ts`, add after the `RateLimitExceededError` re-export line (line 228):

```ts

export type {
	AppTemplateData,
	CreatorTemplate,
	CreatorTemplateVersion,
	MyTemplatesData,
	PendingTemplateVersion,
	PendingTemplateVersionsData,
	PublicTemplateCard,
	PublicTemplateDetail,
	RejectTemplateRequest,
	SubmitTemplateData,
	SubmitTemplateRequest,
	TemplateDetailData,
	TemplateGalleryData,
	TemplateGalleryParams,
	TemplateListingData,
	TemplateOrigin,
	TemplatePurchaseData,
	TemplateVersionActionData,
	TemplateVersionFileData,
	TemplateVersionFilesData,
	TemplateViewerAccess,
} from 'worker/api/controllers/templates/types';
export type { TemplateCategory, TemplateListingStatus, TemplateVersionStatus } from '../shared/types/templates.js';
export {
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	formatTemplatePrice,
} from '../shared/types/templates.js';
```

- [ ] **Step 4: Add the API client methods**

In `src/lib/api-client.ts`, add these to the `import type{ ... }` block from `'@/api-types'` (around line 7): `AppTemplateData`, `MyTemplatesData`, `PendingTemplateVersionsData`, `RejectTemplateRequest`, `SubmitTemplateData`, `SubmitTemplateRequest`, `TemplateDetailData`, `TemplateGalleryData`, `TemplateGalleryParams`, `TemplateListingData`, `TemplatePurchaseData`, `TemplateVersionActionData`, `TemplateVersionFileData` and `TemplateVersionFilesData`.

Then add directly after the `getAppDetails` method:

```ts

	// ===============================
	// Template API Methods
	// ===============================

	async getTemplates(params: TemplateGalleryParams = {}): Promise<ApiResponse<TemplateGalleryData>> {
		const query = new URLSearchParams();
		if (params.page) query.set('page', String(params.page));
		if (params.limit) query.set('limit', String(params.limit));
		if (params.category) query.set('category', params.category);
		if (params.search) query.set('search', params.search);
		const suffix = query.toString();
		return this.request<TemplateGalleryData>(`/api/templates${suffix ? `?${suffix}` : ''}`);
	}

	async getTemplate(slug: string): Promise<ApiResponse<TemplateDetailData>> {
		return this.request<TemplateDetailData>(`/api/templates/${encodeURIComponent(slug)}`);
	}

	/** Buy a paid template. Payments are in test mode: the purchase is recorded without a charge. */
	async purchaseTemplate(templateId: string): Promise<ApiResponse<TemplatePurchaseData>> {
		return this.request<TemplatePurchaseData>(`/api/templates/${templateId}/purchases`, { method: 'POST' });
	}

	async getMyTemplates(): Promise<ApiResponse<MyTemplatesData>> {
		return this.request<MyTemplatesData>('/api/templates/mine');
	}

	/** Template status for one of the owner's apps; quiet because non-owners get 403. */
	async getAppTemplate(appId: string): Promise<ApiResponse<AppTemplateData>> {
		return this.request<AppTemplateData>(`/api/apps/${appId}/template`, {}, true);
	}

	async submitTemplate(appId: string, body: SubmitTemplateRequest): Promise<ApiResponse<SubmitTemplateData>> {
		return this.request<SubmitTemplateData>(`/api/apps/${appId}/template-submissions`, { method: 'POST', body });
	}

	async withdrawTemplateVersion(templateId: string, versionId: string): Promise<ApiResponse<TemplateVersionActionData>> {
		return this.request<TemplateVersionActionData>(`/api/templates/${templateId}/versions/${versionId}/withdraw`, {
			method: 'POST',
		});
	}

	async setTemplateListing(templateId: string, listed: boolean): Promise<ApiResponse<TemplateListingData>> {
		return this.request<TemplateListingData>(`/api/templates/${templateId}/listing`, {
			method: 'PUT',
			body: { listed },
		});
	}

	/** Review queue; quiet because non-admins get 403 and the page explains it. */
	async getPendingTemplateVersions(): Promise<ApiResponse<PendingTemplateVersionsData>> {
		return this.request<PendingTemplateVersionsData>('/api/admin/templates/pending', {}, true);
	}

	async getTemplateVersionFiles(versionId: string): Promise<ApiResponse<TemplateVersionFilesData>> {
		return this.request<TemplateVersionFilesData>(`/api/admin/template-versions/${versionId}/files`);
	}

	async getTemplateVersionFile(versionId: string, path: string): Promise<ApiResponse<TemplateVersionFileData>> {
		return this.request<TemplateVersionFileData>(
			`/api/admin/template-versions/${versionId}/file?path=${encodeURIComponent(path)}`,
		);
	}

	async approveTemplateVersion(versionId: string): Promise<ApiResponse<TemplateVersionActionData>> {
		return this.request<TemplateVersionActionData>(`/api/admin/template-versions/${versionId}/approve`, {
			method: 'POST',
		});
	}

	async rejectTemplateVersion(versionId: string, reason: string): Promise<ApiResponse<TemplateVersionActionData>> {
		const body: RejectTemplateRequest = { reason };
		return this.request<TemplateVersionActionData>(`/api/admin/template-versions/${versionId}/reject`, {
			method: 'POST',
			body,
		});
	}
```

- [ ] **Step 5: Add the query keys**

In `src/lib/query-keys.ts`:
- add at the top: `import type { TemplateCategory } from '@/api-types';`;
- add after the `PaginatedAppsListFilters` type:

```ts

export type TemplateGalleryFilters = {
	category: TemplateCategory | null;
	search: string;
	limit: number;
};
```

Then add a `templates` entry inside `queryKeys`, after the `apps` entry:

```ts
	templates: {
		all: ['templates'] as const,
		gallery: (filters: TemplateGalleryFilters) => [...queryKeys.templates.all, 'gallery', filters] as const,
		detail: (slug: string, userId?: string | null) =>
			[...queryKeys.templates.all, 'detail', slug, userId ?? 'anonymous'] as const,
		mine: (userId?: string | null) => [...queryKeys.templates.all, 'mine', userId ?? 'anonymous'] as const,
		app: (appId: string) => [...queryKeys.templates.all, 'app', appId] as const,
		pending: () => [...queryKeys.templates.all, 'pending'] as const,
		versionFiles: (versionId: string) => [...queryKeys.templates.all, 'version-files', versionId] as const,
		versionFile: (versionId: string, path: string) =>
			[...queryKeys.templates.all, 'version-file', versionId, path] as const,
	},
```

- [ ] **Step 6: Write the hooks**

Create `src/hooks/use-templates.ts`:

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys, type TemplateGalleryFilters } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import type { ApiResponse, SubmitTemplateRequest } from '@/api-types';

/** The data of a successful response, or an error carrying the server's message. */
async function unwrap<T>(request: Promise<ApiResponse<T>>, fallback: string): Promise<T> {
	const response = await request;
	if (!response.success || response.data === undefined) {
		throw new Error(response.error?.message || fallback);
	}
	return response.data;
}

/** Any template change can move a template between lists, so every template query refreshes. */
function useTemplateMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
	});
}

export function useTemplateGallery(filters: TemplateGalleryFilters) {
	return useInfiniteQuery({
		queryKey: queryKeys.templates.gallery(filters),
		initialPageParam: 1,
		queryFn: ({ pageParam }) =>
			unwrap(
				apiClient.getTemplates({
					page: pageParam,
					limit: filters.limit,
					category: filters.category ?? undefined,
					search: filters.search || undefined,
				}),
				'Failed to load templates',
			),
		getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
	});
}

export function useTemplateDetail(slug: string | undefined) {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.templates.detail(slug ?? '', user?.id),
		queryFn: () => unwrap(apiClient.getTemplate(slug!), 'Failed to load the template'),
		enabled: !!slug,
		retry: false,
	});
}

export function useMyTemplates() {
	const { user } = useAuth();
	return useQuery({
		queryKey: queryKeys.templates.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyTemplates(), 'Failed to load your templates'),
		enabled: !!user,
	});
}

export function useAppTemplate(appId: string | undefined, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.templates.app(appId ?? ''),
		queryFn: () => unwrap(apiClient.getAppTemplate(appId!), 'Failed to load the template status'),
		enabled: enabled && !!appId,
		retry: false,
	});
}

export function useSubmitTemplate(appId: string) {
	return useTemplateMutation((body: SubmitTemplateRequest) =>
		unwrap(apiClient.submitTemplate(appId, body), 'Failed to submit the template'),
	);
}

export function useWithdrawTemplateVersion() {
	return useTemplateMutation((input: { templateId: string; versionId: string }) =>
		unwrap(apiClient.withdrawTemplateVersion(input.templateId, input.versionId), 'Failed to withdraw the version'),
	);
}

export function useSetTemplateListing() {
	return useTemplateMutation((input: { templateId: string; listed: boolean }) =>
		unwrap(apiClient.setTemplateListing(input.templateId, input.listed), 'Failed to change the listing'),
	);
}

export function usePurchaseTemplate() {
	return useTemplateMutation((templateId: string) =>
		unwrap(apiClient.purchaseTemplate(templateId), 'Failed to buy the template'),
	);
}

export function usePendingTemplateVersions() {
	return useQuery({
		queryKey: queryKeys.templates.pending(),
		queryFn: () => unwrap(apiClient.getPendingTemplateVersions(), 'Failed to load the review queue'),
		retry: false,
	});
}

export function useTemplateVersionFiles(versionId: string | null) {
	return useQuery({
		queryKey: queryKeys.templates.versionFiles(versionId ?? ''),
		queryFn: () => unwrap(apiClient.getTemplateVersionFiles(versionId!), 'Failed to load the files'),
		enabled: !!versionId,
	});
}

export function useTemplateVersionFile(versionId: string, path: string | null) {
	return useQuery({
		queryKey: queryKeys.templates.versionFile(versionId, path ?? ''),
		queryFn: () => unwrap(apiClient.getTemplateVersionFile(versionId, path!), 'Failed to load the file'),
		enabled: !!path,
	});
}

export type TemplateReview =
	| { versionId: string; decision: 'approve' }
	| { versionId: string; decision: 'reject'; reason: string };

export function useReviewTemplateVersion() {
	return useTemplateMutation((review: TemplateReview) =>
		review.decision === 'approve'
			? unwrap(apiClient.approveTemplateVersion(review.versionId), 'Failed to approve the version')
			: unwrap(apiClient.rejectTemplateVersion(review.versionId, review.reason), 'Failed to reject the version'),
	);
}
```

- [ ] **Step 7: Write the URL and display helpers**

Create `src/lib/template-start.ts`:

```ts
/** Chat URL that starts a new app from a template; the chat page creates the session. */
export function templateStartPath(input: { templateId: string; description: string; modelId?: string }): string {
	const params = new URLSearchParams();
	params.set('template', input.templateId);
	params.set('query', input.description.trim());
	params.set('projectType', 'app');
	params.set('behaviorType', 'think');
	if (input.modelId) params.set('model', input.modelId);
	return `/chat/new?${params.toString()}`;
}
```

Create `src/lib/template-display.ts`:

```ts
import type { CreatorTemplate } from '@/api-types';

export interface TemplateStatusView {
	label: string;
	variant: 'warning' | 'success' | 'error' | 'secondary';
	detail: string | null;
	pendingVersionId: string | null;
	canUnlist: boolean;
}

/** How a creator's template stands, from its listing and newest versions. */
export function templateStatusView(template: CreatorTemplate): TemplateStatusView {
	const pending = template.versions.find((version) => version.status === 'pending');
	const pendingDetail = pending ? `Version ${pending.version} is in review` : null;
	if (template.status === 'listed') {
		return {
			label: 'Published',
			variant: 'success',
			detail: pendingDetail,
			pendingVersionId: pending?.id ?? null,
			canUnlist: true,
		};
	}
	if (pending) {
		return { label: 'In review', variant: 'warning', detail: pendingDetail, pendingVersionId: pending.id, canUnlist: false };
	}
	const latest = template.versions[0];
	if (latest?.status === 'rejected') {
		return { label: 'Rejected', variant: 'error', detail: latest.rejectionReason, pendingVersionId: null, canUnlist: false };
	}
	if (template.currentVersionId) {
		return { label: 'Unlisted', variant: 'secondary', detail: null, pendingVersionId: null, canUnlist: false };
	}
	return { label: 'Withdrawn', variant: 'secondary', detail: null, pendingVersionId: null, canUnlist: false };
}

export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `npx vitest run src/lib/template-start.test.ts src/lib/template-display.test.ts && npm run typecheck`
Expected: PASS (10 tests), with no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts src/hooks/use-templates.ts src/lib/template-start.ts src/lib/template-start.test.ts src/lib/template-display.ts src/lib/template-display.test.ts
git commit -m "feat(templates): add the frontend template API, hooks and display helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Gallery, template page, buying and starting from a template

**Files:**
- Create: `src/components/templates/TemplateCard.tsx`
- Create: `src/components/templates/UseTemplateDialog.tsx`
- Create: `src/components/templates/TemplateStrip.tsx`
- Create: `src/routes/templates/index.tsx`
- Create: `src/routes/templates/detail.tsx`
- Modify: `src/routes.tsx`
- Modify: `src/routes/home.tsx`
- Modify: `src/components/layout/app-sidebar.tsx` (a Templates link next to Discover)
- Modify: `src/routes/chat/chat.tsx` (read the `template` param)
- Modify: `src/routes/chat/hooks/use-chat.ts` (send `templateId`)
- Test: `src/routes/templates-guard.test.ts`

**Interfaces:**
- Consumes:
  - from Task 11: `useTemplateGallery`, `useTemplateDetail`, `usePurchaseTemplate`, `templateStartPath`, `formatTemplatePrice` and `TEMPLATE_CATEGORY_LABELS`;
  - `useAuthGuard().requireAuth`;
  - `useFeature().capabilities`, which carries `thinkModels` and `defaultThinkModel`;
  - `ThinkModelPicker`.
- Produces:
  - `TemplateCard({ template, onOpen, compact? })`;
  - `UseTemplateDialog({ template, open, onOpenChange })`;
  - `TemplateStrip()`;
  - pages at `/templates` and `/templates/:slug`;
  - `useChat({ templateId })`.

- [ ] **Step 1: Write the failing wiring test**

Create `src/routes/templates-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/home.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/hooks/use-chat.ts',
		'/src/routes/templates/detail.tsx',
		'/src/components/layout/app-sidebar.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: gallery and use', () => {
	it('registers the gallery and template pages', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'templates'");
		expect(routes).toContain("path: 'templates/:slug'");
	});

	it('offers templates under the home prompt and in the sidebar', () => {
		expect(source('/src/routes/home.tsx')).toContain('<TemplateStrip />');
		expect(source('/src/components/layout/app-sidebar.tsx')).toContain("navigate('/templates')");
	});

	it('starts a chat session from the template in the URL', () => {
		expect(source('/src/routes/chat/chat.tsx')).toContain("searchParams.get('template')");
		const useChat = source('/src/routes/chat/hooks/use-chat.ts');
		expect(useChat).toContain('if (!userQuery && !templateId)');
		expect(useChat).toContain('templateId,');
	});

	it('asks for a purchase before a paid template can be used, in test mode', () => {
		const detail = source('/src/routes/templates/detail.tsx');
		expect(detail).toContain('viewer.canUse');
		expect(detail).toContain("Payments are in test mode. You won't be charged.");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/templates-guard.test.ts`
Expected: FAIL, with `Source not found: /src/routes/templates/detail.tsx`.

- [ ] **Step 3: Write the card, the use dialog and the strip**

Create `src/components/templates/TemplateCard.tsx`:

```tsx
import { Badge } from '@cloudflare/kumo';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS, type PublicTemplateCard } from '@/api-types';

interface TemplateCardProps {
	template: PublicTemplateCard;
	onOpen: (slug: string) => void;
	/** Hides the description, for small strips. */
	compact?: boolean;
}

export function TemplateCard({ template, onOpen, compact = false }: TemplateCardProps) {
	return (
		<button
			type="button"
			onClick={() => onOpen(template.slug)}
			className="group flex w-full flex-col overflow-hidden rounded-xl bg-kumo-base text-left ring ring-kumo-hairline transition hover:shadow-md"
		>
			<div className="aspect-[16/10] w-full overflow-hidden bg-kumo-elevated">
				<img
					src={template.desktopShotUrl}
					alt={`${template.name} preview`}
					loading="lazy"
					className="size-full object-cover object-top transition group-hover:scale-[1.02]"
				/>
			</div>
			<div className="grid gap-1 px-3 py-3">
				<div className="flex items-center justify-between gap-2">
					<p className="truncate text-sm font-semibold text-kumo-default">{template.name}</p>
					<Badge variant={template.priceCents > 0 ? 'info' : 'success'}>
						{formatTemplatePrice(template.priceCents)}
					</Badge>
				</div>
				{!compact && <p className="line-clamp-2 text-sm text-kumo-subtle">{template.description}</p>}
				<p className="truncate text-xs text-kumo-subtle">
					{TEMPLATE_CATEGORY_LABELS[template.category]} · by {template.creatorName} · {template.useCount} uses
				</p>
			</div>
		</button>
	);
}
```

Create `src/components/templates/UseTemplateDialog.tsx`:

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
import { MAX_AGENT_QUERY_LENGTH, type PublicTemplateDetail } from '@/api-types';
import { templateStartPath } from '@/lib/template-start';

interface UseTemplateDialogProps {
	template: PublicTemplateDetail;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function UseTemplateDialog({ template, open, onOpenChange }: UseTemplateDialogProps) {
	const navigate = useNavigate();
	const { capabilities } = useFeature();
	const [description, setDescription] = useState('');
	const [modelId, setModelId] = useState('');
	const effectiveModel = modelId || capabilities?.defaultThinkModel || '';

	const start = () => {
		onOpenChange(false);
		navigate(
			templateStartPath({ templateId: template.id, description, modelId: effectiveModel || undefined }),
			{ state: { fromPrompt: true } },
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Use {template.name}</DialogTitle>
					<DialogDescription>
						Your new app starts as a copy of this template. Describe your business and the agent rewrites the
						text, names, prices and images for you, or leave it empty to keep an exact copy.
					</DialogDescription>
				</DialogHeader>
				<InputArea
					id="template-description"
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

Create `src/components/templates/TemplateStrip.tsx`:

```tsx
import { useNavigate } from 'react-router';
import { useTemplateGallery } from '@/hooks/use-templates';
import { TemplateCard } from './TemplateCard';

/** "Start from a template" row under the home prompt; hidden until templates exist. */
export function TemplateStrip() {
	const navigate = useNavigate();
	const gallery = useTemplateGallery({ category: null, search: '', limit: 6 });
	const templates = gallery.data?.pages[0]?.templates ?? [];
	if (templates.length === 0) return null;

	return (
		<section className="mt-8 grid gap-3" aria-label="Start from a template">
			<div className="flex items-center justify-between">
				<h2 className="text-sm font-semibold text-kumo-default">Start from a template</h2>
				<button
					type="button"
					className="text-sm text-kumo-subtle hover:text-kumo-default"
					onClick={() => navigate('/templates')}
				>
					Browse all
				</button>
			</div>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{templates.map((template) => (
					<TemplateCard
						key={template.id}
						template={template}
						compact
						onOpen={(slug) => navigate(`/templates/${slug}`)}
					/>
				))}
			</div>
		</section>
	);
}
```

- [ ] **Step 4: Write the gallery and template pages**

Create `src/routes/templates/index.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, cn, Empty, Input, Loader } from '@cloudflare/kumo';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { BrandEmphasisIcon } from '@/components/shared/BrandEmphasisIcon';
import { TemplateCard } from '@/components/templates/TemplateCard';
import { useTemplateGallery } from '@/hooks/use-templates';
import { TEMPLATE_CATEGORIES, TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '@/api-types';

export default function TemplatesPage() {
	const navigate = useNavigate();
	const [category, setCategory] = useState<TemplateCategory | null>(null);
	const [searchInput, setSearchInput] = useState('');
	const [search, setSearch] = useState('');
	const gallery = useTemplateGallery({ category, search, limit: 24 });
	const templates = gallery.data?.pages.flatMap((page) => page.templates) ?? [];

	return (
		<div className="size-full">
			<title>{pageTitle('Templates')}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8">
				<div className="mb-8 mt-6">
					<h1 className="flex items-center gap-2 text-6xl font-funky-mono font-bold mb-3 text-brand-emphasis">
						<BrandEmphasisIcon icon={SquaresFourIcon} weight="duotone" />
						Templates
					</h1>
					<p className="text-kumo-subtle text-lg font-funky-mono tracking-tight">
						Start from a site that already works, then make it yours
					</p>
				</div>

				<form
					className="mb-4 flex max-w-md gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setSearch(searchInput.trim());
					}}
				>
					<Input
						aria-label="Search templates"
						placeholder="Search templates..."
						value={searchInput}
						onChange={(event) => setSearchInput(event.target.value)}
					/>
					<Button type="submit" variant="secondary">
						Search
					</Button>
				</form>

				<div className="mb-8 flex flex-wrap gap-2">
					<CategoryChip label="All" active={category === null} onClick={() => setCategory(null)} />
					{TEMPLATE_CATEGORIES.map((value) => (
						<CategoryChip
							key={value}
							label={TEMPLATE_CATEGORY_LABELS[value]}
							active={category === value}
							onClick={() => setCategory(value)}
						/>
					))}
				</div>

				{gallery.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : gallery.isError ? (
					<Empty title="Templates didn't load" description={gallery.error.message} />
				) : templates.length === 0 ? (
					<Empty
						icon={<SquaresFourIcon size={40} weight="duotone" className="text-kumo-inactive" />}
						title="No templates yet"
						description="Published templates will show up here."
					/>
				) : (
					<div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{templates.map((template) => (
							<TemplateCard
								key={template.id}
								template={template}
								onOpen={(slug) => navigate(`/templates/${slug}`)}
							/>
						))}
					</div>
				)}

				{gallery.hasNextPage && (
					<div className="mt-8 flex justify-center">
						<Button
							variant="secondary"
							loading={gallery.isFetchingNextPage}
							onClick={() => void gallery.fetchNextPage()}
						>
							Load more
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className={cn(
				'rounded-full px-3 py-1 text-sm ring transition',
				active ? 'ring-2 ring-brand font-medium text-kumo-strong' : 'ring-kumo-hairline text-kumo-default hover:bg-kumo-elevated',
			)}
		>
			{label}
		</button>
	);
}
```

Create `src/routes/templates/detail.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { UseTemplateDialog } from '@/components/templates/UseTemplateDialog';
import { usePurchaseTemplate, useTemplateDetail } from '@/hooks/use-templates';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS } from '@/api-types';

export default function TemplateDetailPage() {
	const { slug } = useParams();
	const navigate = useNavigate();
	const detail = useTemplateDetail(slug);
	const purchase = usePurchaseTemplate();
	const { requireAuth } = useAuthGuard();
	const [useOpen, setUseOpen] = useState(false);

	if (detail.isLoading) {
		return (
			<div className="flex justify-center py-24">
				<Loader />
			</div>
		);
	}
	if (detail.isError || !detail.data) {
		return (
			<div className="container max-w-3xl mx-auto px-4 py-16">
				<Empty title="Template not found" description="This template is no longer available." />
			</div>
		);
	}

	const { template, viewer } = detail.data;
	const isPaid = template.priceCents > 0;
	const price = formatTemplatePrice(template.priceCents);
	const intendedUrl = `/templates/${template.slug}`;

	const startUse = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to use templates', intendedUrl })) return;
		setUseOpen(true);
	};

	const buy = () => {
		if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy templates', intendedUrl })) return;
		purchase.mutate(template.id, {
			onSuccess: () => toast.success(`You own ${template.name}. You can use it now.`),
			onError: (error) => toast.error(error.message),
		});
	};

	return (
		<div className="size-full">
			<title>{pageTitle(template.name)}</title>
			<div className="container max-w-6xl mx-auto px-4 py-8 grid gap-8">
				<button
					type="button"
					className="w-fit text-sm text-kumo-subtle hover:text-kumo-default"
					onClick={() => navigate('/templates')}
				>
					Back to templates
				</button>

				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="grid max-w-2xl gap-2">
						<h1 className="text-3xl font-semibold text-kumo-strong">{template.name}</h1>
						<p className="text-kumo-subtle">{template.description}</p>
						<p className="text-sm text-kumo-subtle">
							{TEMPLATE_CATEGORY_LABELS[template.category]} · by {template.creatorName}
							{template.publishedAt ? ` · published ${new Date(template.publishedAt).toLocaleDateString()}` : ''} ·{' '}
							{template.useCount} uses
						</p>
					</div>
					<div className="grid justify-items-end gap-2">
						<Badge variant={isPaid ? 'info' : 'success'}>{price}</Badge>
						{viewer.canUse ? (
							<Button variant="primary" onClick={startUse}>
								Use this template
							</Button>
						) : (
							<Button variant="primary" loading={purchase.isPending} onClick={buy}>
								Buy for {price}
							</Button>
						)}
						{isPaid && !viewer.canUse && (
							<p className="text-xs text-kumo-subtle">Payments are in test mode. You won't be charged.</p>
						)}
						{isPaid && viewer.purchased && <p className="text-xs text-kumo-subtle">You own this template.</p>}
					</div>
				</div>

				<div className="grid items-start gap-6 lg:grid-cols-[1fr_260px]">
					<img
						src={template.desktopShotUrl}
						alt={`${template.name} on a desktop`}
						className="w-full rounded-xl ring ring-kumo-hairline"
					/>
					<img
						src={template.mobileShotUrl}
						alt={`${template.name} on a phone`}
						className="w-full max-w-[260px] justify-self-center rounded-2xl ring ring-kumo-hairline"
					/>
				</div>
			</div>
			<UseTemplateDialog template={template} open={useOpen} onOpenChange={setUseOpen} />
		</div>
	);
}
```

- [ ] **Step 5: Register the pages, the home strip and the sidebar link**

In `src/routes.tsx`, add these imports:

```tsx
import TemplatesPage from './routes/templates';
import TemplateDetailPage from './routes/templates/detail';
```

Then add these children after the `discover` route:

```tsx
			{
				path: 'templates',
				Component: TemplatesPage,
			},
			{
				path: 'templates/:slug',
				Component: TemplateDetailPage,
			},
```

In `src/routes/home.tsx`:
- add `import { TemplateStrip } from '@/components/templates/TemplateStrip';`;
- directly after the `</motion.div>` that closes the prompt box wrapper (the first `</motion.div>` after `<PromptBox`), add `<TemplateStrip />`. It sits inside the same `w-full max-w-3xl` container.

In `src/components/layout/app-sidebar.tsx`, add `SquaresFourIcon` to the `@phosphor-icons/react` import. In the collapsed layout, add this right after the Discover square button (the `<Button ... id="discover-link" ... />` that ends with `icon={<CompassIcon className="size-4" />}`):

```tsx
						<Button
							shape="square"
							size="base"
							variant="ghost"
							aria-label="Templates"
							title="Templates"
							aria-current={pathname.startsWith('/templates') ? 'page' : undefined}
							onClick={() => navigate('/templates')}
							className={cn(
								'text-kumo-subtle hover:text-kumo-default',
								pathname.startsWith('/templates') && 'bg-(--sidebar-active-bg) text-kumo-default',
							)}
							icon={<SquaresFourIcon className="size-4" />}
						/>
```

In the expanded layout, add this right after the Discover `</Sidebar.MenuButton>`:

```tsx
							<Sidebar.MenuButton
								active={pathname.startsWith('/templates')}
								icon={<SquaresFourIcon weight="duotone" className="size-4 -mr-1" />}
								tooltip="Templates"
								onClick={() => navigate('/templates')}
							>
								Templates
							</Sidebar.MenuButton>
```

- [ ] **Step 6: Start a chat session from a template**

In `src/routes/chat/chat.tsx`, after `const urlModelId = searchParams.get('model') ?? undefined;`, add:

```tsx
	const urlTemplateId = searchParams.get('template') ?? undefined;
```

Then pass `templateId: urlTemplateId,` to `useChat({ ... })`, after `modelId: urlModelId,`.

In `src/routes/chat/hooks/use-chat.ts`:

1. In the `useChat` parameter destructuring, add `templateId,` after `modelId,`. In its type, add after the `modelId` field:

```ts
	/** Start a new session from this gallery template; the query may then be empty. */
	templateId?: string;
```

2. In the new-session branch, replace:

```ts
					if (!userQuery) {
```

with:

```ts
					if (!userQuery && !templateId) {
```

3. Replace the length check that follows. The original:

```ts
					if (userQuery.length > MAX_AGENT_QUERY_LENGTH) {
						const errorMsg = `Prompt too large (${userQuery.length} characters). Maximum allowed is ${MAX_AGENT_QUERY_LENGTH} characters.`;
```

becomes:

```ts
					const query = userQuery ?? '';
					if (query.length > MAX_AGENT_QUERY_LENGTH) {
						const errorMsg = `Prompt too large (${query.length} characters). Maximum allowed is ${MAX_AGENT_QUERY_LENGTH} characters.`;
```

4. In the `apiClient.createAgentSession({ ... })` call, change `query: userQuery,` to `query,` and add `templateId,` after `modelId,`.

5. Add `templateId,` to the effect's dependency array, after `modelId,` (the array that also lists `userQuery`).

- [ ] **Step 7: Run the tests, the typecheck and the lint**

Run: `npx vitest run src/routes/templates-guard.test.ts && npm run typecheck && npx eslint src/components/templates src/routes/templates src/routes/home.tsx src/routes/chat/chat.tsx src/routes/chat/hooks/use-chat.ts src/components/layout/app-sidebar.tsx src/routes.tsx`
Expected: PASS (4 tests), with no type errors and no lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/templates/TemplateCard.tsx src/components/templates/UseTemplateDialog.tsx src/components/templates/TemplateStrip.tsx src/routes/templates/index.tsx src/routes/templates/detail.tsx src/routes.tsx src/routes/home.tsx src/components/layout/app-sidebar.tsx src/routes/chat/chat.tsx src/routes/chat/hooks/use-chat.ts src/routes/templates-guard.test.ts
git commit -m "feat(templates): add the gallery, template page, test-mode buying and starting from a template

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Creator UI: submit, status, withdraw, unlist and My templates

**Files:**
- Create: `src/components/templates/SubmitTemplateDialog.tsx`
- Create: `src/components/templates/TemplateOriginLine.tsx`
- Create: `src/components/templates/AppTemplateBar.tsx`
- Create: `src/components/templates/MyTemplatesList.tsx`
- Modify: `src/routes/app/index.tsx`: render `AppTemplateBar` after the page `<title>` (line 663).
- Modify: `src/routes/chat/chat.tsx`: a More actions item, plus the dialog after `{showLimitDialog}`.
- Modify: `src/routes/profile.tsx`: a Templates tab.
- Test: `src/routes/templates-creator-guard.test.ts`

**Interfaces:**
- Consumes:
  - from Task 11: `useAppTemplate`, `useSubmitTemplate`, `useWithdrawTemplateVersion`, `useSetTemplateListing`, `useMyTemplates`, `templateStatusView` and `formatTemplatePrice`;
  - `AppDetailsData.fromTemplate` from Task 9.
- Produces:
  - `SubmitTemplateDialog({ appId, appTitle, open, onOpenChange })`;
  - `TemplateOriginLine({ origin })`;
  - `AppTemplateBar({ appId, appTitle, origin, canManage })`;
  - `MyTemplatesList()`.

- [ ] **Step 1: Write the failing wiring test**

Create `src/routes/templates-creator-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/app/index.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/routes/profile.tsx',
		'/src/components/templates/SubmitTemplateDialog.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: creators', () => {
	it('shows the template bar on the app page for Think owners and template copies', () => {
		const app = source('/src/routes/app/index.tsx');
		expect(app).toContain('<AppTemplateBar');
		expect(app).toContain('canManage={isOwner && isThink}');
		expect(app).toContain('origin={app.fromTemplate}');
	});

	it('offers Submit as template in the chat header for Think owners', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain("isOwner && behaviorType === 'think'");
		expect(chat).toContain('<SubmitTemplateDialog');
	});

	it('lists the creator templates on the profile', () => {
		const profile = source('/src/routes/profile.tsx');
		expect(profile).toContain("{ value: 'templates', label: 'Templates' }");
		expect(profile).toContain('<MyTemplatesList />');
	});

	it('requires the rights confirmation before submitting', () => {
		const dialog = source('/src/components/templates/SubmitTemplateDialog.tsx');
		expect(dialog).toContain('I own the rights to this content and allow others to copy and adapt it.');
		expect(dialog).toContain('disabled={!rightsConfirmed}');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/templates-creator-guard.test.ts`
Expected: FAIL, with `Source not found: /src/components/templates/SubmitTemplateDialog.tsx`.

- [ ] **Step 3: Write the submit dialog**

Create `src/components/templates/SubmitTemplateDialog.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, InputArea, Loader } from '@cloudflare/kumo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppTemplate, useSubmitTemplate } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import {
	formatTemplatePrice,
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	TEMPLATE_PRICE_OPTIONS_CENTS,
	type SubmitTemplateRequest,
	type TemplateCategory,
} from '@/api-types';

interface SubmitTemplateDialogProps {
	appId: string;
	appTitle: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function SubmitTemplateDialog({ appId, appTitle, open, onOpenChange }: SubmitTemplateDialogProps) {
	const status = useAppTemplate(appId, open);
	const submit = useSubmitTemplate(appId);
	const [name, setName] = useState(appTitle);
	const [description, setDescription] = useState('');
	const [category, setCategory] = useState<TemplateCategory>('landing');
	const [priceCents, setPriceCents] = useState<number>(0);
	const [rightsConfirmed, setRightsConfirmed] = useState(false);

	const existing = status.data?.template ?? null;
	const pendingDetail = existing ? templateStatusView(existing) : null;
	const inReview = Boolean(pendingDetail?.pendingVersionId);
	const nextVersion = existing ? (existing.versions[0]?.version ?? 0) + 1 : 1;

	const handleSubmit = () => {
		const body: SubmitTemplateRequest = existing
			? { rightsConfirmed }
			: { name, description, category, priceCents, rightsConfirmed };
		submit.mutate(body, {
			onSuccess: (data) => {
				toast.success(`Version ${data.version} was submitted for review`);
				setRightsConfirmed(false);
				onOpenChange(false);
			},
			onError: (error) => toast.error(error.message),
		});
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{existing ? `Submit version ${nextVersion} of ${existing.name}` : 'Submit as template'}
					</DialogTitle>
					<DialogDescription>
						We freeze a copy of your last deployed version. An Estori admin reviews it before it appears in the
						template gallery.
					</DialogDescription>
				</DialogHeader>

				{status.isLoading ? (
					<div className="flex justify-center py-6">
						<Loader />
					</div>
				) : status.isError ? (
					<p className="text-sm text-kumo-subtle">{status.error.message}</p>
				) : !status.data?.eligible ? (
					<p className="text-sm text-kumo-subtle">{status.data?.reason ?? 'This app cannot be submitted yet.'}</p>
				) : inReview ? (
					<p className="text-sm text-kumo-subtle">
						{pendingDetail?.detail}. You can submit again after it is reviewed or withdrawn.
					</p>
				) : (
					<div className="grid gap-4">
						{!existing && (
							<>
								<Input
									id="template-name"
									label="Name"
									value={name}
									maxLength={60}
									onChange={(event) => setName(event.target.value)}
								/>
								<InputArea
									id="template-description"
									label="Short description"
									placeholder="What the site is for and what makes it good to start from"
									value={description}
									maxLength={280}
									onChange={(event) => setDescription(event.target.value)}
								/>
								<div className="grid grid-cols-2 gap-3">
									<div className="grid gap-1.5">
										<span className="text-sm font-medium text-kumo-default">Category</span>
										<Select
											value={category}
											onValueChange={(value) => {
												const match = TEMPLATE_CATEGORIES.find((candidate) => candidate === value);
												if (match) setCategory(match);
											}}
										>
											<SelectTrigger aria-label="Category">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
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
										Payments are in test mode. Buyers are not charged yet.
									</p>
								)}
							</>
						)}
						<label className="flex items-start gap-2 text-sm text-kumo-default">
							<Checkbox
								checked={rightsConfirmed}
								onCheckedChange={(checked) => setRightsConfirmed(checked === true)}
							/>
							<span>I own the rights to this content and allow others to copy and adapt it.</span>
						</label>
						<div className="flex justify-end">
							<Button
								variant="primary"
								loading={submit.isPending}
								disabled={!rightsConfirmed}
								onClick={handleSubmit}
							>
								Submit for review
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
```

- [ ] **Step 4: Write the origin line, the app bar and the creator list**

Create `src/components/templates/TemplateOriginLine.tsx`:

```tsx
import { Link } from 'react-router';
import type { TemplateOrigin } from '@/api-types';

export function TemplateOriginLine({ origin }: { origin: TemplateOrigin }) {
	return (
		<p className="text-sm text-kumo-subtle">
			Started from template{' '}
			{origin.listed ? (
				<Link to={`/templates/${origin.slug}`} className="text-kumo-default underline-offset-2 hover:underline">
					{origin.name}
				</Link>
			) : (
				<span className="text-kumo-default">{origin.name}</span>
			)}{' '}
			by {origin.creatorName}
		</p>
	);
}
```

Create `src/components/templates/AppTemplateBar.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button } from '@cloudflare/kumo';
import { useAppTemplate, useSetTemplateListing, useWithdrawTemplateVersion } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import type { AppTemplateData, TemplateOrigin } from '@/api-types';
import { SubmitTemplateDialog } from './SubmitTemplateDialog';
import { TemplateOriginLine } from './TemplateOriginLine';

interface AppTemplateBarProps {
	appId: string;
	appTitle: string;
	origin: TemplateOrigin | null;
	/** The viewer owns this Think app and may submit it. */
	canManage: boolean;
}

/** The app page strip for template origin and the owner's template status and actions. */
export function AppTemplateBar({ appId, appTitle, origin, canManage }: AppTemplateBarProps) {
	const status = useAppTemplate(appId, canManage);
	const data = canManage ? status.data : undefined;
	const showActions = !!data && (data.eligible || data.template !== null);
	if (!origin && !showActions) return null;

	return (
		<div className="shrink-0 flex flex-wrap items-center justify-between gap-2 border-b bg-kumo-base px-4 py-2">
			{origin ? <TemplateOriginLine origin={origin} /> : <span />}
			{showActions && data && <TemplateActions appId={appId} appTitle={appTitle} data={data} />}
		</div>
	);
}

function TemplateActions({ appId, appTitle, data }: { appId: string; appTitle: string; data: AppTemplateData }) {
	const withdraw = useWithdrawTemplateVersion();
	const listing = useSetTemplateListing();
	const [dialogOpen, setDialogOpen] = useState(false);
	const template = data.template;
	const view = template ? templateStatusView(template) : null;
	const pendingVersionId = view?.pendingVersionId ?? null;
	const canSubmit = data.eligible && pendingVersionId === null;

	return (
		<div className="flex flex-wrap items-center gap-2">
			{view && (
				<>
					<span className="text-sm text-kumo-subtle">Template</span>
					<Badge variant={view.variant}>{view.label}</Badge>
					{view.detail && <span className="text-sm text-kumo-subtle">{view.detail}</span>}
				</>
			)}
			{template && pendingVersionId && (
				<Button
					size="sm"
					variant="ghost"
					loading={withdraw.isPending}
					onClick={() =>
						withdraw.mutate(
							{ templateId: template.id, versionId: pendingVersionId },
							{ onError: (error) => toast.error(error.message) },
						)
					}
				>
					Withdraw
				</Button>
			)}
			{template && view?.canUnlist && (
				<Button
					size="sm"
					variant="ghost"
					loading={listing.isPending}
					onClick={() =>
						listing.mutate(
							{ templateId: template.id, listed: false },
							{ onError: (error) => toast.error(error.message) },
						)
					}
				>
					Unlist
				</Button>
			)}
			{canSubmit && (
				<Button size="sm" variant="secondary" onClick={() => setDialogOpen(true)}>
					{template ? 'Submit new version' : 'Submit as template'}
				</Button>
			)}
			<SubmitTemplateDialog appId={appId} appTitle={appTitle} open={dialogOpen} onOpenChange={setDialogOpen} />
		</div>
	);
}
```

Create `src/components/templates/MyTemplatesList.tsx`:

```tsx
import { useNavigate } from 'react-router';
import { Badge, Button, Empty, Loader } from '@cloudflare/kumo';
import { SquaresFourIcon } from '@phosphor-icons/react';
import { useMyTemplates } from '@/hooks/use-templates';
import { templateStatusView } from '@/lib/template-display';
import { formatTemplatePrice } from '@/api-types';

export function MyTemplatesList() {
	const navigate = useNavigate();
	const mine = useMyTemplates();

	if (mine.isLoading) {
		return (
			<div className="flex justify-center py-10">
				<Loader />
			</div>
		);
	}
	if (mine.isError) {
		return <Empty size="sm" title="Templates didn't load" description={mine.error.message} />;
	}
	const templates = mine.data?.templates ?? [];
	if (templates.length === 0) {
		return (
			<Empty
				size="sm"
				icon={<SquaresFourIcon size={40} weight="duotone" className="text-kumo-inactive" />}
				title="No templates yet"
				description="Open one of your deployed apps and choose Submit as template."
			/>
		);
	}

	return (
		<div className="grid gap-3">
			{templates.map((template) => {
				const view = templateStatusView(template);
				const versionCount = template.versions.length;
				return (
					<div
						key={template.id}
						className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-3 ring ring-kumo-hairline"
					>
						<div className="grid min-w-0 gap-0.5">
							<p className="truncate text-sm font-medium text-kumo-default">{template.name}</p>
							<p className="text-sm text-kumo-subtle">
								{formatTemplatePrice(template.priceCents)} · {versionCount} version{versionCount === 1 ? '' : 's'} ·{' '}
								{template.useCount} uses{view.detail ? ` · ${view.detail}` : ''}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant={view.variant}>{view.label}</Badge>
							{template.status === 'listed' && (
								<Button size="sm" variant="ghost" onClick={() => navigate(`/templates/${template.slug}`)}>
									View
								</Button>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 5: Wire the components into the pages**

In `src/routes/app/index.tsx`:
- add `import { AppTemplateBar } from '@/components/templates/AppTemplateBar';`;
- directly after `<title>{pageTitle(app.title || 'App')}</title>` in the main return, add:

```tsx
			<AppTemplateBar
				appId={app.id}
				appTitle={app.title}
				origin={app.fromTemplate}
				canManage={isOwner && isThink}
			/>
```

In `src/routes/chat/chat.tsx`:
- add `SquaresFourIcon` to the `@phosphor-icons/react` import;
- add `import { SubmitTemplateDialog } from '@/components/templates/SubmitTemplateDialog';`;
- after `const [isGitCloneModalOpen, setIsGitCloneModalOpen] = useState(false);`, add:

```tsx
	const [isTemplateDialogOpen, setIsTemplateDialogOpen] = useState(false);
```

- in the header's More actions `<DropdownMenu.Content align="end">`, add this item before the `Clone` item:

```tsx
								{isOwner && behaviorType === 'think' && (
									<DropdownMenu.Item
										icon={SquaresFourIcon}
										onClick={() => setIsTemplateDialogOpen(true)}
									>
										Submit as template
									</DropdownMenu.Item>
								)}
```

- directly after `{showLimitDialog}`, add:

```tsx

				{app && isOwner && (
					<SubmitTemplateDialog
						appId={app.id}
						appTitle={app.title}
						open={isTemplateDialogOpen}
						onOpenChange={setIsTemplateDialogOpen}
					/>
				)}
```

In `src/routes/profile.tsx`:
- add `import { MyTemplatesList } from '@/components/templates/MyTemplatesList';`;
- add `{ value: 'templates', label: 'Templates' },` to the `tabs` array, after the `apps` tab;
- after the `{activeTab === 'apps' && ( ... )}` block, add:

```tsx

					{activeTab === 'templates' && (
						<LayerCard>
							<LayerCard.Secondary className="font-funky-mono tracking-tighter">
								My templates
							</LayerCard.Secondary>
							<LayerCard.Primary>
								<MyTemplatesList />
							</LayerCard.Primary>
						</LayerCard>
					)}
```

- [ ] **Step 6: Run the tests, the typecheck and the lint**

Run: `npx vitest run src/routes/templates-creator-guard.test.ts && npm run typecheck && npx eslint src/components/templates src/routes/app/index.tsx src/routes/chat/chat.tsx src/routes/profile.tsx`
Expected: PASS (4 tests), with no type errors and no lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/templates/SubmitTemplateDialog.tsx src/components/templates/TemplateOriginLine.tsx src/components/templates/AppTemplateBar.tsx src/components/templates/MyTemplatesList.tsx src/routes/app/index.tsx src/routes/chat/chat.tsx src/routes/profile.tsx src/routes/templates-creator-guard.test.ts
git commit -m "feat(templates): let creators submit, track, withdraw and unlist templates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Admin review page

**Files:**
- Create: `src/routes/admin/templates.tsx`
- Modify: `src/routes.tsx`
- Test: `src/routes/templates-admin-guard.test.ts`

**Interfaces:**
- Consumes:
  - from Task 11: `usePendingTemplateVersions`, `useReviewTemplateVersion`, `useTemplateVersionFiles`, `useTemplateVersionFile` and `formatFileSize`;
  - `formatTemplatePrice` and `TEMPLATE_CATEGORY_LABELS`.
- Produces: a page at `/admin/templates`, inside `ProtectedRoute`.

- [ ] **Step 1: Write the failing wiring test**

Create `src/routes/templates-admin-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes.tsx', '/src/routes/admin/templates.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('templates: admin review', () => {
	it('registers the review page behind sign-in', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'admin/templates'");
		expect(routes).toContain('<AdminTemplatesPage />');
	});

	it('approves, and rejects only with a reason', () => {
		const page = source('/src/routes/admin/templates.tsx');
		expect(page).toContain("decision: 'approve'");
		expect(page).toContain("decision: 'reject', reason");
		expect(page).toContain('disabled={!reason.trim()}');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/templates-admin-guard.test.ts`
Expected: FAIL, with `Source not found: /src/routes/admin/templates.tsx`.

- [ ] **Step 3: Write the review page**

Create `src/routes/admin/templates.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Badge, Button, Empty, InputArea, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import {
	usePendingTemplateVersions,
	useReviewTemplateVersion,
	useTemplateVersionFile,
	useTemplateVersionFiles,
} from '@/hooks/use-templates';
import { formatFileSize } from '@/lib/template-display';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS, type PendingTemplateVersion } from '@/api-types';

export default function AdminTemplatesPage() {
	const pending = usePendingTemplateVersions();

	return (
		<div className="size-full">
			<title>{pageTitle('Template review')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<h1 className="text-3xl font-semibold text-kumo-strong">Template review</h1>
					<p className="text-kumo-subtle">
						Approve templates that belong in the gallery. A rejection needs a reason the creator will see.
					</p>
				</div>
				{pending.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : pending.isError ? (
					<Empty title="Admins only" description={pending.error.message} />
				) : pending.data && pending.data.versions.length > 0 ? (
					pending.data.versions.map((version) => <PendingVersionCard key={version.versionId} version={version} />)
				) : (
					<Empty title="Nothing to review" description="New submissions will show up here." />
				)}
			</div>
		</div>
	);
}

function PendingVersionCard({ version }: { version: PendingTemplateVersion }) {
	const review = useReviewTemplateVersion();
	const [showFiles, setShowFiles] = useState(false);
	const [rejecting, setRejecting] = useState(false);
	const [reason, setReason] = useState('');
	const label = `${version.templateName} v${version.version}`;

	const approve = () =>
		review.mutate(
			{ versionId: version.versionId, decision: 'approve' },
			{
				onSuccess: () => toast.success(`${label} is published`),
				onError: (error) => toast.error(error.message),
			},
		);

	const reject = () =>
		review.mutate(
			{ versionId: version.versionId, decision: 'reject', reason },
			{
				onSuccess: () => toast.success(`${label} was rejected`),
				onError: (error) => toast.error(error.message),
			},
		);

	return (
		<LayerCard>
			<LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
				<span className="font-medium">{label}</span>
				<Badge variant={version.priceCents > 0 ? 'info' : 'success'}>{formatTemplatePrice(version.priceCents)}</Badge>
			</LayerCard.Secondary>
			<LayerCard.Primary>
				<div className="grid gap-4">
					<div className="grid gap-4 md:grid-cols-[1fr_160px]">
						<img
							src={version.desktopShotUrl}
							alt={`${version.templateName} on a desktop`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
						<img
							src={version.mobileShotUrl}
							alt={`${version.templateName} on a phone`}
							className="w-full rounded-lg ring ring-kumo-hairline"
						/>
					</div>
					<div className="grid gap-1 text-sm">
						<p className="text-kumo-default">{version.description}</p>
						<p className="text-kumo-subtle">
							{TEMPLATE_CATEGORY_LABELS[version.category]} · {version.fileCount} files ·{' '}
							{formatFileSize(version.totalBytes)}
						</p>
						<p className="text-kumo-subtle">
							By {version.creatorName}
							{version.creatorEmail ? ` (${version.creatorEmail})` : ''}
							{version.submittedAt ? ` · submitted ${new Date(version.submittedAt).toLocaleString()}` : ''}
						</p>
						{version.sourceAppId && (
							<Link
								to={`/app/${version.sourceAppId}`}
								className="w-fit text-kumo-default underline-offset-2 hover:underline"
							>
								Open the source app
							</Link>
						)}
					</div>
					<div className="grid gap-2">
						<Button size="sm" variant="ghost" className="w-fit" onClick={() => setShowFiles((open) => !open)}>
							{showFiles ? 'Hide files' : 'Show files'}
						</Button>
						{showFiles && <SnapshotFiles versionId={version.versionId} />}
					</div>
					{rejecting ? (
						<div className="grid gap-2">
							<InputArea
								id={`reject-${version.versionId}`}
								label="Reason for the creator"
								value={reason}
								maxLength={500}
								onChange={(event) => setReason(event.target.value)}
							/>
							<div className="flex justify-end gap-2">
								<Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
									Cancel
								</Button>
								<Button
									size="sm"
									variant="destructive"
									loading={review.isPending}
									disabled={!reason.trim()}
									onClick={reject}
								>
									Reject
								</Button>
							</div>
						</div>
					) : (
						<div className="flex justify-end gap-2">
							<Button size="sm" variant="secondary-destructive" onClick={() => setRejecting(true)}>
								Reject
							</Button>
							<Button size="sm" variant="primary" loading={review.isPending} onClick={approve}>
								Approve
							</Button>
						</div>
					)}
				</div>
			</LayerCard.Primary>
		</LayerCard>
	);
}

/** The frozen files of a version, with a read-only viewer for one file. */
function SnapshotFiles({ versionId }: { versionId: string }) {
	const files = useTemplateVersionFiles(versionId);
	const [selected, setSelected] = useState<string | null>(null);
	const file = useTemplateVersionFile(versionId, selected);

	if (files.isLoading) return <Loader />;
	if (files.isError) return <p className="text-sm text-kumo-subtle">{files.error.message}</p>;

	return (
		<div className="grid gap-3 md:grid-cols-[260px_1fr]">
			<ul className="max-h-80 overflow-auto rounded-lg text-sm ring ring-kumo-hairline">
				{files.data?.files.map((entry) => (
					<li key={entry.path}>
						<button
							type="button"
							onClick={() => setSelected(entry.path)}
							className="flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-kumo-elevated"
						>
							<span className="truncate font-mono text-xs">{entry.path}</span>
							<span className="shrink-0 text-xs text-kumo-subtle">{formatFileSize(entry.bytes)}</span>
						</button>
					</li>
				))}
			</ul>
			<div className="max-h-80 overflow-auto rounded-lg ring ring-kumo-hairline">
				{!selected ? (
					<p className="p-3 text-sm text-kumo-subtle">Choose a file to read it.</p>
				) : file.isLoading ? (
					<div className="p-3">
						<Loader />
					</div>
				) : file.data?.binary ? (
					<p className="p-3 text-sm text-kumo-subtle">Binary file ({formatFileSize(file.data.bytes)})</p>
				) : (
					<pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs">{file.data?.content}</pre>
				)}
			</div>
		</div>
	);
}
```

- [ ] **Step 4: Register the page**

In `src/routes.tsx`:
- add `import AdminTemplatesPage from './routes/admin/templates';`;
- add this child after the `templates/:slug` route:

```tsx
			{
				path: 'admin/templates',
				element: (
					<ProtectedRoute>
						<AdminTemplatesPage />
					</ProtectedRoute>
				),
			},
```

- [ ] **Step 5: Run the tests, the typecheck and the lint**

Run: `npx vitest run src/routes/templates-admin-guard.test.ts && npm run typecheck && npx eslint src/routes/admin src/routes.tsx`
Expected: PASS (2 tests), with no type errors and no lint errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/templates.tsx src/routes.tsx src/routes/templates-admin-guard.test.ts
git commit -m "feat(templates): add the admin review page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Verification and a local end-to-end run with free and paid test templates

The controller runs this task, not an implementer subagent. It needs the local dev setup (deploy token, Artifacts namespace and capture sidecar) and the browser.

**Files:** none changed, unless verification finds a defect. Fix any defect test-first and commit it separately.

- [ ] **Step 1: Run the whole suite**

Run: `npm test > .superpowers/sdd/templates-suite.log 2>&1; tail -40 .superpowers/sdd/templates-suite.log`
Expected: every test file passes. For any failure, run the same file at `origin/main` in a scratch worktree (`git worktree add`) to see whether it predates this branch. Report pre-existing failures by name.

- [ ] **Step 2: Typecheck, lint and build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: no errors. The build includes `space` and Vite.

- [ ] **Step 3: Apply the migration locally**

Run: `npm run db:migrate:local`
Expected: `0009_*` is applied. Check that the admin promotion ran:

```bash
npx wrangler d1 execute vibesdk-db --local --command "SELECT email, role FROM users WHERE role = 'admin'"
```

If `alastrat@pluriza.com` has no local account, sign in locally once with that email (local sign-in is email-only) and run:

```bash
npx wrangler d1 execute vibesdk-db --local --command "UPDATE users SET role = 'admin' WHERE email = 'alastrat@pluriza.com'"
```

- [ ] **Step 4: Run the flow in a browser against local dev**

Start dev as described in the session memory: the deploy token env, port 8100, and the capture sidecar via `npm run dev:browser`. Then:

1. As a creator account, build or open two deployed Think apps.
2. Submit one as a free template (category `landing`).
3. Submit the other as a paid template at $29 (category `store`).
4. Confirm that each app shows `In review`, and that a second submit is refused while in review.
5. As `alastrat@pluriza.com`, open `/admin/templates`. Confirm that both pending versions show screenshots and files.
6. Reject one with a reason. Confirm that the creator sees `Rejected` and the reason.
7. Resubmit it as version 2, then approve both.
8. As a third account, confirm both templates appear in `/templates` and in the home strip.
9. Use the free template with a description. The app opens with the copy deployed, and the first turn personalizes it.
10. Use the free template again without a description. The result is an exact copy titled `{name} copy`, and no turn runs.
11. Open the paid template. Confirm the button reads `Buy for $29` and the test-mode note shows. Buy it, then use it.
12. Unlist one template as the creator. Confirm it disappears from the gallery while the app made from it keeps working.

- [ ] **Step 5: Record the results**

Write what passed, what failed and the fixes made to the ledger. Every defect found here is fixed test-first, with its own commit.
