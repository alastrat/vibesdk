# Live Store Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Open a dedicated, interactive live analytics view from the storefront globe, matching the supplied Whop live dashboard.

**Architecture:** Owner-only `/api/stores/:id/analytics/live` returns a fresh UTC today/yesterday snapshot from the existing Cloudflare document-event collector and persisted orders. TanStack Query refreshes every five seconds while visible; failed/stale requests are explicitly shown. `?section=analytics&view=live` preserves the dashboard URL for returning, replaces store chrome with a back link, and renders four compact Visx widgets, a large draggable gray globe and a recent-event feed.

**Tech Stack:** React, Kumo, Phosphor, Visx, TanStack Query, Worker/Hono, D1.

**Spec:** User's October 24 live-mode request and supplied Whop screenshot; observed authenticated Whop `/analytics/live/` contains today's sales, today's page views, devices, sources, a large center globe and right event list.

## Global Constraints
- Use Kumo for controls; blue charts and green live status; preserve Estori typography and authenticated global shell.
- Actual recorded events only. Live and test are separate, owner checks mandatory, no private visitor identities returned.
- Five-second polling is described honestly; unknown country locations remain unplotted. No production deploy or database mutation to create fake live traffic.
- English, Spanish and Portuguese; keyboard access, touch rotation and reduced-motion support.

## Review Focus
- A lost connection must never continue claiming its last snapshot is live.
- Changing store/account/mode must not leak the previous snapshot.
- UTC midnight, equal-time yesterday comparison and mixed currencies must remain correct.
- Unknown countries and empty stores must not display invented pins or events.
- Dragging must not snap back, trigger selection accidentally, or block mobile scrolling outside the globe.

### Task 1: Live data contract and endpoint
**Files:** shared/types/store-analytics.ts, worker/services/store-analytics/live.ts, live.test.ts, analytics controller/routes, src/api-types.ts, src/lib/api-client.ts, src/lib/query-keys.ts.
**Interfaces:** `getLiveStoreAnalytics(db, appId, ownerId, mode, now?)` → `StoreLiveAnalytics`; HTTP GET `/api/stores/:id/analytics/live?mode=live|test`.
- [x] Add real D1 tests proving ownership, mode separation, today/yesterday hourly aggregation, bounded recent events, new event appearing on next snapshot, mixed currencies and future-event exclusion; run to fail.
- [x] Implement bounded queries and private/no-store endpoint, shared contract, API client and identity-scoped query key.
- [x] Run focused Worker tests and typecheck; expect pass.

### Task 2: Live dashboard and draggable globe
**Files:** live-analytics.tsx/css, live-hourly-chart.tsx, visit-globe.tsx/css/utils, store-workspace/index.tsx, traffic-widgets.tsx, es/pt catalogs.
**Interfaces:** `LiveStoreAnalytics({appId,userId,mode})`; miniature globe routes to live URL; reusable `VisitorGlobeMap` accepts recorded countries/events and selection.
- [x] Test normalization/rotation and cumulative hourly series boundaries before implementing their helpers.
- [x] Build reference composition, current-day widgets, event list and real five-second query with stale/error/pause states. Preserve return URL; no period/product filter applied to live mode.
- [x] Extend globe with drag/touch/keyboard rotation, inertial release and subtle auto-rotation that stops on manual interaction; country selection drives event filter. Respect reduced motion.
- [x] Translate new strings; run targeted tests, typecheck, lint and build.

### Task 3: Browser validation and independent review
- [x] Verify globe entry, back link, refresh, event ingestion through collector in tests, error/reconnect, drag/keyboard, responsive and no-data rendering.
- [x] Save desktop/mobile screenshots; request fresh QA/design/code review against user reference and this plan; fix important findings.
- [x] Commit/push to existing branch and update PR #35 with verified behavior and deployment limits.

## Verification — October 24, 2026

- Owner-only API and collector: 16 real Workers/D1 tests passed, including UTC midnight, same-instant yesterday cutoff, future-order/event exclusion, live/test isolation, multiple currencies, first-visit attribution and bounded event delivery.
- Frontend: 81 focused view/chart/globe/filter/report/catalog tests passed. Typecheck and production build passed. Lint has zero errors and six existing Fast Refresh warnings.
- Browser at 1720px and 390px: mini globe opens live mode; back retains dashboard parameters; country selection filters events; pointer drag and arrow keys rotate; pause holds existing data and resume fetches new persisted rows. New events appeared without reload. Three test events expired from the live feed and active globe after five minutes.
- Independent fresh-context design/code review: no Critical or Important findings. Fixed a Minor currency-axis clipping issue and narrow-screen tick collisions. Globe inertia stops when hidden, paused or reduced motion becomes active.
- Visual proof saved outside source control in `workspace-rollout/live-analytics-desktop.png`, `live-analytics-mobile.png`, and `live-analytics-mobile-metrics.png`.
- Ruling: live means fresh five-second polling, not push delivery. Data is today in UTC; the active-visitor/event window is five minutes. Browser checks used isolated, labeled local test fixtures, removed after validation. No synthetic production visits.
- Deployment limit: migration 0038 and the existing document collector need production deployment before published-store traffic can appear there. No production deployment/migration or historical backfill was performed. Page-request events are supported; client-side SPA navigation is not tracked.
- Full repository suite remains subject to the previously recorded local workerd loopback issue; the focused Worker checks above passed using one runtime. CI must run the full standard suite before merge.
