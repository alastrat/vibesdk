# Analytics Filter Bar Implementation Plan

> Execute in the current worktree under the user's ongoing autonomous authorization.

**Goal:** Replace the analytics heading and explanatory text with the compact Whop-style filter row supplied by the user.
**Architecture:** Kumo toolbar manages URL-backed period/date, product, store, data mode, comparison and widget visibility. Existing order aggregation filters orders containing the selected product; traffic remains store-wide because no product attribution is collected. Extend the existing traffic endpoint to honor the same dates and product-scoped checkout/refund counts. Preserve owner/mode isolation.
**Tech Stack:** React, Kumo, TanStack Query, existing visx charts, Worker/D1.
**Spec:** User's two screenshots and request. Store picker switches owned stores instead of inventing a multi-website aggregate. Reporting uses UTC, explicitly shown in a clock popover.

## Constraints and review focus
- No production deployment or new database schema required.
- Invalid/future/reversed dates must not create invalid reports; custom ranges are at most90days.
- Product IDs are exact and owner-scoped; mixed orders count once as orders containing the product, not attributed product revenue.
- Date/product changes separate cache entries. Store changes clear product selection.
- Test mode remains visible as a compact control. Other store sections keep their headings.
- Mobile controls wrap, keyboard/popovers work, English/Spanish/Portuguese remain complete.

## Tasks
- [x] Add validated date-range helpers and regression cases for Today, Yesterday, custom dates and invalid input.
- [x] Include product identifiers/names in owner order rows; filter orders containing an exact selected product.
- [x] Extend traffic query/API/controller/service with throughDay and productId; verify date boundaries, mode/owner isolation and checkout/refund filtering.
- [x] Add compact period/date/product/store/mode/clock/Customize controls and functional widget/comparison/export actions. Remove redundant analytics heading/copy.
- [x] Verify focused tests, typecheck, lint/build and desktop/mobile browser behavior. Review actual layout and record proof before commit/push.

## Verification ledger
- Date helpers: initial missing-module failure, then 3/3 passed.
- Real D1 SQL: 22/22 passed, including product IDs, mixed orders, owner/mode isolation and inclusive historical UTC boundaries.
- Frontend/chart/report/i18n: 70/70 passed. Root typecheck passed.
- Browser: Yesterday updated orders and traffic; custom dates rejected reversed input and accepted Oct 22–23; selecting House blend changed orders while preserving store-wide visits.

## Final review
- Important: historical checkout age cutoff used the report end; regression reproduced 1 instead of 2 abandoned checkouts. Fix uses current age with unchanged reporting bounds.
- Important: product options omitted published products without orders; regression reproduced missing New coffee and stale product name. Merge published owner collection with historical order products.
- Accessibility finding regraded Important: screen-reader users need the exact selected range to interpret their report. Regression reproduced the missing dates in the control's accessible name; include them.
- Review scope: product-attributed traffic/revenue and selectable timezones are explicitly excluded; the toolbar describes whole-order scope, visits remain store-wide, and UTC is visible in the clock popover. No fabricated attribution or alternate timezone reports.
- Review scope: unrelated historical commits and local .superpowers resources remain untouched. Parent performs actual browser desktop/mobile and keyboard checks.

## Final verification
- Final: fixed late-night historical abandonment — real D1 historical UTC/product regression RED→GREEN; Workers suite 22/22.
- Final: fixed zero-order published product options — merged current/historical product regression RED→GREEN; frontend/chart/report/i18n suite 72/72.
- Final: fixed date accessible name — rendered control regression RED→GREEN; included in 72/72.
- Typecheck/build passed; lint 0 errors, 6 pre-existing Fast Refresh warnings. No new dependencies or migrations.
- Browser: store switching retained dates and cleared product, Customize removed overview and comparison, Reset restored both, CSV downloaded with the selected store/period totals, UTC popover worked, custom dates were keyboard editable with invalid-range feedback.
- Responsive: 390px toolbar scrollWidth equals clientWidth (292px), controls wrap without page overflow. Date label truncates visually while its accessible name includes the complete range. Viewport override reset.
- Fresh page load shows no visible page title or large test banner. Test mode remains explicit in the compact control.
- Proof: analytics-filters-final.png and analytics-filters-mobile.png in the workspace-rollout visualization directory. Existing PR #35 receives this change; no deployment.
