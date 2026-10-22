# Premium commerce controls implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Find orders faster and enforce Premium-only custom shopper wording/reply-to, manual shipment tracking and seller refund controls, as approved by the user.

**Architecture:** Extend shared plan booleans with shipmentTracking and orderRefunds; customShopperEmails becomes Premium-only. Existing billing-disabled/admin override behavior stays authoritative. Gate both seller refund routes through the common helper, gate carrier/tracking writes before mutation, and keep marking shipped available on all plans. Supplier fulfillment and historical records remain readable. Shopper email sending rechecks customization at send time so downgrades use defaults and the seller reply address; automatic emails, store sender addresses and preview/test sends stay on Pro. UI and comparison derive from shared limits.

**Tech Stack:** Bun, shared TypeScript entitlements, Hono controllers, D1 tests, React, Kumo, TanStack Query.

- [x] Shared entitlements and refusal/override validation: update plans.ts and meaningful unit assertions for Basic/Pro/Premium, upgrades and overrides. No schema migration.
- [x] Seller order API: guard manual carrier/tracking writes; guard seller/store refund paths before Stripe; real D1 regressions for denied writes, ordinary fulfillment, Premium and billing disabled.
- [x] Shopper email API/outbox: save/reset/reply-to Premium, preview/test Pro, downgrade defaults on scheduled sends; API and outbox regressions.
- [x] Frontend: lock premium shipment/refund/customization controls with Premium upgrade actions; preserve read-only email preview/test UI on Pro; revise translated messages and catalogs.
- [x] Marketing: remove filterOrders, move four benefits to Premium; preview/test remains Pro; update plan cards and plain tooltips; dashes below included rows.
- [x] Verify focused suites, typecheck/lint/build, independent review, browser preview. No production mutations, commits or deployment.


## Verification

- 152 focused tests passed across shared plans, pricing, translated catalogs, upgrade routing, real-D1 order/email controllers and the shopper-email outbox.
- Root typecheck and build passed. Root lint passed with six existing Fast Refresh warnings; no errors.
- Independent review findings were fixed and re-reviewed: Basic preview entitlement, reply-address remount after entitlement changes, and tracking ownership checks before upgrade responses.
- Integrated-browser comparison verified all four benefits as Premium-only; Find orders faster is absent. Saved previews: `/tmp/estori-premium-order-benefits.png`, `/tmp/estori-premium-email-benefits.png`.
- No production changes, commits or deployments.
