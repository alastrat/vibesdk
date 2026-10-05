# Estori Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand this VibeSDK fork as Estori, covering name, logo, palette, layout chrome, copy, and agent persona. Behavior must not change, and merges from `cloudflare/vibesdk` must stay small.

**Architecture:**
- Brand values live in one shared module (`shared/brand.ts`), which the frontend reaches through `src/brand/`.
- Colors come from one unlayered stylesheet (`src/styles/estori-theme.css`), activated by `data-theme="estori"` on `<html>`. It maps an `--estori-*` palette onto Kumo's tokens and the app's own tokens.
- Upstream files receive small swaps.
- A brand-guard test scans sources for regressions, so an upstream merge cannot silently bring Cloudflare or VibeSDK branding back.

**Tech Stack:** React 19, Vite 8, Tailwind v4, Cloudflare Kumo UI, Cloudflare Workers, Vitest with `@cloudflare/vitest-pool-workers`, bun.

**Spec:** `docs/superpowers/specs/2026-10-04-estori-rebrand-design.md`

## Global Constraints

- **Brand values:**
  - Brand name `Estori`; assistant name `Estori`.
  - Domain `getestori.com`; git author `Estori <bot@getestori.com>`.
  - Description: `Describe the app you want and Estori builds and deploys it.`
- **Light palette:**

  | Token | Value |
  |---|---|
  | topbar | `#11295A` |
  | topbar line | `#0E2250` |
  | topbar text | `#FFFFFF` |
  | canvas / surface / elevated | `#FFFFFF` |
  | recessed | `#F7F8FA` |
  | line | `#E3E8F0` |
  | text strong | `#11295A` |
  | text default | `#1E2A3B` |
  | text subtle | `#5B6576` |
  | link | `#0062E6` |
  | action | `#0062E6` |
  | action hover | `#0058CC` |
  | on-action | `#FFFFFF` |
  | highlight | `#006EFF` |
  | selected bg | `#EEF4FF` |
  | logo dot | `#2C71F0` |
  | brand light | `#4D94FF` |

- **Dark palette** (overrides only; everything else inherits from light):

  | Token | Value |
  |---|---|
  | canvas | `#121417` |
  | surface | `#1A1D22` |
  | elevated | `#22262C` |
  | recessed | `#0E1013` |
  | line | `#2C313A` |
  | text strong | `#FFFFFF` |
  | text default | `#E6E9EF` |
  | text subtle | `#9AA3B2` |
  | link | `#4D94FF` |
  | highlight | `#4D94FF` |
  | selected bg | `#1B2A44` |

- `#0B1021` must not appear anywhere.
- **Contrast:**
  - Body and link text must reach at least 4.5:1.
  - Large text, focus rings, and the logo dot on the top bar must reach at least 3:1.
- **Unchanged identifiers.** Do not rename any of these:
  - cookie names
  - Durable Object classes
  - KV, D1, or R2 bindings
  - `vibesdk-vault-vmk`
  - the `vibesdk-sidebar-wrapper` CSS class
  - the `@cf-vibesdk/sdk` package
  - the `VIBESDK_API_KEY` env name
  - Monaco's `'vibesdk'` theme id
  - `OrangeButton` and other component names
  - `worker/agents/think/prompts/*.txt`
- **Cloudflare logos stay** only where they mark a real Cloudflare integration. The allowlist is in Task 9.
- **Imports:**
  - Frontend code imports brand values via `@/brand`.
  - Worker code imports via a relative path to `shared/brand`.
- **File naming:** new React components use PascalCase file names (CLAUDE.md rule).
- **No `any`. No emojis in code or comments.**
- **Never commit `wrangler.jsonc`.** Its local edits remove the Artifacts and dispatch bindings and turn off containers, and are dev-only. Never commit `.dev.vars`.
- **Commands:**
  - Run a single test file with `bun run test <path>`, which runs `vitest run <path>`.
  - Typecheck with `bun run typecheck`; lint with `bun run lint`.

## Review Focus

1. **Signed-out visitor.**
   - Top bar shows Sign In and no avatar.
   - The sidebar footer has no empty gap where the avatar was.
   - Sign In opens the auth modal.
   - Covered by a manual step in Task 6.
2. **Mobile width (<768px).**
   - The sidebar drawer opens below the navy bar, overlays the content, and closes on outside tap.
   - The bar does not overflow horizontally.
   - Covered by a manual step in Task 6.
3. **System dark mode with no stored preference.**
   - On first load, the inline script sets `data-mode="dark"` and the Estori dark palette applies with no flash of orange.
   - Covered by a manual step in Task 4.
4. **A component reads a Kumo token the theme does not override.**
   - Leftover orange or Cloudflare blue appears, for example in Kumo badges, buttons, or focus rings.
   - Covered by the full-screen sweep in Task 9; fixes go in `estori-theme.css`.
5. **Upstream adds a new file that renders `CloudflareLogo` for branding.**
   - The allowlist rule fails and names the file.
   - Covered by a deliberate negative check in Task 9.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/brand.ts` (new) | Brand constants used by frontend and worker |
| `src/brand/index.ts` (new) | Frontend entry: re-exports `BRAND`, logos, `pageTitle` |
| `src/brand/EstoriLogo.tsx` (new) | Full wordmark component (`currentColor` letters, blue dot) |
| `src/brand/EstoriGlyph.tsx` (new) | Square "e." monogram component |
| `src/brand/page-title.ts` (new) | `pageTitle(page?)` helper for `<title>` elements |
| `src/brand/assets/estori-logo.svg`, `estori-glyph.svg` (new) | Generated from estori/core's `logo-estori.svg` |
| `src/brand/brand-guard.test.ts` (new) | Source-scanning regression guard, grown task by task |
| `src/brand/brand-assets.test.ts` (new) | Asserts the generated SVG structure |
| `src/brand/palette-contrast.test.ts` (new) | WCAG contrast checks over the theme palette |
| `src/styles/estori-theme.css` (new) | Palette plus token mapping plus small brand overrides |
| `src/components/layout/EstoriTopBar.tsx` (new) | Navy top bar: logo, avatar menu, Sign In |
| `worker/agents/think/persona.ts` (new) | Identity block and `composeSystemPrompt` |
| `worker/agents/think/persona.test.ts` (new) | Persona tests |
| `public/favicon.svg` (new), `public/favicon.ico` (replaced) | Favicon |
| Upstream edits | See each task |

---

### Task 1: Commit the dev-port fixes and the design docs

The working tree already holds two code fixes from local setup, plus the spec and this plan. They go in first, separately from the rebrand. `wrangler.jsonc` also has local-only edits that must never be committed.

**Files:**
- Commit: `worker/config/security.ts`, `worker/agents/core/behaviors/think.ts`
- Commit: `docs/superpowers/specs/2026-10-04-estori-rebrand-design.md`, `docs/superpowers/plans/2026-10-04-estori-rebrand.md`
- Leave unstaged: `wrangler.jsonc`

**Interfaces:**
- Consumes: nothing
- Produces: a clean base for Tasks 2 to 9

- [ ] **Step 1: Inspect the working tree**

Run: `git status --short`

Expected output, in any order:

```
 M worker/agents/core/behaviors/think.ts
 M worker/config/security.ts
 M wrangler.jsonc
?? docs/superpowers/
```

- [ ] **Step 2: Confirm the code diff is only the dev-origin change**

Run: `git diff worker/config/security.ts worker/agents/core/behaviors/think.ts`

Expected:
- `security.ts` adds `env.DEV_BROWSER_PREVIEW_ORIGIN` to the dev origins.
- `think.ts` returns `this.env.DEV_BROWSER_PREVIEW_ORIGIN || 'http://localhost:5173'` in `getPublicOrigin()`.

- [ ] **Step 3: Commit the fixes**

```bash
git add worker/config/security.ts worker/agents/core/behaviors/think.ts
git commit -m "fix(dev): honor DEV_BROWSER_PREVIEW_ORIGIN for CORS and Think preview URLs"
```

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/specs/2026-10-04-estori-rebrand-design.md docs/superpowers/plans/2026-10-04-estori-rebrand.md
git commit -m "docs: add Estori rebrand design and implementation plan"
```

- [ ] **Step 5: Verify `wrangler.jsonc` is still uncommitted**

Run: `git status --short`

Expected: only ` M wrangler.jsonc`.

---

### Task 2: Brand constants, guard harness, and worker branding

**Files:**
- Create: `shared/brand.ts`
- Create: `src/brand/brand-guard.test.ts`
- Modify: `worker/agents/git/git.ts:1-8` (import) and `:45` (default author)
- Modify: `worker/agents/core/behaviors/think.ts:322` (prompt heading)

**Interfaces:**
- Consumes: nothing
- Produces:
  - `BRAND` from `shared/brand.ts`, typed as:
    ```ts
    {
      readonly name: 'Estori';
      readonly assistantName: 'Estori';
      readonly description: string;
      readonly domain: 'getestori.com';
      readonly gitAuthor: { readonly name: 'Estori'; readonly email: 'bot@getestori.com' };
    }
    ```
  - In `src/brand/brand-guard.test.ts`: the helpers `findMatches(sources, pattern, allow?)` and `source(sources, path)`, and the constants `workerSources` and `frontendSources`. Later tasks add `describe` blocks to this file.

- [ ] **Step 1: Write the failing guard test**

Create `src/brand/brand-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

type Sources = Record<string, string>;

const workerSources = import.meta.glob<string>(
	['/worker/**/*.ts', '!/worker/**/*.test.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

const frontendSources = import.meta.glob<string>(
	['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'],
	{ query: '?raw', import: 'default', eager: true },
);

/** Lines matching `pattern` in `sources`, formatted as `path:line: text`. */
function findMatches(
	sources: Sources,
	pattern: RegExp,
	allow: readonly string[] = [],
): string[] {
	return Object.entries(sources)
		.filter(([path]) => !allow.includes(path))
		.flatMap(([path, text]) =>
			text
				.split('\n')
				.flatMap((line, index) =>
					pattern.test(line) ? [`${path}:${index + 1}: ${line.trim()}`] : [],
				),
		);
}

function source(sources: Sources, path: string): string {
	const text = sources[path];
	if (text === undefined) {
		throw new Error(`Source not found: ${path}`);
	}
	return text;
}

describe('brand guard: harness', () => {
	it('loads worker and frontend sources', () => {
		expect(Object.keys(workerSources).length).toBeGreaterThan(50);
		expect(Object.keys(frontendSources).length).toBeGreaterThan(50);
	});
});

describe('brand guard: worker', () => {
	it('does not commit as the VibeSDK bot', () => {
		expect(findMatches(workerSources, /vibesdk-bot@cloudflare\.com/)).toEqual([]);
	});

	it('defaults git commits to the brand author', () => {
		expect(source(workerSources, '/worker/agents/git/git.ts')).toContain(
			'BRAND.gitAuthor',
		);
	});

	it('does not name VibeSDK in agent prompts', () => {
		expect(findMatches(workerSources, /VibeSDK-specific/)).toEqual([]);
	});
});
```

The regex patterns deliberately have no `g` flag, because `RegExp.test` with `g` is stateful across calls.

- [ ] **Step 2: Run it and confirm it fails for the right reasons**

Run: `bun run test src/brand/brand-guard.test.ts`

Expected:
- The harness test PASSES. If it fails, `import.meta.glob` is not resolving; stop and fix the glob before continuing.
- The three worker tests FAIL:
  - one lists `/worker/agents/git/git.ts:45`;
  - one reports that `BRAND.gitAuthor` was not found;
  - one lists `/worker/agents/core/behaviors/think.ts:322`.

- [ ] **Step 3: Create the brand module**

Create `shared/brand.ts`:

```ts
/**
 * Estori brand constants shared by the frontend and the worker.
 * Product name, copy and identity live here so a rebrand is one edit.
 */
export const BRAND = {
	name: 'Estori',
	assistantName: 'Estori',
	description: 'Describe the app you want and Estori builds and deploys it.',
	domain: 'getestori.com',
	gitAuthor: { name: 'Estori', email: 'bot@getestori.com' },
} as const;
```

- [ ] **Step 4: Use the brand author in git**

In `worker/agents/git/git.ts`, add this import after `import * as Diff from 'diff';`:

```ts
import { BRAND } from '../../../shared/brand';
```

Replace line 45:

```ts
        this.author = author || { name: 'Vibesdk', email: 'vibesdk-bot@cloudflare.com' };
```

with:

```ts
        this.author = author || { ...BRAND.gitAuthor };
```

The spread produces a mutable `{ name: string; email: string }` that matches the field type.

- [ ] **Step 5: Neutralize the prompt heading**

In `worker/agents/core/behaviors/think.ts:322`, replace:

```ts
			'## Deploy & verify workflow (VibeSDK-specific)',
```

with:

```ts
			'## Deploy & verify workflow (platform-specific)',
```

- [ ] **Step 6: Run the guard and confirm it passes**

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: all 4 tests PASS.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add shared/brand.ts src/brand/brand-guard.test.ts worker/agents/git/git.ts worker/agents/core/behaviors/think.ts
git commit -m "feat(brand): add Estori brand constants and worker branding guard"
```

---

### Task 3: Agent persona

**Files:**
- Create: `worker/agents/think/persona.ts`
- Create: `worker/agents/think/persona.test.ts`
- Modify: `worker/agents/think/ThinkAgent.ts:69-72` (`DEFAULT_SYSTEM_PROMPT`) and `:282-290` (`getSystemPrompt`)
- Modify: `src/brand/brand-guard.test.ts` (one new test)

**Interfaces:**
- Consumes: `BRAND` (Task 2)
- Produces:
  - `PERSONA_PROMPT: string`
  - `composeSystemPrompt(base: string, projectContext: string): string`

- [ ] **Step 1: Write the failing persona test**

Create `worker/agents/think/persona.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BRAND } from '../../../shared/brand';
import { PERSONA_PROMPT, composeSystemPrompt } from './persona';

describe('PERSONA_PROMPT', () => {
	it('introduces the assistant by the brand name', () => {
		expect(PERSONA_PROMPT.startsWith(`You are ${BRAND.assistantName},`)).toBe(true);
	});

	it('overrides the base prompt identity', () => {
		expect(PERSONA_PROMPT).toContain('never call yourself Think');
	});
});

describe('composeSystemPrompt', () => {
	it('places the persona between the base prompt and the project context', () => {
		expect(composeSystemPrompt('BASE', 'CONTEXT')).toBe(
			`BASE\n\n${PERSONA_PROMPT}\n\nCONTEXT`,
		);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test worker/agents/think/persona.test.ts`

Expected: FAIL, because `./persona` cannot be resolved.

- [ ] **Step 3: Implement the persona module**

Create `worker/agents/think/persona.ts`:

```ts
import { BRAND } from '../../../shared/brand';

/**
 * Identity block placed after the model-family base prompt. The base prompt
 * files (prompts/*.txt) introduce the agent as "Think"; this block names the
 * product instead without editing those upstream files.
 */
export const PERSONA_PROMPT =
	`You are ${BRAND.assistantName}, an expert full-stack engineer building deployable web apps on Cloudflare. ` +
	`Your name is ${BRAND.assistantName}; use it when users ask who you are, and never call yourself Think.`;

export function composeSystemPrompt(base: string, projectContext: string): string {
	return `${base}\n\n${PERSONA_PROMPT}\n\n${projectContext}`;
}
```

- [ ] **Step 4: Run the persona test and confirm it passes**

Run: `bun run test worker/agents/think/persona.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Add the guard rule that ThinkAgent uses the persona**

In `src/brand/brand-guard.test.ts`, add inside `describe('brand guard: worker', ...)`:

```ts
	it('composes the Think system prompt with the brand persona', () => {
		expect(
			source(workerSources, '/worker/agents/think/ThinkAgent.ts'),
		).toContain('composeSystemPrompt(base, projectContext)');
	});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the new test FAILS and the others pass.

- [ ] **Step 6: Wire the persona into ThinkAgent**

In `worker/agents/think/ThinkAgent.ts`, add next to the existing `./prompts` import:

```ts
import { composeSystemPrompt } from './persona';
```

Replace the constant at lines 69-72:

```ts
const DEFAULT_SYSTEM_PROMPT =
	'You are an expert Cloudflare full-stack engineer building deployable web apps. ' +
	'Use the workspace tools to read, write and edit files in the project. Keep changes ' +
	'minimal and runnable.';
```

with:

```ts
const DEFAULT_SYSTEM_PROMPT =
	'Use the workspace tools to read, write and edit files in the project. Keep changes ' +
	'minimal and runnable.';
```

In `getSystemPrompt()`, replace:

```ts
		return `${base}\n\n${projectContext}`;
```

with:

```ts
		return composeSystemPrompt(base, projectContext);
```

- [ ] **Step 7: Run both test files**

Run: `bun run test worker/agents/think/persona.test.ts src/brand/brand-guard.test.ts`

Expected: all PASS.

- [ ] **Step 8: Typecheck and commit**

Run: `bun run typecheck`

Expected: exit 0.

```bash
git add worker/agents/think/persona.ts worker/agents/think/persona.test.ts worker/agents/think/ThinkAgent.ts src/brand/brand-guard.test.ts
git commit -m "feat(brand): give the Think agent the Estori persona"
```

---

### Task 4: Estori theme and document shell

**Files:**
- Create: `src/styles/estori-theme.css`
- Create: `src/brand/palette-contrast.test.ts`
- Modify: `src/index.css:4` (one import line)
- Modify: `index.html`, at four places:
  - the `<html>` tag
  - the font preload `<link>`
  - `<title>`
  - the description `<meta>`
- Modify: `src/brand/brand-guard.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `BRAND` (Task 2)
- Produces:
  - CSS custom properties `--estori-*`, plus `--estori-topbar-h: 3rem`.
  - Tailwind-visible tokens now resolve to Estori values: `--color-brand`, `--color-kumo-*`, `--text-color-kumo-*`, `--build-chat-colors-*`, `--font-sans`, `--font-funky-mono`.
  - Task 6 uses `--estori-topbar`, `--estori-topbar-line`, `--estori-topbar-text` and `--estori-topbar-h`.

- [ ] **Step 1: Write the failing palette test**

Create `src/brand/palette-contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import themeCss from '../styles/estori-theme.css?raw';

type Palette = Record<string, string>;

const LIGHT_SELECTOR = ":root[data-theme='estori']";
const DARK_SELECTOR = ":root[data-theme='estori'][data-mode='dark']";

/** Reads `--estori-<name>: #rrggbb;` declarations from the block opened by `selector {`. */
function readPalette(selector: string): Palette {
	const start = themeCss.indexOf(`${selector} {`);
	if (start === -1) {
		throw new Error(`Palette block not found: ${selector}`);
	}
	const body = themeCss.slice(start, themeCss.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/--estori-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map(
			([, name, hex]) => [name, hex.toLowerCase()],
		),
	);
}

function channel(hex: string, offset: number): number {
	const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (high + 0.05) / (low + 0.05);
}

const BODY_TEXT = 4.5;
const LARGE_OR_UI = 3;

const PAIRS: ReadonlyArray<readonly [string, string, number]> = [
	['text-strong', 'canvas', BODY_TEXT],
	['text-default', 'canvas', BODY_TEXT],
	['text-default', 'surface', BODY_TEXT],
	['text-default', 'elevated', BODY_TEXT],
	['text-default', 'recessed', BODY_TEXT],
	['text-default', 'selected-bg', BODY_TEXT],
	['text-subtle', 'canvas', BODY_TEXT],
	['text-subtle', 'surface', BODY_TEXT],
	['text-subtle', 'elevated', BODY_TEXT],
	['text-subtle', 'recessed', BODY_TEXT],
	['link', 'canvas', BODY_TEXT],
	['link', 'surface', BODY_TEXT],
	['link', 'elevated', BODY_TEXT],
	['link', 'selected-bg', BODY_TEXT],
	['on-action', 'action', BODY_TEXT],
	['on-action', 'action-hover', BODY_TEXT],
	['topbar-text', 'topbar', BODY_TEXT],
	['highlight', 'canvas', LARGE_OR_UI],
	['logo-dot', 'topbar', LARGE_OR_UI],
];

const light = readPalette(LIGHT_SELECTOR);
const dark: Palette = { ...light, ...readPalette(DARK_SELECTOR) };

describe('Estori palette', () => {
	it('never uses the excluded navy #0B1021', () => {
		expect(themeCss.toLowerCase()).not.toContain('#0b1021');
	});
});

describe.each([
	['light', light],
	['dark', dark],
] as const)('Estori palette contrast (%s)', (_mode, palette) => {
	it.each(PAIRS)('%s on %s meets %d:1', (fg, bg, minimum) => {
		const foreground = palette[fg];
		const background = palette[bg];
		if (!foreground || !background) {
			throw new Error(`Missing --estori-${fg} or --estori-${bg}`);
		}
		expect(contrast(foreground, background)).toBeGreaterThanOrEqual(minimum);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test src/brand/palette-contrast.test.ts`

Expected: FAIL, because `../styles/estori-theme.css?raw` cannot be found.

- [ ] **Step 3: Create the theme stylesheet**

Create `src/styles/estori-theme.css`:

```css
/*
 * Estori brand theme, active when <html data-theme="estori">.
 *
 * Rules are intentionally unlayered: Kumo's tokens, Tailwind @theme variables
 * and the base tokens in src/index.css all live in cascade layers, and
 * unlayered declarations win over layered ones regardless of source order.
 *
 * The palette is declared once per mode as --estori-* variables; everything
 * else maps onto them. src/brand/palette-contrast.test.ts reads the two
 * palette blocks below, so keep them as plain `--estori-name: #rrggbb;` lines.
 */

:root[data-theme='estori'] {
	--estori-topbar: #11295a;
	--estori-topbar-line: #0e2250;
	--estori-topbar-text: #ffffff;
	--estori-canvas: #ffffff;
	--estori-surface: #ffffff;
	--estori-elevated: #ffffff;
	--estori-recessed: #f7f8fa;
	--estori-line: #e3e8f0;
	--estori-text-strong: #11295a;
	--estori-text-default: #1e2a3b;
	--estori-text-subtle: #5b6576;
	--estori-link: #0062e6;
	--estori-action: #0062e6;
	--estori-action-hover: #0058cc;
	--estori-on-action: #ffffff;
	--estori-highlight: #006eff;
	--estori-selected-bg: #eef4ff;
	--estori-logo-dot: #2c71f0;
	--estori-brand-light: #4d94ff;
}

:root[data-theme='estori'][data-mode='dark'] {
	--estori-canvas: #121417;
	--estori-surface: #1a1d22;
	--estori-elevated: #22262c;
	--estori-recessed: #0e1013;
	--estori-line: #2c313a;
	--estori-text-strong: #ffffff;
	--estori-text-default: #e6e9ef;
	--estori-text-subtle: #9aa3b2;
	--estori-link: #4d94ff;
	--estori-highlight: #4d94ff;
	--estori-selected-bg: #1b2a44;
}

html[data-theme='estori'] {
	--estori-topbar-h: 3rem;

	/* Kumo component tokens */
	--color-kumo-canvas: var(--estori-canvas);
	--color-kumo-base: var(--estori-surface);
	--color-kumo-elevated: var(--estori-elevated);
	--color-kumo-recessed: var(--estori-recessed);
	--color-kumo-line: var(--estori-line);
	--color-kumo-hairline: var(--estori-line);
	--color-kumo-brand: var(--estori-action);
	--color-kumo-brand-hover: var(--estori-action-hover);
	--color-kumo-focus: var(--estori-highlight);
	--text-color-kumo-brand: var(--estori-link);
	--text-color-kumo-link: var(--estori-link);
	--text-color-kumo-strong: var(--estori-text-strong);
	--text-color-kumo-default: var(--estori-text-default);
	--text-color-kumo-subtle: var(--estori-text-subtle);

	/* App tokens from src/index.css */
	--color-brand: var(--estori-action);
	--border: var(--estori-line);
	--input: var(--estori-line);
	--build-chat-colors-brand-primary: var(--estori-action);
	--build-chat-colors-brand-light: var(--estori-brand-light);
	--build-chat-colors-bg-1: var(--estori-recessed);
	--build-chat-colors-bg-2: var(--estori-canvas);
	--build-chat-colors-bg-3: var(--estori-surface);
	--build-chat-colors-bg-4: var(--estori-elevated);
	--build-chat-colors-border-primary: var(--estori-line);
	--build-chat-colors-border-secondary: var(--estori-line);
	--build-chat-colors-border-tertiary: var(--estori-line);
	--build-chat-colors-text-primary: var(--estori-text-default);
	--build-chat-colors-text-secondary: var(--estori-text-default);
	--build-chat-colors-text-tertiary: var(--estori-text-subtle);

	/* Typography: estori/core's system stack; the pixel display font is retired */
	--font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
	--font-funky-mono: var(--font-sans);
}

/* Selected sidebar item uses the Estori tint (Kumo sets this on the wrapper). */
html[data-theme='estori'] .vibesdk-sidebar-wrapper {
	--sidebar-active-bg: var(--estori-selected-bg);
}

/* Flat canvas: no orange spotlight behind the home prompt. */
html[data-theme='estori'] .home-atmosphere {
	display: none;
}

/* Chat edge pulse in brand blue instead of orange. */
html[data-theme='estori'] .chat-edge-throb {
	animation-name: estori-chat-edge-throb;
}

@keyframes estori-chat-edge-throb {
	0%,
	100% {
		box-shadow:
			0 0 0 0 rgb(0 98 230 / 0.1),
			inset 0 0 0 1px rgb(0 98 230 / 0.16);
	}
	50% {
		box-shadow:
			0 0 0 6px rgb(0 98 230 / 0.08),
			inset 0 0 0 2px rgb(0 98 230 / 0.22);
	}
}
```

- [ ] **Step 4: Run the palette test and confirm it passes**

Run: `bun run test src/brand/palette-contrast.test.ts`

Expected: 39 tests PASS (19 pairs × 2 modes, plus the excluded-colour check).

- [ ] **Step 5: Add the document-shell guard rules (failing)**

In `src/brand/brand-guard.test.ts`, add these imports at the top:

```ts
import { BRAND } from '../../shared/brand';
import indexHtml from '../../index.html?raw';
import indexCss from '../index.css?raw';
```

Then append:

```ts
describe('brand guard: document shell', () => {
	it('activates the Estori theme on <html>', () => {
		expect(indexHtml).toContain('<html lang="en" data-theme="estori">');
	});

	it('loads the Estori theme stylesheet', () => {
		expect(indexCss).toContain("@import './styles/estori-theme.css';");
	});

	it('uses the brand title and description', () => {
		expect(indexHtml).toContain(`<title>${BRAND.name}</title>`);
		expect(indexHtml).toContain(
			`<meta name="description" content="${BRAND.description}" />`,
		);
	});

	it('does not preload the retired pixel font', () => {
		expect(indexHtml).not.toContain('DepartureMono');
	});
});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the 4 new tests FAIL and the rest pass.

- [ ] **Step 6: Load the stylesheet**

In `src/index.css`, add this line directly after `@import 'tw-animate-css';` (line 4):

```css
@import './styles/estori-theme.css';
```

- [ ] **Step 7: Update `index.html`**

Make four changes:

- Replace `<html lang="en">` with `<html lang="en" data-theme="estori">`.
- Delete the whole `<link rel="preload" href="/fonts/DepartureMono-Regular.woff2" ... />` element (the 7 lines starting at `<link` after the favicon link).
- Replace `<title>Build</title>` with `<title>Estori</title>`.
- Replace `<meta name="description" content="Ship your app from idea to v1!" />` with:

```html
		<meta name="description" content="Describe the app you want and Estori builds and deploys it." />
```

- [ ] **Step 8: Run the guard and palette tests**

Run: `bun run test src/brand/brand-guard.test.ts src/brand/palette-contrast.test.ts`

Expected: all PASS.

- [ ] **Step 9: Manual check that the theme applies (Review Focus 3)**

Start or reuse the dev server on port 8100:

```bash
CLOUDFLARE_ACCOUNT_ID=6d16ad8a9f081e4939993391bd35ca4e bun run dev --port 8100 --strictPort
```

Check these in a browser at `http://localhost:8100`:

1. In DevTools → Application → Local Storage, delete the `theme` key. Set the operating system to dark mode and reload. Confirm `<html>` has `data-mode="dark"`, the page background is `#121417`, and no orange shows on first paint.
2. Switch the OS to light mode and reload. Confirm the background is white, the Sign In button is blue `#0062E6`, and the home spotlight is gone.

- [ ] **Step 10: Typecheck, lint, and commit**

Run: `bun run typecheck && bun run lint`

Expected: exit 0.

```bash
git add src/styles/estori-theme.css src/brand/palette-contrast.test.ts src/brand/brand-guard.test.ts src/index.css index.html
git commit -m "feat(brand): add Estori theme tokens and document shell"
```

---

### Task 5: Logo assets, components, and favicon

**Files:**
- Create: `src/brand/assets/estori-logo.svg`, `src/brand/assets/estori-glyph.svg`, `public/favicon.svg`
- Replace: `public/favicon.ico`
- Create: `src/brand/EstoriLogo.tsx`, `src/brand/EstoriGlyph.tsx`, `src/brand/index.ts`
- Create: `src/brand/brand-assets.test.ts`
- Modify: `index.html` (favicon links)
- Modify: `src/brand/brand-guard.test.ts` (one new test)

**Interfaces:**
- Consumes: `BRAND` (Task 2)
- Produces:
  - From `@/brand`: `EstoriLogo(props: SVGProps<SVGSVGElement>)` and `EstoriGlyph(props: SVGProps<SVGSVGElement>)`. Both default `aria-label` to `BRAND.name` and are sized by `className`, for example `h-6 w-auto`.
  - `@/brand` also re-exports `BRAND`.

- [ ] **Step 1: Write the failing asset test**

Create `src/brand/brand-assets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import logoSvg from './assets/estori-logo.svg?raw';
import glyphSvg from './assets/estori-glyph.svg?raw';
import faviconSvg from '../../public/favicon.svg?raw';

function count(text: string, needle: string): number {
	return text.split(needle).length - 1;
}

describe('Estori logo assets', () => {
	it('wordmark letters follow the text color and the dot stays brand blue', () => {
		expect(count(logoSvg, 'fill="currentColor"')).toBe(6);
		expect(count(logoSvg, 'fill="#2C71F0"')).toBe(1);
		expect(logoSvg).not.toMatch(/\swidth="\d+"/);
	});

	it('glyph is a square "e." monogram', () => {
		expect(glyphSvg).toContain('viewBox="-0.88 5.5 38 38"');
		expect(count(glyphSvg, 'fill="currentColor"')).toBe(1);
		expect(count(glyphSvg, 'fill="#2C71F0"')).toBe(1);
	});

	it('favicon is a white "e." on an Estori navy tile', () => {
		expect(faviconSvg).toContain('fill="#11295A"');
		expect(faviconSvg).toContain('fill="#FFFFFF"');
		expect(faviconSvg).toContain('fill="#2C71F0"');
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test src/brand/brand-assets.test.ts`

Expected: FAIL, because `./assets/estori-logo.svg?raw` cannot be found.

- [ ] **Step 3: Generate the SVG assets from estori/core's logo**

The source is `~/Documents/Work/Opensource/estori/apps/editor/public/img/logo-estori.svg`. It contains 7 paths: path 0 is the blue dot, and paths 1 to 6 are the letters "estori".

```bash
mkdir -p src/brand/assets
python3 - <<'EOF'
import re, pathlib
src = pathlib.Path.home() / 'Documents/Work/Opensource/estori/apps/editor/public/img/logo-estori.svg'
svg = src.read_text()
paths = re.findall(r'<path d="([^"]+)" fill="([^"]+)"\s*/>', svg)
assert len(paths) == 7 and paths[0][1] == '#2C71F0', f'unexpected logo structure: {len(paths)} paths'
dot_d, e_d = paths[0][0], paths[1][0]

logo = re.sub(r' (width|height)="\d+"', '', svg, count=2).replace('fill="white"', 'fill="currentColor"')
pathlib.Path('src/brand/assets/estori-logo.svg').write_text(logo)

pathlib.Path('src/brand/assets/estori-glyph.svg').write_text(
    '<svg viewBox="-0.88 5.5 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">\n'
    f'<path d="{e_d}" fill="currentColor"/>\n'
    f'<path d="{dot_d}" fill="#2C71F0" transform="translate(-102.89 0)"/>\n'
    '</svg>\n')

pathlib.Path('public/favicon.svg').write_text(
    '<svg viewBox="-6.88 -0.5 50 50" xmlns="http://www.w3.org/2000/svg">\n'
    '<rect x="-6.88" y="-0.5" width="50" height="50" rx="11" fill="#11295A"/>\n'
    f'<path d="{e_d}" fill="#FFFFFF"/>\n'
    f'<path d="{dot_d}" fill="#2C71F0" transform="translate(-102.89 0)"/>\n'
    '</svg>\n')
print('generated')
EOF
```

Expected output: `generated`.

The glyph geometry comes from the source path bounds:
- The "e" spans x -0.03 to 25.47 and y 11.36 to 37.64.
- The dot spans x 130.39 to 139.16. Translating it by -102.89 puts it 2 units right of the "e".
- Both viewBoxes are centered on the combined bounds.

- [ ] **Step 4: Regenerate `favicon.ico`**

The current file is a PNG with an `.ico` name, so keep that format.

```bash
S=$(mktemp -d)
qlmanage -t -s 96 -o "$S" public/favicon.svg >/dev/null 2>&1
cp "$S/favicon.svg.png" public/favicon.ico
file public/favicon.ico
```

Expected: `public/favicon.ico: PNG image data, 96 x 96, ...`.

- [ ] **Step 5: Run the asset test and confirm it passes**

Run: `bun run test src/brand/brand-assets.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 6: Create the logo components**

Create `src/brand/EstoriLogo.tsx`:

```tsx
import type { SVGProps } from 'react';
import LogoSvg from './assets/estori-logo.svg?react';
import { BRAND } from '../../shared/brand';

/** Full "estori." wordmark. Letters follow `color`; size it with className (e.g. `h-6 w-auto`). */
export function EstoriLogo({
	'aria-label': ariaLabel = BRAND.name,
	...props
}: SVGProps<SVGSVGElement>) {
	return <LogoSvg role="img" aria-label={ariaLabel} {...props} />;
}
```

Create `src/brand/EstoriGlyph.tsx`:

```tsx
import type { SVGProps } from 'react';
import GlyphSvg from './assets/estori-glyph.svg?react';
import { BRAND } from '../../shared/brand';

/** Square "e." monogram for icon-sized spots. The "e" follows `color`. */
export function EstoriGlyph({
	'aria-label': ariaLabel = BRAND.name,
	...props
}: SVGProps<SVGSVGElement>) {
	return <GlyphSvg role="img" aria-label={ariaLabel} {...props} />;
}
```

Create `src/brand/index.ts`:

```ts
export { BRAND } from '../../shared/brand';
export { EstoriLogo } from './EstoriLogo';
export { EstoriGlyph } from './EstoriGlyph';
```

- [ ] **Step 7: Add the favicon guard rule (failing)**

In `src/brand/brand-guard.test.ts`, add inside `describe('brand guard: document shell', ...)`:

```ts
	it('uses the Estori favicon', () => {
		expect(indexHtml).toContain(
			'<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
		);
	});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the new test FAILS.

- [ ] **Step 8: Point `index.html` at the new favicon**

Replace:

```html
		<link rel="icon" href="/favicon.ico" />
```

with:

```html
		<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
		<link rel="alternate icon" href="/favicon.ico" />
```

- [ ] **Step 9: Run tests, typecheck, and lint**

Run: `bun run test src/brand && bun run typecheck && bun run lint`

Expected: all PASS, exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/brand/assets src/brand/EstoriLogo.tsx src/brand/EstoriGlyph.tsx src/brand/index.ts src/brand/brand-assets.test.ts src/brand/brand-guard.test.ts public/favicon.svg public/favicon.ico index.html
git commit -m "feat(brand): add Estori logo, glyph and favicon"
```

---

### Task 6: Navy top bar layout

**Files:**
- Create: `src/components/layout/EstoriTopBar.tsx`
- Modify: `src/components/layout/app-layout.tsx:49-73` (the `AppLayout` return)
- Modify: `src/components/layout/app-sidebar.tsx`, at three places:
  - `:13` (import)
  - `:26` (import)
  - the `<Sidebar.Header>` block around `:257-295`
  - the footer `AuthButton` block around `:622-633`
- Modify: `src/components/layout/global-header.tsx`, at three places:
  - `:3,5,15,16` (imports)
  - `:20-21` (hooks)
  - `:76-84` (Sign In)
- Modify: `src/components/header.tsx:3,19-22`
- Modify: `src/brand/brand-guard.test.ts` (new `describe`)

**Interfaces:**
- Consumes:
  - `EstoriLogo` and `BRAND` from `@/brand` (Task 5)
  - `--estori-topbar*` variables (Task 4)
  - existing `AuthButton({ display: 'icon' | 'sidebar' })`, `OrangeButton({ size, onClick, icon })`, `useAuth()`, `useAuthModal()`
- Produces: `EstoriTopBar()`, with no props

- [ ] **Step 1: Write the failing layout guard rules**

Append to `src/brand/brand-guard.test.ts`:

```ts
describe('brand guard: layout', () => {
	it('renders the Estori top bar above a contained sidebar', () => {
		const layout = source(frontendSources, '/src/components/layout/app-layout.tsx');
		expect(layout).toContain('<EstoriTopBar />');
		expect(layout).toMatch(/^\s*contained\s*$/m);
	});

	it('drops the BUILD wordmark from the sidebar', () => {
		expect(
			findMatches(
				{ sidebar: source(frontendSources, '/src/components/layout/app-sidebar.tsx') },
				/^\s*Build\s*$/,
			),
		).toEqual([]);
	});

	it('offers Sign In from the top bar only', () => {
		expect(
			source(frontendSources, '/src/components/layout/global-header.tsx'),
		).not.toContain('Sign In');
		expect(
			source(frontendSources, '/src/components/layout/EstoriTopBar.tsx'),
		).toContain('Sign In');
	});

	it('brands the standalone header', () => {
		expect(source(frontendSources, '/src/components/header.tsx')).not.toContain(
			'CloudflareLogo',
		);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the 4 layout tests FAIL. The "Sign In" test throws `Source not found: /src/components/layout/EstoriTopBar.tsx`.

- [ ] **Step 3: Create the top bar**

Create `src/components/layout/EstoriTopBar.tsx`:

```tsx
import { Link } from 'react-router';
import { SignInIcon } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { AuthButton } from '@/components/auth/auth-button';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { BRAND, EstoriLogo } from '@/brand';

/** Full-width navy bar above the sidebar: logo, account menu and Sign In. */
export function EstoriTopBar() {
	const { user, isLoading: authLoading } = useAuth();
	const { showAuthModal } = useAuthModal();

	return (
		<header className="flex h-(--estori-topbar-h) shrink-0 items-center justify-between border-b border-(--estori-topbar-line) bg-(--estori-topbar) px-4 text-(--estori-topbar-text)">
			<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center">
				<EstoriLogo className="h-6 w-auto" />
			</Link>
			<div className="flex items-center gap-2">
				{user && <AuthButton display="icon" />}
				{!authLoading && !user && (
					<OrangeButton
						size="sm"
						onClick={() => showAuthModal()}
						icon={<SignInIcon className="size-4" />}
					>
						Sign In
					</OrangeButton>
				)}
			</div>
		</header>
	);
}
```

- [ ] **Step 4: Put the bar above a contained sidebar**

In `src/components/layout/app-layout.tsx`, add this import after `import { HeaderProvider } from './header-context';`:

```tsx
import { EstoriTopBar } from './EstoriTopBar';
```

Replace the whole `return ( ... );` of `AppLayout` with:

```tsx
	return (
		<div className="flex h-svh flex-col">
			<EstoriTopBar />
			<SidebarProvider
				defaultOpen={defaultOpen}
				collapsible="icon"
				resizable={false}
				mobileBreakpoint={768}
				// peekable
				onOpenChange={persistSidebarState}
				contained
				className="vibesdk-sidebar-wrapper min-h-0 flex-1"
			>
				<HeaderProvider>
					<SidebarKeyboardShortcut />
					<AppSidebar />
					<main className="bg-kumo-canvas flex flex-col h-full relative flex-1 min-w-0 overflow-hidden">
						<GlobalHeader />
						<div className="flex-1 min-h-0 overflow-auto bg-kumo-canvas">
							{children || <Outlet />}
						</div>
					</main>
				</HeaderProvider>
			</SidebarProvider>
		</div>
	);
```

`contained` makes Kumo position the mobile drawer `absolute` inside the wrapper instead of `fixed` to the viewport, and stops the wrapper forcing `min-h-svh`. The desktop sidebar is already `relative h-full`.

- [ ] **Step 5: Simplify the sidebar header and footer**

In `src/components/layout/app-sidebar.tsx`:

**Imports.**
- Line 13: replace `import { Link, useLocation, useNavigate } from 'react-router';` with `import { useLocation, useNavigate } from 'react-router';`.
- Line 26: delete `import { AuthButton } from '@/components/auth/auth-button';`.
- Keep `CloudflareLogo` in the Kumo import; the footer Cloudflare CTA still uses it.

**Header.** Replace the whole block, from `<Sidebar.Header` through its closing `</Sidebar.Header>`. That block currently contains the collapsed glyph, the `CloudflareLogo` plus "Build" link, and two `Sidebar.Trigger`s. Replace it with:

```tsx
			<Sidebar.Header
				className={cn(
					'h-12',
					isCollapsed ? 'justify-center px-0' : 'justify-end px-3',
				)}
			>
				<Sidebar.Trigger
					aria-label={isCollapsed ? 'Open sidebar' : 'Collapse sidebar'}
					className="flex size-9 shrink-0 items-center justify-center"
				/>
			</Sidebar.Header>
```

**Footer.** Delete the avatar block; the avatar now lives in the top bar:

```tsx
						{user && (
							<div className="min-w-0 flex-1">
								<AuthButton
									display="sidebar"
									className={cn(
										'w-full',
										isCollapsed &&
											'size-9 flex-none justify-center px-0',
									)}
								/>
							</div>
						)}
```

Keep the `<ThemeToggle ... />` that follows it.

- [ ] **Step 6: Remove Sign In from the in-page header**

In `src/components/layout/global-header.tsx`, delete these lines:

```tsx
import { useAuth } from '@/contexts/auth-context';
import { SignInIcon } from '@phosphor-icons/react';
import { OrangeButton } from '@/components/shared/OrangeButton';
import { useAuthModal } from '../auth/AuthModalProvider';
```

```tsx
	const { user, isLoading: authLoading } = useAuth();
	const { showAuthModal } = useAuthModal();
```

```tsx
						{!authLoading && !user && (
							<OrangeButton
								size="sm"
								onClick={() => showAuthModal()}
								icon={<SignInIcon className="size-4" />}
							>
								Sign In
							</OrangeButton>
						)}
```

- [ ] **Step 7: Brand the standalone header**

In `src/components/header.tsx`, replace `import { CloudflareLogo } from './icons/logos';` with:

```tsx
import { BRAND, EstoriLogo } from '@/brand';
```

Replace:

```tsx
					<CloudflareLogo
						className="h-4 text-bg-bright-dim"
						aria-label="Cloudflare v1"
					/>
```

with:

```tsx
					<EstoriLogo className="h-5 w-auto text-kumo-strong" aria-label={BRAND.name} />
```

- [ ] **Step 8: Run tests, typecheck, and lint**

Run: `bun run test src/brand && bun run typecheck && bun run lint`

Expected: all PASS, exit 0. If lint reports unused `user` or `cn` in `app-sidebar.tsx`, check before removing anything: both are still used elsewhere in that file (`user` at the apps sections, `cn` throughout), so a report means the edit went wrong.

- [ ] **Step 9: Manual layout check (Review Focus 1, 2)**

With the dev server on 8100, use a browser:

1. **Signed in, desktop.**
   - The navy bar spans the full width, with the white "estori." logo on the left and the avatar on the right.
   - The sidebar starts below the bar.
   - Collapse and expand with the trigger and with Cmd+B.
   - The page scrolls inside `<main>`, not the window.
2. **Signed out** (open a private window):
   - The bar shows Sign In and clicking it opens the auth modal.
   - The sidebar footer shows only the theme toggle, with no empty gap.
3. **Width 375px:**
   - The bar does not overflow.
   - The in-page header shows the sidebar toggle. Tapping it opens the drawer below the navy bar, and tapping outside closes it.
4. **Avatar fallback:** if the user has no avatar image, the initials circle is legible on navy.

- [ ] **Step 10: Commit**

```bash
git add src/components/layout/EstoriTopBar.tsx src/components/layout/app-layout.tsx src/components/layout/app-sidebar.tsx src/components/layout/global-header.tsx src/components/header.tsx src/brand/brand-guard.test.ts
git commit -m "feat(brand): add Estori navy top bar above a contained sidebar"
```

---

### Task 7: Page titles, copy, and assistant name

**Files:**
- Create: `src/brand/page-title.ts`, `src/brand/page-title.test.ts`
- Modify: `src/brand/index.ts` (export `pageTitle`)
- Modify page titles:
  - `src/routes/home.tsx:188`
  - `src/routes/chat/chat.tsx:1085,1117-1119`
  - `src/routes/app/index.tsx:623,632,662`
  - `src/routes/apps/index.tsx:68`
  - `src/routes/discover/index.tsx:71`
  - `src/routes/settings/index.tsx:252`
  - `src/routes/profile.tsx:147-151`
- Modify: `src/routes/home.tsx:207-212` (headline)
- Modify: `src/routes/settings/index.tsx:282,357,496` (copy)
- Modify: `src/routes/chat/components/messages.tsx:863-865` (assistant label)
- Modify: `src/contexts/vault-context.tsx:318` (passkey display name)
- Modify: `src/brand/brand-guard.test.ts` (new `describe`)

**Interfaces:**
- Consumes: `BRAND` (Task 2)
- Produces: `pageTitle(page?: string): string`, exported from `@/brand`

- [ ] **Step 1: Write the failing `pageTitle` test**

Create `src/brand/page-title.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pageTitle } from './page-title';

describe('pageTitle', () => {
	it('returns the brand name alone for the home page', () => {
		expect(pageTitle()).toBe('Estori');
	});

	it('suffixes page names with the brand name', () => {
		expect(pageTitle('Settings')).toBe('Settings - Estori');
	});

	it('treats a blank page name as the home page', () => {
		expect(pageTitle('   ')).toBe('Estori');
	});
});
```

Run: `bun run test src/brand/page-title.test.ts`

Expected: FAIL, because `./page-title` cannot be resolved.

- [ ] **Step 2: Implement it**

Create `src/brand/page-title.ts`:

```ts
import { BRAND } from '../../shared/brand';

/** Document title for a page: "<page> - Estori", or "Estori" with no page. */
export function pageTitle(page?: string): string {
	const trimmed = page?.trim();
	return trimmed ? `${trimmed} - ${BRAND.name}` : BRAND.name;
}
```

Add to `src/brand/index.ts`:

```ts
export { pageTitle } from './page-title';
```

Run: `bun run test src/brand/page-title.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 3: Write the failing copy guard rules**

Append to `src/brand/brand-guard.test.ts`:

```ts
describe('brand guard: copy', () => {
	it('titles pages with the brand name', () => {
		expect(
			findMatches(frontendSources, /- Build(?=[`'"<])|<title>Build<\/title>/),
		).toEqual([]);
	});

	it('does not show the VibeSDK name', () => {
		expect(findMatches(frontendSources, /VibeSDK/)).toEqual([]);
	});

	it('names the assistant after the brand', () => {
		expect(findMatches(frontendSources, /^\s*Orange\s*$/)).toEqual([]);
	});

	it('drops the uppercase BUILD headline', () => {
		expect(source(frontendSources, '/src/routes/home.tsx')).not.toContain(
			'uppercase text-brand-emphasis',
		);
	});

	it('labels passkeys with the brand name', () => {
		expect(findMatches(frontendSources, /rp: \{ name: 'vibesdk'/)).toEqual([]);
	});
});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the 5 copy tests FAIL. The title rule lists 11 lines, and the VibeSDK rule lists `settings/index.tsx:282,357,496`.

- [ ] **Step 4: Replace page titles**

In each file, add `import { pageTitle } from '@/brand';` next to the other `@/` imports, then make these replacements:

| File | Old | New |
|---|---|---|
| `src/routes/home.tsx:188` | `<title>Build</title>` | `<title>{pageTitle()}</title>` |
| `src/routes/chat/chat.tsx:1085` | `<title>Start building - Build</title>` | `<title>{pageTitle('Start building')}</title>` |
| `src/routes/chat/chat.tsx:1118` | `` {headerTitle ? `${headerTitle} - Build` : 'Chat - Build'} `` | `{pageTitle(headerTitle \|\| 'Chat')}` |
| `src/routes/app/index.tsx:623` | `<title>Loading - Build</title>` | `<title>{pageTitle('Loading')}</title>` |
| `src/routes/app/index.tsx:632` | `<title>App not found - Build</title>` | `<title>{pageTitle('App not found')}</title>` |
| `src/routes/app/index.tsx:662` | `` <title>{app.title ? `${app.title} - Build` : 'App - Build'}</title> `` | `<title>{pageTitle(app.title \|\| 'App')}</title>` |
| `src/routes/apps/index.tsx:68` | `<title>My Apps - Build</title>` | `<title>{pageTitle('My Apps')}</title>` |
| `src/routes/discover/index.tsx:71` | `<title>Discover - Build</title>` | `<title>{pageTitle('Discover')}</title>` |
| `src/routes/settings/index.tsx:252` | `<title>Settings - Build</title>` | `<title>{pageTitle('Settings')}</title>` |
| `src/routes/profile.tsx:148-150` | `` {user?.displayName ? `${user.displayName} - Profile - Build` : 'Profile - Build'} `` | `` {pageTitle(user?.displayName ? `${user.displayName} - Profile` : 'Profile')} `` |

The `\|` in the table is a markdown escape; write a plain `||` in code.

- [ ] **Step 5: Restyle the home headline**

In `src/routes/home.tsx`, replace:

```tsx
							<h1 className="w-full text-center text-[clamp(1.75rem,4.5vw,2.5rem)] font-semibold leading-[1.12] text-kumo-strong/80 z-20">
								What should we{' '}
								<span className="font-funky-mono font-bold text-[1.1em] tracking-tighter uppercase text-brand-emphasis">
									build
								</span>{' '}
								today?
							</h1>
```

with:

```tsx
							<h1 className="w-full text-center text-[clamp(1.75rem,4.5vw,2.5rem)] font-semibold leading-[1.12] text-kumo-strong z-20">
								What should we{' '}
								<span className="text-brand-emphasis">build</span>{' '}
								today?
							</h1>
```

- [ ] **Step 6: Settings copy**

In `src/routes/settings/index.tsx`, add `import { BRAND } from '@/brand';` (merge with the `pageTitle` import from Step 4, giving `import { BRAND, pageTitle } from '@/brand';`). Then make three replacements:

- Line 282: `VibeSDK API keys` becomes `{BRAND.name} API keys`.
- Line 357: `act as your VibeSDK` becomes `act as your {BRAND.name}`.
- Line 496: `VibeSDK SDK from your own` becomes `{BRAND.name} SDK from your own`.

Leave `VIBESDK_API_KEY=` at line 435 unchanged.

- [ ] **Step 7: Assistant label**

In `src/routes/chat/components/messages.tsx`, add `import { BRAND } from '@/brand';`, then replace:

```tsx
				<AIAvatar className="size-5 text-orange-500 shrink-0" />
				Orange
				{isThinking && <Sparkles className="size-3 text-orange-400 animate-pulse" />}
```

with:

```tsx
				<AIAvatar className="size-5 text-brand shrink-0" />
				{BRAND.assistantName}
				{isThinking && <Sparkles className="size-3 text-brand animate-pulse" />}
```

- [ ] **Step 8: Passkey display name**

In `src/contexts/vault-context.tsx`, add `import { BRAND } from '@/brand';`, then replace:

```ts
					rp: { name: 'vibesdk', id: window.location.hostname },
```

with:

```ts
					rp: { name: BRAND.name, id: window.location.hostname },
```

`rp.id` stays the hostname, so existing passkeys keep working.

- [ ] **Step 9: Run tests, typecheck, and lint**

Run: `bun run test src/brand && bun run typecheck && bun run lint`

Expected: all PASS, exit 0.

- [ ] **Step 10: Commit**

```bash
git add src/brand/page-title.ts src/brand/page-title.test.ts src/brand/index.ts src/brand/brand-guard.test.ts src/routes src/contexts/vault-context.tsx
git commit -m "feat(brand): Estori page titles, copy and assistant name"
```

---

### Task 8: Brand color cleanup and deploy copy

**Files:**
- Modify: `src/routes/chat/components/thinking-indicator.tsx:73`
- Modify: `src/routes/chat/components/phase-timeline.tsx:367,540-541,636,875-881`
- Modify: `src/routes/chat/components/terminal.tsx:99`
- Modify: `src/routes/chat/components/deployment-controls.tsx:103-105,188,208,218,232,251,316`
- Modify: `src/routes/chat/chat.tsx:17-21,428` (deploy icon)
- Modify: `src/components/credits-banner.tsx:4,94`
- Modify: `src/brand/brand-guard.test.ts` (new `describe`)

**Interfaces:**
- Consumes:
  - `BRAND` and `EstoriGlyph` from `@/brand`
  - Tailwind `brand` utilities (`text-brand`, `bg-brand`, `border-brand`), which now resolve to `#0062E6` via Task 4
- Produces: nothing new

**Leave these semantic oranges unchanged**, because they mean "warning" or a third-party brand:
- `phase-timeline.tsx:51,63,93,724-725`
- `preview-iframe.tsx:410`
- `model-helpers.ts:32` (the Anthropic badge)
- `github-export-modal.tsx:357`
- `debug-panel.tsx:334`

- [ ] **Step 1: Write the failing color and copy guard rules**

Append to `src/brand/brand-guard.test.ts`:

```ts
describe('brand guard: brand color and deploy copy', () => {
	const BRAND_COLOR_FILES = [
		'/src/routes/chat/components/messages.tsx',
		'/src/routes/chat/components/thinking-indicator.tsx',
		'/src/routes/chat/components/deployment-controls.tsx',
	];

	it('uses brand tokens instead of orange in brand surfaces', () => {
		const brandSurfaces = Object.fromEntries(
			BRAND_COLOR_FILES.map((path) => [path, source(frontendSources, path)]),
		);
		expect(findMatches(brandSurfaces, /-orange-\d{2,3}/)).toEqual([]);
	});

	it('shows the preview deploy state in brand colors', () => {
		const timeline = source(frontendSources, '/src/routes/chat/components/phase-timeline.tsx');
		expect(timeline).not.toContain('color="orange"');
		expect(timeline).toContain('text-brand">Deploying preview...');
	});

	it('does not label platform deploys as Cloudflare', () => {
		expect(findMatches(frontendSources, /Deploy(ing)? to Cloudflare|Redeploying to Cloudflare|Cloudflare Workers for Platforms/)).toEqual([]);
	});

	it('shows the Estori glyph next to platform credits', () => {
		expect(source(frontendSources, '/src/components/credits-banner.tsx')).toContain(
			'<EstoriGlyph className="w-3.5 h-3.5" />',
		);
	});
});
```

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: the 4 new tests FAIL.

- [ ] **Step 2: Thinking indicator**

In `src/routes/chat/components/thinking-indicator.tsx:73`, replace `<Sparkles className="size-3 text-orange-400" />` with `<Sparkles className="size-3 text-brand" />`.

- [ ] **Step 3: Phase timeline**

In `src/routes/chat/components/phase-timeline.tsx`:
- Line 367: replace `icon: <StatusLoader color="orange" />,` with `icon: <StatusLoader color="brand" />,`.
- Lines 540-541: this collapsed-bar button always deploys to the platform (`handleDeployToCloudflare(chatId)` passes no target). Replace `'Deploy to Cloudflare'` with `'Deploy'` in both the `title` and the `aria-label` expressions:

```tsx
                                        title={isDeploying ? 'Deploying...' : 'Deploy'}
                                        aria-label={isDeploying ? 'Deploying' : 'Deploy'}
```

- Line 636: replace `{isDeploying ? 'Deploying...' : 'Deploy to Cloudflare'}` with `{isDeploying ? 'Deploying...' : 'Deploy'}`.
- Lines 875-881: replace:

```tsx
												<div className="space-y-1 relative bg-orange-50/5 border border-orange-200/20 rounded-lg p-3">
													<div className="flex items-center gap-2">
														<StatusLoader size="sm" color="orange" />
														<span className="text-sm font-medium text-orange-400">Deploying preview...</span>
													</div>
													<span className="text-xs text-orange-300/80 ml-5">Updating your preview environment</span>
												</div>
```

with:

```tsx
												<div className="space-y-1 relative bg-brand/5 border border-brand/20 rounded-lg p-3">
													<div className="flex items-center gap-2">
														<StatusLoader size="sm" color="brand" />
														<span className="text-sm font-medium text-brand">Deploying preview...</span>
													</div>
													<span className="text-xs text-text-tertiary ml-5">Updating your preview environment</span>
												</div>
```

- [ ] **Step 4: Terminal comment**

In `src/routes/chat/components/terminal.tsx:99`, replace `return 'text-kumo-brand-primary'; // Cloudflare orange` with `return 'text-kumo-brand-primary'; // brand accent`.

- [ ] **Step 5: Deployment controls**

In `src/routes/chat/components/deployment-controls.tsx`, add `import { BRAND } from '@/brand';`.

Replace the destination constant:

```tsx
	const destination = deploymentTarget === 'user'
		? 'your Cloudflare account'
		: 'Cloudflare Workers for Platforms';
```

with:

```tsx
	const destination = deploymentTarget === 'user'
		? 'your Cloudflare account'
		: `${BRAND.name} hosting`;
```

Make these single-line replacements:

| Line | Old | New |
|---|---|---|
| 188 | `title: "Deploy to Cloudflare",` | `title: deploymentTarget === 'user' ? 'Deploy to your Cloudflare account' : 'Deploy',` |
| 208 | `buttonClass: "bg-brand text-white border-orange-500 dark:border-orange-600 hover:scale-105"` | `buttonClass: "bg-brand text-white border-brand hover:scale-105"` |
| 218 | `title: "Deploying to Cloudflare",` | `title: deploymentTarget === 'user' ? 'Deploying to your Cloudflare account' : 'Deploying',` |
| 232 | `title: "Redeploying to Cloudflare",` | `title: deploymentTarget === 'user' ? 'Redeploying to your Cloudflare account' : 'Redeploying',` |
| 251 | `? "bg-orange-500 hover:bg-orange-600 dark:bg-orange-600 dark:hover:bg-orange-700 text-white border-orange-500 dark:border-orange-600 hover:scale-105"` | `? "bg-brand hover:bg-brand/90 text-white border-brand hover:scale-105"` |
| 316 | `{deploymentTarget === 'user' ? 'Deploy to My Account' : 'Deploy to Cloudflare'}` | `{deploymentTarget === 'user' ? 'Deploy to your Cloudflare account' : 'Deploy'}` |

- [ ] **Step 6: Chat deploy icon**

In `src/routes/chat/chat.tsx`, extend the `lucide-react` import (lines 17-21) to:

```tsx
import {
	ExternalLink,
	LoaderCircle,
	Rocket,
	RotateCcw,
} from 'lucide-react';
```

At line 428, replace:

```tsx
									<CloudflareLogo className="size-3.5" />
```

with:

```tsx
									userAccountDeployEnabled ? (
										<CloudflareLogo className="size-3.5" />
									) : (
										<Rocket className="size-3.5" />
									)
```

It sits in the false branch of `isDeploying ? (<LoaderCircle .../>) : (...)`, so the result is a nested ternary inside the existing parentheses.

- [ ] **Step 7: Credits banner glyph**

In `src/components/credits-banner.tsx`, keep `import { CloudflareLogo } from './icons/logos';`, because the Connect button at line 233 still uses it. Add:

```tsx
import { EstoriGlyph } from '@/brand';
```

At line 94, replace `<CloudflareLogo className="w-3.5 h-3.5" />` with `<EstoriGlyph className="w-3.5 h-3.5" />`.

- [ ] **Step 8: Run tests, typecheck, and lint**

Run: `bun run test src/brand && bun run typecheck && bun run lint`

Expected: all PASS, exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/routes/chat src/components/credits-banner.tsx src/brand/brand-guard.test.ts
git commit -m "feat(brand): brand-blue status colors and Estori deploy copy"
```

---

### Task 9: Cloudflare logo allowlist and full verification

**Files:**
- Modify: `src/brand/brand-guard.test.ts` (final `describe`)

**Interfaces:**
- Consumes: everything above
- Produces: the finished rebrand

- [ ] **Step 1: Add the allowlist rule**

Append to `src/brand/brand-guard.test.ts`:

```ts
describe('brand guard: Cloudflare logo usage', () => {
	/** Files where the Cloudflare logo marks a real Cloudflare integration. */
	const CLOUDFLARE_INTEGRATION_FILES = [
		'/src/components/icons/logos.tsx',
		'/src/components/shared/CloudflareLogoThemed.tsx',
		'/src/components/auth/login-modal.tsx',
		'/src/components/byok-api-keys-modal.tsx',
		'/src/components/cloudflare-account-selector.tsx',
		'/src/components/connected-accounts.tsx',
		'/src/components/credits-banner.tsx',
		'/src/components/usage-limits-card.tsx',
		'/src/components/layout/app-sidebar.tsx',
		'/src/routes/chat/chat.tsx',
		'/src/utils/usage-limit-checker.tsx',
	];

	it('renders the Cloudflare logo only for Cloudflare integrations', () => {
		expect(
			findMatches(frontendSources, /\bCloudflareLogo\b/, CLOUDFLARE_INTEGRATION_FILES),
		).toEqual([]);
	});
});
```

- [ ] **Step 2: Run it and confirm it passes**

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: all PASS. `header.tsx` stopped using the logo in Task 6.

- [ ] **Step 3: Prove the rule catches a regression (Review Focus 5)**

Temporarily add `import { CloudflareLogo } from '@/components/icons/logos';` to the top of `src/routes/home.tsx`.

Run: `bun run test src/brand/brand-guard.test.ts`

Expected: FAIL, naming `/src/routes/home.tsx:1`.

Remove the line and re-run. Expected: PASS.

- [ ] **Step 4: Full automated suite**

Run: `bun run typecheck && bun run lint && bun run test`

Expected: exit 0 for all three. If any non-brand suite fails, run that test on the commit before Task 2 (`git stash` is not allowed in this repo; use `git worktree add` on that commit) to confirm the failure predates the rebrand, and report it rather than editing unrelated code.

- [ ] **Step 5: Visual sweep (Review Focus 4)**

With the dev server on 8100, check each screen in light mode and in dark mode (toggle in the sidebar footer):

- Home, a chat in progress, a finished chat with preview, Settings (API keys section), My Apps, Discover.
- A usage-limit dialog, which can be triggered from Settings → usage.

For each, confirm:
- no orange remains, except warning indicators;
- no Cloudflare logo appears outside the integration list;
- links, buttons and focus rings are Estori blue;
- the navy bar is present;
- the tab shows the "e." favicon and the title `<page> - Estori`.

Any leftover Kumo color gets fixed by adding a token mapping to `html[data-theme='estori']` in `estori-theme.css`, not by editing the component. Commit those fixes as `fix(brand): map <token> in Estori theme`.

- [ ] **Step 6: Persona check in a real generation**

Start a new app with the prompt "Create a habit tracker".

When the agent replies, send "Who are you?" and confirm the answer introduces itself as Estori.

If it says Think, follow the spec's risk note: append one more line to `PERSONA_PROMPT` and repeat. Do not edit `prompts/*.txt`.

- [ ] **Step 7: Confirm what is not committed**

Run: `git status --short`

Expected: only ` M wrangler.jsonc`. `.dev.vars` is gitignored, and the local KV rate-limit override lives in `.wrangler/state`, which is also gitignored.

- [ ] **Step 8: Commit any sweep fixes**

If Step 5 or 6 changed files, commit them explicitly by path, as in previous tasks. Never stage `wrangler.jsonc`.
