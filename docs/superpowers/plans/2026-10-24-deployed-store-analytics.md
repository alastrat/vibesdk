# Deployed storefront analytics and widgets

Goal: remove global-sidebar frame/dividers and add the Whop-style traffic and checkout widgets requested by the user. Existing autonomous implementation authorization applies.

Architecture: Cloudflare live-store gateway records successful HTML GET document requests asynchronously in existing D1 storage. Store identity is resolved by the platform, not accepted from the browser. Exclude assets, previews, bots, GPC/DNT requests and missing identity; visitor estimates use an app-scoped keyed digest without storing raw IP or UA. Referrer hostname only, no query parameters. Event rows retain only coarse country/device/source and public path. Reads require store ownership; live/test separated. Checkout abandonment and refunded amounts come from server records, not fabricated traffic conversions.

UI: live events, traffic selector (visitors/page views/checkouts), source/device donut summaries, countries, top pages, total refunded and average paid revenue/customer, abandoned checkouts, existing payment metrics. Kumo + visx, compact three-column grid with responsive stacking, honest empty states and sample-mode labels. Poll traffic endpoint on active Analytics only. Local sample traffic is explicitly test mode; production collection starts after deployment and no historical backfill is claimed.

- [x] Collector/schema/migration/owner report with security and SQL tests.
- [x] API contracts/client/query keys/controller/route.
- [x] Whop widget UI and sidebar divider removal.
- [x] Local sample traffic persisted, translations and checks.
- [x] Browser/independent review, commit/push PR; report deployment requirement.

## Verification and delivery

- Typecheck passed; lint passed with zero errors and six existing Fast Refresh warnings; full production build passed.
- Actual Workers/D1: 15 tests across collector/service, live-store handler and owner-only controller passed.
- Frontend regression: 93 tests across 11 files passed using the temporary Node harness, including visx metric switching, empty/test modes, account/store navigation and translations.
- Local migration applied. Local-only seed persisted 13,500 explicitly test-mode page events and 180 expired test checkouts across the two authorized sample stores. No production records or provider transactions were created.
- Independent browser review checked 1440px and 390px layouts, metric switching, cross-store reset and live/test isolation. Parent review confirmed final corner globe styling and zero sidebar dividers. Screenshots saved in the workspace-rollout visualization directory.
- Collector counts successful published HTML document requests; it does not claim SPA navigation telemetry or historical backfill. Visitor counts are anonymous estimates. Money and checkout widgets read server records rather than inferring sales from visits.
- Production requires the D1 migration followed by platform deployment. This work does not deploy the platform or claim production traffic has started.

Delivery: commit and push on `codex/workspace-account-settings`, update existing draft PR #35. Local TLS configuration, credentials, fixtures and `.superpowers/` remain excluded.
