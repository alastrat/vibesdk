# Recurring credit selector

User approved recurring monthly allowances, base credits as minimum, $1.50 per extra 1,000 credits and 20% off the whole annual subscription. Pro 30k costs $64/month or $614.40/year. Premium starts at 100k/$199. Basic stays at 5k/free. Remove descriptive allowance text from all cards.

Native implementation in existing worktree; preserve prior work. No live resources or deployments.

- [x] Shared price/credit validation and dropdown options; exact monthly/yearly arithmetic tests.
- [x] Reuse or create server-priced Stripe recurring prices for selected allowance, tagged with plan/interval/monthly credits and associated with configured plan product. Stable lookup/idempotency keys. Never accept a client price. Base prices remain backwards compatible.
- [x] Store current/pending selected allowance from validated Stripe price metadata in migration 0036; resolve actual monthly credit limits and emails from paid allowance. Monthly renewal behavior stays unchanged for annual subscriptions.
- [x] Propagate allowance through pricing, signup, checkout/retries/consent and plan changes. Keep custom allowance when ordinary upgrade links omit it. Explicit decreases/cadence changes wait for renewal; same-cadence increases can prorate immediately with confirmation.
- [x] Kumo dropdowns on Pro/Premium, live prices and comparison; Basic fixed. Focused tests, root typecheck/lint/build, independent review and browser screenshot.

Review focus: client tampering, unknown/mismatched Stripe metadata, replayed checkout for another allowance, lost selection through auth/recovery, monthly credits vs annual price, scheduled change reconstruction, downgrade/upgrade entitlement timing, same-plan allowance-only changes.


Verification: 434 focused tests passed across pricing, checkout recovery, billing confirmation/locales, real D1 allowance resets, Stripe client/API checkout, subscription events and legal documents. Root typecheck and build passed; lint has zero errors and six existing Fast Refresh warnings. `git diff --check` is clean. Tests ran in small sequential Workers batches to avoid the local runtime port exhaustion seen on the full suite.

Independent review found two issues, both covered by failing regressions before fixes: refuse unsynced Stripe allowance/pending changes before a second mutation, and bind custom price lookup/reuse to the configured Stripe product. Reviews and regressions are complete.

Browser: checked only the two paid selectors, Pro 30k at $64/month or $614.40/year, Premium 200k at $349/month or $3,350.40/year, synchronized comparison values, sign-up navigation and narrow/mobile layout with no page overflow. Basic remains 5k/free. Temporary viewport override reset. Preview screenshot: `/tmp/estori-recurring-credit-pricing.png`.

Rollout: migration `0036_recurring_credit_allowances.sql` applied to local preview D1 only. Production requires this migration (and prior annual migration 0035) plus configured monthly/yearly Stripe base prices before deployment. Additional allowance prices are created/reused on their configured plan product by the server. No live Stripe resources, purchases or production deployment were performed.


Update: yearly prices now round the discounted monthly rate down to whole US dollars before multiplying by twelve. Base Pro is $39/month billed $468/year; Premium is $159/month billed $1,908/year. Pro 30k is $51/month billed $612/year; Premium 200k is $279/month billed $3,348/year. This supersedes the exact-cent examples above. Monthly prices and monthly credit resets are unchanged. Apply the same Stripe setup workflow to create/reuse the new annual prices and refresh annual price IDs before deploying; no live Stripe prices were changed here.
