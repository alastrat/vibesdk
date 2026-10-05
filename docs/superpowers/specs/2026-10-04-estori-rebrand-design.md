# Estori Rebrand of VibeSDK — Design

Date: 2026-10-04
Status: Draft for review

## Goal

Relaunch this VibeSDK fork as **Estori**. Users must see Estori's name, logo, palette, and visual style everywhere. Cloudflare and VibeSDK product branding must be gone, while the product's behavior stays unchanged. The fork must keep pulling updates from `cloudflare/vibesdk` with small, predictable merges.

## Decisions

| Topic | Decision |
|---|---|
| Scope | Rebrand only. The production launch (domain wiring, `estori-*` resources, Workers for Platforms, deploy pipeline) is a separate spec. |
| Upstream | Keep merging `cloudflare/vibesdk`. Branding lives in a thin layer, and upstream files get minimal edits. |
| Approach | Brand layer: a shared brand module, a Kumo `data-theme="estori"` theme, and token overrides. No global find-and-replace. Kumo's stylesheet stays. |
| Palette source | estori/core editor (`~/Documents/Work/Opensource/estori/apps/editor`), excluding `#0B1021`. |
| Visual reference | estori/core's live UI: navy top bar, white canvas, hairline borders, bright-blue actions, system sans font. |
| Layout | Full-width navy top bar above the existing left sidebar (option A). The sidebar keeps the app list. |
| Theme modes | Light and dark both kept, following the system setting by default. Light mode is the reference look. |
| Domain | `getestori.com` (already on Cloudflare DNS; the apex currently serves the marketing site). |
| Internal identifiers | Unchanged in code: cookie names, Durable Object classes, KV binding names, `vibesdk-vault-vmk`, package names. Renaming them breaks data or upstream merges. |

## Non-goals

- New product features, navigation changes beyond the top bar, or removing the sidebar.
- Renaming the README, the `@cf-vibesdk/sdk` package, or the LICENSE. The MIT license and its "Copyright (c) 2025 Cloudflare" notice stay.
- Editing the base agent prompt files in `worker/agents/think/prompts/*.txt`, or the legacy prompts for disabled project types.
- Production infrastructure. That belongs to the launch spec.

## 1. Brand module

### `shared/brand.ts` (frontend and worker)

This file holds plain constants with no imports:

- `name: 'Estori'`
- `assistantName: 'Estori'`. This replaces the hardcoded "Orange" in `src/routes/chat/components/messages.tsx:864`.
- `description: 'Describe the app you want and Estori builds and deploys it.'`
- `domain: 'getestori.com'`
- `gitAuthor: { name: 'Estori', email: 'bot@getestori.com' }`. This replaces the default in `worker/agents/git/git.ts:45`.

### `src/brand/` (frontend only)

- `EstoriLogo`: the full wordmark from estori/core's `logo-estori.svg` (viewBox `0 0 140 38`). The letter paths use `fill="currentColor"` and the dot path keeps `#2C71F0`. One component then serves light mode (navy letters) and dark mode or the navy bar (white letters).
- `EstoriGlyph`: an "e." monogram built from the logo's own "e" path plus the blue dot path, in a square viewBox. It is used wherever only an icon fits.
- `public/favicon.svg` is generated from `EstoriGlyph`, and `public/favicon.ico` is regenerated from it.

### Logo placement

**Replace with Estori branding:**

- `src/components/header.tsx:19`. Swap `CloudflareLogo` for `EstoriLogo` and change the aria-label "Cloudflare v1" to `BRAND.name`.
- `src/components/layout/app-sidebar.tsx:265,280`. Remove the glyph and the "Build" wordmark from the sidebar header, since the logo moves to the top bar. The sidebar header keeps only the collapse trigger.
- `src/components/credits-banner.tsx:94`. The platform credits amount shows `EstoriGlyph`.
- `src/routes/chat/chat.tsx:428`. The deploy button shows a neutral deploy icon when the target is the platform, and keeps the Cloudflare logo when the target is the user's own account.
- `index.html` and `src/routes/home.tsx:188`. The page `<title>` becomes `BRAND.name`, and the meta description becomes `BRAND.description`.

**Keep the Cloudflare logo.** These spots describe a real Cloudflare integration, so the logo is referential use:

- `credits-banner.tsx:233` (Connect)
- `src/utils/usage-limit-checker.tsx` (Connect Cloudflare, Configure Gateway)
- `app-sidebar.tsx:602` (sidebar Cloudflare CTA)
- `cloudflare-account-selector.tsx`
- `connected-accounts.tsx`
- `login-modal.tsx` (Cloudflare sign-in)
- `byok-api-keys-modal.tsx` (provider logo)
- `usage-limits-card.tsx` (Connect Cloudflare)
- `shared/CloudflareLogoThemed.tsx`

## 2. Palette and tokens

### Colors

| Role | Light | Dark | Notes |
|---|---|---|---|
| Top bar | `#11295A` | `#11295A` | White text; active item underlined white |
| Canvas / page | `#FFFFFF` | `#121417` | estori/core uses white |
| Recessed surface | `#F7F8FA` | `#0E1013` | Table headers, chips |
| Elevated surface | `#FFFFFF` | `#1A1D22` / `#22262C` | Cards, popovers |
| Hairline | `#E3E8F0` | `#2C313A` | 1px borders |
| Text strong | `#11295A` | `#FFFFFF` | Headings, wordmark |
| Text default | `#1E2A3B` | `#E6E9EF` | Body |
| Text subtle | `#5B6576` | `#9AA3B2` | Secondary, placeholders |
| Action fill (buttons) | `#0062E6` | `#0062E6` | White text 5.40:1 |
| Action hover | `#0058CC` | `#0058CC` | White text 6.43:1 (`#2C71F0` fails at 4.44:1) |
| Link / accent text | `#0062E6` | `#4D94FF` | 5.40:1 on white; 6.15:1 on `#121417` |
| Highlight (large text, focus ring) | `#006EFF` | `#4D94FF` | `#006EFF` is 4.49:1 on white, so large text and UI only |
| Logo dot | `#2C71F0` | `#2C71F0` | Logo only |
| Success / warning / danger | Kumo defaults | Kumo defaults | Unchanged |

`#0B1021` is not used anywhere.

### Mechanism

`src/styles/estori-theme.css` is imported in `src/index.css` after `@cloudflare/kumo/styles/tailwind`. Its rules are deliberately left outside any CSS layer. Kumo's tokens, Tailwind's `@theme` variables, and `index.css`'s own `:root` and `[data-mode='dark']` blocks all live in layers, and unlayered rules beat layered ones regardless of source order. The palette is declared once as `--estori-*` raw variables per mode, and every override reads from those. It contains three things:

1. **Kumo theme.** Rules for `:root[data-theme='estori']` (light) and `:root[data-theme='estori'][data-mode='dark']`. They override `--color-kumo-brand`, `--color-kumo-brand-hover`, `--text-color-kumo-brand`, `--color-kumo-canvas`, `--color-kumo-base`, `--color-kumo-elevated`, `--color-kumo-recessed`, `--color-kumo-line`, `--color-kumo-hairline`, and the `--text-color-kumo-{default,strong,subtle}` tokens, using the values above. This follows Kumo's own `theme-fedramp.css` pattern. `index.html` sets `data-theme="estori"` on `<html>`.
2. **App tokens.** These are overridden under the same selectors:
   - `--color-brand`: from `#ff3d00` to the action blue `#0062E6`. `OrangeButton` fills with this token, so using the AA-safe action color keeps white button text above 4.5:1. The headline emphasis uses the same token.
   - `--build-chat-colors-brand-primary`: to `#0062E6`
   - `--build-chat-colors-brand-light`: to `#4D94FF`
   - `--build-chat-colors-bg-1..4` and `--build-chat-colors-text-primary`: to the surface and text values above
   - `--font-sans`: to estori/core's system stack
   - `--font-funky-mono`: to `var(--font-sans)`
   - `--font-mono`: unchanged
3. **Hardcoded oranges.** These are overridden or neutralized:
   - The home spotlight (`.home-atmosphere`, `src/index.css:226-265`) is hidden under `[data-theme="estori"]` to give a flat white canvas.
   - The orange glow shadow at `src/index.css:140-141` is recolored to the blue highlight at the same alpha values.
   - The terminal brand class (`src/routes/chat/components/terminal.tsx:99`) already resolves through the Kumo brand token. Only its "Cloudflare orange" comment changes.
   - `StatusLoader color="orange"` (`phase-timeline.tsx:367,877`) changes to `color="brand"`.

Components named for orange stay as named, for example `OrangeButton` and the `text-brand-emphasis` utility. Their colors come from `--color-brand` and so turn blue with no edit.

## 3. Layout: navy top bar

- **`src/components/layout/app-layout.tsx`.** Wrap the current tree in a vertical flex container. A new `EstoriTopBar` component renders first at full width, height `3rem`, and `SidebarProvider` follows it. `GlobalHeader` stays inside `<main>` for page-specific controls and the platform-message pill. Its Sign In button moves to the top bar so it appears only once.
- **`src/components/layout/EstoriTopBar.tsx`** (new). It contains:
  - `EstoriLogo` in white on the left, linking to `/`.
  - On the right, the account avatar menu (`AuthButton`), moved from the sidebar footer (`app-sidebar.tsx:624`). When signed out, it shows Sign In.
  - The theme toggle stays in the sidebar footer. Credits stay where they are today, in the prompt box (`CreditsBanner`).
  - Background `#11295A` in both modes, with a 1px bottom border `#0E2250`.
- **Sidebar below the bar.** Kumo's `SidebarProvider` has a `contained` option. With it, the mobile drawer is positioned `absolute` within the wrapper instead of `fixed` to the viewport, and the wrapper stops forcing `min-h-svh`. The desktop sidebar is already `relative h-full`. `app-layout.tsx` passes `contained` and gives the wrapper `flex-1 min-h-0` inside a `h-svh` column, and `<main>` changes from `h-screen` to `h-full`. No CSS reaches into Kumo's DOM.
- **Sidebar style.** White background (`--sidebar-bg: var(--color-kumo-base)`) with a hairline right border. The selected app uses the accent text on a light blue tint (`#EEF4FF` light, `#1B2A44` dark).
- **Mobile (<768px).** The bar keeps the logo and avatar. The sidebar stays an off-canvas drawer below the bar.

## 4. Copy and persona

**Strings.** All of these read from `shared/brand.ts`:

- Home headline (`src/routes/home.tsx:207-211`): "What should we build today?" in sentence case. "build" uses the `text-brand-emphasis` color. The `font-funky-mono`, `uppercase`, and `tracking-tighter` classes are removed.
- Page titles: the 11 `<title>` elements ending in " - Build" (in `home.tsx`, `chat/chat.tsx`, `app/index.tsx`, `apps/index.tsx`, `discover/index.tsx`, `settings/index.tsx`, `profile.tsx`) use a `pageTitle(page?)` helper from `src/brand/`. It returns `"<page> - Estori"`, or `"Estori"` when no page is given.
- Settings (`src/routes/settings/index.tsx:282,357,496`): "VibeSDK API keys" becomes "Estori API keys", "act as your VibeSDK account" becomes "act as your Estori account", and "the VibeSDK SDK" becomes "the Estori SDK". The `VIBESDK_API_KEY=` snippet stays because it is the SDK's real environment variable.
- Passkey dialog: `rp.name: 'vibesdk'` (`src/contexts/vault-context.tsx:318`) becomes `BRAND.name`. This is a display label only. `rp.id` stays the hostname, so existing passkeys keep working.
- Deploy copy (`src/routes/chat/components/deployment-controls.tsx:105,188,218,232,316`; `chat.tsx`):
  - Platform target: "Deploy", "Deploying", "Redeploying".
  - User-account target: "Deploy to your Cloudflare account".
- Other "Cloudflare" strings stay when they name a real Cloudflare feature, such as account connection, AI Gateway, and sign-in. The brand guard allowlist records them (see Testing).

**Agent persona.**

- `ThinkAgent.getSystemPrompt()` (`worker/agents/think/ThinkAgent.ts:282-290`) assembles `base + "\n\n" + projectContext`. It becomes `composeSystemPrompt(base, projectContext)` from a new `worker/agents/think/persona.ts`, which inserts the identity block between the two: "You are Estori, an expert full-stack engineer building deployable web apps on Cloudflare. Your name is Estori; use it when users ask who you are, and never call yourself Think."
- `DEFAULT_SYSTEM_PROMPT` (line 69, the fallback when the host passes no project context) drops "Cloudflare full-stack engineer" in favor of the same identity.
- The host prompt heading "## Deploy & verify workflow (VibeSDK-specific)" (`worker/agents/core/behaviors/think.ts:322`) becomes "(platform-specific)", so the model has no "VibeSDK" name to repeat.
- The base prompt files beginning "You are Think, …" are not edited. The identity block's explicit naming instruction takes precedence.

**Git author.** The default author in `worker/agents/git/git.ts:45` becomes `BRAND.gitAuthor`.

## 5. Testing

**New Vitest suites**, each in the folder of the code it covers:

1. **Brand guard** (`src/brand/brand-guard.test.ts`). It scans `src/**/*.{ts,tsx,html}` and `index.html`, and fails on any of these:
   - user-visible "VibeSDK";
   - "Cloudflare v1";
   - the uppercase "BUILD" wordmark pattern;
   - `CloudflareLogo` imports from `@cloudflare/kumo` or `@/components/icons/logos` in files outside the integration allowlist in section 1;
   - `<title>Build</title>`.
2. **Palette contrast** (`src/brand/palette-contrast.test.ts`). It parses `estori-theme.css`, resolves the light and dark values, and asserts WCAG AA for every declared text/background pair: 4.5:1 for body and link text, and 3:1 for large text, focus rings, and UI boundaries.
3. **Persona** (`worker/agents/think/persona.test.ts`). `composeSystemPrompt` places the Estori identity block, built from `BRAND.assistantName`, between the base prompt and the project context.
4. **Worker branding guard rules.** Worker sources contain no `vibesdk-bot@cloudflare.com` and no `VibeSDK-specific`, and `GitVersionControl` references `BRAND.gitAuthor`.

**Existing checks.** `bun run typecheck`, `bun run lint`, and `bun run test` all pass.

**Manual verification.** Run on the local dev server (port 8100) in both light and dark mode:

- Home, chat view, settings, and a usage-limit dialog.
- Sidebar expanded, collapsed, and on mobile width.
- Tab title and favicon.
- One generation, asking the agent "who are you?" with "Estori" as the expected answer.

## Upstream merge impact

**Upstream files edited.** These edits are small and listed so future merges know where to look:

- `index.html`
- `src/index.css` (one import line)
- `src/components/header.tsx`
- `src/components/layout/app-layout.tsx`
- `src/components/layout/app-sidebar.tsx` (header and footer sections)
- `src/components/layout/global-header.tsx`
- `src/components/credits-banner.tsx`
- `src/routes/home.tsx`
- `src/routes/chat/chat.tsx`
- `src/routes/chat/components/messages.tsx`
- `src/routes/chat/components/deployment-controls.tsx`
- `src/routes/chat/components/phase-timeline.tsx`
- `src/routes/chat/components/terminal.tsx`
- `src/routes/chat/components/thinking-indicator.tsx`
- `src/routes/settings/index.tsx`
- `src/routes/app/index.tsx`, `src/routes/apps/index.tsx`, `src/routes/discover/index.tsx`, `src/routes/profile.tsx` (page titles)
- `src/contexts/vault-context.tsx` (passkey display name)
- `worker/agents/think/ThinkAgent.ts`
- `worker/agents/core/behaviors/think.ts` (one prompt heading)
- `worker/agents/git/git.ts`

**New files:**

- `shared/brand.ts`
- `src/brand/*`
- `src/styles/estori-theme.css`
- `src/components/layout/EstoriTopBar.tsx`
- `worker/agents/think/persona.ts`
- `public/favicon.svg`
- `src/brand/*.test.ts` (tests run in the existing Workers-pool Vitest setup and read sources through Vite `import.meta.glob` with `?raw`)

## Commits and working tree

- The earlier dev-port fixes (`worker/config/security.ts`, `worker/agents/core/behaviors/think.ts`) go in their own commit, separate from the rebrand.
- Local-only edits to `wrangler.jsonc` stay out of every commit: removed Artifacts and dispatch bindings, and `dev.enable_containers: false`.

## Risks

- **Kumo token coverage.** Some Kumo components may read tokens not listed above, leaving stray orange or Cloudflare blue. The manual pass covers each main screen in both modes, and fixes go in the theme file, not in components.
- **Persona drift.** The model may still introduce itself as "Think". The persona test checks the prompt, not model behavior. The manual "who are you?" check covers behavior. If it fails, the next step is a one-line override appended after the base prompt, still without editing the `.txt` files.
- **Prompt provenance (out of scope, flagged).** `worker/agents/think/prompts/anthropic.txt` and `codex.txt` appear to be copies of the Claude Code and Codex CLI system prompts. Their licensing should be confirmed before launch.
