# Public Discover implementation plan

**Goal:** Ship a public Contra-style gallery with 48 original artifacts, D1/R2 persistence and paid source delivery, preserving signed-in Discover.
**Spec:** ../specs/2026-10-22-public-discover-design.md
**Architecture:** Dedicated curated catalog in D1, public covers/previews and private versioned source in R2; existing app marketplace remains separate. React public shell consumes typed APIs through TanStack Query. Original standalone HTML/CSS/JS artifacts avoid third-party dependencies and execute only in sandboxed preview frames.
**Execution:** User authorized autonomous subagent implementation. No further design checkpoints. Proposed $29/$9 prices are local defaults; no production publication.

## Global constraints
- Use Bun; no secrets/local config in git. Existing worktree/new branch only.
- 48 entries: eight categories, three stores and three components each, 24 free/24 paid.
- Public browsing, real storage; no fake deployments/creators, source bundles private for paid items.
- Preserve authenticated gallery and marketplace APIs. Auth loading must not flash wrong shell.
- No new any types. Kumo Dialog, Phosphor icons. Reduced motion, keyboard and mobile supported.

## Contracts and ownership
Parent owns shared/types/discover-catalog.ts, scripts/discover/artifact-types.ts, frontend APIs/query/UI/routes/styles. Backend agent owns worker/**, migrations/**, scripts/discover/seed.ts and backend tests. Template agent owns scripts/discover/stores.ts and stores/ modules/tests. Motion agent owns scripts/discover/components.ts and components/ modules/tests. All artifact builders export synchronous arrays using CatalogArtifact; no JSON frontend fallback.

## Tasks
- [x] Backend: schema/categories/entries/assets/version/purchases; public catalog/list/detail/asset APIs (published only) with bounded filters; authenticated paid checkout/access/download; verified idempotent fulfillment; local idempotent uploader/seeder. Test malformed filters, draft/source isolation, upload failure, price/buyer/version/paid-state validation and duplicate webhook.
- [x] Stores: buildStoreArtifacts(): CatalogArtifact[] returning 24 distinct standalone functional storefronts. Validate count, pricing, unique slugs, safe files and previews; test cart/filter behaviors. Source includes README and runnable index.html.
- [x] Motion: buildComponentArtifacts(): CatalogArtifact[] returning 24 distinct standalone reusable motion examples. Validate counts/slugs/reduced motion and keyboard interactions. Source includes README and usage example.
- [x] Public UI: anonymous route split, hero/search, topic rail, type/tier/category filters, 4/2/1-column visual grid, detail/topic modals, account purchase continuation. Test auth modes, search/modal/deep link/back/focus/error states.
- [x] Integrate: generate/validate artifacts, upload to local R2, seed D1 with matching runtime config, prove counts/hashes and restart persistence. Run typecheck/lint/focused tests/build. Browser check desktop/mobile, motion and modal. Independent review and fix findings before completion.

## Review focus
Paid source leaks, preview same-origin script execution, stale account cache, mismatched local storage configuration, fake pending checkout grants, and 48 simultaneous frames. Explicit tests/verification for each.

## Rulings and progress
- User away: continue all reversible implementation/verification independently. Production writes remain out of scope.
- Downloadable standalone storefronts are runnable templates; no implied backend/payment setup or one-click agent import.
- Shared contracts precede parallel work; schema/payment ownership stays with backend agent to prevent conflicting migrations.

- Review ruling: public interactive previews expose client runtime by nature. Premium archive/source delivery stays entitlement-protected, but no claim of runtime secrecy. No third-party code or credentials are included.

## Verification completed
- Initial work committed and pushed as `e151df8e` before creating `codex/public-discover-redesign`.
- Local D1 contains 48 published entries across eight topics: 24 stores, 24 components, 24 free and 24 premium. R2 stores 240 current-version objects; rerunning the seed leaves entry counts unchanged.
- Restarted the Vite/Worker server on port 8123 and verified the public API-backed gallery still displays 48 entries and stored artwork.
- Final root typecheck, lint and build pass. Lint reports six existing Fast Refresh warnings; build reports existing chunk-size/dynamic-import warnings.
- Focused catalog/UI/component regression suite: 39 passing tests. Store artifact suite: 53 passing tests. Catalog payment race fix independently reviewed with 29 passing backend tests.
- Browser verified desktop and 390px mobile layouts, topic/detail deep links, combined filters, keyword search, modal close/focus restoration, store bag quantities/totals, component swatch interaction, and sign-in handoff. No horizontal mobile overflow.
- Browser caught invalid standalone SVG attributes; fixed all affected covers, added regression coverage, parsed all 24 component covers and reseeded. Reloaded gallery has no broken loaded images.
- Independent UI review findings fixed: preserve gallery scroll on query changes and retain checkout confirmation parameters across authentication.
- Independent payment review finding fixed: one pending checkout per buyer/item, immutable checkout snapshots, stable Stripe idempotency, verified expiry rotation and duplicate-payment reconciliation.

- PR verification: full root suite passed (565 files, 5,064 tests, 2 skipped) using the Workers pool single-worker setting to avoid local port exhaustion. Typecheck, lint and production build passed again. New Discover messages have Spanish/Portuguese translations and locale regression coverage; stale marketing/billing source guards now check current behavior.

## Release boundary
This work is locally seeded and verified; no production deploy, remote seed, or live Stripe charge was performed. Paid catalog amounts are editable local defaults ($29 storefronts / $9 components). Public interactive previews necessarily expose browser runtime; the downloadable archive remains gated by authentication and entitlement. Store demos require a commerce backend before use as real shops. Community membership and posting are future work; this release establishes durable topic categories.
