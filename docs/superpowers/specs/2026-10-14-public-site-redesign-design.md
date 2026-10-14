# Public site redesign: 1Password look, Magic UI motion, Discover showcase

Status: designed with the owner on 2026-10-14 and approved. The landing page mockup the owner approved is `.superpowers/brainstorm/56174-1791986683/content/landing-v4.html`; it isn't committed, and this spec is the record.

Builds on `2026-10-13-public-launch-pages-design.md` (PR #7) and `2026-10-14-account-basics-design.md` (PR #8). Branch `feat/public-site-redesign`, stacked on PR #8.

## What the owner asked for

"Make the website elegant", following 1Password's look and feel extensively, with richer animated elements in the style of Magic UI. Then two changes to the first mockup:
- the stores carousel becomes a carousel of store logos;
- below it, a store showcase like the "See what our community is building" section of the owner's other Estori site (`estori-multifunnel-agentic-generator`, `showcase-gallery.tsx`).

## Decisions

| Topic | Decision |
|---|---|
| Scope | Every public page: landing (`/` signed out), `/pricing`, `/terms`, `/privacy`, `/refunds`, `/copyright`, the public top bar and the footer. Signed-in app screens don't change. |
| Palette | 1Password's: charcoal `#1d1d21`, blue `#145fe4`, gold `#cbb88e`, white. Public pages only; the app keeps the Estori palette. |
| Font | DM Sans, self-hosted, at 1Password's light weights. Public pages only; the app keeps the system font. |
| Logo carousel | Wordmarks of stores published in Discover. No third-party company logos: showing real companies under "trusted by" would claim an endorsement nobody gave. |
| Showcase | Live Discover data. The owner is seeding Discover before launch. The showcase and the logo carousel each disappear when they'd have 2 stores or fewer. |
| Showcase images | Tall 1280×1650 screenshots, captured when a store is published publicly, refreshed after its deploys, and refreshable by an admin. |
| Dark mode | Public pages look the same in light and dark themes, as 1Password's do. Their panels set the light and dark rhythm themselves. |
| Copy | The existing wording carries over. New lines are listed in each section below. Rules from part 1 still hold: no competitor named, nothing promised that doesn't work today, and the fee and limits come from the code. |

## Visual system

**Type**
- DM Sans variable, with the `opsz` axis held at 14 (its wider text cut), which is closest to 1Password's Agile Sans.
- Headings use weight 300 with -0.02em letter spacing and a line height of 1.1:
  - 88px for the landing hero;
  - 64px for section titles;
  - 30px for card titles.
- Body text is weight 300, 20px with a 1.5 line height for leads and 16px for body.
- Eyebrows are 12px uppercase, weight 400, with +0.02em letter spacing.
- On phones, the hero drops to 44px, section titles to 36px and card titles to 24px.

**Color tokens** (new, public pages only, defined in `src/styles/public-site.css`):
- `--public-charcoal: #1d1d21`;
- `--public-blue: #145fe4`;
- `--public-gold: #cbb88e`;
- `--public-white: #ffffff`;
- `--public-ink: #000000`;
- `--public-muted: #5b5b66`;
- `--public-line: #e5e5e5`.

**Panels**
- Sections alternate between full-bleed charcoal and white.
- Featured blocks are inset panels, 24px from the window edge (12px on phones), with a 25px radius: a blue panel and a charcoal closing panel.
- Cards are white with a 24px radius.

**Buttons and links**
- Buttons are pills (`9999px` radius, `10px 24px` padding, 16px, weight 400):
  - blue filled;
  - white filled with blue text;
  - charcoal filled;
  - outline (white on dark, charcoal on light).
- Text links are underlined with a 5px offset.

**Font loading**
- The DM Sans woff2 (Latin subset, `wght` 100–1000, `opsz` 9–40) lives at `public/fonts/dm-sans/`, next to its OFL licence.
- `@font-face` uses `font-display: swap`.
- `PublicLayout` preloads the file with React 19's `preload()`, so app pages never download it.
- The page's security policy (`font-src 'self'`) already allows the font.

**Scoping**
- `PublicLayout` sets a `public-site` class on its scroll container.
- That class applies the font, the tokens and a fixed light color scheme (`color-scheme: light`), whatever the app theme is.
- The sign-in window and toasts keep the app's own styling.

## Motion (Magic UI)

**Source**
- The components are copied from Magic UI (MIT) into `src/components/magicui/`, with Magic UI's licence notice in `src/components/magicui/LICENSE`.
- Imports change from `motion/react` to the `framer-motion` 12 the app already has, so no dependency is added.
- File names follow the repo's kebab-case rule.

**Components used**
- Marquee: logo carousel and showcase rows.
- Border Beam: the build box.
- Typing Animation: the build box placeholder and the chat card.
- Animated List: hero build steps and the orders card.
- Number Ticker: cart total and seller earnings.
- Animated Beam: the creator flow.
- Blur Fade: section reveals.
- Safari and iPhone: device frames.

**Rules**
- **Reduced motion:** under `prefers-reduced-motion: reduce`, nothing moves:
  - marquees become rows you can scroll sideways;
  - typing shows the full text;
  - lists show every item;
  - tickers show the final number;
  - beams are static lines;
  - reveals are skipped.
- **Pausing:** marquees pause on hover and on keyboard focus inside them.
- **Screen readers:** the duplicate copies a marquee renders to loop are `aria-hidden`, so they hear each store once.
- **Off screen:** animations start when their section scrolls into view, and decorative loops stop while off screen.

## Pages

### Top of every public page

1. **Announcement bar** (gold, 13px, charcoal text): "Estori Discover is open: sell the stores you design and keep the price minus {PLATFORM_FEE_LABEL}." Its link, "Learn more →", goes to `/#creators`. On desktop, Sign in sits at its right; on phones the bar shows only the message, on one line, truncated.
2. **Top bar** (white):
   - the Estori logo;
   - Discover, Pricing, and "For creators" (`/#creators`);
   - Sign in, or "Open app" when signed in;
   - a blue pill, "Start building free". It scrolls to the build box on `/` and goes to `/` elsewhere.
   - On phones the three links move into a menu button.

### Landing page (`/`, signed out), top to bottom

1. **Hero** (charcoal):
   - The headline is "Build online stores with AI. Sell them as templates.", followed by the existing lead.
   - The build box keeps all of its behavior and gains a Border Beam. Its placeholder types the existing store phrases.
   - Below it: "Free to build. No credit card." and "Browse stores in Discover →".
2. **Builder demo:** a blue gradient frame overlaps the bottom of the hero, inset 24px. Inside it, a white app window has:
   - on the left, a chat with the prompt "Build a specialty coffee store with weekly roasts and subscriptions", followed by build steps appearing one by one: "Catalog with 12 roasts", "Product pages and filters", "Cart and checkout flow", "Order records", "Deployed to a live preview";
   - on the right, a Safari frame showing a store built on Estori, from a bundled image (`public/marketing/hero-store.jpg`, North Ridge). Its address bar reads "Live preview", not a made-up domain.
3. **Store logo carousel** (charcoal), labeled "Stores built on Estori":
   - store names as wordmarks, gray turning white on hover, each linking to its Discover page;
   - a marquee with faded edges;
   - wordmarks rotate through four type treatments by position, so the strip reads like a logo wall.
4. **Showcase** (charcoal, `id="discover"`):
   - Eyebrow "Discover", title "See what creators are building", lead "Every store here was built on Estori. Open one, see it live on desktop and phone, and make it yours."
   - Filter pills at the right: "All" plus each category present in the loaded stores, labeled from `TEMPLATE_CATEGORY_LABELS`. They are buttons with `aria-pressed`, and they really filter.
   - Two rows of tall cards (280×360, 220×280 on phones) scroll in opposite directions. Each card shows:
     - its showcase image;
     - a price badge: white with the price, or green "Free";
     - its category pill;
     - its title;
     - "by {creator}".
   - Cards link to `/discover/{id}` and zoom slightly on hover. "Browse all stores in Discover" sits underneath.
5. **Features** (charcoal):
   - Eyebrow "Estori store builder", title "Everything your store needs, from one description", the existing lead, and a "Start building" link.
   - Four white cards, each with a small live illustration, followed by a 30px title, the existing text and a link:
     - **Catalog and product pages:** a product grid;
     - **Cart and checkout flow:** a cart whose total ticks up;
     - **Order records:** orders arriving;
     - **Edit by chatting:** an edit being typed.
   - Below the cards: "Accept payments in your store", with its Coming soon badge.
6. **Creators panel** (blue inset panel, `id="creators"`):
   - Eyebrow "For creators", title "Design a store once. Earn every time it's used.", lead "Publish to Discover, set a price, and get paid through Stripe when someone starts from your store."
   - An Animated Beam flow: Your store (Published), Discover ($29), A buyer (Pays $29), You keep ($26.37). The kept amount is computed with `platformFeeCents`, and the price is a member of `TEMPLATE_PRICE_OPTIONS_CENTS`.
   - Buttons: a charcoal "Start selling" and an outline "How selling works" (`/pricing`).
   - The existing line about sellers being 18 or older with a connected Stripe account.
7. **Live preview** (white, two columns):
   - Left: a rounded panel with a store in Safari and iPhone frames, from bundled images (`public/marketing/preview-desktop.jpg` and `preview-phone.jpg`).
   - Right: eyebrow "Live preview", the large statement "See every change on desktop and phone before you share it.", then "Every store in Discover was built and published on Estori." and an outline "Browse Discover" button.
8. **Pricing summary** (white): the existing content, with the Free card on white and the Sell card on charcoal.
9. **FAQ** (white): the existing six questions, with the new type and dividers.
10. **Closing panel** (charcoal inset panel): "Your next store starts with a sentence.", the lead "Describe it, watch it build, and publish it when it's ready.", a white "Start building" pill with blue text, and an outline "View pricing".

### Footer (every public page, charcoal)

- **Four columns:**
  - Product: Start building, Discover, Pricing;
  - Creators: Sell your stores (`/#creators`), Seller fees (`/pricing`);
  - Legal: Terms, Privacy, Refunds, Copyright, from `LEGAL_LINKS`;
  - Contact: the three addresses from `LEGAL_CONTACT`.
- **Wordmark:** the Estori wordmark, 76px, white with the blue dot.
- **Bottom row:** the legal links again on the left; on the right, "© {year} {LEGAL_ENTITY.name} · {legalAddressLine}".

### Pricing page

- **Hero** (charcoal): eyebrow "Pricing", title "Free to build. Pay only when you sell.", and the existing lead.
- **Plan cards** (white section): the existing Build, Sell and Buy cards in the new card style. The Sell card is charcoal.
- **Seller table:** what the seller keeps, with the new type and dividers. It keeps the caption and column headers.
- **FAQ:** the existing questions.
- **Unchanged facts:** the limits, the fee, the credit-rate note and the Coming soon line. The pricing guard tests already cover them.

### Legal pages

- White, with a 720px reading column.
- Eyebrow "Legal", title at 48px weight 300, and the version and updated date under it.
- Markdown rendered with the typography plugin, restyled to DM Sans: 17px body, 1.7 line height, underlined links.

## Data

**One query**
- A new hook, `useShowcaseStores()`, calls `getPublicApps({ sort: 'popular', limit: 24, reusableOnly: true })`.
- It returns the stores with their `showcaseScreenshotUrl`, `screenshotUrl`, `category`, `priceCents` and `userName`.
- The logo carousel and the showcase share it.

**Visibility**

| Section | Counts | Hidden when the count is |
|---|---|---|
| Logo carousel | stores in the result | 2 or fewer |
| Showcase | stores with a showcase or desktop screenshot | 2 or fewer |

**Rows**
- With "All" selected, row 1 shows the stores in popularity order and row 2 in reverse.
- When a filter leaves 3 stores or fewer, the cards show as one static row with no marquee.

**Wordmarks**
- A store's wordmark is its title, with trailing generic words removed: Store, Shop, Website, Site, Landing Page, Template, Theme. Matching ignores case, and the first word always stays. So "North Ridge Coffee Store" becomes "North Ridge Coffee" and "Lumen Yoga Studio Website" becomes "Lumen Yoga Studio".
- This lives in `src/lib/store-wordmark.ts`, with unit tests.

**Card image**
- A card uses `showcaseScreenshotUrl`. If that's missing, it uses `screenshotUrl` positioned at the top left.

## Tall screenshots (server)

- **Capture:**
  - viewport 1280×1650, JPEG, through the existing browser capture client (`getBrowserCaptureClient`);
  - the same settle and timeout as template submission shots;
  - the viewport is a new `SHOWCASE_VIEWPORT` constant next to `DESKTOP_VIEWPORT` in `capture-core.ts`.
- **Storage:**
  - R2 key `screenshots/{appId}/showcase.jpg`, served by the existing `/api/screenshots/:id/:file` route (`.jpg` is already allowed), with the same signed access token;
  - a new nullable column, `apps.showcase_screenshot_url` (migration 0013);
  - `ScreenshotSecurity` signs it like `screenshotUrl`;
  - `PublicAppListData` gains `showcaseScreenshotUrl`.
- **When it's captured:**
  1. When a store is published publicly with reuse turned on, after the visibility change succeeds. It runs in the background (`ctx.waitUntil`), so publishing never waits on it or fails because of it.
  2. After a deploy, when the Think agent refreshes the thumbnail of an app that is public and reusable. It's taken right after the desktop thumbnail, from the same preview URL.
  3. From an admin action. A "Refresh showcase images" button in the admin area recaptures every public, reusable store, one at a time, at most 50 per click, and reports how many succeeded and how many failed. The endpoint is `POST /api/admin/showcase-screenshots/refresh`, for admins only.
- **Failure:** a failed capture is logged and keeps the previous image, if there is one. A blank-page check uses the existing `detectBlankScreenshot`, and a blank capture isn't stored.

## Testing

- **Unit:**
  - wordmark trimming;
  - store selection and the 2-or-fewer rule;
  - the row split and the static-row rule;
  - the creator flow's kept amount for $29, which equals the price minus `platformFeeCents`.
- **Guard (raw source):**
  - the public layout applies `public-site` and preloads the font only there;
  - DM Sans and its licence ship in `public/fonts/dm-sans/`;
  - Magic UI files carry the licence and import `framer-motion`, not `motion/react`;
  - every animated component checks reduced motion;
  - marquee duplicates are `aria-hidden`;
  - the landing page has no third-party logos and names no competitor;
  - the logo carousel and showcase read Discover data and hide at 2 or fewer;
  - the fee and limits still come from the code;
  - "Accept payments" still says Coming soon;
  - the existing landing, pricing and public-page guards are updated where the layout changed. Their rules stay.
- **Worker:**
  - the migration adds the column;
  - publishing a public, reusable store schedules a showcase capture;
  - a failed capture doesn't fail the publish;
  - the post-deploy capture runs only for public, reusable apps;
  - the admin refresh is admin-only and capped at 50.
- **Live, local:**
  - every public page at 1440px and 390px wide, in light and dark app themes;
  - reduced motion turned on;
  - the showcase with 0, 2, 3 and 8 or more stores;
  - the filters;
  - sign-up from the landing build box still keeps the prompt.

## Out of scope

- Restyling the signed-in app.
- Seeding Discover with stores. The owner does this before launch.
- Real customer logos or testimonials. Add them only with each customer's permission.
- A product video.
- Page pre-rendering for search engines.

## Owner steps

1. Seed Discover with 8 or more public, reusable stores across categories.
2. After deploying, click "Refresh showcase images" once in the admin area.
3. If you'd rather the hero and live-preview images show different stores, swap the bundled images in `public/marketing/`.

## Decisions made while writing this spec

1. **Tall screenshots are captured on public publish, on deploy and by an admin, not on approval.** Free stores go public without any review, so approval would miss them. Cost if wrong: a few extra captures per deploy for public stores.
2. **The hero and live-preview sections use bundled images, not Discover data.** These sections must render even with an empty Discover, and their copy names no specific store. Cost if wrong: the images can drift from what Discover shows until someone swaps them.
3. **Discover's showcase anchor is `#discover` and the creators panel's is `#creators`.** The "For creators" link has no page of its own yet. Cost if wrong: one more link to change later.
4. **Sign in appears in the announcement bar on desktop and in the top bar on every size,** as in the approved mockup. Cost if wrong: two Sign in links on desktop.
5. **Wordmarks use the store title with generic endings trimmed,** since stores have no separate brand name. Cost if wrong: an odd wordmark until the creator renames the store.
