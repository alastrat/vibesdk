# Workspace preview parity correction

**Goal:** Implement the approved preview's actual page composition throughout the authenticated app, correcting the previous cosmetic global rollout.
**Architecture:** Kumo sidebar and topbar with grouped global navigation, route breadcrumb, consistent page sections and data panels. Existing real services and owner checks retained; store tools live inside the store. Same branch/PR, autonomous execution already authorized.
**Reference:** `/layout-preview`, plus the original Whop/account settings references. Existing rollout specs remain constraints but their whole-app completion claims are reopened.

## Acceptance and review focus
- Compare the real root URL to preview, not just a store fixture screenshot.
- Public/private visibility and live/draft publication are different filters; use real backend state before pagination.
- Profile/Settings and all global management pages need composed layouts, not broad CSS alone.
- Catalog/product handoff retains selected store and intent without automatically spending AI credits.
- Payment browsing must not hide older/test orders merely because analytics is date-limited.
- Mobile navigation, localization, feature flags, account isolation, and editor/billing callbacks remain functional.

## Work
- [x] Parent: rebuild global Sidebar/EstoriTopBar/AppLayout around preview identity, groups, breadcrumb and content canvas. Keep account top-right, favorites/recent reachable, Cloudflare gating unchanged; no global Email/Translations.
- [x] Stores agent: actual publication summaries/filter/pagination, preview toolbar/table/selection export, Discover entry and empty-state recovery. Owner-scoped backend tests and mounted list tests.
- [x] Account agent: Profile summary/tabs/forms and sectioned Settings with reused account components, all legacy keys/sessions/integrations/deletion/payment callbacks preserved.
- [x] Store agent: proper catalog/store handoff, actionable product intent, complete payment-history browsing, preview home composition; compact Catalog/Orders pages.
- [x] Stores agent + parent: shared admin/navigation/data panels and deliberate builder/Discover header integration, preserving canvases and public layouts.
- [x] Parent: ES/PT updates from exact source extraction, root checks and sequential focused tests, real root/account/admin browser comparisons plus representative store workflow and responsive checks.
- [x] Independent skeptical visual/workflow review, fix findings, update PR with truthful acceptance evidence. Do not claim completion based on route availability or tests alone.

## Final evidence

- Typecheck, lint (0 errors, 6 existing warnings), and production build passed.
- Final frontend regression: 463 tests across 46 files passed.
- Fresh real Workers/D1 publication-filter regression: 6 tests passed through the standard root test script.
- ES/PT catalogs have no missing/empty/unused keys or placeholder mismatches; the separate merged catalog/account/i18n run passed 71 tests.
- Real authenticated root, Profile, Settings, account modal, builder, and admin reviews were inspected. Production store components were exercised with explicitly labeled read-only fixtures because this account has no stores.
- Independent 390px mobile review covered Home, Products/dialogs, Analytics, dark mode, and cross-store report reset with no horizontal page overflow.
- Full repository Workers suite remains a CI requirement after the earlier local port exhaustion; no full-suite pass is claimed.
