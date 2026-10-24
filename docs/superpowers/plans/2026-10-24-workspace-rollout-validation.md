# Authenticated workspace rollout validation

## Scope and data

The rollout is implemented on `codex/workspace-account-settings`, following the prior preview PR. It extends the real authenticated application, while retaining `/layout-preview` as a design reference. Production sections use existing services; the new product collection endpoint reads a validated, commit-matched published manifest after checking ownership. No migration or fabricated production records are needed.

The signed-in local account has no stores. Browser checks therefore used both the real account (empty states, global navigation, search, account settings) and an isolated development harness rendering the actual production components with labeled fixture data and all writes disabled. Fixture files and local TLS configuration are untracked and excluded from the commit.

## Route coverage

| Surface | Integration and workflow preservation | Validation |
| --- | --- | --- |
| `/`, `/apps` authenticated | Estori workspace shell, store list, filters, favorites, builder entry | Real signed-in browser, paginated-query regression |
| `/stores/:id` | Owner gate; Home, Analytics, Products, Customers, Payments, Emails, Translations, Settings | Mounted ownership tests; real component fixture browser |
| Store switcher | Preserves selected section, resets store-local panels | Two-store fixture switching; rail tests |
| Home / Analytics | Actual seller-order aggregation, period selector, chart, honest order-only scope | Report tests; desktop/mobile chart review |
| Products | Owner-only live manifest projection, search/filter, variant details, builder/catalog links | Controller/projection and mounted UI tests; modal and keyboard browser checks |
| Customers / Payments | Order-derived customer list, customer detail, order drill-down, refund/shipment entry points | Report tests; customer-to-order browser flow |
| `/stores/:storeId/orders/:id`, `/orders/:id` | Store context retained; mismatched store hides order; existing shipment/refund controls reused | Route/guard tests and fixture drill-down |
| Emails | Existing templates, reply-to, preview/test, delivery history and billing/flags | Mounted email regression; store-scoped browser view |
| Translations | Existing settings, language activation, translation jobs and text editor | Mounted/editor/guard regression; mobile and PT dark-mode browser |
| `/emails`, `/translations` | Explicit store launcher, removed from global sidebar | Navigation and guard regressions |
| Store settings | Existing publishing/domain dialog, builder, favorites and delete confirmation | Code review and fixture controls; no destructive live action |
| Account popover/settings | Top-right Kumo menu; real profile, appearance/language, connections, security, billing, privacy | Real account read-only inspection; mounted settings and auth tests |
| `/profile`, `/settings` | Shared shell/type; existing profile, credentials, integrations, plan controls retained | Route/code audit; account-settings regressions |
| Billing, checkout, returns | Shared shell; embedded checkout excluded from broad visual rules; existing return/query flows and gates retained | Billing guards/view/action tests; primary LinkButton regression review |
| `/catalog`, `/orders` | Shared compact management tables; existing catalog/order actions and flags retained | Real account navigation; route audit |
| `/discover`, `/discover/:appId` | Authenticated workspace shell; public Discover layout remains separate | Route audit; heading density adjusted |
| `/build`, `/chat/:chatId`, `/app/:id` | Shell wraps existing builder/preview; editor content excluded from management CSS; header controls retained | Route/header/style audit |
| Admin review/access/contact/catalog-order/flag routes | Existing protected pages and server role checks retained within shared shell | Route/style audit; no admin mutation performed |
| Public marketing, legal, authentication, 404 | Existing public layouts retained | Route boundary audit |

## Visual and accessibility review

An independent agent inspected the live Whop reference, then reviewed the implementation screenshots and code. Estori retains DM Sans, brand blue, Kumo components and the existing Recharts engine. The design follows Whop's compact navigation, quiet borders, restrained chart grid/fill, and table density; no claim is made about Whop's underlying chart library.

Review fixes: visible Kumo primary link buttons (including billing actions), wrapped mobile filters, compact store header, and properly contained horizontal tables. Verified 390px viewport, desktop, EN/ES/PT catalog coverage, Portuguese dark mode, modal bounds, Escape close/focus return, keyboard search navigation, and store-section switching. Temporary viewport override was reset. No live account profile, financial, email-send, or destructive action was performed during visual testing.

## Verification evidence

- Root TypeScript check passed after final production edits.
- Root ESLint passed with 0 errors and 6 existing Fast Refresh warnings.
- Production build passed (space + frontend/Worker bundle); existing large-chunk/dynamic-import notices remain.
- New product backend/projection and UI focused run: 24 tests passed in the Workers pool.
- Account/cache focused run: 33 tests passed.
- Localization extraction covered 1,162 source files and 3,143 messages with no missing/unused keys, plural, placeholder or sorting errors.
- Final serialized frontend regression: 274 distinct tests across 28 files passed. The initial rerun identified stale navigation/link-markup guard assertions; those were corrected and the final affected file passed all 16 tests. Coverage includes mounted account settings, auth/cache isolation, store owner gates/report/products, email/translation editors, billing guards/actions/views, i18n, cross-store order refusal, deletion-cache invalidation, and card recovery links.
- Final independent code review found no blocking correctness or accessibility regressions.
- The commit hook’s redundant Workers-based related test run is skipped for this commit because of the documented port exhaustion; typecheck, lint, build, and targeted regressions were run explicitly.

The repository-wide Workers suite could not complete on this machine: concurrent workerd instances exhausted macOS loopback ports (`EADDRNOTAVAIL`). A smaller Workers retry hit the same infrastructure issue. Orphaned test processes were stopped, the HTTPS development server was restored, and frontend-only regressions were moved to a temporary single-worker Node config. This is a test-environment limitation, not a claimed full-suite pass. Worker-specific tests retain the earlier actual Workers result. CI should run the complete standard suite before merge.
