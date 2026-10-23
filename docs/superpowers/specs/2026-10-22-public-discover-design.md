# Public Discover redesign

Status: proposed design for review; no product implementation yet.

## Baseline and intent

Existing public-site work was committed as e151df8e and pushed to origin/codex/pr32-i18n-continuation. This work starts on codex/public-discover-redesign.

Build an anonymous Discover experience closely matching the composition and interactions of https://contra.com/?view=projects, inside Estori's existing landing-page layout. Preserve authenticated Discover. Provide meaningful topic categories as the foundation for future communities, 48 distinct database-backed entries, real animated previews, and source artifacts in R2. The user confirmed premium means both paid items and high-end design.

## Reference and visual decisions

Observed reference: centered headline and large search panel, suggestion chips, horizontal visual topic cards, a compact sticky filter row, editorial project rows, and a dense four-column image-led gallery. Use Estori navigation/footer, DM Sans and brand colors. Match the reference's hierarchy, spacing and card density rather than copying Contra names, images, testimonials or statistics.

- Hero: “Find your next store idea.” Search searches the catalog; no imitation AI chat without implementation.
- Topic rail: eight art-directed category cards, horizontally scrollable with accessible previous/next controls. Show actual entry counts, not invented member counts.
- Filters: All, Store templates, Animated components; topic, Free/Premium, and search. URL preserves filters.
- Featured rows followed by all results. Four columns on large screens, two on tablet, one on small screens; stable aspect ratios and restrained hover motion.
- Card artwork is the focal point; title, topic, item type and Free/price appear below or on readable overlays. Distinct design compositions, not 48 color variants.
- Every item opens a detail modal at /discover?item=<slug>, preserving other filters. A topic opens its own topic overview modal at ?topic=<slug>, with description, entries and “Explore this topic” action that applies its filter.
- Modal: large preview, title, topic, description, included features/files, tier/price, related entries. Keyboard trap, Escape/close, focus restoration, direct-link loading and browser Back support. Mobile uses a full-height sheet.

## Scope and route boundaries

src/routes/root-index.tsx currently gives AppLayout to all paths except /. Make exact /discover session-aware using the same full-auth predicate: isAuthenticated && user && !user.isAnonymous. During auth loading show a neutral loader. Signed-out and anonymous visitors use PublicLayout and a new PublicDiscoverPage; fully authenticated users keep the existing gallery and app shell.

Keep /discover/:appId and its actual published-app marketplace semantics intact. Curated entries use a separate namespace and query-param modal. Authentication return URLs must preserve a pending catalog purchase/detail; purchase continuation must not accidentally open the unchanged signed-in feed and lose the selected item.

This iteration builds topic discovery, not posts, membership, comments or community moderation. Store demos have functioning client-side catalog/product/cart interactions, but do not claim connected payments or live orders.

## Content inventory

48 items: 8 topics × 3 storefront templates + 3 animated components. 24 free and 24 paid. F = free; P = paid premium.

| Topic | Store templates | Animated components |
| --- | --- | --- |
| Fashion & Style | Daily Uniform F; After Hours P; Studio Archive P | Lookbook Strip F; Shade Switcher F; Drop Reveal P |
| Beauty & Self-care | Soft Ritual F; Shade Theory P; Botanical Lab P | Routine Stack F; Ingredient Orbit F; Texture Reveal P |
| Food & Drink | Sunday Pantry F; Origin Coffee P; Table Stories P | Roast Dial F; Recipe Steps F; Pour Story P |
| Home & Living | Objects & Co F; Quiet Spaces P; Clay Collective P | Room Layers F; Material Samples F; Shelf Composer P |
| Art & Digital Goods | Paper Studio F; Sound Library P; Frame Works P | Poster Shuffle F; Waveform Loop F; Gallery Lens P |
| Learning & Communities | Open Notebook F; Maker School P; The Common Room P | Learning Path F; Member Mosaic F; Session Spotlight P |
| Outdoors & Movement | Trail Supply F; Motion Club P; Summit Stories P | Trail Trace F; Gear Stack F; Elevation Explorer P |
| Pets & Everyday Life | Good Companion F; Play & Stay P; Everyday Kits P | Playful Paw Trail F; Size Matcher F; Build a Kit P |

Motion examples: swatch crossfades, staggered shutters, orbiting ingredient labels, draggable texture comparison, tasting-note dial, liquid fill/steam, sample fan, interactive shelf arrangement, poster stack, silent waveform, lens reveal, milestone drawing, abstract avatar wave, drawn trail marker, terrain profile and item-to-bundle motion. Every interactive example also supports keyboard/touch. No sound autoplay.

Paid pricing proposal for review (not yet approved): USD $29 per storefront template and $9 per animated component, one-time purchase. Keep prices in database integer cents, never solely in UI. These are proposed catalog prices, not user-approved live offers. All paid previews remain public; full source delivery requires a verified entitlement. Do not publish live prices/checkout until this design and pricing are accepted.

## Data and storage architecture

Recommended: separate curated catalog alongside existing published-app marketplace. Reusing apps would require fake deployment/approval state; frontend-only fixtures would fail persistence requirements.

Add discover_categories, discover_entries, discover_assets using Drizzle schema and generated D1 migration. Stable deterministic IDs/slugs; category title/description/order; entry kind, tier, USD cents, summary, structured body/tags, version, typed preview recipe/config, published state, order/timestamps. Asset records contain role, MIME, byte size, SHA256 and R2 object key. Preserve existing TemplateCategory site types; editorial topics are independent stable keys for future community relationships.

Use existing TEMPLATES_BUCKET with discover/<slug>/<version>/ namespace. Each entry contains a cover, preview artifact, source bundle and provenance/hash manifest. Use existing buildSnapshot/TemplateBundle validation for source bundles; source files must be real HTML/CSS/JS with working demo interactions, not placeholder metadata. Keep source and preview artifacts separate. Never expose paid source bundles through public media routes.

Public API under /api/discover/catalog, registered before /api/discover/:appId:
- GET /categories: category summaries and actual published counts.
- GET /: filtered/paginated published entries; bounded search, category, kind, tier and page size.
- GET /:slug: published detail and related entries.
- GET /:slug/media/:assetId: resolve approved public asset role through database; never accept arbitrary bucket keys.

Explicit public auth override on those GET routes only. Public responses contain safe media URLs, not source bodies or private keys. Shared contracts in shared/types/discover-catalog.ts, frontend re-export through src/api-types.ts, api-client methods, centralized public query keys, TanStack Query hooks. No frontend mock fallback silently disguising an empty database.

## Preview isolation and performance

Cards use lightweight previews/static covers with a finite trusted animation registry. Do not load 48 active iframes. Animate in-view or on focus/hover; suspend offscreen and hidden-tab animations, honor prefers-reduced-motion and provide motion pause control. No layout shifts while media loads.

Detail preview uses a sandboxed iframe with scripts only where needed, without same-origin privileges, popups, forms or top navigation. Apply restrictive preview CSP and nosniff. No arbitrary stored HTML enters React DOM. Preview runtime is intentionally public: interactive browser code cannot be kept secret. Premium pays for licensed editable source packaging and delivery, not secrecy of client-side behavior. Archive/manifest object routes remain private and no credentials enter previews. Stored bundles must contain no secrets. Source entitlement checks happen server-side.

## Paid catalog integration

Keep existing app-template purchases untouched. Add immutable discover_versions, discover_checkout_orders and discover_purchases. Catalog entries are first-party Estori products; never fabricate apps, users or Connect sellers. Add createCatalogCheckoutSession in worker/services/payments/stripe-client.ts for platform payments with purpose=discover_catalog metadata, and explicit dispatch in worker/api/controllers/payments/webhook.ts before existing template fulfillment. Reuse one fulfillment function for verified webhook and authenticated return confirmation; both check stored buyer, version, amount, currency and paid state. Server chooses price from published version, creates authenticated checkout with idempotency, and grants versioned source access only after a verified paid webhook. Browser return/query parameters never grant access. Duplicate events and refunds follow existing payment conventions. Source endpoint checks purchaser ownership and returns only entitled version.

Delivery is a downloadable runnable source archive. Storefront bundles include entry files, styles, assets, dependency/config files where needed and setup instructions; component bundles include source, usage example and reduced-motion handling. Build every shipped storefront and validate source bundles with buildSnapshot plus parseBundle. Do not label the action “Use this store”: one-click ThinkAgent import requires separate catalog provenance support and is not in this public-gallery iteration.

Public browsing requires no login. Purchase requires login and returns to the selected item. Tests use fake/test payment infrastructure; no real financial transactions or production Stripe products are created by this implementation. No nonfunctional Buy buttons: paid actions ship only with tested checkout/fulfillment, otherwise remain explicitly non-purchasable until that integration is ready.

## Persistence workflow

Create deterministic manifest and explicit local-default Bun seeder. Upload/hash-verify all R2 objects first, then publish D1 entries. Reruns upsert without duplicates; partial upload failure leaves entries unpublished. No unauthenticated seed endpoint.

Use the same local Wrangler configuration/persistence as the running app (.superpowers/wrangler.local.json via local Vite config). Do not commit local config or secrets. Verify 48 persisted entries, eight category counts of six, 24/24 tier split and every required R2 object by actual reads. Restart and re-fetch to prove persistence. Production migration/upload/deployment is a separate operation, not implied by this local redesign.

## Implementation workstreams and dependency order

1. Parent locks shared contracts, schema, preview format, catalog price decision and design tokens; inspect Kumo Dialog documentation.
2. Data/storage agent implements migration, queries, public endpoints, idempotent seeder and tests.
3. Template agent creates 24 distinct storefront artifacts in category batches (three per category), with screenshots and source validation.
4. Motion agent creates 24 reusable animated artifacts in category batches, with reduced-motion/static fallbacks and keyboard controls.
5. Parent integrates public shell, search/topics/filter state, cards, modal, query hooks and responsive visual fidelity.
6. Payment/entitlement work follows catalog contract completion and is reviewed independently. Reuse freed agent slot; do not overlap schema ownership with data agent.
7. Integrate manifests/assets; seed local D1/R2; complete browser and regression checks. Parent reviews all agent outputs and fixes integration issues.

Agents own distinct file sets; shared contracts are finalized before parallel implementation. Delegate batches rather than 48 concurrent workers to preserve consistency and resource limits.

## Acceptance and verification

- Signed-out/anonymous /discover uses landing header/footer, no app sidebar or login wall. Fully signed-in Discover unchanged. No auth-loading layout flash.
- 48 unique entries with complete details/source/artifacts; eight categories, six entries each, no duplicate palette-only designs.
- Anonymous APIs work; drafts and private source cannot be fetched by guessed identifiers. Validate filters/pagination and public media MIME/cache behavior.
- Filters/search combine correctly, empty/error/retry/loading states work. Modal deep links, Back, Escape, focus and mobile sheet verified.
- Public paid preview allowed; source denied without entitlement; server pricing, duplicate webhook, cancelled checkout and version pinning tested.
- Idempotent seed and failed-upload behavior tested against D1/R2, not just mocks; persistence checked after restart.
- Desktop/tablet/mobile visual review against reference, including internal PublicLayout scrolling, reduced motion and offscreen animation suspension.
- Run root typecheck, lint, focused Vitest tests and build. Existing Discover/public-shell/payment regression tests must pass; report unrelated failures explicitly.

## Review decisions

Confirm overall design and proposed one-time prices before implementation. The detailed task-by-task execution plan will use the user-requested subagent method and the workstreams above.
