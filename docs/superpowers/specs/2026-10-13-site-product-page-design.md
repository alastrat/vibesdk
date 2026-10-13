# Product pages for Discover sites

Status: designed with the owner on 2026-10-13. It builds on these specs:
- `2026-10-12-unified-discover-design.md`: one Discover gallery, and paid sites reviewed by an admin;
- `2026-10-12-stripe-connect-payments-design.md`: Stripe Checkout and the 5% fee.

## What the owner asked for

Before a buyer is sent to Stripe, they should see a page that describes the site they are about to buy, like a marketplace template page. The references were:
- Framer's Lofty template;
- Shopify's Pebble/Wellina theme;
- Webflow's Syntra Pro template.

## Decisions

| Question | Decision |
|---|---|
| Where the page lives | Its own public, shareable page per site: `/discover/:appId` |
| Which sites get one | Every Discover site, free and paid |
| Who writes the text | AI drafts it from the site; the creator edits it before saving |
| Review | Free sites' text goes live on save. Paid sites' text is part of the version an admin reviews with the price, so the page shows the approved version's text. |
| Top of the page | The live site in a device frame, with a Desktop/Phone toggle |

## What people see

### Getting there

- Discover cards and the home page's Discover strip open `/discover/:appId`, not the workspace (`/app/:id`).
- On a paid site's app page, "Buy for $X" opens the product page instead of starting Stripe Checkout.
- "Use this site" on a free site's app page keeps opening the existing dialog in place.
- Links in the profile, the admin pages and "Started from" keep pointing at `/app/:id`.

### The main button

The button is chosen from what the visitor can do:

| Visitor and site | Main button |
|---|---|
| Free site | "Use this site" opens the existing Use site dialog |
| Paid site with an approved price, not yet owned | "Buy for $X" starts Stripe Checkout, and the return lands on `/app/:id` as today |
| Paid site the visitor bought | "Use this site" |
| The visitor's own site | "Use this site", plus "Edit page", which opens the publish dialog on the app page |
| Paid site whose first price isn't approved yet | "Not available yet", disabled |
| Signed-out visitor | The same buttons; acting on one asks them to sign in first, as today |

A secondary button, "Open live site ↗", opens the live preview in a new tab.

### Layout, top to bottom

1. **Header:**
   - the title and the tagline;
   - "{Category} template by {creator}";
   - the price, or "Free";
   - the main button and "Open live site".
2. **Live site:**
   - The deployed site, scrollable and clickable, in a device frame with a Desktop/Phone toggle.
   - Desktop renders the site at 1280 px wide, scaled to fit; Phone renders it at 390 px.
   - If the preview fails to load, the site's screenshot is shown instead, with "Open live site".
3. **Two columns:**
   - **Left:**
     - About, as paragraphs;
     - Features, as a list;
     - What's included: pages or sections, each a name and one line;
     - Made for, as short items.
   - **Right, a details card:**
     - the creator's avatar and name, category and price;
     - uses, views and likes;
     - published and last updated dates;
     - for paid sites, the approved version's desktop and phone screenshots;
     - "What you get: your own copy of the full site, which you can keep editing with the AI";
     - for paid sites, "Secure checkout with Stripe".
4. **More from this creator:** up to 4 of the creator's other Discover sites, each linking to its own product page. The section is hidden when there are none.
5. **Sticky bar:** when the header's main button scrolls out of view, a slim bar pinned to the bottom of the screen shows the title, price and main button.

### Fallbacks

- A site with no saved text shows its existing `description` as About; Discover already shows it publicly. The page then leaves out Features, What's included and Made for, and has no tagline.
- A private, removed or deleted site, or one never published, gets a page that reads "This site isn't available", with a link back to Discover.

## Page text

### Shape and limits

Everything is plain text. The page renders it as text, never as HTML or markdown.

| Field | Rule |
|---|---|
| `tagline` | 1–90 characters |
| `about` | 1–3 paragraphs, 1,200 characters in total |
| `features` | 3–8 items, each 1–80 characters |
| `includes` | 1–12 items, each `{ name: 1–40, detail: 1–100 }` characters |
| `madeFor` | 2–5 items, each 1–40 characters |

Every value is trimmed, collapses repeated whitespace, and has control characters removed.

Validation happens in two places with the same rules: one shared function on the server, and the same function in the dialog. Both the AI output and the creator's edits go through it.

### Drafting

- **Endpoint:** `POST /api/apps/:id/page-copy/draft`, owner only.
- **Rate limit:** at most 10 drafts per user per hour, through the existing rate-limit service with a new route key.
- **What the AI sees** (read on the server):
  - the title, category and the site's `description` (its original build prompt);
  - the latest deployed tree: the full list of file paths, plus the text of the main page and component files (`.html`, `.tsx`, `.jsx`, `.ts`, `.vue`, `.svelte`).
  - The entry files go first (`index.html`, `src/App.*`, `src/main.*`), then pages, then components. Styles, configs, lockfiles and assets are left out, and the total is capped at 40 KB.
- **Model:** a new AI operation, `sitePageCopy`, in `AGENT_CONFIG`. It is a fast, inexpensive model through the existing AI Gateway, with structured output validated against the shape above.
- **Instructions to the model:**
  - describe only what the files show;
  - never claim features, integrations, a CMS, support, prices or contact details that aren't in the files;
  - write for someone deciding whether to start their own site from this one.
- **Validation:** if the output fails validation, the server asks once more. If it fails again, it returns 502 "Couldn't draft this page; write it yourself or try again".
- **Result:** the endpoint returns the draft and saves nothing. The text is saved only when the creator publishes.

### Editing in the publish dialog

- **New "Page" section,** below category and price, with:
  - a Tagline field;
  - an About field;
  - list editors for Features, What's included and Made for, where lines can be added, removed and reordered.
- **First draft:**
  - The first time the dialog opens for a site with no saved text, it requests a draft automatically and shows "Drafting…".
  - It drafts only while the dialog is set to make the site public; a private save doesn't need page text.
- **"Redraft with AI"** replaces all fields. If the creator has edited anything since the last draft, it asks for confirmation first.
- **Limits:** each field shows its count against its limit, and Publish is disabled while a field breaks a rule.
- **When drafting fails,** the fields stay as they were, with "Couldn't draft this; write it yourself or try again". Publishing still works, and page text is optional.

### Saving and review

- **Request:** `PublishSiteRequest` gains an optional `pageCopy`, validated with the shared rules (400 naming the field).
- **Free public site:** the text is saved to the site's page row and goes live at once.
- **Paid site:**
  - The text is saved to the site's page row, which holds the creator's latest text, and attached to the version submitted for review.
  - A change to the text counts like a price change. `planPublish` submits a new version for review even when the price is unchanged; the version is built from the latest deploy, as paid updates already are.
  - "Send update for review" also attaches the creator's latest text.
- **What a paid site's page shows:** the text of the listing's current approved version. While a newer version is in review, the page keeps showing the approved text, and the dialog says "Your page text is in review".
- **Admin review:**
  - Each item in `/admin/reviews` shows the submitted text next to the price and screenshots.
  - The text appears in the same plain-text rendering the page uses.
  - A rejection reason can point at the text.
- **Paid site switched to free:** the page shows the creator's latest saved text, since free sites have no review.

## Architecture

### Data (migration 0011)

- **New table `site_pages`:**
  - `app_id`: primary key, references apps, cascade delete;
  - `copy`: JSON text in the shape above;
  - `drafted_at` and `updated_at`.
- **`template_versions` gains `page_copy`:** JSON text, nullable. It holds the text submitted with that version; older versions have none.

### Server

- **Shared text rules:** a pure module, `shared/types/site-page.ts`, holds the type, the limits, and `normalizePageCopy` and `validatePageCopy`. Both the worker and the frontend import it; the frontend imports through `@/api-types`.
- **Draft input:** a pure function, `worker/services/site-pages/draft-input.ts`, picks and trims the files.
- **Drafting call:** a function in `worker/services/site-pages/draft.ts` builds the AI call with `executeInference` and the `sitePageCopy` operation.
- **Page assembly:** a pure function, `worker/services/site-pages/page.ts`, builds `SitePageData` from:
  - the app, creator, listing, approved version, purchases and stats;
  - the viewer.
  It also decides the main-button state.
- **`SitePageService` (D1):** gets and saves the page row, and reads the creator's other Discover sites.
- **Page route:** `GET /api/discover/:appId`, public.
  - It returns `SitePageData`.
  - It records a view the same way the app details page does, once per visitor hash.
  - It returns 404 "This site isn't available" for private, removed or missing sites.
  - It never returns source code, the generated files, or internal moderation and provenance fields.
- **Screenshot route:** `GET /api/discover/:appId/screenshots/:kind`, public, where `kind` is `desktop` or `phone`.
  - It serves the current approved version's screenshot from R2, but only while the paid listing is listed and has an approved version.
  - URLs carry the version id, so images can be cached for a long time with `Cache-Control: public, max-age=86400`.
- **Draft route:** `POST /api/apps/:id/page-copy/draft`, owner only, rate-limited.
- **Publishing:** `publishSite` and `submitPaidUpdate` accept and attach the text as described in "Saving and review".

### Frontend

- **Data plumbing:**
  - types re-exported from `@/api-types`;
  - client methods in `src/lib/api-client.ts`;
  - query keys;
  - hooks in `src/hooks/use-site-page.ts`.
- **Page:** a new route, `src/routes/discover/site.tsx`, at `/discover/:appId`. It works signed in or out.
- **Components** in `src/components/site-page/`:
  - the header with its buttons;
  - the device-frame preview with the toggle;
  - the text sections;
  - the details card;
  - "More from this creator";
  - the sticky bar, which appears when an IntersectionObserver sees the header button leave the viewport.
- **Publish dialog:** gains the "Page" section with field limits, list editors, auto-draft and redraft.
- **Links:** Discover cards and the home page's Discover strip link to `/discover/:appId`. A paid site's app-page "Buy" button navigates to `/discover/:appId`.
- **Admin:** the reviews page shows each version's text.

## Error handling

| Case | Behavior |
|---|---|
| Site private, removed, missing or never published | 404, "This site isn't available", with a link to Discover |
| Draft: AI error or invalid output after one retry | 502, "Couldn't draft this page; write it yourself or try again" |
| Draft: rate limit reached | 429, with the existing rate-limit message |
| Draft: not the owner | 403 |
| Saved text breaks a rule | 400, naming the field |
| Screenshot requested for a free, unlisted or unapproved site | 404 |
| Live preview fails to load | The site's screenshot, with "Open live site" |
| Page data fails to load | An error message with "Try again" |

## Testing

- **Unit:**
  - text normalization and every limit, both sides of each boundary;
  - the main-button decision for free, paid, owned, own and not-yet-available, signed in and out;
  - page assembly, including the fallback to `description` and the approved text over the latest text for paid sites;
  - draft input: file choice, order, exclusions and the 40 KB cap;
  - `planPublish` submitting a version when only a paid site's text changed.
- **Wiring:**
  - the page and screenshot routes are public, and the draft route is owner-only and rate-limited;
  - Discover cards and the home strip link to `/discover/:appId`;
  - the app page's paid Buy button navigates to the product page;
  - the product page's Buy button starts Checkout;
  - the reviews page renders the version text.
- **Live, local:**
  1. Draft North Ridge's text, edit it, and send it for review. The page keeps the approved text until the admin approves, then shows the new text.
  2. Publish a free site with text: its page shows the text at once.
  3. Open a page signed out: it works, and buying asks the visitor to sign in.
  4. A buyer goes from a Discover card to the product page, through Stripe test checkout, and back to the app page as "Use this site".
  5. A site removed from Discover shows "This site isn't available".
  6. With the AI unavailable, the dialog shows the draft error and publishing still works.

## Out of scope

- **Link previews:** shared links show Estori's generic social preview, because the app is a single-page app.
- **Ratings and reviews,** tags beyond category, and "similar templates" from other creators.
- **Readable addresses:** pages use `/discover/:appId` rather than a slug.
- **Several screenshots or video** in the header.
- **Translating page text.**
