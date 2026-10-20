# PostHog dashboards and alerts

The dashboards and alerts are built by hand in PostHog's UI once events flow in production. This file is the build sheet.

- **Project:** "Estori production" (id 675096), `https://us.posthog.com/project/675096`.
- **Internal users:** turn on "Filter out internal and test users" in every insight. It leaves out localhost, 127.0.0.1 and staging.estori.app.

## Dashboards

1. **Activation:** a funnel with a 30-day window:
   1. `account_created`;
   2. `build_started` where `first_build = true`;
   3. `store_published` where `first_publish = true`;
   4. `payments_ready`;
   5. `sale_completed` where `first_sale = true`.
2. **Retention:** weekly. The start event is `account_created`; the return event is `build_started`.
3. **AI cost per day:**
   - the sum of `credits_used` on `build_finished`, by day, broken down by `model`;
   - Estori's cost in dollars, as a formula on that sum: credits ÷ 1.5 × $0.001;
   - no gateway filter: every Think build runs on Estori's gateway, so every credit is Estori's cost;
   - opted-out builds show under the model "none", since they carry only their credits.
4. **Errors:** `$exception` count by day, broken down by `component` (Worker) and by exception type. It links to PostHog's error tracking.
5. **Revenue:** from the Stripe data warehouse source:
   - gross store sales by day;
   - Estori's application fees by day;
   - template sales;
   - subscriptions by plan, and extra credits bought.
6. **Billing,** weekly:
   - `subscription_started` by `plan`;
   - `subscription_changed` by `direction`;
   - `subscription_cancelled` by `reason`;
   - `subscription_payment_failed`;
   - `credits_purchased`, count and sum of `amount_cents`;
   - `credits_low` by `threshold`;
   - `credits_limit_reached` by `plan`.
7. **Health:** `heartbeat` count per hour, and the count where `healthy = false`.
8. **Web:** PostHog's built-in web analytics for estori.app, with web vitals. Cloudflare Web Analytics stays in Cloudflare's dashboard.

## Alerts

PostHog insight alerts, emailed to the owner's email address unless the owner names others.

| Alert | Insight | Condition | Checked |
| --- | --- | --- | --- |
| Heartbeat missing | `heartbeat` count, hourly | less than 2 | hourly |
| Health check failing | `heartbeat` where `healthy = false`, hourly | more than 0 | hourly |
| Error spike | `$exception` count, hourly | more than 25 | hourly |
| No signups | `account_created` count, daily | less than 1 | daily, turned on at public launch |
| AI cost over budget | sum of `credits_used` on `build_finished`, daily, every build including opted-out ones | more than 150,000 credits, about $100 of Estori's cost, until two weeks of data exist | daily |

- **"Heartbeat missing"** fires when the Worker, its cron or PostHog stops.
- **"Health check failing"** fires when the Worker runs but something inside is down.

## AI cost

Billing charges every step from its real token cost: list-price cost × 1.5, in credits of $0.001. Estori's own cost is therefore credits ÷ 1.5 × $0.001, so the budget of 150,000 credits a day is about $100.

Source: docs/superpowers/specs/2026-10-19-posthog-analytics-monitoring-flags-design.md, section 8. Change both together.
