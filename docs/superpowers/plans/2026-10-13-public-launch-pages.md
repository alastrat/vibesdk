# Landing, Pricing and Legal Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-out visitors an elegant landing page at estori.app/, a pricing page and four legal pages, and record each user's agreement to the terms, so estori.app can later be opened to the public.

**Architecture:**
- The pages live inside the existing React app.
- `App` becomes providers plus an `<Outlet/>`. Two layout routes sit under it:
  - the existing `AppLayout`, for the app;
  - a new `PublicLayout`, for `/pricing` and the legal pages.
- The index route picks the landing page or the builder home by sign-in state.
- Legal texts are Markdown files with named fields filled from one shared constants file.
- The server records agreement in two new `users` columns, through sign-up and a new accept endpoint.
- A public endpoint reports the daily limits in force.

**Tech Stack:** React 19, React Router 7, TanStack Query 5, Kumo UI, Tailwind 4 with `@tailwindcss/typography`, react-markdown and remark-gfm, Hono on Cloudflare Workers, Drizzle on D1, and Vitest in the Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-13-public-launch-pages-design.md`

## Global Constraints

**Legal identity (shared constants)**
- Operator: `Globalink Commerce Technologies LLC`, `a Texas limited liability company`, `206 Gray Street, Unit 3112, Houston, TX 77002`.
- Contact addresses: `support@estori.app`, `privacy@estori.app`, `copyright@estori.app`.
- `TERMS_VERSION` is `'2026-10-13'`.
- `TERMS_REQUIRED_MESSAGE` is `'Agree to the Terms of Service and Privacy Policy to create an account'`.

**Copy**
- The sign-up checkbox label is exactly: `I'm 18 or older and agree to the Terms of Service and Privacy Policy`, with both document names linked.
- The fee is always shown through `PLATFORM_FEE_LABEL` (`7% + $0.60`) from `shared/types/templates.ts`, never typed out.
- No page claims that generated stores take real payments. "Accept payments" is always labeled `Coming soon`.
- No page names a competitor. The banned list is in the Task 7 guard test.
- No emojis anywhere.

**Code**
- No `any`. The frontend imports shared types and constants through `@/api-types`.
- Comments explain purpose only, briefly.
- The CSP in `index.html` allows fonts from `'self'` only. Use the system font stack; do not add external fonts or scripts.

**Visual style:** 1Password-like.
- **Hero and final call to action:** a dark band, `#070b16`, with a soft radial glow in the brand blue, `var(--estori-action)` (`#0062e6`).
- **Headlines:** large and light, `font-light tracking-[-0.025em]`.
- **Buttons:** pills (`rounded-full`). The primary is filled brand blue; the secondary is outlined.
- **Cards and panels:** generous rounded cards (`rounded-3xl`) with a hairline ring, and sections spaced `py-20 sm:py-28`.
- **Eyebrows:** small labels in uppercase with tracking.
- **Themes:** everything outside the dark bands uses Kumo tokens (`bg-kumo-canvas`, `text-kumo-default`, `text-kumo-subtle`, `ring-kumo-hairline`), so dark and light both work.

**Running tests**
- Run from the repo root with `npx vitest run <paths>`.
- Tests run in the Cloudflare Workers pool, with no jsdom. Frontend tests are therefore pure-function tests or raw-source guard tests (`import.meta.glob(..., { query: '?raw', import: 'default', eager: true })`).
- `worker/api/routes/**` is excluded from Vitest, so route wiring tests live next to their controller.
- If a run dies with `EADDRNOTAVAIL` or `ERR_RUNTIME_FAILURE`, rerun it after about a minute. That's a known workerd flake, not a test failure.

**Git:** never stage or commit `wrangler.jsonc`, `.dev.vars` or `bun.lockb`. Commit with `git add <explicit paths>`.

## Review Focus

1. A signed-out visitor submits the landing build box, signs up, and should land in `/chat/new` with their prompt, without a terms window. Task 7 pins `BuildBox` keeping `requireFullAuth: true` and passing `intendedUrl`. Task 3 makes email sign-up record agreement.
2. A user whose payload doesn't carry `termsAccepted` must not be blocked. This covers API-key sessions and any path that maps a partial row. Task 3 pins the gate condition `user.termsAccepted === false`. Task 2 pins `mapUserResponse` adding the field only when the row has `termsVersion`.
3. A phone visitor (390 px) must see a working top bar. Its Discover and Pricing links hide below `sm`, and Sign in and Start building stay. Task 5's guard test pins `hidden sm:flex` on the links.
4. Legal pages must stay readable in dark mode. Task 5 pins `dark:prose-invert` on the legal page.
5. While sign-in state loads at `/`, show a neutral loader instead of flashing the landing page at a signed-in user. Task 7 pins `isLoading` handling in `RootIndex`.

---

### Task 1: Legal texts and shared legal constants

The four Markdown files already exist and are committed with this plan: `src/content/legal/terms.md`, `privacy.md`, `refunds.md` and `copyright.md`. Each starts with a header:
```
---
title: …
version: 2026-10-13
updated: October 13, 2026
---
```
The bodies use these fields: `{{entity.name}}`, `{{entity.kind}}`, `{{entity.address}}`, `{{contact.support}}`, `{{contact.privacy}}`, `{{contact.copyright}}` and `{{fee.label}}`. **Don't edit the legal wording.**

**Files:**
- Create: `shared/types/legal.ts`
- Create: `src/lib/legal-document.ts`
- Create: `src/lib/legal-document.test.ts`
- Create: `src/content/legal/legal-documents.ts`
- Create: `src/content/legal/legal-documents.test.ts`
- Modify: `src/api-types.ts` (re-export the legal constants beside the existing templates re-export, around lines 261-269)

**Interfaces:**
- Produces:
  - `TERMS_VERSION: string`
  - `isCurrentTermsVersion(version: unknown): boolean`
  - `TERMS_REQUIRED_MESSAGE`, `TERMS_OUTDATED_MESSAGE`
  - `LEGAL_ENTITY`, `LEGAL_CONTACT`
  - `legalAddressLine(): string`, from `shared/types/legal.ts`
  - `parseLegalDocument(raw: string, fields: Readonly<Record<string, string>>): LegalDocument`
  - `type LegalDocument = { title: string; version: string; updated: string; body: string }`, from `src/lib/legal-document.ts`
  - `LEGAL_SLUGS`, `type LegalSlug`, `LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument>`
  - `LEGAL_LINKS: ReadonlyArray<{ slug: LegalSlug; label: string; path: string }>`, from `src/content/legal/legal-documents.ts`

- [ ] **Step 1: Write the shared constants**

`shared/types/legal.ts`:
```ts
/** Who runs Estori, how to reach them, and which terms version users agree to. */

export const TERMS_VERSION = '2026-10-13';

export const TERMS_REQUIRED_MESSAGE = 'Agree to the Terms of Service and Privacy Policy to create an account';
export const TERMS_OUTDATED_MESSAGE = 'The terms were updated; reload the page to agree to the latest version';

export const LEGAL_ENTITY = {
	name: 'Globalink Commerce Technologies LLC',
	kind: 'a Texas limited liability company',
	street: '206 Gray Street, Unit 3112',
	city: 'Houston',
	state: 'TX',
	zip: '77002',
} as const;

export const LEGAL_CONTACT = {
	support: 'support@estori.app',
	privacy: 'privacy@estori.app',
	copyright: 'copyright@estori.app',
} as const;

export function legalAddressLine(): string {
	return `${LEGAL_ENTITY.street}, ${LEGAL_ENTITY.city}, ${LEGAL_ENTITY.state} ${LEGAL_ENTITY.zip}`;
}

export function isCurrentTermsVersion(version: unknown): boolean {
	return version === TERMS_VERSION;
}
```

In `src/api-types.ts`, add after the templates re-export block:
```ts
export {
	LEGAL_CONTACT,
	LEGAL_ENTITY,
	TERMS_OUTDATED_MESSAGE,
	TERMS_REQUIRED_MESSAGE,
	TERMS_VERSION,
	isCurrentTermsVersion,
	legalAddressLine,
} from '../shared/types/legal.js';
```

- [ ] **Step 2: Write the failing parser tests**

`src/lib/legal-document.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseLegalDocument } from './legal-document';

const RAW = ['---', 'title: Terms of Service', 'version: 2026-10-13', 'updated: October 13, 2026', '---', '', 'Run by {{entity.name}}.', ''].join('\n');

describe('parseLegalDocument', () => {
	it('reads the header and fills the named fields', () => {
		expect(parseLegalDocument(RAW, { 'entity.name': 'Globalink' })).toEqual({
			title: 'Terms of Service',
			version: '2026-10-13',
			updated: 'October 13, 2026',
			body: 'Run by Globalink.',
		});
	});

	it('fails on a field it has no value for, so a typo never reaches the page', () => {
		expect(() => parseLegalDocument(RAW, {})).toThrow('Unknown legal field: entity.name');
	});

	it('fails without a complete header', () => {
		expect(() => parseLegalDocument('Body only', {})).toThrow('Legal document is missing its header');
		const noVersion = ['---', 'title: X', 'updated: today', '---', 'Body'].join('\n');
		expect(() => parseLegalDocument(noVersion, {})).toThrow('Legal document header needs title, version and updated');
	});
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/lib/legal-document.test.ts`
Expected: FAIL, because `./legal-document` doesn't exist.

- [ ] **Step 4: Implement the parser**

`src/lib/legal-document.ts`:
```ts
/** Legal pages are Markdown with a small header and {{named}} fields filled from shared constants. */

export interface LegalDocument {
	title: string;
	version: string;
	updated: string;
	body: string;
}

const HEADER = /^---\n([\s\S]*?)\n---\n?/;
const FIELD = /\{\{\s*([a-z.]+)\s*\}\}/g;

export function parseLegalDocument(raw: string, fields: Readonly<Record<string, string>>): LegalDocument {
	const text = raw.replace(/\r\n/g, '\n');
	const header = HEADER.exec(text);
	if (!header) throw new Error('Legal document is missing its header');

	const meta = new Map<string, string>();
	for (const line of header[1].split('\n')) {
		const separator = line.indexOf(':');
		if (separator > 0) meta.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
	}
	const title = meta.get('title');
	const version = meta.get('version');
	const updated = meta.get('updated');
	if (!title || !version || !updated) throw new Error('Legal document header needs title, version and updated');

	const body = text.slice(header[0].length).replace(FIELD, (_match, name: string) => {
		const value = fields[name];
		if (value === undefined) throw new Error(`Unknown legal field: ${name}`);
		return value;
	});
	return { title, version, updated, body: body.trim() };
}
```

- [ ] **Step 5: Run the parser tests and watch them pass**

Run: `npx vitest run src/lib/legal-document.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing document tests**

`src/content/legal/legal-documents.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LEGAL_CONTACT, LEGAL_ENTITY, TERMS_VERSION, legalAddressLine } from '../../../shared/types/legal';
import { PLATFORM_FEE_LABEL } from '../../../shared/types/templates';
import { LEGAL_DOCUMENTS, LEGAL_LINKS, LEGAL_SLUGS } from './legal-documents';

describe('legal documents', () => {
	it('has the four pages, each with a path and a label', () => {
		expect(LEGAL_SLUGS).toEqual(['terms', 'privacy', 'refunds', 'copyright']);
		expect(LEGAL_LINKS.map((link) => link.path)).toEqual(['/terms', '/privacy', '/refunds', '/copyright']);
	});

	it('versions the terms and privacy policy together with what users agree to', () => {
		expect(LEGAL_DOCUMENTS.terms.version).toBe(TERMS_VERSION);
		expect(LEGAL_DOCUMENTS.privacy.version).toBe(TERMS_VERSION);
	});

	it('fills every field, naming the operator and its contact addresses', () => {
		for (const slug of LEGAL_SLUGS) {
			const { body, updated } = LEGAL_DOCUMENTS[slug];
			expect(body).not.toContain('{{');
			expect(body).toContain(LEGAL_ENTITY.name);
			expect(updated.length).toBeGreaterThan(0);
		}
		expect(LEGAL_DOCUMENTS.terms.body).toContain(legalAddressLine());
		expect(LEGAL_DOCUMENTS.terms.body).toContain(PLATFORM_FEE_LABEL);
		expect(LEGAL_DOCUMENTS.privacy.body).toContain(LEGAL_CONTACT.privacy);
		expect(LEGAL_DOCUMENTS.refunds.body).toContain(LEGAL_CONTACT.support);
		expect(LEGAL_DOCUMENTS.copyright.body).toContain(LEGAL_CONTACT.copyright);
	});

	it('names Texas law and Harris County courts, and the Stripe agreement for sellers', () => {
		expect(LEGAL_DOCUMENTS.terms.body).toContain('laws of the State of Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Harris County, Texas');
		expect(LEGAL_DOCUMENTS.terms.body).toContain('Stripe Connected Account Agreement');
	});
});
```

- [ ] **Step 7: Run it and watch it fail**

Run: `npx vitest run src/content/legal/legal-documents.test.ts`
Expected: FAIL, because `./legal-documents` doesn't exist.

- [ ] **Step 8: Implement the document registry**

`src/content/legal/legal-documents.ts`:
```ts
import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '../../../shared/types/legal';
import { PLATFORM_FEE_LABEL } from '../../../shared/types/templates';
import { parseLegalDocument, type LegalDocument } from '../../lib/legal-document';
import terms from './terms.md?raw';
import privacy from './privacy.md?raw';
import refunds from './refunds.md?raw';
import copyright from './copyright.md?raw';

export const LEGAL_SLUGS = ['terms', 'privacy', 'refunds', 'copyright'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const FIELDS: Readonly<Record<string, string>> = {
	'entity.name': LEGAL_ENTITY.name,
	'entity.kind': LEGAL_ENTITY.kind,
	'entity.address': legalAddressLine(),
	'contact.support': LEGAL_CONTACT.support,
	'contact.privacy': LEGAL_CONTACT.privacy,
	'contact.copyright': LEGAL_CONTACT.copyright,
	'fee.label': PLATFORM_FEE_LABEL,
};

export const LEGAL_DOCUMENTS: Record<LegalSlug, LegalDocument> = {
	terms: parseLegalDocument(terms, FIELDS),
	privacy: parseLegalDocument(privacy, FIELDS),
	refunds: parseLegalDocument(refunds, FIELDS),
	copyright: parseLegalDocument(copyright, FIELDS),
};

export const LEGAL_LINKS: ReadonlyArray<{ slug: LegalSlug; label: string; path: string }> = [
	{ slug: 'terms', label: 'Terms', path: '/terms' },
	{ slug: 'privacy', label: 'Privacy', path: '/privacy' },
	{ slug: 'refunds', label: 'Refunds', path: '/refunds' },
	{ slug: 'copyright', label: 'Copyright', path: '/copyright' },
];
```

- [ ] **Step 9: Run both test files and watch them pass**

Run: `npx vitest run src/lib/legal-document.test.ts src/content/legal/legal-documents.test.ts`
Expected: PASS (7 tests).

If a field's value is wrong, fix the constants. Never edit the legal wording to make a test pass.

- [ ] **Step 10: Commit**

```bash
git add shared/types/legal.ts src/api-types.ts src/lib/legal-document.ts src/lib/legal-document.test.ts src/content/legal/legal-documents.ts src/content/legal/legal-documents.test.ts
git commit -m "feat(legal): load the legal texts with the operator and contact details filled in"
```

---

### Task 2: Server records agreement to the terms

**Files:**
- Modify: `worker/database/schema.ts:24-65`: add two columns to `users`.
- Create: `migrations/0012_*.sql`, plus its `migrations/meta` snapshot and journal entry. Generate these with drizzle-kit, not by hand.
- Modify: `worker/types/auth-types.ts:15-27`: `AuthUser` gains `termsAccepted?: boolean`.
- Modify: `worker/utils/authUtils.ts:270-291`: `mapUserResponse`.
- Modify: `worker/database/services/AuthService.ts`:
  - `RegistrationData` (lines 48-52);
  - `register` (lines 91-219);
  - `getUserForAuth`'s column list (around line 940);
  - a new `acceptTerms` method.
- Modify: `worker/api/controllers/auth/authSchemas.ts:22-28`: add `acceptedTermsVersion`, plus a new `acceptTermsSchema`.
- Modify: `worker/api/controllers/auth/controller.ts`: add an `acceptTerms` handler.
- Modify: `worker/api/routes/authRoutes.ts`: add a route in the protected block (lines 24-27).
- Create: `worker/database/terms-schema.test.ts`
- Create: `worker/api/controllers/auth/terms-wiring.test.ts`
- Create: `worker/api/controllers/auth/accept-terms.test.ts`
- Create: `shared/types/legal.test.ts`

**Interfaces:**
- Consumes: `TERMS_VERSION`, `isCurrentTermsVersion`, `TERMS_REQUIRED_MESSAGE` and `TERMS_OUTDATED_MESSAGE` from Task 1.
- Produces:
  - `POST /api/auth/accept-terms` with body `{ version: string }`, responding `{ success: true, data: { user: AuthUser } }`, or 400 with a message;
  - the register body accepts `acceptedTermsVersion?: string`;
  - `AuthUser.termsAccepted?: boolean`;
  - `AuthService.acceptTerms(userId: string, version: unknown): Promise<AuthUser>`.

- [ ] **Step 1: Write the failing tests**

`shared/types/legal.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TERMS_VERSION, isCurrentTermsVersion, legalAddressLine } from './legal';

describe('terms version', () => {
	it('accepts only the current version', () => {
		expect(isCurrentTermsVersion(TERMS_VERSION)).toBe(true);
		expect(isCurrentTermsVersion('2020-01-01')).toBe(false);
		expect(isCurrentTermsVersion(undefined)).toBe(false);
		expect(isCurrentTermsVersion(20261013)).toBe(false);
	});

	it('formats the address on one line', () => {
		expect(legalAddressLine()).toBe('206 Gray Street, Unit 3112, Houston, TX 77002');
	});
});
```

`worker/database/terms-schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { mapUserResponse } from '../utils/authUtils';
import { TERMS_VERSION } from '../../shared/types/legal';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('terms agreement on users', () => {
	it('adds nullable agreement columns, so existing users have no recorded agreement', () => {
		const columns = getTableConfig(schema.users).columns;
		const acceptedAt = columns.find((column) => column.name === 'terms_accepted_at');
		const version = columns.find((column) => column.name === 'terms_version');
		expect(acceptedAt?.notNull).toBe(false);
		expect(version?.notNull).toBe(false);
	});

	it('ships both columns in a migration', () => {
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `terms_accepted_at` integer');
		expect(allMigrationSql).toContain('ALTER TABLE `users` ADD `terms_version` text');
	});

	it('reports termsAccepted only when the row carries the terms version', () => {
		const base = { id: 'u1', email: 'a@example.test' };
		expect(mapUserResponse({ ...base, termsVersion: TERMS_VERSION }).termsAccepted).toBe(true);
		expect(mapUserResponse({ ...base, termsVersion: '2020-01-01' }).termsAccepted).toBe(false);
		expect(mapUserResponse({ ...base, termsVersion: null }).termsAccepted).toBe(false);
		expect('termsAccepted' in mapUserResponse(base)).toBe(false);
	});
});
```

`worker/api/controllers/auth/terms-wiring.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/authRoutes.ts', '/worker/database/services/AuthService.ts', '/worker/api/controllers/auth/authSchemas.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function methodBody(text: string, signature: string): string {
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	const next = text.indexOf('\n    /**', start);
	return next === -1 ? text.slice(start) : text.slice(start, next);
}

describe('terms agreement wiring', () => {
	it('lets only signed-in users record agreement', () => {
		const line = source('/worker/api/routes/authRoutes.ts')
			.split('\n')
			.find((candidate) => candidate.includes("'/accept-terms'"));
		expect(line).toContain('setAuthLevel(AuthConfig.authenticated)');
		expect(line).toContain('AuthController.acceptTerms');
	});

	it('refuses a password sign-up without the current terms version, before creating the account', () => {
		const register = methodBody(source('/worker/database/services/AuthService.ts'), 'async register(');
		expect(register).toContain('isCurrentTermsVersion(data.acceptedTermsVersion)');
		expect(register).toContain('TERMS_REQUIRED_MESSAGE');
		expect(register.indexOf('isCurrentTermsVersion(')).toBeLessThan(register.indexOf('insert(schema.users)'));
		expect(register).toContain('termsVersion: TERMS_VERSION');
	});

	it('lets the version through the register schema and selects it for the session user', () => {
		expect(source('/worker/api/controllers/auth/authSchemas.ts')).toContain('acceptedTermsVersion:');
		const forAuth = methodBody(source('/worker/database/services/AuthService.ts'), 'getUserForAuth(');
		expect(forAuth).toContain('termsVersion: schema.users.termsVersion');
	});
});
```

`worker/api/controllers/auth/accept-terms.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteContext } from '../../types/route-context';
import { TERMS_OUTDATED_MESSAGE, TERMS_VERSION } from '../../../../shared/types/legal';

const { mockAcceptTerms } = vi.hoisted(() => ({ mockAcceptTerms: vi.fn() }));

vi.mock('../../../database/services/AuthService', () => ({
	AuthService: vi.fn().mockImplementation(() => ({ acceptTerms: mockAcceptTerms })),
}));

import { AuthController } from './controller';
import { SecurityError, SecurityErrorType } from 'shared/types/errors';

function context(): RouteContext {
	return {
		user: { id: 'user-1', email: 'user@example.com' },
		sessionId: 's1',
		config: {},
		pathParams: {},
		queryParams: new URLSearchParams(),
	} as unknown as RouteContext;
}

function post(body: unknown): Request {
	return new Request('http://localhost/api/auth/accept-terms', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('AuthController.acceptTerms', () => {
	beforeEach(() => mockAcceptTerms.mockReset());

	it('records agreement and returns the updated user', async () => {
		mockAcceptTerms.mockResolvedValue({ id: 'user-1', email: 'user@example.com', termsAccepted: true });
		const response = await AuthController.acceptTerms(post({ version: TERMS_VERSION }), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(200);
		const json = (await response.json()) as { data: { user: { termsAccepted: boolean } } };
		expect(json.data.user.termsAccepted).toBe(true);
		expect(mockAcceptTerms).toHaveBeenCalledWith('user-1', TERMS_VERSION);
	});

	it('answers 400 with the service message for an outdated version', async () => {
		mockAcceptTerms.mockRejectedValue(new SecurityError(SecurityErrorType.INVALID_INPUT, TERMS_OUTDATED_MESSAGE, 400));
		const response = await AuthController.acceptTerms(post({ version: '2020-01-01' }), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(400);
		const json = (await response.json()) as { error: { message: string } };
		expect(json.error.message).toBe(TERMS_OUTDATED_MESSAGE);
	});

	it('answers 400 for a body without a version', async () => {
		const response = await AuthController.acceptTerms(post({}), {} as Env, {} as ExecutionContext, context());
		expect(response.status).toBe(400);
		expect(mockAcceptTerms).not.toHaveBeenCalled();
	});
});
```

Before relying on the `SecurityError` import path, check it with `grep -n "export class SecurityError" -r shared worker` and use the path the controller already imports it from. Do the same for the JSON error shape: read `createErrorResponse` in `worker/api/controllers/baseController.ts` and assert on the real shape.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run shared/types/legal.test.ts worker/database/terms-schema.test.ts worker/api/controllers/auth/terms-wiring.test.ts worker/api/controllers/auth/accept-terms.test.ts`

Expected:
- `legal.test.ts`: PASS, since Task 1 created the module. That's fine; it pins the shared helpers.
- The other three: FAIL. The columns, migration, route, `acceptTerms` and `termsAccepted` don't exist yet.

- [ ] **Step 3: Add the columns and generate the migration**

In `worker/database/schema.ts`, add this to `users` after `lastActiveAt`, before `deletedAt`:
```ts
    // Terms of Service agreement: when and which version; null until the user agrees.
    termsAcceptedAt: integer('terms_accepted_at', { mode: 'timestamp' }),
    termsVersion: text('terms_version'),
```

Run: `npm run db:generate`

Expected: a new `migrations/0012_<random_name>.sql` containing exactly:
```sql
ALTER TABLE `users` ADD `terms_accepted_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_version` text;
```
plus `migrations/meta/0012_snapshot.json` and a journal entry.

If the generated SQL contains anything else, stop and report it; the schema and snapshots have drifted.

- [ ] **Step 4: Map `termsAccepted` and widen `AuthUser`**

In `worker/types/auth-types.ts`, add to `AuthUser`:
```ts
	/** Whether the user agreed to the current terms version; absent when unknown. */
	termsAccepted?: boolean;
```

In `worker/utils/authUtils.ts` `mapUserResponse`:
- import `TERMS_VERSION` from `../../shared/types/legal`;
- end the mapped object with:
```ts
		...('termsVersion' in user ? { termsAccepted: user.termsVersion === TERMS_VERSION } : {}),
```

The early return for objects that already have `isAnonymous` stays as it is.

- [ ] **Step 5: Enforce at sign-up, select for sessions, add `acceptTerms`**

`worker/api/controllers/auth/authSchemas.ts`: add `acceptedTermsVersion: z.string().max(32).optional()` to `registerSchema`, then add:
```ts
export const acceptTermsSchema = z.object({ version: z.string().min(1).max(32) });
```

`worker/database/services/AuthService.ts`:
- **Imports:** import `TERMS_VERSION`, `TERMS_REQUIRED_MESSAGE`, `TERMS_OUTDATED_MESSAGE` and `isCurrentTermsVersion` from `../../../shared/types/legal`.
- **`RegistrationData`:** gains `acceptedTermsVersion?: string;`.
- **`register`:** directly after the `validateEmail` block, before the admin-email check, add:
```ts
            if (!isCurrentTermsVersion(data.acceptedTermsVersion)) {
                throw new SecurityError(SecurityErrorType.INVALID_INPUT, TERMS_REQUIRED_MESSAGE, 400);
            }
```
  In the `insert(schema.users).values({...})`, add `termsAcceptedAt: now,` and `termsVersion: TERMS_VERSION,`.
- **`getUserForAuth`:** add `termsVersion: schema.users.termsVersion,` to the `.select({...})` column list.
- **New method `acceptTerms`.** Place it after `register`, with its own JSDoc so the wiring test's `methodBody` boundary still works:
```ts
    /**
     * Record that a signed-in user agreed to the current terms version.
     */
    async acceptTerms(userId: string, version: unknown): Promise<AuthUser> {
        if (!isCurrentTermsVersion(version)) {
            throw new SecurityError(SecurityErrorType.INVALID_INPUT, TERMS_OUTDATED_MESSAGE, 400);
        }
        const now = new Date();
        await this.database
            .update(schema.users)
            .set({ termsAcceptedAt: now, termsVersion: TERMS_VERSION, updatedAt: now })
            .where(eq(schema.users.id, userId))
            .run();
        const user = await this.database.select().from(schema.users).where(eq(schema.users.id, userId)).get();
        if (!user) throw new SecurityError(SecurityErrorType.UNAUTHORIZED, 'User not found', 404);
        return mapUserResponse(user);
    }
```
  Use the `SecurityErrorType` member the file already uses for a missing user. Check the enum and pick the existing one; don't invent a member.

`worker/api/controllers/auth/controller.ts`: add next to `register`:
```ts
    /**
     * Record the signed-in user's agreement to the current Terms of Service and Privacy Policy.
     */
    static async acceptTerms(request: Request, env: Env, _ctx: ExecutionContext, routeContext: RouteContext): Promise<Response> {
        try {
            const bodyResult = await AuthController.parseJsonBody(request);
            if (!bodyResult.success) return bodyResult.response!;
            const parsed = acceptTermsSchema.safeParse(bodyResult.data);
            if (!parsed.success) return AuthController.createErrorResponse('A terms version is required', 400);
            const user = await new AuthService(env).acceptTerms(routeContext.user!.id, parsed.data.version);
            return AuthController.createSuccessResponse({ user });
        } catch (error) {
            if (error instanceof SecurityError) return AuthController.createErrorResponse(error.message, error.statusCode);
            return AuthController.handleError(error, 'record terms agreement');
        }
    }
```

`worker/api/routes/authRoutes.ts`: in the protected block, beside `/logout`, add:
```ts
    authRouter.post('/accept-terms', setAuthLevel(AuthConfig.authenticated), adaptController(AuthController, AuthController.acceptTerms));
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run shared/types/legal.test.ts worker/database/terms-schema.test.ts worker/api/controllers/auth/terms-wiring.test.ts worker/api/controllers/auth/accept-terms.test.ts worker/database/services worker/api/controllers/auth`
Expected: all PASS, including the existing `auth-admin-email-wiring.test.ts` and `controller.test.ts`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 8: Apply the migration locally**

Run: `npm run db:migrate:local`
Expected: `0012_…` applied.

If wrangler can't start because of local state, report it; don't delete `.wrangler/state`.

- [ ] **Step 9: Commit**

```bash
git add worker/database/schema.ts migrations/0012_*.sql migrations/meta/0012_snapshot.json migrations/meta/_journal.json worker/types/auth-types.ts worker/utils/authUtils.ts worker/database/services/AuthService.ts worker/api/controllers/auth/authSchemas.ts worker/api/controllers/auth/controller.ts worker/api/routes/authRoutes.ts worker/database/terms-schema.test.ts worker/api/controllers/auth/terms-wiring.test.ts worker/api/controllers/auth/accept-terms.test.ts shared/types/legal.test.ts
git commit -m "feat(auth): record agreement to the terms at sign-up and through an accept endpoint"
```

---

### Task 3: Sign-up checkbox and the one-time terms window

**Files:**
- Modify: `src/lib/api-client.ts`:
  - `register` (lines 1348-1357): the data gains `acceptedTermsVersion: string`;
  - add a new `acceptTerms` method.
- Modify: `src/contexts/auth-context.tsx`: the `register` data type, at lines 74, 332 and 388.
- Modify: `src/components/auth/login-modal.tsx`:
  - the `onRegister` prop type (lines 41-47);
  - state (lines 73-82);
  - `resetForm` (94-102);
  - `validateForm` (141-160);
  - `handleSubmit` (166-184);
  - JSX: add the checkbox after "Confirm password" (around line 465).
- Create: `src/components/auth/TermsGate.tsx`
- Modify: `src/App.tsx`: mount `<TermsGate />` beside `<Toaster>`.
- Create: `src/components/auth/terms-guard.test.ts`

**Interfaces:**
- Consumes:
  - `TERMS_VERSION` and `TERMS_OUTDATED_MESSAGE` through `@/api-types`;
  - `POST /api/auth/accept-terms`;
  - `AuthUser.termsAccepted`.
- Produces:
  - `apiClient.acceptTerms(version: string): Promise<ApiResponse<{ user: AuthUser }>>`;
  - `<TermsGate />`.

- [ ] **Step 1: Write the failing guard test**

`src/components/auth/terms-guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/components/auth/login-modal.tsx', '/src/components/auth/TermsGate.tsx', '/src/App.tsx', '/src/lib/api-client.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('agreeing to the terms', () => {
	it('asks for agreement in the sign-up form and sends the current version', () => {
		const modal = source('/src/components/auth/login-modal.tsx');
		expect(modal).toContain("I'm 18 or older and agree to the");
		expect(modal).toContain('acceptedTermsVersion: TERMS_VERSION');
		expect(modal).toContain('validationErrors.terms');
		expect(modal).toContain('href="/terms"');
		expect(modal).toContain('href="/privacy"');
		expect(modal).not.toContain('By continuing, you agree to our');
	});

	it('shows the window only when the server says the current terms were not agreed to', () => {
		const gate = source('/src/components/auth/TermsGate.tsx');
		expect(gate).toContain('user.termsAccepted === false');
		expect(gate).toContain('apiClient.acceptTerms(TERMS_VERSION)');
		expect(gate).toContain('refreshUser()');
		expect(gate).toContain('Sign out');
	});

	it('mounts the window once, at the app root', () => {
		expect(source('/src/App.tsx')).toContain('<TermsGate />');
		expect(source('/src/lib/api-client.ts')).toContain("'/api/auth/accept-terms'");
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/auth/terms-guard.test.ts`
Expected: FAIL. `TermsGate.tsx` is missing, and the modal strings aren't there yet.

- [ ] **Step 3: API client and auth context**

`src/lib/api-client.ts`:
- **`register`:** the data type gains `acceptedTermsVersion: string;`.
- **New method,** next to `register`:
```ts
	/** Record the signed-in user's agreement to the current terms version. */
	async acceptTerms(version: string): Promise<ApiResponse<{ user: AuthUser }>> {
		return this.request<{ user: AuthUser }>('/api/auth/accept-terms', {
			method: 'POST',
			body: { version },
		});
	}
```
  Import `AuthUser` from `@/api-types` if the file doesn't already have it.

`src/contexts/auth-context.tsx`: in the three places that type `register`'s data (the `AuthContextType` member, the mutation's `mutationFn` parameter and the `register` wrapper), add `acceptedTermsVersion: string;`.

- [ ] **Step 4: Sign-up checkbox**

`src/components/auth/login-modal.tsx`:
- **Imports:** `import { Checkbox } from '@/components/ui/checkbox';` and `import { TERMS_VERSION } from '@/api-types';`.
- **`onRegister` prop type:** add `acceptedTermsVersion: string;`.
- **State:** `const [agreeToTerms, setAgreeToTerms] = useState(false);`. In `resetForm`: `setAgreeToTerms(false);`.
- **`validateForm`,** inside the `mode === 'register'` branch:
```ts
			if (!agreeToTerms) {
				errors.terms = 'Agree to the Terms of Service and Privacy Policy to create an account';
			}
```
  Match the local variable name the function already uses for the errors object.
- **`handleSubmit`:** `await onRegister({ email, password, name: name.trim(), acceptedTermsVersion: TERMS_VERSION });`.
- **JSX,** after the "Confirm password" block:
```tsx
						{mode === 'register' && (
							<div className="grid gap-1">
								<label className="flex items-start gap-2 text-sm text-kumo-default">
									<Checkbox
										checked={agreeToTerms}
										onCheckedChange={(checked) => setAgreeToTerms(checked === true)}
										disabled={isLoading}
										className="mt-0.5"
									/>
									<span>
										I'm 18 or older and agree to the{' '}
										<a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-kumo-strong">
											Terms of Service
										</a>{' '}
										and{' '}
										<a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-kumo-strong">
											Privacy Policy
										</a>
									</span>
								</label>
								{validationErrors.terms && <p className="text-xs text-kumo-danger">{validationErrors.terms}</p>}
							</div>
						)}
```

- [ ] **Step 5: TermsGate**

`src/components/auth/TermsGate.tsx`:
```tsx
import { useState } from 'react';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { TERMS_VERSION } from '@/api-types';

/** One-time agreement for signed-in users who haven't agreed to the current terms version. */
export function TermsGate() {
	const { user, refreshUser, logout } = useAuth();
	const [agreed, setAgreed] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const open = !!user && !user.isAnonymous && user.termsAccepted === false;
	if (!open) return null;

	const accept = async () => {
		setPending(true);
		setError(null);
		try {
			const response = await apiClient.acceptTerms(TERMS_VERSION);
			if (!response.success) throw new Error(response.error?.message || "Couldn't record your agreement");
			await refreshUser();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "Couldn't record your agreement");
		} finally {
			setPending(false);
		}
	};

	return (
		<Dialog open onOpenChange={() => undefined}>
			<DialogContent className="sm:max-w-md" showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>We've published our Terms of Service and Privacy Policy</DialogTitle>
					<DialogDescription>
						Please read and agree to them to keep using Estori.
					</DialogDescription>
				</DialogHeader>
				<label className="flex items-start gap-2 text-sm text-kumo-default">
					<Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} className="mt-0.5" />
					<span>
						I'm 18 or older and agree to the{' '}
						<a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">Terms of Service</a> and{' '}
						<a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">Privacy Policy</a>
					</span>
				</label>
				{error && <p className="text-sm text-kumo-danger">{error}</p>}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={() => void logout()} disabled={pending}>
						Sign out
					</Button>
					<Button variant="primary" onClick={() => void accept()} disabled={!agreed} loading={pending}>
						{error ? 'Try again' : 'Continue'}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
```

Before relying on these components:
- Check that `DialogContent` in `src/components/ui/dialog.tsx` supports hiding its close button. If its prop isn't `showCloseButton`, use the prop it has. If it has none, pass the existing way to suppress the close button, and leave `onOpenChange` a no-op so Escape and outside clicks don't close it.
- Check that `useAuth()` exposes `logout` and `refreshUser`. It does, per `AuthContextType`.

`src/App.tsx`: `import { TermsGate } from './components/auth/TermsGate';` and render `<TermsGate />` directly after `<Toaster … />`, inside `AuthModalProvider`.

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src/components/auth src/routes`
Expected: PASS, including `login-modal-guard.test.ts` and the brand guards.

- [ ] **Step 7: Typecheck**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api-client.ts src/contexts/auth-context.tsx src/components/auth/login-modal.tsx src/components/auth/TermsGate.tsx src/App.tsx src/components/auth/terms-guard.test.ts
git commit -m "feat(auth): ask for agreement at sign-up and once from users who haven't agreed"
```

---

### Task 4: Public endpoint for the daily limits

**Files:**
- Create: `shared/types/plan.ts`
- Create: `worker/services/rate-limit/public-plan.ts`
- Create: `worker/services/rate-limit/public-plan.test.ts`
- Modify: `worker/api/controllers/limits/controller.ts`: add `getPublicPlan`.
- Modify: `worker/api/routes/limitsRoutes.ts`: add the route.
- Create: `worker/api/controllers/limits/plan-wiring.test.ts`
- Modify: `src/api-types.ts`: re-export the `PublicPlanLimits` type.
- Modify: `src/lib/api-client.ts`: add `getPublicPlan`.
- Modify: `src/lib/query-keys.ts`: add `platform.plan`.
- Create: `src/hooks/use-public-plan.ts`
- Create: `src/components/marketing/PlanLimits.tsx`

**Interfaces:**
- Produces:
  - `type PublicPlanLimits = { newSitesPerDay: number | null; aiCreditsPerDay: number | null }`;
  - `publicPlanFromSettings(rateLimit: RateLimitSettings): PublicPlanLimits`;
  - `GET /api/limits/plan` returning `ApiResponse<PublicPlanLimits>`;
  - `apiClient.getPublicPlan()`;
  - `usePublicPlan()`;
  - `queryKeys.platform.plan()`;
  - `<PlanLimits className?: string />`, which renders the limits line or nothing.

- [ ] **Step 1: Write the failing tests**

`worker/services/rate-limit/public-plan.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_SETTINGS, type RateLimitSettings } from './config';
import { publicPlanFromSettings } from './public-plan';

function settings(overrides: Partial<RateLimitSettings>): RateLimitSettings {
	return { ...DEFAULT_RATE_LIMIT_SETTINGS, ...overrides };
}

describe('publicPlanFromSettings', () => {
	it('reports the default daily limits', () => {
		expect(publicPlanFromSettings(DEFAULT_RATE_LIMIT_SETTINGS)).toEqual({ newSitesPerDay: 3, aiCreditsPerDay: 200 });
	});

	it('follows an override of the daily limits', () => {
		const plan = publicPlanFromSettings(
			settings({
				appCreation: { ...DEFAULT_RATE_LIMIT_SETTINGS.appCreation, limit: 5, dailyLimit: 5 },
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, limit: 500 },
			}),
		);
		expect(plan).toEqual({ newSitesPerDay: 5, aiCreditsPerDay: 500 });
	});

	it('reports no number for a limit that is turned off or not counted per day', () => {
		const plan = publicPlanFromSettings(
			settings({
				appCreation: { ...DEFAULT_RATE_LIMIT_SETTINGS.appCreation, enabled: false },
				llmCalls: { ...DEFAULT_RATE_LIMIT_SETTINGS.llmCalls, period: 3600, calendarDaily: false },
			}),
		);
		expect(plan).toEqual({ newSitesPerDay: null, aiCreditsPerDay: null });
	});
});
```

`worker/api/controllers/limits/plan-wiring.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/limitsRoutes.ts', '/worker/api/controllers/limits/controller.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public plan limits', () => {
	it('is public and rate limited like the other public endpoints', () => {
		const routes = source('/worker/api/routes/limitsRoutes.ts');
		const start = routes.indexOf("'/api/limits/plan'");
		expect(start).toBeGreaterThan(-1);
		expect(routes.slice(start, start + 200)).toContain('setAuthLevel(AuthConfig.public)');
		const controller = source('/worker/api/controllers/limits/controller.ts');
		expect(controller).toContain('enforcePublicAppsRateLimit(');
		expect(controller).toContain('publicPlanFromSettings(context.config.security.rateLimit)');
	});
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run worker/services/rate-limit/public-plan.test.ts worker/api/controllers/limits/plan-wiring.test.ts`
Expected: FAIL, because the module and the route are missing.

- [ ] **Step 3: Implement**

`shared/types/plan.ts`:
```ts
/** The free plan's daily limits as currently configured; null when a limit is off or not counted per day. */
export interface PublicPlanLimits {
	newSitesPerDay: number | null;
	aiCreditsPerDay: number | null;
}
```

`worker/services/rate-limit/public-plan.ts`:
```ts
import type { PublicPlanLimits } from '../../../shared/types/plan';
import type { RateLimitSettings } from './config';

const DAY_SECONDS = 24 * 60 * 60;

interface DailyCountable {
	enabled: boolean;
	limit?: number;
	period?: number;
	dailyLimit?: number;
	calendarDaily?: boolean;
}

function perDay(config: DailyCountable): number | null {
	if (!config.enabled) return null;
	if (typeof config.dailyLimit === 'number') return config.dailyLimit;
	if (typeof config.limit !== 'number') return null;
	return config.calendarDaily || config.period === DAY_SECONDS ? config.limit : null;
}

/** The limits shown on the pricing page, read from the configuration in force. */
export function publicPlanFromSettings(rateLimit: RateLimitSettings): PublicPlanLimits {
	return {
		newSitesPerDay: perDay(rateLimit.appCreation),
		aiCreditsPerDay: perDay(rateLimit.llmCalls),
	};
}
```

If TypeScript rejects passing `rateLimit.appCreation` as `DailyCountable`, because the KV config variant lacks the optional fields, keep `DailyCountable` as the structural parameter type and narrow at the call site with `'dailyLimit' in config`. Do not use `any`.

`worker/api/controllers/limits/controller.ts`: add the method below. Import `RateLimitService` and `RateLimitExceededError` from where `worker/api/controllers/apps/controller.ts` imports them, and `publicPlanFromSettings` from `../../../services/rate-limit/public-plan`.
```ts
	/**
	 * GET /api/limits/plan
	 * The free plan's daily limits for the public pricing page.
	 */
	static async getPublicPlan(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<Response> {
		try {
			await RateLimitService.enforcePublicAppsRateLimit(env, context.config.security.rateLimit, null, request);
		} catch (error) {
			if (error instanceof RateLimitExceededError) return LimitsController.createErrorResponse('Too many requests', 429);
			throw error;
		}
		return LimitsController.createSuccessResponse(publicPlanFromSettings(context.config.security.rateLimit));
	}
```

`worker/api/routes/limitsRoutes.ts`: add inside `setupLimitsRoutes`:
```ts
	// Public: the free plan's daily limits for the pricing page
	app.get(
		'/api/limits/plan',
		setAuthLevel(AuthConfig.public),
		adaptController(LimitsController, LimitsController.getPublicPlan),
	);
```

`src/api-types.ts`: `export type { PublicPlanLimits } from '../shared/types/plan.js';`

`src/lib/query-keys.ts`: add a top-level entry beside `apps`:
```ts
	/** Public platform facts that don't depend on the viewer. */
	platform: {
		all: ['platform'] as const,
		plan: () => [...queryKeys.platform.all, 'plan'] as const,
	},
```

`src/lib/api-client.ts`:
```ts
	/** The free plan's daily limits; quiet because pricing hides the line on failure. */
	async getPublicPlan(): Promise<ApiResponse<PublicPlanLimits>> {
		return this.request<PublicPlanLimits>('/api/limits/plan', {}, true);
	}
```

`src/hooks/use-public-plan.ts`:
```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export function usePublicPlan() {
	return useQuery({
		queryKey: queryKeys.platform.plan(),
		queryFn: () => unwrap(apiClient.getPublicPlan(), "Couldn't load the plan limits"),
		retry: false,
		staleTime: 10 * 60 * 1000,
	});
}
```

`src/components/marketing/PlanLimits.tsx`:
```tsx
import { usePublicPlan } from '@/hooks/use-public-plan';

/** "Up to 3 new sites a day · 200 AI credits a day", or nothing when the limits aren't known. */
export function PlanLimits({ className }: { className?: string }) {
	const plan = usePublicPlan();
	const parts: string[] = [];
	if (plan.data?.newSitesPerDay != null) parts.push(`Up to ${plan.data.newSitesPerDay} new sites a day`);
	if (plan.data?.aiCreditsPerDay != null) parts.push(`${plan.data.aiCreditsPerDay} AI credits a day`);
	if (parts.length === 0) return null;
	return <p className={className}>{parts.join(' · ')}</p>;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run worker/services/rate-limit worker/api/controllers/limits src/lib`
Expected: PASS. If `src/lib/query-keys.test.ts` enumerates the top-level keys, update it for `platform`.

- [ ] **Step 5: Typecheck**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add shared/types/plan.ts worker/services/rate-limit/public-plan.ts worker/services/rate-limit/public-plan.test.ts worker/api/controllers/limits/controller.ts worker/api/routes/limitsRoutes.ts worker/api/controllers/limits/plan-wiring.test.ts src/api-types.ts src/lib/api-client.ts src/lib/query-keys.ts src/hooks/use-public-plan.ts src/components/marketing/PlanLimits.tsx
git commit -m "feat(limits): report the free plan's daily limits publicly for the pricing page"
```

---

### Task 5: Public layout, footer, legal pages and sidebar links

**Files:**
- Create: `src/components/layout/PublicLayout.tsx`
- Create: `src/components/layout/PublicTopBar.tsx`
- Create: `src/components/layout/SiteFooter.tsx`
- Create: `src/routes/legal/LegalPage.tsx`
- Create: `src/routes/legal/index.tsx`
- Modify: `src/App.tsx`: `App` stops wrapping `<Outlet/>` in `<AppLayout>`.
- Modify: `src/routes.tsx`: add the layout routes and the legal routes.
- Modify: `src/components/layout/app-sidebar.tsx`: add the legal links in the footer (lines 560-600).
- Create: `src/routes/public-pages-guard.test.ts`

**Interfaces:**
- Consumes: `LEGAL_DOCUMENTS`, `LEGAL_LINKS` and `LegalSlug` (Task 1); `LEGAL_CONTACT` and `LEGAL_ENTITY` through `@/api-types`; `pageTitle` from `@/brand`.
- Produces:
  - `PublicLayout({ children?: ReactNode })`, which renders `children` or `<Outlet/>`;
  - `SiteFooter`;
  - the routes `/terms`, `/privacy`, `/refunds` and `/copyright` under `PublicLayout`;
  - `AppShell`, the `AppLayout` layout route.

- [ ] **Step 1: Write the failing guard test**

`src/routes/public-pages-guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes.tsx',
		'/src/App.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/components/layout/app-sidebar.tsx',
		'/src/routes/legal/LegalPage.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public pages', () => {
	it('serves the legal pages in the public layout, open to everyone', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		for (const path of ["path: 'terms'", "path: 'privacy'", "path: 'refunds'", "path: 'copyright'"]) {
			expect(publicBlock).toContain(path);
		}
		expect(publicBlock.slice(0, publicBlock.indexOf('],'))).not.toContain('ProtectedRoute');
	});

	it('keeps the app sidebar only for app routes', () => {
		expect(source('/src/App.tsx')).not.toContain('<AppLayout>');
		expect(source('/src/routes.tsx')).toContain('Component: AppShell');
	});

	it('links every legal page from the footer and the sidebar', () => {
		expect(source('/src/components/layout/SiteFooter.tsx')).toContain('LEGAL_LINKS');
		const sidebar = source('/src/components/layout/app-sidebar.tsx');
		expect(sidebar).toContain('LEGAL_LINKS');
		expect(sidebar).toContain("'/pricing'");
	});

	it('keeps the top bar usable on phones and legal text readable in dark mode', () => {
		expect(source('/src/components/layout/PublicTopBar.tsx')).toContain('hidden sm:flex');
		const legal = source('/src/routes/legal/LegalPage.tsx');
		expect(legal).toContain('dark:prose-invert');
		expect(legal).toContain('pageTitle(document.title)');
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/routes/public-pages-guard.test.ts`
Expected: FAIL, because the files are missing.

- [ ] **Step 3: Build the layout pieces**

`src/components/layout/PublicTopBar.tsx`:
```tsx
import { Link, useLocation, useNavigate } from 'react-router';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';

/** Top bar for public pages: brand, Discover and Pricing, then sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname } = useLocation();
	const navigate = useNavigate();

	const startBuilding = () => {
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header className="sticky top-0 z-40 border-b border-kumo-line bg-kumo-canvas/85 backdrop-blur">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
				<div className="flex items-center gap-8">
					<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-kumo-strong">
						<EstoriLogo className="h-6 w-auto" />
					</Link>
					<nav className="hidden sm:flex items-center gap-6 text-sm text-kumo-default">
						<Link to="/discover" className="hover:text-kumo-strong">Discover</Link>
						<Link to="/pricing" className="hover:text-kumo-strong">Pricing</Link>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					{isAuthenticated ? (
						<Link to="/" className="text-sm text-kumo-default hover:text-kumo-strong">Open app</Link>
					) : (
						<button type="button" onClick={() => showAuthModal()} className="text-sm text-kumo-default hover:text-kumo-strong">
							Sign in
						</button>
					)}
					<button
						type="button"
						onClick={startBuilding}
						className="rounded-full bg-[var(--estori-action)] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--estori-action-hover)]"
					>
						Start building
					</button>
				</div>
			</div>
		</header>
	);
}
```

Check the exports first:
- `useAuthModal` and `showAuthModal`'s signature in `src/components/auth/AuthModalProvider.tsx`;
- `EstoriLogo` and `BRAND` in `src/brand/index.ts`.

Match them. The brand guard (`src/brand/brand-guard.test.ts`) only allows the exact text `Sign In` in `EstoriTopBar.tsx`; this file says `Sign in`. Run the brand guard after this step.

`src/components/layout/SiteFooter.tsx`:
```tsx
import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { LEGAL_CONTACT, LEGAL_ENTITY } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';

export function SiteFooter() {
	return (
		<footer className="border-t border-kumo-line bg-kumo-canvas">
			<div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-[1fr_auto] sm:px-6">
				<div className="grid gap-3">
					<EstoriLogo className="h-5 w-auto text-kumo-strong" />
					<p className="max-w-sm text-sm text-kumo-subtle">Build online stores with AI, and sell them as templates.</p>
					<a href={`mailto:${LEGAL_CONTACT.support}`} className="text-sm text-kumo-default hover:text-kumo-strong">
						{LEGAL_CONTACT.support}
					</a>
				</div>
				<nav className="flex flex-wrap items-start gap-x-6 gap-y-2 text-sm text-kumo-default">
					<Link to="/discover" className="hover:text-kumo-strong">Discover</Link>
					<Link to="/pricing" className="hover:text-kumo-strong">Pricing</Link>
					{LEGAL_LINKS.map((link) => (
						<Link key={link.slug} to={link.path} className="hover:text-kumo-strong">
							{link.label}
						</Link>
					))}
				</nav>
			</div>
			<div className="border-t border-kumo-line">
				<p className="mx-auto max-w-6xl px-4 py-6 text-xs text-kumo-subtle sm:px-6">
					© {new Date().getFullYear()} {LEGAL_ENTITY.name}
				</p>
			</div>
		</footer>
	);
}
```

`src/components/layout/PublicLayout.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	return (
		<div className="h-svh overflow-y-auto bg-kumo-canvas text-kumo-default">
			<PublicTopBar />
			<main>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
```

`src/index.css` sets `overflow: hidden` on the root elements, so this layout scrolls its own container. Check in the browser (Step 6) that the page scrolls and that the sticky top bar stays put.

- [ ] **Step 4: Legal page and routes**

`src/routes/legal/LegalPage.tsx`:
```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { pageTitle } from '@/brand';
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/content/legal/legal-documents';

export function LegalPage({ slug }: { slug: LegalSlug }) {
	const document = LEGAL_DOCUMENTS[slug];
	return (
		<article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
			<title>{pageTitle(document.title)}</title>
			<meta name="description" content={`${document.title} for Estori.`} />
			<p className="text-xs uppercase tracking-[0.18em] text-kumo-subtle">Last updated {document.updated}</p>
			<h1 className="mt-3 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl">{document.title}</h1>
			<div className="prose prose-neutral mt-10 max-w-none dark:prose-invert prose-headings:font-normal prose-headings:tracking-tight prose-a:text-[var(--estori-link)]">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }]]}>
					{document.body}
				</ReactMarkdown>
			</div>
		</article>
	);
}
```

`src/routes/legal/index.tsx`:
```tsx
import { LegalPage } from './LegalPage';

export const TermsPage = () => <LegalPage slug="terms" />;
export const PrivacyPage = () => <LegalPage slug="privacy" />;
export const RefundsPage = () => <LegalPage slug="refunds" />;
export const CopyrightPage = () => <LegalPage slug="copyright" />;
```

`src/App.tsx`: replace
```tsx
<AppLayout>
	<Toasty>
		<AppLinkProvider>
			<Outlet />
		</AppLinkProvider>
	</Toasty>
</AppLayout>
```
with
```tsx
<Toasty>
	<AppLinkProvider>
		<Outlet />
	</AppLinkProvider>
</Toasty>
```
Then remove the unused `AppLayout` import.

`src/routes.tsx`:
1. Import `AppLayout` and `PublicLayout`, and define:
   ```tsx
   const AppShell = () => <AppLayout />;
   const PublicShell = () => <PublicLayout />;
   ```
2. Restructure the children of `/`:
   - Keep `{ index: true, Component: Home }` as the first child, but wrap it so the home page keeps the app layout: `{ index: true, element: <AppLayout><Home /></AppLayout> }`. Task 7 replaces this.
   - Then `{ Component: AppShell, children: [ …every existing child route, unchanged… ] }`.
   - Then `{ Component: PublicShell, children: [ { path: 'terms', Component: TermsPage }, { path: 'privacy', Component: PrivacyPage }, { path: 'refunds', Component: RefundsPage }, { path: 'copyright', Component: CopyrightPage } ] }`.
3. Keep every existing route object's text identical. `discover-guard.test.ts` and `site-page-guard.test.ts` assert strings from this file.

`src/components/layout/app-sidebar.tsx`: in `Sidebar.Footer`, inside the column `div` (line 561) and before the theme-toggle row, add:
```tsx
					{!isCollapsed && (
						<nav className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-kumo-subtle">
							<Link to="/pricing" className="hover:text-kumo-default">Pricing</Link>
							{LEGAL_LINKS.map((link) => (
								<Link key={link.slug} to={link.path} className="hover:text-kumo-default">
									{link.label}
								</Link>
							))}
						</nav>
					)}
```
Use the `Link` import the file already uses for navigation (check its imports), and import `LEGAL_LINKS` from `@/content/legal/legal-documents`. Write the pricing path with single quotes so the guard matches `'/pricing'`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run src`
Expected: PASS, including `brand-guard`, `discover-guard`, `site-page-guard` and the new guard. If a brand guard flags new files, fix the file; don't loosen the guard.

- [ ] **Step 6: Typecheck and look at it**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

With the local dev server on http://localhost:8100, open `/terms` and `/privacy` in the browser pane, signed out, in light and dark themes, at 1280 px and 390 px. Check:
- the page scrolls and the top bar stays sticky;
- headings, lists and links render;
- the address and the emails show;
- the sidebar footer in the app shows Pricing and the legal links.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/PublicLayout.tsx src/components/layout/PublicTopBar.tsx src/components/layout/SiteFooter.tsx src/routes/legal/LegalPage.tsx src/routes/legal/index.tsx src/App.tsx src/routes.tsx src/components/layout/app-sidebar.tsx src/routes/public-pages-guard.test.ts
git commit -m "feat(pages): public layout with footer, and the terms, privacy, refunds and copyright pages"
```

---

### Task 6: Pricing page

**Files:**
- Create: `src/lib/pricing.ts`
- Create: `src/lib/pricing.test.ts`
- Create: `src/routes/pricing.tsx`
- Create: `src/components/marketing/ComingSoon.tsx`
- Modify: `src/routes.tsx`: add `{ path: 'pricing', Component: PricingPage }` under `PublicShell`.
- Create: `src/routes/pricing-guard.test.ts`

**Interfaces:**
- Consumes: `TEMPLATE_PRICE_OPTIONS_CENTS`, `platformFeeCents`, `formatTemplatePrice` and `PLATFORM_FEE_LABEL` through `@/api-types`; `PlanLimits` (Task 4); `PublicShell` (Task 5).
- Produces:
  - `sellerKeepsTable(): Array<{ priceCents: number; feeCents: number; sellerCents: number }>`;
  - `formatCents(cents: number): string`;
  - `<ComingSoon />`, a small badge.

- [ ] **Step 1: Write the failing tests**

`src/lib/pricing.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { TEMPLATE_PRICE_OPTIONS_CENTS, platformFeeCents } from '../../shared/types/templates';
import { formatCents, sellerKeepsTable } from './pricing';

describe('sellerKeepsTable', () => {
	it('lists every paid price with what the seller keeps after the fee', () => {
		const rows = sellerKeepsTable();
		expect(rows.map((row) => row.priceCents)).toEqual(TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0));
		for (const row of rows) {
			expect(row.feeCents).toBe(platformFeeCents(row.priceCents));
			expect(row.sellerCents).toBe(row.priceCents - row.feeCents);
		}
		expect(rows.find((row) => row.priceCents === 2900)?.sellerCents).toBe(2637);
	});
});

describe('formatCents', () => {
	it('shows dollars with cents', () => {
		expect(formatCents(2637)).toBe('$26.37');
		expect(formatCents(900)).toBe('$9.00');
	});
});
```

`src/routes/pricing-guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/pricing.tsx', '/src/routes.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('pricing page', () => {
	const page = source('/src/routes/pricing.tsx');

	it('states the fee and limits from the code that applies them', () => {
		expect(page).toContain('PLATFORM_FEE_LABEL');
		expect(page).toContain('sellerKeepsTable()');
		expect(page).toContain('<PlanLimits');
		expect(page).not.toMatch(/7% \+ \$0\.60/);
	});

	it("doesn't promise store payments yet", () => {
		expect(page).toContain('<ComingSoon');
		expect(page).toContain('Accept payments in your store');
	});

	it('is a public page', () => {
		const routes = source('/src/routes.tsx');
		expect(routes.slice(routes.indexOf('Component: PublicShell'))).toContain("path: 'pricing'");
	});
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib/pricing.test.ts src/routes/pricing-guard.test.ts`
Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`src/lib/pricing.ts`:
```ts
import { TEMPLATE_PRICE_OPTIONS_CENTS, platformFeeCents } from '@/api-types';

export function formatCents(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

/** What a seller keeps at each paid price option, after Estori's fee. */
export function sellerKeepsTable(): Array<{ priceCents: number; feeCents: number; sellerCents: number }> {
	return TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0).map((priceCents) => {
		const feeCents = platformFeeCents(priceCents);
		return { priceCents, feeCents, sellerCents: priceCents - feeCents };
	});
}
```
If `@/api-types` doesn't resolve in the Workers test pool for this file, use the relative path `../../shared/types/templates`, as other `src/lib` modules do. Check one, e.g. `src/lib/paid-listing-display.ts`.

`src/components/marketing/ComingSoon.tsx`:
```tsx
export function ComingSoon() {
	return (
		<span className="inline-flex items-center rounded-full bg-kumo-recessed px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-kumo-subtle ring ring-kumo-hairline">
			Coming soon
		</span>
	);
}
```

`src/routes/pricing.tsx`: write this page in full. The structure and copy are below.
```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { formatCents, sellerKeepsTable } from '@/lib/pricing';

function Feature({ children }: { children: ReactNode }) {
	return (
		<li className="flex items-start gap-3 text-sm text-kumo-default">
			<CheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--estori-action)]" weight="bold" />
			<span>{children}</span>
		</li>
	);
}

export default function PricingPage() {
	return (
		<div>
			<title>{pageTitle('Pricing')}</title>
			<meta name="description" content={`Estori is free to build with. Sellers pay ${PLATFORM_FEE_LABEL} per sale.`} />
			<section className="mx-auto max-w-6xl px-4 pt-20 pb-12 text-center sm:px-6 sm:pt-28">
				<p className="text-xs font-medium uppercase tracking-[0.18em] text-kumo-subtle">Pricing</p>
				<h1 className="mx-auto mt-4 max-w-3xl text-5xl font-light tracking-[-0.025em] text-kumo-strong sm:text-6xl">
					Free to build. Pay only when you sell.
				</h1>
				<p className="mx-auto mt-5 max-w-xl text-lg font-light text-kumo-subtle">
					Build and publish stores at no cost. Estori earns only when one of your store designs sells.
				</p>
			</section>
			<section className="mx-auto grid max-w-6xl gap-6 px-4 pb-20 sm:px-6 lg:grid-cols-3">
				<article className="flex flex-col rounded-3xl bg-kumo-elevated p-8 ring ring-kumo-hairline">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-kumo-subtle">Build</h2>
					<p className="mt-4 text-5xl font-light tracking-tight text-kumo-strong">Free</p>
					<PlanLimits className="mt-3 text-sm text-kumo-subtle" />
					<ul className="mt-8 grid gap-3">
						<Feature>Change your store by chatting with the AI</Feature>
						<Feature>Live preview on desktop and phone</Feature>
						<Feature>Publish to Discover, or start from any free store there</Feature>
						<Feature>
							<span className="inline-flex flex-wrap items-center gap-2">Accept payments in your store <ComingSoon /></span>
						</Feature>
					</ul>
				</article>
				<article className="flex flex-col rounded-3xl bg-[#070b16] p-8 text-white ring ring-white/10">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-white/60">Sell</h2>
					<p className="mt-4 text-5xl font-light tracking-tight">{PLATFORM_FEE_LABEL}</p>
					<p className="mt-3 text-sm text-white/60">per sale</p>
					<ul className="mt-8 grid gap-3 text-sm text-white/85">
						<li>Choose a price. An Estori admin reviews it before buyers can use your store.</li>
						<li>Buyers pay by card through Stripe. You receive the rest automatically, on Stripe's payout schedule.</li>
						<li>You need a Stripe account and must be 18 or older.</li>
					</ul>
					<table className="mt-8 w-full text-left text-sm">
						<thead className="text-white/50">
							<tr><th className="py-2 font-normal">Price</th><th className="py-2 font-normal">Estori fee</th><th className="py-2 text-right font-normal">You keep</th></tr>
						</thead>
						<tbody>
							{sellerKeepsTable().map((row) => (
								<tr key={row.priceCents} className="border-t border-white/10">
									<td className="py-2">{formatTemplatePrice(row.priceCents)}</td>
									<td className="py-2 text-white/70">{formatCents(row.feeCents)}</td>
									<td className="py-2 text-right">{formatCents(row.sellerCents)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</article>
				<article className="flex flex-col rounded-3xl bg-kumo-elevated p-8 ring ring-kumo-hairline">
					<h2 className="text-sm font-medium uppercase tracking-[0.14em] text-kumo-subtle">Buy a store design</h2>
					<p className="mt-4 text-5xl font-light tracking-tight text-kumo-strong">One-time</p>
					<p className="mt-3 text-sm text-kumo-subtle">the price on its page</p>
					<ul className="mt-8 grid gap-3">
						<Feature>Your own copy to adapt for your own store</Feature>
						<Feature>Keep editing it with the AI</Feature>
						<Feature>For your use only: it can't be republished or resold</Feature>
						<Feature>
							Refunded if it can't be used. <Link to="/refunds" className="underline">Refund policy</Link>
						</Feature>
					</ul>
				</article>
			</section>
			<p className="mx-auto max-w-6xl px-4 pb-24 text-center text-xs text-kumo-subtle sm:px-6">Prices are in US dollars.</p>
		</div>
	);
}
```
`@phosphor-icons/react` is the icon set already used in `src/routes/home.tsx` (`PaperPlaneTiltIcon`); confirm the import path there.

`src/routes.tsx`: `import PricingPage from './routes/pricing';` and add `{ path: 'pricing', Component: PricingPage }` as the first child of `PublicShell`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run src/lib/pricing.test.ts src/routes/pricing-guard.test.ts src/routes`
Expected: PASS.

- [ ] **Step 5: Typecheck and look at it**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

Open http://localhost:8100/pricing signed out, in light and dark themes, at 1280 px and 390 px. Check:
- three cards, stacked on a phone;
- the limits line reads "Up to 3 new sites a day · 200 AI credits a day";
- the table shows $9 → $7.77, $19 → $17.07, $29 → $26.37 and $49 → $44.97.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing.ts src/lib/pricing.test.ts src/routes/pricing.tsx src/components/marketing/ComingSoon.tsx src/routes.tsx src/routes/pricing-guard.test.ts
git commit -m "feat(pages): pricing page with the free plan limits and what sellers keep"
```

---

### Task 7: Landing page at `/` for signed-out visitors

**Files:**
- Create: `src/components/build-box.tsx`: the build box extracted from `src/routes/home.tsx`.
- Modify: `src/routes/home.tsx`: render `<BuildBox />` in place of the extracted code. Move the OAuth `?error=` toast effect out.
- Create: `src/hooks/use-oauth-error-toast.ts`: the effect moved out of `home.tsx`, lines 58-74.
- Create: `src/routes/root-index.tsx`
- Create: `src/routes/landing/LandingPage.tsx`
- Create: `src/routes/landing/sections.tsx`
- Modify: `src/routes.tsx`: the index route becomes `{ index: true, Component: RootIndex }`.
- Modify: the guard tests that pin strings in `home.tsx`:
  - `src/routes/model-picker-guard.test.ts` (the `<ThinkModelPicker` and `const modelParam =` assertions);
  - `src/routes/discover-guard.test.ts` (keep `<DiscoverStrip />` in `home.tsx`);
  - `src/brand/brand-guard.test.ts` (if it reads `home.tsx` for title strings).
- Modify: `index.html:10`: the meta description.
- Create: `src/routes/landing-guard.test.ts`

**Interfaces:**
- Consumes:
  - `PublicLayout` and `SiteFooter` (Task 5);
  - `PlanLimits` (Task 4);
  - `ComingSoon` (Task 6);
  - `PLATFORM_FEE_LABEL` and `TEMPLATE_PRICE_OPTIONS_CENTS` through `@/api-types`;
  - `DiscoverStrip` from `@/components/publishing/DiscoverStrip`.
- Produces:
  - `BuildBox({ placeholder?: string; placeholderPhrases?: string[]; className?: string })`;
  - `RootIndex`;
  - `LandingPage`.

- [ ] **Step 1: Write the failing guard test**

`src/routes/landing-guard.test.ts`:
```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/routes/root-index.tsx',
		'/src/routes/landing/LandingPage.tsx',
		'/src/routes/landing/sections.tsx',
		'/src/routes/pricing.tsx',
		'/src/components/build-box.tsx',
		'/src/routes/home.tsx',
		'/src/routes.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'];

describe('landing page', () => {
	const landing = source('/src/routes/landing/LandingPage.tsx') + source('/src/routes/landing/sections.tsx');

	it('shows the landing page signed out and the builder home signed in, with a loader in between', () => {
		const root = source('/src/routes/root-index.tsx');
		expect(root).toContain('isLoading');
		expect(root).toContain('<LandingPage />');
		expect(root).toContain('<Home />');
		expect(source('/src/routes.tsx')).toContain('{ index: true, Component: RootIndex }');
	});

	it('reuses the one build box, which sends visitors to sign up and then to their build', () => {
		expect(landing).toContain('<BuildBox');
		expect(source('/src/routes/home.tsx')).toContain('<BuildBox');
		const box = source('/src/components/build-box.tsx');
		expect(box).toContain('requireFullAuth: true');
		expect(box).toContain('intendedUrl: intendedUrl');
		expect(box).toContain('<ThinkModelPicker');
	});

	it('hides the featured stores section when Discover has none', () => {
		expect(landing).toContain('useDiscoverStripSites()');
		expect(landing).toContain('if (!sites.data?.length) return null;');
	});

	it("doesn't promise store payments, and states the seller fee from the code", () => {
		expect(landing).toContain('<ComingSoon');
		expect(landing).toContain('PLATFORM_FEE_LABEL');
		expect(landing).not.toMatch(/7% \+ \$0\.60/);
	});

	it('names no competitor', () => {
		const copy = (landing + source('/src/routes/pricing.tsx')).toLowerCase();
		for (const name of COMPETITORS) expect(copy).not.toContain(name);
	});

	it('answers the six launch questions', () => {
		for (const question of [
			'Is Estori free?',
			'Can my store take payments?',
			'Who owns the store I build?',
			'Can I resell a store I bought?',
			'What does Estori charge sellers?',
			"What if a store I bought doesn't work?",
		]) {
			expect(landing).toContain(question);
		}
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/routes/landing-guard.test.ts`
Expected: FAIL, because the files are missing.

- [ ] **Step 3: Extract the build box (refactor, behavior unchanged)**

Move these from `src/routes/home.tsx` into `src/components/build-box.tsx`, as one `BuildBox` component:
- the state for `query`, `projectMode`, `modelId`, images and drag-and-drop, `showLimitDialog`, `modeOptions` and its effects (home lines ~44-48 and ~76-101);
- `handleCreateApp` (lines 135-193), verbatim, including the `requireAuth({ requireFullAuth: true, actionContext: 'to create applications', intendedUrl: intendedUrl })` call;
- the `<PromptBox … />` JSX (lines 224-267), including `leftActions` with `<ThinkModelPicker … />`;
- `{showLimitDialog}`.

Props:
```ts
interface BuildBoxProps {
	/** Text before the animated phrases; the home page uses "Create a ". */
	placeholder?: string;
	placeholderPhrases?: string[];
	className?: string;
}
```
- The defaults are the home page's current `placeholder` and `placeholderPhrases`, so `<BuildBox />` on the home page behaves exactly as before.
- In `home.tsx`, render `<BuildBox />` where the `PromptBox` was, and delete the moved code and its now-unused imports.
- Keep `<DiscoverStrip />`, the heading, the community grid and its ``navigate(`/discover/${app.id}`)`` in `home.tsx`.

Move the OAuth `?error=` toast effect (home lines 58-74) into `src/hooks/use-oauth-error-toast.ts`, as `export function useOAuthErrorToast(): void`, with the same code. `RootIndex` calls it once.

Update `src/routes/model-picker-guard.test.ts` so the assertions about the `<ThinkModelPicker` and `const modelParam = …` lines read `/src/components/build-box.tsx` instead of `/src/routes/home.tsx`. Add `/src/components/build-box.tsx` to that file's glob list. Keep the assertions' meaning identical.

- [ ] **Step 4: RootIndex and routes**

`src/routes/root-index.tsx`:
```tsx
import { Loader } from '@cloudflare/kumo';
import { useAuth } from '@/contexts/auth-context';
import { AppLayout } from '@/components/layout/app-layout';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { useOAuthErrorToast } from '@/hooks/use-oauth-error-toast';
import Home from './home';
import { LandingPage } from './landing/LandingPage';

/** `/`: the builder home for signed-in users, the landing page for everyone else. */
export default function RootIndex() {
	const { isAuthenticated, isLoading, user } = useAuth();
	useOAuthErrorToast();

	if (isLoading) {
		return (
			<div className="flex h-svh items-center justify-center bg-kumo-canvas">
				<Loader />
			</div>
		);
	}
	if (isAuthenticated && user && !user.isAnonymous) {
		return (
			<AppLayout>
				<Home />
			</AppLayout>
		);
	}
	return (
		<PublicLayout>
			<LandingPage />
		</PublicLayout>
	);
}
```

`src/routes.tsx`: `import RootIndex from './routes/root-index';`. Replace the temporary index route from Task 5 with `{ index: true, Component: RootIndex }`.

- [ ] **Step 5: Landing sections**

`src/routes/landing/sections.tsx`: write these components in full, with this copy. Original wording only. Tokens follow the Global Constraints.

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRightIcon, CheckIcon } from '@phosphor-icons/react';
import { PLATFORM_FEE_LABEL, TEMPLATE_PRICE_OPTIONS_CENTS, formatTemplatePrice } from '@/api-types';
import { BuildBox } from '@/components/build-box';
import { DiscoverStrip, useDiscoverStripSites } from '@/components/publishing/DiscoverStrip';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { ComingSoon } from '@/components/marketing/ComingSoon';

const STORE_PHRASES = ['a specialty coffee store', 'a handmade ceramics shop', 'a streetwear store', 'a plant shop with local delivery', 'a vintage camera store'];

const PAID_PRICES = TEMPLATE_PRICE_OPTIONS_CENTS.filter((price) => price > 0).map(formatTemplatePrice).join(', ');

function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
	return (
		<p className={`text-xs font-medium uppercase tracking-[0.18em] ${dark ? 'text-white/60' : 'text-kumo-subtle'}`}>{children}</p>
	);
}

/** Dark band with a brand-blue glow: the hero and the closing call to action. */
function DarkBand({ children, className = '' }: { children: ReactNode; className?: string }) {
	return (
		<div
			className={`relative overflow-hidden bg-[#070b16] text-white ${className}`}
			style={{ backgroundImage: 'radial-gradient(60% 55% at 50% 100%, color-mix(in oklab, var(--estori-action) 55%, transparent), transparent)' }}
		>
			{children}
		</div>
	);
}

export function Hero() {
	return (
		<DarkBand>
			<section className="mx-auto max-w-6xl px-4 pt-20 pb-24 text-center sm:px-6 sm:pt-28 sm:pb-32">
				<Eyebrow dark>AI store builder and store design marketplace</Eyebrow>
				<h1 className="mx-auto mt-5 max-w-4xl text-5xl font-light leading-[1.05] tracking-[-0.025em] sm:text-7xl">
					Build online stores with AI. Sell them as templates.
				</h1>
				<p className="mx-auto mt-6 max-w-2xl text-lg font-light text-white/75 sm:text-xl">
					Describe a store and Estori builds and deploys it: catalog, cart, checkout flow and order records. Publish it to Discover and earn when others start from it.
				</p>
				<div id="build" className="mx-auto mt-10 max-w-2xl text-left">
					<BuildBox placeholder="Build " placeholderPhrases={STORE_PHRASES} />
				</div>
				<div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/70">
					<span>Free to build. No credit card.</span>
					<Link to="/discover" className="inline-flex items-center gap-1 text-white hover:underline">
						Browse stores in Discover <ArrowRightIcon className="size-4" />
					</Link>
				</div>
			</section>
		</DarkBand>
	);
}

export function FeaturedStores() {
	const sites = useDiscoverStripSites();
	if (!sites.data?.length) return null;
	return (
		<section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
			<div className="flex flex-wrap items-end justify-between gap-6">
				<div className="max-w-2xl">
					<Eyebrow>Discover</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl">Start from a store that already works</h2>
					<p className="mt-4 text-lg font-light text-kumo-subtle">
						Every store in Discover was built on Estori. Open one, see it live on desktop and phone, and make it yours.
					</p>
				</div>
				<Link to="/discover" className="inline-flex items-center gap-1 rounded-full px-5 py-2 text-sm text-kumo-default ring ring-kumo-line hover:ring-kumo-strong">
					See all stores <ArrowRightIcon className="size-4" />
				</Link>
			</div>
			<div className="mt-10">
				<DiscoverStrip />
			</div>
		</section>
	);
}

const CREATOR_STEPS = [
	{ title: 'Build it', text: 'Describe the store and refine it by chatting until it is ready to sell.' },
	{ title: 'Set a price', text: `Choose ${PAID_PRICES}. An Estori admin reviews it, then your store is live in Discover with its own product page.` },
	{ title: 'Get paid', text: `Buyers pay by card through Stripe. You keep the price minus ${PLATFORM_FEE_LABEL}, paid out to your Stripe account.` },
] as const;

export function ForCreators() {
	return (
		<section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
			<div className="rounded-[2rem] bg-[var(--estori-action)] px-6 py-16 text-white sm:px-12 sm:py-20">
				<Eyebrow dark>For creators</Eyebrow>
				<h2 className="mt-4 max-w-3xl text-4xl font-light tracking-[-0.025em] sm:text-5xl">Design a store once. Earn every time it's used.</h2>
				<div className="mt-12 grid gap-6 md:grid-cols-3">
					{CREATOR_STEPS.map((step, index) => (
						<article key={step.title} className="rounded-3xl bg-white/10 p-6 ring ring-white/15">
							<p className="text-sm text-white/60">0{index + 1}</p>
							<h3 className="mt-3 text-xl font-normal">{step.title}</h3>
							<p className="mt-2 text-sm leading-relaxed text-white/80">{step.text}</p>
						</article>
					))}
				</div>
				<p className="mt-8 text-sm text-white/70">Sellers must be 18 or older and connect a Stripe account.</p>
			</div>
		</section>
	);
}

const STORE_FEATURES: ReadonlyArray<{ title: string; text: string; soon?: boolean }> = [
	{ title: 'Catalog and product pages', text: 'Products, variants, filters and detailed product pages, generated from your description.' },
	{ title: 'Cart and checkout flow', text: 'A cart, a checkout form and order confirmations your customers already know how to use.' },
	{ title: 'Order records', text: 'Your store can keep its orders in its own database, ready for you to review.' },
	{ title: 'Edit by chatting', text: 'Ask for a new section, a different style or more products, and the AI updates the live store.' },
	{ title: 'Desktop and phone preview', text: 'See every change on desktop and phone before you share it.' },
	{ title: 'Accept payments', text: 'Connect a payment provider and take real orders.', soon: true },
];

export function ForStoreOwners() {
	return (
		<section className="border-t border-kumo-line bg-kumo-recessed">
			<div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
				<div className="max-w-2xl">
					<Eyebrow>For your own store</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl">Everything your store needs, from one description</h2>
					<p className="mt-4 text-lg font-light text-kumo-subtle">
						Start from scratch or from a store in Discover, then change anything by chatting.
					</p>
				</div>
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{STORE_FEATURES.map((feature) => (
						<article key={feature.title} className="rounded-3xl bg-kumo-elevated p-7 ring ring-kumo-hairline">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-lg font-normal text-kumo-strong">{feature.title}</h3>
								{feature.soon && <ComingSoon />}
							</div>
							<p className="mt-2 text-sm leading-relaxed text-kumo-subtle">{feature.text}</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

export function PricingSummary() {
	return (
		<section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
			<div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
				<div>
					<Eyebrow>Pricing</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong sm:text-5xl">Free to build. Pay only when you sell.</h2>
					<Link to="/pricing" className="mt-6 inline-flex items-center gap-1 text-sm text-[var(--estori-link)] hover:underline">
						See pricing <ArrowRightIcon className="size-4" />
					</Link>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<article className="rounded-3xl bg-kumo-elevated p-7 ring ring-kumo-hairline">
						<p className="text-sm uppercase tracking-[0.14em] text-kumo-subtle">Build</p>
						<p className="mt-3 text-4xl font-light text-kumo-strong">Free</p>
						<PlanLimits className="mt-3 text-sm text-kumo-subtle" />
					</article>
					<article className="rounded-3xl bg-[#070b16] p-7 text-white ring ring-white/10">
						<p className="text-sm uppercase tracking-[0.14em] text-white/60">Sell</p>
						<p className="mt-3 text-4xl font-light">{PLATFORM_FEE_LABEL}</p>
						<p className="mt-3 text-sm text-white/60">per sale, paid through Stripe</p>
					</article>
				</div>
			</div>
		</section>
	);
}

const FAQ: ReadonlyArray<{ question: string; answer: ReactNode }> = [
	{ question: 'Is Estori free?', answer: 'Yes. Building, editing and publishing are free within daily limits. Estori only earns a fee when you sell a store design.' },
	{ question: 'Can my store take payments?', answer: 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.' },
	{ question: 'Who owns the store I build?', answer: 'You do. Keep editing it, keep it private, or publish it to Discover.' },
	{ question: 'Can I resell a store I bought?', answer: "No. A store you buy is yours to adapt for your own business, but it can't be republished or resold." },
	{ question: 'What does Estori charge sellers?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{
		question: "What if a store I bought doesn't work?",
		answer: (
			<>
				If it can't be used, email us within 14 days and we'll fix it or refund you. See the{' '}
				<Link to="/refunds" className="underline">refund policy</Link>.
			</>
		),
	},
];

export function LandingFaq() {
	return (
		<section className="border-t border-kumo-line">
			<div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_2fr]">
				<div>
					<Eyebrow>FAQ</Eyebrow>
					<h2 className="mt-4 text-4xl font-light tracking-[-0.025em] text-kumo-strong">Questions, answered</h2>
				</div>
				<div className="divide-y divide-kumo-line">
					{FAQ.map((item) => (
						<details key={item.question} className="group py-5">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-normal text-kumo-strong">
								{item.question}
								<span className="text-kumo-subtle transition-transform group-open:rotate-45" aria-hidden>+</span>
							</summary>
							<p className="mt-3 text-sm leading-relaxed text-kumo-subtle">{item.answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}

export function ClosingCta() {
	return (
		<section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
			<DarkBand className="rounded-[2rem]">
				<div className="px-6 py-20 text-center sm:px-12">
					<h2 className="mx-auto max-w-3xl text-4xl font-light tracking-[-0.025em] sm:text-6xl">Your next store starts with a sentence.</h2>
					<div className="mt-10 flex flex-wrap justify-center gap-3">
						<a href="#build" className="rounded-full bg-white px-6 py-3 text-sm font-medium text-[#070b16] hover:bg-white/90">Start building</a>
						<Link to="/pricing" className="rounded-full px-6 py-3 text-sm text-white ring ring-white/30 hover:ring-white/60">View pricing</Link>
					</div>
					<ul className="mx-auto mt-10 flex max-w-xl flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-white/70">
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Free to build</li>
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Live preview</li>
						<li className="inline-flex items-center gap-1.5"><CheckIcon className="size-4" /> Sell in Discover</li>
					</ul>
				</div>
			</DarkBand>
		</section>
	);
}
```

`useDiscoverStripSites` doesn't exist yet. In `src/components/publishing/DiscoverStrip.tsx`, move the strip's `useQuery` (same `queryKeys.apps.strip()` key and the same `queryFn`) into `export function useDiscoverStripSites()` in that file, and have `DiscoverStrip` call it. Behavior stays the same, and TanStack Query shares the one request between the strip and `FeaturedStores`. Add `src/components/publishing/DiscoverStrip.tsx` to this task's commit. The existing `discover-guard.test.ts` assertion that the strip contains `reusableOnly: true` must still pass.

The `BuildBox` sits on the dark hero. If `PromptBox`'s `variant="expanded"` looks wrong on dark (low-contrast borders), wrap it in a light card (`rounded-3xl bg-kumo-elevated p-2 ring ring-white/10 shadow-2xl`). Don't restyle `PromptBox` itself.

The closing "Start building" uses `href="#build"`. Because `PublicLayout` scrolls its own container, an in-page hash link may not scroll. If it doesn't, use a button calling `document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'center' })`, as `PublicTopBar` does.

`src/routes/landing/LandingPage.tsx`:
```tsx
import { pageTitle } from '@/brand';
import { ClosingCta, FeaturedStores, ForCreators, ForStoreOwners, Hero, LandingFaq, PricingSummary } from './sections';

export function LandingPage() {
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<FeaturedStores />
			<ForCreators />
			<ForStoreOwners />
			<PricingSummary />
			<LandingFaq />
			<ClosingCta />
		</>
	);
}
```

`index.html` line 10: set the description content to `Build online stores with AI and sell them as templates. Free to build.`

- [ ] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run src`
Expected: PASS, including the landing guard, the moved model-picker assertions, the discover guard and the brand guard.

- [ ] **Step 7: Typecheck and look at it**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

In the browser pane at http://localhost:8100/, check:
1. **Signed out, 1280 px:** the dark hero with a light headline and the build box. Typing a prompt and submitting opens the sign-up window. Check the featured stores, the blue creators panel, the store-owner grid, the pricing summary, the FAQ, the closing panel and the footer.
2. **The same at 390 px:** no horizontal scroll, the top bar shows the logo plus Sign in and Start building, and the sections stack.
3. **Dark theme:** the content sections are readable.
4. **Signed in** (one-click local helper: http://localhost:8199/as/owner?next=/): the builder home appears as before, with the sidebar, and the sidebar footer shows the Pricing and legal links.

Fix anything that looks broken before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/build-box.tsx src/routes/home.tsx src/hooks/use-oauth-error-toast.ts src/routes/root-index.tsx src/routes/landing/LandingPage.tsx src/routes/landing/sections.tsx src/routes.tsx src/routes/model-picker-guard.test.ts src/routes/discover-guard.test.ts src/routes/landing-guard.test.ts index.html
git commit -m "feat(pages): landing page for signed-out visitors, reusing the build box"
```

If `brand-guard.test.ts` needed a change, add it explicitly too.

---

### Task 8: Full verification

**Files:** none new. Fix whatever these checks find, each fix with a test that fails first.

- [ ] **Step 1: Run every affected suite in batches**

```bash
npx vitest run src
npx vitest run shared
npx vitest run worker/database
npx vitest run worker/services
npx vitest run worker/api
```
Expected: all PASS. Rerun a batch once after a pause if it dies with `EADDRNOTAVAIL` or `ERR_RUNTIME_FAILURE`.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --incremental --noEmit 2>&1 | grep "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 3: Live checks on the local server (http://localhost:8100)**

1. **Signed out:**
   - `/` shows the landing page;
   - the build box asks the visitor to sign up;
   - `/pricing`, `/terms`, `/privacy`, `/refunds` and `/copyright` load from the footer links.
2. **Sign up a new local test account** on localhost, through the sign-up form:
   - Create account is refused with the terms message until the box is ticked;
   - after sign-up, the account isn't shown the terms window.
3. **Sign in as an existing local account** (`http://localhost:8199/as/owner?next=/`):
   - the terms window appears once;
   - after ticking and Continue, it's gone, and it stays gone on reload.
4. **`curl -s http://localhost:8100/api/limits/plan`** returns `{"success":true,"data":{"newSitesPerDay":…,"aiCreditsPerDay":…}}`.
5. **Light and dark themes, at 1280 px and 390 px,** on `/`, `/pricing` and `/terms`.

- [ ] **Step 4: Record the results**

Write the checks and their results to the run's ledger.
