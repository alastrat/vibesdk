# Shopper emails: per-store templates for each order event, sent on Cloudflare

To be built on `feat/shopper-emails`, cut from `feat/seller-orders`. It needs Mark shipped and the order data from that branch.

## 1. Purpose and the owner's request

The owner, 2026-10-18: "add a email marketing feature so that users can adjust the message and sending of these emails to their shoppers. Rely on cloudflare services entirely so determine capacity and capabilities based on that. The idea is that users have their emails templates for each kind of action they might have … add an option on the main menu too."

Today shoppers get no email from Estori. This spec covers four things:
1. Estori emails shoppers on each order event.
2. Each store has a template per event that the seller can edit or turn off.
3. The seller can preview a template and send a test.
4. A main-menu item, **Emails**, holds all of it.

## 2. What Cloudflare allows, and what that rules out

Everything runs on Cloudflare: Email Service (Email Sending through the `send_email` binding), D1, Workers, Cron Triggers and KV. The facts below are from the Email Service docs as of 2026-10-18.

| Fact | Effect on the design |
| --- | --- |
| **"Email Service supports transactional email only"**: marketing email is not supported (FAQ). | Only order-event emails. Newsletters, promotions, campaigns and abandoned-cart reminders are out (section 15). |
| Sending to any recipient needs Workers Paid: 3,000 emails a month included, then **$0.35 per 1,000**. | Estori already runs on Workers Paid. |
| A daily quota starts "conservative" and grows with reputation; the number shows in the dashboard. A limit-increase form exists. | Over the quota a send returns `E_DAILY_LIMIT_EXCEEDED`; it stays queued and Estori alerts. |
| Rate limits aren't published; a send can return `E_RATE_LIMIT_EXCEEDED`. | Retried with backoff. |
| 50 recipients per message, 5 MiB per message, 20 custom headers, 16 KB of headers. | Each email goes to one shopper; no images or attachments. |
| The sender must be on a domain onboarded to Email Service (up to 30 domains per zone, in Estori's account). | Mail comes from Estori's domain, named for the store, with Reply-To set to the seller. Sellers' own domains can't be senders. |
| Hard bounces and complaints suppress addresses automatically (`E_RECIPIENT_SUPPRESSED`). Cloudflare asks for under 2% hard bounces and under 0.1% complaints. | A suppressed recipient gets status `suppressed` and no retry. A per-store daily cap protects the account's reputation. |
| Cloudflare Queues: 5,000 messages a second, 24 h delay, 100 retries. | Not needed at this volume (section 8). A D1 outbox and the existing 15-minute cron give retries without new account setup. |

**Volume and cost:**
- Per order, a shopper gets about 2–3 emails: confirmation, a shipment or two, maybe a refund. Add the seller's new-order email, and that's 3–4 emails per order.
- The 3,000 included emails cover about 750–1,000 orders a month. After that, each order costs about $0.0014.

## 3. Scope

**In**
- Three events: order confirmation, order shipped and refund issued.
- For each event, per store: on or off, an editable subject, heading and message, placeholders, preview, a test email to the seller, and reset to default.
- Per store, "Replies go to".
- A log of recent emails, with status.
- An outbox with retries.
- The Emails menu item.

**Out**
- Marketing email of any kind (section 2).
- A delivered email.
- Images and attachments.
- Seller-chosen sender domains.
- An HTML editor.
- The shopper sign-in page from the shopper order access spec. Emails carry the order's details and a link to the store instead.

## 4. Events

| Kind | Sent when | Event key (one email per key) |
| --- | --- | --- |
| `order_confirmation` | `recordStoreOrder` first records the order, from the webhook or the return page. | `order` |
| `order_shipped` | (a) The seller first marks the order shipped (`setShipment`, from unfulfilled to fulfilled). (b) Catalog items move to `shipped` in the catalog runner's sync. | (a) `own`; (b) `catalog:{supplierOrderId}` |
| `refund_issued` | (a) A seller refund succeeds (the store refund endpoint). (b) Estori refunds catalog items (catalog refunds, any reason except `seller-refund`). | (a) the refund `requestId`; (b) `catalog:{refundId}` |

A Mark shipped edit, or an undo and re-ship, sends nothing new, because the `own` key already exists.

## 5. Templates

- **Fields:**
  - `subject`: 1–150 characters;
  - `heading`: 1–120;
  - `body`: 0–2,000 characters of plain text, where a blank line separates paragraphs;
  - `enabled`.
- **Defaults:** Estori's default template for each event. A store without a saved row uses the default, enabled.
- **Placeholders:** `{{name}}`, with spaces allowed inside the braces. Saving refuses an unknown placeholder or one that doesn't belong to the event, and names it.

| Placeholder | Events |
| --- | --- |
| `store_name`, `customer_name`, `customer_first_name`, `order_number`, `order_total` | all |
| `carrier`, `tracking_number` | `order_shipped` |
| `refund_amount` | `refund_issued` |

- **Rendering:**
  - Placeholder values are HTML-escaped, and an empty value renders as nothing.
  - Paragraphs become `<p>`. Line breaks are kept.
  - The text version mirrors the HTML.
- **Fixed parts the seller can't edit**, which keep every email transactional and complete:
  - a header with the store's name;
  - the event block:
    - confirmation: the items, quantities, totals and the ship-to city;
    - shipped: the items in this shipment, the carrier and tracking, with a link for USPS, UPS, FedEx and DHL numbers;
    - refund: the refunded items and the amount;
  - a "Visit {store}" button, when the store is live;
  - a footer: "{store} sent you this email about your order {number}. Reply to reach the store. Sent with Estori."
  - Supplier names never appear, and catalog carriers come from `carrierText`.

## 6. Sending

- **From:** `{ email: SHOPPER_EMAIL_FROM || EMAIL_FROM.email, name: <store name, cleaned, 60 characters> }`.
  - `SHOPPER_EMAIL_FROM` is an optional variable. The recommended value is `orders@estori.app` once that address's domain is onboarded.
  - Until then, mail goes from the onboarded `no-reply@estori.app`, named for the store.
- **Reply-To:** the store's "Replies go to" address, or else the seller's account email.
- **Headers:** `X-Estori-Store: {appId}` and `X-Estori-Email: {kind}`.
- **To:** the order's `customer_email`.
  - **Test orders** (`mode = 'test'`) go to the seller's account email instead. Test mode lets anyone pay with test cards and type any address, so this keeps Estori from mailing strangers.
  - A test-order email gets the subject prefix `[Test] ` and a note: "This test order's email came to you instead of the shopper ({masked})."
- **Template off:** the row gets status `disabled`, and nothing is sent.
- **Per-store daily cap:** 1,000 shopper emails per store per UTC day, counted from the log. Past it, the row gets `capped`, and Estori sends a platform alert once a day.
- **Results:**

  | Result | Status |
  | --- | --- |
  | Sent | `sent`, with the `messageId` |
  | `E_RECIPIENT_SUPPRESSED` | `suppressed` |
  | `E_RATE_LIMIT_EXCEEDED`, `E_DAILY_LIMIT_EXCEEDED`, `E_DELIVERY_FAILED`, `E_INTERNAL_SERVER_ERROR` or a network error | stays `queued`, with a backoff |
  | Any other error (validation, sender) | `failed`, with a platform alert |

## 7. Data model

The migration takes the next free number (0028).
- `shopper_email_templates`:
  - columns `app_id`, `kind`, `enabled` (integer, as a boolean), `subject`, `heading`, `body` and `updated_at`;
  - primary key (`app_id`, `kind`);
  - `app_id` references `apps(id)` with cascade delete.
- `shopper_email_settings`: `app_id` (primary key, references `apps` with cascade), `reply_to` (nullable) and `updated_at`.
- `shopper_emails` (the outbox and log):
  - columns:
    - `id`, `app_id`, `order_id`, `kind`, `event_key`, `payload` (JSON event data);
    - `status` (`queued`, `sent`, `failed`, `suppressed`, `disabled`, `capped`), `test` (boolean);
    - `recipient` (the address it went or would go to), `attempts`, `next_attempt_at`, `message_id`, `error`;
    - `created_at`, `sent_at`;
  - unique on (`order_id`, `kind`, `event_key`);
  - indexes on (`app_id`, `created_at`) and (`status`, `next_attempt_at`).
- Rows are kept 90 days. The daily job deletes older ones.

## 8. The outbox

- **`queueShopperEmail(deps, event)`:**
  - inserts the row with `INSERT OR IGNORE`, so a repeated event writes nothing;
  - then tries to send it right away, through `ctx.waitUntil` when there is one, otherwise awaited;
  - never throws to its caller, so an email can never fail an order, a shipment or a refund.
- **`sendQueuedEmail(deps, row)`:**
  - takes the row with a status change (`queued` and due), so two runs never send it twice;
  - renders and sends it;
  - writes the result.
- **Backoff:** 15 minutes, 1 hour, 4 hours, 12 hours. On the fifth failed attempt, the row is `failed`.
- **Cron:** the existing 15-minute cron sends up to 100 due rows per run. The daily cron (`35 6 * * *`) deletes rows older than 90 days.
- **Queues:** Cloudflare Queues stays the upgrade path. At thousands of emails a minute, a queue consumer would replace the cron, with the same table.

## 9. API

All routes are `AuthConfig.ownerOnly` on the app (`:id`), except the store list.

| Method and path | Does |
| --- | --- |
| `GET /api/emails/stores` (authenticated) | The seller's stores for the picker: their apps with a live store or a store order, with titles. |
| `GET /api/stores/:id/emails` | Templates (saved or default), placeholders per event, settings and the 50 most recent emails. |
| `PUT /api/stores/:id/emails/:kind` | Saves `{ enabled, subject, heading, body }`. Answers 400 naming any bad placeholder. |
| `DELETE /api/stores/:id/emails/:kind` | Resets the template to the default. |
| `PUT /api/stores/:id/emails-settings` | Saves `{ replyTo: string \| null }`, which must be a valid email address. |
| `POST /api/stores/:id/emails/:kind/preview` | Renders the given (possibly unsaved) template with a sample order: `{ subject, html, text }`. |
| `POST /api/stores/:id/emails/:kind/test` | Sends the template, rendered with a sample order, to the seller's account email, at most 10 an hour per seller (KV). |

The recent emails show masked recipients (`a***@example.com`), the event, the order number, the status and the date.

## 10. The Emails page (`/emails`)

- **Sidebar:** **Emails** after Orders, for signed-in users, with an envelope icon.
- **Header:** "Emails". Below it: "Estori emails your shoppers when they order, when you ship and when they're refunded. Edit what each email says, or turn it off."
- **Store picker**, when the seller has more than one store. With none: "Publish a store to set up its emails."
- **One card per event:**
  - its name, when it's sent, an on/off switch and **Edit**;
  - "Edited", or "Estori's default".
- **Editor**, in a dialog:
  - the subject, heading and message fields;
  - the placeholder chips for the event; clicking one inserts it;
  - a live preview through the preview endpoint, debounced, shown in a sandboxed `iframe` (`srcDoc`, `sandbox=""`);
  - **Save**, **Send me a test**, **Reset to default** (with a confirmation) and **Cancel**.
  - Save errors name the bad placeholder.
- **"Replies go to":** an email field, with a hint that it's prefilled with the seller's account email.
- **Recent emails:** a table, or cards on phones, and an empty state.
- **A note:** "Estori sends order emails only. Cloudflare, which delivers them, doesn't allow marketing email such as newsletters or promotions."

## 11. Security and abuse

- Owner checks on every store route.
- Test-mode emails go only to the seller.
- Shopper addresses come only from paid orders.
- The test send is rate-limited.
- Templates are plain text with escaped placeholders, so sellers can't inject markup.
- Subjects are stripped of line breaks.
- The preview `iframe` is sandboxed.

## 12. Privacy

- No new shopper data: the outbox keeps the recipient for 90 days.
- The privacy policy already covers order processing. The owner should confirm wording that says order emails come from the store via Estori.

## 13. Testing

- **Pure:** placeholder parsing and validation; rendering of every block, escaping, the text version and test-order notes; masking; backoff.
- **Real SQL:** templates save and reset; the outbox ignores repeated events; claiming; the cap count; the recent list; the store list.
- **Sending:** sender fields, Reply-To and headers; test orders go to the seller; every error code maps to its status; a disabled template.
- **Hooks:** confirmation only on `recorded`; shipped only on the first ship; a catalog shipment; seller and Estori refunds with no doubles.
- **Endpoints:** owner checks, validation and the test send's rate limit.
- **UI:** source guards for the sidebar, the route, the editor, the sandboxed preview and the copy rules.
- **By eye on localhost:** edit, preview, test send (in the dev log), and Mark shipped producing a shipped email in the log.

## 14. Rollout

- No flag. Production Stripe is in test mode today, so every email goes to the seller until live keys arrive.
- **Owner actions**, optional:
  - onboard `orders.estori.app` (or another subdomain) in Email Service and set `SHOPPER_EMAIL_FROM`;
  - check the account's daily quota, and ask for an increase before launch;
  - confirm Stripe's own customer receipts are off, so shoppers don't get two confirmations.

## 15. Not possible on Cloudflare today

Marketing email isn't possible on Cloudflare today: newsletters, promotions, product launches, win-back and abandoned-cart reminders. Email Service is transactional-only, so Estori can't send it while relying on Cloudflare alone. When Cloudflare adds marketing support, it can be built on this design's pieces:
- a Campaigns tab;
- consent captured at checkout;
- one-click unsubscribe (`List-Unsubscribe` with `List-Unsubscribe-Post`, which the binding already accepts);
- a Cloudflare Queue for fan-out.
