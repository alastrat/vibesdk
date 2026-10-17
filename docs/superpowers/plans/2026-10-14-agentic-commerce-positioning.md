# Agentic Commerce Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the public site of estori.app as the agentic commerce platform for brands, with each capability's real status shown, plus early-access requests for the two separate programs.

**Architecture:**
- **Status in one place:** a capability registry (`src/lib/capabilities.ts`) is the single source of each capability's status. Menus, tags, page sections and the pricing comparison all read from it.
- **Plans:** plan data lives in `src/lib/plans.ts`.
- **Early-access requests:** stored in a new D1 table behind three endpoints. A button carries a pending request through sign-in, including OAuth redirects, using a `?request=` return URL.
- **Pages:** the new pages are built from shared solution-page blocks in `src/components/public-site/`. Their copy lives in `src/content/positioning.ts`.

**Tech Stack:**
- **Frontend:** React 19, React Router 7, Tailwind 4, TanStack Query, Magic UI components on framer-motion, Kumo (admin only), phosphor icons.
- **Backend:** Hono, D1 with Drizzle, Vitest in the Workers pool with raw-source guard tests.

**Spec:** `docs/superpowers/specs/2026-10-14-agentic-commerce-positioning-design.md`

## Global Constraints

These apply to every task.

**Code:**
- No `any`. No emojis. Comments explain purpose, briefly. DRY: reuse the primitives, `PublicFaq`, `ClosingPanel`, `PlanLimits` and `ComingSoon`.
- The frontend imports shared types and values from `@/api-types`. The worker imports from `shared/types/*` by relative path.

**Copy:**
- Never name a competitor. The list is in `src/routes/copy-rules.ts` (Task 6).
- Never name an AI assistant or its maker: chatgpt, openai, gemini, copilot, anthropic, claude, perplexity, google. Say "AI assistants" or "AI shopping assistants".
- The standards always appear as "the open agentic commerce standards (UCP and ACP)". Never "the standard".
- A capability that isn't `available` never gets "now", "today", "live" or "available" next to it. Its tag comes from `CapabilityTag`, which reads the registry. New pages never use `<ComingSoon` directly for a capability.
- Fees, plan prices, credit allowances and the free plan's daily limits come from code (`PLATFORM_FEE_LABEL`, `PLANS`, `usePublicPlan`). Never type them into copy.
- Generated stores can't take real payments yet. Keep "Accept payments in your store" with `<ComingSoon />` wherever payments come up.

**Styling and behavior:**
- Public pages use the `.public-site` palette (`public-charcoal`, `public-blue`, `public-ink`, `public-muted`, `public-line`) and never `kumo-` classes. Admin pages use Kumo.
- Nothing moves under `prefers-reduced-motion: reduce`. Use the Magic UI components; they already handle it.
- Files in `src/routes/landing/`, `src/components/public-site/` and `src/routes/pricing.tsx` must not contain the substring "framer". The landing guard's competitor list includes it.

**Process:**
- Prefix `npx vitest`, `npx tsc`, `npx eslint` and `grep` with `rtk proxy`.
- Run vitest one directory or file set at a time. Between full-directory runs, wait until `netstat -an -p tcp | grep -c TIME_WAIT` is under 1500.
- Git: stage changed files by explicit path. Never stage `wrangler.jsonc`, `bun.lockb`, `.dev.vars` or `.superpowers/`. No bare `git stash`. No push. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The dev server on port 8100 runs from this worktree and hot-reloads. Don't restart it. Delete any `.playwright-mcp/` folder you create.

## Rulings made while planning

1. **Desktop nav from 1024px (`lg`), not 768px.**
   - The spec says 768px. But four nav items (Solutions ▾, For creators ▾, Discover, Pricing), the logo, Sign in and the build pill need about 810px with the bar's padding. They overflow at 768px.
   - Between 768 and 1023px the menu button stays, and the build pill shows from 640px as today.
   - Cost if wrong: a breakpoint swap.
2. **Account deletion is covered by the foreign-key cascade alone.**
   - Account deletion is a manual erasure request today (Settings links to privacy@), so there's no deletion flow to extend. When a user row is deleted, `on delete cascade` removes their requests.
   - Cost if wrong: one cleanup statement in a future deletion flow.
3. **The shared FAQ takes an `items` prop.**
   - Its default list becomes the updated launch FAQ, shared by the landing and pricing pages. Solution pages pass their own lists.
   - Cost if wrong: none.
4. **`ClosingPanel` links to `/#build` with `PillLink`,** so it works from every page, not only the landing page.
   - Cost if wrong: none.

## Review Focus

1. **A visitor requests early access, then signs in with Google or GitHub.** The page reloads after the redirect. The request must still be recorded once, and `?request=` must leave the URL. Pinned by the `requestedCapability` tests (Task 4) and the guard that both early-access pages call `useEarlyAccessFromUrl()` (Tasks 7 and 8).
2. **Keyboard users of the menus.**
   - Escape closes an open panel and returns focus to its trigger.
   - Opening one panel closes the other.
   - Following a link closes it.

   Pinned by the navigation guard (Task 5).
3. **Widths between 768 and 1024px.** The bar must stay on one line with no sideways scroll. Pinned by the `hidden lg:flex` / `lg:hidden` guard (Task 5) and checked live at 767, 1023 and 1024 (Task 12).
4. **A capability ships.** Changing its status in the registry must remove its tag everywhere. Pinned by the guard that new pages and menus use `CapabilityTag` and never `<ComingSoon` (Tasks 5 to 8).
5. **A non-admin opens `/admin/early-access`.** They must see "Admins only", not an error. Pinned by the admin page guard (Task 4).

---

## File Structure

**Created:**

| File | Purpose |
|---|---|
| `shared/types/early-access.ts` | Early-access capability ids, shared by the worker and the app. |
| `src/lib/capabilities.ts` (+ `.test.ts`) | The capability registry. |
| `src/lib/plans.ts` (+ `.test.ts`) | Plan data and the plan comparison. |
| `src/lib/site-nav.ts` | Audience and creator menu items. |
| `src/lib/early-access.ts` (+ `.test.ts`) | The return-URL helpers. |
| `src/lib/security-error.ts` | `isForbiddenError`, extracted from the reviews page. |
| `src/content/positioning.ts` | Page copy: cards, steps, FAQ lists. |
| `src/components/public-site/CapabilityTag.tsx` | A capability's status badge, from the registry. |
| `src/components/public-site/PlanPrice.tsx` | A plan's price, shared by the landing and pricing pages. |
| `src/components/public-site/solution-page.tsx` | Page blocks: `PageMeta`, `SolutionHero`, `CardSection`, `HowItWorks`, `LinkCard`. |
| `src/components/public-site/capability-sections.tsx` | The agentic commerce, operations and personalization sections. |
| `src/components/public-site/EarlyAccessButton.tsx` | The request button. |
| `src/components/layout/NavMenu.tsx` | The Solutions and For creators panels, and the phone menu groups. |
| `src/hooks/use-early-access.ts` | Early-access queries and mutations. |
| `src/routes/solutions/brands.tsx`, `resellers.tsx`, `digital.tsx` | Solution pages. |
| `src/routes/agentic-commerce.tsx` | The agentic commerce explainer. |
| `src/routes/creators/developers.tsx`, `content.tsx` | Creator pages. |
| `src/routes/creators/TemplateEarnings.tsx` | Moved from `src/routes/landing/CreatorsPanel.tsx`. |
| `src/routes/landing/SellersBand.tsx` | The landing page's audience band. |
| `src/routes/admin/early-access.tsx` | The admin page. |
| `src/routes/copy-rules.ts` | Competitor and assistant name lists for guards. |
| `src/routes/positioning-copy-guard.test.ts`, `src/routes/early-access-guard.test.ts`, `src/routes/solutions-guard.test.ts` | Guards. |
| `worker/database/services/EarlyAccessService.ts` | The early-access service. |
| `worker/database/early-access-schema.test.ts` | Schema, migration and service tests. |
| `worker/api/controllers/earlyAccess/types.ts`, `earlyAccessDto.ts` (+ `.test.ts`), `controller.ts`, `early-access-wiring.test.ts` | The early-access API. |
| `worker/api/routes/earlyAccessRoutes.ts` | The early-access routes. |
| `migrations/0014_*.sql` | Generated by drizzle-kit. |

**Modified:**
- **Shared and worker:** `src/api-types.ts`, `worker/database/schema.ts`, `worker/database/index.ts`, `worker/api/routes/index.ts`.
- **App plumbing:** `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/routes.tsx`, `src/routes/admin/reviews.tsx`.
- **Components:** `src/components/marketing/ComingSoon.tsx`, `src/components/public-site/PublicFaq.tsx`.
- **Layout:** `src/components/layout/PublicTopBar.tsx`, `src/components/layout/AnnouncementBar.tsx`, `src/components/layout/SiteFooter.tsx`.
- **Landing:** `src/routes/landing/LandingPage.tsx`, `Hero.tsx`, `Features.tsx`, `sections.tsx`.
- **Pricing and legal:** `src/routes/pricing.tsx`, `src/content/legal/privacy.md`.
- **Guards:** `src/routes/landing-guard.test.ts`, `src/routes/pricing-guard.test.ts`, `src/routes/public-pages-guard.test.ts`, `src/components/layout/public-chrome-guard.test.ts`.

---

### Task 1: Capability registry and status badges

**Files:**
- Create: `shared/types/early-access.ts`, `src/lib/capabilities.ts`, `src/lib/capabilities.test.ts`, `src/components/public-site/CapabilityTag.tsx`
- Modify: `src/api-types.ts` (the shared exports block near the `templates.js` exports), `src/components/marketing/ComingSoon.tsx`

**Interfaces:**
- Produces:
  - `EARLY_ACCESS_CAPABILITIES`, `EarlyAccessCapability` and `isEarlyAccessCapability(value: unknown): value is EarlyAccessCapability` (from `@/api-types` and `shared/types/early-access`);
  - `CapabilityId`, `CapabilityStatus`, `Capability`, `CAPABILITIES`, `PLATFORM_CAPABILITIES` and `capabilitiesWithStatus(status)` (from `@/lib/capabilities`);
  - `StatusBadge({ status: 'coming-soon' | 'early-access'; tone? })` and `ComingSoon({ tone? })`, kept as before;
  - `CapabilityTag({ id: CapabilityId; tone? })`.

- [ ] **Step 1: Write the failing test** `src/lib/capabilities.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EARLY_ACCESS_CAPABILITIES } from '@/api-types';
import { CAPABILITIES, PLATFORM_CAPABILITIES, capabilitiesWithStatus, type CapabilityId, type CapabilityStatus } from './capabilities';

describe('capability registry', () => {
	it('gives each capability the status the spec approved', () => {
		const statuses: Record<CapabilityId, CapabilityStatus> = {
			'store-builder': 'available',
			'agentic-commerce': 'coming-soon',
			'operations-agents': 'coming-soon',
			'personalized-shopping': 'coming-soon',
			'product-catalog': 'coming-soon',
			'digital-products': 'early-access',
			'developer-templates': 'available',
			'content-creators': 'early-access',
		};
		for (const [id, status] of Object.entries(statuses)) expect(CAPABILITIES[id as CapabilityId].status).toBe(status);
	});

	it('keys each entry by its own id and points it at a page on the site', () => {
		for (const [key, capability] of Object.entries(CAPABILITIES)) {
			expect(capability.id).toBe(key);
			expect(capability.path.startsWith('/')).toBe(true);
			expect(capability.name.length).toBeGreaterThan(0);
			expect(capability.description.length).toBeGreaterThan(0);
		}
	});

	it('takes early-access requests for exactly the ids the API accepts', () => {
		const ids = capabilitiesWithStatus('early-access').map((capability) => capability.id).sort();
		expect(ids).toEqual([...EARLY_ACCESS_CAPABILITIES].sort());
	});

	it('lists the Platform menu in the approved order', () => {
		expect(PLATFORM_CAPABILITIES).toEqual(['store-builder', 'agentic-commerce', 'operations-agents', 'personalized-shopping', 'product-catalog', 'digital-products']);
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy npx vitest run src/lib/capabilities.test.ts`
Expected: FAIL. The suite can't resolve `./capabilities`, or `EARLY_ACCESS_CAPABILITIES` is missing from `@/api-types`.

- [ ] **Step 3: Create `shared/types/early-access.ts`**

```ts
/** Programs that take early-access requests; the API accepts only these ids. */
export const EARLY_ACCESS_CAPABILITIES = ['digital-products', 'content-creators'] as const;

export type EarlyAccessCapability = (typeof EARLY_ACCESS_CAPABILITIES)[number];

export function isEarlyAccessCapability(value: unknown): value is EarlyAccessCapability {
	return typeof value === 'string' && (EARLY_ACCESS_CAPABILITIES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Export it from `src/api-types.ts`.** Add these right after the `export { DISCOVER_PRICING_FILTERS, ... } from '../shared/types/templates.js';` block:

```ts
export { EARLY_ACCESS_CAPABILITIES, isEarlyAccessCapability } from '../shared/types/early-access.js';
export type { EarlyAccessCapability } from '../shared/types/early-access.js';
```

- [ ] **Step 5: Create `src/lib/capabilities.ts`**

```ts
/** How a capability shows on the public site; changing a status here updates every tag, button and menu. */
export type CapabilityStatus = 'available' | 'coming-soon' | 'early-access';

export type CapabilityId =
	| 'store-builder'
	| 'agentic-commerce'
	| 'operations-agents'
	| 'personalized-shopping'
	| 'product-catalog'
	| 'digital-products'
	| 'developer-templates'
	| 'content-creators';

export interface Capability {
	id: CapabilityId;
	name: string;
	description: string;
	status: CapabilityStatus;
	/** The page, or page section, that explains it. */
	path: string;
}

export const CAPABILITIES: Readonly<Record<CapabilityId, Capability>> = {
	'store-builder': {
		id: 'store-builder',
		name: 'AI store builder',
		description: 'A complete store from a sentence, edited by chat',
		status: 'available',
		path: '/',
	},
	'agentic-commerce': {
		id: 'agentic-commerce',
		name: 'Agentic commerce',
		description: 'Sell through AI shopping assistants',
		status: 'coming-soon',
		path: '/agentic-commerce',
	},
	'operations-agents': {
		id: 'operations-agents',
		name: 'Operations agents',
		description: 'Agents for the day-to-day work of your store',
		status: 'coming-soon',
		path: '/solutions/brands#operations',
	},
	'personalized-shopping': {
		id: 'personalized-shopping',
		name: 'Personalized shopping',
		description: 'Recommendations, a smart cart and AI search',
		status: 'coming-soon',
		path: '/solutions/brands#personalization',
	},
	'product-catalog': {
		id: 'product-catalog',
		name: 'Product catalog',
		description: 'Vetted suppliers, added in a few clicks',
		status: 'coming-soon',
		path: '/solutions/resellers#catalog',
	},
	'digital-products': {
		id: 'digital-products',
		name: 'Digital products and community',
		description: 'Sell downloads and run your community',
		status: 'early-access',
		path: '/solutions/digital',
	},
	'developer-templates': {
		id: 'developer-templates',
		name: 'Templates in Discover',
		description: 'Build stores and sell them as templates',
		status: 'available',
		path: '/creators/developers',
	},
	'content-creators': {
		id: 'content-creators',
		name: 'Content creator program',
		description: "Get paid promoting merchants' products",
		status: 'early-access',
		path: '/creators/content',
	},
};

/** The Solutions menu's Platform column, in order. */
export const PLATFORM_CAPABILITIES: readonly CapabilityId[] = [
	'store-builder',
	'agentic-commerce',
	'operations-agents',
	'personalized-shopping',
	'product-catalog',
	'digital-products',
];

export function capabilitiesWithStatus(status: CapabilityStatus): Capability[] {
	return Object.values(CAPABILITIES).filter((capability) => capability.status === status);
}
```

- [ ] **Step 6: Run the test to see it pass**

Run: `rtk proxy npx vitest run src/lib/capabilities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Replace `src/components/marketing/ComingSoon.tsx`** with the shared badge. `ComingSoon` keeps working for its existing callers.

```tsx
import { cn } from '@/lib/utils';

type Tone = 'light' | 'dark';

const BASE = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em]';

const STYLES = {
	'coming-soon': {
		light: 'bg-[#f4f4f5] text-public-muted ring ring-public-line',
		dark: 'text-white/85 ring ring-white/40',
	},
	'early-access': {
		light: 'bg-[#eaf1ff] text-public-blue ring ring-[#c9dbff]',
		dark: 'bg-white/10 text-white ring ring-white/60',
	},
} as const;

const LABELS = { 'coming-soon': 'Coming soon', 'early-access': 'Early access' } as const;

/** A status badge for the public pages, in fixed colors since those pages ignore the app theme. */
export function StatusBadge({ status, tone = 'light' }: { status: keyof typeof STYLES; tone?: Tone }) {
	return <span className={cn(BASE, STYLES[status][tone])}>{LABELS[status]}</span>;
}

export function ComingSoon({ tone = 'light' }: { tone?: Tone }) {
	return <StatusBadge status="coming-soon" tone={tone} />;
}
```

- [ ] **Step 8: Create `src/components/public-site/CapabilityTag.tsx`**

```tsx
import { StatusBadge } from '@/components/marketing/ComingSoon';
import { CAPABILITIES, type CapabilityId } from '@/lib/capabilities';

/** The capability's status badge from the registry; nothing once it's available. */
export function CapabilityTag({ id, tone = 'light' }: { id: CapabilityId; tone?: 'light' | 'dark' }) {
	const { status } = CAPABILITIES[id];
	return status === 'available' ? null : <StatusBadge status={status} tone={tone} />;
}
```

- [ ] **Step 9: Typecheck the change, then commit**

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | grep -v artifacts-viewer`
Expected: no output.

```bash
git add shared/types/early-access.ts src/api-types.ts src/lib/capabilities.ts src/lib/capabilities.test.ts src/components/marketing/ComingSoon.tsx src/components/public-site/CapabilityTag.tsx
git commit -m "feat(positioning): one registry for each capability's status, with its badge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plan data

**Files:**
- Create: `src/lib/plans.ts`, `src/lib/plans.test.ts`

**Interfaces:**
- Consumes: `CAPABILITIES` and `CapabilityId` from Task 1.
- Produces:
  - the types `PlanId`, `Plan`, `PlanCell`, `ComparisonRow` and `ComparisonSection`;
  - the data `PLANS` and `PLAN_COMPARISON`;
  - the formatters `formatPlanPrice(plan: Plan): string`, `formatCredits(credits: number): string` and `liveStoresLabel(count: number | null): string`.

- [ ] **Step 1: Write the failing test** `src/lib/plans.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './capabilities';
import { PLANS, PLAN_COMPARISON, formatCredits, formatPlanPrice, liveStoresLabel } from './plans';

describe('plans', () => {
	it('offers Free today and three paid plans marked coming soon', () => {
		expect(PLANS.map((plan) => [plan.id, plan.status, plan.priceCents, plan.monthlyCredits, plan.liveStores])).toEqual([
			['free', 'available', 0, null, null],
			['starter', 'coming-soon', 2_900, 10_000, 1],
			['growth', 'coming-soon', 7_900, 30_000, 3],
			['scale', 'coming-soon', 24_900, 100_000, 10],
		]);
	});

	it('formats prices, credits and store counts for the cards', () => {
		expect(PLANS.map(formatPlanPrice)).toEqual(['$0', '$29', '$79', '$249']);
		expect(formatCredits(10_000)).toBe('10,000');
		expect(liveStoresLabel(null)).toBe('Build and preview');
		expect(liveStoresLabel(1)).toBe('1 live store');
		expect(liveStoresLabel(3)).toBe('3 live stores');
	});

	it('fills every comparison row for every plan, grouped by real capabilities', () => {
		for (const section of PLAN_COMPARISON) {
			if (section.capability) expect(CAPABILITIES[section.capability]).toBeDefined();
			for (const row of section.rows) expect(Object.keys(row.cells).sort()).toEqual(['free', 'growth', 'scale', 'starter']);
		}
	});

	it('never gives the free plan a capability that is not available yet', () => {
		for (const section of PLAN_COMPARISON) {
			if (!section.capability || CAPABILITIES[section.capability].status === 'available') continue;
			for (const row of section.rows) expect(row.cells.free).toBe(false);
		}
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy npx vitest run src/lib/plans.test.ts`
Expected: FAIL. The suite can't resolve `./plans`.

- [ ] **Step 3: Create `src/lib/plans.ts`**

```ts
import type { CapabilityId } from './capabilities';

export type PlanId = 'free' | 'starter' | 'growth' | 'scale';

export interface Plan {
	id: PlanId;
	name: string;
	status: 'available' | 'coming-soon';
	priceCents: number;
	/** Monthly AI credits for building sites and agents' work; null for Free, whose daily allowance is read live. */
	monthlyCredits: number | null;
	/** Live stores included; null for Free, which builds and previews only. */
	liveStores: number | null;
	summary: string;
}

export const PLANS: readonly Plan[] = [
	{ id: 'free', name: 'Free', status: 'available', priceCents: 0, monthlyCredits: null, liveStores: null, summary: 'Build and preview stores with AI.' },
	{ id: 'starter', name: 'Starter', status: 'coming-soon', priceCents: 2_900, monthlyCredits: 10_000, liveStores: 1, summary: 'One live store, ready for AI shopping assistants.' },
	{ id: 'growth', name: 'Growth', status: 'coming-soon', priceCents: 7_900, monthlyCredits: 30_000, liveStores: 3, summary: 'Agents that help run your stores, and the product catalog.' },
	{ id: 'scale', name: 'Scale', status: 'coming-soon', priceCents: 24_900, monthlyCredits: 100_000, liveStores: 10, summary: 'More stores, more AI credits and priority support.' },
];

export function formatPlanPrice(plan: Plan): string {
	return `$${plan.priceCents / 100}`;
}

export function formatCredits(credits: number): string {
	return credits.toLocaleString('en-US');
}

export function liveStoresLabel(count: number | null): string {
	if (count === null) return 'Build and preview';
	return count === 1 ? '1 live store' : `${count} live stores`;
}

/** A check (true), a dash (false) or a short text. */
export type PlanCell = boolean | string;

export interface ComparisonRow {
	label: string;
	cells: Readonly<Record<PlanId, PlanCell>>;
}

export interface ComparisonSection {
	title: string;
	/** The capability whose status tag the section shows; null for plain sections. */
	capability: CapabilityId | null;
	rows: readonly ComparisonRow[];
}

const ALL: Record<PlanId, PlanCell> = { free: true, starter: true, growth: true, scale: true };
const PAID: Record<PlanId, PlanCell> = { free: false, starter: true, growth: true, scale: true };
const GROWTH_AND_UP: Record<PlanId, PlanCell> = { free: false, starter: false, growth: true, scale: true };

/** What each plan includes, by capability. The pricing page adds the live stores and AI credits rows from PLANS. */
export const PLAN_COMPARISON: readonly ComparisonSection[] = [
	{
		title: 'Store building',
		capability: 'store-builder',
		rows: [
			{ label: 'Build and edit stores by chat', cells: ALL },
			{ label: 'Start from templates in Discover', cells: ALL },
		],
	},
	{ title: 'Agentic commerce', capability: 'agentic-commerce', rows: [{ label: 'Sell through AI shopping assistants', cells: PAID }] },
	{
		title: 'Operations agents',
		capability: 'operations-agents',
		rows: [
			{ label: 'Merchandising, stock alerts and order follow-ups', cells: GROWTH_AND_UP },
			{ label: 'Customer replies', cells: GROWTH_AND_UP },
		],
	},
	{
		title: 'Personalized shopping',
		capability: 'personalized-shopping',
		rows: [
			{ label: 'Recommendations and smart cart', cells: PAID },
			{ label: 'Bundles, post-purchase offers and AI search', cells: GROWTH_AND_UP },
		],
	},
	{ title: 'Product catalog', capability: 'product-catalog', rows: [{ label: 'Curated supplier catalog', cells: GROWTH_AND_UP }] },
	{
		title: 'Digital products and community',
		capability: 'digital-products',
		rows: [{ label: 'Sell digital products and run a community', cells: GROWTH_AND_UP }],
	},
	{ title: 'Support', capability: null, rows: [{ label: 'Support', cells: { free: 'Email', starter: 'Email', growth: 'Email', scale: 'Priority' } }] },
];
```

- [ ] **Step 4: Run the test to see it pass**

Run: `rtk proxy npx vitest run src/lib/plans.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/plans.ts src/lib/plans.test.ts
git commit -m "feat(pricing): plan data and the comparison by capability

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Early-access storage and API (worker)

**Files:**
- Create:
  - `worker/database/services/EarlyAccessService.ts`;
  - `worker/database/early-access-schema.test.ts`;
  - `worker/api/controllers/earlyAccess/types.ts`;
  - `worker/api/controllers/earlyAccess/earlyAccessDto.ts`;
  - `worker/api/controllers/earlyAccess/earlyAccessDto.test.ts`;
  - `worker/api/controllers/earlyAccess/controller.ts`;
  - `worker/api/controllers/earlyAccess/early-access-wiring.test.ts`;
  - `worker/api/routes/earlyAccessRoutes.ts`;
  - `migrations/0014_*.sql` and its meta files, generated.
- Modify:
  - `worker/database/schema.ts`: add the table after `stars`, and the types after the other type exports;
  - `worker/database/index.ts`;
  - `worker/api/routes/index.ts`;
  - `src/api-types.ts`.

**Interfaces:**
- Consumes: `EarlyAccessCapability`, `EARLY_ACCESS_CAPABILITIES` and `isEarlyAccessCapability` from `shared/types/early-access` (Task 1).
- Produces:
  - the endpoints `POST /api/early-access` with `{ capability }` (signed in) and `GET /api/early-access` (signed in), both returning `MyEarlyAccessData`, plus `GET /api/admin/early-access` (admin) returning `EarlyAccessAdminData`;
  - the types `MyEarlyAccessData { capabilities: EarlyAccessCapability[] }`, `EarlyAccessAdminRequest { capability; email; displayName; requestedAt: string }` and `EarlyAccessAdminData { counts: Record<EarlyAccessCapability, number>; requests: EarlyAccessAdminRequest[] }`, exported from `@/api-types`.

- [ ] **Step 1: Write the failing schema and service test** `worker/database/early-access-schema.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { EarlyAccessService } from './services/EarlyAccessService';
import { recordingD1 } from './test-support/recording-d1';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const allMigrationSql = Object.values(migrations).join('\n');

describe('early access storage', () => {
	it('keeps one request per user and program, removed with the account', () => {
		const config = getTableConfig(schema.earlyAccessRequests);
		expect(config.name).toBe('early_access_requests');
		expect(config.columns.map((column) => column.name).sort()).toEqual(['capability', 'created_at', 'id', 'user_id']);
		expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
		const unique = config.indexes.find((index) => index.config.name === 'early_access_requests_user_capability_idx');
		expect(unique?.config.unique).toBe(true);
	});

	it('ships the table in a migration', () => {
		expect(allMigrationSql).toContain('CREATE TABLE `early_access_requests`');
		expect(allMigrationSql).toContain('CREATE UNIQUE INDEX `early_access_requests_user_capability_idx`');
	});
});

describe('EarlyAccessService', () => {
	it('records a request once, ignoring a repeat', async () => {
		const { d1, statements } = recordingD1();
		await new EarlyAccessService({ DB: d1 } as unknown as Env).request('u1', 'digital-products');
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('insert into "early_access_requests"');
		expect(sql).toContain('on conflict');
		expect(sql).toContain('do nothing');
		expect(statements[0].params).toContain('u1');
		expect(statements[0].params).toContain('digital-products');
	});

	it("lists the user's requests, dropping programs that no longer exist", async () => {
		const { d1, statements } = recordingD1([['digital-products'], ['retired-program']]);
		const capabilities = await new EarlyAccessService({ DB: d1 } as unknown as Env).listForUser('u1');
		expect(capabilities).toEqual(['digital-products']);
		expect(statements[0].sql.toLowerCase()).toContain('"early_access_requests"."user_id" = ?');
	});

	it('lists every request with who asked, newest first', async () => {
		const { d1, statements } = recordingD1([
			['content-creators', 'ana@example.com', 'Ana', 1_760_400_000],
			['retired-program', 'bo@example.com', 'Bo', 1_760_300_000],
		]);
		const rows = await new EarlyAccessService({ DB: d1 } as unknown as Env).listAll();
		expect(rows).toEqual([{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', createdAt: new Date(1_760_400_000 * 1000) }]);
		const sql = statements[0].sql.toLowerCase();
		expect(sql).toContain('inner join "users"');
		expect(sql).toContain('order by "early_access_requests"."created_at" desc');
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy npx vitest run worker/database/early-access-schema.test.ts`
Expected: FAIL. `schema.earlyAccessRequests` is undefined, or `./services/EarlyAccessService` can't be resolved.

- [ ] **Step 3: Add the table to `worker/database/schema.ts`.** Put it right after the `stars` table:

```ts
/**
 * Early-access requests for upcoming programs, one per user and program.
 */
export const earlyAccessRequests = sqliteTable('early_access_requests', {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    capability: text('capability').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
    userCapabilityIdx: uniqueIndex('early_access_requests_user_capability_idx').on(table.userId, table.capability),
    capabilityIdx: index('early_access_requests_capability_idx').on(table.capability),
}));
```

Then add these after the existing type exports (the block that starts `export type User = typeof users.$inferSelect;`):

```ts
export type EarlyAccessRequest = typeof earlyAccessRequests.$inferSelect;
export type NewEarlyAccessRequest = typeof earlyAccessRequests.$inferInsert;
```

- [ ] **Step 4: Generate the migration**

Run: `npm run db:generate`
Expected: a new `migrations/0014_<words>.sql`, plus `migrations/meta/0014_snapshot.json` and an updated `migrations/meta/_journal.json`.

Run: `cat migrations/0014_*.sql`
Expected: `CREATE TABLE \`early_access_requests\`` with the foreign key `ON DELETE cascade`, `CREATE UNIQUE INDEX \`early_access_requests_user_capability_idx\``, and `CREATE INDEX \`early_access_requests_capability_idx\``. Nothing else.

If the file also contains statements for other tables, the snapshot drifted. Stop and report it; don't edit the SQL by hand.

- [ ] **Step 5: Create `worker/database/services/EarlyAccessService.ts`**

```ts
/** D1 reads and writes for early-access requests. */

import { desc, eq } from 'drizzle-orm';
import * as schema from '../schema';
import { BaseService } from './BaseService';
import { generateId } from '../../utils/idGenerator';
import { isEarlyAccessCapability, type EarlyAccessCapability } from '../../../shared/types/early-access';

export interface EarlyAccessRequestRow {
	capability: EarlyAccessCapability;
	email: string;
	displayName: string;
	createdAt: Date;
}

export class EarlyAccessService extends BaseService {
	/** Records the request once; asking again changes nothing. */
	async request(userId: string, capability: EarlyAccessCapability): Promise<void> {
		await this.database
			.insert(schema.earlyAccessRequests)
			.values({ id: generateId(), userId, capability, createdAt: new Date() })
			.onConflictDoNothing({ target: [schema.earlyAccessRequests.userId, schema.earlyAccessRequests.capability] });
	}

	async listForUser(userId: string): Promise<EarlyAccessCapability[]> {
		const rows = await this.database
			.select({ capability: schema.earlyAccessRequests.capability })
			.from(schema.earlyAccessRequests)
			.where(eq(schema.earlyAccessRequests.userId, userId))
			.all();
		return rows.map((row) => row.capability).filter(isEarlyAccessCapability);
	}

	/** Every request with who asked, newest first; requests for retired programs are left out. */
	async listAll(): Promise<EarlyAccessRequestRow[]> {
		const rows = await this.database
			.select({
				capability: schema.earlyAccessRequests.capability,
				email: schema.users.email,
				displayName: schema.users.displayName,
				createdAt: schema.earlyAccessRequests.createdAt,
			})
			.from(schema.earlyAccessRequests)
			.innerJoin(schema.users, eq(schema.users.id, schema.earlyAccessRequests.userId))
			.orderBy(desc(schema.earlyAccessRequests.createdAt))
			.all();
		return rows.flatMap((row) => (isEarlyAccessCapability(row.capability) ? [{ ...row, capability: row.capability }] : []));
	}
}
```

Then export it from `worker/database/index.ts`, after `export { SitePageService } from './services/SitePageService';`:

```ts
export { EarlyAccessService } from './services/EarlyAccessService';
```

- [ ] **Step 6: Run the test to see it pass**

Run: `rtk proxy npx vitest run worker/database/early-access-schema.test.ts`
Expected: PASS (5 tests). If the `on conflict` SQL differs from the expected text, read the recorded SQL and match its actual form in the test. The behavior to assert is "insert … on conflict … do nothing".

- [ ] **Step 7: Write the failing DTO test** `worker/api/controllers/earlyAccess/earlyAccessDto.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseEarlyAccessRequest, toEarlyAccessAdminData } from './earlyAccessDto';

describe('parseEarlyAccessRequest', () => {
	it('accepts the early-access programs', () => {
		expect(parseEarlyAccessRequest({ capability: 'digital-products' })).toEqual({ ok: true, capability: 'digital-products' });
		expect(parseEarlyAccessRequest({ capability: 'content-creators' })).toEqual({ ok: true, capability: 'content-creators' });
	});

	it('rejects built-in capabilities, unknown ids and malformed bodies', () => {
		for (const body of [{ capability: 'agentic-commerce' }, { capability: 'nope' }, { capability: 3 }, {}, null, 'digital-products']) {
			expect(parseEarlyAccessRequest(body)).toEqual({ ok: false, error: 'Unknown early access program' });
		}
	});
});

describe('toEarlyAccessAdminData', () => {
	it('counts every program, including ones nobody asked for, and keeps the order', () => {
		const data = toEarlyAccessAdminData([
			{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', createdAt: new Date('2026-10-14T10:00:00Z') },
			{ capability: 'content-creators', email: 'bo@example.com', displayName: 'Bo', createdAt: new Date('2026-10-13T10:00:00Z') },
		]);
		expect(data.counts).toEqual({ 'digital-products': 0, 'content-creators': 2 });
		expect(data.requests).toEqual([
			{ capability: 'content-creators', email: 'ana@example.com', displayName: 'Ana', requestedAt: '2026-10-14T10:00:00.000Z' },
			{ capability: 'content-creators', email: 'bo@example.com', displayName: 'Bo', requestedAt: '2026-10-13T10:00:00.000Z' },
		]);
	});
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `rtk proxy npx vitest run worker/api/controllers/earlyAccess/earlyAccessDto.test.ts`
Expected: FAIL. The suite can't resolve `./earlyAccessDto`.

- [ ] **Step 9: Create the types, the DTO, the controller and the routes**

`worker/api/controllers/earlyAccess/types.ts`:

```ts
/** API types for early-access requests. */

import type { EarlyAccessCapability } from '../../../../shared/types/early-access';

export interface MyEarlyAccessData {
    capabilities: EarlyAccessCapability[];
}

export interface EarlyAccessAdminRequest {
    capability: EarlyAccessCapability;
    email: string;
    displayName: string;
    /** ISO timestamp. */
    requestedAt: string;
}

export interface EarlyAccessAdminData {
    counts: Record<EarlyAccessCapability, number>;
    requests: EarlyAccessAdminRequest[];
}
```

`worker/api/controllers/earlyAccess/earlyAccessDto.ts`:

```ts
import { EARLY_ACCESS_CAPABILITIES, isEarlyAccessCapability, type EarlyAccessCapability } from '../../../../shared/types/early-access';
import type { EarlyAccessRequestRow } from '../../../database/services/EarlyAccessService';
import type { EarlyAccessAdminData } from './types';

export type ParsedEarlyAccessRequest = { ok: true; capability: EarlyAccessCapability } | { ok: false; error: string };

/** Accepts only the programs that take requests; built-in capabilities have no waitlist. */
export function parseEarlyAccessRequest(body: unknown): ParsedEarlyAccessRequest {
    const capability = typeof body === 'object' && body !== null && 'capability' in body ? body.capability : undefined;
    return isEarlyAccessCapability(capability) ? { ok: true, capability } : { ok: false, error: 'Unknown early access program' };
}

export function toEarlyAccessAdminData(rows: readonly EarlyAccessRequestRow[]): EarlyAccessAdminData {
    const counts = Object.fromEntries(EARLY_ACCESS_CAPABILITIES.map((id) => [id, 0])) as Record<EarlyAccessCapability, number>;
    for (const row of rows) counts[row.capability] += 1;
    return {
        counts,
        requests: rows.map((row) => ({
            capability: row.capability,
            email: row.email,
            displayName: row.displayName,
            requestedAt: row.createdAt.toISOString(),
        })),
    };
}
```

`worker/api/controllers/earlyAccess/controller.ts`:

```ts
/** Early-access requests: a signed-in user's own, and every request for admins. */

import { BaseController } from '../baseController';
import type { ApiResponse, ControllerResponse } from '../types';
import type { RouteContext } from '../../types/route-context';
import { createLogger } from '../../../logger';
import { EarlyAccessService } from '../../../database';
import { parseEarlyAccessRequest, toEarlyAccessAdminData } from './earlyAccessDto';
import type { EarlyAccessAdminData, MyEarlyAccessData } from './types';

export class EarlyAccessController extends BaseController {
    static logger = createLogger('EarlyAccessController');

    /** Records a request for one program and returns all of the user's requests. */
    static async request(
        request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyEarlyAccessData>>> {
        try {
            const bodyResult = await EarlyAccessController.parseJsonBody<unknown>(request);
            if (!bodyResult.success) {
                return bodyResult.response! as ControllerResponse<ApiResponse<MyEarlyAccessData>>;
            }
            const parsed = parseEarlyAccessRequest(bodyResult.data);
            if (!parsed.ok) {
                return EarlyAccessController.createErrorResponse<MyEarlyAccessData>(parsed.error, 400);
            }
            const service = new EarlyAccessService(env);
            const userId = context.user!.id;
            await service.request(userId, parsed.capability);
            return EarlyAccessController.createSuccessResponse<MyEarlyAccessData>({ capabilities: await service.listForUser(userId) });
        } catch (error) {
            this.logger.error('Error recording an early access request', error);
            return EarlyAccessController.createErrorResponse<MyEarlyAccessData>("Couldn't save your request", 500);
        }
    }

    static async mine(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<MyEarlyAccessData>>> {
        try {
            const capabilities = await new EarlyAccessService(env).listForUser(context.user!.id);
            return EarlyAccessController.createSuccessResponse<MyEarlyAccessData>({ capabilities });
        } catch (error) {
            this.logger.error('Error listing early access requests', error);
            return EarlyAccessController.createErrorResponse<MyEarlyAccessData>("Couldn't load your early access requests", 500);
        }
    }

    static async listAll(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<EarlyAccessAdminData>>> {
        try {
            const rows = await new EarlyAccessService(env).listAll();
            return EarlyAccessController.createSuccessResponse<EarlyAccessAdminData>(toEarlyAccessAdminData(rows));
        } catch (error) {
            this.logger.error('Error listing all early access requests', error);
            return EarlyAccessController.createErrorResponse<EarlyAccessAdminData>("Couldn't load early access requests", 500);
        }
    }
}
```

`worker/api/routes/earlyAccessRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { EarlyAccessController } from '../controllers/earlyAccess/controller';

/** Early-access requests for upcoming programs, and the admin list of who asked. */
export function setupEarlyAccessRoutes(app: Hono<AppEnv>): void {
    app.post('/api/early-access', setAuthLevel(AuthConfig.authenticated), adaptController(EarlyAccessController, EarlyAccessController.request));
    app.get('/api/early-access', setAuthLevel(AuthConfig.authenticated), adaptController(EarlyAccessController, EarlyAccessController.mine));
    app.get('/api/admin/early-access', setAuthLevel(AuthConfig.admin), adaptController(EarlyAccessController, EarlyAccessController.listAll));
}
```

In `worker/api/routes/index.ts`, import the routes with the others:

```ts
import { setupEarlyAccessRoutes } from './earlyAccessRoutes';
```

Then register them right after `setupPaymentsRoutes(app);`:

```ts
    // Early-access requests for upcoming programs
    setupEarlyAccessRoutes(app);
```

In `src/api-types.ts`, next to the `sitePage/types` export:

```ts
export type {
    EarlyAccessAdminData,
    EarlyAccessAdminRequest,
    MyEarlyAccessData,
} from 'worker/api/controllers/earlyAccess/types';
```

- [ ] **Step 10: Write the wiring test** `worker/api/controllers/earlyAccess/early-access-wiring.test.ts`

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/earlyAccessRoutes.ts', '/worker/api/routes/index.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('early access routes', () => {
	const routes = source('/worker/api/routes/earlyAccessRoutes.ts');

	it("lets signed-in users record and read only their own requests", () => {
		expect(routes).toContain("app.post('/api/early-access', setAuthLevel(AuthConfig.authenticated)");
		expect(routes).toContain("app.get('/api/early-access', setAuthLevel(AuthConfig.authenticated)");
	});

	it('shows the full list to admins only', () => {
		expect(routes).toContain("app.get('/api/admin/early-access', setAuthLevel(AuthConfig.admin)");
		expect(routes.split('\n').filter((line) => line.includes("'/api/admin/"))).toHaveLength(1);
	});

	it('is registered with the app', () => {
		expect(source('/worker/api/routes/index.ts')).toContain('setupEarlyAccessRoutes(app);');
	});
});
```

- [ ] **Step 11: Run the worker tests to see them pass**

Run: `rtk proxy npx vitest run worker/database/early-access-schema.test.ts worker/api/controllers/earlyAccess`
Expected: PASS (5 + 3 + 3 tests).

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add worker/database/schema.ts worker/database/index.ts worker/database/services/EarlyAccessService.ts worker/database/early-access-schema.test.ts migrations/0014_*.sql migrations/meta/0014_snapshot.json migrations/meta/_journal.json worker/api/controllers/earlyAccess worker/api/routes/earlyAccessRoutes.ts worker/api/routes/index.ts src/api-types.ts
git commit -m "feat(early-access): store requests per user and program, with an admin list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Early access in the app: hooks, button, admin page and privacy line

**Files:**
- Create:
  - `src/lib/early-access.ts` and `src/lib/early-access.test.ts`;
  - `src/lib/security-error.ts`;
  - `src/hooks/use-early-access.ts`;
  - `src/components/public-site/EarlyAccessButton.tsx`;
  - `src/routes/admin/early-access.tsx`;
  - `src/routes/early-access-guard.test.ts`.
- Modify:
  - `src/lib/api-client.ts`: add the methods after `refreshShowcaseScreenshots`;
  - `src/lib/query-keys.ts`: add `account.earlyAccess`;
  - `src/routes/admin/reviews.tsx`: use `isForbiddenError` and link to the new page;
  - `src/routes.tsx`: add the admin route;
  - `src/content/legal/privacy.md`.

**Interfaces:**
- Consumes:
  - from Task 3: `MyEarlyAccessData` and `EarlyAccessAdminData` (via `@/api-types`);
  - from Task 1: `EarlyAccessCapability`, `isEarlyAccessCapability`, `EARLY_ACCESS_CAPABILITIES` and `CAPABILITIES`.
- Produces:
  - `EarlyAccessButton({ capability: EarlyAccessCapability; variant?: PillVariant; className?: string; listedClassName?: string })`;
  - `useEarlyAccessFromUrl(): void`;
  - `useMyEarlyAccess()`, `useRequestEarlyAccess()` and `useAdminEarlyAccess()`;
  - `EARLY_ACCESS_PARAM`, `earlyAccessReturnUrl(pathname, capability)` and `requestedCapability(search)`;
  - `isForbiddenError(error: unknown): boolean`.

- [ ] **Step 1: Write the failing test** `src/lib/early-access.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EARLY_ACCESS_PARAM, earlyAccessReturnUrl, requestedCapability } from './early-access';

describe('early access return URL', () => {
	it('carries the program through a sign-in that leaves the page', () => {
		expect(EARLY_ACCESS_PARAM).toBe('request');
		expect(earlyAccessReturnUrl('/solutions/digital', 'digital-products')).toBe('/solutions/digital?request=digital-products');
	});

	it('reads back only programs that take requests', () => {
		expect(requestedCapability('?request=content-creators')).toBe('content-creators');
		expect(requestedCapability('?request=agentic-commerce')).toBeNull();
		expect(requestedCapability('?request=')).toBeNull();
		expect(requestedCapability('')).toBeNull();
	});
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `rtk proxy npx vitest run src/lib/early-access.test.ts`
Expected: FAIL. The suite can't resolve `./early-access`.

- [ ] **Step 3: Create `src/lib/early-access.ts`**

```ts
import { isEarlyAccessCapability, type EarlyAccessCapability } from '@/api-types';

/** The query parameter that carries a request through a sign-in that reloads the page (Google, GitHub). */
export const EARLY_ACCESS_PARAM = 'request';

export function earlyAccessReturnUrl(pathname: string, capability: EarlyAccessCapability): string {
	return `${pathname}?${EARLY_ACCESS_PARAM}=${capability}`;
}

/** The program named in the query, or null when there's none or it doesn't take requests. */
export function requestedCapability(search: string): EarlyAccessCapability | null {
	const value = new URLSearchParams(search).get(EARLY_ACCESS_PARAM);
	return isEarlyAccessCapability(value) ? value : null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `rtk proxy npx vitest run src/lib/early-access.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the API client methods.** In `src/lib/api-client.ts`, add `EarlyAccessAdminData`, `EarlyAccessCapability` and `MyEarlyAccessData` to the `@/api-types` import list. Then add after `refreshShowcaseScreenshots()`:

```ts
	async getMyEarlyAccess(): Promise<ApiResponse<MyEarlyAccessData>> {
		return this.request<MyEarlyAccessData>('/api/early-access');
	}

	async requestEarlyAccess(capability: EarlyAccessCapability): Promise<ApiResponse<MyEarlyAccessData>> {
		return this.request<MyEarlyAccessData>('/api/early-access', { method: 'POST', body: { capability } });
	}

	async getAdminEarlyAccess(): Promise<ApiResponse<EarlyAccessAdminData>> {
		return this.request<EarlyAccessAdminData>('/api/admin/early-access');
	}
```

- [ ] **Step 6: Add the query keys.** In `src/lib/query-keys.ts`, inside `account`, after the `payments` block:

```ts
		/** Early-access requests, the user's own and the admin list: never persisted, like the rest of `account`. */
		earlyAccess: {
			all: () => [...queryKeys.account.all, 'early-access'] as const,
			mine: (userId?: string | null) => [...queryKeys.account.earlyAccess.all(), 'mine', userId ?? 'anonymous'] as const,
			admin: () => [...queryKeys.account.earlyAccess.all(), 'admin'] as const,
		},
```

- [ ] **Step 7: Create `src/hooks/use-early-access.ts`**

```ts
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { EarlyAccessCapability } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { apiClient } from '@/lib/api-client';
import { requestedCapability } from '@/lib/early-access';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';

export const EARLY_ACCESS_CONFIRMATION = "You're on the list. We'll email you when it opens.";

export function useMyEarlyAccess() {
	const { user, isAuthenticated } = useAuth();
	return useQuery({
		queryKey: queryKeys.account.earlyAccess.mine(user?.id),
		queryFn: () => unwrap(apiClient.getMyEarlyAccess(), "Couldn't load your early access requests"),
		enabled: isAuthenticated,
		retry: false,
	});
}

export function useRequestEarlyAccess() {
	const queryClient = useQueryClient();
	const { user } = useAuth();
	return useMutation({
		mutationFn: (capability: EarlyAccessCapability) => unwrap(apiClient.requestEarlyAccess(capability), "Couldn't save your request"),
		onSuccess: (data) => queryClient.setQueryData(queryKeys.account.earlyAccess.mine(user?.id), data),
	});
}

export function useAdminEarlyAccess() {
	return useQuery({
		queryKey: queryKeys.account.earlyAccess.admin(),
		queryFn: () => unwrap(apiClient.getAdminEarlyAccess(), "Couldn't load early access requests"),
		retry: false,
	});
}

/** Records a request that a sign-in carried back in the URL, then takes it out of the URL. */
export function useEarlyAccessFromUrl(): void {
	const { isAuthenticated } = useAuth();
	const { pathname, search, hash } = useLocation();
	const navigate = useNavigate();
	const { mutate } = useRequestEarlyAccess();
	const capability = requestedCapability(search);

	useEffect(() => {
		if (!isAuthenticated || !capability) return;
		mutate(capability, {
			onSuccess: () => toast.success(EARLY_ACCESS_CONFIRMATION),
			onError: (error) => toast.error(error.message),
		});
		navigate({ pathname, hash }, { replace: true });
	}, [isAuthenticated, capability, mutate, navigate, pathname, hash]);
}
```

- [ ] **Step 8: Create `src/components/public-site/EarlyAccessButton.tsx`**

```tsx
import { useLocation } from 'react-router';
import { toast } from 'sonner';
import type { EarlyAccessCapability } from '@/api-types';
import { EARLY_ACCESS_CONFIRMATION, useMyEarlyAccess, useRequestEarlyAccess } from '@/hooks/use-early-access';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { earlyAccessReturnUrl } from '@/lib/early-access';
import { cn } from '@/lib/utils';
import { pillClass, type PillVariant } from './primitives';

/**
 * Requests early access to a program. Signed out, it opens sign-up and records the request after sign-in; the
 * return URL carries it through sign-ins that reload the page.
 */
export function EarlyAccessButton({
	capability,
	variant = 'blue',
	className,
	listedClassName,
}: {
	capability: EarlyAccessCapability;
	variant?: PillVariant;
	className?: string;
	/** Text color of "You're on the list", to match the background. */
	listedClassName?: string;
}) {
	const { pathname } = useLocation();
	const { requireAuth } = useAuthGuard();
	const mine = useMyEarlyAccess();
	const { mutate, isPending } = useRequestEarlyAccess();

	if (mine.data?.capabilities.includes(capability)) {
		return (
			<p role="status" className={cn('inline-flex items-center px-2 text-base', listedClassName)}>
				You're on the list
			</p>
		);
	}

	const record = () =>
		mutate(capability, {
			onSuccess: () => toast.success(EARLY_ACCESS_CONFIRMATION),
			onError: (error) => toast.error(error.message),
		});

	return (
		<button
			type="button"
			disabled={isPending}
			className={pillClass(variant, className)}
			onClick={() =>
				requireAuth({
					requireFullAuth: true,
					actionContext: 'to request early access',
					onSuccess: record,
					intendedUrl: earlyAccessReturnUrl(pathname, capability),
				})
			}
		>
			{isPending ? 'Saving…' : 'Request early access'}
		</button>
	);
}
```

- [ ] **Step 9: Extract `isForbiddenError`.** Create `src/lib/security-error.ts`:

```ts
import { SecurityError, SecurityErrorType } from '@/api-types';

/** True for the API's 403, so admin pages can say "Admins only" instead of a load error. */
export function isForbiddenError(error: unknown): boolean {
	return error instanceof SecurityError && error.type === SecurityErrorType.FORBIDDEN;
}
```

In `src/routes/admin/reviews.tsx`:
1. Delete the local `isForbidden` function.
2. Import `isForbiddenError` from `@/lib/security-error`, and replace each `isForbidden(` call with `isForbiddenError(`.
3. Remove `SecurityError` and `SecurityErrorType` from its `@/api-types` import if nothing else there uses them.
4. In the header block, after the description `<p>`, add:

```tsx
					<Link to="/admin/early-access" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Early access requests
					</Link>
```

- [ ] **Step 10: Create `src/routes/admin/early-access.tsx`**

```tsx
import { Link } from 'react-router';
import { Empty, LayerCard, Loader } from '@cloudflare/kumo';
import { pageTitle } from '@/brand';
import { EARLY_ACCESS_CAPABILITIES, type EarlyAccessAdminData } from '@/api-types';
import { useAdminEarlyAccess } from '@/hooks/use-early-access';
import { CAPABILITIES } from '@/lib/capabilities';
import { isForbiddenError } from '@/lib/security-error';

export default function AdminEarlyAccessPage() {
	const requests = useAdminEarlyAccess();

	return (
		<div className="size-full">
			<title>{pageTitle('Early access')}</title>
			<div className="container max-w-5xl mx-auto px-4 py-8 grid gap-6">
				<div className="grid gap-1">
					<Link to="/admin/reviews" className="w-fit text-sm text-kumo-default underline underline-offset-2">
						Reviews
					</Link>
					<h1 className="text-3xl font-semibold text-kumo-strong">Early access</h1>
					<p className="text-kumo-subtle">Who asked to join each upcoming program, newest first.</p>
				</div>
				{requests.data ? (
					<EarlyAccessRequests data={requests.data} />
				) : requests.isLoading ? (
					<div className="flex justify-center py-16">
						<Loader />
					</div>
				) : isForbiddenError(requests.error) ? (
					<Empty title="Admins only" description={requests.error?.message} />
				) : (
					<Empty title="Couldn't load early access requests" description={requests.error?.message} />
				)}
			</div>
		</div>
	);
}

function EarlyAccessRequests({ data }: { data: EarlyAccessAdminData }) {
	return (
		<>
			<div className="grid gap-4 sm:grid-cols-2">
				{EARLY_ACCESS_CAPABILITIES.map((id) => (
					<LayerCard key={id}>
						<LayerCard.Primary>
							<p className="text-sm text-kumo-subtle">{CAPABILITIES[id].name}</p>
							<p className="mt-1 text-3xl font-semibold text-kumo-strong">{data.counts[id]}</p>
						</LayerCard.Primary>
					</LayerCard>
				))}
			</div>
			{data.requests.length === 0 ? (
				<Empty title="No requests yet" description="Requests from the Digital businesses and Content creators pages show up here." />
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<caption className="sr-only">Early access requests, newest first</caption>
						<thead className="text-kumo-subtle">
							<tr>
								<th scope="col" className="py-2 pr-4 font-normal">Program</th>
								<th scope="col" className="py-2 pr-4 font-normal">Name</th>
								<th scope="col" className="py-2 pr-4 font-normal">Email</th>
								<th scope="col" className="py-2 font-normal">Requested</th>
							</tr>
						</thead>
						<tbody>
							{data.requests.map((request) => (
								<tr key={`${request.capability}:${request.email}`} className="border-t border-kumo-line text-kumo-default">
									<td className="py-2.5 pr-4">{CAPABILITIES[request.capability].name}</td>
									<td className="py-2.5 pr-4">{request.displayName}</td>
									<td className="py-2.5 pr-4">{request.email}</td>
									<td className="py-2.5">{new Date(request.requestedAt).toLocaleDateString()}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
```

In `src/routes.tsx`, import `AdminEarlyAccessPage from './routes/admin/early-access'`, and add this after the `admin/reviews` route:

```tsx
					{
						path: 'admin/early-access',
						element: (
							<ProtectedRoute>
								<AdminEarlyAccessPage />
							</ProtectedRoute>
						),
					},
```

- [ ] **Step 11: Add the privacy line.** In `src/content/legal/privacy.md`, set the front matter `version: 2026-10-14`. Then add this paragraph after the "**Marketplace information.**" paragraph in "## 1. What we collect":

```markdown
**Early access requests.** Which upcoming programs you asked to join, and when.
```

- [ ] **Step 12: Write the guard** `src/routes/early-access-guard.test.ts`

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/public-site/EarlyAccessButton.tsx',
		'/src/hooks/use-early-access.ts',
		'/src/routes/admin/early-access.tsx',
		'/src/routes/admin/reviews.tsx',
		'/src/routes.tsx',
		'/src/lib/api-client.ts',
		'/src/content/legal/privacy.md',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('early access in the app', () => {
	it('asks signed-out visitors to sign up, records after sign-in, and survives a sign-in that reloads the page', () => {
		const button = source('/src/components/public-site/EarlyAccessButton.tsx');
		expect(button).toContain('requireAuth({');
		expect(button).toContain('onSuccess: record');
		expect(button).toContain('intendedUrl: earlyAccessReturnUrl(pathname, capability)');
		expect(button).toContain("You're on the list");
		expect(source('/src/hooks/use-early-access.ts')).toContain('navigate({ pathname, hash }, { replace: true });');
	});

	it('calls the three endpoints', () => {
		const client = source('/src/lib/api-client.ts');
		expect(client).toContain("'/api/early-access', { method: 'POST', body: { capability } }");
		expect(client).toContain("this.request<MyEarlyAccessData>('/api/early-access')");
		expect(client).toContain("'/api/admin/early-access'");
	});

	it('shows admins the list behind sign-in, and tells everyone else it is for admins', () => {
		const routes = source('/src/routes.tsx');
		expect(routes).toMatch(/path: 'admin\/early-access',\s*element: \(\s*<ProtectedRoute>/);
		const page = source('/src/routes/admin/early-access.tsx');
		expect(page).toContain('isForbiddenError(requests.error)');
		expect(page).toContain('title="Admins only"');
		expect(source('/src/routes/admin/reviews.tsx')).toContain('to="/admin/early-access"');
	});

	it('tells people in the privacy policy that requests are kept', () => {
		const privacy = source('/src/content/legal/privacy.md');
		expect(privacy).toContain('version: 2026-10-14');
		expect(privacy).toContain('**Early access requests.**');
	});
});
```

- [ ] **Step 13: Run the tests**

Run: `rtk proxy npx vitest run src/lib/early-access.test.ts src/routes/early-access-guard.test.ts src/content/legal src/lib/query-keys.test.ts src/routes/reviews-guard.test.ts`
Expected: PASS. If `reviews-guard.test.ts` asserts the old local `isForbidden(`, update that assertion to `isForbiddenError(` and leave its intent unchanged.

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 14: Commit**

```bash
git add src/lib/early-access.ts src/lib/early-access.test.ts src/lib/security-error.ts src/hooks/use-early-access.ts src/components/public-site/EarlyAccessButton.tsx src/routes/admin/early-access.tsx src/routes/admin/reviews.tsx src/routes.tsx src/lib/api-client.ts src/lib/query-keys.ts src/content/legal/privacy.md src/routes/early-access-guard.test.ts src/routes/reviews-guard.test.ts
git commit -m "feat(early-access): request button, admin list and the privacy line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Navigation: Solutions and For creators menus, footer and announcement

**Files:**
- Create: `src/lib/site-nav.ts`, `src/components/layout/NavMenu.tsx`
- Modify:
  - `src/components/layout/PublicTopBar.tsx`, replaced in full;
  - `src/components/layout/AnnouncementBar.tsx`: the link target;
  - `src/components/layout/SiteFooter.tsx`: `LINK_COLUMNS`;
  - `src/components/layout/public-chrome-guard.test.ts`;
  - `src/routes/public-pages-guard.test.ts`.

**Interfaces:**
- Consumes:
  - from Task 1: `CAPABILITIES`, `PLATFORM_CAPABILITIES` and `CapabilityTag`;
  - `pillClass` and `preferredScrollBehavior` from the primitives.
- Produces:
  - `NavItem { to; label; description; capability?: CapabilityId }`;
  - `AUDIENCES`, `CREATOR_ITEMS` and `CREATORS_CAPTION` (from `@/lib/site-nav`);
  - `MenuId`, `SolutionsMenuPanel({ id })`, `CreatorsMenuPanel({ id })` and `MobileMenuGroups()`.

- [ ] **Step 1: Update the guards first (failing).** In `src/components/layout/public-chrome-guard.test.ts`:

In "announces Discover with the fee…", replace `expect(bar).toContain('to="/#creators"');` with:

```ts
		expect(bar).toContain('to="/creators/developers"');
```

In "shows the announcement above a white top bar…", replace `expect(top).toContain('hidden sm:flex');` (or `'hidden md:flex'`) with `expect(top).toContain('hidden lg:flex');`. Then replace `expect(top).toContain("to: '/#creators'");` with:

```ts
		expect(top).toContain('<SolutionsMenuPanel');
		expect(top).toContain('<CreatorsMenuPanel');
		expect(top).toContain('<MobileMenuGroups />');
```

Replace the whole test "keeps the bar on one line: links move to the menu below md…" with:

```ts
	it('keeps the bar on one line: the menus and links move to the menu below lg, and nothing in the bar wraps', () => {
		const top = source(TOP);
		expect(top).toMatch(/<nav aria-label="Main" className="hidden lg:flex [^"]*whitespace-nowrap/);
		expect(top).toContain('<div className="flex items-center gap-4 whitespace-nowrap">');
		expect(top).toContain('rounded-full p-2 text-public-charcoal lg:hidden');
		expect(top).toMatch(/id="public-menu"[^>]*lg:hidden/);
		expect(top).toContain("pillClass('blue', 'mt-3 w-full sm:hidden')");
	});

	it('opens one menu panel at a time, closes it on Escape, a click outside or navigation, and returns focus', () => {
		const top = source(TOP);
		expect(top).toContain('aria-expanded={openPanel === menu.id}');
		expect(top).toContain('aria-controls={`menu-${menu.id}`}');
		expect(top).toContain("event.key !== 'Escape'");
		expect(top).toContain('triggerRefs.current[openPanel]?.focus();');
		expect(top).toContain("document.addEventListener('pointerdown', onPointerDown);");
		expect(top).toMatch(/setOpenPanel\(null\);\s*\}, \[pathname, hash, key\]\);/);
	});

	it('builds the menus from the registry, so a launch removes its tag everywhere', () => {
		const nav = source(NAV);
		expect(nav).toContain('PLATFORM_CAPABILITIES.map');
		expect(nav).toContain('<CapabilityTag');
		expect(nav).toContain('AUDIENCES.map');
		expect(nav).toContain('CREATOR_ITEMS.map');
		expect(nav).not.toContain('<ComingSoon');
	});
```

Add `'/src/components/layout/NavMenu.tsx'` to the `import.meta.glob` list, and add the constant `const NAV = '/src/components/layout/NavMenu.tsx';`.

In "ends every public page with the dark footer…", replace `"to: '/#creators'"` in the list with `"to: '/creators/developers'"`.

In `src/routes/public-pages-guard.test.ts`, replace `toContain('hidden md:flex')` with `toContain('hidden lg:flex')`.

Run: `rtk proxy npx vitest run src/components/layout/public-chrome-guard.test.ts src/routes/public-pages-guard.test.ts`
Expected: FAIL on the new and changed assertions.

- [ ] **Step 2: Create `src/lib/site-nav.ts`**

```ts
import type { CapabilityId } from './capabilities';

export interface NavItem {
	to: string;
	label: string;
	description: string;
	/** Shows this capability's status tag next to the item. */
	capability?: CapabilityId;
}

/** The Solutions menu's "Estori for" column. */
export const AUDIENCES: readonly NavItem[] = [
	{ to: '/solutions/brands', label: 'Brands and store owners', description: 'Build, sell everywhere, run with agents' },
	{ to: '/solutions/resellers', label: 'Dropshippers and resellers', description: 'Curated products, added in a few clicks', capability: 'product-catalog' },
	{ to: '/solutions/digital', label: 'Digital businesses', description: 'Sell e-books, images and videos, and run your community', capability: 'digital-products' },
];

export const CREATORS_CAPTION = 'Take part in Estori without running a store.';

export const CREATOR_ITEMS: readonly NavItem[] = [
	{ to: '/creators/developers', label: 'Developers', description: 'Build stores, sell them as templates in Discover', capability: 'developer-templates' },
	{ to: '/creators/content', label: 'Content creators', description: "Get paid promoting merchants' products with your link or store", capability: 'content-creators' },
];
```

- [ ] **Step 3: Create `src/components/layout/NavMenu.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { CAPABILITIES, PLATFORM_CAPABILITIES } from '@/lib/capabilities';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION, type NavItem } from '@/lib/site-nav';

export type MenuId = 'solutions' | 'creators';

const PANEL = 'absolute inset-x-0 top-full border-b border-public-line bg-white shadow-[0_24px_40px_rgba(0,0,0,0.08)]';
const COLUMN_TITLE = 'px-3 text-xs uppercase tracking-[0.02em] text-public-ink/80';
const ITEM = 'block rounded-lg px-3 py-2.5 text-public-ink hover:bg-[#f4f4f5] focus-visible:outline-2 focus-visible:outline-public-blue';

/** `showTag={false}` for the audience column: audiences aren't capabilities; the Platform column carries the tags. */
function DescribedLink({ item, showTag = true }: { item: NavItem; showTag?: boolean }) {
	return (
		<Link to={item.to} className={ITEM}>
			<span className="flex flex-wrap items-center gap-2 text-[15px]">
				{item.label}
				{showTag && item.capability && <CapabilityTag id={item.capability} />}
			</span>
			<span className="mt-0.5 block text-sm font-light text-public-muted">{item.description}</span>
		</Link>
	);
}

function Column({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<p className={COLUMN_TITLE}>{title}</p>
			<ul className="mt-3 grid gap-1">{children}</ul>
		</div>
	);
}

/** 1Password's Business panel, Estori-style: who it's for, then the platform with each capability's status. */
export function SolutionsMenuPanel({ id }: { id: string }) {
	return (
		<div id={id} className={PANEL}>
			<div className="mx-auto grid max-w-[1248px] gap-10 px-6 py-8 lg:grid-cols-2">
				<Column title="Estori for">
					{AUDIENCES.map((item) => (
						<li key={item.to}>
							<DescribedLink item={item} showTag={false} />
						</li>
					))}
				</Column>
				<Column title="Platform">
					{PLATFORM_CAPABILITIES.map((capabilityId) => {
						const capability = CAPABILITIES[capabilityId];
						return (
							<li key={capabilityId}>
								<Link to={capability.path} className={`${ITEM} flex items-center justify-between gap-4 text-[15px]`}>
									{capability.name}
									<CapabilityTag id={capabilityId} />
								</Link>
							</li>
						);
					})}
				</Column>
			</div>
		</div>
	);
}

export function CreatorsMenuPanel({ id }: { id: string }) {
	return (
		<div id={id} className={PANEL}>
			<div className="mx-auto max-w-[1248px] px-6 py-8">
				<p className="px-3 text-sm font-light text-public-muted">{CREATORS_CAPTION}</p>
				<ul className="mt-3 grid gap-1 lg:grid-cols-2">
					{CREATOR_ITEMS.map((item) => (
						<li key={item.to}>
							<DescribedLink item={item} />
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function MobileGroup({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="py-2">
			<p className="py-1 text-xs uppercase tracking-[0.02em] text-public-ink/80">{title}</p>
			<ul className="grid">{children}</ul>
		</div>
	);
}

const MOBILE_LINK = 'flex flex-wrap items-center gap-2 py-2 text-lg text-public-charcoal';

/** The same groups as the desktop panels, stacked for the phone menu. */
export function MobileMenuGroups() {
	return (
		<>
			<MobileGroup title="Solutions">
				{AUDIENCES.map((item) => (
					<li key={item.to}>
						<Link to={item.to} className={MOBILE_LINK}>
							{item.label}
						</Link>
					</li>
				))}
			</MobileGroup>
			<MobileGroup title="Platform">
				{PLATFORM_CAPABILITIES.map((capabilityId) => (
					<li key={capabilityId}>
						<Link to={CAPABILITIES[capabilityId].path} className={MOBILE_LINK}>
							{CAPABILITIES[capabilityId].name}
							<CapabilityTag id={capabilityId} />
						</Link>
					</li>
				))}
			</MobileGroup>
			<MobileGroup title="For creators">
				{CREATOR_ITEMS.map((item) => (
					<li key={item.to}>
						<Link to={item.to} className={MOBILE_LINK}>
							{item.label}
							{item.capability && <CapabilityTag id={item.capability} />}
						</Link>
					</li>
				))}
			</MobileGroup>
		</>
	);
}
```

`AUDIENCES`' `capability` field is used by the landing page's sellers band (Task 9). The menu's audience column hides it with `showTag={false}`.

- [ ] **Step 4: Replace `src/components/layout/PublicTopBar.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CaretDownIcon, ListIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { pillClass, preferredScrollBehavior } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';
import { AnnouncementBar } from './AnnouncementBar';
import { CreatorsMenuPanel, MobileMenuGroups, SolutionsMenuPanel, type MenuId } from './NavMenu';

const MENUS: ReadonlyArray<{ id: MenuId; label: string }> = [
	{ id: 'solutions', label: 'Solutions' },
	{ id: 'creators', label: 'For creators' },
];

const NAV_LINKS = [
	{ to: '/discover', label: 'Discover' },
	{ to: '/pricing', label: 'Pricing' },
] as const;

/** Top of every public page: the gold announcement, then a white bar with the brand, the menus, sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname, hash, key } = useLocation();
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(false);
	const [openPanel, setOpenPanel] = useState<MenuId | null>(null);
	const headerRef = useRef<HTMLElement>(null);
	const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({});

	useEffect(() => {
		setMenuOpen(false);
		setOpenPanel(null);
	}, [pathname, hash, key]);

	// An open panel closes on Escape, returning focus to its trigger, and on a click outside the header.
	useEffect(() => {
		if (!openPanel) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			setOpenPanel(null);
			triggerRefs.current[openPanel]?.focus();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && headerRef.current?.contains(event.target)) return;
			setOpenPanel(null);
		};
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown);
		};
	}, [openPanel]);

	const startBuilding = () => {
		setMenuOpen(false);
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header ref={headerRef} className="sticky top-0 z-40">
			<AnnouncementBar />
			<div className="relative border-b border-public-line bg-white">
				<div className="mx-auto flex h-16 max-w-[1248px] items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
					<div className="flex items-center gap-8">
						<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-public-brand">
							<EstoriLogo className="h-7 w-auto" />
						</Link>
						<nav aria-label="Main" className="hidden lg:flex items-center gap-6 whitespace-nowrap text-[15px] text-public-charcoal">
							{MENUS.map((menu) => (
								<button
									key={menu.id}
									ref={(node) => {
										triggerRefs.current[menu.id] = node;
									}}
									type="button"
									aria-expanded={openPanel === menu.id}
									aria-controls={`menu-${menu.id}`}
									onClick={() => setOpenPanel((open) => (open === menu.id ? null : menu.id))}
									className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
								>
									{menu.label}
									<CaretDownIcon
										className={cn('size-3.5 transition-transform motion-reduce:transition-none', openPanel === menu.id && 'rotate-180')}
										aria-hidden
									/>
								</button>
							))}
							{NAV_LINKS.map((link) => (
								<Link key={link.to} to={link.to} className="underline-offset-4 hover:underline">
									{link.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-4 whitespace-nowrap">
						{isAuthenticated ? (
							<Link to="/" className="text-[15px] text-public-charcoal underline-offset-4 hover:underline">
								Open app
							</Link>
						) : (
							<button type="button" onClick={() => showAuthModal()} className="text-[15px] text-public-charcoal underline-offset-4 hover:underline">
								Sign in
							</button>
						)}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'hidden sm:inline-flex')}>
							Start building free
						</button>
						<button
							type="button"
							className="rounded-full p-2 text-public-charcoal lg:hidden"
							aria-expanded={menuOpen}
							aria-controls="public-menu"
							aria-label={menuOpen ? 'Close menu' : 'Open menu'}
							onClick={() => setMenuOpen((open) => !open)}
						>
							{menuOpen ? <XIcon className="size-6" aria-hidden /> : <ListIcon className="size-6" aria-hidden />}
						</button>
					</div>
				</div>
				{openPanel === 'solutions' && <SolutionsMenuPanel id="menu-solutions" />}
				{openPanel === 'creators' && <CreatorsMenuPanel id="menu-creators" />}
				{menuOpen && (
					<nav
						id="public-menu"
						aria-label="Main"
						className="grid max-h-[calc(100dvh-7.5rem)] gap-1 overflow-y-auto border-t border-public-line px-4 py-4 sm:px-6 lg:hidden"
					>
						<MobileMenuGroups />
						{NAV_LINKS.map((link) => (
							<Link key={link.to} to={link.to} className="py-2 text-lg text-public-charcoal">
								{link.label}
							</Link>
						))}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'mt-3 w-full sm:hidden')}>
							Start building free
						</button>
					</nav>
				)}
			</div>
		</header>
	);
}
```

- [ ] **Step 5: Point the announcement and the footer at the new pages**

In `src/components/layout/AnnouncementBar.tsx`, change `to="/#creators"` to `to="/creators/developers"`.

In `src/components/layout/SiteFooter.tsx`, replace `LINK_COLUMNS` with:

```ts
const LINK_COLUMNS = [
	{
		title: 'Solutions',
		links: [
			{ to: '/solutions/brands', label: 'Brands' },
			{ to: '/solutions/resellers', label: 'Resellers' },
			{ to: '/solutions/digital', label: 'Digital businesses' },
			{ to: '/agentic-commerce', label: 'Agentic commerce' },
			{ to: '/pricing', label: 'Pricing' },
		],
	},
	{
		title: 'For creators',
		links: [
			{ to: '/creators/developers', label: 'Developers' },
			{ to: '/creators/content', label: 'Content creators' },
			{ to: '/discover', label: 'Discover' },
		],
	},
] as const;
```

- [ ] **Step 6: Run the guards to see them pass**

Run: `rtk proxy npx vitest run src/components/layout src/routes/public-pages-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/site-nav.ts src/components/layout/NavMenu.tsx src/components/layout/PublicTopBar.tsx src/components/layout/AnnouncementBar.tsx src/components/layout/SiteFooter.tsx src/components/layout/public-chrome-guard.test.ts src/routes/public-pages-guard.test.ts
git commit -m "feat(public): Solutions and For creators menus in 1Password's style

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Page blocks, positioning copy and copy rules

**Files:**
- Create:
  - `src/content/positioning.ts`;
  - `src/components/public-site/solution-page.tsx`;
  - `src/components/public-site/capability-sections.tsx`;
  - `src/components/public-site/PlanPrice.tsx`;
  - `src/routes/copy-rules.ts`;
  - `src/routes/positioning-copy-guard.test.ts`.
- Modify:
  - `src/components/public-site/PublicFaq.tsx`: an `items` prop, and the updated default list;
  - `src/routes/landing/sections.tsx`: `ClosingPanel` links to `/#build`;
  - `src/routes/landing-guard.test.ts`: import `COMPETITORS` from `copy-rules`, and the updated FAQ question list.

**Interfaces:**
- Consumes: from Tasks 1, 2 and 5: `CapabilityTag`, `CAPABILITIES`, `Plan`, `formatPlanPrice` and `NavItem`.
- Produces:
  - the copy types `CardCopy { title; body }` and `FaqItem { question: string; answer: ReactNode }`;
  - the copy constants:
    - `AGENTIC_COMMERCE_SUMMARY`, `TODAY_CARDS`, `OPERATIONS_CARDS`, `PERSONALIZATION_CARDS`;
    - `AGENTIC_BASICS_CARDS`, `AGENT_READY_CARDS`, `CATALOG_CARDS`;
    - `DIGITAL_PRODUCT_CARDS`, `COMMUNITY_CARDS`, `CONTENT_CREATOR_CARDS`;
    - `BRAND_STEPS`, `RESELLER_STEPS`, `DIGITAL_STEPS`, `DEVELOPER_STEPS`, `CONTENT_STEPS`;
    - `BRAND_FAQ`, `RESELLER_FAQ`, `DIGITAL_FAQ`, `AGENTIC_FAQ`, `DEVELOPER_FAQ`, `CONTENT_FAQ`;
  - the page blocks `PageMeta`, `SolutionHero`, `CardSection`, `HowItWorks` and `LinkCard`;
  - the capability sections `AgenticCommerceSection({ id? })`, `OperationsSection({ id? })` and `PersonalizationSection({ id? })`;
  - `PlanPrice({ plan, className? })`;
  - `PublicFaq({ items? })` and `LAUNCH_FAQ`;
  - `COMPETITORS` and `AI_ASSISTANT_NAMES`.

- [ ] **Step 1: Create `src/routes/copy-rules.ts`** and point the landing guard at it

```ts
/** Names the public pages must never contain, lowercase. */
export const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'] as const;

/** AI assistants and their makers: naming them would imply integrations that don't exist. */
export const AI_ASSISTANT_NAMES = ['chatgpt', 'openai', 'gemini', 'copilot', 'anthropic', 'claude', 'perplexity', 'google'] as const;
```

In `src/routes/landing-guard.test.ts`, delete the local `const COMPETITORS = [...]` and add `import { COMPETITORS } from './copy-rules';`.

- [ ] **Step 2: Write the failing copy guard** `src/routes/positioning-copy-guard.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, COMPETITORS } from './copy-rules';

const pages = import.meta.glob<string>(
	[
		'/src/routes/landing/*.tsx',
		'/src/routes/solutions/*.tsx',
		'/src/routes/creators/*.tsx',
		'/src/routes/agentic-commerce.tsx',
		'/src/routes/pricing.tsx',
		'/src/components/public-site/*.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/NavMenu.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/content/positioning.ts',
		'/src/lib/site-nav.ts',
		'/src/lib/capabilities.ts',
		'/src/lib/plans.ts',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const all = Object.values(pages).join('\n');

describe('positioning copy rules', () => {
	it('names no competitor and no AI assistant or its maker', () => {
		const lower = all.toLowerCase();
		for (const name of [...COMPETITORS, ...AI_ASSISTANT_NAMES]) expect(lower, name).not.toContain(name);
	});

	it('names the standards only as the open agentic commerce standards, never as "the standard"', () => {
		const mentions = all.match(/UCP and ACP/g) ?? [];
		const proper = all.match(/open agentic commerce standards \(UCP and ACP\)/g) ?? [];
		expect(mentions.length).toBeGreaterThan(0);
		expect(proper.length).toBe(mentions.length);
		expect(all).not.toMatch(/\bthe (agentic commerce )?standard\b/i);
	});

	it('states the explainer copy for agentic commerce in one place', () => {
		const copy = pages['/src/content/positioning.ts'];
		expect(copy).toContain('export const AGENTIC_COMMERCE_SUMMARY');
		expect(copy).toContain('open agentic commerce standards (UCP and ACP)');
	});
});
```

Run: `rtk proxy npx vitest run src/routes/positioning-copy-guard.test.ts`
Expected: FAIL. `positioning.ts` doesn't exist yet, so the third test fails, and so does the `toBeGreaterThan(0)` check.

- [ ] **Step 3: Create `src/content/positioning.ts`.** This is the page copy; use it verbatim.

```ts
import type { ReactNode } from 'react';
import { PLATFORM_FEE_LABEL } from '@/api-types';

export interface CardCopy {
	title: string;
	body: string;
}

export interface FaqItem {
	question: string;
	answer: ReactNode;
}

export const AGENTIC_COMMERCE_SUMMARY =
	'Shoppers increasingly ask AI assistants what to buy. Every Estori store will publish its catalog and checkout in the open agentic commerce standards (UCP and ACP), so assistants can find your products, answer questions about them and complete the purchase, with you as the seller.';

export const TODAY_CARDS: readonly CardCopy[] = [
	{ title: 'A complete store from a sentence', body: 'Catalog, product pages, cart, checkout flow and order records, built and deployed from your description.' },
	{ title: 'Edit by chatting', body: 'Ask for changes in plain words and watch the live preview update.' },
	{ title: 'Desktop and phone', body: 'Every store works on both, and you preview it live on each.' },
];

export const OPERATIONS_CARDS: readonly CardCopy[] = [
	{ title: 'Merchandising', body: 'Collections, featured products and prices stay in order as your catalog changes.' },
	{ title: 'Stock alerts', body: 'A warning before a best-seller runs out, with a suggested reorder.' },
	{ title: 'Order follow-ups', body: 'Shipping updates and review requests go out on time.' },
	{ title: 'Customer replies', body: "Questions about orders, sizes and returns get answers from your store's own information." },
	{ title: 'Visibility in AI answers', body: 'Product pages written and structured so AI answers can cite your store.' },
];

export const PERSONALIZATION_CARDS: readonly CardCopy[] = [
	{ title: 'Recommendations', body: 'Each shopper sees products that fit what they browse and buy.' },
	{ title: 'Smart cart', body: 'The cart suggests what goes well with what is already in it.' },
	{ title: 'Bundles', body: 'Products that sell together are offered together.' },
	{ title: 'Post-purchase offers', body: 'A relevant offer right after checkout, while the shopper is still with you.' },
	{ title: 'AI search', body: 'Shoppers describe what they want and find it, even without the exact words.' },
];

export const AGENTIC_BASICS_CARDS: readonly CardCopy[] = [
	{ title: 'Shoppers ask, assistants act', body: 'A shopper describes what they need, and an AI assistant finds products, compares them and can complete the purchase.' },
	{ title: 'Open standards', body: 'The open agentic commerce standards (UCP and ACP) define how stores share their catalog and checkout with assistants.' },
	{ title: 'You stay the seller', body: 'Orders, payments and the customer relationship stay with your store.' },
];

export const AGENT_READY_CARDS: readonly CardCopy[] = [
	{ title: 'A clean product feed', body: 'Prices, stock, shipping and policies kept current for assistants to read.' },
	{ title: 'Checkout assistants can use', body: 'Cart and checkout endpoints described the way the standards expect.' },
	{ title: 'Verified agents', body: 'Requests from shopping agents are verified before they are trusted.' },
	{ title: 'Secure payment tokens', body: 'Assistants pay with tokens, never with raw card numbers.' },
];

export const CATALOG_CARDS: readonly CardCopy[] = [
	{ title: 'Vetted suppliers', body: 'Every supplier is reviewed for product quality and shipping times before joining.' },
	{ title: 'Added in a few clicks', body: 'Pick products and they arrive in your store with photos, descriptions and prices you can adjust.' },
	{ title: 'The supplier ships', body: "Orders go to the supplier, who ships to your customer under your store's name." },
	{ title: 'You keep the margin', body: "You set your price, and the difference over the supplier's cost is yours." },
];

export const DIGITAL_PRODUCT_CARDS: readonly CardCopy[] = [
	{ title: 'E-books and guides', body: 'Sell what you know as downloads your customers get right after paying.' },
	{ title: 'Images and design assets', body: 'Photos, illustrations and templates, delivered as files.' },
	{ title: 'Videos and courses', body: 'Lessons and video content, organized for your customers.' },
];

export const COMMUNITY_CARDS: readonly CardCopy[] = [
	{ title: 'A members-only space', body: 'A place for your customers to talk with you and each other.' },
	{ title: 'Updates and drops', body: 'Announce new products and content to the people who care most.' },
	{ title: 'Your customers, in one place', body: 'Your store and your community share one list of customers.' },
];

export const CONTENT_CREATOR_CARDS: readonly CardCopy[] = [
	{ title: 'Your own link', body: 'Share a personal link in your videos, posts and newsletters.' },
	{ title: 'Or your own store', body: 'Gather the products you recommend in a store built with Estori.' },
	{ title: 'A commission per sale', body: 'Each merchant sets the commission for their products.' },
	{ title: 'Clear reporting', body: 'Clicks, sales and earnings in one place.' },
];

export const BRAND_STEPS = [
	'Describe your brand and what you sell.',
	'Watch Estori build the store, then refine it by chat.',
	'Preview it on desktop and phone, and share it when it is ready.',
] as const;

export const RESELLER_STEPS = ['Apply to the catalog.', 'Choose products and set your prices.', 'Sell, and the supplier ships each order.'] as const;

export const DIGITAL_STEPS = [
	'Request early access.',
	'Build your store with Estori.',
	'Add your digital products and open your community when it launches.',
] as const;

export const DEVELOPER_STEPS = [
	'Build a store with Estori.',
	'Publish it to Discover and set a price. An Estori admin reviews it.',
	'Earn when someone starts from it: buyers pay through Stripe and you receive the rest.',
] as const;

export const CONTENT_STEPS = ['Request early access.', 'Choose merchants and products to promote.', 'Share your link or store, and earn per sale.'] as const;

const PAYMENTS_ANSWER = 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.';

export const BRAND_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to code?', answer: 'No. You describe your store and ask for changes in plain words.' },
	{ question: 'What can I use today?', answer: 'Building, editing and previewing complete stores. Everything marked Coming soon is on the way.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
	{ question: 'What does Coming soon mean?', answer: "A capability we're building. It isn't part of Estori until it launches, and its details may change before then." },
];

export const RESELLER_FAQ: readonly FaqItem[] = [
	{ question: 'When does the catalog open?', answer: "It's coming soon. You can build your store now and add products when it opens." },
	{ question: 'Who handles shipping?', answer: 'The supplier ships each order directly to your customer.' },
	{ question: 'Can I set my own prices?', answer: 'Yes. You choose your price, and the margin over the supplier is yours.' },
	{ question: 'Can my store take payments?', answer: PAYMENTS_ANSWER },
];

export const DIGITAL_FAQ: readonly FaqItem[] = [
	{ question: 'Is this available yet?', answer: "Not yet. It's in early access: request it and we'll email you when you can start." },
	{ question: 'Why do I need an account to request it?', answer: 'Your request is saved to your Estori account, so we know where to reach you when it opens.' },
	{ question: 'Can I build my store now?', answer: 'Yes. Store building works today, and your store will be ready for digital products when they launch.' },
];

export const AGENTIC_FAQ: readonly FaqItem[] = [
	{ question: 'Which AI assistants will Estori stores work with?', answer: 'Any assistant that supports the open agentic commerce standards (UCP and ACP).' },
	{ question: 'Do I need to set anything up?', answer: 'No. When it launches, it comes with every Estori store.' },
	{ question: 'Is it available yet?', answer: "Not yet. It's coming soon to every Estori store." },
];

export const DEVELOPER_FAQ: readonly FaqItem[] = [
	{ question: 'What does Estori charge?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{ question: 'What do I need to sell?', answer: 'A Stripe account, and you must be 18 or older.' },
	{ question: 'Can buyers resell my store?', answer: "No. A buyer gets their own copy for their own business, and it can't be republished or resold." },
];

export const CONTENT_FAQ: readonly FaqItem[] = [
	{ question: 'Do I need to run a store?', answer: 'No. You can promote merchants with your own link. A store of your own is optional.' },
	{ question: 'How much can I earn?', answer: "Each merchant sets its commission. Estori's share is announced when the program launches." },
	{ question: 'Is it available yet?', answer: "Not yet. It's in early access: request it and we'll email you when it opens." },
];
```

- [ ] **Step 4: Create `src/components/public-site/solution-page.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { pageTitle } from '@/brand';
import { BlurFade } from '@/components/magicui/blur-fade';
import type { CardCopy } from '@/content/positioning';
import type { CapabilityId } from '@/lib/capabilities';
import type { NavItem } from '@/lib/site-nav';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, PillLink } from './primitives';

export function PageMeta({ title, description }: { title: string; description: string }) {
	return (
		<>
			<title>{pageTitle(title)}</title>
			<meta name="description" content={description} />
		</>
	);
}

/** 1Password's solution hero on charcoal: eyebrow and status, headline, lead and actions. */
export function SolutionHero({
	eyebrow,
	title,
	lead,
	tag,
	actions,
}: {
	eyebrow: string;
	title: string;
	lead: string;
	tag?: CapabilityId;
	actions?: ReactNode;
}) {
	return (
		<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
			<div className="flex flex-wrap items-center justify-center gap-3">
				<Eyebrow tone="dark">{eyebrow}</Eyebrow>
				{tag && <CapabilityTag id={tag} tone="dark" />}
			</div>
			<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-4xl text-balance')}>{title}</h1>
			<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-pretty text-white/80')}>{lead}</p>
			<div className="mt-10 flex flex-wrap items-center justify-center gap-3">
				{actions ?? (
					<PillLink to="/#build" variant="white">
						Start building free
					</PillLink>
				)}
			</div>
		</section>
	);
}

/** A titled section of value cards; `id` makes it a link target below the sticky top bar. */
export function CardSection({
	id,
	eyebrow,
	title,
	lead,
	tag,
	cards,
	children,
}: {
	id?: string;
	eyebrow?: string;
	title: string;
	lead?: string;
	tag?: CapabilityId;
	cards: readonly CardCopy[];
	children?: ReactNode;
}) {
	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto max-w-[1248px]">
				{(eyebrow || tag) && (
					<div className="flex flex-wrap items-center gap-3">
						{eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
						{tag && <CapabilityTag id={tag} />}
					</div>
				)}
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>{title}</h2>
				{lead && <p className={cn(LEAD, 'mt-5 max-w-2xl text-pretty text-public-muted')}>{lead}</p>}
				<div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{cards.map((card) => (
						<article key={card.title} className="rounded-[24px] p-7 ring ring-public-line">
							<h3 className={cn(HEADING_CARD, 'text-public-ink')}>{card.title}</h3>
							<p className="mt-3 text-[15px] leading-relaxed font-light text-public-muted">{card.body}</p>
						</article>
					))}
				</div>
				{children && <div className="mt-10 flex flex-wrap items-center gap-4">{children}</div>}
			</BlurFade>
		</section>
	);
}

export function HowItWorks({ steps }: { steps: readonly string[] }) {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow>How it works</Eyebrow>
				<ol className="mt-8 grid gap-4 md:grid-cols-3">
					{steps.map((step, index) => (
						<li key={step} className="rounded-[24px] bg-public-charcoal p-7 text-white">
							<span className="text-sm text-white/70">Step {index + 1}</span>
							<p className="mt-3 text-xl leading-snug font-light">{step}</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}

/** An audience or program card that links to its page, with its status tag. */
export function LinkCard({ item }: { item: NavItem }) {
	return (
		<Link
			to={item.to}
			className="group block rounded-[24px] p-7 ring ring-public-line transition-colors hover:bg-[#f7f7f8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-public-blue"
		>
			<span className="flex flex-wrap items-center gap-2">
				<span className={cn(HEADING_CARD, 'text-public-ink')}>{item.label}</span>
				{item.capability && <CapabilityTag id={item.capability} />}
			</span>
			<span className="mt-3 block text-[15px] font-light text-public-muted">{item.description}</span>
			<span className="mt-6 inline-block text-[15px] text-public-ink underline decoration-1 underline-offset-[5px] group-hover:decoration-2">Learn more</span>
		</Link>
	);
}
```

- [ ] **Step 5: Create `src/components/public-site/capability-sections.tsx`**

```tsx
import { useRef, type Ref } from 'react';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { AGENTIC_COMMERCE_SUMMARY, OPERATIONS_CARDS, PERSONALIZATION_CARDS } from '@/content/positioning';
import { cn } from '@/lib/utils';
import { CapabilityTag } from './CapabilityTag';
import { Eyebrow, HEADING_SECTION, LEAD, TextLink } from './primitives';
import { CardSection } from './solution-page';

function DiagramNode({ ref, label }: { ref: Ref<HTMLDivElement>; label: string }) {
	return (
		<div ref={ref} className="relative z-10 rounded-[14px] bg-white px-4 py-3 text-center text-[15px] text-public-ink ring ring-public-line">
			{label}
		</div>
	);
}

/** Store, standards, assistants: how a store reaches shoppers who ask AI. The diagram is decorative; the text explains it. */
export function AgenticCommerceSection({ id }: { id?: string }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef<HTMLDivElement>(null);
	const standardsRef = useRef<HTMLDivElement>(null);
	const assistantsRef = useRef<HTMLDivElement>(null);
	const beam = { containerRef, gradientStartColor: '#145fe4', gradientStopColor: '#6ea8ff', pathColor: '#145fe4', className: 'hidden sm:block' };

	return (
		<section id={id} className="scroll-mt-36 border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] gap-12 lg:grid-cols-2 lg:items-center">
				<div>
					<div className="flex flex-wrap items-center gap-3">
						<Eyebrow>Agentic commerce</Eyebrow>
						<CapabilityTag id="agentic-commerce" />
					</div>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Sell wherever shoppers ask AI</h2>
					<p className={cn(LEAD, 'mt-5 text-pretty text-public-muted')}>{AGENTIC_COMMERCE_SUMMARY}</p>
					<TextLink to="/agentic-commerce" className="mt-6">
						How agentic commerce works
					</TextLink>
				</div>
				<div ref={containerRef} aria-hidden className="relative grid gap-6 sm:grid-cols-3 sm:gap-10">
					<DiagramNode ref={storeRef} label="Your store" />
					<DiagramNode ref={standardsRef} label="Open standards" />
					<DiagramNode ref={assistantsRef} label="AI assistants" />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={standardsRef} />
					<AnimatedBeam {...beam} fromRef={standardsRef} toRef={assistantsRef} delay={0.6} />
				</div>
			</div>
		</section>
	);
}

export function OperationsSection({ id }: { id?: string }) {
	return (
		<CardSection
			id={id}
			eyebrow="Operations agents"
			tag="operations-agents"
			title="Agents that help run your store"
			lead="The day-to-day work of a store, handled by agents that know your catalog and your customers."
			cards={OPERATIONS_CARDS}
		/>
	);
}

export function PersonalizationSection({ id }: { id?: string }) {
	return (
		<CardSection
			id={id}
			eyebrow="Personalized shopping"
			tag="personalized-shopping"
			title="Shopping that adapts to every customer"
			lead="Built into the store, with no apps to add."
			cards={PERSONALIZATION_CARDS}
		/>
	);
}
```

- [ ] **Step 6: Create `src/components/public-site/PlanPrice.tsx`**

```tsx
import { formatPlanPrice, type Plan } from '@/lib/plans';

export function PlanPrice({ plan, className }: { plan: Plan; className?: string }) {
	return (
		<p className={className}>
			{formatPlanPrice(plan)}
			{plan.priceCents > 0 && <span className="text-base font-normal tracking-normal text-public-muted"> / month</span>}
		</p>
	);
}
```

- [ ] **Step 7: Give `PublicFaq` an `items` prop and the updated launch list.** In `src/components/public-site/PublicFaq.tsx`:
1. Import `type FaqItem` from `@/content/positioning`.
2. Rename `FAQ` to `export const LAUNCH_FAQ: readonly FaqItem[]`, with the contents below.
3. Change the signature to `export function PublicFaq({ items = LAUNCH_FAQ }: { items?: readonly FaqItem[] })`, and map `items` instead of `FAQ`.

```tsx
export const LAUNCH_FAQ: readonly FaqItem[] = [
	{ question: 'Is Estori free?', answer: 'Yes. Building and editing stores is free within daily limits. Paid plans are coming soon.' },
	{ question: 'What does Coming soon mean?', answer: "A capability or plan we're building. It isn't part of Estori until it launches, and its details may change before then." },
	{ question: 'Can my store take payments?', answer: 'Not yet. Stores include a catalog, cart, checkout flow and order records, and built-in payments are coming soon.' },
	{ question: 'Does Estori take a cut of my store sales?', answer: 'No. When store payments launch, only Stripe charges for card processing.' },
	{ question: 'Who owns the store I build?', answer: 'You do. Keep editing it, keep it private, or publish it to Discover.' },
	{ question: 'What does Estori charge for template sales?', answer: `${PLATFORM_FEE_LABEL} per sale. You receive the rest through Stripe.` },
	{ question: 'Can I resell a store I bought?', answer: "No. A store you buy is yours to adapt for your own business, but it can't be republished or resold." },
	{
		question: "What if a store I bought doesn't work?",
		answer: (
			<>
				If it can't be used, email us within 14 days and we'll fix it or refund you. See the{' '}
				<Link to="/refunds" className="underline underline-offset-4">
					refund policy
				</Link>
				.
			</>
		),
	},
];
```

In `src/routes/landing-guard.test.ts`, update the question list in "answers the six launch questions". Rename the test to "answers the launch questions" and list the eight questions above.

- [ ] **Step 8: Let `ClosingPanel` work from every page.** In `src/routes/landing/sections.tsx`, replace the `<a href="#build" className={pillClass('white')}>Start building</a>` anchor with:

```tsx
					<PillLink to="/#build" variant="white">
						Start building
					</PillLink>
```

Then remove `pillClass` from its import if nothing else in the file uses it.

- [ ] **Step 9: Run the tests to see them pass**

Run: `rtk proxy npx vitest run src/routes/positioning-copy-guard.test.ts src/routes/landing-guard.test.ts`
Expected: PASS.

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/routes/copy-rules.ts src/routes/positioning-copy-guard.test.ts src/content/positioning.ts src/components/public-site/solution-page.tsx src/components/public-site/capability-sections.tsx src/components/public-site/PlanPrice.tsx src/components/public-site/PublicFaq.tsx src/routes/landing/sections.tsx src/routes/landing-guard.test.ts
git commit -m "feat(public): page blocks and positioning copy, with the copy rules as tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Solution pages and the agentic commerce explainer

**Files:**
- Create:
  - `src/routes/solutions/brands.tsx`, `resellers.tsx` and `digital.tsx`;
  - `src/routes/agentic-commerce.tsx`;
  - `src/routes/solutions-guard.test.ts`.
- Modify: `src/routes.tsx`, the PublicShell children.

**Interfaces:**
- Consumes:
  - from Task 6: the page blocks, the capability sections and the copy;
  - from Task 4: `EarlyAccessButton` and `useEarlyAccessFromUrl`;
  - `ClosingPanel` from `src/routes/landing/sections`;
  - `PublicFaq`.
- Produces: the routes `/solutions/brands`, `/solutions/resellers`, `/solutions/digital` and `/agentic-commerce`, with the anchors `#operations`, `#personalization` and `#catalog`.

- [ ] **Step 1: Write the failing guard** `src/routes/solutions-guard.test.ts`

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/src/routes/solutions/*.tsx', '/src/routes/agentic-commerce.tsx', '/src/routes/creators/*.tsx', '/src/routes.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const PAGES = [
	'/src/routes/solutions/brands.tsx',
	'/src/routes/solutions/resellers.tsx',
	'/src/routes/solutions/digital.tsx',
	'/src/routes/agentic-commerce.tsx',
];

describe('solution pages', () => {
	it('are public pages', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		for (const path of ["path: 'solutions/brands'", "path: 'solutions/resellers'", "path: 'solutions/digital'", "path: 'agentic-commerce'"]) {
			expect(publicBlock).toContain(path);
		}
	});

	it('set a title and description, and tag unbuilt capabilities from the registry', () => {
		for (const path of PAGES) {
			const page = source(path);
			expect(page, path).toContain('<PageMeta');
			expect(page, path).not.toContain('<ComingSoon');
		}
	});

	it('give the menu links their anchors', () => {
		const brands = source('/src/routes/solutions/brands.tsx');
		expect(brands).toContain('<OperationsSection id="operations" />');
		expect(brands).toContain('<PersonalizationSection id="personalization" />');
		expect(source('/src/routes/solutions/resellers.tsx')).toContain('id="catalog"');
	});

	it('takes early-access requests for digital products, including after a sign-in that reloads the page', () => {
		const digital = source('/src/routes/solutions/digital.tsx');
		expect(digital).toContain('<EarlyAccessButton capability="digital-products"');
		expect(digital).toContain('useEarlyAccessFromUrl();');
	});
});
```

Run: `rtk proxy npx vitest run src/routes/solutions-guard.test.ts`
Expected: FAIL. The page sources aren't found.

- [ ] **Step 2: Create `src/routes/solutions/brands.tsx`**

```tsx
import { AgenticCommerceSection, OperationsSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { BRAND_FAQ, BRAND_STEPS, TODAY_CARDS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';

export default function BrandsPage() {
	return (
		<div>
			<PageMeta
				title="For brands"
				description="Build your store with AI today. Agentic commerce, operations agents and personalized shopping are coming soon to every Estori store."
			/>
			<SolutionHero
				eyebrow="For brands and store owners"
				title="Your store, built by agents and ready for AI shoppers"
				lead="Describe your brand and Estori builds a complete store you keep shaping by chat. Selling through AI assistants, agents that run day-to-day work and personalized shopping are coming soon to every store."
			/>
			<CardSection eyebrow="Available today" title="What Estori builds today" cards={TODAY_CARDS} />
			<AgenticCommerceSection id="agentic-commerce" />
			<OperationsSection id="operations" />
			<PersonalizationSection id="personalization" />
			<HowItWorks steps={BRAND_STEPS} />
			<PublicFaq items={BRAND_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

- [ ] **Step 3: Create `src/routes/solutions/resellers.tsx`**

```tsx
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { CATALOG_CARDS, RESELLER_FAQ, RESELLER_STEPS, TODAY_CARDS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';

export default function ResellersPage() {
	return (
		<div>
			<PageMeta
				title="For dropshippers and resellers"
				description="A curated catalog of vetted suppliers is coming soon to Estori. Build the store for it today."
			/>
			<SolutionHero
				eyebrow="For dropshippers and resellers"
				title="Find products. Add them in a few clicks. Let suppliers ship."
				lead="Estori is building a curated catalog of vetted suppliers. Apply, choose products and they appear in your store, ready to sell."
				tag="product-catalog"
			/>
			<CardSection id="catalog" eyebrow="Product catalog" tag="product-catalog" title="A curated product catalog" cards={CATALOG_CARDS} />
			<HowItWorks steps={RESELLER_STEPS} />
			<CardSection
				eyebrow="Available today"
				title="Build the store first"
				lead="While the catalog is on its way, build the store itself with Estori, ready for the products you'll add."
				cards={TODAY_CARDS}
			/>
			<PublicFaq items={RESELLER_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

- [ ] **Step 4: Create `src/routes/solutions/digital.tsx`**

```tsx
import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { COMMUNITY_CARDS, DIGITAL_FAQ, DIGITAL_PRODUCT_CARDS, DIGITAL_STEPS } from '@/content/positioning';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';

export default function DigitalPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta
				title="For digital businesses"
				description="Sell e-books, images and videos and run a community from your Estori store. In early access."
			/>
			<SolutionHero
				eyebrow="For digital businesses"
				title="Sell digital products and build a community around them"
				lead="Sell e-books, images, videos and other downloads from your own store, and give your customers a place to gather."
				tag="digital-products"
				actions={
					<>
						<PillLink to="/#build" variant="white">
							Start building free
						</PillLink>
						<EarlyAccessButton capability="digital-products" variant="outline-on-dark" listedClassName="text-white" />
					</>
				}
			/>
			<CardSection eyebrow="Digital products" tag="digital-products" title="Sell what you make, delivered as files" cards={DIGITAL_PRODUCT_CARDS} />
			<CardSection eyebrow="Community" tag="digital-products" title="A place for your customers" cards={COMMUNITY_CARDS}>
				<EarlyAccessButton capability="digital-products" listedClassName="text-public-ink" />
			</CardSection>
			<HowItWorks steps={DIGITAL_STEPS} />
			<PublicFaq items={DIGITAL_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

- [ ] **Step 5: Create `src/routes/agentic-commerce.tsx`**

```tsx
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { AGENT_READY_CARDS, AGENTIC_BASICS_CARDS, AGENTIC_FAQ } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';

export default function AgenticCommercePage() {
	return (
		<div>
			<PageMeta
				title="Agentic commerce"
				description="What AI shopping assistants are, what makes a store agent-ready, and how every Estori store will get it."
			/>
			<SolutionHero
				eyebrow="Agentic commerce"
				tag="agentic-commerce"
				title="Ready for shoppers who ask AI"
				lead="AI assistants are starting to search, compare and buy on shoppers' behalf. Every Estori store will be ready for them, with nothing to set up."
			/>
			<CardSection eyebrow="The basics" title="What agentic commerce is" cards={AGENTIC_BASICS_CARDS} />
			<CardSection eyebrow="Agent-ready" title="What a store needs" cards={AGENT_READY_CARDS} />
			<CardSection
				eyebrow="On Estori"
				tag="agentic-commerce"
				title="Built into every Estori store"
				lead="Estori runs your store's code, hosting and checkout, so it can add the standards to every store at once. No apps to install and no feeds to maintain by hand."
				cards={[]}
			/>
			<PublicFaq items={AGENTIC_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

`CardSection` with `cards={[]}` renders an empty grid. To avoid that, change `CardSection` to render its grid only when `cards.length > 0`: wrap the grid `div` in `{cards.length > 0 && (...)}`. Make that change in `solution-page.tsx` now.

- [ ] **Step 6: Add the routes.** In `src/routes.tsx`, import the four pages:

```tsx
import BrandsPage from './routes/solutions/brands';
import ResellersPage from './routes/solutions/resellers';
import DigitalPage from './routes/solutions/digital';
import AgenticCommercePage from './routes/agentic-commerce';
```

Then add these to the PublicShell `children`, right after the `pricing` route:

```tsx
					{
						path: 'solutions/brands',
						Component: BrandsPage,
					},
					{
						path: 'solutions/resellers',
						Component: ResellersPage,
					},
					{
						path: 'solutions/digital',
						Component: DigitalPage,
					},
					{
						path: 'agentic-commerce',
						Component: AgenticCommercePage,
					},
```

- [ ] **Step 7: Run the guards to see them pass**

Run: `rtk proxy npx vitest run src/routes/solutions-guard.test.ts src/routes/positioning-copy-guard.test.ts src/routes/public-pages-guard.test.ts`
Expected: PASS. The creator assertions arrive in Task 8. This task's guard only covers the four pages above.

- [ ] **Step 8: Commit**

```bash
git add src/routes/solutions src/routes/agentic-commerce.tsx src/routes/solutions-guard.test.ts src/routes.tsx src/components/public-site/solution-page.tsx
git commit -m "feat(public): pages for brands, resellers, digital businesses and agentic commerce

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Creator pages

**Files:**
- Move: `src/routes/landing/CreatorsPanel.tsx` to `src/routes/creators/TemplateEarnings.tsx` (`git mv`).
- Create: `src/routes/creators/developers.tsx`, `src/routes/creators/content.tsx`
- Modify:
  - `src/routes.tsx`;
  - `src/routes/landing/LandingPage.tsx`: remove `CreatorsPanel`;
  - `src/routes/landing-guard.test.ts`: move the creators panel assertions;
  - `src/routes/solutions-guard.test.ts`: add the creator assertions.

**Interfaces:**
- Consumes: from Tasks 4 and 6: the page blocks, the copy, `EarlyAccessButton` and `useEarlyAccessFromUrl`.
- Produces: the routes `/creators/developers` and `/creators/content`, and the component `TemplateEarnings`.

- [ ] **Step 1: Add the failing creator assertions** to `src/routes/solutions-guard.test.ts`:

```ts
describe('creator pages', () => {
	it('are public pages', () => {
		const routes = source('/src/routes.tsx');
		const publicBlock = routes.slice(routes.indexOf('Component: PublicShell'));
		expect(publicBlock).toContain("path: 'creators/developers'");
		expect(publicBlock).toContain("path: 'creators/content'");
	});

	it('shows developers what they keep from the fee code, on the blue panel with AA contrast', () => {
		const earnings = source('/src/routes/creators/TemplateEarnings.tsx');
		expect(earnings).toContain('sellerKeepsCents(EXAMPLE_SALE_CENTS)');
		expect(earnings).toContain('<AnimatedBeam');
		expect(earnings).toContain('bg-public-blue');
		expect(earnings).not.toMatch(/text-white\/\d+/);
		expect(earnings).toContain('bg-black/15');
		expect(earnings).not.toContain('id="creators"');
		expect(source('/src/routes/creators/developers.tsx')).toContain('<TemplateEarnings />');
	});

	it('takes early-access requests for the content creator program, including after a sign-in that reloads the page', () => {
		const content = source('/src/routes/creators/content.tsx');
		expect(content).toContain('<EarlyAccessButton capability="content-creators"');
		expect(content).toContain('useEarlyAccessFromUrl();');
		expect(content).not.toContain('<ComingSoon');
	});
});
```

In `src/routes/landing-guard.test.ts`:
1. Delete the test "states what a seller keeps from the fee code, with the creators anchor the top bar links to". It now lives in the creator test above.
2. In "uses the 1Password layout…", remove the `CreatorsPanel.tsx` line.

Run: `rtk proxy npx vitest run src/routes/solutions-guard.test.ts`
Expected: FAIL on the creator tests.

- [ ] **Step 2: Move and adapt the panel**

Run: `git mv src/routes/landing/CreatorsPanel.tsx src/routes/creators/TemplateEarnings.tsx`

In `src/routes/creators/TemplateEarnings.tsx`:
1. Rename the function `CreatorsPanel` to `TemplateEarnings`, and update its doc comment to "How a template sale flows from Discover to the developer, on 1Password's blue panel."
2. Remove `id="creators"` and `scroll-mt-36` from the inner div.
3. Change the eyebrow text from `For creators` to `How you earn`.
4. Replace the `<a href="#build" className={pillClass('charcoal')}>Start selling</a>` anchor with:

```tsx
					<PillLink to="/#build" variant="charcoal">
						Start selling
					</PillLink>
```

5. Change the second link's `to="/pricing"` to `to="/pricing#developers"`.
6. Remove `pillClass` from the import if it's no longer used.

- [ ] **Step 3: Create `src/routes/creators/developers.tsx`**

```tsx
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { DEVELOPER_FAQ, DEVELOPER_STEPS } from '@/content/positioning';
import { ClosingPanel } from '@/routes/landing/sections';
import { TemplateEarnings } from './TemplateEarnings';

export default function DevelopersPage() {
	return (
		<div>
			<PageMeta title="For developers" description="Build stores with Estori, publish them to Discover as templates, and get paid through Stripe." />
			<SolutionHero
				eyebrow="For developers"
				title="Design a store once. Earn every time it's used."
				lead="Build stores with Estori, publish them to Discover as templates, and get paid through Stripe when someone starts from yours."
				actions={
					<>
						<PillLink to="/#build" variant="white">
							Start building free
						</PillLink>
						<PillLink to="/discover" variant="outline-on-dark">
							Browse Discover
						</PillLink>
					</>
				}
			/>
			<TemplateEarnings />
			<HowItWorks steps={DEVELOPER_STEPS} />
			<PublicFaq items={DEVELOPER_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

- [ ] **Step 4: Create `src/routes/creators/content.tsx`**

```tsx
import { EarlyAccessButton } from '@/components/public-site/EarlyAccessButton';
import { PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { CardSection, HowItWorks, PageMeta, SolutionHero } from '@/components/public-site/solution-page';
import { CONTENT_CREATOR_CARDS, CONTENT_FAQ, CONTENT_STEPS } from '@/content/positioning';
import { useEarlyAccessFromUrl } from '@/hooks/use-early-access';
import { ClosingPanel } from '@/routes/landing/sections';

export default function ContentCreatorsPage() {
	useEarlyAccessFromUrl();
	return (
		<div>
			<PageMeta
				title="For content creators"
				description="Get paid for the products you recommend, with your own link or your own Estori store. In early access."
			/>
			<SolutionHero
				eyebrow="For content creators"
				tag="content-creators"
				title="Get paid for the products you recommend"
				lead="Promote merchants' products with your own link or your own Estori store, and earn a commission on every sale you bring."
				actions={
					<>
						<PillLink to="/#build" variant="white">
							Start building free
						</PillLink>
						<EarlyAccessButton capability="content-creators" variant="outline-on-dark" listedClassName="text-white" />
					</>
				}
			/>
			<CardSection eyebrow="How you earn" tag="content-creators" title="Your audience, your recommendations" cards={CONTENT_CREATOR_CARDS}>
				<EarlyAccessButton capability="content-creators" listedClassName="text-public-ink" />
			</CardSection>
			<HowItWorks steps={CONTENT_STEPS} />
			<PublicFaq items={CONTENT_FAQ} />
			<ClosingPanel />
		</div>
	);
}
```

- [ ] **Step 5: Add the routes.** In `src/routes.tsx`, import `DevelopersPage from './routes/creators/developers'` and `ContentCreatorsPage from './routes/creators/content'`. Add these after the `agentic-commerce` route:

```tsx
					{
						path: 'creators/developers',
						Component: DevelopersPage,
					},
					{
						path: 'creators/content',
						Component: ContentCreatorsPage,
					},
```

In `src/routes/landing/LandingPage.tsx`, delete the `CreatorsPanel` import and the `<CreatorsPanel />` element. Task 9 rewrites the order.

- [ ] **Step 6: Run the guards to see them pass**

Run: `rtk proxy npx vitest run src/routes/solutions-guard.test.ts src/routes/positioning-copy-guard.test.ts`
Expected: PASS. `landing-guard.test.ts`'s order test still fails until Task 9, which is expected here.

- [ ] **Step 7: Commit**

```bash
git add src/routes/creators src/routes/landing/LandingPage.tsx src/routes.tsx src/routes/solutions-guard.test.ts src/routes/landing-guard.test.ts
git commit -m "feat(public): developer and content creator pages; template earnings move off the landing page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Landing page, brands first

**Files:**
- Create: `src/routes/landing/SellersBand.tsx`
- Modify:
  - `src/routes/landing/LandingPage.tsx`;
  - `src/routes/landing/Hero.tsx`: the eyebrow, headline and lead;
  - `src/routes/landing/Features.tsx`: the heading;
  - `src/routes/landing-guard.test.ts`: the order and hero tests.

**Interfaces:**
- Consumes:
  - from Task 6: the capability sections and `LinkCard`;
  - from Task 5: `AUDIENCES`, `CREATOR_ITEMS` and `CREATORS_CAPTION`.
- Produces: the landing page in the approved order.

- [ ] **Step 1: Update the landing guard (failing).** In `src/routes/landing-guard.test.ts`, replace the order test's `order` array with:

```ts
		const order = [
			'<Hero />',
			'<StoreLogos',
			'<AgenticCommerceSection />',
			'<OperationsSection />',
			'<PersonalizationSection />',
			'<Features />',
			'<SellersBand />',
			'<StoreShowcase',
			'<LivePreview />',
			'<PricingSummary />',
			'<PublicFaq />',
			'<ClosingPanel />',
		];
```

Add this test after "shows the builder demo…":

```ts
	it('speaks to brands first and marks what is coming soon', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toContain('The agentic commerce platform');
		expect(hero).toContain('Build your store with AI. Sell wherever shoppers ask AI.');
		expect(hero).toContain('are coming soon to every store');
		expect(source('/src/routes/landing/Features.tsx')).toContain('What Estori builds today');
		const band = source('/src/routes/landing/SellersBand.tsx');
		expect(band).toContain('CREATOR_ITEMS.map');
		expect(band).toContain('<LinkCard');
	});
```

Run: `rtk proxy npx vitest run src/routes/landing-guard.test.ts`
Expected: FAIL on the order and the new test.

- [ ] **Step 2: Update the hero.** In `src/routes/landing/Hero.tsx`:
1. Add `Eyebrow` to the primitives import.
2. Insert this right before the `<h1`:

```tsx
				<Eyebrow tone="dark">The agentic commerce platform</Eyebrow>
```

3. Change the `<h1` class from `'mx-auto max-w-5xl text-balance'` to `'mx-auto mt-4 max-w-5xl text-balance'`, and its text to `Build your store with AI. Sell wherever shoppers ask AI.`
4. Change the lead paragraph's text to:

```
Describe your brand and Estori builds and deploys a complete store: catalog, cart, checkout flow and order records. Agentic commerce, operations agents and personalized shopping are coming soon to every store.
```

- [ ] **Step 3: Retitle the features section.** In `src/routes/landing/Features.tsx`, change the `<h2>` text `Everything your store needs, from one description` to `What Estori builds today`.

- [ ] **Step 4: Create `src/routes/landing/SellersBand.tsx`**

```tsx
import { Eyebrow, HEADING_SECTION } from '@/components/public-site/primitives';
import { LinkCard } from '@/components/public-site/solution-page';
import { AUDIENCES, CREATOR_ITEMS, CREATORS_CAPTION } from '@/lib/site-nav';
import { cn } from '@/lib/utils';

/** The other audiences, after the brand story: resellers and digital businesses, then the creator programs. */
export function SellersBand() {
	const sellers = AUDIENCES.filter((item) => item.to !== '/solutions/brands');
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow>Solutions</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance text-public-ink')}>Estori for every kind of seller</h2>
				<div className="mt-12 grid gap-4 md:grid-cols-2">
					{sellers.map((item) => (
						<LinkCard key={item.to} item={item} />
					))}
				</div>
				<div className="mt-16">
					<Eyebrow>For creators</Eyebrow>
					<p className="mt-2 text-[15px] font-light text-public-muted">{CREATORS_CAPTION}</p>
				</div>
				<div className="mt-6 grid gap-4 md:grid-cols-2">
					{CREATOR_ITEMS.map((item) => (
						<LinkCard key={item.to} item={item} />
					))}
				</div>
			</div>
		</section>
	);
}
```

- [ ] **Step 5: Reorder the landing page.** Replace `src/routes/landing/LandingPage.tsx` with:

```tsx
import { pageTitle } from '@/brand';
import { AgenticCommerceSection, OperationsSection, PersonalizationSection } from '@/components/public-site/capability-sections';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Features } from './Features';
import { Hero } from './Hero';
import { LivePreview } from './LivePreview';
import { SellersBand } from './SellersBand';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta
				name="description"
				content="Estori is the agentic commerce platform: build your store with AI today, with selling through AI assistants and operations agents coming soon."
			/>
			<Hero />
			<StoreLogos stores={stores} />
			<AgenticCommerceSection />
			<OperationsSection />
			<PersonalizationSection />
			<Features />
			<SellersBand />
			<StoreShowcase stores={stores} />
			<LivePreview />
			<PricingSummary />
			<PublicFaq />
			<ClosingPanel />
		</>
	);
}
```

- [ ] **Step 6: Run the guards to see them pass**

Run: `rtk proxy npx vitest run src/routes/landing-guard.test.ts src/routes/positioning-copy-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/landing src/routes/landing-guard.test.ts
git commit -m "feat(landing): brands first, with agentic commerce, operations agents and personalization marked coming soon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Pricing page and the landing pricing summary

**Files:**
- Modify:
  - `src/routes/pricing.tsx`, replaced in full;
  - `src/routes/landing/sections.tsx`: `PricingSummary`;
  - `src/routes/pricing-guard.test.ts`, replaced in full.

**Interfaces:**
- Consumes:
  - from Task 2: `PLANS`, `PLAN_COMPARISON`, `formatCredits`, `liveStoresLabel`, `Plan` and `PlanCell`;
  - from Task 6: `PlanPrice`, `PageMeta` and `CapabilityTag`;
  - from Task 1: `ComingSoon`;
  - `PlanLimits`, `usePublicPlan` and `sellerKeepsTable`.
- Produces: `/pricing` with plan cards, the comparison, the `#developers` section and the FAQ.

- [ ] **Step 1: Replace the guard (failing)** `src/routes/pricing-guard.test.ts`

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/routes/pricing.tsx', '/src/routes.tsx', '/src/routes/landing/sections.tsx'], {
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

	it('shows the four plans from the plan data, never typed-in prices', () => {
		expect(page).toContain('PLANS.map');
		expect(page).toContain('<PlanPrice');
		expect(page).not.toMatch(/\$(29|79|249)\b/);
		expect(page).not.toMatch(/10,000|30,000|100,000/);
	});

	it('offers a button only on plans available today', () => {
		expect(page).toMatch(/plan\.status === 'available' && \(/);
		expect(page).toContain('<ComingSoon />');
		expect(page).not.toMatch(/Buy|Subscribe|Upgrade/);
	});

	it('compares plans by capability, with tags from the registry', () => {
		expect(page).toContain('PLAN_COMPARISON.map');
		expect(page).toContain('<CapabilityTag id={section.capability} />');
		expect(page).toContain('<caption className="sr-only">What each plan includes</caption>');
	});

	it('states the free limits and the template fee from the code that applies them', () => {
		expect(page).toContain('PLATFORM_FEE_LABEL');
		expect(page).toContain('sellerKeepsTable()');
		expect(page).toContain('<PlanLimits');
		expect(page).not.toMatch(/7% \+ \$0\.60/);
	});

	it('explains that models use credits at different rates', () => {
		expect(page).toContain('Each model uses credits at its own rate, so lighter models go further.');
		expect(page).toContain('usePublicPlan()');
		expect(page).toContain('aiCreditsPerDay == null');
	});

	it("doesn't promise store payments yet", () => {
		expect(page).toContain('Accept payments in your store');
	});

	it('keeps template selling in its own section that the developer page links to', () => {
		expect(page).toContain('id="developers"');
		expect(page).toContain('<caption className="sr-only">What a seller keeps at each price</caption>');
		const sell = page.slice(page.lastIndexOf('<article', page.indexOf('>Sell</h3>')), page.indexOf('>Sell</h3>'));
		expect(sell).toMatch(/<article className=\{cn\(CARD, '[^']*\brelative\b/);
	});

	it('is a public page in the 1Password layout', () => {
		const routes = source('/src/routes.tsx');
		expect(routes.slice(routes.indexOf('Component: PublicShell'))).toContain("path: 'pricing'");
		expect(page).toContain('bg-public-charcoal');
		expect(page).toContain('<PublicFaq />');
		expect(page).not.toContain('kumo-');
	});
});

describe('landing pricing summary', () => {
	it('shows the same plans from the same data', () => {
		const sections = source('/src/routes/landing/sections.tsx');
		const summary = sections.slice(sections.indexOf('export function PricingSummary'), sections.indexOf('export function ClosingPanel'));
		expect(summary).toContain('PLANS.map');
		expect(summary).toContain('<PlanPrice');
		expect(summary).toContain('<ComingSoon />');
	});
});
```

Run: `rtk proxy npx vitest run src/routes/pricing-guard.test.ts`
Expected: FAIL.

- [ ] **Step 2: Replace `src/routes/pricing.tsx`**

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon, MinusIcon } from '@phosphor-icons/react';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { CapabilityTag } from '@/components/public-site/CapabilityTag';
import { PlanPrice } from '@/components/public-site/PlanPrice';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink } from '@/components/public-site/primitives';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { PageMeta } from '@/components/public-site/solution-page';
import { usePublicPlan } from '@/hooks/use-public-plan';
import { PLANS, PLAN_COMPARISON, formatCredits, liveStoresLabel, type Plan, type PlanCell } from '@/lib/plans';
import { formatCents, sellerKeepsTable } from '@/lib/pricing';
import { cn } from '@/lib/utils';

function Feature({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
	return (
		<li className={cn('flex items-start gap-3 text-[15px] font-light', tone === 'dark' ? 'text-white/85' : 'text-public-ink')}>
			<CheckIcon className={cn('mt-1 size-4 shrink-0', tone === 'dark' ? 'text-white' : 'text-public-blue')} weight="bold" aria-hidden />
			<span>{children}</span>
		</li>
	);
}

/** Shown only with the credits number it explains. */
function CreditRateNote() {
	const plan = usePublicPlan();
	if (plan.data?.aiCreditsPerDay == null) return null;
	return <p className="mt-2 text-sm text-public-muted">Each model uses credits at its own rate, so lighter models go further.</p>;
}

const CARD = 'flex flex-col rounded-[24px] p-8';
const CARD_LABEL = 'text-xs uppercase tracking-[0.02em]';

function PlanCard({ plan }: { plan: Plan }) {
	return (
		<article className={cn(CARD, 'ring ring-public-line')}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className={cn(CARD_LABEL, 'text-public-ink/80')}>{plan.name}</h3>
				{plan.status === 'coming-soon' && <ComingSoon />}
			</div>
			<PlanPrice plan={plan} className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink" />
			{plan.monthlyCredits === null ? (
				<>
					<PlanLimits className="mt-3 text-sm text-public-muted" />
					<CreditRateNote />
				</>
			) : (
				<p className="mt-3 text-sm text-public-muted">
					{formatCredits(plan.monthlyCredits)} AI credits a month · {liveStoresLabel(plan.liveStores)}
				</p>
			)}
			<p className="mt-6 text-[15px] font-light text-public-ink">{plan.summary}</p>
			{plan.status === 'available' && (
				<>
					<ul className="mt-6 grid gap-3">
						<Feature>Change your store by chatting with the AI</Feature>
						<Feature>Live preview on desktop and phone</Feature>
						<Feature>Publish to Discover, or start from any free store there</Feature>
						<Feature>
							<span className="inline-flex flex-wrap items-center gap-2">
								Accept payments in your store <ComingSoon />
							</span>
						</Feature>
					</ul>
					<PillLink to="/#build" variant="blue" className="mt-8">
						Start building free
					</PillLink>
				</>
			)}
		</article>
	);
}

function Cell({ value }: { value: PlanCell }) {
	if (value === true) {
		return (
			<>
				<CheckIcon className="mx-auto size-4 text-public-blue" weight="bold" aria-hidden />
				<span className="sr-only">Included</span>
			</>
		);
	}
	if (value === false) {
		return (
			<>
				<MinusIcon className="mx-auto size-4 text-public-muted" aria-hidden />
				<span className="sr-only">Not included</span>
			</>
		);
	}
	return <>{value}</>;
}

function ComparisonRowView({ label, cells }: { label: string; cells: readonly PlanCell[] }) {
	return (
		<tr className="border-t border-public-line">
			<th scope="row" className="py-3 pr-4 text-left font-light text-public-ink">
				{label}
			</th>
			{cells.map((cell, index) => (
				<td key={PLANS[index].id} className="py-3 text-center text-public-ink">
					<Cell value={cell} />
				</td>
			))}
		</tr>
	);
}

function Comparison() {
	const plan = usePublicPlan();
	const freeCredits = plan.data?.aiCreditsPerDay == null ? 'Daily allowance' : `${formatCredits(plan.data.aiCreditsPerDay)} a day`;
	return (
		<section className="border-t border-public-line bg-white px-4 py-16 sm:px-6 sm:py-20">
			<div className="mx-auto max-w-[1248px]">
				<h2 className={cn(HEADING_SECTION, 'text-balance text-public-ink')}>Compare plans</h2>
				{/* Positioned, so the sr-only caption stays inside this scroll box. */}
				<div className="relative mt-10 overflow-x-auto">
					<table className="w-full min-w-[720px] text-[15px]">
						<caption className="sr-only">What each plan includes</caption>
						<thead>
							<tr>
								<td />
								{PLANS.map((entry) => (
									<th key={entry.id} scope="col" className="py-3 text-center font-normal text-public-ink">
										{entry.name}
									</th>
								))}
							</tr>
						</thead>
						{PLAN_COMPARISON.map((section) => (
							<tbody key={section.title}>
								<tr>
									<th scope="colgroup" colSpan={PLANS.length + 1} className="pt-8 pb-2 text-left font-normal">
										<span className="inline-flex flex-wrap items-center gap-2 text-public-ink">
											{section.title}
											{section.capability && <CapabilityTag id={section.capability} />}
										</span>
									</th>
								</tr>
								{section.capability === 'store-builder' && (
									<>
										<ComparisonRowView label="Live stores" cells={PLANS.map((entry) => liveStoresLabel(entry.liveStores))} />
										<ComparisonRowView
											label="AI credits"
											cells={PLANS.map((entry) => (entry.monthlyCredits === null ? freeCredits : `${formatCredits(entry.monthlyCredits)} a month`))}
										/>
									</>
								)}
								{section.rows.map((row) => (
									<ComparisonRowView key={row.label} label={row.label} cells={PLANS.map((entry) => row.cells[entry.id])} />
								))}
							</tbody>
						))}
					</table>
				</div>
				<p className="mt-6 text-sm text-public-muted">AI credits pay for building sites and for agents' work.</p>
			</div>
		</section>
	);
}

export default function PricingPage() {
	return (
		<div>
			<PageMeta
				title="Pricing"
				description={`Estori is free to build with, and paid plans are coming soon. Template sellers pay ${PLATFORM_FEE_LABEL} per sale.`}
			/>
			<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
				<Eyebrow tone="dark">Pricing</Eyebrow>
				<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Plans for every stage of your store</h1>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>
					Start free today. Paid plans with live stores, agentic commerce and agents that help run your store are coming soon.
				</p>
			</section>
			<section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto grid max-w-[1248px] gap-6 md:grid-cols-2 xl:grid-cols-4">
					{PLANS.map((plan) => (
						<PlanCard key={plan.id} plan={plan} />
					))}
				</div>
				<p className="mx-auto mt-10 max-w-[1248px] text-center text-xs text-public-muted">Prices are in US dollars.</p>
			</section>
			<Comparison />
			<section id="developers" className="scroll-mt-36 border-t border-public-line bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto max-w-[1248px]">
					<Eyebrow>For developers</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Selling templates in Discover</h2>
					<div className="mt-10 grid gap-6 lg:grid-cols-2">
						{/* Positioned, so the table's absolute sr-only caption stays inside the page's own scroll. */}
						<article className={cn(CARD, 'relative bg-public-charcoal text-white')}>
							<h3 className={cn(CARD_LABEL, 'text-white/80')}>Sell</h3>
							<p className="mt-4 text-5xl font-light tracking-[-0.02em]">{PLATFORM_FEE_LABEL}</p>
							<p className="mt-3 text-sm text-white/70">per sale</p>
							<ul className="mt-8 grid gap-3">
								<Feature tone="dark">Choose a price. An Estori admin reviews it before buyers can use your store.</Feature>
								<Feature tone="dark">Buyers pay by card through Stripe. You receive the rest automatically, on Stripe's payout schedule.</Feature>
								<Feature tone="dark">You need a Stripe account and must be 18 or older.</Feature>
							</ul>
							<table className="mt-8 w-full text-left text-sm">
								<caption className="sr-only">What a seller keeps at each price</caption>
								<thead className="text-white/60">
									<tr>
										<th scope="col" className="py-2 font-normal">Price</th>
										<th scope="col" className="py-2 font-normal">Estori fee</th>
										<th scope="col" className="py-2 text-right font-normal">You keep</th>
									</tr>
								</thead>
								<tbody>
									{sellerKeepsTable().map((row) => (
										<tr key={row.priceCents} className="border-t border-white/15">
											<td className="py-2.5">{formatTemplatePrice(row.priceCents)}</td>
											<td className="py-2.5 text-white/70">{formatCents(row.feeCents)}</td>
											<td className="py-2.5 text-right">{formatCents(row.sellerCents)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</article>
						<article className={cn(CARD, 'ring ring-public-line')}>
							<h3 className={cn(CARD_LABEL, 'text-public-ink/80')}>Buy a store design</h3>
							<p className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink">One-time</p>
							<p className="mt-3 text-sm text-public-muted">the price on its page</p>
							<ul className="mt-8 grid gap-3">
								<Feature>Your own copy to adapt for your own store</Feature>
								<Feature>Keep editing it with the AI</Feature>
								<Feature>For your use only: it can't be republished or resold</Feature>
								<Feature>
									Refunded if it can't be used.{' '}
									<Link to="/refunds" className="underline underline-offset-4">
										Refund policy
									</Link>
								</Feature>
							</ul>
						</article>
					</div>
				</div>
			</section>
			<PublicFaq />
		</div>
	);
}
```

The existing pricing guard also asserts `scope="col"` appears exactly 3 times. The new comparison adds 4 more, so the replaced guard above no longer counts them. It checks the seller table's caption instead.

- [ ] **Step 3: Replace `PricingSummary`** in `src/routes/landing/sections.tsx`:
1. Import `ComingSoon` from `@/components/marketing/ComingSoon`, `PlanPrice` from `@/components/public-site/PlanPrice` and `PLANS` from `@/lib/plans`.
2. Remove the now-unused `PLATFORM_FEE_LABEL` and `PlanLimits` imports.

```tsx
export function PricingSummary() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] gap-10">
				<div className="flex flex-wrap items-end justify-between gap-6">
					<div>
						<Eyebrow>Pricing</Eyebrow>
						<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Start free. Grow into a plan.</h2>
					</div>
					<TextLink to="/pricing">See pricing</TextLink>
				</div>
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{PLANS.map((plan) => (
						<article key={plan.id} className="rounded-[24px] p-7 ring ring-public-line">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-xs uppercase tracking-[0.02em] text-public-ink/80">{plan.name}</p>
								{plan.status === 'coming-soon' && <ComingSoon />}
							</div>
							<PlanPrice plan={plan} className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink" />
							<p className="mt-3 text-sm text-public-muted">{plan.summary}</p>
						</article>
					))}
				</div>
			</BlurFade>
		</section>
	);
}
```

- [ ] **Step 4: Run the guards to see them pass**

Run: `rtk proxy npx vitest run src/routes/pricing-guard.test.ts src/routes/landing-guard.test.ts src/routes/positioning-copy-guard.test.ts`
Expected: PASS. If `landing-guard.test.ts` "doesn't promise store payments, and states the seller fee from the code" fails on `PLATFORM_FEE_LABEL`, the fee must still appear on the landing page. `PublicFaq` is in its glob and states it. Confirm the glob includes `/src/components/public-site/*.tsx`.

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/routes/pricing.tsx src/routes/landing/sections.tsx src/routes/pricing-guard.test.ts
git commit -m "feat(pricing): four plans with paid ones coming soon, a comparison by capability, and template selling for developers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full verification and the local preview

**Files:**
- None, unless a check fails. Fix in the task that owns the code, with a failing test first.

- [ ] **Step 1: Apply migration 0014 to the local database**

Run: `npm run db:migrate:local`
Expected: 0014 applied.

If it fails with the workerd `_cf_ALARM` error seen with 0013, apply the SQL with sqlite3 instead:
1. Find the local D1 file, the `.sqlite` under `.wrangler/state/v3/d1/` whose `d1_migrations` table lists `0013_lean_vance_astro.sql`.
2. Back it up to `.superpowers/reports/agentic-commerce/` first.
3. Run `sqlite3 <file> < migrations/0014_*.sql`.
4. Run `sqlite3 <file> "INSERT INTO d1_migrations (name) VALUES ('<0014 file name>')"`.

Then run `sqlite3 <file> ".schema early_access_requests"`.
Expected: the table, with its unique index.

- [ ] **Step 2: Run the suites one directory at a time.** Wait for TIME_WAIT under 1500 between runs:

Run, separately:
- `rtk proxy npx vitest run src`
- `rtk proxy npx vitest run shared`
- `rtk proxy npx vitest run worker/database`
- `rtk proxy npx vitest run worker/services`
- `rtk proxy npx vitest run worker/api`
- `rtk proxy npx vitest run worker/utils`
- `rtk proxy npx vitest run worker/agents`

Expected: all pass. `worker/agents` keeps its 1 known skip.

- [ ] **Step 3: Typecheck and lint**

Run: `rtk proxy npx tsc -b --noEmit 2>&1 | grep -E "error TS" | sed 's/(.*//' | sort | uniq -c`
Expected: only the 4 known `packages/artifacts-viewer` errors.

Run: `rtk proxy npx eslint src/lib src/components/public-site src/components/layout src/routes/solutions src/routes/creators src/routes/landing src/routes/pricing.tsx src/routes/agentic-commerce.tsx src/routes/admin src/hooks/use-early-access.ts worker/api/controllers/earlyAccess worker/api/routes/earlyAccessRoutes.ts worker/database/services/EarlyAccessService.ts`
Expected: 0 errors.

- [ ] **Step 4: Live checks on http://localhost:8100.** Use the in-app browser and test accounts from `.superpowers/realtest/local-accounts.md` (never print their values).

Check:
1. **Every new public page at 1440 and 390:** `/`, `/solutions/brands`, `/solutions/resellers`, `/solutions/digital`, `/agentic-commerce`, `/creators/developers`, `/creators/content`, `/pricing`.
   - No sideways scroll: `document.documentElement.scrollWidth === clientWidth` on each.
   - Each tag shows the right status.
2. **The top bar at 767, 1023, 1024 and 1440:**
   - one line, and no overflow inside the bar;
   - the menu button below 1024, the menus from 1024;
   - both panels open by click;
   - Escape closes and returns focus to the trigger;
   - a click outside closes;
   - following a link closes;
   - opening one panel closes the other.
3. **Anchors:** `/solutions/brands#operations` and `/solutions/resellers#catalog` land just below the sticky header.
4. **Early access, signed out:**
   - On `/solutions/digital`, click "Request early access", then sign in with the local creator account by email in the window.
   - The button changes to "You're on the list", a toast confirms, and one row exists in `early_access_requests`.
   - A second click is impossible, because the button became a status. Reload and it still shows "You're on the list".
5. **Early access through the return URL:** open `/creators/content?request=content-creators` while signed in. One request is recorded, and the URL drops `?request=`.
6. **Admin:**
   - Signed in as the owner (admin), `/admin/early-access` shows the counts and the two rows, and the Reviews page links to it.
   - Signed in as the buyer account, it shows "Admins only".
7. **Themes:** the light and dark app themes look the same on public pages.
8. **Reduced motion:** with reduced motion emulated, nothing moves, including the agentic commerce diagram's beams.
9. **Signed-in `/`** still shows the builder.

- [ ] **Step 5: Report**

Write `.superpowers/reports/agentic-commerce/verification.md` with:
- each suite's count;
- the typecheck and lint results;
- every live check, pass or fail, with measured values where they apply.

Clean up any `.playwright-mcp/` folder.

The branch is then ready for the owner to review on localhost:8100. Don't open a PR until the owner says so.
