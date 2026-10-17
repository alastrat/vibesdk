# Live stores: a store on its own address, and on the seller's own domain

Branch `feat/live-stores`, cut from `feat/catalog-purchase-flow` (draft PR alastrat/vibesdk#12).

## 1. Purpose

Today a store is only reachable as a preview, at `/space/<appId>/preview/main/` on Estori's preview host, behind a
token that expires. Shoppers can't reach it, so stores can't sell.

This spec gives every store:

- **Its own address:** `https://<slug>.<stores domain>`, for example `northwind-tea.estori.shop`.
- **Going live and offline:** the seller publishes the version they previewed. The live store keeps serving that
  version while they keep editing, until they publish again.
- **The seller's own domain:** for example `shop.northwindtea.com`, connected with DNS records Estori shows, and
  verified by Estori.
- **Checkout for shoppers:** Estori's checkout page works on the live store, for anyone.

It is the "Live stores" spec that `2026-10-15-shopper-checkout-design.md` section 8 asks for.

### Owner request (2026-10-17)

"Make sure the stores created can be deployed in a subdomain and even have the option to add their own domain."
The owner asked for independent work on a separate branch, so this spec's choices are rulings, listed in section 10.

## 2. What the seller sees

1. In the editor, a **Go live** button opens the store's address panel.
2. **Address:** a suggested name from the store's title, editable, with the stores domain after it. Estori checks it is
   free and allowed.
3. **Publish:** publishes the version in the preview. The panel shows "Live" and the address, with an Open link.
   - Later edits change only the preview. The button becomes **Publish changes**.
   - When the store's file has no products, the panel warns that checkout isn't connected to payments.
4. **Take offline:** the address shows "This store isn't open right now". Publishing again reopens it.
5. **Your own domain:** the seller types a domain they own, for example `shop.northwindtea.com`.
   - Estori shows the DNS records to add: a CNAME to Estori's stores target, and the TXT records the certificate
     needs.
   - The status reads "Waiting for DNS" until Estori verifies it, then "Connected". The seller can check again or
     remove it.
   - Both addresses serve the store.

## 3. Addresses and routing

- **Stores domain:** the `STORES_DOMAIN` variable, for example `estori.shop`. When it isn't set, live stores are off:
  the panel says store addresses aren't set up yet.
  - It must be its own registrable domain, on the Public Suffix List, so stores can't read or set each other's cookies
    or Estori's (owner decision 2 of the shopper checkout spec).
  - Locally it is `stores.localhost`, so stores open at `http://<slug>.stores.localhost:8100/`.
- **Slugs:** 3 to 40 characters of lowercase letters, digits and hyphens, not starting or ending with a hyphen, and not
  a reserved word (`www`, `api`, `admin`, `app`, `mail`, `shop`, `store`, `stores`, `estori`, `preview`, `status`,
  `help`, `support`, `checkout`, `pay`, `cdn`, `assets`). Unique across all stores.
- **Routing, in `worker/index.ts`, before any generated code runs:**
  1. A host that is exactly one label under the stores domain is a store subdomain. It is looked up by slug.
  2. A host that is no other Estori host (main, preview, app subdomains, sandboxes) is looked up as a custom domain,
     connected and active.
  3. Anything else keeps today's routing, and unknown hosts still get 404.
  - Lookups are cached per isolate for 30 seconds, so a store page doesn't hit D1 on every request.
- **Serving:** a live request goes to the store's SpaceDO on an internal path, `/__live/<path>`, checked before the
  preview route. SpaceDO serves deployment `live` at the root: no path rewriting, the same header stripping as previews,
  and its own Facet, `app:live`, so the live store's data is separate from the preview's.
- **Platform paths:** on a live host, `/__estori/*` is answered by `store-platform.ts`, as on previews, with the base
  path `''`.
- **States:** a store with no live record, or one taken offline, answers 404 with "This store isn't open right now".

## 4. Publishing

- **`SpaceDO.publishLive()`** copies the deployment of branch `main`, the build the seller previews, into a deployment
  named `live`. It doesn't rebuild and doesn't check anything out, so the agent's working tree never moves.
  - It answers the commit and the store file of what it published, or an error when `main` was never deployed.
- **The reserved name:** `SpaceDO.deploy('live')` and the agent's `deploy_space` tool refuse branch `live`.
- **The live store record** (D1 `live_stores`): `app_id`, `slug`, `status` (`live` or `offline`), `published_commit`,
  `published_at`, `created_at`, `updated_at`.
- **Prices:** live checkout prices from the `live` deployment's store file. Editing the preview changes nothing for
  shoppers until the seller publishes again.

## 5. Payments on live stores

- **Who may pay:** previews keep today's rules (the owner pays in test mode; anyone else sees a demo). On a live store,
  any shopper may pay.
- **The seller** of a live store is the app's owner (`apps.user_id`), not a token's subject.
- **Mode:** the platform's Stripe key decides it, as today.
  - Test keys: live stores take test payments, so the whole flow can be checked before launch.
  - Live keys: live stores take real payments only when `LIVE_STORE_PAYMENTS` is `on`. Until the owner turns it on at
    launch, they answer "This store can't take payments right now".
- **Return paths:** the success and cancel paths are checked on the server with the same rule as the checkout request,
  and handed to the checkout page. The page no longer parses them itself, which closes the open redirect the final
  review found for stores served at a domain root (minor M1).
- Everything else is unchanged: the seller's limits, holds, refunds, disputes and settlement.

## 6. Custom domains

- **One domain per store**, in D1 `store_domains`: `hostname` (lower-case, unique), `app_id`, `status` (`pending`,
  `active` or `failed`), the provider's id, the DNS records to show, the last error, `created_at`, `checked_at`,
  `verified_at`.
- **Accepted hostnames:** at least two labels, valid DNS labels, at most 253 characters, not an IP address, and not
  Estori's own domains or the stores domain.
- **Providers**, behind one interface (create, check, remove), as suppliers are:
  - **Cloudflare for SaaS:** Estori creates a custom hostname on the stores zone with HTTP certificate validation, and
    reads `status` and `ssl.status` until both are `active`. It needs `CF_SAAS_ZONE_ID`, the `CF_SAAS_API_TOKEN` secret
    and `STORES_CNAME_TARGET`, the name sellers point their CNAME at.
  - **Local:** in development only, hostnames under `.localhost` are connected on the first check, with the same records
    shown, so the flow can be tried end to end on a laptop.
  - Without either, the domain section says custom domains aren't set up yet.
- **Checks:** the panel's Check now button, and an hourly sweep of pending domains. A domain still pending after 7 days
  is marked failed, with the provider's reason.
- **Removing** a domain deletes it at the provider and frees the hostname.

## 7. API (owner only)

- `GET /api/stores/:id/live`: the store's address, status, published version, the stores domain, a suggested slug, the
  custom domain, and whether custom domains are available.
- `POST /api/stores/:id/live/publish` with `{ slug }`: publishes, taking the slug on the first publish or when it
  changes.
- `POST /api/stores/:id/live/offline`.
- `POST /api/stores/:id/live/domain` with `{ hostname }`, `POST /api/stores/:id/live/domain/check`, and
  `DELETE /api/stores/:id/live/domain`.

## 8. Testing

- **Unit and real-SQL tests:**
  - slug and hostname rules;
  - the live store and domain records;
  - `publishLive` against a real Durable Object SQLite;
  - host routing for subdomains, custom domains, offline stores and unknown hosts;
  - the payment gates for previews and live stores, test and live modes;
  - both providers, with Cloudflare's API mocked;
  - the controller and the panel.
- **End to end** (localhost, `STORES_DOMAIN=stores.localhost`, Stripe test mode):
  - publish two stores and open them on their subdomains as a signed-out shopper;
  - pay on a live store;
  - connect a `.localhost` custom domain and pay there;
  - take a store offline and reopen it;
  - publish changes and see the live store change only then.

## 9. Owner actions

- Register the stores domain (for example `estori.shop`) and add it to the Public Suffix List.
- On that zone:
  - add a proxied wildcard DNS record `*` and a Worker route `*.estori.shop/*`;
  - enable Cloudflare for SaaS, set the fallback origin, and create the CNAME target;
  - add a catch-all route so custom hostnames reach the Worker.
- Set `STORES_DOMAIN`, `STORES_CNAME_TARGET` and `CF_SAAS_ZONE_ID`, and the `CF_SAAS_API_TOKEN` secret (Custom
  Hostnames edit on that zone).
- Turn on `LIVE_STORE_PAYMENTS` at launch, after the other launch prerequisites.
- Register each live store domain with Stripe for Apple Pay and Google Pay.

## 10. Rulings

- Live is a copy of the previewed `main` deployment, not a git branch, so publishing can't move the working tree. Cost
  if wrong: no `live` ref in Artifacts; history stays by commit.
- The `live` deployment's store file is the price authority, not a D1 `store_versions` table. Cost if wrong: no D1
  history of published prices; a later table can be added under the same hook.
- One custom domain per store, and both addresses serve the store, with no redirect between them. Cost if wrong:
  duplicate addresses until a primary-domain choice exists.
- Custom domains and live stores on every plan for now. Paid plans can't be bought yet. Cost if wrong: a plan gate to
  add.
- Live-mode payments need `LIVE_STORE_PAYMENTS=on`. Cost if wrong: one variable to set at launch.
- No public-site copy yet: live stores are coming soon until the owner's setup is done.

## 11. Not in this spec

- Several domains per store, a primary-domain redirect, and apex (root) domains, which need an A record.
- Store analytics, sitemaps and SEO settings for live stores.
- Plan limits on live stores and suspension by an admin.
