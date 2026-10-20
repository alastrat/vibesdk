# Billing test scenarios

Run before a release that touches billing, and before turning `BILLING` on in a new environment. Staging runs Stripe in test mode, so nothing here moves real money. Part one is a script that drives Stripe's test clocks; part two is what a person checks through the pages.

## Before you start

1. Staging's `STRIPE_PRICE_IDS` comes from `bun scripts/stripe-billing-setup.ts --mode test`, and the test key is staging's `STRIPE_SECRET_KEY`.
2. The platform webhook endpoint receives the billing events (the "Billing" steps in `docs/estori/launch-checklist.md`).
3. A staging account is set aside as the test account. It has no live subscription, and its id is in staging's `BILLING_USER_IDS` (or `BILLING=on`).
4. Your own admin session: copy the `Cookie` header of a signed-in admin request on staging from the browser's devtools. Never paste it, or the keys below, into chat or a commit.

## Part one: the Stripe scenarios

```bash
STRIPE_SECRET_KEY=sk_test_... \
ESTORI_BASE_URL=https://staging.estori.app \
ESTORI_ADMIN_COOKIE='<the Cookie header>' \
ESTORI_STAGING_KEY=<staging gate key> \
ESTORI_TEST_USER_ID=<the test account's user id> \
bun scripts/stripe-billing-scenarios.ts
```

- `--only 1,2` runs only those scenarios. One that needs a subscription, or Premium, sets it up first.
- A live key is refused. `ESTORI_STAGING_KEY` is only needed while staging is locked.
- The script makes a Stripe test clock with one customer and a Visa on it, links that customer to the test account through `PUT /api/admin/users/:userId/stripe-customer`, and ends any plan override on the account.
- After each step it waits for the webhook, then reads `GET /api/admin/users/:userId/billing` and checks the plan and credits.
- It prints `PASS n name`, `FAIL n name: reason` or `BY EYE n name: what to check`, and exits 1 on any failure.
- It ends by cancelling the subscription, so the account can be linked again, and deleting the test clock, which removes its customer.

| # | Scenario | The script does | Estori must show |
| --- | --- | --- | --- |
| 1 | Subscribe to Pro | Creates a subscription for the Pro price, tagged with the account | `plan: pro`, `status: active`, 20,000 credits |
| 2 | Renew a month later | Moves the clock past the period end | A new `periodStart`, `credits.used` 0 |
| 3 | Pro to Premium mid-period | Moves the clock to the middle of the period, then updates the item to Premium with `proration_behavior=always_invoice` and `payment_behavior=error_if_incomplete` | `plan: premium`, 100,000 credits |
| 4 | Premium to Pro at renewal | Creates the schedule as the app does; then moves the clock past the period end | `pendingPlan: pro` with Premium kept; then `plan: pro`, `pendingPlan: null` |
| 5 | Failed renewal, grace, new card | Sets the card that attaches and then declines (4000 0000 0000 0341) as default, moves past the renewal, then 8 more days; sets the Visa and pays the open invoice | `status: past_due` with the plan kept, no monthly credits, and `graceEndsAt` the period start plus 7 days; then `status: active` with the plan and its credits back |
| 6 | 3-D Secure at checkout | Prints a reminder | By eye: subscribe with 4000 0025 0000 3155 and complete the challenge |
| 7 | Cancel at the period end | `cancel_at_period_end=true` | `cancelAtPeriodEnd: true`, the plan kept |
| 8 | Resume before the end | `cancel_at_period_end=false` | `cancelAtPeriodEnd: false` |
| 9 | An expired checkout | Creates an extra-credits Checkout Session with the account's metadata, then expires it | No new purchase |
| 10 | Extra credits bought, then refunded | Moves the account to Premium, asks you to buy 5,000 credits on the billing page with 4242 4242 4242 4242, waits for the purchase, then refunds its payment in full | `purchasedLeft` up by 5,000; then back to what it was |

Notes:
- Test clocks move Stripe's time, not Estori's. Scenario 5 therefore checks the grace Estori works out from the failed renewal, and does not wait for the fall to Basic on day 8. That fall, and the plan returning when the invoice is paid, are covered on real SQL by `worker/services/billing/account.test.ts` and `worker/api/controllers/payments/webhook-billing.sql.test.ts`.
- Scenario 10 needs a person at a browser signed in as the test account. The script waits up to 5 minutes for the purchase.
- If a run stops half way, first cancel the subscription in Stripe's test dashboard (the webhook then updates Estori, and `GET /api/admin/users/:userId/billing` shows the account off its plan), and only then delete the test clock (Developers, Test clocks). Estori refuses to link a new customer to an account that still has a live subscription, and has no admin page for cancelling one.

## Part two: by eye

Do these on staging with Stripe test cards, signed in as the test account unless a step says otherwise. Staging's emails start with "[Staging]" and reach only addresses on its allowlist.

Buying and changing a plan:
- [ ] Signed out, open `/pricing` and choose Pro. Sign-up opens and, once done, the Pro checkout follows. Pay with 4242 4242 4242 4242: the billing page confirms the plan.
- [ ] From a limit dialog that offers Premium (for example credits used up on Pro), choose Premium and pay. The plan changes and the limit lifts.
- [ ] On the billing page, move Pro to Premium (charged now, credits grow), then Premium to Pro (scheduled for the renewal, Premium kept until then), then choose Premium again to drop the scheduled move.
- [ ] Cancel the plan: the page says it runs until the date and offers to keep it. Keep it.
- [ ] Manage billing opens Stripe's portal: card update, invoice history and cancel at the period end are there, and switching plan is not.
- [ ] Buy extra credits on Premium. The page shows them, and they are used after the month's credits.

Limits (each opens the Upgrade dialog with its own wording, and live stores keep serving):
- [ ] AI credits used up. The turn in progress finishes; the next one is refused.
- [ ] New stores in a day, and stores in the account's lifetime.
- [ ] A second live store on Basic.
- [ ] An own domain on Basic.
- [ ] A version adding a catalog product on Basic.
- [ ] Extra credits on Basic and Pro.

Banners:
- [ ] At 20% of credits left, then 5%: the banner shows, can be closed for the session, and returns at the next level. Use a small admin override such as `aiCredits: 200` to reach them quickly.
- [ ] A failed payment: the banner links to Manage billing and names the day the plan ends.

Emails, each with its "[Staging]" prefix and links that open the billing or pricing page:
- [ ] Plan started and the receipt for each payment.
- [ ] Plan changed (Premium now, and a move to Pro scheduled).
- [ ] Payment failed.
- [ ] Plan ending, and plan ended.
- [ ] Credits renewed.
- [ ] Credits at 20% and at 5% left.
- [ ] Extra credits receipt, and extra credits refunded.
- [ ] The notice before limits start: once per account, with the extra line for accounts over Basic. Set `BILLING_ENFORCEMENT_FROM` a week or less ahead on staging and wait for the hourly run.

Flag off:
- [ ] With `BILLING_USER_IDS` empty and `BILLING` unset, `/pricing` shows "coming soon" on Pro and Premium and today's daily allowance, and `/settings/billing` is not linked.
