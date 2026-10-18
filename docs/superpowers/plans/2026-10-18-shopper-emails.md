# Shopper Emails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Estori emails shoppers on order confirmation, shipment and refund. Each store's seller edits or turns off each email, previews it, sends themselves a test, and sees what was sent, from an Emails page in the main menu.

**Architecture:**
- **Data:** templates and settings live in D1 per store. A D1 outbox table (`shopper_emails`) makes each event send once, with backoff retries on the existing 15-minute cron.
- **Rendering:** a pure engine renders plain-text templates with escaped placeholders around fixed transactional blocks.
- **Sending:** the existing Email Service binding, extended with a sender name, Reply-To and headers. Test-mode orders go to the seller.
- **Hooks:** order recording, seller shipment, catalog shipment, seller refund and Estori catalog refund.
- **UI:** an `/emails` page with a template editor and a sandboxed preview.

**Tech Stack:** Cloudflare Workers, Email Service (`send_email`), D1 (Drizzle), KV, Cron Triggers, React 19, TanStack Query 5, Vitest (workers pool).

**Spec:** `docs/superpowers/specs/2026-10-18-shopper-emails-design.md`

## Global Constraints

- **Transactional only:** no marketing features. Cloudflare's FAQ says "Email Service supports transactional email only."
- **Event kinds:** `order_confirmation`, `order_shipped` and `refund_issued`. Event keys: `order`; `own` or `catalog:{supplierOrderId}`; the refund `requestId` or `catalog:{refundId}`.
- **Template limits:** subject 1–150, heading 1–120, body 0–2,000 characters.
- **Placeholders:** `{{name}}`, with spaces allowed.
  - Common: `store_name`, `customer_name`, `customer_first_name`, `order_number` and `order_total`.
  - Shipped adds `carrier` and `tracking_number`; refund adds `refund_amount`.
- **From and Reply-To:**
  - From is `{ email: env.SHOPPER_EMAIL_FROM || EMAIL_FROM.email, name: <store name, cleaned, at most 60 characters> }`.
  - Reply-To is the store's setting, or else the seller's account email.
  - Headers are `X-Estori-Store` and `X-Estori-Email`.
- **Test-mode orders:** they go to the seller's account email, with the subject prefix `[Test] `.
- **Caps and limits:**
  - 1,000 shopper emails per store per UTC day, then status `capped`;
  - test sends: 10 per seller per hour (KV);
  - backoff: 15 min, 1 h, 4 h, 12 h; failed after attempt 5;
  - rows are kept 90 days.
- **Routes:**
  - the store routes are `AuthConfig.ownerOnly` on `/api/stores/:id/...`;
  - the store list is `GET /api/emails/stores`, `authenticated`;
  - the page lives at `/emails`.
- **Emails never break the operation that triggered them:** the producers never throw.
- **Code and copy:** no `any`, no emojis, and no supplier or AI-assistant names in shopper or seller copy.
- **Commits:** subjects lowercase after the type prefix, with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `wrangler.jsonc`, `.dev.vars`, `bun.lockb`;
  - `.superpowers/`, `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx`;
  - `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.

## Review Focus

- A refund that fires twice: Stripe's webhook and the seller's request may both report it. The `(order_id, kind, event_key)` uniqueness must hold, and one email go out. Pinned in Task 4 (outbox).
- A shopper with no email on the order (`customer_email` null): the row becomes `failed` with a readable error. No crash, and no endless retry. Pinned in Task 4.
- A seller who saves `{{ tracking_number }}` in an order confirmation is refused, and the message names the placeholder and the event. Pinned in Task 2.
- A subject with a line break, which could inject headers: it is refused on save, and stripped at send. Pinned in Task 2.
- Two cron runs, or the cron and an immediate send, racing on one row send once: the claim has to be atomic. Pinned in Task 4 (real SQL).

---

### Task 1: Data model, shared types and the email service

**Files:**
- Create: `shared/types/shopper-emails.ts`
- Modify: `worker/database/schema.ts` (three tables), generating `migrations/0028_shopper_emails.sql` and its snapshot
- Create: `worker/database/services/ShopperEmailService.ts` and export it from `worker/database/index.ts`
- Test: `worker/database/services/shopper-emails.sql.test.ts`

**Interfaces:**
- **Produces (shared):**
  - `SHOPPER_EMAIL_KINDS`, `ShopperEmailKind`, `isShopperEmailKind`, `SHOPPER_EMAIL_LABELS`;
  - `SHOPPER_EMAIL_PLACEHOLDERS`, `SHOPPER_EMAIL_LIMITS`, `ShopperEmailTemplateFields`, `ShopperEmailTemplate`, `DEFAULT_SHOPPER_EMAIL_TEMPLATES`;
  - `ShopperEmailTemplateView`, `SHOPPER_EMAIL_STATUSES`, `ShopperEmailStatus`, `RecentShopperEmail`, `ShopperEmailsData`;
  - `ShopperEmailStoreOption`, `ShopperEmailPreview`, `SHOPPER_EMAILS_PATH = '/emails'`.
- **Produces (service):**
  - `ShopperEmailService` with `templates(appId)`, `saveTemplate(appId, kind, template, now)`, `resetTemplate(appId, kind)`, `replyTo(appId)` and `saveReplyTo(appId, replyTo, now)`;
  - `enqueue(row): Promise<boolean>`, `claim(id, now, leaseUntil): Promise<ShopperEmailRow | null>`, `finish(id, update)` and `release(id, error)`;
  - `due(now, limit)`, `sentSince(appId, since): Promise<number>`, `recent(appId, limit)`, `prune(before)`;
  - `storesOf(userId)` and `orderIdForSession(sessionId)`.

- [ ] **Step 1: Write the failing real-SQL tests** (`shopper-emails.sql.test.ts`). They cover:
  - saving and resetting a template, with unsaved kinds reported as defaults;
  - the reply-to setting;
  - `enqueue` ignoring a repeated `(order_id, kind, event_key)` and answering `false`;
  - `claim` taking a due `queued` row once (a second claim gets `null`) and pushing `next_attempt_at` to the lease time;
  - `finish` writing the status, message id and `sent_at`;
  - `sentSince` counting only today's sent rows of that store;
  - `recent` newest first, with the order number joined;
  - `prune` removing old rows;
  - `storesOf` listing the user's apps that have a live store or an order;
  - `orderIdForSession`.

  Test setup:
  - `insertUser`, `insertApp`;
  - a `store_orders` row inserted directly (as in `seller-orders.sql.test.ts`);
  - a `live_stores` row: `INSERT INTO live_stores (app_id, slug, status, published_commit, published_at, created_at, updated_at) VALUES (...)`.

  The full test code is written in the session.
- [ ] **Step 2:** Run `rtk proxy bunx vitest run worker/database/services/shopper-emails.sql.test.ts`. Expected: FAIL, because the module and tables are missing.
- [ ] **Step 3: Implement**
  - The shared types file, with the values from Global Constraints. The default templates:
    - **Confirmation:** subject `Your {{store_name}} order #{{order_number}}`; heading `Thanks for your order, {{customer_first_name}}`; body "We've received your order and we're getting it ready. We'll email you again when it ships."
    - **Shipped:** subject `Your {{store_name}} order #{{order_number}} is on its way`; heading `Your order is on its way`; body "Good news, {{customer_first_name}}: part or all of your order has shipped. Follow it with the tracking details below."
    - **Refund:** subject `A refund for your {{store_name}} order #{{order_number}}`; heading `We've refunded {{refund_amount}}`; body "We refunded {{refund_amount}} to the card you paid with. Banks usually show it within 5 to 10 business days."
  - Schema tables per spec section 7, using `integer(..., { mode: 'boolean' })` for `enabled` and `test`, and `timestamp` mode for the times. Then run `bun run db:generate -- --name shopper_emails`.
  - The service methods, with:
    - `enqueue`: `insert ... onConflictDoNothing()`, answering whether a row was written (through `.returning({ id })`);
    - `claim`: `update ... set attempts = attempts + 1, next_attempt_at = leaseUntil where id = ? and status = 'queued' and next_attempt_at <= now returning *`;
    - `storesOf`: a `select distinct` of apps of the user, where `exists` a `live_stores` row or `exists` a `store_orders` row.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(emails): shopper email templates, settings and an outbox in D1, with Estori's default for each order event`.

### Task 2: The template engine

**Files:**
- Create: `worker/services/shopper-emails/template.ts` and `template.test.ts`

**Interfaces:**
- Produces:
  - `templateProblem(kind, fields): string | null`;
  - `fillPlaceholders(text, values): string`;
  - `renderShopperEmail(template: ShopperEmailTemplateFields, content: ShopperEmailContent): { subject: string; html: string; text: string }`;
  - `ShopperEmailContent`;
  - `maskEmail(email): string`;
  - `trackingUrl(carrier, number): string | null`;
  - `sampleContent(kind, storeName): ShopperEmailContent`.

- [ ] **Step 1: Write the failing tests:**
  - **Problems:** an empty subject; over-long fields; a line break in the subject; an unknown placeholder (the message names it and lists the allowed ones); a placeholder from another event (`{{tracking_number}}` in a confirmation); `{{ order_number }}` with spaces accepted.
  - **Rendering:**
    - values are escaped (a `<b>` name);
    - a blank line makes `<p>`s;
    - the confirmation block lists items and the total; the shipped block shows the carrier, tracking and a USPS link; the refund block shows the amount;
    - the footer names the store and the order;
    - the text version contains the same facts;
    - "Visit {store}" shows only with a store URL;
    - a test note masks the shopper;
    - the subject is cleaned of line breaks.
  - **Masking:** `ana@example.com` becomes `a***@example.com`.
  - **Tracking URLs:** the four carriers get links, and others get null.
- [ ] **Step 2:** Run the tests. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement**
  - Placeholders are matched with `/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g`.
  - A stray `{{` with no matching `}}` is a problem.
  - Values come from the content: `customer_first_name` is the first word of the name, or "there"; `order_total` and `refund_amount` are formatted in dollars.
  - The HTML uses inline styles, as `renderEmail` does, and is written in the session.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(emails): shopper emails render a seller's text with escaped placeholders around the order's fixed details`.

### Task 3: The sender carries a name, Reply-To and headers, and its errors are classified

**Files:**
- Modify: `worker/services/email/types.ts`, `worker/services/email/sender.ts` and `sender.test.ts`
- Create: `worker/services/email/send-errors.ts` and `send-errors.test.ts`

**Interfaces:**
- Produces:
  - `OutgoingEmail` gains the optional fields `fromEmail`, `fromName`, `replyTo` and `headers`;
  - `classifySendError(error: unknown): 'retry' | 'suppressed' | 'failed'`.

- [ ] **Step 1: Write the failing tests:**
  - the Cloudflare sender passes `from: { email, name }` from the email, or `EMAIL_FROM`, along with `replyTo` and `headers`;
  - classification:
    - `E_RECIPIENT_SUPPRESSED` is `suppressed`;
    - `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, `E_DELIVERY_FAILED`, `E_INTERNAL_SERVER_ERROR` and errors without a code are `retry`;
    - `E_VALIDATION_ERROR` and `E_SENDER_NOT_VERIFIED` are `failed`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(email): emails can carry a sender name, a reply-to address and headers, and send failures are sorted into retry, suppressed or failed`.

### Task 4: The outbox and its schedule

**Files:**
- Create: `worker/services/shopper-emails/outbox.ts`, `outbox.test.ts` and `wiring.ts`
- Modify: `worker/services/alerts/platform-alerts.ts` (adds `shopper-email-failed` and `shopper-email-capped`)
- Modify: `worker/index.ts` (scheduled)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `ShopperEmailEvent` = `{ orderId; kind; eventKey; payload: ShopperEmailPayload }`, where `ShopperEmailPayload` = `{ lineNos?; catalogVariantIds?; carrier?; trackingNumber?; amountCents? }`;
  - `queueShopperEmail(deps, event): Promise<void>`, which never throws;
  - `sendShopperEmail(deps, id): Promise<ShopperEmailStatus | 'skipped'>`;
  - `shopperEmailQueueFromEnv(env): (event) => Promise<void>`;
  - `runShopperEmailSchedule(cron, env)`.

- [ ] **Step 1: Write the failing tests**, with fakes for the deps and an in-memory store:
  - an event sends once, and repeating it sends nothing;
  - a live order goes to the shopper, with from name, Reply-To (the setting, else the seller) and headers;
  - a test order goes to the seller, with `[Test]`;
  - a disabled template gives `disabled`;
  - the daily cap gives `capped`, with an alert;
  - a suppressed recipient gives `suppressed`;
  - a retryable error stays `queued` with the next attempt per the backoff, and turns `failed` with an alert on attempt 5;
  - a missing shopper email gives `failed` with "The order has no email address";
  - a shipped event with catalog variant ids shows only those items;
  - the producer swallows a store error;
  - the schedule sends due rows on `*/15` and prunes on `35 6`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement per spec sections 6 and 8. In `worker/index.ts`, `scheduled` gains `ctx.waitUntil(runShopperEmailSchedule(controller.cron, env));`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(emails): an outbox sends each shopper email once, retries what Cloudflare defers, and caps each store per day`.

### Task 5: Hooks on order events

**Files:**
- Modify:
  - `worker/services/store-payments/fulfill.ts`, `fulfill.test.ts` and `wiring.ts` (confirmation);
  - `worker/api/controllers/sellerOrders/controller.ts` and `controller.sql.test.ts` (own shipment);
  - `worker/services/catalog/runner.ts`, `runner.test.ts` and `CatalogOrderRunner.ts` (catalog shipment);
  - `worker/api/controllers/stores/controller.ts` (seller refund);
  - `worker/services/catalog/refund-records.ts` (Estori refund);
  - `worker/database/services/StoreOrderService.ts` (`orderIdForPaymentIntent` if needed).

**Interfaces:**
- **Consumes:** `shopperEmailQueueFromEnv(env)` (Task 4).
- **Produces:**
  - `RecordStoreOrderDeps.queueShopperEmail(event)`;
  - `RunnerDeps.notifyShipped(event: { paymentIntentId: string; supplierOrderId: string; trackingNumber: string; carrier: string; catalogVariantIds: string[] })`.

- [ ] **Step 1: Write the failing tests:**
  - `recordStoreOrder` queues one confirmation on `recorded` only;
  - the shipment endpoint queues `order_shipped` with key `own` and the own unrefunded lines when shipped, and not on an undo;
  - the runner calls `notifyShipped` once when items first ship, and not again on a carrier reissue;
  - the catalog refund records queue `refund_issued` for non-seller reasons only.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the hooks. Each calls the never-throwing queue.
- [ ] **Step 4:** Run `rtk proxy bunx vitest run worker/services/store-payments worker/services/catalog worker/api/controllers/sellerOrders worker/api/controllers/stores`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(emails): shoppers get an email when they order, when the seller or Estori ships, and when they're refunded`.

### Task 6: The emails API

**Files:**
- Create: `worker/api/controllers/shopperEmails/controller.ts`, `template-request.ts`, `controller.sql.test.ts` and `routes-wiring.test.ts`
- Create: `worker/api/routes/shopperEmailRoutes.ts`
- Modify: `worker/api/routes/index.ts`

- [ ] **Step 1: Write the failing tests:**
  - **List and read:** listing the seller's stores; reading a store's templates with defaults, placeholders, the reply-to setting and recent emails (masked).
  - **Save and reset:** saving a template, with a 400 naming a bad placeholder; resetting a template.
  - **Reply-to:** saving it, with a 400 for an invalid email.
  - **Preview:** an unsaved template renders with sample data.
  - **Test send:** it goes to the seller with `[Test]`, and the 11th in an hour gets 429.
  - **Routes:** all store routes are `ownerOnly`, and the store list is `authenticated`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement per spec section 9.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(emails): sellers read, edit, reset, preview and test their stores' shopper emails through the API`.

### Task 7: The Emails page and the main-menu item

**Files:**
- Modify: `src/api-types.ts`, `src/lib/api-client.ts`, `src/lib/query-keys.ts`, `src/routes.tsx` and `src/components/layout/app-sidebar.tsx`
- Create:
  - `src/hooks/use-shopper-emails.ts`;
  - `src/routes/emails/emails.tsx`, `template-editor.tsx` and `emails-guard.test.ts`;
  - `src/routes/emails/email-format.ts` and `email-format.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **Guards:**
    - the sidebar item (folded and open) navigates to `SHOPPER_EMAILS_PATH`, and the route sits inside `ProtectedRoute`;
    - the page lists every kind with a switch and an Edit button;
    - the editor's preview `iframe` has `sandbox=""` and `srcDoc`;
    - the placeholder chips come from the data;
    - reset asks first;
    - "Replies go to" is on the page;
    - the transactional-only note is on the page;
    - no supplier or AI-assistant names.
  - **Format:** status labels, and the "Edited" or "Estori's default" label.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement per spec section 10, built like `src/routes/orders/orders.tsx` and `order.tsx`.
- [ ] **Step 4:** Run `rtk proxy bunx vitest run src/routes/emails` and `bun run typecheck`. Expected: PASS, with 0 errors.
- [ ] **Step 5: Commit** `feat(emails): an Emails page in the main menu edits, previews and tests each shopper email, and lists what was sent`.

### Task 8: Check it end to end, then the CI steps and the PR

- [ ] **Step 1:** Apply 0028 locally (`CI=true npx wrangler d1 migrations apply vibesdk-db --local`).
- [ ] **Step 2: By eye as the creator:**
  - the sidebar item;
  - the store picker;
  - edit the confirmation, with a live preview;
  - a bad placeholder gives its error;
  - send a test, and check the dev log for "Email not sent (dev log)" with the subject;
  - toggle the shipped email off and on;
  - mark a test order shipped, and see the log row (to the seller, `[Test]`) in Recent emails.
- [ ] **Step 3:** Run the CI steps: lint, typecheck, build, bundle check and the sharded suite.
- [ ] **Step 4:** Push `feat/shopper-emails` and open a PR into `main`, stacked on the seller orders PR.
