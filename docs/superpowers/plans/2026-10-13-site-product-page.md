# Product Pages for Discover Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Discover site a public, shareable product page at `/discover/:appId`.
- The page shows a live device-frame preview and AI-drafted, creator-edited page text.
- A paid site's Buy button goes through the page before Stripe Checkout.

**Architecture:**
- **Shared rules:** one shared module, `shared/types/site-page.ts`, defines the page-text shape, limits and validation, and both the worker and the frontend use it.
- **Storage:** a creator's latest text lives in a new `site_pages` table. Paid sites also attach their text to each reviewed `template_versions` row, so the page shows the approved version's text.
- **Endpoints:**
  - a public endpoint assembles the page;
  - a public screenshot route serves the approved version's images;
  - an owner-only endpoint drafts text with the platform's lite model.
- **Frontend:**
  - a new route renders the page;
  - the publish dialog gains a "Page" section;
  - Discover, the home strip and the app page's Buy button link to the page.

**Tech Stack:**
- Cloudflare Workers with Hono, D1 through drizzle, R2.
- React 19, TanStack Query 5, Kumo UI, React Router v7.
- Vitest with `@cloudflare/vitest-pool-workers`.
- The worker's `executeInference` with zod schemas.

**Spec:** `docs/superpowers/specs/2026-10-13-site-product-page-design.md`

## Global Constraints

**Repo rules** (CLAUDE.md):
- No `any`. Frontend types come only from `@/api-types`.
- Comments are concise and about purpose. No emojis.
- File names: React components in PascalCase `.tsx`, utilities and hooks in kebab-case `.ts`, backend services in PascalCase `.ts`.

**Commits:**
- Subjects are lowercase conventional commits and end with the harness `Co-Authored-By` trailer.
- Stage explicit paths only. Never stage `wrangler.jsonc`, `.dev.vars` or `bun.lockb`.

**Checks:**
- The worker typecheck, `npx tsc -p tsconfig.worker.json --noEmit`, must be clean.
- The app typecheck, `npx tsc -p tsconfig.app.json --noEmit`, may show only the 4 accepted `packages/artifacts-viewer` errors.
- Run only the test files a task names, with `npx vitest run <files>`; never the whole suite.

**Page text:** it is plain text and renders as text only, never HTML or markdown, and never through `dangerouslySetInnerHTML`.

**Limits, verbatim from the spec:**

| Field | Rule |
|---|---|
| `tagline` | 1–90 characters |
| `about` | 1–3 paragraphs, 1,200 characters in total |
| `features` | 3–8 items, each 1–80 characters |
| `includes` | 1–12 items, each `{ name: 1–40, detail: 1–100 }` characters |
| `madeFor` | 2–5 items, each 1–40 characters |

Normalization: every value is trimmed, collapses repeated whitespace, and has control characters removed.

**User-facing strings, used verbatim:**
- "This site isn't available"
- "Couldn't draft this page; write it yourself or try again"
- "Your page text is in review"
- "Not available yet"
- "Open live site ↗"
- "Edit page"
- "Use this site"
- "Secure checkout with Stripe"
- "What you get: your own copy of the full site, which you can keep editing with the AI."
- "Drafting…"
- "Redraft with AI"

**Rate limits:**
- Drafts: at most 10 per user per hour.
- The page endpoint uses the existing `publicApps` limit.

**Screenshots:** the approved-screenshot cache header is `Cache-Control: public, max-age=86400`.

## Plan decisions (refinements of the spec, confirmed against the code)

1. **Screenshot kinds.** Screenshot routes use the existing kinds `desktop` and `mobile` (`TemplateShotKind`), not `phone`.
2. **Drafting model.** Drafting reuses the `templateSelection` lite model through `executeInference`, as `worker/agents/planning/templateSelector.ts` already does for project-type prediction. A new `AgentActionKey` would have to be added to every config variant and to the user model settings.
3. **No `drafted_at` column.** `site_pages` has no `drafted_at`, because drafts are never stored, only saved text.
4. **List fields are plain text areas.** The dialog edits Features and Made for one per line, What's included as `Name: line` per line, and About as paragraphs separated by a blank line. Lines are added, removed and reordered by editing the text.
5. **"Edit page" opens in place.** It opens the publish dialog on the product page itself instead of navigating to the app page.
6. **Preview fallback.** The live preview falls back to the site's screenshot when there is no preview URL, or when the frame hasn't loaded within 15 seconds.
7. **Older publish requests.** A request without `pageCopy`, such as the chat header's "Make public" button, keeps the saved text and never triggers a paid re-review. `null` clears the text.

## Review Focus

1. **Pending text on a paid site:** while a newer version is in review, the page keeps showing the approved version's text, not the pending or saved text. Pinned in Task 4 (`sitePageDto.test.ts`).
2. **Signed-out visitors:** the page loads signed out, and Buy or Use asks them to sign in instead of failing. Pinned in Task 4 (public route wiring) and Task 8 (`requireAuth` on the page).
3. **AI output that breaks a limit twice:** returns 502 with the draft-failed message and saves nothing. Pinned in Task 5 (`draft.test.ts`).
4. **Publish requests without `pageCopy`:** they never clear the saved text and never send a paid site back to review. Pinned in Task 3 (`reuse.test.ts`, `publish.test.ts`).
5. **A site whose preview can't be produced** (agent error, never deployed):
   - the page still loads, with a screenshot fallback;
   - a free undeployed site reads "Not available yet";
   - an unapproved version's screenshots never leak.
   Pinned in Task 4 (`sitePageDto.test.ts`).

---

### Task 1: Shared page-text rules

**Files:**
- Create: `shared/types/site-page.ts`
- Test: `shared/types/site-page.test.ts`
- Modify: `src/api-types.ts`, after the `shared/types/templates.js` exports (around line 269)

**Interfaces:**
- Produces:
  - types: `SitePageInclude`, `SitePageCopy`, `SitePageField`, `PageCopyValidation`;
  - constants: `SITE_PAGE_LIMITS`, `SITE_PAGE_UNAVAILABLE_MESSAGE`, `PAGE_DRAFT_FAILED_MESSAGE`;
  - functions:
    - `normalizeText(value: string): string`
    - `normalizePageCopy(raw: unknown): SitePageCopy | null`
    - `validatePageCopy(raw: unknown): PageCopyValidation`
    - `samePageCopy(a: SitePageCopy | null, b: SitePageCopy | null): boolean`
    - `parseStoredPageCopy(json: string | null): SitePageCopy | null`

- [ ] **Step 1: Write the failing test**

Create `shared/types/site-page.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	normalizePageCopy,
	normalizeText,
	parseStoredPageCopy,
	samePageCopy,
	validatePageCopy,
	type SitePageCopy,
} from './site-page';

const VALID: SitePageCopy = {
	tagline: 'A calm one-page site for a small yoga studio',
	about: ['Lumen is a one-page site with a weekly schedule.', 'It loads fast and reads well on phones.'],
	features: ['Weekly class schedule', 'Three pricing plans', 'Instructor bios'],
	includes: [{ name: 'Home', detail: 'Hero, schedule, pricing and bios on one page' }],
	madeFor: ['Yoga studios', 'Pilates teachers'],
};

function repeat(length: number): string {
	return 'x'.repeat(length);
}

describe('normalizeText', () => {
	it('trims, collapses whitespace and drops control characters', () => {
		expect(normalizeText('  Hello\n\n  world\u0007 ')).toBe('Hello world');
	});
});

describe('validatePageCopy', () => {
	it('accepts page text within every limit', () => {
		expect(validatePageCopy(VALID)).toEqual({ ok: true, value: VALID });
	});

	it('normalizes before validating and drops empty list entries', () => {
		const result = validatePageCopy({ ...VALID, tagline: '  Calm   site ', features: ['A', ' ', 'B', 'C'] });
		expect(result).toEqual({ ok: true, value: { ...VALID, tagline: 'Calm site', features: ['A', 'B', 'C'] } });
	});

	it('rejects malformed input', () => {
		expect(validatePageCopy(null)).toEqual({ ok: false, field: null, error: 'Page text is malformed' });
		expect(validatePageCopy({ ...VALID, features: 'one' })).toEqual({ ok: false, field: null, error: 'Page text is malformed' });
		expect(validatePageCopy({ ...VALID, includes: [{ name: 'Home' }] })).toEqual({
			ok: false,
			field: null,
			error: 'Page text is malformed',
		});
	});

	it('holds the tagline to 1-90 characters', () => {
		expect(validatePageCopy({ ...VALID, tagline: repeat(90) }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, tagline: repeat(91) })).toEqual({
			ok: false,
			field: 'tagline',
			error: 'Keep the tagline to 90 characters or fewer',
		});
		expect(validatePageCopy({ ...VALID, tagline: '  ' })).toEqual({ ok: false, field: 'tagline', error: 'Add a tagline' });
	});

	it('holds About to 1-3 paragraphs and 1,200 characters', () => {
		expect(validatePageCopy({ ...VALID, about: [repeat(400), repeat(400), repeat(400)] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, about: [repeat(400), repeat(400), repeat(401)] })).toEqual({
			ok: false,
			field: 'about',
			error: 'Keep About to 1,200 characters or fewer',
		});
		expect(validatePageCopy({ ...VALID, about: [] })).toEqual({
			ok: false,
			field: 'about',
			error: 'Write 1 to 3 paragraphs about the site',
		});
		expect(validatePageCopy({ ...VALID, about: ['a', 'b', 'c', 'd'] }).ok).toBe(false);
	});

	it('holds features to 3-8 items of up to 80 characters', () => {
		expect(validatePageCopy({ ...VALID, features: ['a', 'b'] })).toEqual({
			ok: false,
			field: 'features',
			error: 'List 3 to 8 features',
		});
		expect(validatePageCopy({ ...VALID, features: Array.from({ length: 9 }, (_, i) => `f${i}`) }).ok).toBe(false);
		expect(validatePageCopy({ ...VALID, features: ['a', 'b', repeat(80)] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, features: ['a', 'b', repeat(81)] })).toEqual({
			ok: false,
			field: 'features',
			error: 'Keep each feature to 80 characters or fewer',
		});
	});

	it('holds What is included to 1-12 named items', () => {
		const item = { name: repeat(40), detail: repeat(100) };
		expect(validatePageCopy({ ...VALID, includes: [item] }).ok).toBe(true);
		expect(validatePageCopy({ ...VALID, includes: [] })).toEqual({
			ok: false,
			field: 'includes',
			error: 'List 1 to 12 pages or sections',
		});
		expect(validatePageCopy({ ...VALID, includes: Array.from({ length: 13 }, () => ({ name: 'a', detail: 'b' })) }).ok).toBe(false);
		const tooLong = 'Give each page or section a name of up to 40 characters and a line of up to 100';
		expect(validatePageCopy({ ...VALID, includes: [{ name: repeat(41), detail: 'b' }] })).toEqual({
			ok: false,
			field: 'includes',
			error: tooLong,
		});
		expect(validatePageCopy({ ...VALID, includes: [{ name: 'a', detail: '' }] })).toEqual({
			ok: false,
			field: 'includes',
			error: tooLong,
		});
	});

	it('holds Made for to 2-5 items of up to 40 characters', () => {
		expect(validatePageCopy({ ...VALID, madeFor: ['a'] })).toEqual({
			ok: false,
			field: 'madeFor',
			error: 'List 2 to 5 kinds of people or businesses it is made for',
		});
		expect(validatePageCopy({ ...VALID, madeFor: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false);
		expect(validatePageCopy({ ...VALID, madeFor: ['a', repeat(41)] })).toEqual({
			ok: false,
			field: 'madeFor',
			error: 'Keep each "Made for" item to 40 characters or fewer',
		});
	});
});

describe('samePageCopy and parseStoredPageCopy', () => {
	it('compares normalized text, and treats two empty values as equal', () => {
		expect(samePageCopy(VALID, { ...VALID, tagline: ` ${VALID.tagline} ` })).toBe(true);
		expect(samePageCopy(VALID, { ...VALID, features: [...VALID.features].reverse() })).toBe(false);
		expect(samePageCopy(null, null)).toBe(true);
		expect(samePageCopy(VALID, null)).toBe(false);
	});

	it('reads stored JSON and ignores anything unreadable', () => {
		expect(parseStoredPageCopy(JSON.stringify(VALID))).toEqual(VALID);
		expect(parseStoredPageCopy(null)).toBeNull();
		expect(parseStoredPageCopy('{not json')).toBeNull();
		expect(parseStoredPageCopy('{"tagline":1}')).toBeNull();
		expect(normalizePageCopy({ ...VALID, extra: true })).toEqual(VALID);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run shared/types/site-page.test.ts`
Expected: FAIL, because `./site-page` doesn't exist.

- [ ] **Step 3: Implement the module**

Create `shared/types/site-page.ts`:

```ts
/**
 * Page text for a Discover site's product page: its shape, limits and the one
 * validation the publish dialog, the drafting endpoint and publishing all use.
 */

export interface SitePageInclude {
	name: string;
	detail: string;
}

export interface SitePageCopy {
	tagline: string;
	/** One to three paragraphs. */
	about: string[];
	features: string[];
	/** Pages or sections of the site. */
	includes: SitePageInclude[];
	madeFor: string[];
}

export type SitePageField = keyof SitePageCopy;

export type PageCopyValidation =
	| { ok: true; value: SitePageCopy }
	| { ok: false; field: SitePageField | null; error: string };

export const SITE_PAGE_LIMITS = {
	tagline: 90,
	aboutParagraphs: { min: 1, max: 3 },
	aboutTotal: 1200,
	features: { min: 3, max: 8, each: 80 },
	includes: { min: 1, max: 12, name: 40, detail: 100 },
	madeFor: { min: 2, max: 5, each: 40 },
} as const;

export const SITE_PAGE_UNAVAILABLE_MESSAGE = "This site isn't available";
export const PAGE_DRAFT_FAILED_MESSAGE = "Couldn't draft this page; write it yourself or try again";

const MALFORMED = 'Page text is malformed';
// Control characters become spaces, then runs of whitespace collapse.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

export function normalizeText(value: string): string {
	return value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

function textList(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const items: string[] = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const text = normalizeText(item);
		if (text) items.push(text);
	}
	return items;
}

/** Normalized page text in its canonical key order, or null when the input isn't page text. */
export function normalizePageCopy(raw: unknown): SitePageCopy | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const about = textList(record.about);
	const features = textList(record.features);
	const madeFor = textList(record.madeFor);
	if (typeof record.tagline !== 'string' || !about || !features || !madeFor || !Array.isArray(record.includes)) {
		return null;
	}
	const includes: SitePageInclude[] = [];
	for (const item of record.includes) {
		if (typeof item !== 'object' || item === null) return null;
		const entry = item as Record<string, unknown>;
		if (typeof entry.name !== 'string' || typeof entry.detail !== 'string') return null;
		const name = normalizeText(entry.name);
		const detail = normalizeText(entry.detail);
		if (name || detail) includes.push({ name, detail });
	}
	return { tagline: normalizeText(record.tagline), about, features, includes, madeFor };
}

function within(count: number, range: { min: number; max: number }): boolean {
	return count >= range.min && count <= range.max;
}

export function validatePageCopy(raw: unknown): PageCopyValidation {
	const copy = normalizePageCopy(raw);
	if (!copy) return { ok: false, field: null, error: MALFORMED };
	const limits = SITE_PAGE_LIMITS;

	if (copy.tagline.length === 0) return { ok: false, field: 'tagline', error: 'Add a tagline' };
	if (copy.tagline.length > limits.tagline) {
		return { ok: false, field: 'tagline', error: 'Keep the tagline to 90 characters or fewer' };
	}
	if (!within(copy.about.length, limits.aboutParagraphs)) {
		return { ok: false, field: 'about', error: 'Write 1 to 3 paragraphs about the site' };
	}
	if (copy.about.reduce((total, paragraph) => total + paragraph.length, 0) > limits.aboutTotal) {
		return { ok: false, field: 'about', error: 'Keep About to 1,200 characters or fewer' };
	}
	if (!within(copy.features.length, limits.features)) {
		return { ok: false, field: 'features', error: 'List 3 to 8 features' };
	}
	if (copy.features.some((feature) => feature.length > limits.features.each)) {
		return { ok: false, field: 'features', error: 'Keep each feature to 80 characters or fewer' };
	}
	if (!within(copy.includes.length, limits.includes)) {
		return { ok: false, field: 'includes', error: 'List 1 to 12 pages or sections' };
	}
	const badInclude = copy.includes.some(
		(item) =>
			item.name.length === 0 ||
			item.detail.length === 0 ||
			item.name.length > limits.includes.name ||
			item.detail.length > limits.includes.detail,
	);
	if (badInclude) {
		return {
			ok: false,
			field: 'includes',
			error: 'Give each page or section a name of up to 40 characters and a line of up to 100',
		};
	}
	if (!within(copy.madeFor.length, limits.madeFor)) {
		return { ok: false, field: 'madeFor', error: 'List 2 to 5 kinds of people or businesses it is made for' };
	}
	if (copy.madeFor.some((item) => item.length > limits.madeFor.each)) {
		return { ok: false, field: 'madeFor', error: 'Keep each "Made for" item to 40 characters or fewer' };
	}
	return { ok: true, value: copy };
}

/** Whether two page texts read the same once normalized; two missing texts are the same. */
export function samePageCopy(a: SitePageCopy | null, b: SitePageCopy | null): boolean {
	const left = a ? normalizePageCopy(a) : null;
	const right = b ? normalizePageCopy(b) : null;
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Page text stored as JSON, or null when it is missing or unreadable. */
export function parseStoredPageCopy(json: string | null): SitePageCopy | null {
	if (!json) return null;
	try {
		return normalizePageCopy(JSON.parse(json));
	} catch {
		return null;
	}
}
```

In `src/api-types.ts`, after the `export { ... } from '../shared/types/templates.js';` block, add:

```ts
export type {
	PageCopyValidation,
	SitePageCopy,
	SitePageField,
	SitePageInclude,
} from '../shared/types/site-page.js';
export {
	PAGE_DRAFT_FAILED_MESSAGE,
	SITE_PAGE_LIMITS,
	SITE_PAGE_UNAVAILABLE_MESSAGE,
	validatePageCopy,
} from '../shared/types/site-page.js';
```

- [ ] **Step 4: Run the tests and typechecks**

Run: `npx vitest run shared/types/site-page.test.ts`
Expected: PASS.

Then run `npx tsc -p tsconfig.worker.json --noEmit`, which must be clean, and `npx tsc -p tsconfig.app.json --noEmit`, which may show only the 4 accepted errors.

- [ ] **Step 5: Commit**

```bash
git add shared/types/site-page.ts shared/types/site-page.test.ts src/api-types.ts
git commit -m "feat(discover): shared rules for product page text"
```

---

### Task 2: Storage for page text

**Files:**
- Modify: `worker/database/schema.ts`:
  - add `sitePages` after `templatePurchases`;
  - add `pageCopy` to `templateVersions`;
  - add the `SitePage` type next to the other `$inferSelect` types.
- Create:
  - `migrations/0011_*.sql` and its `migrations/meta` files, generated by `npm run db:generate`;
  - `worker/database/test-support/recording-d1.ts`;
  - `worker/database/services/SitePageService.ts`.
- Modify:
  - `worker/database/index.ts` (export the service);
  - `worker/database/payments-schema.test.ts` (import the shared recording D1).
- Test: `worker/database/site-pages-schema.test.ts`

**Interfaces:**
- Consumes: `SitePageCopy` and `parseStoredPageCopy` (Task 1).
- Produces:
  - `schema.sitePages` (`appId`, `copy`, `updatedAt`);
  - `schema.templateVersions.pageCopy` (`text`, nullable);
  - `type CreatorSiteRow = { id: string; title: string; screenshotUrl: string | null; priceCents: number | null }`;
  - `SitePageService`, with:
    - `getCopy(appId: string): Promise<SitePageCopy | null>`
    - `saveCopy(appId: string, copy: SitePageCopy | null): Promise<void>`, where null deletes the row
    - `listCreatorSites(creatorUserId: string, excludeAppId: string, limit: number): Promise<CreatorSiteRow[]>`
  - `recordingD1()` from `worker/database/test-support/recording-d1.ts`.

- [ ] **Step 1: Move the recording D1 helper into a shared test-support file**

Create `worker/database/test-support/recording-d1.ts` with the body of the `recordingD1` function currently in `worker/database/payments-schema.test.ts`, exported:

```ts
/** A D1 stand-in that records each statement a service prepares and returns no rows. */
export function recordingD1() {
	const statements: { sql: string; params: unknown[] }[] = [];
	const d1 = {
		batch: async () => [],
		exec: async () => ({ count: 0, duration: 0 }),
		prepare(sql: string) {
			const entry = { sql, params: [] as unknown[] };
			statements.push(entry);
			const statement = {
				bind(...params: unknown[]) {
					entry.params = params;
					return statement;
				},
				all: async () => ({ results: [], success: true, meta: {} }),
				raw: async () => [],
				run: async () => ({ results: [], success: true, meta: {} }),
				first: async () => null,
			};
			return statement;
		},
	};
	return { d1, statements };
}
```

In `worker/database/payments-schema.test.ts`, delete the local `recordingD1` function and add `import { recordingD1 } from './test-support/recording-d1';`. Run `npx vitest run worker/database/payments-schema.test.ts`. Expected: PASS, unchanged.

- [ ] **Step 2: Write the failing test**

Create `worker/database/site-pages-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { SitePageService } from './services/SitePageService';
import { recordingD1 } from './test-support/recording-d1';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

const COPY = {
	tagline: 'A calm site',
	about: ['About it.'],
	features: ['a', 'b', 'c'],
	includes: [{ name: 'Home', detail: 'The one page' }],
	madeFor: ['Studios', 'Teachers'],
};

describe('site page storage', () => {
	it('keeps one page row per app, removed with the app', () => {
		const config = getTableConfig(schema.sitePages);
		expect(config.name).toBe('site_pages');
		expect(config.columns.map((column) => column.name).sort()).toEqual(['app_id', 'copy', 'updated_at']);
		const appId = config.columns.find((column) => column.name === 'app_id');
		expect(appId?.primary).toBe(true);
		expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
	});

	it('stores the text sent with each paid version', () => {
		const column = getTableConfig(schema.templateVersions).columns.find((entry) => entry.name === 'page_copy');
		expect(column?.notNull).toBe(false);
	});

	it('ships the table and column in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `site_pages`');
		expect(allMigrationSql).toContain('ALTER TABLE `template_versions` ADD `page_copy` text');
	});
});

describe('SitePageService', () => {
	it('upserts the saved text as JSON', async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).saveCopy('app1', COPY);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('insert into "site_pages"');
		expect(sql).toContain('on conflict ("app_id") do update');
		expect(statements[0].params).toContain(JSON.stringify(COPY));
	});

	it('deletes the row when the text is cleared', async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).saveCopy('app1', null);
		expect(statements[0].sql.toLowerCase()).toBe('delete from "site_pages" where "site_pages"."app_id" = ?');
		expect(statements[0].params).toEqual(['app1']);
	});

	it("lists the creator's other Discover sites, newest first", async () => {
		const { d1, statements } = recordingD1();
		await new SitePageService({ DB: d1 } as unknown as Env).listCreatorSites('u1', 'app1', 4);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('"apps"."user_id" = ?');
		expect(sql).toContain('"apps"."visibility" = ?');
		expect(sql).toContain('"apps"."id" <> ?');
		expect(sql).toContain('removed_from_discover_at" is null');
		expect(sql).toContain('order by "apps"."updated_at" desc');
		expect(statements[0].params).toEqual(expect.arrayContaining(['u1', 'public', 'app1', 4]));
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run worker/database/site-pages-schema.test.ts`
Expected: FAIL, because `schema.sitePages` and `SitePageService` don't exist.

- [ ] **Step 4: Add the schema, generate the migration, add the service**

In `worker/database/schema.ts`, inside `templateVersions`, add a column after `mobileShotKey`:

```ts
    pageCopy: text('page_copy'), // Page text sent for review with this version (JSON)
```

After the `templatePurchases` table, add:

```ts
/** A site's product page text as the creator last saved it (JSON). Paid sites show their approved version's text instead. */
export const sitePages = sqliteTable('site_pages', {
    appId: text('app_id').primaryKey().references(() => apps.id, { onDelete: 'cascade' }),
    copy: text('copy').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

Next to the other `$inferSelect` exports, add `export type SitePage = typeof sitePages.$inferSelect;`.

Run `npm run db:generate`. Expected: a new `migrations/0011_<name>.sql` containing `CREATE TABLE \`site_pages\`` and `ALTER TABLE \`template_versions\` ADD \`page_copy\` text;`, plus the snapshot and journal updates.

Create `worker/database/services/SitePageService.ts`:

```ts
/** D1 reads and writes for product page text, and the other Discover sites a page links to. */

import { and, desc, eq, ne } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { discoverConditions, paidPriceSubquery } from '../discover-conditions';
import { parseStoredPageCopy, type SitePageCopy } from '../../../shared/types/site-page';

export interface CreatorSiteRow {
    id: string;
    title: string;
    screenshotUrl: string | null;
    /** The approved price of a listed paid listing; null for a free site. */
    priceCents: number | null;
}

export class SitePageService extends BaseService {
    async getCopy(appId: string): Promise<SitePageCopy | null> {
        const row = await this.database
            .select({ copy: schema.sitePages.copy })
            .from(schema.sitePages)
            .where(eq(schema.sitePages.appId, appId))
            .get();
        return parseStoredPageCopy(row?.copy ?? null);
    }

    /** Saves the text, or deletes the row when it is cleared. */
    async saveCopy(appId: string, copy: SitePageCopy | null): Promise<void> {
        if (!copy) {
            await this.database.delete(schema.sitePages).where(eq(schema.sitePages.appId, appId));
            return;
        }
        const json = JSON.stringify(copy);
        const now = new Date();
        await this.database
            .insert(schema.sitePages)
            .values({ appId, copy: json, updatedAt: now })
            .onConflictDoUpdate({ target: schema.sitePages.appId, set: { copy: json, updatedAt: now } });
    }

    async listCreatorSites(creatorUserId: string, excludeAppId: string, limit: number): Promise<CreatorSiteRow[]> {
        return this.database
            .select({
                id: schema.apps.id,
                title: schema.apps.title,
                screenshotUrl: schema.apps.screenshotUrl,
                priceCents: paidPriceSubquery,
            })
            .from(schema.apps)
            .where(
                and(
                    eq(schema.apps.userId, creatorUserId),
                    eq(schema.apps.visibility, 'public'),
                    ne(schema.apps.id, excludeAppId),
                    ...discoverConditions(undefined),
                ),
            )
            .orderBy(desc(schema.apps.updatedAt))
            .limit(limit)
            .all();
    }
}
```

In `worker/database/index.ts`, export `SitePageService` the same way `StripeConnectService` is exported.

- [ ] **Step 5: Run the tests and apply the migration locally**

Run: `npx vitest run worker/database/site-pages-schema.test.ts worker/database/payments-schema.test.ts worker/database/templates-schema.test.ts`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

To apply locally, while the dev server runs on port 8100:
- Send each statement of the new `0011` SQL file, split on `--> statement-breakpoint`, as `POST http://localhost:8100/cdn-cgi/local/explorer/api/d1/database/c4721a2b-b96a-428a-8b2a-b3d255b307e9/raw` with the body `{"sql": "<statement>"}`.
- Then record it with `INSERT INTO d1_migrations (name) VALUES ('<0011 file name>.sql')`.

If the dev server isn't running, use `wrangler d1 migrations apply vibesdk-db --local` with the global wrangler.

- [ ] **Step 6: Commit**

```bash
git add worker/database/schema.ts worker/database/services/SitePageService.ts worker/database/index.ts worker/database/test-support/recording-d1.ts worker/database/payments-schema.test.ts worker/database/site-pages-schema.test.ts migrations
git commit -m "feat(discover): store product page text for sites and paid versions"
```

---

### Task 3: Publishing carries the page text

**Files:**
- Modify:
  - `worker/services/templates/reuse.ts` (`PublishRequest`, `parsePublishRequest`, `planPublish`);
  - `worker/services/templates/publish.ts` (`PublishDeps`, `publishSite`);
  - `worker/api/controllers/publishing/types.ts` (`PublishSiteRequest`, `SitePublishingData`);
  - `worker/api/controllers/publishing/controller.ts` (`getPublishing`, `submitPaidUpdate`, `publishDeps`, `submitVersion`).
- Test:
  - `worker/services/templates/reuse.test.ts`
  - `worker/services/templates/publish.test.ts`

**Interfaces:**
- Consumes: `SitePageCopy`, `validatePageCopy`, `samePageCopy` and `parseStoredPageCopy` (Task 1); `SitePageService` (Task 2).
- Produces:
  - `PublishRequest` (public) gains `pageCopy?: SitePageCopy | null`. `undefined` keeps the saved text, and `null` clears it.
  - `planPublish(listing, priceCents, textChanged = false)`.
  - `PublishDeps`:
    - `loadListing()` now returns `{ id; state; reviewedCopy: SitePageCopy | null }`;
    - new `loadSavedCopy(): Promise<SitePageCopy | null>`;
    - new `savePageCopy(copy: SitePageCopy | null): Promise<void>`;
    - `submitVersion(listingId, source, priceCents, pageCopy: SitePageCopy | null)`.
  - `PublishSiteRequest.pageCopy?: SitePageCopy | null`.
  - `SitePublishingData` gains `pageCopy: SitePageCopy | null` and `pageCopyInReview: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `worker/services/templates/reuse.test.ts`. Add `validatePageCopy` to its imports only if it isn't there, and keep the existing imports of `parsePublishRequest`, `planPublish` and `VERSION_IN_REVIEW_ERROR`:

```ts
describe('page text in publish requests', () => {
	const COPY = {
		tagline: 'A calm site',
		about: ['About it.'],
		features: ['a', 'b', 'c'],
		includes: [{ name: 'Home', detail: 'The one page' }],
		madeFor: ['Studios', 'Teachers'],
	};
	const BASE = { visibility: 'public', reuseConsent: true, category: 'landing', priceCents: 0 };

	it('keeps the saved text when a request has no pageCopy', () => {
		const parsed = parsePublishRequest(BASE);
		expect(parsed.ok && parsed.value.visibility === 'public' && 'pageCopy' in parsed.value).toBe(false);
	});

	it('accepts valid text, a clear, and rejects text that breaks a rule', () => {
		expect(parsePublishRequest({ ...BASE, pageCopy: COPY })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'landing', priceCents: 0, pageCopy: COPY },
		});
		expect(parsePublishRequest({ ...BASE, pageCopy: null })).toEqual({
			ok: true,
			value: { visibility: 'public', category: 'landing', priceCents: 0, pageCopy: null },
		});
		expect(parsePublishRequest({ ...BASE, pageCopy: { ...COPY, features: ['one'] } })).toEqual({
			ok: false,
			error: 'List 3 to 8 features',
		});
	});
});

describe('planPublish with page text', () => {
	const APPROVED = { status: 'listed' as const, currentVersionId: 'v1', priceCents: 2900, pendingPriceCents: null };

	it('sends an approved paid site back to review when only its text changed', () => {
		expect(planPublish(APPROVED, 2900, false)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(APPROVED, 2900, true)).toEqual({ kind: 'paid', submitVersion: true, listListing: false });
	});

	it('refuses a text change while a version is in review', () => {
		const pending = { ...APPROVED, pendingPriceCents: 2900 };
		expect(planPublish(pending, 2900, false)).toEqual({ kind: 'paid', submitVersion: false, listListing: false });
		expect(planPublish(pending, 2900, true)).toEqual({ kind: 'conflict', error: VERSION_IN_REVIEW_ERROR });
	});

	it('ignores text for free sites', () => {
		expect(planPublish(APPROVED, 0, true)).toEqual({ kind: 'free', unlistListing: true });
	});
});
```

In `worker/services/templates/publish.test.ts`, extend the harness and add tests:

```ts
// Add to the imports:
import type { SitePageCopy } from '../../../shared/types/site-page';

// Replace the Setup listing field:
	listing?: { id: string; state: ListingState; reviewedCopy?: SitePageCopy | null } | null;
	savedCopy?: SitePageCopy | null;

// In harness(), add next to `calls`:
	const saved: Array<SitePageCopy | null> = [];
	const versionCopies: Array<SitePageCopy | null> = [];

// Replace deps.loadListing and deps.submitVersion, and add the two new deps:
		loadListing: async () => (setup.listing ? { reviewedCopy: null, ...setup.listing } : null),
		submitVersion: async (listingId, _source, priceCents, pageCopy) => {
			calls.push(`submitVersion:${listingId}:${priceCents}`);
			versionCopies.push(pageCopy);
			if (setup.submitError) throw setup.submitError;
		},
		loadSavedCopy: async () => setup.savedCopy ?? null,
		savePageCopy: async (copy) => {
			saved.push(copy);
		},

// Return them:
	return { deps, calls, saved, versionCopies };
```

Then append to the `describe('publishSite', ...)` block:

```ts
	const COPY: SitePageCopy = {
		tagline: 'A calm site',
		about: ['About it.'],
		features: ['a', 'b', 'c'],
		includes: [{ name: 'Home', detail: 'The one page' }],
		madeFor: ['Studios', 'Teachers'],
	};

	it('saves a free site text with the publish and leaves it alone when the request has none', async () => {
		const withText = harness();
		expect(await publishSite(withText.deps, { ...FREE, pageCopy: COPY })).toEqual({ ok: true, inReview: false });
		expect(withText.saved).toEqual([COPY]);
		const without = harness();
		await publishSite(without.deps, FREE);
		expect(without.saved).toEqual([]);
	});

	it('sends changed text on an approved paid site for review, with the text attached', async () => {
		const { deps, calls, versionCopies, saved } = harness({ listing: { ...APPROVED, reviewedCopy: null } });
		expect(await publishSite(deps, { ...PAID, pageCopy: COPY })).toEqual({ ok: true, inReview: true });
		expect(calls).toEqual(['submitVersion:l1:2900', 'applyVisibility:public']);
		expect(versionCopies).toEqual([COPY]);
		expect(saved).toEqual([COPY]);
	});

	it('keeps an approved paid site out of review when its text is unchanged or omitted', async () => {
		const same = harness({ listing: { ...APPROVED, reviewedCopy: COPY } });
		expect(await publishSite(same.deps, { ...PAID, pageCopy: COPY })).toEqual({ ok: true, inReview: false });
		const omitted = harness({ listing: { ...APPROVED, reviewedCopy: COPY } });
		expect(await publishSite(omitted.deps, PAID)).toEqual({ ok: true, inReview: false });
		expect([...same.calls, ...omitted.calls]).toEqual(['applyVisibility:public', 'applyVisibility:public']);
	});

	it('attaches the saved text to a first paid version when the request has none', async () => {
		const { deps, versionCopies } = harness({ savedCopy: COPY });
		await publishSite(deps, PAID);
		expect(versionCopies).toEqual([COPY]);
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/templates/reuse.test.ts worker/services/templates/publish.test.ts`
Expected: FAIL. `pageCopy` isn't parsed, `planPublish` ignores text, and the new deps don't exist.

- [ ] **Step 3: Implement the request, the plan and the orchestration**

In `worker/services/templates/reuse.ts`:
- **Import:** `import { validatePageCopy, type SitePageCopy } from '../../../shared/types/site-page';`
- **Type:** replace the public branch of `PublishRequest` with:

```ts
	| {
			visibility: 'public';
			category: TemplateCategory | null;
			priceCents: number;
			/** The page text to save; undefined keeps the saved text, null clears it. */
			pageCopy?: SitePageCopy | null;
	  };
```

- **Parsing:** in `parsePublishRequest`, replace the final `return` with:

```ts
	const rawCopy = field(body, 'pageCopy');
	let pageCopy: SitePageCopy | null | undefined;
	if (rawCopy === null) {
		pageCopy = null;
	} else if (rawCopy !== undefined) {
		const checked = validatePageCopy(rawCopy);
		if (!checked.ok) return { ok: false, error: checked.error };
		pageCopy = checked.value;
	}

	return {
		ok: true,
		value: {
			visibility: 'public',
			category: isTemplateCategory(category) ? category : null,
			priceCents,
			...(pageCopy !== undefined ? { pageCopy } : {}),
		},
	};
```

- **Planning:** replace `planPublish` with:

```ts
/**
 * What publishing an app as public at `priceCents` does to its paid listing.
 * `textChanged`: the request's page text differs from the text last sent for review.
 */
export function planPublish(listing: ListingState | null, priceCents: number, textChanged = false): PublishPlan {
	if (priceCents === 0) return { kind: 'free', unlistListing: listing?.status === 'listed' };
	if (!listing || listing.status === 'unlisted') return { kind: 'paid', submitVersion: true, listListing: true };
	if (listing.pendingPriceCents !== null) {
		return listing.pendingPriceCents === priceCents && !textChanged
			? { kind: 'paid', submitVersion: false, listListing: false }
			: { kind: 'conflict', error: VERSION_IN_REVIEW_ERROR };
	}
	const approvedAtThisPrice = listing.currentVersionId !== null && listing.priceCents === priceCents;
	return { kind: 'paid', submitVersion: !approvedAtThisPrice || textChanged, listListing: false };
}
```

In `worker/services/templates/publish.ts`:
- **Import:** `import { samePageCopy, type SitePageCopy } from '../../../shared/types/site-page';`
- **Dependencies:** change these `PublishDeps` members and add the two new ones:

```ts
	/** The app's paid listing with the text last sent for review (pending, else approved), or null when it never had a price. */
	loadListing(): Promise<{ id: string; state: ListingState; reviewedCopy: SitePageCopy | null } | null>;
	/** Store the deployed commit as a pending version at this price with this page text; throws TemplateSubmissionError. */
	submitVersion(listingId: string, source: TemplateSource, priceCents: number, pageCopy: SitePageCopy | null): Promise<void>;
	/** The creator's saved page text. */
	loadSavedCopy(): Promise<SitePageCopy | null>;
	/** Save the creator's page text; null clears it. */
	savePageCopy(copy: SitePageCopy | null): Promise<void>;
```

- **Orchestration:** in `publishSite`:
  1. Replace `const plan = planPublish(listing?.state ?? null, request.priceCents);` with:

```ts
	const textChanged =
		request.pageCopy !== undefined && !samePageCopy(request.pageCopy, listing?.reviewedCopy ?? null);
	const plan = planPublish(listing?.state ?? null, request.priceCents, textChanged);
```

  2. In the free branch, right before `await deps.applyVisibility(request);`, add:

```ts
		if (request.pageCopy !== undefined) await deps.savePageCopy(request.pageCopy);
```

  3. In the paid `try` block, replace the `submitVersion` line with:

```ts
		if (plan.submitVersion) {
			const versionCopy = request.pageCopy !== undefined ? request.pageCopy : await deps.loadSavedCopy();
			await deps.submitVersion(listingId, source, request.priceCents, versionCopy);
		}
```

  4. After the paid `try`/`catch`, before the final `await deps.applyVisibility(request);`, add:

```ts
	if (request.pageCopy !== undefined) await deps.savePageCopy(request.pageCopy);
```

In `worker/api/controllers/publishing/types.ts`:
- **Import:** `import type { SitePageCopy } from '../../../../shared/types/site-page';`
- **`PublishSiteRequest`:** add `/** Undefined keeps the saved page text; null clears it. */ pageCopy?: SitePageCopy | null;`
- **`SitePublishingData`:** add the two fields below.

```ts
    /** The creator's saved page text. */
    pageCopy: SitePageCopy | null;
    /** A paid version carrying page text is waiting for review. */
    pageCopyInReview: boolean;
```

In `worker/api/controllers/publishing/controller.ts`:
- **Imports:**
  - add `SitePageService` to the `../../../database` import;
  - add `import { parseStoredPageCopy, type SitePageCopy } from '../../../../shared/types/site-page';`.
- **`getPublishing`:**
  - Add `new SitePageService(env).getCopy(appId)` to the first `Promise.all`, destructuring it as `savedCopy`.
  - Add these fields to the response:

```ts
                pageCopy: savedCopy,
                pageCopyInReview: versions.some((version) => version.status === 'pending' && version.pageCopy !== null),
```

- **`submitPaidUpdate`:** before `PublishingController.submitVersion(...)`, add `const pageCopy = await new SitePageService(env).getCopy(appId);` and pass `pageCopy` as the new argument after `priceCents`.
- **`publishDeps`:** add `const pages = new SitePageService(env);` next to `listings`. Replace `loadListing` and `submitVersion`, and add the two new deps:

```ts
            async loadListing() {
                const listing = await listings.getListingByApp(appId);
                if (!listing) return null;
                const [pending, approved] = await Promise.all([
                    listings.getPendingVersion(listing.id),
                    listing.currentVersionId ? listings.getVersion(listing.currentVersionId) : Promise.resolve(null),
                ]);
                return {
                    id: listing.id,
                    state: {
                        status: listing.status,
                        currentVersionId: listing.currentVersionId,
                        priceCents: listing.priceCents,
                        pendingPriceCents: pending?.priceCents ?? null,
                    },
                    reviewedCopy: parseStoredPageCopy((pending ?? approved)?.pageCopy ?? null),
                };
            },
            async submitVersion(listingId, source, priceCents, pageCopy) {
                await PublishingController.submitVersion(env, context, listingId, source, priceCents, pageCopy, space);
            },
            loadSavedCopy: () => pages.getCopy(appId),
            savePageCopy: (copy) => pages.saveCopy(appId, copy),
```

- **Private `submitVersion`:**
  - Add the parameter `pageCopy: SitePageCopy | null` after `priceCents`.
  - Add `pageCopy: pageCopy ? JSON.stringify(pageCopy) : null,` to the `listings.insertVersion({...})` object.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run worker/services/templates/reuse.test.ts worker/services/templates/publish.test.ts worker/api/controllers/publishing`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 5: Commit**

```bash
git add worker/services/templates/reuse.ts worker/services/templates/reuse.test.ts worker/services/templates/publish.ts worker/services/templates/publish.test.ts worker/api/controllers/publishing/types.ts worker/api/controllers/publishing/controller.ts
git commit -m "feat(discover): publish page text and review it with paid versions"
```

---

### Task 4: The product page API

**Files:**
- Create:
  - `worker/api/controllers/sitePage/types.ts`
  - `worker/api/controllers/sitePage/sitePageDto.ts` and `sitePageDto.test.ts`
  - `worker/api/controllers/appView/record-visit.ts`
  - `worker/api/controllers/sitePage/controller.ts`
  - `worker/api/routes/sitePageRoutes.ts`
  - `worker/api/controllers/sitePage/site-page-wiring.test.ts`
- Modify:
  - `worker/api/controllers/appView/controller.ts` (use `recordVisit`);
  - `worker/api/routes/index.ts` (register the routes);
  - `src/api-types.ts` (export the new types).

**Interfaces:**
- Consumes:
  - `parseStoredPageCopy` and `SITE_PAGE_UNAVAILABLE_MESSAGE` (Task 1);
  - `SitePageService` and `CreatorSiteRow` (Task 2);
  - `TemplateService` and `AppService` (existing).
- Produces:
  - **Types:** `SitePageOffer`, `SitePageCard`, `SitePageData`, `PageCopyDraftData`.
  - **Functions:**
    - `siteOffer(input): SitePageOffer`
    - `pageCopyFor(listing, approvedVersion, savedCopy): SitePageCopy | null`
    - `approvedShotKey(listing, version, kind): string | null`
    - `toSitePageData(input): SitePageData`
    - `recordVisit(apps: AppService, appId: string, userId: string | undefined, request: Request): Promise<void>`
  - **Routes:**
    - `GET /api/discover/:appId` (public)
    - `GET /api/discover/:appId/screenshots/:kind` (public)
  - **Controller:** `SitePageController.getPage` and `SitePageController.serveScreenshot`.

- [ ] **Step 1: Write the failing tests**

Create `worker/api/controllers/sitePage/sitePageDto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { approvedShotKey, pageCopyFor, siteOffer, toSitePageData, type SitePageSource } from './sitePageDto';
import type { SitePageCopy } from '../../../../shared/types/site-page';

const COPY: SitePageCopy = {
	tagline: 'Approved text',
	about: ['About it.'],
	features: ['a', 'b', 'c'],
	includes: [{ name: 'Home', detail: 'The one page' }],
	madeFor: ['Studios', 'Teachers'],
};
const SAVED: SitePageCopy = { ...COPY, tagline: 'Newer saved text' };
const LISTED = { status: 'listed' as const, currentVersionId: 'v2', priceCents: 2900 };
const VERSION = { id: 'v2', status: 'approved' as const, pageCopy: JSON.stringify(COPY), reviewedAt: new Date('2026-10-13T00:00:00Z'), desktopShotKey: 'd.jpg', mobileShotKey: 'm.jpg' };

describe('siteOffer', () => {
	const base = { isOwner: false, hasPurchase: false, reusable: true, listing: null };

	it('offers a free reusable site for use, and an undeployed one as not available yet', () => {
		expect(siteOffer(base)).toEqual({ kind: 'free' });
		expect(siteOffer({ ...base, reusable: false })).toEqual({ kind: 'not-yet-available' });
	});

	it('sells an approved paid site, and lets a buyer use it', () => {
		expect(siteOffer({ ...base, listing: LISTED })).toEqual({ kind: 'paid', priceCents: 2900 });
		expect(siteOffer({ ...base, listing: LISTED, hasPurchase: true })).toEqual({ kind: 'owned' });
	});

	it('holds a paid site whose first price is not approved yet', () => {
		expect(siteOffer({ ...base, listing: { ...LISTED, currentVersionId: null } })).toEqual({ kind: 'not-yet-available' });
	});

	it('gives the owner their own controls, usable only when the site can be copied', () => {
		expect(siteOffer({ ...base, isOwner: true })).toEqual({ kind: 'own', canUse: true });
		expect(siteOffer({ ...base, isOwner: true, listing: { ...LISTED, currentVersionId: null } })).toEqual({ kind: 'own', canUse: false });
		expect(siteOffer({ ...base, isOwner: true, reusable: false })).toEqual({ kind: 'own', canUse: false });
	});

	it('treats an unlisted listing as a free site', () => {
		expect(siteOffer({ ...base, listing: { ...LISTED, status: 'unlisted' } })).toEqual({ kind: 'free' });
	});
});

describe('pageCopyFor', () => {
	it("shows a paid site's approved text even when newer text is saved or in review", () => {
		expect(pageCopyFor(LISTED, VERSION, SAVED)).toEqual(COPY);
	});

	it('shows no text for a paid site before its first approval', () => {
		expect(pageCopyFor({ ...LISTED, currentVersionId: null }, null, SAVED)).toBeNull();
	});

	it('shows the saved text for a free site', () => {
		expect(pageCopyFor(null, null, SAVED)).toEqual(SAVED);
		expect(pageCopyFor({ ...LISTED, status: 'unlisted' }, VERSION, SAVED)).toEqual(SAVED);
	});
});

describe('approvedShotKey', () => {
	it("serves only the current approved version's screenshots", () => {
		expect(approvedShotKey(LISTED, VERSION, 'desktop')).toBe('d.jpg');
		expect(approvedShotKey(LISTED, VERSION, 'mobile')).toBe('m.jpg');
		expect(approvedShotKey(LISTED, { ...VERSION, status: 'pending' }, 'desktop')).toBeNull();
		expect(approvedShotKey(LISTED, { ...VERSION, id: 'v3' }, 'desktop')).toBeNull();
		expect(approvedShotKey({ ...LISTED, status: 'unlisted' }, VERSION, 'desktop')).toBeNull();
		expect(approvedShotKey(null, VERSION, 'desktop')).toBeNull();
	});
});

describe('toSitePageData', () => {
	const source: SitePageSource = {
		app: {
			id: 'app1',
			title: 'North Ridge',
			description: 'A small coffee store.\n\nSix coffees with tasting notes.',
			category: 'store',
			screenshotUrl: 'https://shots.test/app1.png',
			createdAt: new Date('2026-10-01T00:00:00Z'),
			reuseConsentAt: new Date('2026-10-02T00:00:00Z'),
			lastDeployedAt: new Date('2026-10-05T00:00:00Z'),
			userName: 'Template Creator',
			userAvatar: null,
			viewCount: 15,
			likeCount: 2,
			forkCount: 3,
		},
		isOwner: false,
		hasPurchase: false,
		reusable: true,
		listing: LISTED,
		approvedVersion: VERSION,
		savedCopy: SAVED,
		previewUrl: 'https://preview.test/?t=1',
		moreFromCreator: [{ id: 'app2', title: 'Lumen', screenshotUrl: null, priceCents: null }],
	};

	it('assembles a paid page with the approved text, price, screenshots and stats', () => {
		expect(toSitePageData(source)).toEqual({
			id: 'app1',
			title: 'North Ridge',
			category: 'store',
			description: 'A small coffee store.\n\nSix coffees with tasting notes.',
			copy: COPY,
			offer: { kind: 'paid', priceCents: 2900 },
			priceCents: 2900,
			creator: { displayName: 'Template Creator', avatarUrl: null },
			stats: { uses: 3, views: 15, likes: 2 },
			publishedAt: '2026-10-02T00:00:00.000Z',
			updatedAt: '2026-10-13T00:00:00.000Z',
			previewUrl: 'https://preview.test/?t=1',
			screenshotUrl: 'https://shots.test/app1.png',
			approvedShots: {
				desktop: '/api/discover/app1/screenshots/desktop?v=v2',
				mobile: '/api/discover/app1/screenshots/mobile?v=v2',
			},
			moreFromCreator: [{ id: 'app2', title: 'Lumen', screenshotUrl: null, priceCents: null }],
		});
	});

	it('assembles a free page that has no preview, falling back to the description', () => {
		const page = toSitePageData({
			...source,
			listing: null,
			approvedVersion: null,
			savedCopy: null,
			previewUrl: null,
			reusable: false,
			app: { ...source.app, reuseConsentAt: null, viewCount: undefined, likeCount: undefined, forkCount: undefined },
		});
		expect(page.copy).toBeNull();
		expect(page.offer).toEqual({ kind: 'not-yet-available' });
		expect(page.priceCents).toBeNull();
		expect(page.approvedShots).toBeNull();
		expect(page.previewUrl).toBeNull();
		expect(page.publishedAt).toBe('2026-10-01T00:00:00.000Z');
		expect(page.updatedAt).toBe('2026-10-05T00:00:00.000Z');
		expect(page.stats).toEqual({ uses: 0, views: 0, likes: 0 });
	});
});
```

Create `worker/api/controllers/sitePage/site-page-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/worker/api/routes/sitePageRoutes.ts',
		'/worker/api/routes/index.ts',
		'/worker/api/controllers/sitePage/controller.ts',
		'/worker/api/controllers/appView/controller.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('product page routes', () => {
	it('serves the page and its approved screenshots to anyone', () => {
		const routes = source('/worker/api/routes/sitePageRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/discover/:appId'"))).toContain('setAuthLevel(AuthConfig.public)');
		expect(routes.find((line) => line.includes("'/api/discover/:appId/screenshots/:kind'"))).toContain(
			'setAuthLevel(AuthConfig.public)',
		);
		expect(source('/worker/api/routes/index.ts')).toContain('setupSitePageRoutes(app)');
	});

	it('rate limits the page, records a visit and never returns source code', () => {
		const controller = source('/worker/api/controllers/sitePage/controller.ts');
		expect(controller).toContain('enforcePublicAppsRateLimit(');
		expect(controller).toContain('recordVisit(');
		expect(controller).not.toContain('getSummary(');
		expect(controller).not.toContain('agentSummary');
		expect(source('/worker/api/controllers/appView/controller.ts')).toContain('recordVisit(');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/api/controllers/sitePage`
Expected: FAIL, because the modules don't exist.

- [ ] **Step 3: Types, the DTO and the visit helper**

Create `worker/api/controllers/sitePage/types.ts`:

```ts
/** API types for Discover product pages and AI-drafted page text. */

import type { SitePageCopy } from '../../../../shared/types/site-page';
import type { TemplateCategory } from '../../../../shared/types/templates';

/** What the page's main button does for this viewer. */
export type SitePageOffer =
    | { kind: 'free' }
    | { kind: 'paid'; priceCents: number }
    | { kind: 'owned' }
    | { kind: 'own'; canUse: boolean }
    | { kind: 'not-yet-available' };

export interface SitePageCard {
    id: string;
    title: string;
    screenshotUrl: string | null;
    /** The approved price of a paid site; null for a free site. */
    priceCents: number | null;
}

export interface SitePageData {
    id: string;
    title: string;
    category: TemplateCategory | null;
    /** The site's original description; About falls back to it when there is no page text. */
    description: string | null;
    copy: SitePageCopy | null;
    offer: SitePageOffer;
    /** The approved price of a paid site; null when the site is free or not yet approved. */
    priceCents: number | null;
    creator: { displayName: string; avatarUrl: string | null };
    stats: { uses: number; views: number; likes: number };
    publishedAt: string | null;
    updatedAt: string | null;
    /** A fresh signed preview of the deployed site, or null when none can be produced. */
    previewUrl: string | null;
    screenshotUrl: string | null;
    /** The approved version's screenshots, for paid sites. */
    approvedShots: { desktop: string; mobile: string } | null;
    moreFromCreator: SitePageCard[];
}

export interface PageCopyDraftData {
    copy: SitePageCopy;
}
```

Create `worker/api/controllers/sitePage/sitePageDto.ts`:

```ts
/**
 * The product page projection: which offer a viewer gets, which text the page
 * shows, and which screenshots are public. Pure, so each rule is unit-tested.
 */

import { parseStoredPageCopy, type SitePageCopy } from '../../../../shared/types/site-page';
import type { TemplateListingStatus, TemplateShotKind, TemplateVersionStatus } from '../../../../shared/types/templates';
import type { EnhancedAppData } from '../../../database/types';
import type { SitePageCard, SitePageData, SitePageOffer } from './types';

interface ListingView {
    status: TemplateListingStatus;
    currentVersionId: string | null;
    priceCents: number;
}

interface VersionView {
    id: string;
    status: TemplateVersionStatus;
    pageCopy: string | null;
    reviewedAt: Date | null;
    desktopShotKey: string;
    mobileShotKey: string;
}

export interface SitePageSource {
    app: Pick<
        EnhancedAppData,
        | 'id'
        | 'title'
        | 'description'
        | 'category'
        | 'screenshotUrl'
        | 'createdAt'
        | 'reuseConsentAt'
        | 'lastDeployedAt'
        | 'userName'
        | 'userAvatar'
        | 'viewCount'
        | 'likeCount'
        | 'forkCount'
    >;
    isOwner: boolean;
    hasPurchase: boolean;
    /** The site has a deployed Think commit, so a free copy can start from it. */
    reusable: boolean;
    listing: ListingView | null;
    approvedVersion: VersionView | null;
    savedCopy: SitePageCopy | null;
    previewUrl: string | null;
    moreFromCreator: SitePageCard[];
}

function isoDate(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function listedListing(listing: ListingView | null): ListingView | null {
    return listing?.status === 'listed' ? listing : null;
}

export function siteOffer(input: {
    isOwner: boolean;
    hasPurchase: boolean;
    reusable: boolean;
    listing: ListingView | null;
}): SitePageOffer {
    const listed = listedListing(input.listing);
    if (input.isOwner) {
        return { kind: 'own', canUse: listed ? listed.currentVersionId !== null : input.reusable };
    }
    if (listed) {
        if (listed.currentVersionId === null) return { kind: 'not-yet-available' };
        return input.hasPurchase ? { kind: 'owned' } : { kind: 'paid', priceCents: listed.priceCents };
    }
    return input.reusable ? { kind: 'free' } : { kind: 'not-yet-available' };
}

/** A paid site shows its approved version's text; a free site shows the saved text. */
export function pageCopyFor(
    listing: ListingView | null,
    approvedVersion: VersionView | null,
    savedCopy: SitePageCopy | null,
): SitePageCopy | null {
    const listed = listedListing(listing);
    if (!listed) return savedCopy;
    if (!listed.currentVersionId || approvedVersion?.id !== listed.currentVersionId) return null;
    return parseStoredPageCopy(approvedVersion.pageCopy);
}

/** The R2 key of a public screenshot: only the current approved version of a listed paid site. */
export function approvedShotKey(
    listing: ListingView | null,
    version: VersionView | null,
    kind: TemplateShotKind,
): string | null {
    const listed = listedListing(listing);
    if (!listed || !version || version.id !== listed.currentVersionId || version.status !== 'approved') return null;
    return kind === 'desktop' ? version.desktopShotKey : version.mobileShotKey;
}

export function sitePageScreenshotUrl(appId: string, versionId: string, kind: TemplateShotKind): string {
    return `/api/discover/${appId}/screenshots/${kind}?v=${versionId}`;
}

export function toSitePageData(source: SitePageSource): SitePageData {
    const { app, listing, approvedVersion } = source;
    const listed = listedListing(listing);
    const approved =
        listed && listed.currentVersionId && approvedVersion?.id === listed.currentVersionId ? approvedVersion : null;
    return {
        id: app.id,
        title: app.title,
        category: app.category,
        description: app.description,
        copy: pageCopyFor(listing, approvedVersion, source.savedCopy),
        offer: siteOffer(source),
        priceCents: approved && listed ? listed.priceCents : null,
        creator: { displayName: app.userName ?? 'Unknown', avatarUrl: app.userAvatar },
        stats: { uses: app.forkCount ?? 0, views: app.viewCount ?? 0, likes: app.likeCount ?? 0 },
        publishedAt: isoDate(app.reuseConsentAt ?? app.createdAt),
        updatedAt: isoDate(approved ? approved.reviewedAt : app.lastDeployedAt),
        previewUrl: source.previewUrl,
        screenshotUrl: app.screenshotUrl,
        approvedShots: approved
            ? {
                  desktop: sitePageScreenshotUrl(app.id, approved.id, 'desktop'),
                  mobile: sitePageScreenshotUrl(app.id, approved.id, 'mobile'),
              }
            : null,
        moreFromCreator: source.moreFromCreator,
    };
}
```

Create `worker/api/controllers/appView/record-visit.ts`:

```ts
import type { AppService } from '../../../database/services/AppService';
import { extractRequestMetadata } from '../../../utils/authUtils';

/** Counts a view; signed-out viewers are identified by request metadata, deduplicated by AppService. */
export async function recordVisit(apps: AppService, appId: string, userId: string | undefined, request: Request): Promise<void> {
    if (userId) {
        await apps.recordAppView(appId, { userId });
        return;
    }
    const metadata = extractRequestMetadata(request);
    await apps.recordAppView(appId, { ipAddress: metadata.ipAddress, userAgent: metadata.userAgent });
}
```

In `worker/api/controllers/appView/controller.ts`:
- replace the `if (userId) { await appService.recordAppView(...) } else { ... }` block with `await recordVisit(appService, appId, userId, request);`;
- import `recordVisit` from `./record-visit`;
- remove the `extractRequestMetadata` import if nothing else uses it.

- [ ] **Step 4: The controller and routes**

Create `worker/api/controllers/sitePage/controller.ts`:

```ts
/** Public product pages for Discover sites and their approved screenshots. Drafting lives in draftController.ts. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService, SitePageService, TemplateService } from '../../../database';
import { getAgentStubLightweight } from '../../../agents';
import type { TemplateSource } from '../../../agents/core/types';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { isTemplateShotKind } from '../../../services/templates/catalog';
import { templateImageResponse } from '../../../services/templates/store';
import { SITE_PAGE_UNAVAILABLE_MESSAGE } from '../../../../shared/types/site-page';
import { recordVisit } from '../appView/record-visit';
import { approvedShotKey, toSitePageData } from './sitePageDto';
import type { SitePageData } from './types';

const MORE_FROM_CREATOR_LIMIT = 4;
const SITE_SCREENSHOT_CACHE = 'public, max-age=86400';

export class SitePageController extends BaseController {
    static logger = createLogger('SitePageController');

    static async getPage(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<SitePageData>>> {
        try {
            const appId = context.pathParams.appId;
            const user = await SitePageController.getOptionalUser(request, env);
            try {
                await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, user ?? null, request);
            } catch (error) {
                if (error instanceof RateLimitExceededError) {
                    return SitePageController.createErrorResponse<SitePageData>('Too many requests', 429);
                }
                throw error;
            }
            const apps = new AppService(env);
            const app = appId ? await apps.getAppDetails(appId, user?.id) : null;
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return SitePageController.createErrorResponse<SitePageData>(SITE_PAGE_UNAVAILABLE_MESSAGE, 404);
            }
            const isOwner = !!user && app.userId === user.id;
            const listings = new TemplateService(env);
            const pages = new SitePageService(env);
            const listing = await listings.getListingByApp(app.id);
            const listed = listing?.status === 'listed' ? listing : null;
            const [hasPurchase, approvedVersion, savedCopy, source, moreFromCreator] = await Promise.all([
                listed && user && !isOwner ? listings.hasPurchase(listed.id, user.id) : Promise.resolve(false),
                listed?.currentVersionId ? listings.getVersion(listed.currentVersionId) : Promise.resolve(null),
                pages.getCopy(app.id),
                SitePageController.loadSource(env, app.id),
                app.userId ? pages.listCreatorSites(app.userId, app.id, MORE_FROM_CREATOR_LIMIT) : Promise.resolve([]),
            ]);
            await recordVisit(apps, app.id, user?.id, request);
            return SitePageController.createSuccessResponse<SitePageData>(
                toSitePageData({
                    app,
                    isOwner,
                    hasPurchase,
                    reusable: source !== null,
                    listing,
                    approvedVersion,
                    savedCopy,
                    previewUrl: source?.previewUrl ?? null,
                    moreFromCreator,
                }),
            );
        } catch (error) {
            this.logger.error('Error loading product page', error);
            return SitePageController.createErrorResponse<SitePageData>('Failed to load this page', 500);
        }
    }

    static async serveScreenshot(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<never>>> {
        try {
            const { appId, kind } = context.pathParams;
            if (!appId || !kind || !isTemplateShotKind(kind)) {
                return SitePageController.createErrorResponse('Screenshot not found', 404);
            }
            const app = await new AppService(env).getReuseSource(appId);
            if (!app || app.visibility !== 'public' || app.removedFromDiscoverAt) {
                return SitePageController.createErrorResponse('Screenshot not found', 404);
            }
            const listings = new TemplateService(env);
            const listing = await listings.getListingByApp(appId);
            const version =
                listing?.status === 'listed' && listing.currentVersionId ? await listings.getVersion(listing.currentVersionId) : null;
            const key = approvedShotKey(listing, version, kind);
            const image = key ? await templateImageResponse(env.TEMPLATES_BUCKET, key, SITE_SCREENSHOT_CACHE) : null;
            if (!image) return SitePageController.createErrorResponse('Screenshot not found', 404);
            // Binary route: the router passes this Response through unchanged.
            return image as unknown as ControllerResponse<ApiResponse<never>>;
        } catch (error) {
            this.logger.error('Error serving product page screenshot', error);
            return SitePageController.createErrorResponse('Internal server error', 500);
        }
    }

    /** The deployed Think source with a fresh signed preview URL; null when the site can't be copied or previewed. */
    private static async loadSource(env: Env, appId: string): Promise<TemplateSource | null> {
        try {
            const agent = await getAgentStubLightweight(env, appId);
            const behaviorType = await agent.getBehaviorType();
            return behaviorType === 'think' ? await agent.getTemplateSource() : null;
        } catch (error) {
            SitePageController.logger.warn('Could not load the site preview', { appId, error });
            return null;
        }
    }
}
```

Create `worker/api/routes/sitePageRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { SitePageController } from '../controllers/sitePage/controller';

/** Public product pages for Discover sites. */
export function setupSitePageRoutes(app: Hono<AppEnv>): void {
    app.get('/api/discover/:appId', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.getPage));
    app.get('/api/discover/:appId/screenshots/:kind', setAuthLevel(AuthConfig.public), adaptController(SitePageController, SitePageController.serveScreenshot));
}
```

In `worker/api/routes/index.ts`:
- import `setupSitePageRoutes` from `./sitePageRoutes`;
- call `setupSitePageRoutes(app);` right after `setupPublishingRoutes(app);`, under the comment `// Discover product pages`.

In `src/api-types.ts`, add:

```ts
export type {
	PageCopyDraftData,
	SitePageCard,
	SitePageData,
	SitePageOffer,
} from 'worker/api/controllers/sitePage/types';
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run worker/api/controllers/sitePage worker/api/controllers/appView`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

If `getTemplateSource` is not callable on the lightweight stub, the typecheck reports it. In that case, switch `loadSource` to `getAgentStub(env, appId)` and ledger the change.

- [ ] **Step 6: Commit**

```bash
git add worker/api/controllers/sitePage worker/api/controllers/appView/record-visit.ts worker/api/controllers/appView/controller.ts worker/api/routes/sitePageRoutes.ts worker/api/routes/index.ts src/api-types.ts
git commit -m "feat(discover): public product page and approved screenshot endpoints"
```

---

### Task 5: AI-drafted page text

**Files:**
- Create:
  - `worker/services/site-pages/draft-input.ts` and `draft-input.test.ts`
  - `worker/services/site-pages/draft.ts` and `draft.test.ts`
  - `worker/api/controllers/sitePage/draftController.ts`
  - `worker/services/rate-limit/page-copy-draft-limit.test.ts`
- Modify:
  - `worker/services/rate-limit/config.ts` (new limit);
  - `worker/services/rate-limit/rateLimits.ts` (enforce method);
  - `worker/api/routes/sitePageRoutes.ts` (draft route);
  - `worker/api/controllers/sitePage/site-page-wiring.test.ts` (append).

**Interfaces:**
- Consumes:
  - `validatePageCopy` and `PAGE_DRAFT_FAILED_MESSAGE` (Task 1);
  - `TreeFile` and `decodeText` (`worker/services/templates/snapshot.ts`);
  - `executeInference` (`worker/agents/inferutils/infer.ts`);
  - `createSystemMessage` and `createUserMessage` (`worker/agents/inferutils/common.ts`).
- Produces:
  - `DRAFT_SOURCE_BUDGET_BYTES = 40 * 1024`;
  - `pickDraftSources(files: TreeFile[], budget?: number): { paths: string[]; sources: Array<{ path: string; text: string }> }`;
  - `buildDraftMessages(request: DraftRequest): Message[]`;
  - `PageCopyDraftSchema`;
  - `type PageCopyCompleter = (messages: Message[]) => Promise<unknown>`;
  - `draftPageCopy(complete: PageCopyCompleter, request: DraftRequest): Promise<SitePageCopy>`;
  - `class PageCopyDraftError`;
  - `RateLimitType.PAGE_COPY_DRAFT` and `RateLimitService.enforcePageCopyDraftRateLimit(env, config, user)`;
  - `POST /api/apps/:id/page-copy/draft` (owner only), returning `PageCopyDraftData`.

- [ ] **Step 1: Write the failing tests**

Create `worker/services/site-pages/draft-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DRAFT_SOURCE_BUDGET_BYTES, buildDraftMessages, pickDraftSources } from './draft-input';
import type { TreeFile } from '../templates/snapshot';

function file(path: string, text: string): TreeFile {
	return { path, bytes: new TextEncoder().encode(text) };
}

describe('pickDraftSources', () => {
	it('lists every path but sends only page and component sources, entry files first', () => {
		const picked = pickDraftSources([
			file('/src/components/Hero.tsx', 'hero'),
			file('/src/pages/About.tsx', 'about'),
			file('/src/App.tsx', 'app'),
			file('/index.html', '<html>'),
			file('/src/index.css', 'body{}'),
			file('/package.json', '{}'),
			file('/vite.config.ts', 'config'),
			file('/src/App.test.tsx', 'test'),
			file('/public/logo.png', 'png'),
		]);
		expect(picked.paths).toHaveLength(9);
		expect(picked.sources.map((source) => source.path)).toEqual([
			'/index.html',
			'/src/App.tsx',
			'/src/pages/About.tsx',
			'/src/components/Hero.tsx',
		]);
	});

	it('stops at the byte budget, cutting the last file that does not fit', () => {
		const big = 'x'.repeat(30 * 1024);
		const picked = pickDraftSources([file('/src/App.tsx', big), file('/src/components/A.tsx', big)]);
		const total = picked.sources.reduce((sum, source) => sum + new TextEncoder().encode(source.text).length, 0);
		expect(total).toBeLessThanOrEqual(DRAFT_SOURCE_BUDGET_BYTES);
		expect(picked.sources).toHaveLength(2);
		expect(picked.sources[1].text.length).toBe(DRAFT_SOURCE_BUDGET_BYTES - 30 * 1024);
	});

	it('skips binary files', () => {
		const binary: TreeFile = { path: '/src/App.tsx', bytes: new Uint8Array([0, 159, 146, 150]) };
		expect(pickDraftSources([binary]).sources).toEqual([]);
	});
});

describe('buildDraftMessages', () => {
	it('gives the model the rules, the site facts and the sources', () => {
		const messages = buildDraftMessages({
			title: 'North Ridge',
			category: 'store',
			description: 'A small coffee store',
			files: [file('/src/App.tsx', 'export default function App() {}')],
		});
		expect(messages).toHaveLength(2);
		const [system, user] = messages.map((message) => String(message.content));
		expect(system).toContain('Describe only what the files show');
		expect(system).toContain('at most 90 characters');
		expect(user).toContain('Title: North Ridge');
		expect(user).toContain('Category: Store');
		expect(user).toContain('A small coffee store');
		expect(user).toContain('--- /src/App.tsx ---');
	});
});
```

Create `worker/services/site-pages/draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PageCopyDraftError, draftPageCopy, type PageCopyCompleter } from './draft';

const REQUEST = { title: 'North Ridge', category: null, description: null, files: [] };
const GOOD = {
	tagline: 'A small online coffee store',
	about: ['Six coffees with tasting notes.'],
	features: ['Product grid', 'Cart drawer', 'Tasting notes'],
	includes: [{ name: 'Home', detail: 'Hero and product grid' }],
	madeFor: ['Roasters', 'Cafes'],
};

function completer(answers: unknown[]): { complete: PageCopyCompleter; calls: number[] } {
	const calls: number[] = [];
	return {
		calls,
		complete: async (messages) => {
			calls.push(messages.length);
			const answer = answers.shift();
			if (answer instanceof Error) throw answer;
			return answer;
		},
	};
}

describe('draftPageCopy', () => {
	it('returns valid text from the first answer', async () => {
		const { complete, calls } = completer([GOOD]);
		expect(await draftPageCopy(complete, REQUEST)).toEqual(GOOD);
		expect(calls).toEqual([2]);
	});

	it('asks once more, naming the broken rule, when the first answer breaks a limit', async () => {
		const { complete, calls } = completer([{ ...GOOD, features: ['one'] }, GOOD]);
		expect(await draftPageCopy(complete, REQUEST)).toEqual(GOOD);
		expect(calls).toEqual([2, 3]);
	});

	it('fails after two answers that break a limit', async () => {
		const { complete } = completer([{ ...GOOD, tagline: '' }, { ...GOOD, tagline: '' }]);
		await expect(draftPageCopy(complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
	});

	it('fails when the model call fails or returns nothing', async () => {
		await expect(draftPageCopy(completer([new Error('gateway down')]).complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
		await expect(draftPageCopy(completer([null, null]).complete, REQUEST)).rejects.toBeInstanceOf(PageCopyDraftError);
	});
});
```

Create `worker/services/rate-limit/page-copy-draft-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, RateLimitStore, RateLimitType } from './config';

describe('page text drafting limit', () => {
	it('allows 10 drafts per user per hour', () => {
		expect(DEFAULT_RATE_LIMIT_SETTINGS[RateLimitType.PAGE_COPY_DRAFT]).toEqual({
			enabled: true,
			store: RateLimitStore.DURABLE_OBJECT,
			limit: 10,
			period: 60 * 60,
		});
	});
});
```

Append to `worker/api/controllers/sitePage/site-page-wiring.test.ts`:
- add `'/worker/api/controllers/sitePage/draftController.ts'` to the glob list;
- add this test:

```ts
describe('drafting page text', () => {
	it('is owner-only, rate limited before the model call, and uses the lite model', () => {
		const routes = source('/worker/api/routes/sitePageRoutes.ts').split('\n');
		expect(routes.find((line) => line.includes("'/api/apps/:id/page-copy/draft'"))).toContain('setAuthLevel(AuthConfig.ownerOnly)');
		const draft = source('/worker/api/controllers/sitePage/draftController.ts');
		expect(draft.indexOf('enforcePageCopyDraftRateLimit(')).toBeGreaterThan(-1);
		expect(draft.indexOf('enforcePageCopyDraftRateLimit(')).toBeLessThan(draft.indexOf('draftPageCopy('));
		expect(draft).toContain("agentActionName: 'templateSelection'");
		expect(draft).toContain('PAGE_DRAFT_FAILED_MESSAGE');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/services/site-pages worker/services/rate-limit/page-copy-draft-limit.test.ts worker/api/controllers/sitePage`
Expected: FAIL, because the modules and the limit don't exist.

- [ ] **Step 3: Draft input and drafting**

Create `worker/services/site-pages/draft-input.ts`:

```ts
/** What the drafting model sees: the site's facts and its main source files, within a byte budget. Pure. */

import { createSystemMessage, createUserMessage, type Message } from '../../agents/inferutils/common';
import { TEMPLATE_CATEGORY_LABELS, type TemplateCategory } from '../../../shared/types/templates';
import { decodeText, type TreeFile } from '../templates/snapshot';

export const DRAFT_SOURCE_BUDGET_BYTES = 40 * 1024;
const MAX_LISTED_PATHS = 200;
const SOURCE_EXTENSIONS = ['.html', '.tsx', '.jsx', '.ts', '.vue', '.svelte'];
const EXCLUDED_PATH = /(^|\/)(node_modules|dist|build|public|\.git)\//;
const EXCLUDED_FILE = /(\.d\.ts|\.test\.[jt]sx?|\.spec\.[jt]sx?)$|(^|\/)[a-z.-]*\.config\.[jt]s$/;

export interface DraftRequest {
	title: string;
	category: TemplateCategory | null;
	description: string | null;
	files: TreeFile[];
}

export interface DraftSources {
	paths: string[];
	sources: Array<{ path: string; text: string }>;
}

function isSource(path: string): boolean {
	return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension)) && !EXCLUDED_PATH.test(path) && !EXCLUDED_FILE.test(path);
}

/** Entry files first, then pages, then components, then the rest. */
function rank(path: string): number {
	if (/^\/?(index\.html|src\/(App|main)\.[a-z]+)$/.test(path)) return 0;
	if (/\/(pages|routes)\//.test(path)) return 1;
	if (/\/components\//.test(path)) return 2;
	return 3;
}

export function pickDraftSources(files: TreeFile[], budget = DRAFT_SOURCE_BUDGET_BYTES): DraftSources {
	const encoder = new TextEncoder();
	const candidates = files
		.filter((file) => isSource(file.path))
		.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
	const sources: DraftSources['sources'] = [];
	let remaining = budget;
	for (const file of candidates) {
		if (remaining <= 0) break;
		const text = decodeText(file.bytes);
		if (text === null) continue;
		const size = encoder.encode(text).length;
		if (size <= remaining) {
			sources.push({ path: file.path, text });
			remaining -= size;
		} else {
			// Cut by characters; sources are almost entirely single-byte text.
			sources.push({ path: file.path, text: text.slice(0, remaining) });
			break;
		}
	}
	return { paths: files.map((file) => file.path).slice(0, MAX_LISTED_PATHS), sources };
}

const SYSTEM_PROMPT = [
	"You write the product page for a website template on Estori, where people start their own site from someone else's.",
	'Describe only what the files show. Never claim features, integrations, a CMS, support, prices or contact details that are not in the files.',
	'Write for someone deciding whether to start their own site from this one. Plain text only: no markdown, no emojis, no HTML.',
	'Return:',
	'- tagline: one line, at most 90 characters.',
	'- about: 1 to 3 short paragraphs, at most 1,200 characters in total.',
	'- features: 3 to 8 items, each at most 80 characters.',
	'- includes: 1 to 12 pages or sections of the site, each with a name (at most 40 characters) and one line (at most 100 characters).',
	'- madeFor: 2 to 5 kinds of people or businesses, each at most 40 characters.',
].join('\n');

export function buildDraftMessages(request: DraftRequest): Message[] {
	const picked = pickDraftSources(request.files);
	const facts = [
		`Title: ${request.title}`,
		`Category: ${request.category ? TEMPLATE_CATEGORY_LABELS[request.category] : 'None'}`,
		`What the creator asked for: ${request.description ?? 'Not recorded'}`,
		'',
		'Files:',
		...picked.paths,
		'',
		...picked.sources.map((source) => `--- ${source.path} ---\n${source.text}`),
	].join('\n');
	return [createSystemMessage(SYSTEM_PROMPT), createUserMessage(facts)];
}
```

Create `worker/services/site-pages/draft.ts`:

```ts
/** Drafting page text with a model, checked against the shared limits, with one corrective retry. */

import z from 'zod';
import { createUserMessage, type Message } from '../../agents/inferutils/common';
import { validatePageCopy, type SitePageCopy } from '../../../shared/types/site-page';
import { buildDraftMessages, type DraftRequest } from './draft-input';

export const PageCopyDraftSchema = z.object({
	tagline: z.string(),
	about: z.array(z.string()),
	features: z.array(z.string()),
	includes: z.array(z.object({ name: z.string(), detail: z.string() })),
	madeFor: z.array(z.string()),
});

/** Sends messages to the model and returns its structured answer, or null when there is none. */
export type PageCopyCompleter = (messages: Message[]) => Promise<unknown>;

export class PageCopyDraftError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'PageCopyDraftError';
	}
}

async function ask(complete: PageCopyCompleter, messages: Message[]): Promise<unknown> {
	try {
		return await complete(messages);
	} catch (error) {
		throw new PageCopyDraftError('The drafting call failed', { cause: error });
	}
}

export async function draftPageCopy(complete: PageCopyCompleter, request: DraftRequest): Promise<SitePageCopy> {
	const messages = buildDraftMessages(request);
	const first = validatePageCopy(await ask(complete, messages));
	if (first.ok) return first.value;
	const retry = createUserMessage(`Your answer broke a rule: ${first.error}. Return the whole page again, following every limit.`);
	const second = validatePageCopy(await ask(complete, [...messages, retry]));
	if (second.ok) return second.value;
	throw new PageCopyDraftError(`The draft broke a rule twice: ${second.error}`);
}
```

- [ ] **Step 4: The rate limit, the controller and the route**

In `worker/services/rate-limit/config.ts`:
- **Enum:** add `PAGE_COPY_DRAFT = 'pageCopyDraft',` to `RateLimitType`.
- **Settings type:** add `[RateLimitType.PAGE_COPY_DRAFT]: DORateLimitConfig | KVRateLimitConfig;` to `RateLimitSettings`.
- **Defaults:** add to `DEFAULT_RATE_LIMIT_SETTINGS`:

```ts
	// Per-user cap on AI drafts of product page text; each one is a model call.
	pageCopyDraft: {
		enabled: true,
		store: RateLimitStore.DURABLE_OBJECT,
		limit: 10,
		period: 60 * 60,
	},
```

In `worker/services/rate-limit/rateLimits.ts`, after `enforceTemplateSubmissionRateLimit`, add:

```ts
	static async enforcePageCopyDraftRateLimit(
		env: Env,
		config: RateLimitSettings,
		user: AuthUser,
	): Promise<void> {
		const limitConfig = config[RateLimitType.PAGE_COPY_DRAFT];
		if (!limitConfig?.enabled) {
			return;
		}
		const identifier = await this.getUserIdentifier(user);
		const key = this.buildRateLimitKey(RateLimitType.PAGE_COPY_DRAFT, identifier);
		const result = await this.enforce(env, key, config, RateLimitType.PAGE_COPY_DRAFT);
		if (!result.success) {
			throw new RateLimitExceededError(
				`Page drafting limit reached. Maximum ${limitConfig.limit} drafts per hour`,
				RateLimitType.PAGE_COPY_DRAFT,
				limitConfig.limit,
				limitConfig.period,
				['Please try again in an hour.'],
			);
		}
	}
```

If the stored rate-limit settings object in KV or config lacks the new key, `config[RateLimitType.PAGE_COPY_DRAFT]` is `undefined` and the guard returns early. Check where `context.config.security.rateLimit` is built (`worker/config/index.ts`). If it merges over `DEFAULT_RATE_LIMIT_SETTINGS`, the default applies. If it doesn't merge, ledger that the limit only applies once configured.

Create `worker/api/controllers/sitePage/draftController.ts`:

```ts
/** AI drafts of product page text for a site's owner. Nothing is saved; the publish dialog saves edited text. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { AppService } from '../../../database';
import { getAgentStubLightweight, getSpaceTemplateStub } from '../../../agents';
import { executeInference } from '../../../agents/inferutils/infer';
import type { InferenceContext } from '../../../agents/inferutils/config.types';
import { RateLimitService } from '../../../services/rate-limit/rateLimits';
import { RateLimitExceededError } from 'shared/types/errors';
import { NOT_DEPLOYED_REASON } from '../../../services/templates/reuse';
import { PAGE_DRAFT_FAILED_MESSAGE } from '../../../../shared/types/site-page';
import { PageCopyDraftError, PageCopyDraftSchema, draftPageCopy, type PageCopyCompleter } from '../../../services/site-pages/draft';
import type { PageCopyDraftData } from './types';

const DRAFT_MAX_TOKENS = 2000;

export class PageCopyDraftController extends BaseController {
    static logger = createLogger('PageCopyDraftController');

    static async draft(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<PageCopyDraftData>>> {
        try {
            const appId = context.pathParams.id;
            const user = context.user!;
            await RateLimitService.enforcePageCopyDraftRateLimit(env, context.config.security.rateLimit, user);
            const app = await new AppService(env).getAppDetails(appId, user.id);
            if (!app) return PageCopyDraftController.createErrorResponse<PageCopyDraftData>('App not found', 404);
            const commit = await (await getAgentStubLightweight(env, appId)).getDeployedCommit();
            const space = getSpaceTemplateStub(env, appId);
            if (!commit || !space) {
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(NOT_DEPLOYED_REASON, 400);
            }
            const files = await space.readTreeAtCommit(commit);
            const copy = await draftPageCopy(PageCopyDraftController.completer(env, appId, user.id), {
                title: app.title,
                category: app.category,
                description: app.description,
                files,
            });
            return PageCopyDraftController.createSuccessResponse<PageCopyDraftData>({ copy });
        } catch (error) {
            if (error instanceof RateLimitExceededError) {
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(error, 429);
            }
            if (error instanceof PageCopyDraftError) {
                this.logger.warn('Page text draft failed', { message: error.message, cause: error.cause });
                return PageCopyDraftController.createErrorResponse<PageCopyDraftData>(PAGE_DRAFT_FAILED_MESSAGE, 502);
            }
            this.logger.error('Error drafting page text', error);
            return PageCopyDraftController.createErrorResponse<PageCopyDraftData>('Failed to draft the page', 500);
        }
    }

    /** The platform's lite model, the same one template selection uses, with structured output. */
    private static completer(env: Env, appId: string, userId: string): PageCopyCompleter {
        const context: InferenceContext = {
            metadata: { agentId: appId, userId },
            enableRealtimeCodeFix: false,
            enableFastSmartCodeFix: false,
        };
        return async (messages) => {
            const result = await executeInference({
                env,
                messages,
                agentActionName: 'templateSelection',
                schema: PageCopyDraftSchema,
                context,
                maxTokens: DRAFT_MAX_TOKENS,
            });
            return result?.object ?? null;
        };
    }
}
```

In `worker/api/routes/sitePageRoutes.ts`:
- import `PageCopyDraftController` from `../controllers/sitePage/draftController`;
- add `app.post('/api/apps/:id/page-copy/draft', setAuthLevel(AuthConfig.ownerOnly), adaptController(PageCopyDraftController, PageCopyDraftController.draft));` inside `setupSitePageRoutes`.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run worker/services/site-pages worker/services/rate-limit/page-copy-draft-limit.test.ts worker/api/controllers/sitePage`
Expected: PASS. Then run `npx tsc -p tsconfig.worker.json --noEmit`; expected: clean.

- [ ] **Step 6: Commit**

```bash
git add worker/services/site-pages worker/services/rate-limit/config.ts worker/services/rate-limit/rateLimits.ts worker/services/rate-limit/page-copy-draft-limit.test.ts worker/api/controllers/sitePage/draftController.ts worker/api/routes/sitePageRoutes.ts worker/api/controllers/sitePage/site-page-wiring.test.ts
git commit -m "feat(discover): draft product page text with ai for site owners"
```

---

### Task 6: Admins review the page text

**Files:**
- Modify:
  - `worker/api/controllers/publishing/types.ts` (`PendingReview`);
  - `worker/api/controllers/publishing/publishingDto.ts` (`toPendingReview`);
  - `src/routes/admin/reviews.tsx`.
- Create: `src/components/site-page/PageCopySections.tsx`
- Test:
  - `worker/api/controllers/publishing/publishing-dto.test.ts`: create it, or append if a DTO test already exists in that folder;
  - `src/routes/reviews-guard.test.ts`: append.

**Interfaces:**
- Consumes: `parseStoredPageCopy` (Task 1) and `schema.templateVersions.pageCopy` (Task 2).
- Produces:
  - `PendingReview.pageCopy: SitePageCopy | null`;
  - `<PageCopySections copy={SitePageCopy | null} fallbackDescription={string | null} />`, a plain-text renderer reused by the product page in Task 8.

- [ ] **Step 1: Write the failing tests**

Create `worker/api/controllers/publishing/publishing-dto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toPendingReview } from './publishingDto';
import type { PendingVersionRow } from '../../../database/services/TemplateService';

const COPY = {
	tagline: 'A calm site',
	about: ['About it.'],
	features: ['a', 'b', 'c'],
	includes: [{ name: 'Home', detail: 'The one page' }],
	madeFor: ['Studios', 'Teachers'],
};

function row(pageCopy: string | null): PendingVersionRow {
	return {
		listing: { id: 'l1', sourceAppId: 'app1' },
		version: {
			id: 'v1',
			version: 1,
			priceCents: 2900,
			fileCount: 5,
			totalBytes: 100,
			createdAt: null,
			pageCopy,
		},
		appTitle: 'North Ridge',
		creatorName: 'Creator',
		creatorEmail: null,
	} as unknown as PendingVersionRow;
}

describe('toPendingReview', () => {
	it('shows the page text submitted with the version', () => {
		expect(toPendingReview(row(JSON.stringify(COPY))).pageCopy).toEqual(COPY);
		expect(toPendingReview(row(null)).pageCopy).toBeNull();
	});
});
```

Append to `src/routes/reviews-guard.test.ts`. Add `'/src/components/site-page/PageCopySections.tsx'` to its glob list if it has one; otherwise add a separate glob following the file's pattern:

```ts
describe('reviewing page text', () => {
	it('shows the submitted text as plain text', () => {
		expect(source('/src/routes/admin/reviews.tsx')).toContain('<PageCopySections');
		const sections = source('/src/components/site-page/PageCopySections.tsx');
		expect(sections).not.toContain('dangerouslySetInnerHTML');
		expect(sections).toContain("What's included");
	});
});
```

Use the file's existing `source()` helper and glob variable names.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run worker/api/controllers/publishing/publishing-dto.test.ts src/routes/reviews-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `worker/api/controllers/publishing/types.ts`, add `/** The page text submitted with this version. */ pageCopy: SitePageCopy | null;` to `PendingReview`.

In `worker/api/controllers/publishing/publishingDto.ts`, import `parseStoredPageCopy` from `'../../../../shared/types/site-page'`, and add `pageCopy: parseStoredPageCopy(row.version.pageCopy),` to `toPendingReview`.

Create `src/components/site-page/PageCopySections.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { SitePageCopy } from '@/api-types';

interface PageCopySectionsProps {
	copy: SitePageCopy | null;
	/** Shown as About when there is no page text. */
	fallbackDescription: string | null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-semibold text-kumo-strong">{title}</h2>
			{children}
		</section>
	);
}

/** Page text rendered as plain text: About, Features, What's included and Made for. */
export function PageCopySections({ copy, fallbackDescription }: PageCopySectionsProps) {
	const about = copy?.about ?? (fallbackDescription ? fallbackDescription.split(/\n\s*\n/).filter(Boolean) : []);
	return (
		<div className="grid gap-8">
			{about.length > 0 && (
				<Section title="About">
					{about.map((paragraph, index) => (
						<p key={index} className="text-sm leading-relaxed text-kumo-default">
							{paragraph}
						</p>
					))}
				</Section>
			)}
			{copy && (
				<Section title="Features">
					<ul className="grid list-disc gap-1.5 pl-5 text-sm text-kumo-default">
						{copy.features.map((feature) => (
							<li key={feature}>{feature}</li>
						))}
					</ul>
				</Section>
			)}
			{copy && (
				<Section title="What's included">
					<dl className="grid gap-3 text-sm">
						{copy.includes.map((item) => (
							<div key={item.name} className="grid gap-0.5">
								<dt className="font-medium text-kumo-default">{item.name}</dt>
								<dd className="text-kumo-subtle">{item.detail}</dd>
							</div>
						))}
					</dl>
				</Section>
			)}
			{copy && (
				<Section title="Made for">
					<ul className="flex flex-wrap gap-2">
						{copy.madeFor.map((item) => (
							<li key={item} className="rounded-full px-3 py-1 text-sm text-kumo-default ring ring-kumo-hairline">
								{item}
							</li>
						))}
					</ul>
				</Section>
			)}
		</div>
	);
}
```

In `src/routes/admin/reviews.tsx`, inside the review card after the `grid gap-1 text-sm` details block, add:

```tsx
					<div className="grid gap-2 rounded-lg p-3 ring ring-kumo-hairline">
						<span className="text-xs font-medium uppercase tracking-wide text-kumo-subtle">Page text</span>
						{review.pageCopy ? (
							<>
								<p className="text-sm font-medium text-kumo-default">{review.pageCopy.tagline}</p>
								<PageCopySections copy={review.pageCopy} fallbackDescription={null} />
							</>
						) : (
							<p className="text-sm text-kumo-subtle">No page text</p>
						)}
					</div>
```

Add `import { PageCopySections } from '@/components/site-page/PageCopySections';`.

- [ ] **Step 4: Run the tests and typechecks**

Run: `npx vitest run worker/api/controllers/publishing src/routes/reviews-guard.test.ts`
Expected: PASS. Then run both typechecks; expected: the worker typecheck is clean, and the app typecheck shows only the 4 accepted errors.

- [ ] **Step 5: Commit**

```bash
git add worker/api/controllers/publishing/types.ts worker/api/controllers/publishing/publishingDto.ts worker/api/controllers/publishing/publishing-dto.test.ts src/components/site-page/PageCopySections.tsx src/routes/admin/reviews.tsx src/routes/reviews-guard.test.ts
git commit -m "feat(discover): show page text in the admin review queue"
```

---

### Task 7: Frontend data for product pages

**Files:**
- Modify:
  - `src/lib/api-client.ts`
  - `src/lib/query-keys.ts`
  - `src/lib/query-keys.test.ts`
- Create:
  - `src/hooks/use-site-page.ts`
  - `src/lib/page-copy-form.ts` and `src/lib/page-copy-form.test.ts`

**Interfaces:**
- Consumes:
  - `SitePageData`, `PageCopyDraftData`, `SitePageCopy` and `PAGE_DRAFT_FAILED_MESSAGE` from `@/api-types`;
  - `unwrap` from `@/lib/unwrap-response`.
- Produces:
  - **API client:**
    - `apiClient.getSitePage(appId): Promise<ApiResponse<SitePageData>>`
    - `apiClient.draftPageCopy(appId): Promise<ApiResponse<PageCopyDraftData>>`
  - **Query key:** `queryKeys.apps.sitePage(appId: string, userId?: string | null)`
  - **Hooks:**
    - `useSitePage(appId: string | undefined)`
    - `useDraftPageCopy(appId: string)`
  - **Form helpers:**
    - `type PageCopyForm = { tagline: string; about: string; features: string; includes: string; madeFor: string }`
    - `EMPTY_PAGE_COPY_FORM`
    - `toPageCopyForm(copy: SitePageCopy | null): PageCopyForm`
    - `fromPageCopyForm(form: PageCopyForm): SitePageCopy`
    - `isEmptyPageCopyForm(form: PageCopyForm): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/page-copy-form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_PAGE_COPY_FORM, fromPageCopyForm, isEmptyPageCopyForm, toPageCopyForm } from './page-copy-form';
import type { SitePageCopy } from '@/api-types';

const COPY: SitePageCopy = {
	tagline: 'A calm site',
	about: ['First paragraph.', 'Second paragraph.'],
	features: ['Schedule', 'Pricing', 'Bios'],
	includes: [{ name: 'Home', detail: 'Hero and schedule' }],
	madeFor: ['Studios', 'Teachers'],
};

describe('page copy form', () => {
	it('round-trips page text through the editable fields', () => {
		expect(toPageCopyForm(COPY)).toEqual({
			tagline: 'A calm site',
			about: 'First paragraph.\n\nSecond paragraph.',
			features: 'Schedule\nPricing\nBios',
			includes: 'Home: Hero and schedule',
			madeFor: 'Studios\nTeachers',
		});
		expect(fromPageCopyForm(toPageCopyForm(COPY))).toEqual(COPY);
	});

	it('reads one item per line, skips blank lines and splits includes on the first colon', () => {
		const copy = fromPageCopyForm({
			...EMPTY_PAGE_COPY_FORM,
			features: 'A\n\n  B  \n',
			includes: 'Home: Hero: big\nAbout',
		});
		expect(copy.features).toEqual(['A', 'B']);
		expect(copy.includes).toEqual([
			{ name: 'Home', detail: 'Hero: big' },
			{ name: 'About', detail: '' },
		]);
	});

	it('knows when every field is empty', () => {
		expect(isEmptyPageCopyForm(EMPTY_PAGE_COPY_FORM)).toBe(true);
		expect(isEmptyPageCopyForm({ ...EMPTY_PAGE_COPY_FORM, tagline: '  ' })).toBe(true);
		expect(isEmptyPageCopyForm({ ...EMPTY_PAGE_COPY_FORM, madeFor: 'x' })).toBe(false);
		expect(toPageCopyForm(null)).toEqual(EMPTY_PAGE_COPY_FORM);
	});
});
```

Append to `src/lib/query-keys.test.ts`:

```ts
	it('keeps product pages under the public apps prefix, per viewer', () => {
		const page = queryKeys.apps.sitePage('app1', 'u1');
		expect(page.slice(0, queryKeys.apps.all.length)).toEqual(queryKeys.apps.all);
		expect(queryKeys.apps.sitePage('app1', null)).not.toEqual(page);
	});
```

Place it inside the file's existing `describe`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/page-copy-form.test.ts src/lib/query-keys.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/page-copy-form.ts`:

```ts
import type { SitePageCopy } from '@/api-types';

/** Page text as the publish dialog edits it: one item per line, About paragraphs separated by a blank line. */
export interface PageCopyForm {
	tagline: string;
	about: string;
	features: string;
	/** One `Name: line` per line. */
	includes: string;
	madeFor: string;
}

export const EMPTY_PAGE_COPY_FORM: PageCopyForm = { tagline: '', about: '', features: '', includes: '', madeFor: '' };

function lines(text: string): string[] {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function toPageCopyForm(copy: SitePageCopy | null): PageCopyForm {
	if (!copy) return EMPTY_PAGE_COPY_FORM;
	return {
		tagline: copy.tagline,
		about: copy.about.join('\n\n'),
		features: copy.features.join('\n'),
		includes: copy.includes.map((item) => `${item.name}: ${item.detail}`).join('\n'),
		madeFor: copy.madeFor.join('\n'),
	};
}

/** The page text the fields describe, before validation. */
export function fromPageCopyForm(form: PageCopyForm): SitePageCopy {
	return {
		tagline: form.tagline,
		about: form.about
			.split(/\n\s*\n/)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean),
		features: lines(form.features),
		includes: lines(form.includes).map((line) => {
			const colon = line.indexOf(':');
			return colon === -1
				? { name: line, detail: '' }
				: { name: line.slice(0, colon).trim(), detail: line.slice(colon + 1).trim() };
		}),
		madeFor: lines(form.madeFor),
	};
}

export function isEmptyPageCopyForm(form: PageCopyForm): boolean {
	return Object.values(form).every((value) => value.trim() === '');
}
```

In `src/lib/query-keys.ts`, add this to `apps`, after `strip`:

```ts
		/** A Discover product page; its offer depends on the viewer. */
		sitePage: (appId: string, userId?: string | null) =>
			[...queryKeys.apps.all, 'site-page', appId, userId ?? 'anonymous'] as const,
```

In `src/lib/api-client.ts`:
- add `PageCopyDraftData` and `SitePageData` to the `@/api-types` import;
- add, after `getSitePublishing`:

```ts
	/** A Discover site's product page; quiet because the page shows its own unavailable state. */
	async getSitePage(appId: string): Promise<ApiResponse<SitePageData>> {
		return this.request<SitePageData>(`/api/discover/${appId}`, {}, true);
	}

	/** An AI draft of a site's page text, for its owner; quiet because the dialog shows the failure inline. */
	async draftPageCopy(appId: string): Promise<ApiResponse<PageCopyDraftData>> {
		return this.request<PageCopyDraftData>(`/api/apps/${appId}/page-copy/draft`, { method: 'POST' }, true);
	}
```

Create `src/hooks/use-site-page.ts`:

```ts
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/contexts/auth-context';
import { unwrap } from '@/lib/unwrap-response';
import { PAGE_DRAFT_FAILED_MESSAGE, SITE_PAGE_UNAVAILABLE_MESSAGE } from '@/api-types';

/** Waits for the session, so the page's offer matches the viewer. */
export function useSitePage(appId: string | undefined) {
	const { user, isLoading } = useAuth();
	return useQuery({
		queryKey: queryKeys.apps.sitePage(appId ?? '', user?.id),
		queryFn: () => unwrap(apiClient.getSitePage(appId!), SITE_PAGE_UNAVAILABLE_MESSAGE),
		enabled: !!appId && !isLoading,
		retry: false,
	});
}

export function useDraftPageCopy(appId: string) {
	return useMutation({
		mutationFn: () => unwrap(apiClient.draftPageCopy(appId), PAGE_DRAFT_FAILED_MESSAGE),
	});
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run src/lib/page-copy-form.test.ts src/lib/query-keys.test.ts`
Expected: PASS. Then run `npx tsc -p tsconfig.app.json --noEmit`; expected: only the 4 accepted errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-client.ts src/lib/query-keys.ts src/lib/query-keys.test.ts src/lib/page-copy-form.ts src/lib/page-copy-form.test.ts src/hooks/use-site-page.ts
git commit -m "feat(discover): frontend data for product pages and page text drafts"
```

---

### Task 8: The product page

**Files:**
- Create:
  - `src/routes/discover/site.tsx`
  - in `src/components/site-page/`: `SiteMainButton.tsx`, `SiteHeader.tsx`, `DevicePreview.tsx`, `SiteDetailsCard.tsx`, `MoreFromCreator.tsx`, `StickyBuyBar.tsx`
  - `src/routes/site-page-guard.test.ts`
- Modify: `src/routes.tsx` (the `discover/:appId` route)

**Interfaces:**
- Consumes:
  - `useSitePage` (Task 7);
  - `PageCopySections` (Task 6);
  - `useCreateSiteCheckout` (`@/hooks/use-payments`);
  - `useAuthGuard`;
  - `UseSiteDialog` and `PublishDialog`;
  - `SitePageData`, `SITE_PAGE_UNAVAILABLE_MESSAGE`, `TEMPLATE_CATEGORY_LABELS` and `formatTemplatePrice` from `@/api-types`.
- Produces:
  - the route `/discover/:appId`;
  - `SiteActions { use(): void; buy(): void; edit(): void; buying: boolean }`;
  - `<SiteMainButton page actions />`.

- [ ] **Step 1: Write the failing guard test**

Create `src/routes/site-page-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/routes/discover/site.tsx',
		'/src/components/site-page/SiteMainButton.tsx',
		'/src/components/site-page/SiteHeader.tsx',
		'/src/components/site-page/DevicePreview.tsx',
		'/src/components/site-page/SiteDetailsCard.tsx',
		'/src/components/site-page/StickyBuyBar.tsx',
		'/src/components/site-page/MoreFromCreator.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('the product page', () => {
	it('lives at /discover/:appId for everyone', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toContain("path: 'discover/:appId'");
		expect(routes).toContain('Component: SitePage');
	});

	it('asks signed-out visitors to sign in before buying or using, and sends buyers to Stripe', () => {
		const page = source('/src/routes/discover/site.tsx');
		expect(page).toContain('requireAuth(');
		expect(page).toContain('window.location.assign(result.checkoutUrl)');
		expect(page).toContain('checkout.isPending || checkout.isSuccess');
		expect(page).toContain('SITE_PAGE_UNAVAILABLE_MESSAGE');
		expect(page).toContain('to="/discover"');
	});

	it('offers the right action for each viewer', () => {
		const button = source('/src/components/site-page/SiteMainButton.tsx');
		for (const text of ['Buy for', 'Use this site', 'Edit page', 'Not available yet']) {
			expect(button).toContain(text);
		}
	});

	it('shows the live site in a device frame with a screenshot fallback', () => {
		const preview = source('/src/components/site-page/DevicePreview.tsx');
		expect(preview).toContain('<iframe');
		expect(preview).toContain('Desktop');
		expect(preview).toContain('Phone');
		expect(preview).toContain('LOAD_TIMEOUT_MS');
		expect(preview).toContain('screenshotUrl');
		expect(source('/src/components/site-page/SiteHeader.tsx')).toContain('Open live site ↗');
	});

	it('states what a buyer gets and keeps the action in view', () => {
		const details = source('/src/components/site-page/SiteDetailsCard.tsx');
		expect(details).toContain('What you get: your own copy of the full site, which you can keep editing with the AI.');
		expect(details).toContain('Secure checkout with Stripe');
		expect(source('/src/components/site-page/StickyBuyBar.tsx')).toContain('IntersectionObserver');
		expect(source('/src/components/site-page/MoreFromCreator.tsx')).toContain('/discover/${site.id}');
	});

	it('renders page text as plain text only', () => {
		for (const path of Object.keys(sources)) {
			expect(source(path)).not.toContain('dangerouslySetInnerHTML');
		}
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/site-page-guard.test.ts`
Expected: FAIL, because the sources are missing.

- [ ] **Step 3: The components**

Create `src/components/site-page/SiteMainButton.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Button } from '@cloudflare/kumo';
import { formatTemplatePrice, type SitePageData } from '@/api-types';

export interface SiteActions {
	use: () => void;
	buy: () => void;
	edit: () => void;
	/** Checkout started; stays true until the browser leaves for Stripe. */
	buying: boolean;
}

/** The page's main action for this viewer: buy, use, edit their own page, or nothing yet. */
export function SiteMainButton({ page, actions }: { page: SitePageData; actions: SiteActions }): ReactNode {
	const offer = page.offer;
	switch (offer.kind) {
		case 'paid':
			return (
				<Button variant="primary" loading={actions.buying} onClick={actions.buy}>
					Buy for {formatTemplatePrice(offer.priceCents)}
				</Button>
			);
		case 'free':
		case 'owned':
			return (
				<Button variant="primary" onClick={actions.use}>
					Use this site
				</Button>
			);
		case 'own':
			return (
				<div className="flex items-center gap-2">
					<Button variant="secondary" onClick={actions.edit}>
						Edit page
					</Button>
					<Button variant="primary" disabled={!offer.canUse} onClick={actions.use}>
						Use this site
					</Button>
				</div>
			);
		case 'not-yet-available':
			return (
				<Button variant="primary" disabled>
					Not available yet
				</Button>
			);
	}
}
```

Create `src/components/site-page/SiteHeader.tsx`:

```tsx
import type { Ref } from 'react';
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS, type SitePageData } from '@/api-types';
import { SiteMainButton, type SiteActions } from './SiteMainButton';

interface SiteHeaderProps {
	page: SitePageData;
	actions: SiteActions;
	/** The sticky bar appears once this element scrolls out of view. */
	actionsRef: Ref<HTMLDivElement>;
}

export function SiteHeader({ page, actions, actionsRef }: SiteHeaderProps) {
	const kind = page.category ? TEMPLATE_CATEGORY_LABELS[page.category] : 'Site';
	return (
		<header className="flex flex-wrap items-start justify-between gap-4">
			<div className="grid gap-1">
				<h1 className="text-3xl font-semibold text-kumo-strong">{page.title}</h1>
				{page.copy?.tagline && <p className="text-lg text-kumo-default">{page.copy.tagline}</p>}
				<p className="text-sm text-kumo-subtle">
					{kind} template by {page.creator.displayName}
				</p>
			</div>
			<div ref={actionsRef} className="flex flex-wrap items-center gap-3">
				<span className="text-lg font-medium text-kumo-default">
					{page.priceCents !== null ? formatTemplatePrice(page.priceCents) : 'Free'}
				</span>
				{page.previewUrl && (
					<a
						href={page.previewUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="rounded-lg px-3 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline hover:ring-kumo-line"
					>
						Open live site ↗
					</a>
				)}
				<SiteMainButton page={page} actions={actions} />
			</div>
		</header>
	);
}
```

Create `src/components/site-page/DevicePreview.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const FRAME_HEIGHT = 640;
const LOAD_TIMEOUT_MS = 15_000;

type Device = 'desktop' | 'phone';

interface DevicePreviewProps {
	title: string;
	previewUrl: string | null;
	screenshotUrl: string | null;
}

/** The live site in a desktop or phone frame; the screenshot stands in when the preview can't load. */
export function DevicePreview({ title, previewUrl, screenshotUrl }: DevicePreviewProps) {
	const [device, setDevice] = useState<Device>('desktop');
	const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>(previewUrl ? 'loading' : 'failed');
	const frameRef = useRef<HTMLDivElement>(null);
	const [frameWidth, setFrameWidth] = useState(0);

	useEffect(() => {
		const element = frameRef.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setFrameWidth(entry.contentRect.width));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!previewUrl) return;
		setStatus('loading');
		const timer = window.setTimeout(
			() => setStatus((current) => (current === 'loading' ? 'failed' : current)),
			LOAD_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [previewUrl]);

	const scale = frameWidth > 0 ? Math.min(1, frameWidth / DESKTOP_WIDTH) : 1;
	const live = previewUrl !== null && status !== 'failed';

	return (
		<section className="grid gap-3">
			<div className="flex justify-center gap-1" role="group" aria-label="Preview size">
				{(['desktop', 'phone'] as const).map((option) => (
					<button
						key={option}
						type="button"
						aria-pressed={device === option}
						onClick={() => setDevice(option)}
						className={`rounded-lg px-3 py-1 text-sm ${device === option ? 'bg-kumo-elevated text-kumo-strong ring ring-kumo-line' : 'text-kumo-subtle'}`}
					>
						{option === 'desktop' ? 'Desktop' : 'Phone'}
					</button>
				))}
			</div>
			<div
				ref={frameRef}
				className="relative overflow-hidden rounded-xl bg-kumo-recessed ring ring-kumo-hairline"
				style={{ height: FRAME_HEIGHT }}
			>
				{live && device === 'desktop' && (
					<iframe
						title={`${title} preview`}
						src={previewUrl}
						onLoad={() => setStatus('loaded')}
						className="border-0"
						style={{
							width: DESKTOP_WIDTH,
							height: FRAME_HEIGHT / scale,
							transform: `scale(${scale})`,
							transformOrigin: 'top left',
						}}
					/>
				)}
				{live && device === 'phone' && (
					<div className="flex h-full justify-center py-4">
						<iframe
							title={`${title} preview on a phone`}
							src={previewUrl}
							onLoad={() => setStatus('loaded')}
							className="rounded-[28px] border-0 ring-4 ring-kumo-line"
							style={{ width: PHONE_WIDTH, height: FRAME_HEIGHT - 32 }}
						/>
					</div>
				)}
				{!live &&
					(screenshotUrl ? (
						<img src={screenshotUrl} alt={`${title} screenshot`} className="size-full object-cover object-top" />
					) : (
						<div className="flex h-full items-center justify-center text-sm text-kumo-subtle">Preview unavailable</div>
					))}
			</div>
		</section>
	);
}
```

Create `src/components/site-page/SiteDetailsCard.tsx`:

```tsx
import { formatTemplatePrice, TEMPLATE_CATEGORY_LABELS, type SitePageData } from '@/api-types';

function formatDate(iso: string | null): string | null {
	return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;
}

export function SiteDetailsCard({ page }: { page: SitePageData }) {
	const published = formatDate(page.publishedAt);
	const updated = formatDate(page.updatedAt);
	const rows: Array<[string, string]> = [
		['Category', page.category ? TEMPLATE_CATEGORY_LABELS[page.category] : 'None'],
		['Price', page.priceCents !== null ? formatTemplatePrice(page.priceCents) : 'Free'],
		['Uses', String(page.stats.uses)],
		['Views', String(page.stats.views)],
		['Likes', String(page.stats.likes)],
		...(published ? [['Published', published] as [string, string]] : []),
		...(updated ? [['Last updated', updated] as [string, string]] : []),
	];
	return (
		<aside className="grid h-fit gap-4 rounded-xl p-4 ring ring-kumo-hairline">
			<div className="flex items-center gap-3">
				{page.creator.avatarUrl ? (
					<img src={page.creator.avatarUrl} alt="" className="size-9 rounded-full" />
				) : (
					<span className="flex size-9 items-center justify-center rounded-full bg-kumo-elevated text-sm text-kumo-default">
						{page.creator.displayName.charAt(0).toUpperCase()}
					</span>
				)}
				<span className="text-sm font-medium text-kumo-default">{page.creator.displayName}</span>
			</div>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
				{rows.map(([label, value]) => (
					<div key={label} className="contents">
						<dt className="text-kumo-subtle">{label}</dt>
						<dd className="text-kumo-default">{value}</dd>
					</div>
				))}
			</dl>
			{page.approvedShots && (
				<div className="grid gap-2">
					<span className="text-xs text-kumo-subtle">Approved version</span>
					<div className="grid grid-cols-[1fr_auto] items-end gap-2">
						<img src={page.approvedShots.desktop} alt={`${page.title} on a desktop`} className="w-full rounded-md ring ring-kumo-hairline" />
						<img src={page.approvedShots.mobile} alt={`${page.title} on a phone`} className="w-14 rounded-md ring ring-kumo-hairline" />
					</div>
				</div>
			)}
			<p className="text-sm text-kumo-subtle">
				What you get: your own copy of the full site, which you can keep editing with the AI.
			</p>
			{page.priceCents !== null && <p className="text-xs text-kumo-subtle">Secure checkout with Stripe</p>}
		</aside>
	);
}
```

Create `src/components/site-page/MoreFromCreator.tsx`:

```tsx
import { Link } from 'react-router';
import { formatTemplatePrice, type SitePageCard } from '@/api-types';

export function MoreFromCreator({ creatorName, sites }: { creatorName: string; sites: SitePageCard[] }) {
	if (sites.length === 0) return null;
	return (
		<section className="grid gap-3">
			<h2 className="text-lg font-semibold text-kumo-strong">More from {creatorName}</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{sites.map((site) => (
					<Link
						key={site.id}
						to={`/discover/${site.id}`}
						className="grid gap-2 rounded-xl p-2 ring ring-kumo-hairline hover:ring-kumo-line"
					>
						<div className="aspect-[16/10] overflow-hidden rounded-lg bg-kumo-recessed">
							{site.screenshotUrl && <img src={site.screenshotUrl} alt="" loading="lazy" className="size-full object-cover" />}
						</div>
						<div className="flex items-center justify-between gap-2 px-1">
							<span className="truncate text-sm text-kumo-default">{site.title}</span>
							<span className="shrink-0 text-xs text-kumo-subtle">
								{site.priceCents !== null ? formatTemplatePrice(site.priceCents) : 'Free'}
							</span>
						</div>
					</Link>
				))}
			</div>
		</section>
	);
}
```

Create `src/components/site-page/StickyBuyBar.tsx`:

```tsx
import { useEffect, useState, type RefObject } from 'react';
import { formatTemplatePrice, type SitePageData } from '@/api-types';
import { SiteMainButton, type SiteActions } from './SiteMainButton';

interface StickyBuyBarProps {
	page: SitePageData;
	actions: SiteActions;
	/** The header's actions; the bar shows while they are out of view. */
	watchRef: RefObject<HTMLDivElement | null>;
}

export function StickyBuyBar({ page, actions, watchRef }: StickyBuyBarProps) {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const element = watchRef.current;
		if (!element) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting));
		observer.observe(element);
		return () => observer.disconnect();
	}, [watchRef]);

	if (!visible) return null;
	return (
		<div className="fixed inset-x-0 bottom-0 z-30 border-t border-kumo-hairline bg-kumo-base/95 backdrop-blur">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="truncate text-sm font-medium text-kumo-default">{page.title}</span>
					<span className="shrink-0 text-sm text-kumo-subtle">
						{page.priceCents !== null ? formatTemplatePrice(page.priceCents) : 'Free'}
					</span>
				</div>
				<SiteMainButton page={page} actions={actions} />
			</div>
		</div>
	);
}
```

Also export `SitePageCard` from `src/api-types.ts`. It is already exported in Task 4; confirm.

- [ ] **Step 4: The route**

Create `src/routes/discover/site.tsx`:

```tsx
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button, Loader } from '@cloudflare/kumo';
import { useSitePage } from '@/hooks/use-site-page';
import { useCreateSiteCheckout } from '@/hooks/use-payments';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { UseSiteDialog } from '@/components/publishing/UseSiteDialog';
import { PublishDialog } from '@/components/publishing/PublishDialog';
import { SiteHeader } from '@/components/site-page/SiteHeader';
import { DevicePreview } from '@/components/site-page/DevicePreview';
import { PageCopySections } from '@/components/site-page/PageCopySections';
import { SiteDetailsCard } from '@/components/site-page/SiteDetailsCard';
import { MoreFromCreator } from '@/components/site-page/MoreFromCreator';
import { StickyBuyBar } from '@/components/site-page/StickyBuyBar';
import type { SiteActions } from '@/components/site-page/SiteMainButton';
import { SITE_PAGE_UNAVAILABLE_MESSAGE } from '@/api-types';

/** A Discover site's product page: the live site, its page text and the action that fits the viewer. */
export default function SitePage() {
	const { appId } = useParams<{ appId: string }>();
	const page = useSitePage(appId);
	const checkout = useCreateSiteCheckout();
	const { requireAuth } = useAuthGuard();
	const [useOpen, setUseOpen] = useState(false);
	const [editOpen, setEditOpen] = useState(false);
	const actionsRef = useRef<HTMLDivElement>(null);

	if (page.isLoading) {
		return (
			<div className="flex justify-center py-24">
				<Loader />
			</div>
		);
	}

	if (page.isError || !page.data) {
		const unavailable = !page.error || page.error.message === SITE_PAGE_UNAVAILABLE_MESSAGE;
		return (
			<div className="mx-auto grid max-w-md justify-items-center gap-3 px-4 py-24 text-center">
				<p className="text-kumo-default">{unavailable ? SITE_PAGE_UNAVAILABLE_MESSAGE : page.error?.message}</p>
				{unavailable ? (
					<Link to="/discover" className="text-sm text-kumo-subtle underline-offset-2 hover:underline">
						Back to Discover
					</Link>
				) : (
					<Button variant="secondary" onClick={() => page.refetch()}>
						Try again
					</Button>
				)}
			</div>
		);
	}

	const data = page.data;
	const intendedUrl = `/discover/${data.id}`;
	const actions: SiteActions = {
		use: () => {
			if (requireAuth({ requireFullAuth: true, actionContext: 'to use this site', intendedUrl })) setUseOpen(true);
		},
		buy: () => {
			if (!requireAuth({ requireFullAuth: true, actionContext: 'to buy this site', intendedUrl })) return;
			checkout.mutate(data.id, {
				onSuccess: (result) => window.location.assign(result.checkoutUrl),
				onError: (error) => toast.error(error.message),
			});
		},
		edit: () => setEditOpen(true),
		buying: checkout.isPending || checkout.isSuccess,
	};

	return (
		<div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 pb-24">
			<SiteHeader page={data} actions={actions} actionsRef={actionsRef} />
			<DevicePreview title={data.title} previewUrl={data.previewUrl} screenshotUrl={data.screenshotUrl} />
			<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
				<PageCopySections copy={data.copy} fallbackDescription={data.description} />
				<SiteDetailsCard page={data} />
			</div>
			<MoreFromCreator creatorName={data.creator.displayName} sites={data.moreFromCreator} />
			<StickyBuyBar page={data} actions={actions} watchRef={actionsRef} />
			<UseSiteDialog sourceAppId={data.id} sourceTitle={data.title} open={useOpen} onOpenChange={setUseOpen} />
			{data.offer.kind === 'own' && <PublishDialog appId={data.id} open={editOpen} onOpenChange={setEditOpen} />}
		</div>
	);
}
```

In `src/routes.tsx`:
- import `SitePage from './routes/discover/site'`;
- add `{ path: 'discover/:appId', Component: SitePage },` right after the `discover` route.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `npx vitest run src/routes/site-page-guard.test.ts src/routes/discover-guard.test.ts src/routes/reviews-guard.test.ts`
Expected: PASS.

Then:
- run `npx tsc -p tsconfig.app.json --noEmit`; expected: only the 4 accepted errors;
- run `npx eslint src/routes/discover/site.tsx src/components/site-page`; expected: 0 errors.

If `PublishDialog` cannot be imported here without a cycle, the typecheck or lint shows it. In that case, ledger it and lazy-import it with `React.lazy`.

- [ ] **Step 6: Commit**

```bash
git add src/routes/discover/site.tsx src/components/site-page src/routes.tsx src/routes/site-page-guard.test.ts
git commit -m "feat(discover): product page with a live device preview and page text"
```

---

### Task 9: The "Page" section in the publish dialog

**Files:**
- Create: `src/components/publishing/PageCopyFields.tsx`
- Modify: `src/components/publishing/PublishDialog.tsx`
- Test: append to `src/routes/publishing-guard.test.ts`

**Interfaces:**
- Consumes:
  - `useDraftPageCopy` and the form helpers (Task 7);
  - `validatePageCopy`, `SITE_PAGE_LIMITS`, `PAGE_DRAFT_FAILED_MESSAGE`, `SitePageCopy` and `SitePublishingData` (now with `pageCopy` and `pageCopyInReview`) from `@/api-types`.
- Produces:
  - `<PageCopyFields appId initialCopy inReview onChange />`, where `onChange` receives `PageCopyState = { payload: SitePageCopy | null; valid: boolean }`;
  - `PublishSiteRequest.pageCopy` is sent with every public publish from the dialog.

- [ ] **Step 1: Write the failing guard test**

Append to `src/routes/publishing-guard.test.ts`. Add `'/src/components/publishing/PageCopyFields.tsx'` to its glob list, using the file's existing `source()` helper:

```ts
describe('page text in the publish dialog', () => {
	it('drafts on first open, can redraft, and shows the limits', () => {
		const fields = source('/src/components/publishing/PageCopyFields.tsx');
		expect(fields).toContain('Drafting…');
		expect(fields).toContain('Redraft with AI');
		expect(fields).toContain('PAGE_DRAFT_FAILED_MESSAGE');
		expect(fields).toContain('validatePageCopy(');
		expect(fields).toContain('SITE_PAGE_LIMITS');
		expect(fields).toContain('Your page text is in review');
	});

	it('sends the page text with a public publish and blocks invalid text', () => {
		const dialog = source('/src/components/publishing/PublishDialog.tsx');
		expect(dialog).toContain('<PageCopyFields');
		expect(dialog).toContain('pageCopy: pageCopy.payload');
		expect(dialog).toContain('!pageCopy.valid');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/publishing-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/components/publishing/PageCopyFields.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { useDraftPageCopy } from '@/hooks/use-site-page';
import {
	EMPTY_PAGE_COPY_FORM,
	fromPageCopyForm,
	isEmptyPageCopyForm,
	toPageCopyForm,
	type PageCopyForm,
} from '@/lib/page-copy-form';
import {
	PAGE_DRAFT_FAILED_MESSAGE,
	SITE_PAGE_LIMITS,
	validatePageCopy,
	type SitePageCopy,
	type SitePageField,
} from '@/api-types';

export interface PageCopyState {
	/** The text to save; null saves no text. */
	payload: SitePageCopy | null;
	valid: boolean;
}

interface PageCopyFieldsProps {
	appId: string;
	initialCopy: SitePageCopy | null;
	inReview: boolean;
	onChange: (state: PageCopyState) => void;
}

const FIELDS: Array<{ key: SitePageField; label: string; hint: string; rows: number }> = [
	{ key: 'about', label: 'About', hint: 'Up to 3 paragraphs, separated by a blank line', rows: 5 },
	{ key: 'features', label: 'Features', hint: 'One per line, 3 to 8', rows: 4 },
	{ key: 'includes', label: "What's included", hint: 'One per line, as "Name: what it has"', rows: 4 },
	{ key: 'madeFor', label: 'Made for', hint: 'One per line, 2 to 5', rows: 3 },
];

/** The product page text: drafted by AI on first open, edited by the creator, checked against the shared limits. */
export function PageCopyFields({ appId, initialCopy, inReview, onChange }: PageCopyFieldsProps) {
	const draft = useDraftPageCopy(appId);
	const [form, setForm] = useState<PageCopyForm>(() => toPageCopyForm(initialCopy));
	const [lastDraft, setLastDraft] = useState<PageCopyForm | null>(null);
	const empty = isEmptyPageCopyForm(form);
	const validation = useMemo(() => validatePageCopy(fromPageCopyForm(form)), [form]);

	useEffect(() => {
		if (empty) onChange({ payload: null, valid: true });
		else onChange(validation.ok ? { payload: validation.value, valid: true } : { payload: null, valid: false });
	}, [empty, validation, onChange]);

	const requestDraft = () =>
		draft.mutate(undefined, {
			onSuccess: (result) => {
				const next = toPageCopyForm(result.copy);
				setForm(next);
				setLastDraft(next);
			},
		});

	// Drafts once when the dialog opens for a site without page text.
	useEffect(() => {
		if (!initialCopy) requestDraft();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const redraft = () => {
		const edited = !empty && JSON.stringify(form) !== JSON.stringify(lastDraft ?? EMPTY_PAGE_COPY_FORM);
		if (edited && !window.confirm('Replace your page text with a new draft?')) return;
		requestDraft();
	};

	const error = !empty && !validation.ok ? validation : null;
	const aboutLength = fromPageCopyForm(form).about.join('').length;

	return (
		<div className="grid gap-3 rounded-lg p-3 ring ring-kumo-hairline">
			<div className="flex items-center justify-between gap-2">
				<span className="text-sm font-medium text-kumo-default">Page</span>
				<Button size="sm" variant="secondary" loading={draft.isPending} onClick={redraft}>
					Redraft with AI
				</Button>
			</div>
			{inReview && <p className="text-xs text-kumo-subtle">Your page text is in review</p>}
			{draft.isPending && <p className="text-xs text-kumo-subtle">Drafting…</p>}
			{draft.isError && <p className="text-xs text-kumo-subtle">{PAGE_DRAFT_FAILED_MESSAGE}</p>}
			<label className="grid gap-1">
				<span className="flex justify-between text-xs text-kumo-subtle">
					<span>Tagline</span>
					<span>
						{form.tagline.trim().length}/{SITE_PAGE_LIMITS.tagline}
					</span>
				</span>
				<input
					value={form.tagline}
					onChange={(event) => setForm({ ...form, tagline: event.target.value })}
					className="rounded-md bg-kumo-base px-2 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline"
				/>
				{error?.field === 'tagline' && <span className="text-xs text-kumo-danger">{error.error}</span>}
			</label>
			{FIELDS.map((field) => (
				<label key={field.key} className="grid gap-1">
					<span className="flex justify-between text-xs text-kumo-subtle">
						<span>
							{field.label} · {field.hint}
						</span>
						{field.key === 'about' && (
							<span>
								{aboutLength}/{SITE_PAGE_LIMITS.aboutTotal}
							</span>
						)}
					</span>
					<textarea
						rows={field.rows}
						value={form[field.key]}
						onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
						className="rounded-md bg-kumo-base px-2 py-1.5 text-sm text-kumo-default ring ring-kumo-hairline"
					/>
					{error?.field === field.key && <span className="text-xs text-kumo-danger">{error.error}</span>}
				</label>
			))}
			{error && error.field === null && <span className="text-xs text-kumo-danger">{error.error}</span>}
		</div>
	);
}
```

Before writing it, check the Kumo danger text token used elsewhere in `src` with `grep -rho "text-kumo-danger\|text-kumo-error" src | sort | uniq -c`, and use whichever exists.

In `src/components/publishing/PublishDialog.tsx`:
- **Width:** change `<DialogContent className="sm:max-w-lg">` to `<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">`.
- **Imports:** `import { PageCopyFields, type PageCopyState } from './PageCopyFields';` and add `useCallback` to the React import.
- **State in `PublishForm`:** after the `consent` state, add:

```tsx
	const [pageCopy, setPageCopy] = useState<PageCopyState>({ payload: data.pageCopy, valid: true });
	const updatePageCopy = useCallback((state: PageCopyState) => setPageCopy(state), []);
```

- **Request:** add `pageCopy: pageCopy.payload,` to the object passed to `onSubmit` inside `publish`.
- **Fields:** render the section right before the consent `<label>`:

```tsx
			<PageCopyFields
				appId={appId}
				initialCopy={data.pageCopy}
				inReview={data.pageCopyInReview}
				onChange={updatePageCopy}
			/>
```

- **Props:** `PublishForm` needs `appId`. Add `appId: string` to `PublishFormProps`, and pass `appId={appId}` where `PublishDialogBody` renders `<PublishForm .../>`.
- **Publish button:** change its `disabled` to `disabled={!consent || !sellerReady || !pageCopy.valid}`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run src/routes/publishing-guard.test.ts src/routes/payments-guard.test.ts src/lib`
Expected: PASS.

Then:
- run `npx tsc -p tsconfig.app.json --noEmit`; expected: only the 4 accepted errors;
- run `npx eslint src/components/publishing/PageCopyFields.tsx src/components/publishing/PublishDialog.tsx`; expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/publishing/PageCopyFields.tsx src/components/publishing/PublishDialog.tsx src/routes/publishing-guard.test.ts
git commit -m "feat(discover): edit ai-drafted page text in the publish dialog"
```

---

### Task 10: Links to product pages

**Files:**
- Modify:
  - `src/routes/discover/index.tsx` (card click);
  - `src/components/publishing/DiscoverStrip.tsx` (card link);
  - `src/components/publishing/UseSiteButton.tsx` (paid Buy navigates to the page).
- Test: update `src/routes/discover-guard.test.ts`, `src/routes/reuse-guard.test.ts` and `src/routes/payments-guard.test.ts`.

**Interfaces:**
- Consumes: the `/discover/:appId` route (Task 8).
- Produces: every Discover entry point opens the product page. The app page's Buy opens the product page instead of starting Checkout.

- [ ] **Step 1: Update the guard tests**

In `src/routes/discover-guard.test.ts`:
- in "starts from a published site on the home page", replace `expect(strip).toContain('?use=1');` with `expect(strip).toContain('to={`/discover/${app.id}`}');`;
- add a test:

```ts
	it('opens product pages from Discover', () => {
		expect(source('/src/routes/discover/index.tsx')).toContain('navigate(`/discover/${appId}`)');
	});
```

In `src/routes/reuse-guard.test.ts`, in "offers Use or Buy on the app page and opens the dialog from ?use=1":
- replace `expect(button).toContain('Secure checkout with Stripe');` with `expect(button).toContain('navigate(`/discover/${app.id}`)');`.

In `src/routes/payments-guard.test.ts`:
- replace the test "sends the buyer to Stripe Checkout and keeps the button busy until the browser leaves" with:

```ts
	it('sends a buyer from the app page to the product page, which starts Stripe Checkout', () => {
		const button = source('/src/components/publishing/UseSiteButton.tsx');
		expect(button).toContain('navigate(`/discover/${app.id}`)');
		expect(button).not.toContain('useCreateSiteCheckout');
		expect(button).not.toContain('test mode');
	});
```

The checkout assertions now live in `src/routes/site-page-guard.test.ts` (Task 8).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/routes/discover-guard.test.ts src/routes/reuse-guard.test.ts src/routes/payments-guard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **Discover page:** in `src/routes/discover/index.tsx`, change `onAppClick={(appId) => navigate(`/app/${appId}`)}` to `onAppClick={(appId) => navigate(`/discover/${appId}`)}`.
- **Home strip:** in `src/components/publishing/DiscoverStrip.tsx`, change `to={`/app/${app.id}?use=1`}` to `to={`/discover/${app.id}`}`.
- **App page Buy button:** in `src/components/publishing/UseSiteButton.tsx`:
  1. Remove the `useCreateSiteCheckout` import and the `checkout` constant.
  2. Import `useNavigate` from `react-router`, and add `const navigate = useNavigate();`.
  3. Replace the whole `needsPurchase` branch with:

```tsx
	if (reuse.needsPurchase && reuse.priceCents !== null) {
		const price = formatTemplatePrice(reuse.priceCents);
		// The product page describes the site before Stripe Checkout.
		return (
			<Button size="sm" variant="primary" onClick={() => navigate(`/discover/${app.id}`)}>
				Buy for {price}
			</Button>
		);
	}
```

Remove the `toast` import if it is now unused. Leave the `?use=1` auto-open logic: the app page still supports it.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `npx vitest run src/routes/discover-guard.test.ts src/routes/reuse-guard.test.ts src/routes/payments-guard.test.ts src/routes/site-page-guard.test.ts`
Expected: PASS.

Then:
- run `npx tsc -p tsconfig.app.json --noEmit`; expected: only the 4 accepted errors;
- run `npx eslint src/routes/discover/index.tsx src/components/publishing/DiscoverStrip.tsx src/components/publishing/UseSiteButton.tsx`; expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/discover/index.tsx src/components/publishing/DiscoverStrip.tsx src/components/publishing/UseSiteButton.tsx src/routes/discover-guard.test.ts src/routes/reuse-guard.test.ts src/routes/payments-guard.test.ts
git commit -m "feat(discover): open product pages from discover, home and the buy button"
```

---

### Task 11: Live local check

The controller runs this task, with the dev server on port 8100, the browser pane, `stripe listen`, and the local accounts in `.superpowers/realtest/local-accounts.md`. Sign the browser in through a localhost-only helper; never print passwords.

- [ ] **Step 1: Draft, edit and review paid text**
  1. As the creator, open North Ridge, then "Publishing settings". Expected: "Drafting…", then the five fields filled.
  2. Edit the tagline, then Save. Expected: "in review", and `template_versions` has a pending version whose `page_copy` holds the edited text.
  3. Open `/discover/<North Ridge id>` signed out. Expected: the approved text, not the edited text.
  4. As the owner admin, open `/admin/reviews`. Expected: the version shows the edited text. Approve it.
  5. Reload the product page. Expected: the new tagline.

- [ ] **Step 2: A free site**
  1. Publish Lumen with drafted text. Expected: its page shows the text at once, with "Use this site".
  2. Signed out, click "Use this site". Expected: the sign-in prompt.

- [ ] **Step 3: The buyer path**
  1. As buyer2, open Discover and click a paid card. Expected: the product page.
  2. Click "Buy for $X". Expected: Stripe Checkout in test mode. Pay with 4242 4242 4242 4242.
  3. Expected on return: the app page with "Payment received".
  4. Back on the product page. Expected: "Use this site".

- [ ] **Step 4: Edge cases**
  1. Remove a site from Discover as admin. Expected: its page reads "This site isn't available".
  2. Toggle Desktop and Phone. Expected: the frame changes width.
  3. Scroll past the header. Expected: the sticky bar appears.
  4. Temporarily point the draft call at a failing model, or stop the network to the gateway. Expected: the dialog shows "Couldn't draft this page; write it yourself or try again", and Save still works.

- [ ] **Step 5: Record**

Ledger `Task 11: complete` with the outcomes and any `Ruling:` lines.
