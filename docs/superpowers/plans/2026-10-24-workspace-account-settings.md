# Workspace and account settings implementation plan

Goal: roll the approved preview layout into the authenticated app with functional account settings and real store reports.
Architecture: a shared Kumo shell and account modal provider; protected owner store workspace; existing apiClient + TanStack services. DM Sans and Estori blue, muted Whop-style surfaces. Recharts for actual order reporting.
Spec: ../specs/2026-10-24-workspace-account-settings-design.md

## Tasks
- [x] Publish completed previews/localized 404/translations in PR #34 and branch codex/workspace-account-settings.
- [x] Confirm actual rollout and real persistence with user.
- [x] Account settings module: Kumo searchable modal, real profile/appearance/locale/identities/sessions/API/privacy services, fix underlying save gaps and regression tests.
- [x] Shared app shell: DM Sans, neutral sidebar/canvas, top-right identity dropdown with settings/help/legal/theme; preserve credit controls.
- [x] Workspace store list and store navigation: route store selections into protected workspace, keep editing available.
- [x] Store workspace: Kumo tables, real date-scoped paginated order data, Recharts, clear no-data states and existing product/builder actions.
- [x] Translate new strings into Spanish and Brazilian Portuguese.
- [x] Verify typecheck, ESLint, focused regression tests, build, keyboard/mobile/light/dark browser behavior; review authorization and mutation boundaries.

## Execution boundaries
Independent account and store modules are assigned to separate agents. Parent owns shell/routes/list/integration/locales. No demo records in production, no deployment, no live destructive account tests. Local HTTPS config and credentials are untracked and excluded from commits. Existing billing gates stay unchanged.

## OAuth local development follow-up
Google rejects .local redirects. Use https://local.estori.app/api/auth/callback/google, local mkcert certificate and loopback proxy. Hosts entry requires user's macOS password. Existing .local address redirects to the new alias. No production DNS changes.

## Verification and review results
- Root typecheck and production build passed. Root lint passed with six existing Fast Refresh warnings.
- Focused account mounted tests: 7 passed, including identity changes, real mutation wiring, and focus return. Profile persistence/locale tests: 16 passed. Current-session SQL regression tests: 4 passed.
- Store report/access tests: 9 passed. Private-store query isolation and query persistence tests: 8 passed. Translation/profile checks: 68 passed. These groups overlap; counts are not a combined total.
- Full root suite attempted twice. The smaller 32-shard retry passed its first four shards (574 tests), then hit macOS loopback EADDRNOTAVAIL. Stopped the resource-exhausted runner; full-suite completion remains unverified.
- Browser: authenticated local.estori.app sign-in, top-right account menu, profile/settings search, mobile and desktop layouts, current-session labeling, light/dark appearance, and real language/theme preference saves. Temporary preferences restored to English/system. No live keys, sessions, identities, or financial data changed.
- Independent final integration review found no further actionable defects. Store dashboards use owner-scoped real orders; this local account has zero stores, so populated reports are covered by automated data/access tests.
- Local HTTPS restored after test resource exhaustion. Certificates, hosts/proxy configuration and .dev.vars stay untracked.

## Scope details
Products links to the existing builder/catalog because the platform has no unified inventory API. Payments links to the existing payout settings. Reports use order creation dates and exclude test, refunded, partially refunded and disputed orders; displayed paid totals are before fees.
