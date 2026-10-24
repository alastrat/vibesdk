# Store analytics and sample data

Goal: replace the sparse Analytics page with a Whop-inspired dashboard backed by persisted orders and visx charts. Existing autonomous rollout authorization applies; user explicitly selected sample transactions.

Design: compact responsive cards, period selector (7/30/90 days), explicit live/test selector, previous-period comparisons, primary trend switching between sales/orders/average order, supporting trend cards, customer and fulfillment breakdowns, weekday activity and CSV export. Use only measurements supported by persisted orders. Avoid invented traffic, profit, MRR or lifetime/new-customer claims. Test records must be clearly identified and separated from live metrics. Kumo remains the control system. Home uses the same new visx renderer.

Approach: client aggregation over existing cursor-paginated owner-only API; fetch two reporting windows for an equal-length comparison. Preserve incomplete-fetch error behavior. Test-mode aggregation filters only test rows even though existing API fetches live+test. Query identity includes mode/window/account/store. Prior-period zero produces an unavailable comparison instead of infinity.

- [x] Persist idempotent local test transactions and items for the two authorized sample stores, synthetic example.test identities and no Stripe IDs.
- [x] Extend tested aggregation for totals, units, refunds/disputes, repeat-in-period customers, fulfillment and daily/weekday breakdowns.
- [x] Build responsive visx renderer with area/line/grid, date axes, keyboard/pointer tooltip and prior-period overlay.
- [x] Compose Kumo metric cards and comparisons, mode/date URL state, breakdown tables and safe CSV export.
- [x] Translate new copy to Spanish/Portuguese; run focused tests, typecheck/lint/build.
- [x] Compare actual populated local dashboard against Whop reference in browser, mobile and dark mode, then commit/push to current PR.

## Verification

- Typecheck and production build passed. Lint: 0 errors, 6 existing Fast Refresh warnings.
- New chart/aggregation/export Workers run: 19 tests passed. Final frontend regression in the single-worker Node harness: 87 tests across 10 files passed. A broader Workers run failed with local EADDRNOTAVAIL and is not counted as passing.
- Seeder: 7 tests passed, including every sample order ID round-tripping the actual pagination cursor.
- Local persisted data: 776 test orders and 1,451 line items over 180 days. Ownership, line totals, sample emails, and null Stripe identifiers verified. No real financial operations were created.
- Browser CSV export: 30 daily rows, matching North Ridge's $9,481 / 65 paid test orders. Live mode shows zero.
- Independent desktop/mobile/light/dark review verified hover and keyboard details, date/comparison changes, and store/mode isolation. Review fixes kept the summary visible on mobile, paired the reporting controls, removed currency from count-chart captions, and clarified unfulfilled-order semantics.

Visx 4 packages added; Kumo controls retained. Home shares the visx renderer. Reports describe current order status by creation date and repeat-within-period customers; traffic, profit and MRR are not inferred. The full standard Workers suite remains for CI.
