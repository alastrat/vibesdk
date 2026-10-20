# First launch checklist

Run after the first successful deploy and smoke test.

1. Private window → `https://estori.app` → Access asks for an email. A non-invited email gets no PIN or is refused. An invited email receives a PIN and gets through.
2. `curl -sI https://estori.app/api/health` (no credentials) → a 302 to `*.cloudflareaccess.com`, never `200`.
3. Sign up with email and password.
4. Create an app ("Create a habit tracker"). The agent streams; the preview loads from `https://preview.estori.app/space/...`.
5. Repo tab shows at least one commit (Artifacts).
6. Ask "Who are you?" → the answer names Estori.
7. While signed in, trigger a redeploy: re-run the last deploy run (`gh run rerun <run id> --repo alastrat/vibesdk`, or Re-run all jobs on its page) and approve it. Reload the app: still signed in.
8. Devtools on `estori.app` → Application → Cookies: `CF_Authorization` and `accessToken` have no `Domain` attribute covering subdomains, and requests to `preview.estori.app` (Network tab) carry neither cookie.
9. No Deploy button in the chat header.

## Billing

Owner steps before plans, credits and limits turn on (spec: `docs/superpowers/specs/2026-10-19-billing-subscriptions-design.md`, section 14, and `docs/superpowers/specs/2026-10-20-billing-native-checkout-design.md`). Do the Stripe steps in test mode first, for staging and for production's test keys, and repeat them in live mode on launch day. Menu names follow the Stripe Dashboard as of October 2026 and may have moved. Billing stays off until `BILLING` or `BILLING_USER_IDS` is set.

Sellers pay and change their card on Estori's own pages, and Estori records their agreement to the renewal terms itself. So billing needs no Billing Portal configuration and no Terms of Service URL in Stripe: nothing in Estori asks Stripe to collect that agreement. Leave any portal configuration or Terms URL already in the account as it is; billing doesn't read them.

1. **Prices.** With the environment's own key, run `STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-billing-setup.ts --mode test` (live mode: `sk_live_...` and `--mode live`, on launch day). It reuses prices that exist and prints `STRIPE_PRICE_IDS={"pro":"price_...","premium":"price_...","credits":"price_..."}`. Set that value as a Worker variable in each environment, in the same mode as that environment's `STRIPE_SECRET_KEY`.
2. **Publishable key**, on both Workers, production and staging. Set `STRIPE_PUBLISHABLE_KEY` to the publishable key (`pk_test_...`; `pk_live_...` on launch day) of the same Stripe mode as that Worker's `STRIPE_SECRET_KEY`. It is a plain variable, set the way `STRIPE_PRICE_IDS` is, not a secret: the key is public by design, and Stripe.js needs it in the browser. Estori's store checkout page reads the same variable. Without it, checkout and the card form answer "Payments aren't set up yet.", so no seller can buy a plan or credits or change their card.
3. **Smart Retries**, in each mode (Settings, Billing, Subscriptions and emails, failed payments):
   - Smart Retries on, with a schedule of up to 2 weeks.
   - If all retries fail: cancel the subscription (leaving it past due also works). Estori keeps a failing plan for 7 days, then runs the account as Basic while Stripe keeps retrying; when Stripe gives up, the cancelled subscription ends the plan and the seller is told.
   - Check that this setting does not read "mark the subscription as unpaid", in each mode. Estori doesn't count an unpaid subscription as a live plan, so "Pay now" can't reach its open invoice and answers "You don't have Pro or Premium.", and the seller can't pay it from the billing page.
4. **Stripe's own emails off**, in each mode (Settings, Customer emails and Billing, Subscriptions and emails): successful payments (already off), invoices and failed payments. Estori sends all of them, from Estori.
5. **Webhook events**, on the platform endpoint `/api/stripe/webhook` in each environment: test, live and staging. The endpoint and its signing secret stay as they are; add `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `subscription_schedule.created`, `subscription_schedule.updated`, `subscription_schedule.released`, `subscription_schedule.canceled` and `charge.refunded`. `checkout.session.completed` is already there. Without `invoice.payment_action_required`, a seller whose bank asks them to confirm a renewal gets the "card was declined" email instead of the one that sends them to "Pay now".
6. **Your own account on Enterprise**, before `BILLING=on`, since the KV override that lifts your limits today stops applying then. Send it from a signed-in admin session (your own `Cookie` header, which on `estori.app` includes the Access cookie):

```bash
curl -X PUT https://estori.app/api/admin/users/<your user id>/plan \
  -H 'Content-Type: application/json' -H 'Cookie: <your Cookie header>' \
  -d '{"plan":"enterprise","reason":"Owner account"}'
```

7. **Gemini prices.** Confirm Flash's output price (fitted at about $3.75 per 1M tokens) and its input price after the promotion ends on 2026-12-31 against the table in `worker/agents/think/model-config.ts`, which sets what a credit costs.
8. **Sales tax.** Decide whether to register and turn Stripe Tax on. It stays off at launch and invoices show no tax.
9. **Terms review.** A lawyer reviews the new Terms and refund policy (`src/content/legal/terms.md`, `refunds.md`) and the renewal wording at checkout, since automatic-renewal laws differ by state. Do this before `BILLING=on` for everyone.
10. **The notice before limits start.** Approve the email's wording (`enforcementNoticeEmail` in `worker/services/email/billing-templates.ts`). Then set `BILLING_ENFORCEMENT_FROM` to the day limits start, as `YYYY-MM-DD`, a week before you turn `BILLING=on`. The hourly run emails every account that can be emailed (not deleted, active, not suspended, with a verified email) once, up to 100 an hour, until that day, whatever `BILLING` says. Turn `BILLING=on` on that day. Founding sellers can be given a plan override before then.
11. **Order.** Run `docs/estori/billing-test-scenarios.md` on staging. Then production in test mode for your own account only (`BILLING_USER_IDS`). Then live mode on launch day: live prices, retries, emails and webhook events, and `STRIPE_PRICE_IDS` and `STRIPE_PUBLISHABLE_KEY` for the live key.
