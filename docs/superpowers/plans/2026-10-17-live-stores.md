# Live Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Each store can go live at `<slug>.<stores domain>` and connect the seller's own domain. Shoppers browse and
pay there, from the version the seller published.

**Spec:** `docs/superpowers/specs/2026-10-17-live-stores-design.md`

**Execution note:** this plan is lean on purpose. Its author executes it in the same session, while the owner is away
and has asked for independent work. Each task runs test-first: write the test, watch it fail, then implement. Every
deviation is ledgered as a ruling.

## Global Constraints

- **Code:** no `any`, no emojis. Commits are lowercase after the type prefix, with the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:** `.dev.vars`, `bun.lockb`, `.superpowers/`, `.playwright-mcp/`, `src/routes/landing/LandingPage.tsx`,
  or the local overrides in `wrangler.jsonc`.
- **Cloudflare:** no calls to the real Cloudflare API, and no DNS, route or zone changes. Providers are tested with a
  mocked `fetch`.
- **Stripe:** test mode only.
- **Tests:** run in batches with the scratchpad `batch.sh` and `fullsuite.sh`.

## Tasks

### Task 1: Slugs, hostnames and the live records
- Files: `shared/types/live-stores.ts`, `migrations/0026_live_stores.sql`, `worker/database/schema.ts`,
  `worker/database/services/LiveStoreService.ts`, its real-SQL test.
- `slugFromTitle`, `isValidSlug` (reserved words), `normalizeHostname` and `isAcceptedCustomHostname`.
- Tables `live_stores` and `store_domains`.
- Service: get by app, by slug, by hostname; publish (upsert with slug), take offline; add, update and remove a domain;
  pending domains.
- Tests:
  - the slug and hostname rules;
  - a slug can belong to one store only;
  - a hostname to one store only;
  - lookups by slug and hostname.

### Task 2: SpaceDO publishes and serves `live`
- Files: `space/src/space/deploy-engine.ts` (`publishLiveDeployment`), `space/src/space/durable-object.ts`
  (`publishLive`, the `/__live/` route, refusing `live` in `deploy`), `worker/agents/think/deploy-tool.ts`, tests.
- Tests:
  - publishing copies `main`'s row into `live` on a real DO SQLite;
  - publishing without a `main` deployment fails;
  - `deploy_space` refuses `live`.

### Task 3: Host routing and live serving
- Files: `worker/services/live-stores/hosts.ts` (`resolveStoreHost` with an isolate cache),
  `worker/api/handlers/live-store.ts`, `worker/index.ts`, `worker/types/env.d.ts`.
- Tests:
  - subdomain and custom-domain resolution;
  - offline stores and unknown hosts;
  - Estori's own hosts never resolve as stores;
  - live requests reach SpaceDO's `/__live/` path;
  - `/__estori/*` reaches the store platform with base path `''`.

### Task 4: Payments on live stores
- Files: `worker/api/handlers/store-platform.ts` (a live viewer, the seller from the app owner, the `live`
  manifest, mode), `worker/services/store-payments/checkout.ts` (gates), `pay-page.ts` (server-checked return paths,
  minor M1), tests.
- Tests:
  - shoppers may pay on live stores in test mode;
  - live mode needs `LIVE_STORE_PAYMENTS=on`;
  - previews are unchanged;
  - the seller is the app owner;
  - return paths come from the server.

### Task 5: Custom domain providers and checks
- Files: `worker/services/live-stores/domains.ts` (interface, Cloudflare for SaaS, local, `domainProviderFromEnv`),
  `worker/services/live-stores/domain-checks.ts` (add, check, remove, hourly sweep), tests with a mocked `fetch`.

### Task 6: API
- Files: `src/api-types.ts`, `worker/api/controllers/liveStores/controller.ts`, `worker/api/routes/liveStoreRoutes.ts`,
  `worker/api/routes/index.ts`, `src/lib/api-client.ts`, tests.

### Task 7: The Go live panel
- Files: `src/components/live-store/GoLiveDialog.tsx`, `src/hooks/use-live-store.ts`, `src/routes/chat/chat.tsx`
  (button), guard tests.

### Task 8: End to end
- Set `STORES_DOMAIN=stores.localhost` locally and restart the dev server.
- Publish two stores and shop on them signed out: on the subdomain, then on a `.localhost` custom domain.
- Take a store offline, publish changes, and capture screenshots for the report.

## Finish
- Full suite and both `tsc` configs, then a fresh final review, one fix pass, push the branch, a draft PR stacked on
  #12, and the report.
