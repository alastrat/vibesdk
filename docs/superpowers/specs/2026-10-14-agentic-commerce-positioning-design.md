# Agentic commerce positioning: design

**Date:** 2026-10-14
**Status:** approved in conversation, section by section; this document awaits the owner's review.
**Branch:** `feat/agentic-commerce-positioning`, from `main` at `4d4bf64`.

## Goal

Estori is repositioned as the agentic commerce platform for e-commerce owners and brands. The public site is rebuilt around that vision. Most of the new capabilities aren't built yet, so the site states each capability's real status. Nothing reads as available unless it works today.

Success means:
- a brand owner understands within seconds what Estori does for them;
- each audience finds its own page;
- no page claims a capability that isn't live.

Building the capabilities themselves is out of scope. Each one gets its own spec when the owner decides to build it.

## Positioning

**Category:** the agentic commerce platform.

**Promise to brands:** build your store with AI, sell it wherever shoppers ask AI, and let agents help you run it.

**Why it's believable:** Estori owns the whole stack: the store code, the hosting on Cloudflare and the checkout. So a new standard or agent capability reaches every store at once, without each merchant installing an app.

**Audiences:**
- **Brands and store owners:** primary. The landing page speaks to them first.
- **Dropshippers and resellers.**
- **Digital businesses:** entrepreneurs selling digital products and running a community.
- **Creators:** professionals who take part in the Estori ecosystem without running a store.
  - **Developers:** build stores and sell them as templates in Discover.
  - **Content creators:** earn by promoting merchants' products with their link or their own store.

## Capabilities and their status

There are three statuses:
- `available`: works today. Shown without a tag.
- `coming-soon`: built into every store when it ships. Shown with a "Coming soon" tag and no button.
- `early-access`: a separate program. Shown with an "Early access" tag and a "Request early access" button.

| Id | Name | Status | Explained at |
|---|---|---|---|
| `store-builder` | AI store builder | available | `/` (hero and "What Estori builds today") |
| `agentic-commerce` | Agentic commerce | coming-soon | `/agentic-commerce` |
| `operations-agents` | Operations agents | coming-soon | `/solutions/brands#operations` |
| `personalized-shopping` | Personalized shopping | coming-soon | `/solutions/brands#personalization` |
| `product-catalog` | Product catalog | coming-soon | `/solutions/resellers#catalog` |
| `digital-products` | Digital products and community | early-access | `/solutions/digital` |
| `developer-templates` | Templates in Discover | available | `/creators/developers` |
| `content-creators` | Content creator program | early-access | `/creators/content` |

These live in one registry, `src/lib/capabilities.ts`, holding the id, name, one-line description, status and path.
- Every tag, every request button, the menus and the pricing comparison read status from it.
- When a capability ships, changing its status in the registry removes its tag everywhere.
- The ids of the two `early-access` capabilities are shared with the worker through `shared/types/early-access.ts`, so the API accepts only those.

**What each capability promises (for page copy):**
- **Agentic commerce:** every store publishes its catalog and checkout in the open agentic commerce standards (UCP and ACP), so AI shopping assistants can find its products, answer questions about them and complete a purchase. The merchant stays the seller of record.
- **Operations agents:** agents that handle day-to-day work: merchandising, stock alerts, order follow-ups, customer replies, and visibility in AI answers.
- **Personalized shopping:** recommendations, a smart cart, bundles, post-purchase offers and AI search, built into the store. No apps to add.
- **Product catalog:** resellers apply to a curated catalog of vetted suppliers, add products to their store in a few clicks, and the supplier ships.
- **Digital products and community:** sell e-books, images, videos and other downloads, and run a community for your customers.
- **Content creator program:** creators promote merchants' products with an affiliate link or their own store, and earn a commission the merchant sets.

## Copy rules

These are enforced by guard tests:
- **Competitors:** never name one. The existing landing guard list applies to every new page.
- **AI assistants:** never name ChatGPT, Gemini, Copilot, OpenAI, Google or Anthropic. Naming them would imply integrations that don't exist. Say "AI assistants and shopping agents".
- **Standards:** name them as "the open agentic commerce standards (UCP and ACP)". Never call either one "the standard".
- **Not-yet-available capabilities:** no "now", "today", "live" or "available" next to them. The tag comes from the registry.
- **Numbers:** fees, plan prices, credit allowances and the free plan's limits come from code, never typed into copy.
- **Store payments:** the existing rule stands: generated stores can't take real payments yet, so the site never claims they can.

## Navigation

Top bar, from 768px up:

`Solutions ▾   For creators ▾   Discover   Pricing        Sign in   [Start building free]`

**Solutions panel.** Two columns in 1Password's style: one-line descriptions under the audience items, no icons.
- **Estori for:**
  - Brands and store owners (`/solutions/brands`);
  - Dropshippers and resellers (`/solutions/resellers`);
  - Digital businesses (`/solutions/digital`).
- **Platform:**
  - AI store builder;
  - Agentic commerce;
  - Operations agents;
  - Personalized shopping;
  - Product catalog;
  - Digital products and community.

  Each platform item shows its status tag from the registry and links to the page that explains it.

**For creators panel.** A caption says creators take part in Estori without running a store. Two items with descriptions and status tags:
- Developers (`/creators/developers`);
- Content creators (`/creators/content`).

**Panel behavior:**
- Each panel opens on click and on keyboard activation. It closes on Escape, on an outside click and on navigation.
- The trigger uses `aria-expanded` and `aria-controls`.
- Panels never open on hover alone, so touch and keyboard behave the same.

**Below 768px:** the menu button opens one list: the Solutions groups, then For creators, then Discover and Pricing, then the build action. This extends the current phone menu.

**Link updates:**
- The announcement bar's link and the footer's "Sell your stores" move from `/#creators` to `/creators/developers`.
- The footer columns become Solutions, For creators, Legal and Contact.

## Pages

New pages use 1Password's solution-page layout:
1. eyebrow, headline, one-line lead and two actions;
2. problem section;
3. value cards;
4. how it works;
5. FAQ, using the shared `PublicFaq`;
6. closing panel.

They reuse the public-site primitives (`HEADING_*`, `LEAD`, `PillLink`, `Eyebrow`) and the `.public-site` palette. Each sets its own page title. Every page's primary action is "Start building free", because building is live. `early-access` sections add the request button.

**`/solutions/brands`:**
- the brand pitch;
- the three built-in capabilities, each in its own section with its anchor: agentic commerce (summary, linking to `/agentic-commerce`), `#operations` and `#personalization`;
- "What Estori builds today".

**`/solutions/resellers`:**
- the reseller story: find products, add them in a few clicks, the supplier ships, you keep the margin;
- the `#catalog` section, tagged "Coming soon";
- today's store builder for the store itself.

**`/solutions/digital`:**
- selling digital products and running a community;
- the request button, since this is `early-access`.

**`/agentic-commerce`:** the explainer.
- what AI shopping assistants are;
- what makes a store "agent-ready": product feed, checkout endpoints, verified agents, secure payment tokens;
- how every Estori store will get it, with no setup.

**`/creators/developers`:**
- today's template story: build a store, publish it to Discover, earn per sale;
- the current landing page's creators panel, moved here with its fee flow computed from the fee code;
- a link to Discover.

**`/creators/content`:**
- earning by promoting merchants' products;
- the request button.

## Landing page (signed out `/`)

In order:

| # | Section | Content | Label |
|---|---|---|---|
| 1 | **Hero** | Eyebrow "The agentic commerce platform", a brand headline, the build box and the builder demo. | Available |
| 2 | **Store wordmarks** | The strip of stores made on Estori. | Unchanged |
| 3 | **Sell wherever shoppers ask AI** | Diagram: store, then the open standards, then AI assistants. Links to `/agentic-commerce`. | Coming soon |
| 4 | **Agents that help run your store** | | Coming soon |
| 5 | **Shopping that adapts to every customer** | | Coming soon |
| 6 | **What Estori builds today** | The current feature cards. | Available |
| 7 | **Estori for every kind of seller** | Cards for resellers and digital businesses, then a For creators row. | |
| 8 | **Discover showcase** | Unchanged, including the "at least 3 stores" rule. | |
| 9 | **Desktop and phone preview** | | |
| 10 | **Pricing summary** | The four plans. | |
| 11 | **FAQ** | Updated, including "What does Coming soon mean?". | |
| 12 | **Closing panel** | | |

- The blue creators panel leaves the landing page for `/creators/developers`.
- Signed-in `/` still shows the builder.
- Motion follows the existing rules: Magic UI components, nothing moves under reduced motion, and animation stops off screen.

## Pricing

Four plans for merchants. The plan data lives in `src/lib/plans.ts`.

| | Free | Starter | Growth | Scale |
|---|---|---|---|---|
| **Status** | Available | Coming soon | Coming soon | Coming soon |
| **Price** | $0 | $29 / month | $79 / month | $249 / month |
| **AI credits** | the live daily limit, read through `usePublicPlan` (today 200 a day) | 10,000 a month | 30,000 a month | 100,000 a month |
| **Live stores** | build and preview only (new sites per day from `usePublicPlan`) | 1 | 3 | 10 |

AI credits pay for building sites and for agents' work.

**Comparison sections.** Rows grouped by capability show what each plan includes:
- **Store building:** stores, AI credits.
- **Agentic commerce:** all paid plans.
- **Operations agents:** Growth and Scale.
- **Personalized shopping:** recommendations and smart cart on all paid plans; bundles, post-purchase offers and AI search on Growth and Scale.
- **Product catalog:** Growth and Scale.
- **Digital products and community:** Growth and Scale, early access.
- **Support:** standard on all plans, priority on Scale.

Cells for `coming-soon` capabilities carry the tag. There is no separate "built in" row.

**Fees:**
- **Merchants' store sales:** no Estori fee, only Stripe's card processing. This is stated in the FAQ.
- **Template sales:** stay at the fee in code, today 7% + $0.60. They move to a "For developers" section with the current seller table.
- **Content creator commissions:** set by the merchant. Estori's share is announced when the program launches.

**Page layout:**
1. a hero for merchants;
2. the four plan cards. Paid plans show "Coming soon" and no buy button. Free keeps "Start building free".
3. the comparison;
4. the "For developers" section;
5. the FAQ.

The landing pricing summary shows the same four cards from the same data.

## Requesting early access

This applies only to the two `early-access` capabilities.

**Button behavior.** `EarlyAccessButton`, given a capability id:
- **Signed out:** it opens the existing sign-up window through `requireAuth`, with a pending action that records the request after sign-in. This is the pattern the build box uses.
- **Signed in:** it records the request immediately.
- **After a request:** the button reads "You're on the list". The state comes from the user's own requests.
- **Errors:** a toast says the request wasn't saved, and the button stays available.

**Data.** Migration 0014 adds `early_access_requests`:

| Column | Type |
|---|---|
| `id` | text, primary key |
| `user_id` | text, foreign key to `users`, `on delete cascade` |
| `capability` | text |
| `created_at` | integer timestamp |

A unique index on (`user_id`, `capability`) makes repeat requests a no-op. The cascade removes requests when an account is deleted. The account deletion flow is checked to confirm it removes them.

**API**, following the existing controller, route and service pattern:

| Endpoint | Access | Behavior |
|---|---|---|
| `POST /api/early-access` with `{ capability }` | signed in | Rejects any id that isn't an `early-access` capability with 400. Returns the user's requested capabilities. |
| `GET /api/early-access` | signed in | The signed-in user's requested capabilities. |
| `GET /api/admin/early-access` | admin | The count per capability, and each request with the user's email, display name and date, newest first. |

Types go in `src/api-types.ts`, calls in `src/lib/api-client.ts`, the service in `worker/database/services/EarlyAccessService.ts`, and the controller and routes under `worker/api/`.

**Admin.** A new `/admin/early-access` page, linked next to Reviews, shows demand per capability and the requester list.

**Privacy.**
- The policy's "What we collect" gains an "Early access requests" item: which upcoming features you asked for, and when.
- "How we use it" already covers messages about the Service.
- The privacy policy version moves to 2026-10-14.
- The Terms are unchanged. The pricing FAQ explains that "Coming soon" capabilities aren't part of the Service until they launch.

## Testing

- **Unit:**
  - the capability registry: every id has a status and a path, and the early-access ids match the shared list;
  - the plan data: prices and credits as above, and the free plan reads live limits.
- **Worker:**
  - `EarlyAccessService`: records a request, ignores a repeat, rejects ids that aren't early-access, lists per user, counts for admin;
  - controller auth levels;
  - route wiring;
  - the migration;
  - account deletion removes requests.
- **Guards**, as raw-source tests in the existing style:
  - every new page and the menus read tags from the registry;
  - no page names a competitor or an AI assistant;
  - "UCP and ACP" appears with "open agentic commerce standards";
  - no buy button on a coming-soon plan;
  - fee and price numbers aren't hard-coded in copy;
  - old `/#creators` links are gone;
  - panels expose `aria-expanded`.
- **Live, locally:**
  - every public page at 1440 and 390;
  - the menus by mouse, keyboard and phone;
  - the light and dark app themes;
  - reduced motion;
  - the request flow signed out and signed in;
  - the admin page;
  - signed-in `/` still showing the builder.

## Delivery

1. Build on this branch and run the result on the local server (port 8100) for the owner to review before any PR.
2. Then open a PR to `main`.
3. Deploying is a separate go-ahead, as always.

## Decisions

1. **Unbuilt capabilities are tagged, never presented as available.** The cost is a less punchy pitch until they ship.
2. **Built-in capabilities get "Coming soon" with no button; only the two separate programs take requests.** The cost is no demand signal for the built-in ones.
3. **Requests go through an Estori account, not an email list.** This means no separate marketing list, consent text or unsubscribe flow. The cost is friction for visitors who won't sign up.
4. **Planned plan prices are shown now, marked "Coming soon".** The cost is that changing them later is visible.
5. **No Estori fee on merchants' store sales is promised.** The cost is that it's a commitment.
6. **The site names the standards, not the companies behind them or the assistants.** The cost is less name recognition.
7. **Discover stays the template marketplace,** explained on `/creators/developers`.
