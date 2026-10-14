# Public Site Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every public page of estori.app in 1Password's look (DM Sans, charcoal/blue/gold, inset panels, pill buttons), add Magic UI motion, and add a Discover store-logo strip and a two-row store showcase backed by tall screenshots.

**Architecture:**
- **Look:** a `.public-site` scope set by `PublicLayout` carries the font, palette and a fixed light color scheme, so the signed-in app is untouched. Shared primitives hold the type scale and buttons.
- **Motion:** Magic UI components are copied at a pinned commit into `src/components/magicui/`, switched to the app's `framer-motion`, and made reduced-motion aware.
- **Server:** stores get a second, tall (1280×1650 JPEG) screenshot, recorded in a new nullable column. It's captured when a store is published publicly, after deploys of public stores, and in admin batches. Public listings expose it signed like the desktop thumbnail.

**Tech Stack:** React 19, React Router 7, Tailwind 4 (CSS config), TanStack Query, framer-motion 12, Cloudflare Workers, Hono, D1 with Drizzle, R2, Browser Rendering, Vitest in the Workers pool.

**Spec:** `docs/superpowers/specs/2026-10-14-public-site-redesign-design.md` (approved 2026-10-14). The approved landing mockup is `.superpowers/brainstorm/56174-1791986683/content/landing-v4.html`; it is git-ignored and for reference only.

**Prepared assets:** `.superpowers/assets/public-site/` is git-ignored and was prepared while writing this plan. Every file is listed with its sha256 in the task that copies it. It holds:
- the Magic UI sources, pinned at commit `85f97fd27b053339af74ba9dd4ca428ee25989fb` of github.com/magicuidesign/magicui;
- Magic UI's `LICENSE.md` (MIT);
- DM Sans from `@fontsource-variable/dm-sans@5.2.8` (`files/dm-sans-latin-opsz-normal.woff2`, 62,724 bytes) and its OFL licence;
- three store images captured from the local stores North Ridge and Saltmarsh Surf.

## Global Constraints

**Scope**
- Public pages only: `/` signed out, `/pricing`, `/terms`, `/privacy`, `/refunds`, `/copyright`, the public top bar and the footer. Signed-in app screens don't change.

**Visual system**
- **Palette, public pages only:** charcoal `#1d1d21`, blue `#145fe4`, gold `#cbb88e`, white, muted text `#5b5b66`, lines `#e5e5e5`. The Estori wordmark stays `#11295a` with its `#2C71F0` dot.
- **Font:** DM Sans variable, self-hosted at `/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2`, with `font-variation-settings: 'opsz' 14`.
- **Headings:** weight 300, -0.02em tracking, 1.1 line height.
  - Hero: 88px (44px on phones).
  - Section: 64px (36px on phones).
  - Card: 30px (24px on phones).
- **Body text:** leads are 20px with a 1.5 line height, weight 300. Eyebrows are 12px uppercase with +0.02em tracking.
- **Panels and cards:** inset panels sit 24px from the window edge (12px on phones) with a 25px radius. Cards have a 24px radius.
- **Pills:** 9999px radius, 10px 24px padding, 16px, weight 400.
- **Text links:** underlined with a 5px offset.
- **Dark mode:** public pages look the same in light and dark app themes. The build box and the sign-in window are app components and keep the app theme.

**Motion**
- Motion comes only from `src/components/magicui/`. Those files import `framer-motion`, never `motion/react`, and no npm dependency is added.
- With `prefers-reduced-motion: reduce`, nothing moves.
- **No `framer` substring in page sources:** the landing guard's competitor list includes "framer". Files under `src/routes/landing/`, `src/components/public-site/` and `src/routes/pricing.tsx` must never contain it, including in an import or a comment.

**Copy and data**
- No competitor is named. "Accept payments" keeps its Coming soon badge.
- The fee and limits come from the code: `PLATFORM_FEE_LABEL`, `platformFeeCents`, `PlanLimits`.
- No third-party company logos and no testimonials.
- The store-logo strip and the showcase are hidden when they'd have 2 stores or fewer.

**Code rules (CLAUDE.md)**
- No `any`. The frontend imports shared types through `@/api-types`.
- No emojis. Comments are concise and explain purpose.
- DRY.
- New React page and component files use PascalCase. Magic UI files stay kebab-case, like Magic UI's own names and `src/components/ui/`.

**Git**
- Never stage `wrangler.jsonc`, `.dev.vars`, `bun.lockb` or anything under `.superpowers/`. Stage files by explicit path.
- No bare `git stash`. Don't push, open PRs or deploy.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Commands**
- Prefix `npx vitest`, `npx tsc` and `grep` with `rtk proxy`, because the shell wrapper otherwise hides output.
- Run vitest per directory, never all suites in one command; one run exhausts local ports.
- Between worker suites, wait until `netstat -an -p tcp | grep -c TIME_WAIT` is under 1500.

## Review Focus

1. **Odd store titles.** A title made only of generic words ("Store", "My Store") or with extra spaces should give a short, non-empty wordmark, never an empty link. Pinned in Task 7 (`store-wordmark.test.ts`).
2. **Missing listing fields.** A store with no category, creator name or price shows no empty pill, no "by null", and "Free". Pinned in Task 7 (`showcase.test.ts`).
3. **Expired showcase image URLs.** Signed URLs last 6 hours. A visitor whose image request fails sees the card's dark background, not a broken-image icon, and listings aren't restored from local storage with stale tokens. Pinned in Task 9 (`onError` guard) and Task 7 (persistence test).
4. **Reduced motion.** A visitor who asked for reduced motion sees nothing move. Marquee rows become rows scrolled by hand, and typing shows the full text. Pinned in Task 2 (guard) and checked live in Task 12.
5. **Admin refresh edge cases.** When every store already has an image, or some captures fail, the admin gets a clear message, and failed stores count as still missing. Pinned in Task 6 (`showcase-refresh-message.test.ts`, the controller wiring test and the runner test in Task 4).

## Task Order and Interfaces

| Task | Produces | Consumed by |
|---|---|---|
| 1 Styles and font | `.public-site`, `--color-public-*` and `--font-public` tokens, `PUBLIC_FONT_URL`, `ComingSoon({ tone })` | 8, 9, 10, 11 |
| 2 Magic UI | `Marquee`, `BorderBeam`, `TypingAnimation`, `AnimatedList`, `visibleListItems`, `NumberTicker`, `AnimatedBeam`, `BlurFade`, `Safari`, `Iphone` | 9, 10 |
| 3 Column and listing | `apps.showcaseScreenshotUrl`, `PublicAppListData.showcaseScreenshotUrl`, `AppService.updateAppShowcaseScreenshot` | 4, 6, 7 |
| 4 Capture service | `captureShowcaseScreenshot`, `runShowcaseRefresh`, `showcaseEligible`, `createShowcaseCaptureDeps`, `refreshShowcaseScreenshot`, `SHOWCASE_VIEWPORT` | 5, 6 |
| 5 Publish and deploy triggers | background captures | — |
| 6 Admin refresh | `POST /api/admin/showcase-screenshots/refresh`, `ShowcaseRefreshData`, `useRefreshShowcaseScreenshots` | — |
| 7 Showcase data | `storeWordmark`, `toShowcaseStore` and the selection helpers, `useShowcaseStores`, `queryKeys.apps.showcase` | 9 |
| 8 Public chrome | primitives (`HEADING_*`, `LEAD`, `pillClass`, `PillLink`, `TextLink`, `Eyebrow`, `EdgeFades`), `AnnouncementBar`, new top bar, footer, anchor scrolling | 9, 10, 11 |
| 9 Landing, upper half | `Hero`, `StoreLogos`, `StoreShowcase` | 10 |
| 10 Landing, lower half | `Features`, `CreatorsPanel`, `LivePreview`, `PricingSummary`, `PublicFaq`, `ClosingPanel` | 11 |
| 11 Pricing and legal | restyled pages | — |
| 12 Verification | local migration, suites, typecheck, live checks | — |

---

### Task 1: Public site styles and font

**Files:**
- Create: `public/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2`, `public/fonts/dm-sans/OFL.txt`
- Create: `src/styles/public-site.css`
- Modify: `src/index.css:5` (add an import after the theme import)
- Modify: `vitest.config.ts` (the `css.include` line)
- Modify: `src/components/layout/PublicLayout.tsx` (whole file)
- Modify: `src/components/marketing/ComingSoon.tsx` (whole file)
- Test: `src/styles/public-site-guard.test.ts`

**Interfaces:**
- Produces:
  - CSS class `public-site`.
  - Tailwind colors `public-charcoal`, `public-blue`, `public-blue-hover`, `public-gold`, `public-ink`, `public-muted`, `public-line`, `public-brand`, so classes like `bg-public-charcoal` and `text-public-blue` work.
  - Tailwind font `font-public`.
  - `export const PUBLIC_FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2'` from `PublicLayout.tsx`.
  - `ComingSoon({ tone?: 'light' | 'dark' })`.

- [ ] **Step 1: Write the failing test**

Create `src/styles/public-site-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import publicCss from './public-site.css?raw';
import indexCss from '../index.css?raw';

const sources = import.meta.glob<string>(
	['/src/components/layout/PublicLayout.tsx', '/src/components/layout/app-layout.tsx', '/src/components/marketing/ComingSoon.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2';

describe('public site styles', () => {
	it('self-hosts DM Sans with swap, across its weight range', () => {
		expect(publicCss).toContain("font-family: 'DM Sans'");
		expect(publicCss).toContain(`url('${FONT_URL}')`);
		expect(publicCss).toContain('font-display: swap');
		expect(publicCss).toContain('font-weight: 100 1000');
	});

	it('defines the 1Password palette as public-only tokens', () => {
		expect(publicCss).toContain('--color-public-charcoal: #1d1d21');
		expect(publicCss).toContain('--color-public-blue: #145fe4');
		expect(publicCss).toContain('--color-public-gold: #cbb88e');
		expect(publicCss).toContain('--color-public-muted: #5b5b66');
		expect(publicCss).toContain('--color-public-line: #e5e5e5');
		expect(publicCss).toContain('--color-public-brand: #11295a');
	});

	it('scopes the font and a fixed light scheme to .public-site', () => {
		const start = publicCss.indexOf('.public-site {');
		expect(start).toBeGreaterThan(-1);
		const rule = publicCss.slice(start, publicCss.indexOf('}', start));
		expect(rule).toContain('color-scheme: light');
		expect(rule).toContain('font-family: var(--font-public)');
		expect(rule).toContain("font-variation-settings: 'opsz' 14");
	});

	it('is loaded by the app stylesheet', () => {
		expect(indexCss).toContain("@import './styles/public-site.css';");
	});

	it('applies the scope and preloads the font only in the public layout', () => {
		const layout = source('/src/components/layout/PublicLayout.tsx');
		expect(layout).toMatch(/className="public-site\b/);
		expect(layout).toContain("import { preload } from 'react-dom'");
		expect(layout).toContain('preload(PUBLIC_FONT_URL');
		expect(layout).toContain(FONT_URL);
		expect(source('/src/components/layout/app-layout.tsx')).not.toContain('dm-sans');
	});

	it('styles Coming soon with fixed colors, not app tokens that follow the app theme', () => {
		const badge = source('/src/components/marketing/ComingSoon.tsx');
		expect(badge).not.toContain('kumo-');
		expect(badge).toContain('Coming soon');
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `rtk proxy npx vitest run src/styles/public-site-guard.test.ts`
Expected: FAIL. The import `./public-site.css?raw` cannot be resolved, or the CSS loads as an empty string so every assertion fails.

- [ ] **Step 3: Add the font files and verify them**

```bash
mkdir -p public/fonts/dm-sans
cp .superpowers/assets/public-site/fonts/dm-sans-latin-opsz-normal.woff2 public/fonts/dm-sans/
cp .superpowers/assets/public-site/fonts/OFL.txt public/fonts/dm-sans/OFL.txt
shasum -a 256 public/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2 public/fonts/dm-sans/OFL.txt
```

Expected:
```
ca72d2bcea8f4daa783dbdfa2d9b46068c3ce38168e05918fb867aa453b4f890  public/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2
6fbd040a29c2037a765dfb9f2561e9965b5c95c6dcb5dce516089d63d5f17af7  public/fonts/dm-sans/OFL.txt
```
If the assets folder is missing, fetch both files from `https://cdn.jsdelivr.net/npm/@fontsource-variable/dm-sans@5.2.8/files/dm-sans-latin-opsz-normal.woff2` and `https://cdn.jsdelivr.net/npm/@fontsource-variable/dm-sans@5.2.8/LICENSE` (saved as `OFL.txt`). The checksums must match.

- [ ] **Step 4: Write `src/styles/public-site.css`**

```css
/*
 * Public pages (landing, pricing, legal): 1Password-style palette and DM Sans.
 * PublicLayout sets .public-site, so the signed-in app keeps its own font and theme.
 */

@font-face {
	font-family: 'DM Sans';
	font-style: normal;
	font-weight: 100 1000;
	font-display: swap;
	src: url('/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2') format('woff2-variations');
}

@theme {
	--color-public-charcoal: #1d1d21;
	--color-public-blue: #145fe4;
	--color-public-blue-hover: #0f4fc6;
	--color-public-gold: #cbb88e;
	--color-public-ink: #000000;
	--color-public-muted: #5b5b66;
	--color-public-line: #e5e5e5;
	--color-public-brand: #11295a;
	--font-public: 'DM Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.public-site {
	color-scheme: light;
	font-family: var(--font-public);
	font-variation-settings: 'opsz' 14;
	background-color: #ffffff;
	color: var(--color-public-ink);
	-webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: Load it, and let tests read it**

In `src/index.css`, after the line `@import './styles/estori-theme.css';` (line 5), add:

```css
@import './styles/public-site.css';
```

In `vitest.config.ts`, replace:

```ts
    css: { include: [/estori-theme\.css/, /src\/index\.css/] },
```

with:

```ts
    css: { include: [/estori-theme\.css/, /src\/index\.css/, /public-site\.css/, /magicui\.css/] },
```

- [ ] **Step 6: Scope the public layout and preload the font**

Replace `src/components/layout/PublicLayout.tsx` with:

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { preload } from 'react-dom';
import { Outlet, useLocation } from 'react-router';
import { PublicTopBar } from './PublicTopBar';
import { SiteFooter } from './SiteFooter';

/** DM Sans for the public pages; the signed-in app never downloads it. */
export const PUBLIC_FONT_URL = '/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2';

/** Page frame for signed-out marketing and legal pages: own scroll, top bar, footer, no app sidebar. */
export function PublicLayout({ children }: { children?: ReactNode }) {
	preload(PUBLIC_FONT_URL, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
	const scrollRef = useRef<HTMLDivElement>(null);
	const { pathname } = useLocation();

	// This container stays mounted across public routes, so each page starts at the top.
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [pathname]);

	return (
		<div ref={scrollRef} className="public-site h-svh overflow-y-auto">
			<PublicTopBar />
			<main>{children ?? <Outlet />}</main>
			<SiteFooter />
		</div>
	);
}
```

- [ ] **Step 7: Give Coming soon fixed colors**

Replace `src/components/marketing/ComingSoon.tsx` with:

```tsx
/** "Coming soon" badge for the public pages, in fixed colors since those pages ignore the app theme. */
export function ComingSoon({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
	return (
		<span
			className={
				tone === 'dark'
					? 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-white/85 ring ring-white/40'
					: 'inline-flex items-center rounded-full bg-[#f4f4f5] px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-public-muted ring ring-public-line'
			}
		>
			Coming soon
		</span>
	);
}
```

- [ ] **Step 8: Run the test and the existing public guards**

Run: `rtk proxy npx vitest run src/styles/public-site-guard.test.ts src/routes/public-pages-guard.test.ts src/brand`
Expected: PASS for all.

- [ ] **Step 9: Commit**

```bash
git add public/fonts/dm-sans/dm-sans-latin-opsz-normal.woff2 public/fonts/dm-sans/OFL.txt src/styles/public-site.css src/styles/public-site-guard.test.ts src/index.css vitest.config.ts src/components/layout/PublicLayout.tsx src/components/marketing/ComingSoon.tsx
git commit -m "feat(public): self-host DM Sans and scope a 1Password-style palette to the public pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Magic UI components

**Files:**
- Create: `src/components/magicui/{marquee,border-beam,typing-animation,animated-list,number-ticker,animated-beam,blur-fade,safari,iphone}.tsx`, `src/components/magicui/visible-list-items.ts`, `src/components/magicui/LICENSE.md`
- Create: `src/styles/magicui.css`
- Modify: `src/index.css` (add an import)
- Test: `src/components/magicui/magicui-guard.test.ts`, `src/components/magicui/visible-list-items.test.ts`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces:
  - `Marquee({ reverse?, pauseOnHover?, vertical?, repeat?, className, children })`. It pauses on hover, focus and off screen. Its copies are `aria-hidden` and `inert`.
  - `BorderBeam({ size?, duration?, delay?, colorFrom?, colorTo?, borderWidth?, ... })`. It renders nothing with reduced motion.
  - `TypingAnimation({ children?: string, words?, duration?, loop?, className, ... })`.
  - `AnimatedList({ delay?, newestFirst?: boolean (default true), className, children })`.
  - `visibleListItems<T>(items: readonly T[], shown: number, newestFirst: boolean): T[]`.
  - `NumberTicker({ value, decimalPlaces?, delay?, className })`.
  - `AnimatedBeam({ containerRef, fromRef, toRef, gradientStartColor?, gradientStopColor?, pathColor?, delay?, duration?, className })`.
  - `BlurFade({ inView?, delay?, className, children })`.
  - `Safari({ url?, imageSrc?, mode?, className })`.
  - `Iphone({ src?, className })`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/magicui/visible-list-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { visibleListItems } from './visible-list-items';

describe('visibleListItems', () => {
	it('shows the arrived items newest first, like a notification feed', () => {
		expect(visibleListItems(['a', 'b', 'c'], 2, true)).toEqual(['b', 'a']);
	});

	it('keeps arrival order for step lists', () => {
		expect(visibleListItems(['a', 'b', 'c'], 2, false)).toEqual(['a', 'b']);
	});

	it('never shows more items than it has, or a negative number of them', () => {
		expect(visibleListItems(['a'], 5, false)).toEqual(['a']);
		expect(visibleListItems(['a'], -1, false)).toEqual([]);
	});
});
```

Create `src/components/magicui/magicui-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import magicCss from '../../styles/magicui.css?raw';
import indexCss from '../../index.css?raw';

const components = import.meta.glob<string>('/src/components/magicui/*.tsx', { query: '?raw', import: 'default', eager: true });
const licence = import.meta.glob<string>('/src/components/magicui/LICENSE.md', { query: '?raw', import: 'default', eager: true });

const NAMES = ['marquee', 'border-beam', 'typing-animation', 'animated-list', 'number-ticker', 'animated-beam', 'blur-fade', 'safari', 'iphone'];
const ANIMATED = ['marquee', 'border-beam', 'typing-animation', 'animated-list', 'number-ticker', 'animated-beam', 'blur-fade'];

function component(name: string): string {
	const text = components[`/src/components/magicui/${name}.tsx`];
	if (text === undefined) throw new Error(`Component not found: ${name}`);
	return text;
}

describe('Magic UI components', () => {
	it("ships the nine adapted components with Magic UI's MIT licence", () => {
		for (const name of NAMES) expect(component(name)).toBeTruthy();
		const text = licence['/src/components/magicui/LICENSE.md'];
		expect(text).toContain('MIT License');
		expect(text).toContain('Copyright (c) Magic UI');
	});

	it('credits Magic UI in each file', () => {
		for (const name of NAMES) expect(component(name)).toContain('Adapted from Magic UI (MIT, see ./LICENSE.md)');
	});

	it('uses the framer-motion the app already has, never motion/react', () => {
		for (const name of NAMES) {
			expect(component(name)).not.toMatch(/from ["']motion\/react["']/);
			expect(component(name)).not.toContain('"use client"');
		}
		for (const name of ANIMATED.filter((n) => n !== 'marquee')) {
			expect(component(name)).toMatch(/from ["']framer-motion["']/);
		}
	});

	it('stops moving for people who ask for reduced motion', () => {
		for (const name of ANIMATED) expect(component(name)).toMatch(/useReducedMotion\(\)|motion-reduce:/);
	});

	it('keeps marquee copies out of the accessibility tree and the tab order, and pauses on focus and off screen', () => {
		const marquee = component('marquee');
		expect(marquee).toContain('aria-hidden={i > 0 || undefined}');
		expect(marquee).toContain('inert={i > 0 || undefined}');
		expect(marquee).toContain('group-focus-within:[animation-play-state:paused]');
		expect(marquee).toContain('group-data-[offscreen]:[animation-play-state:paused]');
		expect(marquee).toContain('motion-reduce:overflow-x-auto');
	});

	it('ignores the app dark mode in the device frames and the ticker', () => {
		for (const name of ['safari', 'iphone', 'number-ticker']) expect(component(name)).not.toContain('dark:');
	});

	it('defines the marquee and cursor animations, loaded by the app stylesheet', () => {
		expect(magicCss).toContain('--animate-marquee: marquee var(--duration) infinite linear;');
		expect(magicCss).toContain('@keyframes marquee');
		expect(magicCss).toContain('--animate-blink-cursor: blink-cursor 1.2s step-end infinite;');
		expect(magicCss).toContain('@keyframes blink-cursor');
		expect(indexCss).toContain("@import './styles/magicui.css';");
	});
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run src/components/magicui`
Expected: FAIL. `./visible-list-items` and `../../styles/magicui.css?raw` cannot be resolved.

- [ ] **Step 3: Copy the pinned sources and verify them**

```bash
A=.superpowers/assets/public-site/magicui
(cd "$A" && shasum -a 256 -c <<'EOF'
0147b84235ed916b8b4e89c1f80655351c5afe7d211b629be61f553a227b34ba  LICENSE.md
6afa2ee1d01694a428eb8517d48deebe5c6b532dc0ee871800bb9d92aae43e79  animated-beam.tsx
9363c5afa61d7aab1919b4500f7325cc8871b35103d5dd60a2a1625fe5e7dc58  animated-list.tsx
99a8e83aa8817f48e26d921e959ff9abefb5c2f1f0b72b166ed95e88e015949f  blur-fade.tsx
ccdfb52cb8f2089e7823a9edfe9c3a52e52ab6759ed5b91d184b1e2bb80cf414  border-beam.tsx
64aa5f8f05c2444d2f0f791328a6bc5c0cc73624eb53dde2c5d29cd710c20124  iphone.tsx
779f360a107409bfa35cda13bcef7d54cd620a15ab4a0ee50412442a4dd6b9c7  marquee.tsx
0f7dcbc6a1962615a877590304e846f33d390002a51f2226f544938577c220f4  number-ticker.tsx
2cb6ce69def86020f6860a3dd8696f0998dac340db932a3eee05e990b2e29f3e  safari.tsx
70ce53aff9dd61cba9d5c8999e8a05120839d4d8e0396a5e0a1579f155d18e4b  typing-animation.tsx
EOF
)
mkdir -p src/components/magicui
cp "$A"/{marquee,border-beam,typing-animation,animated-list,number-ticker,animated-beam,blur-fade,safari,iphone}.tsx src/components/magicui/
cp "$A"/LICENSE.md src/components/magicui/LICENSE.md
```

Expected: all ten lines print `OK`. If the folder is missing, fetch each file from `https://raw.githubusercontent.com/magicuidesign/magicui/85f97fd27b053339af74ba9dd4ca428ee25989fb/apps/www/registry/magicui/<name>.tsx`, and `LICENSE.md` from the same commit's repository root. The checksums must match.

- [ ] **Step 4: Apply the mechanical edits to every file**

```bash
cd src/components/magicui
sed -i '' -e '/^"use client"$/d' -e 's#from "motion/react"#from "framer-motion"#' *.tsx
sed -i '' -E 's/ dark:[^ "]+//g' safari.tsx iphone.tsx
for f in *.tsx; do printf '%s\n' '// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.' | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; done
cd -
rtk proxy grep -n 'dark:' src/components/magicui/safari.tsx src/components/magicui/iphone.tsx
```

Expected: the last command prints nothing. If a `dark:` class remains because it was the first class in its string, delete that class by hand.

- [ ] **Step 5: Add `visible-list-items.ts`, and replace marquee, animated-list, border-beam, number-ticker and blur-fade**

Create `src/components/magicui/visible-list-items.ts`:

```ts
/** The items on screen once `shown` have arrived: newest on top, or in arrival order. */
export function visibleListItems<T>(items: readonly T[], shown: number, newestFirst: boolean): T[] {
	const arrived = items.slice(0, Math.max(0, Math.min(shown, items.length)));
	return newestFirst ? arrived.reverse() : arrived;
}
```

Replace `src/components/magicui/marquee.tsx` with:

```tsx
// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useRef, type ComponentPropsWithoutRef } from "react"
import { useInView } from "framer-motion"

import { cn } from "@/lib/utils"

interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  className?: string
  /** Scroll the other way. */
  reverse?: boolean
  /** Pause while hovered; it also pauses while a child has keyboard focus. */
  pauseOnHover?: boolean
  children: React.ReactNode
  vertical?: boolean
  /** Copies of the children laid end to end, so the loop never shows a gap. */
  repeat?: number
}

/**
 * Scrolls its children in a loop. Only the first copy reaches assistive
 * technology and the keyboard. Off screen it pauses; with reduced motion it
 * stands still and scrolls by hand instead.
 */
export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  vertical = false,
  repeat = 4,
  ...props
}: MarqueeProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useInView(ref)

  return (
    <div
      ref={ref}
      {...props}
      data-offscreen={onScreen ? undefined : ""}
      className={cn(
        "group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem] motion-reduce:overflow-x-auto",
        {
          "flex-row": !vertical,
          "flex-col": vertical,
        },
        className
      )}
    >
      {Array.from({ length: repeat }, (_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 || undefined}
          inert={i > 0 || undefined}
          className={cn(
            "flex shrink-0 justify-around gap-(--gap) group-data-[offscreen]:[animation-play-state:paused] motion-reduce:animate-none",
            {
              "animate-marquee flex-row": !vertical,
              "animate-marquee-vertical flex-col": vertical,
              "group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]": pauseOnHover,
              "[animation-direction:reverse]": reverse,
              "motion-reduce:hidden": i > 0,
            }
          )}
        >
          {children}
        </div>
      ))}
    </div>
  )
}
```

Replace `src/components/magicui/animated-list.tsx` with:

```tsx
// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import React, { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef } from "react"
import { AnimatePresence, motion, useInView, useReducedMotion, type MotionProps } from "framer-motion"

import { cn } from "@/lib/utils"
import { visibleListItems } from "./visible-list-items"

export function AnimatedListItem({ children }: { children: React.ReactNode }) {
  const animations: MotionProps = {
    initial: { scale: 0, opacity: 0 },
    animate: { scale: 1, opacity: 1, originY: 0 },
    exit: { scale: 0, opacity: 0 },
    transition: { type: "spring", stiffness: 350, damping: 40 },
  }

  return (
    <motion.div {...animations} layout className="mx-auto w-full">
      {children}
    </motion.div>
  )
}

export interface AnimatedListProps extends ComponentPropsWithoutRef<"div"> {
  children: React.ReactNode
  /** Milliseconds between arrivals. */
  delay?: number
  /** Show each new item on top (Magic UI's default) or below the earlier ones. */
  newestFirst?: boolean
}

/** Reveals its children one at a time once on screen; with reduced motion they all show at once. */
export const AnimatedList = React.memo(
  ({ children, className, delay = 1000, newestFirst = true, ...props }: AnimatedListProps) => {
    const ref = useRef<HTMLDivElement>(null)
    const onScreen = useInView(ref, { once: true })
    const reduceMotion = useReducedMotion()
    const childrenArray = useMemo(() => React.Children.toArray(children), [children])
    const [shown, setShown] = useState(1)

    useEffect(() => {
      if (!onScreen || reduceMotion || shown >= childrenArray.length) return
      const timeout = setTimeout(() => setShown((count) => count + 1), delay)
      return () => clearTimeout(timeout)
    }, [onScreen, reduceMotion, shown, delay, childrenArray.length])

    const items = visibleListItems(childrenArray, reduceMotion ? childrenArray.length : shown, newestFirst)

    return (
      <div ref={ref} className={cn("flex flex-col items-center gap-4", className)} {...props}>
        {reduceMotion ? (
          items
        ) : (
          <AnimatePresence>
            {items.map((item) => (
              <AnimatedListItem key={(item as React.ReactElement).key}>{item}</AnimatedListItem>
            ))}
          </AnimatePresence>
        )}
      </div>
    )
  }
)

AnimatedList.displayName = "AnimatedList"
```

Replace `src/components/magicui/border-beam.tsx` with:

```tsx
// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useRef } from "react"
import { motion, useInView, useReducedMotion, type MotionStyle, type Transition } from "framer-motion"

import { cn } from "@/lib/utils"

interface BorderBeamProps {
  /** The size of the border beam. */
  size?: number
  /** Seconds per lap. */
  duration?: number
  /** Seconds to offset the start. */
  delay?: number
  colorFrom?: string
  colorTo?: string
  transition?: Transition
  className?: string
  style?: React.CSSProperties
  reverse?: boolean
  /** The initial offset position (0-100). */
  initialOffset?: number
  borderWidth?: number
}

/** A light that travels along the parent's rounded border. Hidden with reduced motion; it stops while off screen. */
export const BorderBeam = ({
  className,
  size = 50,
  delay = 0,
  duration = 6,
  colorFrom = "#ffaa40",
  colorTo = "#9c40ff",
  transition,
  style,
  reverse = false,
  initialOffset = 0,
  borderWidth = 1,
}: BorderBeamProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const onScreen = useInView(ref)
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return null

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 rounded-[inherit] border-(length:--border-beam-width) border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box]"
      style={{ "--border-beam-width": `${borderWidth}px` } as React.CSSProperties}
    >
      {onScreen && (
        <motion.div
          className={cn(
            "absolute aspect-square",
            "bg-linear-to-l from-(--color-from) via-(--color-to) to-transparent",
            className
          )}
          style={
            {
              width: size,
              offsetPath: `rect(0 auto auto 0 round ${size}px)`,
              "--color-from": colorFrom,
              "--color-to": colorTo,
              ...style,
            } as MotionStyle
          }
          initial={{ offsetDistance: `${initialOffset}%` }}
          animate={{
            offsetDistance: reverse
              ? [`${100 - initialOffset}%`, `${-initialOffset}%`]
              : [`${initialOffset}%`, `${100 + initialOffset}%`],
          }}
          transition={{
            repeat: Infinity,
            ease: "linear",
            duration,
            delay: -delay,
            ...transition,
          }}
        />
      )}
    </div>
  )
}
```

Replace `src/components/magicui/number-ticker.tsx` with:

```tsx
// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react"
import { useInView, useMotionValue, useReducedMotion, useSpring } from "framer-motion"

import { cn } from "@/lib/utils"

interface NumberTickerProps extends ComponentPropsWithoutRef<"span"> {
  value: number
  startValue?: number
  direction?: "up" | "down"
  delay?: number
  decimalPlaces?: number
}

function formatNumber(value: number, decimalPlaces: number): string {
  return Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(Number(value.toFixed(decimalPlaces)))
}

/** Counts to `value` when it scrolls into view; with reduced motion it shows `value` straight away. */
export function NumberTicker({
  value,
  startValue = 0,
  direction = "up",
  delay = 0,
  className,
  decimalPlaces = 0,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion()
  const motionValue = useMotionValue(direction === "down" ? value : startValue)
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 })
  const isInView = useInView(ref, { once: true, margin: "0px" })
  const target = direction === "down" ? startValue : value

  useEffect(() => {
    if (!isInView || reduceMotion) return
    const timer = setTimeout(() => motionValue.set(target), delay * 1000)
    return () => clearTimeout(timer)
  }, [motionValue, isInView, reduceMotion, delay, target])

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = formatNumber(latest, decimalPlaces)
      }),
    [springValue, decimalPlaces]
  )

  return (
    <span ref={ref} className={cn("inline-block tabular-nums", className)} {...props}>
      {formatNumber(reduceMotion ? target : direction === "down" ? value : startValue, decimalPlaces)}
    </span>
  )
}
```

Replace `src/components/magicui/blur-fade.tsx` with:

```tsx
// Adapted from Magic UI (MIT, see ./LICENSE.md), commit 85f97fd.
import { useRef } from "react"
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
  type MotionProps,
  type UseInViewOptions,
  type Variants,
} from "framer-motion"

type MarginType = UseInViewOptions["margin"]

interface BlurFadeProps extends MotionProps {
  children: React.ReactNode
  className?: string
  variant?: {
    hidden: { y: number }
    visible: { y: number }
  }
  duration?: number
  delay?: number
  offset?: number
  direction?: "up" | "down" | "left" | "right"
  inView?: boolean
  inViewMargin?: MarginType
  blur?: string
}

const getFilter = (v: Variants[string]) => (typeof v === "function" ? undefined : v.filter)

/** Fades and unblurs its children in, when they scroll into view if `inView` is set; with reduced motion they simply appear. */
export function BlurFade({
  children,
  className,
  variant,
  duration = 0.4,
  delay = 0,
  offset = 6,
  direction = "down",
  inView = false,
  inViewMargin = "-50px",
  blur = "6px",
  ...props
}: BlurFadeProps) {
  const ref = useRef(null)
  const reduceMotion = useReducedMotion()
  const inViewResult = useInView(ref, { once: true, margin: inViewMargin })
  const isInView = !inView || inViewResult
  const defaultVariants: Variants = {
    hidden: {
      [direction === "left" || direction === "right" ? "x" : "y"]:
        direction === "right" || direction === "down" ? -offset : offset,
      opacity: 0,
      filter: `blur(${blur})`,
    },
    visible: {
      [direction === "left" || direction === "right" ? "x" : "y"]: 0,
      opacity: 1,
      filter: `blur(0px)`,
    },
  }
  const combinedVariants = variant ?? defaultVariants
  const hiddenFilter = getFilter(combinedVariants.hidden)
  const visibleFilter = getFilter(combinedVariants.visible)
  const shouldTransitionFilter = hiddenFilter != null && visibleFilter != null && hiddenFilter !== visibleFilter

  if (reduceMotion) return <div className={className}>{children}</div>

  return (
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial="hidden"
        animate={isInView ? "visible" : "hidden"}
        exit="hidden"
        variants={combinedVariants}
        transition={{
          delay: 0.04 + delay,
          duration,
          ease: "easeOut",
          ...(shouldTransitionFilter ? { filter: { duration } } : {}),
        }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
```

- [ ] **Step 6: Make typing-animation and animated-beam reduced-motion aware**

In `src/components/magicui/typing-animation.tsx`:

1. Replace `  useInView,\n  type DOMMotionComponents,` with:
   ```tsx
     useInView,
     useReducedMotion,
     type DOMMotionComponents,
   ```
2. Replace `  const shouldStart = startOnView ? isInView : true` with:
   ```tsx
     const reduceMotion = useReducedMotion()
     const shouldStart = !reduceMotion && (startOnView ? isInView : true)
   ```
3. Immediately before the final `  return (` that renders `<MotionComponent`, insert:
   ```tsx
     if (reduceMotion) {
       return (
         <MotionComponent
           ref={elementRef}
           className={cn(
             "leading-20 tracking-[-0.02em]",
             Component === "span" && "inline-block",
             className
           )}
           {...props}
         >
           {wordsToAnimate[0] ?? ""}
         </MotionComponent>
       )
     }

   ```

In `src/components/magicui/animated-beam.tsx`:

1. Replace `import { motion } from "framer-motion"` with `import { motion, useReducedMotion } from "framer-motion"`.
2. After `  const id = useId()`, add `  const reduceMotion = useReducedMotion()`.
3. Replace `      <path\n        d={pathD}\n        strokeWidth={pathWidth}\n        stroke={`url(#${id})`}` with:
   ```tsx
         {!reduceMotion && (
           <>
         <path
           d={pathD}
           strokeWidth={pathWidth}
           stroke={`url(#${id})`}
   ```
4. Replace `      </defs>\n    </svg>` with:
   ```tsx
         </defs>
           </>
         )}
       </svg>
   ```

With reduced motion, the beam then draws only its faint static path.

- [ ] **Step 7: Add the animation tokens**

Create `src/styles/magicui.css`:

```css
/* Animations used by the Magic UI components in src/components/magicui. */
@theme {
	--animate-marquee: marquee var(--duration) infinite linear;
	--animate-marquee-vertical: marquee-vertical var(--duration) linear infinite;
	--animate-blink-cursor: blink-cursor 1.2s step-end infinite;

	@keyframes marquee {
		from {
			transform: translateX(0);
		}
		to {
			transform: translateX(calc(-100% - var(--gap)));
		}
	}

	@keyframes marquee-vertical {
		from {
			transform: translateY(0);
		}
		to {
			transform: translateY(calc(-100% - var(--gap)));
		}
	}

	@keyframes blink-cursor {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0;
		}
	}
}
```

In `src/index.css`, after `@import './styles/public-site.css';`, add:

```css
@import './styles/magicui.css';
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `rtk proxy npx vitest run src/components/magicui`
Expected: PASS (10 tests).

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output. Only the 4 known `packages/artifacts-viewer` errors remain.

- [ ] **Step 9: Commit**

```bash
git add src/components/magicui src/styles/magicui.css src/index.css
git commit -m "feat(public): add Magic UI components adapted to framer-motion and reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Showcase screenshot column, listing and signing

**Files:**
- Modify: `worker/database/schema.ts:232` (after `screenshotCapturedAt`)
- Create (generated): `migrations/0013_*.sql`, `migrations/meta/0013_snapshot.json`. Modify (generated): `migrations/meta/_journal.json`.
- Modify: `worker/database/types.ts:50-82` (`PublicAppListData`)
- Modify: `worker/api/controllers/apps/publicAppDto.ts:44`
- Modify: `worker/utils/screenshot-security.ts:31-37`
- Modify: `worker/database/services/AppService.ts:322-330` (add a method after `updateAppScreenshot`)
- Modify: `worker/api/controllers/apps/publicAppDto.test.ts`, `worker/api/controllers/apps/discover-dto.test.ts` (fixtures)
- Test: `worker/database/showcase-screenshot-schema.test.ts`, `worker/utils/screenshot-security.test.ts`, `worker/api/controllers/apps/publicAppDto.test.ts`

**Interfaces:**
- Produces:
  - `schema.apps.showcaseScreenshotUrl` (`text | null`, column `showcase_screenshot_url`);
  - `PublicAppListData.showcaseScreenshotUrl: string | null`;
  - `AppService.updateAppShowcaseScreenshot(appId: string, showcaseScreenshotUrl: string): Promise<boolean>`;
  - `ScreenshotSecurity.enrichUrls`, which signs both `screenshotUrl` and `showcaseScreenshotUrl`.

- [ ] **Step 1: Write the failing tests**

Create `worker/database/showcase-screenshot-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import * as schema from './schema';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';
import { assignedValues, lastWrite } from './test-support/recorded-statements';

const migrations = import.meta.glob<string>('/migrations/*.sql', { query: '?raw', import: 'default', eager: true });

describe('showcase screenshot column', () => {
	it('adds a nullable showcase_screenshot_url to apps', () => {
		const column = getTableConfig(schema.apps).columns.find((c) => c.name === 'showcase_screenshot_url');
		expect(column).toBeDefined();
		expect(column?.notNull).toBe(false);
	});

	it('ships the column in a migration', () => {
		expect(Object.values(migrations).join('\n')).toContain('ALTER TABLE `apps` ADD `showcase_screenshot_url` text');
	});

	it('records a showcase screenshot on the app', async () => {
		const { d1, statements } = recordingD1();
		await new AppService({ DB: d1 } as unknown as Env).updateAppShowcaseScreenshot('app1', '/api/screenshots/app1/showcase.jpg');
		expect(assignedValues(lastWrite(statements, 'update', 'apps'))).toMatchObject({
			showcase_screenshot_url: '/api/screenshots/app1/showcase.jpg',
		});
	});
});
```

Create `worker/utils/screenshot-security.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ScreenshotSecurity } from './screenshot-security';

const env = { JWT_SECRET: 'screenshot-security-test-secret-0123456789abcdef' };

describe('ScreenshotSecurity.enrichUrls', () => {
	it('signs the desktop and the showcase screenshot of each app', async () => {
		const security = new ScreenshotSecurity(env);
		const [app] = await security.enrichUrls([
			{ id: 'app1', screenshotUrl: '/api/screenshots/app1/latest.png', showcaseScreenshotUrl: '/api/screenshots/app1/showcase.jpg' },
		]);
		expect(app.screenshotUrl).toMatch(/^\/api\/screenshots\/app1\/latest\.png\?token=/);
		expect(app.showcaseScreenshotUrl).toMatch(/^\/api\/screenshots\/app1\/showcase\.jpg\?token=/);
		const token = new URL(app.showcaseScreenshotUrl ?? '', 'http://localhost').searchParams.get('token') ?? '';
		expect(await security.verifyToken(token, 'app1')).toBe(true);
	});

	it('leaves a missing showcase screenshot as it is', async () => {
		const [app] = await new ScreenshotSecurity(env).enrichUrls([
			{ id: 'app1', screenshotUrl: '/api/screenshots/app1/latest.png', showcaseScreenshotUrl: null },
		]);
		expect(app.showcaseScreenshotUrl).toBeNull();
	});
});
```

At the end of `worker/api/controllers/apps/publicAppDto.test.ts`, append:

```ts
describe('showcase screenshot in listings', () => {
    it('lists the tall showcase screenshot next to the desktop one', () => {
        const item = toPublicAppListItem(makeApp({ showcaseScreenshotUrl: '/api/screenshots/app-1/showcase.jpg' }));
        expect(item.showcaseScreenshotUrl).toBe('/api/screenshots/app-1/showcase.jpg');
    });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run worker/database/showcase-screenshot-schema.test.ts worker/utils/screenshot-security.test.ts worker/api/controllers/apps/publicAppDto.test.ts`
Expected: FAIL. The column is not found, `updateAppShowcaseScreenshot` is not a function, `showcaseScreenshotUrl` is not signed, and the listing lacks the field.

- [ ] **Step 3: Add the column and generate the migration**

In `worker/database/schema.ts`, after the line `    screenshotCapturedAt: integer('screenshot_captured_at', { mode: 'timestamp' }), // When screenshot was last captured`, add:

```ts
    showcaseScreenshotUrl: text('showcase_screenshot_url'), // Tall Discover showcase image, 1280x1650 JPEG
```

Run: `npm run db:generate`
Expected: drizzle-kit writes `migrations/0013_<generated_name>.sql` containing exactly `ALTER TABLE \`apps\` ADD \`showcase_screenshot_url\` text;`. It also writes `migrations/meta/0013_snapshot.json` and appends idx 13 to `migrations/meta/_journal.json`. Keep the generated name.

- [ ] **Step 4: Expose and sign the field, and add the service method**

In `worker/database/types.ts`, inside the `PublicAppListData` `Pick` union, add `    | 'showcaseScreenshotUrl'` after `    | 'screenshotUrl'`.

In `worker/api/controllers/apps/publicAppDto.ts`, in `toPublicAppBase`, after `        screenshotUrl: app.screenshotUrl,`, add:

```ts
        showcaseScreenshotUrl: app.showcaseScreenshotUrl,
```

In `worker/utils/screenshot-security.ts`, replace the whole `enrichUrls` method with:

```ts
    /** Signs each app's desktop and showcase screenshot URLs. */
    async enrichUrls<T extends { id: string; screenshotUrl?: string | null; showcaseScreenshotUrl?: string | null }>(apps: T[]): Promise<T[]> {
        return Promise.all(apps.map(async (app) => {
            const screenshotUrl = app.screenshotUrl ? await this.signUrl(app.screenshotUrl, app.id) : app.screenshotUrl;
            const showcaseScreenshotUrl = app.showcaseScreenshotUrl
                ? await this.signUrl(app.showcaseScreenshotUrl, app.id)
                : app.showcaseScreenshotUrl;
            if (screenshotUrl === app.screenshotUrl && showcaseScreenshotUrl === app.showcaseScreenshotUrl) return app;
            return { ...app, screenshotUrl, showcaseScreenshotUrl };
        }));
    }
```

In `worker/database/services/AppService.ts`, directly after the `updateAppScreenshot` method, add:

```ts
    /** Records the tall Discover showcase image of a store. */
    async updateAppShowcaseScreenshot(appId: string, showcaseScreenshotUrl: string): Promise<boolean> {
        return this.updateApp(appId, { showcaseScreenshotUrl });
    }
```

- [ ] **Step 5: Update the test fixtures the new column breaks**

In `worker/api/controllers/apps/publicAppDto.test.ts` and `worker/api/controllers/apps/discover-dto.test.ts`, after each `screenshotCapturedAt:` line inside an app fixture, add:

```ts
        showcaseScreenshotUrl: null,
```

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output. If another fixture reports a missing `showcaseScreenshotUrl`, add the same line next to its `screenshotCapturedAt` and rerun.

- [ ] **Step 6: Run the tests**

Run: `rtk proxy npx vitest run worker/database/showcase-screenshot-schema.test.ts worker/utils/screenshot-security.test.ts worker/api/controllers/apps`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/database/schema.ts migrations/0013_*.sql migrations/meta/0013_snapshot.json migrations/meta/_journal.json worker/database/types.ts worker/api/controllers/apps/publicAppDto.ts worker/utils/screenshot-security.ts worker/database/services/AppService.ts worker/database/showcase-screenshot-schema.test.ts worker/utils/screenshot-security.test.ts worker/api/controllers/apps/publicAppDto.test.ts worker/api/controllers/apps/discover-dto.test.ts
git commit -m "feat(discover): store a signed tall showcase screenshot for public listings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Showcase capture service

**Files:**
- Modify: `worker/services/browser-capture/capture-core.ts:142` (add a constant after `PHONE_VIEWPORT`)
- Create: `worker/services/showcase/showcase-screenshot.ts` (pure core)
- Create: `worker/services/showcase/showcase-capture.ts` (client, R2 and D1 wiring)
- Create: `worker/services/showcase/showcase-refresh.ts` (capture from a store's public preview)
- Test: `worker/services/showcase/showcase-screenshot.test.ts`

**Interfaces:**
- Consumes:
  - `AppService.updateAppShowcaseScreenshot` (Task 3);
  - `getBrowserCaptureClient(env, logger)`;
  - `uploadImage(env, image, ImageType.SCREENSHOTS)`;
  - `detectBlankScreenshot(base64, minFileSize?, minEntropy?)`;
  - `getAgentStub(env, appId)`, whose `.getPublicPreviewURL()` returns `Promise<string | null>`.
- Produces:
  - `SHOWCASE_VIEWPORT = { width: 1280, height: 1650 }`;
  - `SHOWCASE_SCREENSHOT_FILENAME = 'showcase.jpg'`;
  - `SHOWCASE_REFRESH_BATCH = 10` and `SHOWCASE_REFRESH_CONCURRENCY = 3`;
  - `type ShowcaseCaptureResult = 'stored' | 'blank' | 'failed'`;
  - `interface ShowcaseCaptureDeps { capture(url): Promise<string>; store(appId, base64Jpeg): Promise<string>; save(appId, url): Promise<boolean>; logger: Pick<StructuredLogger, 'info' | 'warn'> }`;
  - `captureShowcaseScreenshot(deps, appId, previewUrl): Promise<ShowcaseCaptureResult>`, which never throws;
  - `runShowcaseRefresh(appIds, refreshOne, concurrency?): Promise<{ captured: number; failed: number }>`;
  - `showcaseEligible(publishing: { visibility: 'private' | 'public'; removedFromDiscoverAt: Date | null } | null): boolean`;
  - `createShowcaseCaptureDeps(env, logger): ShowcaseCaptureDeps`;
  - `refreshShowcaseScreenshot(env, logger, appId): Promise<ShowcaseCaptureResult>`.

- [ ] **Step 1: Write the failing test**

Create `worker/services/showcase/showcase-screenshot.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { SHOWCASE_VIEWPORT } from '../browser-capture/capture-core';
import {
	captureShowcaseScreenshot,
	runShowcaseRefresh,
	showcaseEligible,
	type ShowcaseCaptureDeps,
	type ShowcaseCaptureResult,
} from './showcase-screenshot';

/** Base64 of random bytes: as large and varied as a real page capture. */
function pageLikeCapture(bytes: number): string {
	let binary = '';
	for (const byte of crypto.getRandomValues(new Uint8Array(bytes))) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fakeDeps(capture: () => Promise<string>, saveResult = true) {
	const store = vi.fn(async (appId: string) => `/api/screenshots/${appId}/showcase.jpg`);
	const save = vi.fn(async () => saveResult);
	const logger = { info: vi.fn(), warn: vi.fn() };
	const deps: ShowcaseCaptureDeps = { capture: vi.fn(capture), store, save, logger };
	return { deps, store, save, logger };
}

describe('showcase screenshots', () => {
	it('captures a tall 1280x1650 page', () => {
		expect(SHOWCASE_VIEWPORT).toEqual({ width: 1280, height: 1650 });
	});

	it('stores and records a real capture', async () => {
		const image = pageLikeCapture(20_000);
		const { deps, store, save } = fakeDeps(async () => image);
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('stored');
		expect(store).toHaveBeenCalledWith('app1', image);
		expect(save).toHaveBeenCalledWith('app1', '/api/screenshots/app1/showcase.jpg');
	});

	it('keeps the previous image when a capture looks blank', async () => {
		const { deps, store, logger } = fakeDeps(async () => btoa('blank'));
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('blank');
		expect(store).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('reports a failed capture without throwing', async () => {
		const { deps, store, logger } = fakeDeps(async () => {
			throw new Error('Browser Rendering timed out');
		});
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('failed');
		expect(store).not.toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalled();
	});

	it('reports a failure when the app is gone before the image is recorded', async () => {
		const { deps } = fakeDeps(async () => pageLikeCapture(20_000), false);
		expect(await captureShowcaseScreenshot(deps, 'app1', 'https://preview.example/app1')).toBe('failed');
	});

	it('refreshes a few stores at a time and counts every outcome', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const result = await runShowcaseRefresh(
			['a', 'b', 'c', 'd', 'e'],
			async (appId): Promise<ShowcaseCaptureResult> => {
				inFlight += 1;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight -= 1;
				return appId === 'b' ? 'failed' : appId === 'c' ? 'blank' : 'stored';
			},
			2,
		);
		expect(result).toEqual({ captured: 3, failed: 2 });
		expect(maxInFlight).toBe(2);
	});

	it('gives showcase images only to public stores still in Discover', () => {
		expect(showcaseEligible({ visibility: 'public', removedFromDiscoverAt: null })).toBe(true);
		expect(showcaseEligible({ visibility: 'private', removedFromDiscoverAt: null })).toBe(false);
		expect(showcaseEligible({ visibility: 'public', removedFromDiscoverAt: new Date() })).toBe(false);
		expect(showcaseEligible(null)).toBe(false);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `rtk proxy npx vitest run worker/services/showcase`
Expected: FAIL. It cannot resolve `./showcase-screenshot`, and `SHOWCASE_VIEWPORT` is undefined.

- [ ] **Step 3: Add the viewport and write the core**

In `worker/services/browser-capture/capture-core.ts`, after `export const PHONE_VIEWPORT = { width: 390, height: 844, isMobile: true, hasTouch: true };`, add:

```ts
/** Tall desktop view for the landing page's Discover showcase cards: the hero and the sections under it. */
export const SHOWCASE_VIEWPORT = { width: 1280, height: 1650 };
```

Create `worker/services/showcase/showcase-screenshot.ts`:

```ts
/**
 * The tall Discover showcase image of a public store: capture, check, store
 * and record. Dependencies are injected so the rules are tested without a
 * browser, R2 or D1.
 */

import type { StructuredLogger } from '../../logger';
import { detectBlankScreenshot } from '../../utils/images';

export const SHOWCASE_SCREENSHOT_FILENAME = 'showcase.jpg';
/** Stores per admin refresh, and captures running at once, so a batch fits in one request. */
export const SHOWCASE_REFRESH_BATCH = 10;
export const SHOWCASE_REFRESH_CONCURRENCY = 3;
/** A real 1280x1650 page compresses to far more than this; a blank one doesn't. */
const SHOWCASE_MIN_BYTES = 15_000;

export type ShowcaseCaptureResult = 'stored' | 'blank' | 'failed';

export interface ShowcaseCaptureDeps {
	/** Base64 JPEG of the page at the showcase viewport. */
	capture(url: string): Promise<string>;
	/** Store the JPEG and return its URL. */
	store(appId: string, base64Jpeg: string): Promise<string>;
	/** Record the URL on the app; false when the app is gone. */
	save(appId: string, url: string): Promise<boolean>;
	logger: Pick<StructuredLogger, 'info' | 'warn'>;
}

/** Captures and records one store's showcase image. Never throws; a blank or failed capture keeps the previous image. */
export async function captureShowcaseScreenshot(
	deps: ShowcaseCaptureDeps,
	appId: string,
	previewUrl: string,
): Promise<ShowcaseCaptureResult> {
	try {
		const base64 = await deps.capture(previewUrl);
		const blank = detectBlankScreenshot(base64, SHOWCASE_MIN_BYTES);
		if (blank.isBlank) {
			deps.logger.warn('Showcase screenshot looked blank; keeping the previous one', { appId, reason: blank.reason });
			return 'blank';
		}
		const url = await deps.store(appId, base64);
		if (!(await deps.save(appId, url))) return 'failed';
		deps.logger.info('Showcase screenshot stored', { appId });
		return 'stored';
	} catch (error) {
		deps.logger.warn('Showcase screenshot capture failed', {
			appId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}

/** Refreshes stores a few at a time and counts the outcomes; anything not stored counts as failed. */
export async function runShowcaseRefresh(
	appIds: readonly string[],
	refreshOne: (appId: string) => Promise<ShowcaseCaptureResult>,
	concurrency = SHOWCASE_REFRESH_CONCURRENCY,
): Promise<{ captured: number; failed: number }> {
	let captured = 0;
	let failed = 0;
	for (let start = 0; start < appIds.length; start += concurrency) {
		const results = await Promise.all(appIds.slice(start, start + concurrency).map(refreshOne));
		for (const result of results) {
			if (result === 'stored') captured += 1;
			else failed += 1;
		}
	}
	return { captured, failed };
}

/** Only stores shown in Discover get a showcase image: public, and not removed by an admin. */
export function showcaseEligible(
	publishing: { visibility: 'private' | 'public'; removedFromDiscoverAt: Date | null } | null,
): boolean {
	return publishing?.visibility === 'public' && publishing.removedFromDiscoverAt === null;
}
```

- [ ] **Step 4: Write the wiring modules**

Create `worker/services/showcase/showcase-capture.ts`:

```ts
/** Wires showcase captures to the browser capture client, R2 and D1. */

import type { StructuredLogger } from '../../logger';
import { AppService } from '../../database/services/AppService';
import { ImageType, uploadImage } from '../../utils/images';
import { SHOWCASE_VIEWPORT } from '../browser-capture/capture-core';
import { getBrowserCaptureClient } from '../browser-capture/factory';
import { SHOWCASE_SCREENSHOT_FILENAME, type ShowcaseCaptureDeps } from './showcase-screenshot';

const SHOWCASE_TIMEOUT_MS = 15_000;
const SHOWCASE_SETTLE_MS = 2_000;

export function createShowcaseCaptureDeps(env: Env, logger: StructuredLogger): ShowcaseCaptureDeps {
	const client = getBrowserCaptureClient(env, logger);
	const apps = new AppService(env);
	return {
		capture: (url) =>
			client.captureScreenshot({
				url,
				viewport: SHOWCASE_VIEWPORT,
				timeoutMs: SHOWCASE_TIMEOUT_MS,
				settleMs: SHOWCASE_SETTLE_MS,
				format: 'jpeg',
			}),
		store: async (appId, base64Jpeg) =>
			(
				await uploadImage(
					env,
					{ id: appId, filename: SHOWCASE_SCREENSHOT_FILENAME, mimeType: 'image/jpeg', base64Data: base64Jpeg },
					ImageType.SCREENSHOTS,
				)
			).publicUrl,
		save: (appId, url) => apps.updateAppShowcaseScreenshot(appId, url),
		logger,
	};
}
```

Create `worker/services/showcase/showcase-refresh.ts`:

```ts
/** Recaptures a store's showcase image from its public preview, for publishing and the admin refresh. */

import type { StructuredLogger } from '../../logger';
import { getAgentStub } from '../../agents';
import { createShowcaseCaptureDeps } from './showcase-capture';
import { captureShowcaseScreenshot, type ShowcaseCaptureResult } from './showcase-screenshot';

export async function refreshShowcaseScreenshot(env: Env, logger: StructuredLogger, appId: string): Promise<ShowcaseCaptureResult> {
	try {
		const previewUrl = await (await getAgentStub(env, appId)).getPublicPreviewURL();
		if (!previewUrl) return 'failed';
		return await captureShowcaseScreenshot(createShowcaseCaptureDeps(env, logger), appId, previewUrl);
	} catch (error) {
		logger.warn('Showcase screenshot refresh failed', {
			appId,
			error: error instanceof Error ? error.message : String(error),
		});
		return 'failed';
	}
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `rtk proxy npx vitest run worker/services/showcase worker/services/browser-capture`
Expected: PASS.

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add worker/services/browser-capture/capture-core.ts worker/services/showcase
git commit -m "feat(discover): capture tall showcase screenshots with blank checks and batched refreshes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Capture on publish and after deploys

**Files:**
- Modify: `worker/api/controllers/publishing/controller.ts:57-83` (`updateVisibility`) and its imports
- Modify: `worker/agents/core/behaviors/think.ts:991-1017` (the `captureScreenshot` override) and its imports; add a method
- Test: `worker/services/showcase/showcase-wiring.test.ts`

**Interfaces:**
- Consumes:
  - `refreshShowcaseScreenshot` from `worker/services/showcase/showcase-refresh.ts`;
  - `captureShowcaseScreenshot` and `showcaseEligible` from `showcase-screenshot.ts`;
  - `createShowcaseCaptureDeps` from `showcase-capture.ts`;
  - `AppService.getPublishingState(appId)`, which returns `{ visibility, removedFromDiscoverAt, ... } | null`.

- [ ] **Step 1: Write the failing test**

Create `worker/services/showcase/showcase-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/controllers/publishing/controller.ts', '/worker/agents/core/behaviors/think.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

const CONTROLLER = '/worker/api/controllers/publishing/controller.ts';
const THINK = '/worker/agents/core/behaviors/think.ts';

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

describe('showcase capture triggers', () => {
	it('captures in the background once a public publish has succeeded', () => {
		const handler = between(source(CONTROLLER), 'static async updateVisibility(', 'return PublishingController.createSuccessResponse<PublishSiteData>(');
		const afterSuccess = handler.slice(handler.indexOf('if (!outcome.ok)'));
		expect(afterSuccess).toContain("if (parsed.value.visibility === 'public') {");
		expect(afterSuccess).toContain('ctx.waitUntil(refreshShowcaseScreenshot(env, PublishingController.logger, context.pathParams.id));');
	});

	it("refreshes a public store's showcase image right after its thumbnail", () => {
		const think = source(THINK);
		const override = between(think, 'override async captureScreenshot(', 'private captureDeployedScreenshot(): void {');
		expect(override.indexOf('this.queueShowcaseCapture(url);')).toBeGreaterThan(override.indexOf('screenshotCommit: commit'));
		const queue = between(think, 'private queueShowcaseCapture(url: string): void {', 'private pendingScreenshotCommit(): string | null {');
		expect(queue).toContain('getPublishingState(appId)');
		expect(queue).toContain('showcaseEligible(publishing)');
		expect(queue).toContain('captureShowcaseScreenshot(createShowcaseCaptureDeps(this.env, this.logger), appId, url)');
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `rtk proxy npx vitest run worker/services/showcase/showcase-wiring.test.ts`
Expected: FAIL. Markers such as `private queueShowcaseCapture(url: string): void {` are not found, and the waitUntil line is missing.

- [ ] **Step 3: Capture after a public publish**

In `worker/api/controllers/publishing/controller.ts`:
- Add the import `import { refreshShowcaseScreenshot } from '../../../services/showcase/showcase-refresh';` next to the other service imports.
- In `updateVisibility`, rename the parameter `_ctx: ExecutionContext,` to `ctx: ExecutionContext,`.
- Between the `if (!outcome.ok) { ... }` block and `return PublishingController.createSuccessResponse<PublishSiteData>({`, insert:

```ts
            if (parsed.value.visibility === 'public') {
                // A failed capture never fails the publish; it's retried after the next deploy or from the admin page.
                ctx.waitUntil(refreshShowcaseScreenshot(env, PublishingController.logger, context.pathParams.id));
            }
```

- [ ] **Step 4: Capture after the thumbnail of a public app's deploy**

In `worker/agents/core/behaviors/think.ts`, add these imports next to `import { screenshotTarget } from '../../think/screenshot-policy';`:

```ts
import { createShowcaseCaptureDeps } from '../../../services/showcase/showcase-capture';
import { captureShowcaseScreenshot, showcaseEligible } from '../../../services/showcase/showcase-screenshot';
```

In the `override async captureScreenshot(` method, replace:

```ts
			const screenshotUrl = await super.captureScreenshot(url, viewport);
			this.setState({ ...this.state, screenshotCommit: commit });
			return screenshotUrl;
```

with:

```ts
			const screenshotUrl = await super.captureScreenshot(url, viewport);
			this.setState({ ...this.state, screenshotCommit: commit });
			this.queueShowcaseCapture(url);
			return screenshotUrl;
```

Directly before `	private pendingScreenshotCommit(): string | null {`, add:

```ts
	/** Public stores also get the tall Discover showcase image of the same deploy. Runs in the background. */
	private queueShowcaseCapture(url: string): void {
		const appId = this.getAgentId();
		void new AppService(this.env)
			.getPublishingState(appId)
			.then((publishing) =>
				showcaseEligible(publishing)
					? captureShowcaseScreenshot(createShowcaseCaptureDeps(this.env, this.logger), appId, url)
					: null,
			)
			.catch((e: unknown) => this.logger.warn('Showcase screenshot skipped', e));
	}

```

`AppService` is already imported in `think.ts` from `'worker/database/services/AppService'`.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `rtk proxy npx vitest run worker/services/showcase worker/services/browser-capture`
Expected: PASS, including the existing `screenshot-wiring.test.ts`.

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add worker/api/controllers/publishing/controller.ts worker/agents/core/behaviors/think.ts worker/services/showcase/showcase-wiring.test.ts
git commit -m "feat(discover): capture showcase images when a store goes public and after its deploys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin refresh of missing showcase images

**Files:**
- Modify: `worker/database/services/AppService.ts` (the drizzle import at line 7, plus a new method)
- Modify: `worker/api/controllers/publishing/types.ts` (a new response type)
- Modify: `worker/api/controllers/publishing/adminController.ts` (a new method, plus imports)
- Modify: `worker/api/routes/publishingRoutes.ts:21-29` (a new route)
- Modify: `src/api-types.ts` (re-export the type next to `DiscoverRemovalData`, line ~236)
- Modify: `src/lib/api-client.ts` (a method after `setDiscoverRemoval`)
- Modify: `src/hooks/use-publishing.ts` (a hook after `useSetDiscoverRemoval`)
- Create: `src/lib/showcase-refresh-message.ts`
- Modify: `src/routes/admin/reviews.tsx` (a section before `<SalesSection />`)
- Test: `worker/database/showcase-candidates.test.ts`, `worker/api/controllers/publishing/showcase-refresh-wiring.test.ts`, `src/lib/showcase-refresh-message.test.ts`

**Interfaces:**
- Consumes:
  - `SHOWCASE_REFRESH_BATCH` and `runShowcaseRefresh` from `worker/services/showcase/showcase-screenshot.ts`;
  - `refreshShowcaseScreenshot` from `worker/services/showcase/showcase-refresh.ts`.
- Produces:
  - `AppService.listAppsMissingShowcase(limit: number): Promise<{ ids: string[]; remaining: number }>`;
  - `interface ShowcaseRefreshData { attempted: number; captured: number; failed: number; remaining: number }`;
  - `POST /api/admin/showcase-screenshots/refresh` (admin only);
  - `apiClient.refreshShowcaseScreenshots()`;
  - `useRefreshShowcaseScreenshots()`;
  - `showcaseRefreshMessage(result): string`.

- [ ] **Step 1: Write the failing tests**

Create `worker/database/showcase-candidates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppService } from './services/AppService';
import { recordingD1 } from './test-support/recording-d1';

describe('AppService.listAppsMissingShowcase', () => {
	it('picks deployed public stores still in Discover that have no showcase image, newest deploy first', async () => {
		const { d1, statements } = recordingD1((sql) => (sql.toLowerCase().includes('count(') ? [[5]] : [['app1'], ['app2']]));
		const result = await new AppService({ DB: d1 } as unknown as Env).listAppsMissingShowcase(2);
		expect(result).toEqual({ ids: ['app1', 'app2'], remaining: 3 });
		const select = statements
			.map((statement) => statement.sql.toLowerCase().replace(/\s+/g, ' '))
			.find((sql) => !sql.includes('count('));
		expect(select).toContain('"apps"."visibility" = ?');
		expect(select).toContain('"apps"."removed_from_discover_at" is null');
		expect(select).toContain('"apps"."last_deployed_at" is not null');
		expect(select).toContain('"apps"."showcase_screenshot_url" is null');
		expect(select).toContain('order by "apps"."last_deployed_at" desc');
		expect(select).toContain('limit ?');
	});
});
```

Create `worker/api/controllers/publishing/showcase-refresh-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	['/worker/api/routes/publishingRoutes.ts', '/worker/api/controllers/publishing/adminController.ts'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('admin showcase refresh', () => {
	it('is an admin-only POST route', () => {
		expect(source('/worker/api/routes/publishingRoutes.ts')).toContain(
			"app.post('/api/admin/showcase-screenshots/refresh', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.refreshShowcaseScreenshots));",
		);
	});

	it('captures one batch of stores still missing an image and counts failures as still missing', () => {
		const controller = source('/worker/api/controllers/publishing/adminController.ts');
		const method = controller.slice(controller.indexOf('static async refreshShowcaseScreenshots('));
		expect(method).toContain('listAppsMissingShowcase(SHOWCASE_REFRESH_BATCH)');
		expect(method).toContain('runShowcaseRefresh(ids, (appId) => refreshShowcaseScreenshot(env, ReviewAdminController.logger, appId))');
		expect(method).toContain('remaining: remaining + failed');
	});
});
```

Create `src/lib/showcase-refresh-message.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { showcaseRefreshMessage } from './showcase-refresh-message';

describe('showcaseRefreshMessage', () => {
	it('says so when every store already has an image', () => {
		expect(showcaseRefreshMessage({ attempted: 0, captured: 0, failed: 0, remaining: 0 })).toBe(
			'Every Discover store has a showcase image.',
		);
	});

	it('reports a complete batch', () => {
		expect(showcaseRefreshMessage({ attempted: 10, captured: 10, failed: 0, remaining: 0 })).toBe(
			'Captured 10 of 10. None left to capture.',
		);
	});

	it('reports failures and asks for another round while stores still need one', () => {
		expect(showcaseRefreshMessage({ attempted: 10, captured: 8, failed: 2, remaining: 5 })).toBe(
			'Captured 8 of 10. 2 failed. 5 still need one; refresh again.',
		);
	});
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run worker/database/showcase-candidates.test.ts worker/api/controllers/publishing/showcase-refresh-wiring.test.ts src/lib/showcase-refresh-message.test.ts`
Expected: FAIL. `listAppsMissingShowcase` is not a function, the route and method are missing, and `./showcase-refresh-message` is not found.

- [ ] **Step 3: Add the service method**

In `worker/database/services/AppService.ts`, change the drizzle import on line 7 to include `isNotNull`:

```ts
import { eq, and, or, desc, asc, sql, isNull, isNotNull, inArray } from 'drizzle-orm';
```

After `updateAppShowcaseScreenshot` (added in Task 3), add:

```ts
    /** Deployed public stores still in Discover that have no showcase image yet, most recently deployed first. */
    async listAppsMissingShowcase(limit: number): Promise<{ ids: string[]; remaining: number }> {
        const missing = and(
            eq(schema.apps.visibility, 'public'),
            isNull(schema.apps.removedFromDiscoverAt),
            isNotNull(schema.apps.lastDeployedAt),
            isNull(schema.apps.showcaseScreenshotUrl),
        );
        const [rows, counts] = await Promise.all([
            this.database
                .select({ id: schema.apps.id })
                .from(schema.apps)
                .where(missing)
                .orderBy(desc(schema.apps.lastDeployedAt))
                .limit(limit)
                .all(),
            this.database.select({ count: sql<number>`count(*)` }).from(schema.apps).where(missing).all(),
        ]);
        const total = counts[0]?.count ?? 0;
        return { ids: rows.map((row) => row.id), remaining: Math.max(0, total - rows.length) };
    }
```

- [ ] **Step 4: Add the type, controller method and route**

In `worker/api/controllers/publishing/types.ts`, add:

```ts
/** One admin batch of showcase captures; `remaining` counts stores still without an image, failures included. */
export interface ShowcaseRefreshData {
    attempted: number;
    captured: number;
    failed: number;
    remaining: number;
}
```

In `worker/api/controllers/publishing/adminController.ts`:
- Add `ShowcaseRefreshData` to the existing import from `./types`.
- Add these imports:

```ts
import { SHOWCASE_REFRESH_BATCH, runShowcaseRefresh } from '../../../services/showcase/showcase-screenshot';
import { refreshShowcaseScreenshot } from '../../../services/showcase/showcase-refresh';
```

- Add this method to `ReviewAdminController`, after `setDiscoverRemoval`:

```ts
    /** Capture showcase images for Discover stores that lack one, one batch per call. */
    static async refreshShowcaseScreenshots(
        _request: Request,
        env: Env,
        _ctx: ExecutionContext,
        _context: RouteContext,
    ): Promise<ControllerResponse<ApiResponse<ShowcaseRefreshData>>> {
        try {
            const { ids, remaining } = await new AppService(env).listAppsMissingShowcase(SHOWCASE_REFRESH_BATCH);
            const { captured, failed } = await runShowcaseRefresh(ids, (appId) => refreshShowcaseScreenshot(env, ReviewAdminController.logger, appId));
            return ReviewAdminController.createSuccessResponse<ShowcaseRefreshData>({
                attempted: ids.length,
                captured,
                failed,
                remaining: remaining + failed,
            });
        } catch (error) {
            this.logger.error('Error refreshing showcase screenshots', error);
            return ReviewAdminController.createErrorResponse<ShowcaseRefreshData>('Failed to refresh the showcase images', 500);
        }
    }
```

In `worker/api/routes/publishingRoutes.ts`, after the `app.put('/api/admin/apps/:id/discover', ...)` line, add:

```ts
    app.post('/api/admin/showcase-screenshots/refresh', setAuthLevel(AuthConfig.admin), adaptController(ReviewAdminController, ReviewAdminController.refreshShowcaseScreenshots));
```

- [ ] **Step 5: Add the frontend type, client, hook, message and admin section**

In `src/api-types.ts`, in the export block that lists `DiscoverRemovalData` (around line 236), add `	ShowcaseRefreshData,` next to it.

In `src/lib/api-client.ts`, add `ShowcaseRefreshData` to the type imports from `@/api-types`. After the `setDiscoverRemoval` method, add:

```ts
	/** Admins only: capture the showcase images Discover stores are still missing, one batch per call. */
	async refreshShowcaseScreenshots(): Promise<ApiResponse<ShowcaseRefreshData>> {
		return this.request<ShowcaseRefreshData>('/api/admin/showcase-screenshots/refresh', { method: 'POST' });
	}
```

In `src/hooks/use-publishing.ts`, after `useSetDiscoverRemoval`, add:

```ts
/** Admins only: capture the showcase images Discover stores are still missing, one batch per call. */
export function useRefreshShowcaseScreenshots() {
	return usePublishingMutation((_input: void) =>
		unwrap(apiClient.refreshShowcaseScreenshots(), "Couldn't refresh the showcase images"),
	);
}
```

Create `src/lib/showcase-refresh-message.ts`:

```ts
import type { ShowcaseRefreshData } from '@/api-types';

/** One line for the admin page after a showcase refresh. */
export function showcaseRefreshMessage(result: ShowcaseRefreshData): string {
	if (result.attempted === 0) return 'Every Discover store has a showcase image.';
	const parts = [`Captured ${result.captured} of ${result.attempted}.`];
	if (result.failed > 0) parts.push(`${result.failed} failed.`);
	parts.push(result.remaining > 0 ? `${result.remaining} still need one; refresh again.` : 'None left to capture.');
	return parts.join(' ');
}
```

In `src/routes/admin/reviews.tsx`:
- Change the hooks import to also import `useRefreshShowcaseScreenshots`.
- Add `import { showcaseRefreshMessage } from '@/lib/showcase-refresh-message';`.
- Immediately before `<SalesSection />`, insert `<ShowcaseImagesSection />`.
- Add this component after `AdminReviewsPage`:

```tsx
/** Captures the tall Discover showcase images that stores are still missing, a batch per click. */
function ShowcaseImagesSection() {
	const refresh = useRefreshShowcaseScreenshots();
	return (
		<section className="grid gap-3 pt-4">
			<div className="grid gap-1">
				<h2 className="text-xl font-semibold text-kumo-strong">Showcase images</h2>
				<p className="text-sm text-kumo-subtle">
					The landing page shows a tall image of each Discover store. Stores get one when they're published or redeployed;
					this captures the ones still missing.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<Button size="sm" variant="secondary" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
					{refresh.isPending ? 'Capturing…' : 'Refresh showcase images'}
				</Button>
				{refresh.data && <p className="text-sm text-kumo-subtle">{showcaseRefreshMessage(refresh.data)}</p>}
				{refresh.isError && <p className="text-sm text-kumo-danger">{refresh.error.message}</p>}
			</div>
		</section>
	);
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `rtk proxy npx vitest run worker/database/showcase-candidates.test.ts worker/api/controllers/publishing src/lib/showcase-refresh-message.test.ts`
Expected: PASS.

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add worker/database/services/AppService.ts worker/api/controllers/publishing/types.ts worker/api/controllers/publishing/adminController.ts worker/api/routes/publishingRoutes.ts src/api-types.ts src/lib/api-client.ts src/hooks/use-publishing.ts src/lib/showcase-refresh-message.ts src/routes/admin/reviews.tsx worker/database/showcase-candidates.test.ts worker/api/controllers/publishing/showcase-refresh-wiring.test.ts src/lib/showcase-refresh-message.test.ts
git commit -m "feat(admin): capture missing showcase images in batches from the reviews page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Showcase data on the frontend

**Files:**
- Create: `src/lib/store-wordmark.ts`, `src/lib/showcase.ts`, `src/hooks/use-showcase-stores.ts`
- Modify: `src/lib/query-keys.ts` (`apps` block), `src/lib/query-client.ts` (`NON_PERSISTED_KEY_PREFIXES`)
- Test: `src/lib/store-wordmark.test.ts`, `src/lib/showcase.test.ts`, `src/lib/query-client.test.ts`, `src/hooks/use-showcase-stores-guard.test.ts`

**Interfaces:**
- Consumes: `PublicAppListData.showcaseScreenshotUrl` (Task 3), through `PublicAppsData` in `@/api-types`.
- Produces:
  - `storeWordmark(title: string): string`.
  - `type ShowcaseSource`, `interface ShowcaseStore { id, title, wordmark, category, categoryLabel, priceLabel, isFree, byline, imageUrl, tallImage }`.
  - `type ShowcaseFilter = 'all' | TemplateCategory`.
  - `type ShowcaseLayout = { kind: 'static'; row } | { kind: 'marquee'; rows: [a, b] }`.
  - `SHOWCASE_MIN_STORES = 3`, `SHOWCASE_STATIC_MAX = 3`.
  - Functions: `toShowcaseStore(app)`, `shouldShowShowcase(count)`, `storesWithImages(stores)`, `showcaseFilters(stores)`, `showcaseFilterLabel(filter)`, `filterShowcase(stores, filter)`, `showcaseLayout(stores)`.
  - `useShowcaseStores()`, which returns a `useQuery` result whose data is `ShowcaseStore[]`.
  - `queryKeys.apps.showcase()`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/store-wordmark.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { storeWordmark } from './store-wordmark';

describe('storeWordmark', () => {
	it('drops generic endings that name the kind of site', () => {
		expect(storeWordmark('North Ridge Coffee Store')).toBe('North Ridge Coffee');
		expect(storeWordmark('Lumen Yoga Studio Website')).toBe('Lumen Yoga Studio');
		expect(storeWordmark('Pop Landing Page')).toBe('Pop');
		expect(storeWordmark('Maison Verde Shop Template')).toBe('Maison Verde');
	});

	it('keeps a title with no generic ending', () => {
		expect(storeWordmark('Saltmarsh Surf School')).toBe('Saltmarsh Surf School');
	});

	it('ignores case and extra spaces', () => {
		expect(storeWordmark('  Aloha   STORE ')).toBe('Aloha');
	});

	it('always keeps the first word, so a wordmark is never empty', () => {
		expect(storeWordmark('Store')).toBe('Store');
		expect(storeWordmark('My Store')).toBe('My');
	});
});
```

Create `src/lib/showcase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
	filterShowcase,
	shouldShowShowcase,
	showcaseFilterLabel,
	showcaseFilters,
	showcaseLayout,
	storesWithImages,
	toShowcaseStore,
	type ShowcaseSource,
} from './showcase';

const base: ShowcaseSource = {
	id: 'north-ridge',
	title: 'North Ridge Coffee Store',
	category: 'store',
	priceCents: 2900,
	userName: 'Estori Team',
	screenshotUrl: '/api/screenshots/north-ridge/latest.png?token=a',
	showcaseScreenshotUrl: '/api/screenshots/north-ridge/showcase.jpg?token=a',
};

function store(overrides: Partial<ShowcaseSource> = {}) {
	return toShowcaseStore({ ...base, ...overrides });
}

describe('showcase stores', () => {
	it('maps price, category, creator and the tall image', () => {
		expect(store()).toEqual({
			id: 'north-ridge',
			title: 'North Ridge Coffee Store',
			wordmark: 'North Ridge Coffee',
			category: 'store',
			categoryLabel: 'Store',
			priceLabel: '$29',
			isFree: false,
			byline: 'by Estori Team',
			imageUrl: '/api/screenshots/north-ridge/showcase.jpg?token=a',
			tallImage: true,
		});
	});

	it('falls back to the desktop screenshot, and leaves out a missing creator, category and price', () => {
		const item = store({ showcaseScreenshotUrl: null, userName: null, category: null, priceCents: null });
		expect(item.imageUrl).toBe('/api/screenshots/north-ridge/latest.png?token=a');
		expect(item.tallImage).toBe(false);
		expect(item.byline).toBeNull();
		expect(item.categoryLabel).toBeNull();
		expect(item.priceLabel).toBe('Free');
		expect(item.isFree).toBe(true);
	});

	it('leaves stores without any screenshot out of the showcase', () => {
		const stores = [store(), store({ id: 'x', screenshotUrl: null, showcaseScreenshotUrl: null })];
		expect(storesWithImages(stores).map((s) => s.id)).toEqual(['north-ridge']);
	});

	it('hides the sections at two stores or fewer', () => {
		expect(shouldShowShowcase(0)).toBe(false);
		expect(shouldShowShowcase(2)).toBe(false);
		expect(shouldShowShowcase(3)).toBe(true);
	});

	it("offers All plus the categories present, in Discover's order, and no filters for a single category", () => {
		const mixed = [store({ id: 'a', category: 'landing' }), store({ id: 'b' }), store({ id: 'c' })];
		expect(showcaseFilters(mixed)).toEqual(['all', 'store', 'landing']);
		expect(showcaseFilters([store({ id: 'a' }), store({ id: 'b' })])).toEqual([]);
		expect(showcaseFilterLabel('all')).toBe('All');
		expect(showcaseFilterLabel('landing')).toBe('Landing page');
	});

	it('filters by category', () => {
		const mixed = [store({ id: 'a', category: 'landing' }), store({ id: 'b' })];
		expect(filterShowcase(mixed, 'landing').map((s) => s.id)).toEqual(['a']);
		expect(filterShowcase(mixed, 'all').map((s) => s.id)).toEqual(['a', 'b']);
	});

	it('shows three stores or fewer as one still row, and more as two rows in opposite order', () => {
		const three = ['a', 'b', 'c'].map((id) => store({ id }));
		expect(showcaseLayout(three)).toEqual({ kind: 'static', row: three });
		const four = ['a', 'b', 'c', 'd'].map((id) => store({ id }));
		const layout = showcaseLayout(four);
		expect(layout.kind).toBe('marquee');
		if (layout.kind === 'marquee') {
			expect(layout.rows[0].map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
			expect(layout.rows[1].map((s) => s.id)).toEqual(['d', 'c', 'b', 'a']);
		}
	});
});
```

In `src/lib/query-client.test.ts`, add inside the existing `describe`:

```ts
	it('never persists the landing showcase, whose screenshot links expire', () => {
		expect(shouldDehydrateQuery({ queryKey: queryKeys.apps.showcase(), state: { status: 'success' } })).toBe(false);
	});
```

Create `src/hooks/use-showcase-stores-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/hooks/use-showcase-stores.ts'], { query: '?raw', import: 'default', eager: true });

describe('useShowcaseStores', () => {
	it('reads popular reusable Discover stores under its own query key', () => {
		const hook = sources['/src/hooks/use-showcase-stores.ts'];
		expect(hook).toBeDefined();
		expect(hook).toContain("getPublicApps({ sort: 'popular', limit: 24, reusableOnly: true })");
		expect(hook).toContain('queryKeys.apps.showcase()');
		expect(hook).toContain('.map(toShowcaseStore)');
	});
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run src/lib/store-wordmark.test.ts src/lib/showcase.test.ts src/lib/query-client.test.ts src/hooks/use-showcase-stores-guard.test.ts`
Expected: FAIL. The modules are not found, and `queryKeys.apps.showcase` is not a function.

- [ ] **Step 3: Write the wordmark and showcase helpers**

Create `src/lib/store-wordmark.ts`:

```ts
/** Endings that name the kind of site rather than the brand. */
const GENERIC_ENDINGS = ['landing page', 'website', 'template', 'theme', 'store', 'shop', 'site'] as const;

/** A store's name for the logo strip: its title without generic endings, never empty. */
export function storeWordmark(title: string): string {
	let words = title.trim().split(/\s+/).filter(Boolean);
	let trimmed = true;
	while (trimmed) {
		trimmed = false;
		for (const ending of GENERIC_ENDINGS) {
			const size = ending.split(' ').length;
			if (words.length > size && words.slice(-size).join(' ').toLowerCase() === ending) {
				words = words.slice(0, -size);
				trimmed = true;
				break;
			}
		}
	}
	return words.join(' ');
}
```

Create `src/lib/showcase.ts`:

```ts
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_CATEGORY_LABELS,
	formatTemplatePrice,
	type PublicAppsData,
	type TemplateCategory,
} from '@/api-types';
import { storeWordmark } from './store-wordmark';

/** The listing fields the landing page reads. */
export type ShowcaseSource = Pick<
	PublicAppsData['apps'][number],
	'id' | 'title' | 'category' | 'priceCents' | 'userName' | 'screenshotUrl' | 'showcaseScreenshotUrl'
>;

export interface ShowcaseStore {
	id: string;
	title: string;
	wordmark: string;
	category: TemplateCategory | null;
	categoryLabel: string | null;
	priceLabel: string;
	isFree: boolean;
	byline: string | null;
	imageUrl: string | null;
	/** The tall showcase capture; false when falling back to the desktop thumbnail. */
	tallImage: boolean;
}

export type ShowcaseFilter = 'all' | TemplateCategory;

export type ShowcaseLayout =
	| { kind: 'static'; row: ShowcaseStore[] }
	| { kind: 'marquee'; rows: [ShowcaseStore[], ShowcaseStore[]] };

/** The logo strip and the showcase each stay hidden below this many stores. */
export const SHOWCASE_MIN_STORES = 3;
/** A set this small shows as one still row; a marquee of so few cards would repeat itself. */
export const SHOWCASE_STATIC_MAX = 3;

export function toShowcaseStore(app: ShowcaseSource): ShowcaseStore {
	const priceCents = app.priceCents ?? 0;
	const category = app.category ?? null;
	return {
		id: app.id,
		title: app.title,
		wordmark: storeWordmark(app.title),
		category,
		categoryLabel: category ? TEMPLATE_CATEGORY_LABELS[category] : null,
		priceLabel: formatTemplatePrice(priceCents),
		isFree: priceCents <= 0,
		byline: app.userName ? `by ${app.userName}` : null,
		imageUrl: app.showcaseScreenshotUrl ?? app.screenshotUrl ?? null,
		tallImage: Boolean(app.showcaseScreenshotUrl),
	};
}

export function shouldShowShowcase(count: number): boolean {
	return count >= SHOWCASE_MIN_STORES;
}

export function storesWithImages(stores: readonly ShowcaseStore[]): ShowcaseStore[] {
	return stores.filter((store) => store.imageUrl !== null);
}

/** "All" plus each category present, in Discover's order; none when the stores share one category. */
export function showcaseFilters(stores: readonly ShowcaseStore[]): ShowcaseFilter[] {
	const present = TEMPLATE_CATEGORIES.filter((category) => stores.some((store) => store.category === category));
	return present.length > 1 ? ['all', ...present] : [];
}

export function showcaseFilterLabel(filter: ShowcaseFilter): string {
	return filter === 'all' ? 'All' : TEMPLATE_CATEGORY_LABELS[filter];
}

export function filterShowcase(stores: readonly ShowcaseStore[], filter: ShowcaseFilter): ShowcaseStore[] {
	return filter === 'all' ? [...stores] : stores.filter((store) => store.category === filter);
}

export function showcaseLayout(stores: readonly ShowcaseStore[]): ShowcaseLayout {
	if (stores.length <= SHOWCASE_STATIC_MAX) return { kind: 'static', row: [...stores] };
	return { kind: 'marquee', rows: [[...stores], [...stores].reverse()] };
}
```

- [ ] **Step 4: Add the query key, keep it out of storage, and add the hook**

In `src/lib/query-keys.ts`, inside `apps`, after the `strip:` line, add:

```ts
		/** The landing page's logo strip and showcase; carries signed screenshot links. */
		showcase: () => [...queryKeys.apps.all, 'showcase'] as const,
```

In `src/lib/query-client.ts`:
- Add `	queryKeys.apps.showcase(),` to `NON_PERSISTED_KEY_PREFIXES`, after `queryKeys.apps.sitePageAll(),`.
- Extend the comment above that list with: "The landing showcase carries screenshot links that expire after six hours."

Create `src/hooks/use-showcase-stores.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { toShowcaseStore } from '@/lib/showcase';
import { unwrap } from '@/lib/unwrap-response';

/** Popular reusable Discover stores for the landing page's logo strip and showcase. */
export function useShowcaseStores() {
	return useQuery({
		queryKey: queryKeys.apps.showcase(),
		queryFn: async () =>
			(
				await unwrap(apiClient.getPublicApps({ sort: 'popular', limit: 24, reusableOnly: true }), "Couldn't load Discover stores")
			).apps.map(toShowcaseStore),
		staleTime: 60_000,
	});
}
```

- [ ] **Step 5: Run the tests**

Run: `rtk proxy npx vitest run src/lib src/hooks`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/store-wordmark.ts src/lib/showcase.ts src/hooks/use-showcase-stores.ts src/lib/query-keys.ts src/lib/query-client.ts src/lib/store-wordmark.test.ts src/lib/showcase.test.ts src/lib/query-client.test.ts src/hooks/use-showcase-stores-guard.test.ts
git commit -m "feat(public): select Discover stores for the logo strip and showcase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Public chrome: primitives, announcement bar, top bar and footer

**Files:**
- Create: `src/components/public-site/primitives.tsx`
- Create: `src/components/layout/AnnouncementBar.tsx`
- Modify: `src/components/layout/PublicTopBar.tsx` (whole file), `src/components/layout/SiteFooter.tsx` (whole file), `src/components/layout/PublicLayout.tsx` (the scroll effect)
- Test: `src/components/layout/public-chrome-guard.test.ts`

**Interfaces:**
- Consumes: the Task 1 tokens; `PLATFORM_FEE_LABEL`, `LEGAL_CONTACT`, `LEGAL_ENTITY` and `legalAddressLine` from `@/api-types`; `LEGAL_LINKS`; `EstoriLogo`; `useAuth`; `useAuthModal`.
- Produces, from `primitives.tsx`:
  - class strings `HEADING_HERO`, `HEADING_SECTION`, `HEADING_CARD`, `LEAD`;
  - `type PillVariant = 'blue' | 'white' | 'charcoal' | 'outline-on-dark' | 'outline-on-light'`;
  - `pillClass(variant, className?)`;
  - `PillLink({ to, variant, className, children })`, `TextLink({ to, tone?, className, children })`, `Eyebrow({ tone?, className, children })`, `EdgeFades()`.
- Produces, from `AnnouncementBar.tsx`: `AnnouncementBar()`.
- Produces in `PublicLayout`: links with a hash (`/#creators`, `/#build`) scroll to that element, and other links scroll to the top.

- [ ] **Step 1: Write the failing test**

Create `src/components/layout/public-chrome-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
	[
		'/src/components/layout/AnnouncementBar.tsx',
		'/src/components/layout/PublicTopBar.tsx',
		'/src/components/layout/SiteFooter.tsx',
		'/src/components/layout/PublicLayout.tsx',
		'/src/components/public-site/primitives.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

const ANNOUNCE = '/src/components/layout/AnnouncementBar.tsx';
const TOP = '/src/components/layout/PublicTopBar.tsx';
const FOOTER = '/src/components/layout/SiteFooter.tsx';
const LAYOUT = '/src/components/layout/PublicLayout.tsx';
const PRIMITIVES = '/src/components/public-site/primitives.tsx';

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('public chrome', () => {
	it('announces Discover with the fee from the code and links to the creators panel', () => {
		const bar = source(ANNOUNCE);
		expect(bar).toContain('PLATFORM_FEE_LABEL');
		expect(bar).not.toMatch(/7% \+ \$0\.60/);
		expect(bar).toContain('to="/#creators"');
		expect(bar).toContain('bg-public-gold');
		expect(bar).toContain('truncate');
		expect(bar).toMatch(/className="hidden shrink-0[^"]*sm:inline/);
	});

	it('shows the announcement above a white top bar with the blue build action and a phone menu', () => {
		const top = source(TOP);
		expect(top).toContain('<AnnouncementBar />');
		expect(top).toContain('hidden sm:flex');
		expect(top).toContain('Start building free');
		expect(top).toContain("pillClass('blue'");
		expect(top).toContain('aria-expanded={menuOpen}');
		expect(top).toContain('aria-controls="public-menu"');
		expect(top).toContain("to: '/#creators'");
		expect(top).toContain('}, [pathname, hash]);');
	});

	it('ends every public page with the dark footer: link columns, contacts, wordmark and legal line', () => {
		const footer = source(FOOTER);
		for (const text of ['bg-public-charcoal', 'LEGAL_LINKS.map', 'LEGAL_CONTACT', 'legalAddressLine()', 'LEGAL_ENTITY.name', '<EstoriLogo', "to: '/#creators'"]) {
			expect(footer).toContain(text);
		}
	});

	it('uses fixed public colors, never app tokens that follow the app theme', () => {
		for (const path of [ANNOUNCE, TOP, FOOTER, PRIMITIVES]) expect(source(path)).not.toContain('kumo-');
	});

	it('scrolls to the anchor a link names, else to the top', () => {
		const layout = source(LAYOUT);
		expect(layout).toContain('const { pathname, hash } = useLocation();');
		expect(layout).toContain('scrollIntoView(');
		expect(layout).toContain('scrollTo({ top: 0 })');
	});

	it('sets the 1Password type scale and pill buttons in one place', () => {
		const primitives = source(PRIMITIVES);
		expect(primitives).toContain("export const HEADING_HERO = 'text-[44px] leading-[1.1] font-light tracking-[-0.02em] sm:text-[88px]';");
		expect(primitives).toContain("export const HEADING_SECTION = 'text-4xl leading-[1.1] font-light tracking-[-0.02em] sm:text-[64px]';");
		expect(primitives).toContain('rounded-full px-6 py-2.5 text-base font-normal');
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `rtk proxy npx vitest run src/components/layout/public-chrome-guard.test.ts`
Expected: FAIL with `Source not found` for `AnnouncementBar.tsx` and `primitives.tsx`.

- [ ] **Step 3: Write the primitives**

Create `src/components/public-site/primitives.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/** The public pages' type scale, after 1Password: light weights and slightly tight tracking. */
export const HEADING_HERO = 'text-[44px] leading-[1.1] font-light tracking-[-0.02em] sm:text-[88px]';
export const HEADING_SECTION = 'text-4xl leading-[1.1] font-light tracking-[-0.02em] sm:text-[64px]';
export const HEADING_CARD = 'text-2xl leading-[1.12] font-light tracking-[-0.015em] sm:text-[30px]';
export const LEAD = 'text-lg leading-normal font-light sm:text-xl';

export type PillVariant = 'blue' | 'white' | 'charcoal' | 'outline-on-dark' | 'outline-on-light';

const PILL_BASE =
	'inline-flex items-center justify-center gap-2 rounded-full px-6 py-2.5 text-base font-normal whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2';

const PILL_VARIANTS: Record<PillVariant, string> = {
	blue: 'bg-public-blue text-white hover:bg-public-blue-hover focus-visible:outline-public-blue',
	white: 'bg-white text-public-blue hover:bg-white/90 focus-visible:outline-white',
	charcoal: 'bg-public-charcoal text-white hover:bg-black focus-visible:outline-white',
	'outline-on-dark': 'text-white ring ring-inset ring-white/85 hover:bg-white/10 focus-visible:outline-white',
	'outline-on-light': 'text-public-charcoal ring ring-inset ring-public-charcoal hover:bg-public-charcoal/5 focus-visible:outline-public-charcoal',
};

export function pillClass(variant: PillVariant, className?: string): string {
	return cn(PILL_BASE, PILL_VARIANTS[variant], className);
}

export function PillLink({ to, variant, className, children }: { to: string; variant: PillVariant; className?: string; children: ReactNode }) {
	return (
		<Link to={to} className={pillClass(variant, className)}>
			{children}
		</Link>
	);
}

export function TextLink({ to, tone = 'light', className, children }: { to: string; tone?: 'light' | 'dark'; className?: string; children: ReactNode }) {
	return (
		<Link
			to={to}
			className={cn(
				'inline-block text-[15px] underline decoration-1 underline-offset-[5px] hover:decoration-2',
				tone === 'dark' ? 'text-white' : 'text-public-ink',
				className,
			)}
		>
			{children}
		</Link>
	);
}

export function Eyebrow({ tone = 'light', className, children }: { tone?: 'light' | 'dark'; className?: string; children: ReactNode }) {
	return (
		<p className={cn('text-xs font-normal uppercase tracking-[0.02em]', tone === 'dark' ? 'text-white/80' : 'text-public-ink/80', className)}>
			{children}
		</p>
	);
}

/** Fades the ends of a full-width marquee into the charcoal background. */
export function EdgeFades() {
	return (
		<>
			<span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-public-charcoal to-transparent sm:w-32" />
			<span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-public-charcoal to-transparent sm:w-32" />
		</>
	);
}
```

- [ ] **Step 4: Write the announcement bar, top bar and footer**

Create `src/components/layout/AnnouncementBar.tsx`:

```tsx
import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';

/** Gold strip above the top bar, as on 1Password: the Discover news, plus Sign in on wider screens. */
export function AnnouncementBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	return (
		<div className="bg-public-gold text-public-charcoal">
			<div className="mx-auto flex h-11 max-w-[1248px] items-center justify-between gap-4 px-4 text-[13px] sm:px-6">
				<p className="min-w-0 truncate">
					Estori Discover is open: sell the stores you design and keep the price minus {PLATFORM_FEE_LABEL}.{' '}
					<Link to="/#creators" className="underline underline-offset-4">
						Learn more →
					</Link>
				</p>
				{!isAuthenticated && (
					<button type="button" onClick={() => showAuthModal()} className="hidden shrink-0 hover:underline sm:inline">
						Sign in
					</button>
				)}
			</div>
		</div>
	);
}
```

Replace `src/components/layout/PublicTopBar.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ListIcon, XIcon } from '@phosphor-icons/react';
import { EstoriLogo, BRAND } from '@/brand';
import { useAuth } from '@/contexts/auth-context';
import { useAuthModal } from '@/components/auth/AuthModalProvider';
import { pillClass } from '@/components/public-site/primitives';
import { AnnouncementBar } from './AnnouncementBar';

const NAV_LINKS = [
	{ to: '/discover', label: 'Discover' },
	{ to: '/pricing', label: 'Pricing' },
	{ to: '/#creators', label: 'For creators' },
] as const;

/** Top of every public page: the gold announcement, then a white bar with the brand, links, sign-in and the build action. */
export function PublicTopBar() {
	const { isAuthenticated } = useAuth();
	const { showAuthModal } = useAuthModal();
	const { pathname, hash } = useLocation();
	const navigate = useNavigate();
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		setMenuOpen(false);
	}, [pathname, hash]);

	const startBuilding = () => {
		setMenuOpen(false);
		if (pathname === '/') {
			document.getElementById('build')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		navigate('/');
	};

	return (
		<header className="sticky top-0 z-40">
			<AnnouncementBar />
			<div className="border-b border-public-line bg-white">
				<div className="mx-auto flex h-16 max-w-[1248px] items-center justify-between gap-4 px-4 sm:h-[72px] sm:px-6">
					<div className="flex items-center gap-8">
						<Link to="/" aria-label={`${BRAND.name} home`} className="flex items-center text-public-brand">
							<EstoriLogo className="h-7 w-auto" />
						</Link>
						<nav aria-label="Main" className="hidden sm:flex items-center gap-6 text-[15px] text-public-charcoal">
							{NAV_LINKS.map((link) => (
								<Link key={link.to} to={link.to} className="underline-offset-4 hover:underline">
									{link.label}
								</Link>
							))}
						</nav>
					</div>
					<div className="flex items-center gap-4">
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
							className="rounded-full p-2 text-public-charcoal sm:hidden"
							aria-expanded={menuOpen}
							aria-controls="public-menu"
							aria-label={menuOpen ? 'Close menu' : 'Open menu'}
							onClick={() => setMenuOpen((open) => !open)}
						>
							{menuOpen ? <XIcon className="size-6" aria-hidden /> : <ListIcon className="size-6" aria-hidden />}
						</button>
					</div>
				</div>
				{menuOpen && (
					<nav id="public-menu" aria-label="Main" className="grid gap-1 border-t border-public-line px-4 py-4 sm:hidden">
						{NAV_LINKS.map((link) => (
							<Link key={link.to} to={link.to} className="py-2 text-lg text-public-charcoal">
								{link.label}
							</Link>
						))}
						<button type="button" onClick={startBuilding} className={pillClass('blue', 'mt-3 w-full')}>
							Start building free
						</button>
					</nav>
				)}
			</div>
		</header>
	);
}
```

Replace `src/components/layout/SiteFooter.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EstoriLogo } from '@/brand';
import { LEGAL_CONTACT, LEGAL_ENTITY, legalAddressLine } from '@/api-types';
import { LEGAL_LINKS } from '@/content/legal/legal-documents';

const LINK_COLUMNS = [
	{ title: 'Product', links: [{ to: '/', label: 'Start building' }, { to: '/discover', label: 'Discover' }, { to: '/pricing', label: 'Pricing' }] },
	{ title: 'Creators', links: [{ to: '/#creators', label: 'Sell your stores' }, { to: '/pricing', label: 'Seller fees' }] },
] as const;

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div>
			<h2 className="text-[15px] font-medium">{title}</h2>
			<ul className="mt-4 grid gap-3 text-[15px] font-light text-white/75">{children}</ul>
		</div>
	);
}

/** Dark footer of every public page, as on 1Password: link columns, contacts, a large wordmark and the legal line. */
export function SiteFooter() {
	return (
		<footer className="bg-public-charcoal text-white">
			<div className="mx-auto max-w-[1248px] px-4 pt-16 pb-8 sm:px-6">
				<div className="grid grid-cols-2 gap-10 md:grid-cols-4">
					{LINK_COLUMNS.map((column) => (
						<FooterColumn key={column.title} title={column.title}>
							{column.links.map((link) => (
								<li key={link.label}>
									<Link to={link.to} className="hover:text-white">{link.label}</Link>
								</li>
							))}
						</FooterColumn>
					))}
					<FooterColumn title="Legal">
						{LEGAL_LINKS.map((link) => (
							<li key={link.slug}>
								<Link to={link.path} className="hover:text-white">{link.label}</Link>
							</li>
						))}
					</FooterColumn>
					<FooterColumn title="Contact">
						{Object.values(LEGAL_CONTACT).map((address) => (
							<li key={address}>
								<a href={`mailto:${address}`} className="hover:text-white">{address}</a>
							</li>
						))}
					</FooterColumn>
				</div>
				<EstoriLogo className="mt-16 h-14 w-auto text-white sm:h-[76px]" />
				<div className="mt-6 flex flex-col gap-4 border-t border-white/15 pt-6 text-[13px] text-white/70 md:flex-row md:items-center md:justify-between">
					<nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2">
						{LEGAL_LINKS.map((link) => (
							<Link key={link.slug} to={link.path} className="hover:text-white">{link.label}</Link>
						))}
					</nav>
					<p>
						© {new Date().getFullYear()} {LEGAL_ENTITY.name} · {legalAddressLine()}
					</p>
				</div>
			</div>
		</footer>
	);
}
```

In `src/components/layout/PublicLayout.tsx`, replace:

```tsx
	const { pathname } = useLocation();

	// This container stays mounted across public routes, so each page starts at the top.
	useEffect(() => {
		scrollRef.current?.scrollTo({ top: 0 });
	}, [pathname]);
```

with:

```tsx
	const { pathname, hash } = useLocation();

	// This container stays mounted across public routes: go to the anchor a link names, else to the top.
	useEffect(() => {
		const target = hash ? document.getElementById(hash.slice(1)) : null;
		if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
		else scrollRef.current?.scrollTo({ top: 0 });
	}, [pathname, hash]);
```

- [ ] **Step 5: Run the tests**

Run: `rtk proxy npx vitest run src/components/layout src/routes/public-pages-guard.test.ts src/brand src/styles`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/public-site/primitives.tsx src/components/layout/AnnouncementBar.tsx src/components/layout/PublicTopBar.tsx src/components/layout/SiteFooter.tsx src/components/layout/PublicLayout.tsx src/components/layout/public-chrome-guard.test.ts
git commit -m "feat(public): 1Password-style announcement bar, top bar with phone menu, and dark footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Landing page, upper half: hero, builder demo, store logos, showcase

**Files:**
- Create: `public/marketing/hero-store.jpg`
- Create: `src/routes/landing/Hero.tsx`, `src/routes/landing/StoreLogos.tsx`, `src/routes/landing/StoreShowcase.tsx`
- Modify: `src/routes/landing/LandingPage.tsx` (whole file); `src/routes/landing/sections.tsx` (remove `STORE_PHRASES`, `Hero` and `FeaturedStores`, and their now-unused imports)
- Modify: `src/routes/landing-guard.test.ts` (whole file)

**Interfaces:**
- Consumes:
  - Task 2: `BorderBeam`, `AnimatedList`, `Safari`, `Marquee`;
  - Task 7: `ShowcaseStore` and the selection helpers, `useShowcaseStores`;
  - Task 8: `HEADING_HERO`, `HEADING_SECTION`, `LEAD`, `Eyebrow`, `TextLink`, `EdgeFades`.
- Produces:
  - `Hero()`, which renders `id="build"` around the build box;
  - `HERO_STORE_IMAGE = '/marketing/hero-store.jpg'`;
  - `StoreLogos({ stores })`;
  - `StoreShowcase({ stores })`, with `id="discover"`.

- [ ] **Step 1: Rewrite the landing guard (failing)**

Replace `src/routes/landing-guard.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';

const pageSources = import.meta.glob<string>(['/src/routes/landing/*.tsx', '/src/components/public-site/*.tsx'], {
	query: '?raw',
	import: 'default',
	eager: true,
});
const otherSources = import.meta.glob<string>(
	['/src/routes/root-index.tsx', '/src/routes/pricing.tsx', '/src/components/build-box.tsx', '/src/routes/home.tsx', '/src/routes.tsx'],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = pageSources[path] ?? otherSources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

const COMPETITORS = ['lovable', 'base44', 'amboras', 'shopify', 'wix', 'squarespace', 'webflow', 'framer', 'bolt.new', 'replit', 'v0.dev', 'durable.co'];

describe('landing page', () => {
	const landing = Object.values(pageSources).join('\n');

	it('shows the landing page signed out and the builder home signed in, with a loader in between', () => {
		const root = source('/src/routes/root-index.tsx');
		expect(root).toContain('isLoading');
		expect(root).toContain('<LandingPage />');
		expect(root).toContain('<Home />');
		expect(root).toContain("view === 'loading'");
		expect(root).toContain('<Loader />');
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

	it('keeps the images note on an opaque surface, readable on the dark hero', () => {
		const box = source('/src/components/build-box.tsx');
		const note = box.slice(box.lastIndexOf('<div', box.indexOf('Images Beta:')), box.indexOf('Images Beta:'));
		expect(note).toContain('bg-kumo-elevated');
		expect(note).not.toMatch(/\bbg-[\w-]+\/\d+/);
	});

	it('shows the builder demo on a bundled store image under a neutral address, with motion from Magic UI', () => {
		const hero = source('/src/routes/landing/Hero.tsx');
		expect(hero).toContain("HERO_STORE_IMAGE = '/marketing/hero-store.jpg'");
		expect(hero).toContain('url="Live preview"');
		expect(hero).toContain('<AnimatedList');
		expect(hero).toContain('<BorderBeam');
		expect(hero).toContain('id="build"');
	});

	it('shows Discover stores as wordmarks and as a showcase, and hides both at two stores or fewer', () => {
		expect(source('/src/routes/landing/LandingPage.tsx')).toContain('useShowcaseStores()');
		const logos = source('/src/routes/landing/StoreLogos.tsx');
		expect(logos).toContain('if (!shouldShowShowcase(stores.length)) return null;');
		expect(logos).toContain('<Marquee');
		const showcase = source('/src/routes/landing/StoreShowcase.tsx');
		expect(showcase).toContain('if (!shouldShowShowcase(withImages.length)) return null;');
		expect(showcase).toContain('<Marquee');
		expect(showcase).toContain('aria-pressed={filter === option}');
		expect(showcase).toContain('to={`/discover/${store.id}`}');
		expect(showcase).toContain('id="discover"');
	});

	it('keeps a card readable when its image fails to load', () => {
		expect(source('/src/routes/landing/StoreShowcase.tsx')).toContain('onError={() => setImageFailed(true)}');
	});

	it('shows no third-party company logos or testimonials', () => {
		expect(landing).not.toMatch(/trusted by/i);
		expect(landing).not.toContain('/img/logos/');
		expect(landing).not.toMatch(/case study/i);
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

	it("hides Safari's default disclosure marker on the FAQ questions", () => {
		const summary = landing.slice(landing.indexOf('<summary'), landing.indexOf('>', landing.indexOf('<summary')));
		expect(summary).toContain('list-none');
		expect(summary).toContain('[&::-webkit-details-marker]:hidden');
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

Run: `rtk proxy npx vitest run src/routes/landing-guard.test.ts`
Expected: FAIL with `Source not found: /src/routes/landing/Hero.tsx` and `.../StoreLogos.tsx`.

- [ ] **Step 3: Add the hero image**

```bash
mkdir -p public/marketing
cp .superpowers/assets/public-site/hero-store.jpg public/marketing/hero-store.jpg
shasum -a 256 public/marketing/hero-store.jpg
```

Expected: `f93b0cdd451e9997a75218e5ad4d22c741a112c1ee12f8a186a1218511e6f759  public/marketing/hero-store.jpg`. The image is North Ridge, a store built on Estori, captured at 1280×800.

- [ ] **Step 4: Write the hero and builder demo**

Create `src/routes/landing/Hero.tsx`:

```tsx
import { Link } from 'react-router';
import { ArrowRightIcon, CheckCircleIcon } from '@phosphor-icons/react';
import { BuildBox } from '@/components/build-box';
import { AnimatedList } from '@/components/magicui/animated-list';
import { BorderBeam } from '@/components/magicui/border-beam';
import { Safari } from '@/components/magicui/safari';
import { HEADING_HERO, LEAD } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

const STORE_PHRASES = ['a specialty coffee store', 'a handmade ceramics shop', 'a streetwear store', 'a plant shop with local delivery', 'a vintage camera store'];

const DEMO_PROMPT = 'Build a specialty coffee store with weekly roasts and subscriptions';
const BUILD_STEPS = ['Catalog with 12 roasts', 'Product pages and filters', 'Cart and checkout flow', 'Order records', 'Deployed to a live preview'] as const;

/** A store built on Estori, bundled so the hero never depends on what Discover holds. */
export const HERO_STORE_IMAGE = '/marketing/hero-store.jpg';

export function Hero() {
	return (
		<section className="bg-public-charcoal text-white">
			<div className="mx-auto max-w-[1248px] px-4 pt-20 text-center sm:px-6 sm:pt-28">
				<h1 className={cn(HEADING_HERO, 'mx-auto max-w-5xl text-balance')}>Build online stores with AI. Sell them as templates.</h1>
				<p className={cn(LEAD, 'mx-auto mt-6 max-w-2xl text-pretty text-white/80')}>
					Describe a store and Estori builds and deploys it: catalog, cart, checkout flow and order records. Publish it to Discover and earn when
					others start from it.
				</p>
				{/* The frame resets the band's white text so the box's own controls stay readable. */}
				<div
					id="build"
					className="relative mx-auto mt-10 max-w-2xl scroll-mt-36 rounded-[24px] bg-white/10 p-1.5 text-left text-kumo-default shadow-2xl shadow-black/40 ring ring-white/15"
				>
					<BuildBox placeholder="Build " placeholderPhrases={STORE_PHRASES} />
					<BorderBeam size={140} duration={8} colorFrom="#6ea8ff" colorTo="#ffffff" borderWidth={2} />
				</div>
				<div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/75">
					<span>Free to build. No credit card.</span>
					<Link to="/discover" className="inline-flex items-center gap-1 text-white underline-offset-4 hover:underline">
						Browse stores in Discover <ArrowRightIcon className="size-4" aria-hidden />
					</Link>
				</div>
			</div>
			<BuilderDemo />
		</section>
	);
}

/** 1Password's product frame, Estori-style: a chat whose build steps arrive one by one beside the store they make. */
function BuilderDemo() {
	return (
		<div className="mt-14 px-3 sm:mt-20 sm:px-6">
			<div
				role="img"
				aria-label="Estori building a coffee store from one sentence: the chat on the left, the live store on the right"
				className="mx-auto max-w-[1392px] overflow-hidden rounded-[25px] bg-[linear-gradient(180deg,#1f3f9a_0%,#2f6fe8_55%,#78a6ff_100%)] px-4 pt-8 sm:px-10 sm:pt-12"
			>
				<div className="mx-auto grid max-w-[1152px] overflow-hidden rounded-t-[14px] bg-white text-left text-[#1e2a3b] shadow-[0_-10px_40px_rgba(0,0,0,0.25)] md:grid-cols-[280px_1fr]">
					<div className="grid content-start gap-3 border-b border-public-line p-5 text-sm md:border-r md:border-b-0">
						<p className="rounded-xl bg-[#eef4ff] px-3 py-2.5">{DEMO_PROMPT}</p>
						<AnimatedList delay={900} newestFirst={false} className="items-stretch gap-2">
							{BUILD_STEPS.map((step) => (
								<p key={step} className="flex items-center gap-2">
									<CheckCircleIcon weight="fill" className="size-4 shrink-0 text-[#16a34a]" aria-hidden />
									{step}
								</p>
							))}
						</AnimatedList>
					</div>
					<div className="bg-[#f7f8fa] p-3 sm:p-4">
						<Safari url="Live preview" imageSrc={HERO_STORE_IMAGE} className="w-full" />
					</div>
				</div>
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Write the store logos and the showcase**

Create `src/routes/landing/StoreLogos.tsx`:

```tsx
import { Link } from 'react-router';
import { Marquee } from '@/components/magicui/marquee';
import { EdgeFades } from '@/components/public-site/primitives';
import { shouldShowShowcase, type ShowcaseStore } from '@/lib/showcase';
import { cn } from '@/lib/utils';

/** Four type treatments, rotated by position, so the names read like a wall of logos. */
const WORDMARK_STYLES = [
	'text-[26px] font-semibold tracking-[-0.03em]',
	'text-[17px] font-medium uppercase tracking-[0.28em]',
	'text-[25px] font-extralight tracking-[0.02em]',
	'text-[21px] font-bold uppercase tracking-[0.02em]',
] as const;

/** Stores built on Estori, where 1Password shows customer logos: real Discover stores only. */
export function StoreLogos({ stores }: { stores: readonly ShowcaseStore[] }) {
	if (!shouldShowShowcase(stores.length)) return null;
	return (
		<section aria-labelledby="store-logos-title" className="border-b border-white/10 bg-public-charcoal py-12 text-white">
			<h2 id="store-logos-title" className="text-center text-xs uppercase tracking-[0.04em] text-white/60">
				Stores built on Estori
			</h2>
			<div className="relative mt-8">
				<Marquee pauseOnHover className="p-0 [--duration:60s] [--gap:4rem]">
					{stores.map((store, index) => (
						<Link
							key={store.id}
							to={`/discover/${store.id}`}
							className={cn('whitespace-nowrap text-white/55 transition-colors hover:text-white focus-visible:text-white', WORDMARK_STYLES[index % WORDMARK_STYLES.length])}
						>
							{store.wordmark}
						</Link>
					))}
				</Marquee>
				<EdgeFades />
			</div>
		</section>
	);
}
```

Create `src/routes/landing/StoreShowcase.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { Marquee } from '@/components/magicui/marquee';
import { EdgeFades, Eyebrow, HEADING_SECTION, LEAD, TextLink } from '@/components/public-site/primitives';
import {
	filterShowcase,
	shouldShowShowcase,
	showcaseFilterLabel,
	showcaseFilters,
	showcaseLayout,
	storesWithImages,
	type ShowcaseFilter,
	type ShowcaseStore,
} from '@/lib/showcase';
import { cn } from '@/lib/utils';

/** Discover stores on tall cards: two rows scrolling in opposite directions, with category filters. */
export function StoreShowcase({ stores }: { stores: readonly ShowcaseStore[] }) {
	const [filter, setFilter] = useState<ShowcaseFilter>('all');
	const withImages = storesWithImages(stores);
	if (!shouldShowShowcase(withImages.length)) return null;
	const filters = showcaseFilters(withImages);
	const layout = showcaseLayout(filterShowcase(withImages, filter));

	return (
		<section id="discover" aria-labelledby="showcase-title" className="scroll-mt-36 bg-public-charcoal py-20 text-white sm:py-28">
			<div className="mx-auto flex max-w-[1248px] flex-col gap-8 px-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
				<div className="max-w-2xl">
					<Eyebrow tone="dark">Discover</Eyebrow>
					<h2 id="showcase-title" className={cn(HEADING_SECTION, 'mt-4 text-balance')}>
						See what creators are building
					</h2>
					<p className={cn(LEAD, 'mt-5 text-white/80')}>
						Every store here was built on Estori. Open one, see it live on desktop and phone, and make it yours.
					</p>
				</div>
				{filters.length > 0 && (
					<div role="group" aria-label="Filter stores by category" className="flex flex-wrap gap-2">
						{filters.map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={filter === option}
								onClick={() => setFilter(option)}
								className={cn(
									'rounded-full px-4 py-2 text-sm transition-colors',
									filter === option ? 'bg-white text-public-charcoal' : 'bg-white/10 text-white/85 hover:bg-white/20',
								)}
							>
								{showcaseFilterLabel(option)}
							</button>
						))}
					</div>
				)}
			</div>
			<div className="relative mt-12">
				{layout.kind === 'static' ? (
					<div className="mx-auto flex max-w-[1248px] flex-wrap gap-4 px-4 sm:px-6">
						{layout.row.map((store) => (
							<ShowcaseCard key={store.id} store={store} />
						))}
					</div>
				) : (
					<div className="grid gap-4">
						<Marquee pauseOnHover className="p-0 [--duration:70s] [--gap:1rem]">
							{layout.rows[0].map((store) => (
								<ShowcaseCard key={store.id} store={store} />
							))}
						</Marquee>
						<Marquee pauseOnHover reverse className="p-0 [--duration:80s] [--gap:1rem]">
							{layout.rows[1].map((store) => (
								<ShowcaseCard key={store.id} store={store} />
							))}
						</Marquee>
						<EdgeFades />
					</div>
				)}
			</div>
			<div className="mx-auto mt-10 max-w-[1248px] px-4 sm:px-6">
				<TextLink to="/discover" tone="dark">
					Browse all stores in Discover
				</TextLink>
			</div>
		</section>
	);
}

function ShowcaseCard({ store }: { store: ShowcaseStore }) {
	const [imageFailed, setImageFailed] = useState(false);
	return (
		<Link
			to={`/discover/${store.id}`}
			className="group relative block h-[280px] w-[220px] shrink-0 overflow-hidden rounded-[18px] bg-[#2a2a30] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-[360px] sm:w-[280px]"
		>
			{store.imageUrl && !imageFailed && (
				<img
					src={store.imageUrl}
					alt=""
					loading="lazy"
					onError={() => setImageFailed(true)}
					className={cn(
						'absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none',
						store.tallImage ? 'object-top' : 'object-left-top',
					)}
				/>
			)}
			<span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
			<span
				className={cn(
					'absolute top-3 right-3 rounded-full px-2.5 py-1 text-xs font-semibold',
					store.isFree ? 'bg-[#047857] text-white' : 'bg-white text-public-charcoal',
				)}
			>
				{store.priceLabel}
			</span>
			<span className="absolute inset-x-4 bottom-4 grid justify-items-start gap-1 text-white">
				{store.categoryLabel && <span className="mb-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs backdrop-blur-sm">{store.categoryLabel}</span>}
				<span className="text-lg leading-tight font-medium">{store.title}</span>
				{store.byline && <span className="text-xs text-white/75">{store.byline}</span>}
			</span>
		</Link>
	);
}
```

- [ ] **Step 6: Compose the page and trim the old sections**

Replace `src/routes/landing/LandingPage.tsx` with:

```tsx
import { pageTitle } from '@/brand';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { Hero } from './Hero';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingCta, ForCreators, ForStoreOwners, LandingFaq, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<StoreLogos stores={stores} />
			<StoreShowcase stores={stores} />
			<ForCreators />
			<ForStoreOwners />
			<PricingSummary />
			<LandingFaq />
			<ClosingCta />
		</>
	);
}
```

In `src/routes/landing/sections.tsx`:
- Delete the `STORE_PHRASES` constant, the `Hero` function and the `FeaturedStores` function.
- Delete the imports that become unused: `BuildBox`, and `DiscoverSiteGrid` and `useDiscoverStripSites`.
- Keep `Eyebrow`, `DarkBand` (still used by `ClosingCta`) and the other sections. Task 10 replaces them.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `rtk proxy npx vitest run src/routes src/lib src/components`
Expected: PASS.

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add public/marketing/hero-store.jpg src/routes/landing/Hero.tsx src/routes/landing/StoreLogos.tsx src/routes/landing/StoreShowcase.tsx src/routes/landing/LandingPage.tsx src/routes/landing/sections.tsx src/routes/landing-guard.test.ts
git commit -m "feat(landing): charcoal hero with a builder demo, a store wordmark strip and a Discover showcase

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Landing page, lower half: features, creators, live preview, pricing, FAQ, closing

**Files:**
- Create: `public/marketing/preview-desktop.jpg`, `public/marketing/preview-phone.jpg`
- Create: `src/routes/landing/Features.tsx`, `src/routes/landing/CreatorsPanel.tsx`, `src/routes/landing/LivePreview.tsx`, `src/components/public-site/PublicFaq.tsx`
- Modify: `src/routes/landing/sections.tsx` (whole file), `src/routes/landing/LandingPage.tsx` (whole file), `src/lib/pricing.ts`
- Test: `src/lib/pricing.test.ts`, `src/routes/landing-guard.test.ts` (add tests)

**Interfaces:**
- Consumes:
  - Task 2: `BlurFade`, `AnimatedList`, `NumberTicker`, `TypingAnimation`, `AnimatedBeam`, `Safari`, `Iphone`;
  - Task 8: the primitives;
  - `ComingSoon({ tone })`, `PlanLimits`;
  - `PLATFORM_FEE_LABEL`, `TEMPLATE_PRICE_OPTIONS_CENTS`, `formatTemplatePrice`, `platformFeeCents`.
- Produces:
  - in `src/lib/pricing.ts`: `EXAMPLE_SALE_CENTS = 2900` and `sellerKeepsCents(priceCents: number): number`;
  - `Features()`, `CreatorsPanel()` with `id="creators"`, `LivePreview()`;
  - `PublicFaq()`, which Task 11 reuses on pricing;
  - `PricingSummary()`, `ClosingPanel()`.

- [ ] **Step 1: Write the failing tests**

In `src/lib/pricing.test.ts`:
- Change the import to `import { EXAMPLE_SALE_CENTS, formatCents, sellerKeepsCents, sellerKeepsTable } from './pricing';`.
- Add `import { TEMPLATE_PRICE_OPTIONS_CENTS } from '@/api-types';`.
- Add inside the existing `describe`:

```ts
	it('shows the creators panel an example sale at a real price, with what the seller keeps from the fee code', () => {
		expect(TEMPLATE_PRICE_OPTIONS_CENTS).toContain(EXAMPLE_SALE_CENTS);
		expect(sellerKeepsCents(EXAMPLE_SALE_CENTS)).toBe(2637);
	});
```

In `src/routes/landing-guard.test.ts`, add inside `describe('landing page', ...)`:

```ts
	it('lays the page out in the approved order', () => {
		const page = source('/src/routes/landing/LandingPage.tsx');
		const order = ['<Hero />', '<StoreLogos', '<StoreShowcase', '<Features />', '<CreatorsPanel />', '<LivePreview />', '<PricingSummary />', '<PublicFaq />', '<ClosingPanel />'];
		const positions = order.map((tag) => page.indexOf(tag));
		expect(positions.every((position) => position > -1)).toBe(true);
		expect([...positions].sort((a, b) => a - b)).toEqual(positions);
	});

	it('states what a seller keeps from the fee code, with the creators anchor the top bar links to', () => {
		const creators = source('/src/routes/landing/CreatorsPanel.tsx');
		expect(creators).toContain('sellerKeepsCents(EXAMPLE_SALE_CENTS)');
		expect(creators).toContain('<AnimatedBeam');
		expect(creators).toContain('id="creators"');
		expect(creators).not.toContain('26.37');
	});

	it('uses the 1Password layout: charcoal features, a blue creators panel and a charcoal closing panel', () => {
		expect(source('/src/routes/landing/Features.tsx')).toContain('bg-public-charcoal');
		expect(source('/src/routes/landing/CreatorsPanel.tsx')).toContain('bg-public-blue');
		const sections = source('/src/routes/landing/sections.tsx');
		expect(sections.slice(sections.indexOf('export function ClosingPanel'))).toContain('bg-public-charcoal');
	});

	it('shows the live preview on bundled desktop and phone images', () => {
		const preview = source('/src/routes/landing/LivePreview.tsx');
		expect(preview).toContain("'/marketing/preview-desktop.jpg'");
		expect(preview).toContain("'/marketing/preview-phone.jpg'");
		expect(preview).toContain('<Safari');
		expect(preview).toContain('<Iphone');
	});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run src/lib/pricing.test.ts src/routes/landing-guard.test.ts`
Expected: FAIL. `EXAMPLE_SALE_CENTS` and `sellerKeepsCents` are missing, and so are `Features.tsx`, `CreatorsPanel.tsx`, `LivePreview.tsx` and the new tags.

- [ ] **Step 3: Add the example sale to the pricing helpers**

In `src/lib/pricing.ts`, add after `formatCents`:

```ts
/** The example sale shown on the landing page's creators panel; one of the real price options. */
export const EXAMPLE_SALE_CENTS = 2900;

/** What a seller keeps from a sale after Estori's fee. */
export function sellerKeepsCents(priceCents: number): number {
	return priceCents - platformFeeCents(priceCents);
}
```

Then, in `sellerKeepsTable`, replace `const feeCents = platformFeeCents(priceCents);\n\t\treturn { priceCents, feeCents, sellerCents: priceCents - feeCents };` with:

```ts
		return { priceCents, feeCents: platformFeeCents(priceCents), sellerCents: sellerKeepsCents(priceCents) };
```

- [ ] **Step 4: Add the preview images**

```bash
cp .superpowers/assets/public-site/preview-desktop.jpg .superpowers/assets/public-site/preview-phone.jpg public/marketing/
shasum -a 256 public/marketing/preview-desktop.jpg public/marketing/preview-phone.jpg
```

Expected:
```
7ce0338bf12ecf1a1227b6322acff7984f71ee072fc8a3e28845351a1a70dd1f  public/marketing/preview-desktop.jpg
5cb2cec1755a414c6a6c218a6189a9193d16e044d5c0adbafae4419b41f49ed7  public/marketing/preview-phone.jpg
```

- [ ] **Step 5: Write the features section**

Create `src/routes/landing/Features.tsx`:

```tsx
import type { ReactNode } from 'react';
import { AnimatedList } from '@/components/magicui/animated-list';
import { BlurFade } from '@/components/magicui/blur-fade';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { TypingAnimation } from '@/components/magicui/typing-animation';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { Eyebrow, HEADING_CARD, HEADING_SECTION, LEAD, TextLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

function MiniCard({ children }: { children: ReactNode }) {
	return <div className="w-full rounded-xl bg-white p-3 text-left text-[11px] text-[#1e2a3b] shadow-[0_6px_18px_rgba(0,0,0,0.12)]">{children}</div>;
}

const PRODUCT_SWATCHES = [
	'from-[#f4e3cf] to-[#d9a77c]',
	'from-[#dbe6dc] to-[#7f9f86]',
	'from-[#f4e3cf] to-[#d9a77c]',
	'from-[#dbe6dc] to-[#7f9f86]',
	'from-[#e6e1f4] to-[#9a8fc9]',
	'from-[#f4e3cf] to-[#d9a77c]',
] as const;

function CatalogIllustration() {
	return (
		<MiniCard>
			<p className="mb-2">Catalog · 12 products</p>
			<div className="grid grid-cols-3 gap-1.5">
				{PRODUCT_SWATCHES.map((swatch, index) => (
					<span key={index} className={cn('h-10 rounded-md bg-gradient-to-br', swatch)} />
				))}
			</div>
		</MiniCard>
	);
}

function CartIllustration() {
	return (
		<MiniCard>
			<p>Your cart · 3 items</p>
			<p className="mt-1 text-[22px] font-light">
				$<NumberTicker value={54} decimalPlaces={2} />
			</p>
			<span className="mt-2 block rounded-full bg-public-blue py-1.5 text-center text-white">Checkout</span>
		</MiniCard>
	);
}

const ORDERS = [
	{ id: '#1042', item: 'Ethiopia Guji', total: '$18' },
	{ id: '#1043', item: 'House blend', total: '$36' },
	{ id: '#1044', item: 'Subscription', total: '$32' },
] as const;

function OrdersIllustration() {
	return (
		<MiniCard>
			<p className="mb-1">Orders</p>
			<AnimatedList delay={1200} className="items-stretch gap-0">
				{ORDERS.map((order) => (
					<p key={order.id} className="flex justify-between border-b border-[#f0f0f0] py-1.5">
						<span>
							{order.id} · {order.item}
						</span>
						<span>{order.total}</span>
					</p>
				))}
			</AnimatedList>
		</MiniCard>
	);
}

function ChatIllustration() {
	return (
		<MiniCard>
			<p className="rounded-lg bg-[#eef4ff] px-2.5 py-2">
				<TypingAnimation className="leading-normal tracking-normal" duration={40}>
					Make the hero warmer and add a subscription plan
				</TypingAnimation>
			</p>
			<p className="mt-2 text-[#5b6576]">Updating the live store…</p>
		</MiniCard>
	);
}

const FEATURES: ReadonlyArray<{ title: string; text: string; illustration: ReactNode; link: { to: string; label: string } }> = [
	{
		title: 'Catalog and product pages',
		text: 'Products, variants, filters and detailed product pages, generated from your description.',
		illustration: <CatalogIllustration />,
		link: { to: '/discover', label: 'See stores in Discover' },
	},
	{
		title: 'Cart and checkout flow',
		text: 'A cart, a checkout form and order confirmations your customers already know how to use.',
		illustration: <CartIllustration />,
		link: { to: '/#build', label: 'Start building' },
	},
	{
		title: 'Order records',
		text: 'Your store can keep its orders in its own database, ready for you to review.',
		illustration: <OrdersIllustration />,
		link: { to: '/#build', label: 'Start building' },
	},
	{
		title: 'Edit by chatting',
		text: 'Ask for a new section, a different style or more products, and the AI updates the live store.',
		illustration: <ChatIllustration />,
		link: { to: '/#build', label: 'Try it' },
	},
];

/** What every store gets, on 1Password's white cards with small live illustrations. */
export function Features() {
	return (
		<section className="bg-public-charcoal px-4 pt-20 pb-24 text-white sm:px-6 sm:pt-28">
			<div className="mx-auto max-w-[1248px]">
				<Eyebrow tone="dark">Estori store builder</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mt-4 max-w-3xl text-balance')}>Everything your store needs, from one description</h2>
				<p className={cn(LEAD, 'mt-5 max-w-2xl text-white/80')}>Start from scratch or from a store in Discover, then change anything by chatting.</p>
				<TextLink to="/#build" tone="dark" className="mt-6">
					Start building
				</TextLink>
				<BlurFade inView className="mt-14 grid gap-x-4 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
					{FEATURES.map((feature) => (
						<article key={feature.title}>
							<div aria-hidden className="flex h-[220px] items-center justify-center rounded-[24px] bg-white p-5">
								{feature.illustration}
							</div>
							<h3 className={cn(HEADING_CARD, 'mt-6')}>{feature.title}</h3>
							<p className="mt-3 text-base leading-relaxed font-light text-white/80">{feature.text}</p>
							<TextLink to={feature.link.to} tone="dark" className="mt-4">
								{feature.link.label}
							</TextLink>
						</article>
					))}
				</BlurFade>
				<p className="mt-14 flex flex-wrap items-center gap-3 text-sm text-white/75">
					Accept payments in your store <ComingSoon tone="dark" />
				</p>
			</div>
		</section>
	);
}
```

- [ ] **Step 6: Write the creators panel and the live preview**

Create `src/routes/landing/CreatorsPanel.tsx`:

```tsx
import { useRef, type ReactNode, type Ref } from 'react';
import { formatTemplatePrice } from '@/api-types';
import { AnimatedBeam } from '@/components/magicui/animated-beam';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, pillClass } from '@/components/public-site/primitives';
import { EXAMPLE_SALE_CENTS, sellerKeepsCents } from '@/lib/pricing';
import { cn } from '@/lib/utils';

function FlowNode({ ref, label, value }: { ref: Ref<HTMLDivElement>; label: string; value: ReactNode }) {
	return (
		<div ref={ref} className="relative z-10 rounded-[14px] bg-white/12 px-4 py-3 text-left ring ring-white/35 backdrop-blur-sm">
			<p className="text-[13px] text-white/85">{label}</p>
			<p className="mt-0.5 text-xl font-light">{value}</p>
		</div>
	);
}

/** The creator story on 1Password's blue panel: a sale flowing from Discover to the seller. */
export function CreatorsPanel() {
	const containerRef = useRef<HTMLDivElement>(null);
	const storeRef = useRef<HTMLDivElement>(null);
	const discoverRef = useRef<HTMLDivElement>(null);
	const buyerRef = useRef<HTMLDivElement>(null);
	const keepRef = useRef<HTMLDivElement>(null);
	const price = formatTemplatePrice(EXAMPLE_SALE_CENTS);
	const keeps = sellerKeepsCents(EXAMPLE_SALE_CENTS) / 100;
	const beam = { containerRef, gradientStartColor: '#ffffff', gradientStopColor: '#bcd4ff', pathColor: '#ffffff', className: 'hidden sm:block' };

	return (
		<section className="bg-white px-3 pt-6 sm:px-6">
			<div id="creators" className="mx-auto max-w-[1392px] scroll-mt-36 rounded-[25px] bg-public-blue px-6 py-16 text-center text-white sm:px-14 sm:py-20">
				<Eyebrow tone="dark">For creators</Eyebrow>
				<h2 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Design a store once. Earn every time it's used.</h2>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-2xl text-white/90')}>
					Publish to Discover, set a price, and get paid through Stripe when someone starts from your store.
				</p>
				<div ref={containerRef} className="relative mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
					<FlowNode ref={storeRef} label="Your store" value="Published" />
					<FlowNode ref={discoverRef} label="Discover" value={price} />
					<FlowNode ref={buyerRef} label="A buyer" value={`Pays ${price}`} />
					<FlowNode ref={keepRef} label="You keep" value={<>$<NumberTicker value={keeps} decimalPlaces={2} /></>} />
					<AnimatedBeam {...beam} fromRef={storeRef} toRef={discoverRef} />
					<AnimatedBeam {...beam} fromRef={discoverRef} toRef={buyerRef} delay={0.6} />
					<AnimatedBeam {...beam} fromRef={buyerRef} toRef={keepRef} delay={1.2} />
				</div>
				<div className="mt-10 flex flex-wrap justify-center gap-3">
					<a href="#build" className={pillClass('charcoal')}>
						Start selling
					</a>
					<PillLink to="/pricing" variant="outline-on-dark">
						How selling works
					</PillLink>
				</div>
				<p className="mt-6 text-sm text-white/85">Sellers must be 18 or older and connect a Stripe account.</p>
			</div>
		</section>
	);
}
```

Create `src/routes/landing/LivePreview.tsx`:

```tsx
import { Iphone } from '@/components/magicui/iphone';
import { Safari } from '@/components/magicui/safari';
import { BlurFade } from '@/components/magicui/blur-fade';
import { Eyebrow, LEAD, PillLink } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

/** A store built on Estori on desktop and phone, bundled so the section never depends on Discover. */
const PREVIEW_DESKTOP_IMAGE = '/marketing/preview-desktop.jpg';
const PREVIEW_PHONE_IMAGE = '/marketing/preview-phone.jpg';

/** 1Password's customer-story layout, used for the live preview since Estori shows no testimonials. */
export function LivePreview() {
	return (
		<section className="bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] items-center gap-12 lg:grid-cols-2 lg:gap-20">
				<div aria-hidden className="relative overflow-hidden rounded-[25px] bg-[linear-gradient(160deg,#f4efe6,#e7ddcc)] px-6 pt-10 pb-16 sm:px-10">
					<Safari url="Live preview" imageSrc={PREVIEW_DESKTOP_IMAGE} className="w-[88%]" />
					<Iphone src={PREVIEW_PHONE_IMAGE} className="absolute right-6 -bottom-8 w-[26%]" />
				</div>
				<div>
					<Eyebrow>Live preview</Eyebrow>
					<h2 className="mt-4 text-3xl leading-[1.22] font-light tracking-[-0.015em] text-public-ink sm:text-[40px]">
						See every change on desktop and phone before you share it.
					</h2>
					<p className={cn(LEAD, 'mt-5 text-public-muted')}>Every store in Discover was built and published on Estori.</p>
					<PillLink to="/discover" variant="outline-on-light" className="mt-8">
						Browse Discover
					</PillLink>
				</div>
			</BlurFade>
		</section>
	);
}
```

- [ ] **Step 7: Move the FAQ, restyle pricing and closing, and recompose the page**

Create `src/components/public-site/PublicFaq.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { Eyebrow } from './primitives';

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
				<Link to="/refunds" className="underline underline-offset-4">
					refund policy
				</Link>
				.
			</>
		),
	},
];

/** The launch questions, shared by the landing and pricing pages. */
export function PublicFaq() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<div className="mx-auto grid max-w-[1248px] gap-10 lg:grid-cols-[1fr_2fr]">
				<div>
					<Eyebrow>FAQ</Eyebrow>
					<h2 className="mt-4 text-4xl leading-[1.1] font-light tracking-[-0.02em] text-public-ink sm:text-5xl">Questions, answered</h2>
				</div>
				<div className="divide-y divide-public-line border-y border-public-line">
					{FAQ.map((item) => (
						<details key={item.question} className="group py-5">
							<summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-normal text-public-ink [&::-webkit-details-marker]:hidden">
								{item.question}
								<span className="text-2xl font-light text-public-muted transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden>
									+
								</span>
							</summary>
							<p className="mt-3 max-w-2xl text-base leading-relaxed font-light text-public-muted">{item.answer}</p>
						</details>
					))}
				</div>
			</div>
		</section>
	);
}
```

Replace `src/routes/landing/sections.tsx` with:

```tsx
import { PLATFORM_FEE_LABEL } from '@/api-types';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { BlurFade } from '@/components/magicui/blur-fade';
import { Eyebrow, HEADING_SECTION, LEAD, PillLink, TextLink, pillClass } from '@/components/public-site/primitives';
import { cn } from '@/lib/utils';

export function PricingSummary() {
	return (
		<section className="border-t border-public-line bg-white px-4 py-20 sm:px-6 sm:py-28">
			<BlurFade inView className="mx-auto grid max-w-[1248px] gap-10 lg:grid-cols-2 lg:items-center">
				<div>
					<Eyebrow>Pricing</Eyebrow>
					<h2 className={cn(HEADING_SECTION, 'mt-4 text-balance text-public-ink')}>Free to build. Pay only when you sell.</h2>
					<TextLink to="/pricing" className="mt-6">
						See pricing
					</TextLink>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<article className="rounded-[24px] p-7 ring ring-public-line">
						<p className="text-xs uppercase tracking-[0.02em] text-public-ink/80">Build</p>
						<p className="mt-3 text-4xl font-light tracking-[-0.02em] text-public-ink">Free</p>
						<PlanLimits className="mt-3 text-sm text-public-muted" />
					</article>
					<article className="rounded-[24px] bg-public-charcoal p-7 text-white">
						<p className="text-xs uppercase tracking-[0.02em] text-white/80">Sell</p>
						<p className="mt-3 text-4xl font-light tracking-[-0.02em]">{PLATFORM_FEE_LABEL}</p>
						<p className="mt-3 text-sm text-white/70">per sale, paid through Stripe</p>
					</article>
				</div>
			</BlurFade>
		</section>
	);
}

export function ClosingPanel() {
	return (
		<section className="bg-white px-3 pb-6 sm:px-6">
			<div className="mx-auto max-w-[1392px] rounded-[25px] bg-public-charcoal px-6 py-20 text-center text-white sm:py-24">
				<h2 className={cn(HEADING_SECTION, 'mx-auto max-w-3xl text-balance')}>Your next store starts with a sentence.</h2>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>Describe it, watch it build, and publish it when it's ready.</p>
				<div className="mt-10 flex flex-wrap justify-center gap-3">
					<a href="#build" className={pillClass('white')}>
						Start building
					</a>
					<PillLink to="/pricing" variant="outline-on-dark">
						View pricing
					</PillLink>
				</div>
			</div>
		</section>
	);
}
```

Replace `src/routes/landing/LandingPage.tsx` with:

```tsx
import { pageTitle } from '@/brand';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { useShowcaseStores } from '@/hooks/use-showcase-stores';
import { CreatorsPanel } from './CreatorsPanel';
import { Features } from './Features';
import { Hero } from './Hero';
import { LivePreview } from './LivePreview';
import { StoreLogos } from './StoreLogos';
import { StoreShowcase } from './StoreShowcase';
import { ClosingPanel, PricingSummary } from './sections';

export function LandingPage() {
	const stores = useShowcaseStores().data ?? [];
	return (
		<>
			<title>{pageTitle()}</title>
			<meta name="description" content="Build online stores with AI and sell them as templates in Discover. Free to build." />
			<Hero />
			<StoreLogos stores={stores} />
			<StoreShowcase stores={stores} />
			<Features />
			<CreatorsPanel />
			<LivePreview />
			<PricingSummary />
			<PublicFaq />
			<ClosingPanel />
		</>
	);
}
```

- [ ] **Step 8: Run the tests and the typecheck**

Run: `rtk proxy npx vitest run src/routes src/lib src/components`
Expected: PASS.

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | rtk proxy grep -v artifacts-viewer`
Expected: no output.

- [ ] **Step 9: Commit**

```bash
git add public/marketing/preview-desktop.jpg public/marketing/preview-phone.jpg src/routes/landing src/components/public-site/PublicFaq.tsx src/lib/pricing.ts src/lib/pricing.test.ts src/routes/landing-guard.test.ts
git commit -m "feat(landing): feature cards, creators panel, live preview, pricing, FAQ and closing in the 1Password style

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Pricing and legal pages

**Files:**
- Modify: `src/routes/pricing.tsx` (whole file), `src/routes/legal/LegalPage.tsx` (whole file)
- Test: `src/routes/pricing-guard.test.ts` (add tests), `src/routes/public-pages-guard.test.ts` (replace one test)

**Interfaces:**
- Consumes: `PublicFaq` (Task 10), the primitives (Task 8), `ComingSoon`, `PlanLimits`, `usePublicPlan`, `sellerKeepsTable`, `formatCents`, `LEGAL_DOCUMENTS[slug]` as `{ title, version, updated, body }`.

- [ ] **Step 1: Update the guards (failing)**

In `src/routes/pricing-guard.test.ts`, add inside `describe('pricing page', ...)`:

```ts
	it('uses the 1Password layout: charcoal hero, white plan cards, the shared FAQ', () => {
		expect(page).toContain('bg-public-charcoal');
		expect(page).toContain('<PublicFaq />');
		expect(page).not.toContain('kumo-');
	});

	it('keeps the seller table readable by screen readers', () => {
		expect(page).toContain('<caption className="sr-only">What a seller keeps at each price</caption>');
		expect(page.match(/scope="col"/g)).toHaveLength(3);
	});
```

In `src/routes/public-pages-guard.test.ts`, replace the whole test `it('keeps the top bar usable on phones and legal text readable in dark mode', ...)` with:

```ts
	it('keeps the top bar usable on phones and the legal pages in the fixed light style', () => {
		expect(source('/src/components/layout/PublicTopBar.tsx')).toContain('hidden sm:flex');
		const legal = source('/src/routes/legal/LegalPage.tsx');
		expect(legal).not.toContain('dark:');
		expect(legal).not.toContain('kumo-');
		expect(legal).toContain('pageTitle(document.title)');
		expect(legal).toContain('document.version');
		expect(legal).toContain('max-w-[720px]');
	});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `rtk proxy npx vitest run src/routes/pricing-guard.test.ts src/routes/public-pages-guard.test.ts`
Expected: FAIL. The page has no `bg-public-charcoal`, no `<PublicFaq />` and no caption, and the legal page still uses `dark:prose-invert` and kumo tokens.

- [ ] **Step 3: Rewrite the pricing page**

Replace `src/routes/pricing.tsx` with:

```tsx
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CheckIcon } from '@phosphor-icons/react';
import { pageTitle } from '@/brand';
import { PLATFORM_FEE_LABEL, formatTemplatePrice } from '@/api-types';
import { ComingSoon } from '@/components/marketing/ComingSoon';
import { PlanLimits } from '@/components/marketing/PlanLimits';
import { PublicFaq } from '@/components/public-site/PublicFaq';
import { Eyebrow, HEADING_SECTION, LEAD } from '@/components/public-site/primitives';
import { usePublicPlan } from '@/hooks/use-public-plan';
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

export default function PricingPage() {
	return (
		<div>
			<title>{pageTitle('Pricing')}</title>
			<meta name="description" content={`Estori is free to build with. Sellers pay ${PLATFORM_FEE_LABEL} per sale.`} />
			<section className="bg-public-charcoal px-4 pt-20 pb-24 text-center text-white sm:px-6 sm:pt-28 sm:pb-28">
				<Eyebrow tone="dark">Pricing</Eyebrow>
				<h1 className={cn(HEADING_SECTION, 'mx-auto mt-4 max-w-3xl text-balance')}>Free to build. Pay only when you sell.</h1>
				<p className={cn(LEAD, 'mx-auto mt-5 max-w-xl text-white/80')}>
					Build and publish stores at no cost. Estori earns only when one of your store designs sells.
				</p>
			</section>
			<section className="bg-white px-4 py-16 sm:px-6 sm:py-20">
				<div className="mx-auto grid max-w-[1248px] gap-6 lg:grid-cols-3">
					<article className={cn(CARD, 'ring ring-public-line')}>
						<h2 className={cn(CARD_LABEL, 'text-public-ink/80')}>Build</h2>
						<p className="mt-4 text-5xl font-light tracking-[-0.02em] text-public-ink">Free</p>
						<PlanLimits className="mt-3 text-sm text-public-muted" />
						<CreditRateNote />
						<ul className="mt-8 grid gap-3">
							<Feature>Change your store by chatting with the AI</Feature>
							<Feature>Live preview on desktop and phone</Feature>
							<Feature>Publish to Discover, or start from any free store there</Feature>
							<Feature>
								<span className="inline-flex flex-wrap items-center gap-2">
									Accept payments in your store <ComingSoon />
								</span>
							</Feature>
						</ul>
					</article>
					<article className={cn(CARD, 'bg-public-charcoal text-white')}>
						<h2 className={cn(CARD_LABEL, 'text-white/80')}>Sell</h2>
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
						<h2 className={cn(CARD_LABEL, 'text-public-ink/80')}>Buy a store design</h2>
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
				<p className="mx-auto mt-10 max-w-[1248px] text-center text-xs text-public-muted">Prices are in US dollars.</p>
			</section>
			<PublicFaq />
		</div>
	);
}
```

- [ ] **Step 4: Rewrite the legal page**

Replace `src/routes/legal/LegalPage.tsx` with:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeExternalLinks from 'rehype-external-links';
import { pageTitle } from '@/brand';
import { Eyebrow } from '@/components/public-site/primitives';
import { LEGAL_DOCUMENTS, type LegalSlug } from '@/content/legal/legal-documents';

/** A legal text in a narrow reading column, like 1Password's Legal Center. */
export function LegalPage({ slug }: { slug: LegalSlug }) {
	const document = LEGAL_DOCUMENTS[slug];
	return (
		<article className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-24">
			<title>{pageTitle(document.title)}</title>
			<meta name="description" content={`${document.title} for Estori.`} />
			<Eyebrow>Legal</Eyebrow>
			<h1 className="mt-4 text-4xl leading-[1.1] font-light tracking-[-0.02em] text-public-ink sm:text-5xl">{document.title}</h1>
			<p className="mt-4 text-sm text-public-muted">
				Version {document.version} · Last updated {document.updated}
			</p>
			<div className="prose prose-neutral mt-10 max-w-none text-[17px] leading-[1.7] font-light text-public-ink prose-headings:font-normal prose-headings:tracking-[-0.01em] prose-headings:text-public-ink prose-a:text-public-blue prose-a:underline-offset-4 prose-strong:font-medium">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }]]}>
					{document.body}
				</ReactMarkdown>
			</div>
		</article>
	);
}
```

- [ ] **Step 5: Run the tests**

Run: `rtk proxy npx vitest run src/routes src/components src/lib src/styles src/brand`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/pricing.tsx src/routes/legal/LegalPage.tsx src/routes/pricing-guard.test.ts src/routes/public-pages-guard.test.ts
git commit -m "feat(public): pricing and legal pages in the 1Password style, with the shared FAQ on pricing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Verification

**Files:** none in git. Screenshots and notes go to `.superpowers/reports/public-site-redesign/`, which is git-ignored.

- [ ] **Step 1: Apply migration 0013 to the local database**

Run: `npm run db:migrate:local`
Expected: `0013_<name>.sql` is applied.

If it fails with a workerd state error, as 0012 did, apply it by hand:

```bash
DB=$(ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite | head -1)
mkdir -p .superpowers/reports/public-site-redesign
cp "$DB" .superpowers/reports/public-site-redesign/local-d1-backup-before-0013.sqlite
sqlite3 "$DB" < migrations/0013_*.sql
sqlite3 "$DB" "pragma table_info(apps);" | rtk proxy grep showcase_screenshot_url
```

Expected: the last command prints a row for `showcase_screenshot_url`.

- [ ] **Step 2: Run every suite, one directory at a time**

```bash
for s in src shared worker/database worker/services worker/api worker/utils worker/agents; do
  while [ "$(netstat -an -p tcp 2>/dev/null | grep -c TIME_WAIT)" -gt 1500 ]; do sleep 5; done
  f=".superpowers/reports/public-site-redesign/vitest-$(echo $s | tr / -).log"
  rtk proxy npx vitest run "$s" > "$f" 2>&1
  echo "$s exit=$? $(grep -E '^ +Tests ' "$f" | head -1)"
done
```

Expected: every suite exits 0.
- **A `worker/agents` failure:** check whether it also fails on the base commit, using a temporary `git worktree add --detach` checkout of `b277e19` with `node_modules` symlinked, and report it with that evidence.
- **Any other failure** must be fixed before continuing.

- [ ] **Step 3: Typecheck and lint**

Run: `rtk proxy npx tsc -b --incremental --noEmit 2>&1 | rtk proxy grep -E "error TS" | sort | uniq -c`
Expected: only the 4 known `packages/artifacts-viewer/.../code-view.tsx` errors.

Run: `rtk proxy npx eslint src/components/magicui src/components/public-site src/components/layout src/routes/landing src/routes/pricing.tsx src/routes/legal src/routes/admin src/lib src/hooks worker/services/showcase`
Expected: no errors. Existing warnings of the same kind, such as react-refresh's only-export-components, are fine.

- [ ] **Step 4: Check the pages live**

The dev server at http://localhost:8100 hot-reloads frontend changes.
- **If the API returns no `showcaseScreenshotUrl` field,** the worker didn't reload. Restart the dev server with the command in memory note "Estori deploys and live testing": `CLOUDFLARE_API_TOKEN` from `TOKEN_ESTORI_DEPLOY` in `.dev.vars`, `CLOUDFLARE_ACCOUNT_ID=6d16ad8a9f081e4939993391bd35ca4e`, `npm run dev -- --port 8100 --strictPort`. Never print the token.
- **For captures,** the dev browser sidecar (`npm run dev:browser`) must be running.

Using Playwright, save screenshots to `.superpowers/reports/public-site-redesign/`. Check each item below.

**Pages, layouts and themes:**
- **The pages:** `/` signed out, `/pricing`, `/terms`, `/privacy`, `/refunds` and `/copyright`, each at 1440×900 and 390×844.
- **Layout:** no horizontal page scroll, and the text is DM Sans (`document.fonts` shows DM Sans loaded).
- **Light and dark:** the public pages look the same with `localStorage.theme = 'dark'` set through `addInitScript` before load. Only the build box and the sign-in window follow the theme.

**Motion and links:**
- **Reduced motion:** with `page.emulateMedia({ reducedMotion: 'reduce' })`:
  - the marquee rows don't move and can be scrolled sideways;
  - the build steps all show;
  - the typed texts show in full;
  - there is no border beam.
- **Anchors:** the top bar's "For creators" and the gold bar's "Learn more" scroll to the blue panel. "Start building free" scrolls to the build box. The phone menu opens and closes.

**Showcase:**
- **Store counts:** using `page.route('**/api/apps/public?*', ...)` to answer with 0, 2, 3 and 8 stores (copies of the local response with ids `<id>-<n>`):
  - the strip and showcase are hidden at 0 and 2;
  - at 3, one still row;
  - at 8, two rows moving in opposite directions, pausing on hover;
  - filters appear only when 2 or more categories are present, and filtering works.
- **Broken image:** a card whose image request fails (route the image to a 404) shows its dark background with no broken-image icon.

**Admin refresh, then regressions:**
- **Admin refresh:**
  - sign in through `http://localhost:8199/as/owner?next=/admin/reviews` and click "Refresh showcase images";
  - the message reads "Captured N of N…";
  - `sqlite3 "$DB" "select id, showcase_screenshot_url from apps where visibility='public';"` shows `.../showcase.jpg` URLs;
  - the landing cards now use the tall images.
- **Regressions:**
  - signed out, typing a prompt in the landing build box and sending opens the sign-up window;
  - signed in, `/` shows the builder home, not the landing page;
  - `/discover` still works.

- [ ] **Step 5: Record the results**

Write `.superpowers/reports/public-site-redesign/verification.md`. It lists each check above with pass or fail, the suite counts, the typecheck result and the screenshot file names. No commit is needed.

---

## Rulings made while writing this plan

Each deviation from, or detail added to, the spec is listed with its cost if wrong.

1. **Token names.** The palette tokens are Tailwind theme colors named `--color-public-*` (spec: `--public-*`), so classes like `bg-public-charcoal` work directly. Added: `--color-public-brand: #11295a` for the wordmark and `--color-public-blue-hover`. Cost: none.
2. **Licence file name.** Magic UI's licence ships as `src/components/magicui/LICENSE.md` (spec: `LICENSE`), the name Magic UI itself uses. Cost: none.
3. **Admin refresh.** It captures only stores still missing an image, 10 per click and 3 at a time, and reports how many remain. The spec said every public store, one at a time, up to 50 per click. Up to 50 sequential captures (several minutes) can outlast a normal web request, and deploys already refresh public stores. Cost: refreshing an existing image by hand means redeploying the store.
4. **Build box theme.** The build box keeps the app's theme, like the sign-in window, because it is the app's own composer. Cost: in dark mode, the hero's build box is dark.
5. **FAQ location.** The FAQ moves to a shared `PublicFaq` component, because the spec puts "the existing questions" on the pricing page too. Cost: none.
6. **Free badge color.** The green Free badge is `#047857`, which gives white text enough contrast. Cost: a slightly deeper green than on localhost:8001.
7. **Category filters.** Filters show only when the stores span 2 or more categories. Cost: none.
8. **Wordmark style.** The third wordmark treatment is extra-light rather than italic, since only the upright font is shipped. Cost: none.
9. **Marquee copies.** Besides `aria-hidden`, the duplicate copies are also `inert`, so keyboard users don't tab through the same links four times. Cost: none.
10. **Code layout.**
    - The showcase capture code is split into a pure core, the wiring, and an agent-backed refresh. The Think agent then imports no module that imports the agents package.
    - The landing sections are split into PascalCase files, and the landing guard now reads every file in `src/routes/landing/` and `src/components/public-site/`.

    Cost: none.
11. **Legal page.** It shows the document version under the title. Cost: none.
