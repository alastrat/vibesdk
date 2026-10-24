# Complete Workspace Rollout Implementation Plan

> **For agentic workers:** use executing-plans for the parent-owned tasks and the coordinated parallel workflow for isolated modules. User authorized autonomous execution.

**Goal:** Complete the preview-to-production rollout across all authenticated views and functional store tools.
**Architecture:** Shared Kumo shell with workspace navigation or store rail; existing owner-gated store workspace composes scoped tools and order reports; manifest-backed Products API.
**Tech Stack:** React, React Router, Kumo, Tailwind v4, TanStack Query, Hono/Workers, D1, SpaceDO, Recharts.
**Spec:** ../specs/2026-10-24-complete-workspace-rollout-design.md

## Global constraints
- Preserve auth, ownership, billing/usage gates, feature flags, editor controls and all existing workflows.
- Use apiClient and centralized account/store-scoped query keys. No fabricated data or new any types.
- Estori DM Sans/brand tokens with Whop-style density; keep Kumo and Recharts.
- Local .superpowers config/secrets remain untracked. Do not deploy or merge.
- Run only one small Vitest group at a time: prior full-suite runs exhausted macOS loopback ports.

## Review focus
- Switching store/account must not show or mutate previous store's data.
- Legacy URLs and Stripe/OAuth return parameters must preserve their existing flows.
- No-store, unpublished-store, paused-feature and failed-service states need useful actions.
- Mobile tab overflow and keyboard focus must leave every section reachable.
- Preview metrics and sample actions must never masquerade as persisted production capabilities.

## Tasks
- [x] Audit preview, production route map, services and live Whop reference independently.
- [x] Shared shell and navigation. Parent: app-layout, app-sidebar, EstoriTopBar, workspace-shell.css; new store-rail and workspace-search. Preserve all old actions while removing email/translation global entries. Route-scoped rail and command/search tests; browser mobile/desktop.
- [x] Scoped email/translation panels. Agent: routes/emails/** and routes/translations/**. Export StoreEmailsPanel({appId}) and StoreTranslationsPanel({appId}); default exports launch explicit store selection. Reuse mutations/editors/flags; adjust meaningful existing tests.
- [x] Published products. Agent: shared/types/store-workspace.ts, owner-only controller/route, apiClient/types/query keys, routes/store-workspace/products.tsx. Export StoreProductsPanel({appId}); test owner auth, missing/invalid manifest, safe projection, image URLs, filter/detail navigation.
- [x] Complete store workspace. Parent: store-workspace/index.tsx/CSS; embed new sections, store settings publication controls, customer detail Kumo dialog, scoped order detail return, real product preview, chart/table polish. Keep report queries exclusive to report sections. Test section routing/scoping/back navigation.
- [x] Whole-app coverage. Parent: shared page system plus profile/settings/billing/catalog/orders/discover/admin/build/editor wrappers. Preserve route content, controls and feature gates; account-switch cache cleanup. Inventory every route in validation ledger.
- [x] Localization. Parent: extract additions from agents and source, update ES/PT catalogs with current tone; run coverage tests.
- [x] Verification and independent final comparison. Required typecheck/lint/build; focused regression groups sequentially, root suite if viable. Browser review preview/production/Whop, no fake production records; fixture-based render harness if account lacks stores. Fix material findings.
- [x] Commit complete implementation with verification record and leave local HTTPS server running.

## Progress ledger
2026-10-24: Autonomous continuation authorized. Prior implementation committed b4627e8a. Audit confirms navigation, real products and embedded tool gaps. Parallel ownership set; parent owns shell/integration/locales; agents own products and email/translations. Whop reference reviewer owns third-party browser inspection.

2026-10-24 completion review: shared shell, store rail/search, eight store sections, real published products, customer/order drill-down, and real publishing/settings are integrated. Emails and Translations are store-scoped; legacy URLs explicitly select a store. Private caches are canceled and removed on account changes, and transient workspace state remounts by identity. ES/PT catalogs cover the new surfaces. See the validation ledger for route coverage, visual checks, and test limitations.
