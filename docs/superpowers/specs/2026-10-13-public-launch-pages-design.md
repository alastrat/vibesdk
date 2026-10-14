# Landing, pricing and legal pages

Status: designed with the owner on 2026-10-13. This is part 1 of 3 of opening estori.app to the public:
1. landing, pricing and legal pages (this spec);
2. account basics: email sending for password reset and email verification, real account deletion, and removing the leftover debug email address;
3. opening the site: cleaning up test data, reviewing limits and the AI budget, optionally Google sign-in, and turning off Cloudflare Access.

It builds on:
- `2026-10-12-unified-discover-design.md`: Discover, and the rule that copies of paid sites stay private;
- `2026-10-12-stripe-connect-payments-design.md`: Stripe Connect and the 7% + $0.60 fee;
- `2026-10-13-site-product-page-design.md`: product pages.

## What the owner asked for

A landing page, with pricing and the legal pages needed to be compliant, so that estori.app can be opened to the public.

The positioning:
- **Creators first:** people who build online stores with AI and sell them as templates.
- **Then store builders:** people who want an online store of their own. Estori is mostly for building complete e-commerce sites.
- **No competitors** are named anywhere.

## Decisions

| Question | Decision |
|---|---|
| What pricing sells | Building is free within daily limits. Estori earns 7% + $0.60 per paid-site sale. No subscriptions or credits are sold. |
| Where the landing page lives | estori.app/ for signed-out visitors. Signed-in users keep today's builder home. |
| How it's built | Pages inside the existing app (approach A). Legal texts are Markdown files in the repo. Pre-rendering for SEO can come later. |
| Store payments | Generated stores can't take real payments yet. The pages describe what works today and label "Accept payments" **Coming soon**. |
| Operator | Globalink Commerce Technologies LLC, a Texas limited liability company, 206 Gray Street, Unit 3112, Houston, TX 77002. |
| Law and courts | Texas. |
| Contact | support@estori.app, privacy@estori.app and copyright@estori.app, forwarded with Cloudflare Email Routing. The owner turns that on before launch. |
| Minimum age | 18, for everyone. |
| Refunds on paid sites | Final, except when the site can't be used or the buyer was charged twice. Requests go by email within 14 days. |
| Agreeing to the terms | A required, unticked checkbox at sign-up, and a one-time window for anyone signed in who hasn't agreed to the current version. The agreement time and version are recorded. |
| Legal review | The owner has no lawyer yet. The texts follow standard practice; a lawyer's review is recommended before live payments. |
| Language | English. |

## What people see

### Landing page (`/`, signed out)

**Top bar:** Estori logo · Discover · Pricing · Sign in · **Start building**. Signed-out visitors see no app sidebar.

**Sections, top to bottom:**
1. **Hero, for creators first.**
   - Headline: "Build online stores with AI. Sell them as templates."
   - Subhead: "Describe a store and Estori builds and deploys it: catalog, cart, checkout flow and order records. Publish it to Discover and earn when others start from it."
   - Main action: the existing build box, with the placeholder "Describe the store you want to build…". Submitting asks the visitor to sign up, then starts the build, as the home page does today.
   - Second action: "Browse stores in Discover", linking to `/discover`.
2. **Featured stores:** up to 6 popular sites that can be copied, from the existing Discover list and cards. Each links to its product page. The section is hidden when there are none.
3. **Sell your store designs**, in three steps:
   1. build a store;
   2. publish it with a price, which an Estori admin reviews;
   3. get paid through Stripe. Estori keeps 7% + $0.60 per sale.

   A note says sellers must be 18 or older and connect a Stripe account.
4. **Launch your own store:**
   - start from a store in Discover or from scratch;
   - change it by chatting;
   - preview it on desktop and phone.

   It lists what's included today: catalog, product pages, cart, checkout flow, order records and a live preview. "Accept payments" carries a **Coming soon** label.
5. **Pricing summary:** "Free to build" with the daily limits, and "Selling: 7% + $0.60 per sale", linking to `/pricing`.
6. **FAQ:**
   - Is Estori free?
   - Can my store take payments? (Not yet; coming soon.)
   - Who owns the site I build? (You do.)
   - Can I resell a site I bought? (No.)
   - What does Estori charge sellers?
   - What if a site I bought doesn't work?
7. **Footer:**
   - © {year} Globalink Commerce Technologies LLC;
   - links: Pricing · Terms · Privacy · Refunds · Copyright;
   - support@estori.app.

**Signed-in users** see today's builder home at `/`. The bottom of the app sidebar gains the same legal links.

**Wording rule:** no page claims that generated stores take real payments, and no page names a competitor.

### Pricing page (`/pricing`)

Heading: "Free to build. Pay only when you sell." The page has three cards.

1. **Build: Free**
   - Up to {newSitesPerDay} new sites a day.
   - {aiCreditsPerDay} AI credits a day for building and editing. Each model uses credits at its own rate, so lighter models go further.
   - Change your site by chatting, with a live preview on desktop and phone.
   - Publish to Discover, or start from any free site there.
   - "Accept payments in your store": **Coming soon**.
2. **Sell: 7% + $0.60 per sale**
   - Prices of $9, $19, $29 or $49. An Estori admin reviews the price before buyers can use the site.
   - Buyers pay by card through Stripe. The seller receives the rest automatically through Stripe, on Stripe's payout schedule.
   - A table shows what the seller keeps at each price: $9 → $7.77, $19 → $17.07, $29 → $26.37, $49 → $44.97.
   - Sellers need a Stripe account and must be 18 or older.
3. **Buy a store design: one-time price**
   - Your own copy to adapt for your own store.
   - You can't republish or resell it.
   - Refunds apply if it can't be used, with a link to `/refunds`.

Prices are in USD.

**Where the numbers come from:**
- The fee, the price options and the "you keep" amounts come from `shared/types/templates.ts`: `PLATFORM_FEE_LABEL`, `TEMPLATE_PRICE_OPTIONS_CENTS` and `platformFeeCents`.
- The daily limits come from `GET /api/limits/plan`.
- If that endpoint fails, or a limit is turned off, the page leaves the limit line out instead of showing a number.

### Legal pages

Each page shows its title, "Last updated {date}" and the text. All four share one layout with the public top bar and footer.

#### Terms of Service (`/terms`), including acceptable use

**The agreement and who can use Estori**
- The agreement is with Globalink Commerce Technologies LLC, which runs Estori at estori.app.
- Users must be 18 or older and keep their account secure.

**The service**
- Estori builds and hosts websites with AI.
- AI output can be wrong or incomplete; users check it before relying on it.
- Users are responsible for their sites, including any terms and privacy notice their own stores need for their visitors.
- Daily limits apply and can change.

**Ownership**
- Users own their content and sites.
- Users give Estori the license it needs to host, run, copy, back up and display them. That covers showing public sites and their screenshots in Discover.

**Publishing to Discover**
- Making a site public with "Others may copy and adapt this site" lets any user start their own site from it.
- Estori admins may remove a site from Discover.

**Paid sites**
- A buyer gets a non-exclusive, non-transferable license to adapt the site for their own use.
- A buyer may not republish, resell or redistribute it, or offer it as a template. Estori enforces this by keeping copies of paid sites private.
- A seller confirms they have the rights to everything in the site.

**Marketplace and payments**
- An Estori admin reviews each price.
- Estori's fee is 7% + $0.60 per sale. Estori may change it with 30 days' notice.
- Estori is the merchant of record.
- Payment processing for sellers is provided by Stripe and subject to the Stripe Connected Account Agreement, which includes the Stripe Terms of Service (the "Stripe Services Agreement"). By agreeing to Estori's terms or continuing to receive payouts, sellers agree to it, and authorize Estori to share their information and transactions with Stripe.
- Refunds and chargebacks are deducted from the seller's share.
- Sellers handle their own taxes on what they earn.

**Acceptable use.** These are banned:
- illegal content and content that infringes others' rights;
- deceptive sites: phishing, fake stores, impersonating real businesses or people, and collecting payment or login details under false pretenses;
- malware;
- harassment and hateful content;
- sexual content involving minors;
- spam;
- interfering with or overloading the service;
- getting around limits or access rules;
- scraping;
- reselling access to the service.

**Removal and suspension**
- Estori may remove content or suspend accounts that break the terms.
- Repeat copyright infringers lose their accounts.

**Legal basics**
- Disclaimers: the service is provided "as is".
- Limitation of liability: capped at the greater of $100 or what the user paid Estori in the last 12 months.
- Indemnity.
- Termination, by the user at any time or by Estori for breach.
- Changes: material changes are announced and require agreeing again.
- Texas law, and the state and federal courts in Harris County, Texas.
- Contact.

#### Privacy Policy (`/privacy`)

Written from the inventory of what the code does as of 2026-10-13.

**Who.** Globalink Commerce Technologies LLC controls the personal data Estori collects.

**What Estori collects**
- **Account:** email, name, username, avatar, a password hash, and sign-in provider details.
- **Sign-in and security:** IP address, browser and device details, sessions, sign-in attempts and security logs.
- **Content:**
  - prompts and chat messages;
  - generated site files and their history;
  - uploaded images;
  - product page text, comments and screenshots;
  - stars, favorites and likes.
- **Marketplace:**
  - purchases and their amounts;
  - sellers' Stripe account IDs.

  Card details go to Stripe and Estori never stores them.
- **Site views:** a one-way hash of the viewer, used to count views once.

**How it's used:**
- to run the service and build sites;
- for security and preventing abuse;
- to process payments and payouts;
- to support users;
- to meet legal obligations.

**Who receives it**
- Service providers, only to run Estori:
  - **Cloudflare:** hosting, storage, AI routing, browser rendering for screenshots and reference pages, and logs.
  - **Anthropic and Google:** AI generation. Prompts, site files and images are sent to the model the user chooses, or to the fallback model.
  - **Stripe:** payments and seller onboarding.
  - **GitHub:** only when a user exports.
- Public content: public sites, their creator's name and their product pages are visible to everyone.
- Legal requests, and a business transfer.
- **No selling, and no sharing for advertising.**

**Cookies and browser storage**
- Essential cookies: sign-in session, CSRF protection, sign-in with other providers, and preview access.
- Preferences saved in the browser: theme, sidebar and sort order.
- A temporary cache of pages the user has viewed.
- No advertising or analytics cookies, so there's no cookie banner.

**Retention**
- An account's data is kept while the account exists.
- Security logs are kept for a limited period.
- Deleted data is removed from backups on their normal cycle.

**Rights**
- Anyone can ask to see, correct, export or delete their data by writing to privacy@estori.app. Estori answers within 45 days.
- EU/UK (GDPR) users also get objection, restriction, portability and complaint rights, and the legal bases are stated.
- California and Texas rights are covered.
- Users can appeal a refused request.

**Also covered**
- **International transfers:** data is processed in the US.
- **Security:** encryption in transit, and limited access.
- **Children:** not for anyone under 18.
- **Users' own stores:** Estori stores their visitors' data on the user's behalf, and the user is responsible for their store's own notice.
- **Changes and contact.**

#### Refund policy (`/refunds`)

**When a refund applies.** Sales of paid sites are final, except when:
- the site can't be copied or doesn't load after purchase and Estori can't fix it;
- the buyer was charged twice for the same site.

**How to ask.** Email support@estori.app within 14 days, with the site and the purchase email.

**What happens next**
- Refunds go back to the original card.
- The seller's share of a refunded sale is reversed.
- Estori may revoke access to a refunded site.

#### Copyright policy (`/copyright`)

**Reporting infringement.** Send a DMCA notice to the designated agent:
- copyright@estori.app;
- Globalink Commerce Technologies LLC, at the Gray Street address.

The notice must include the required elements.

**After a notice**
- **Counter-notices:** how to file one.
- **Repeat infringers:** they lose their accounts.
- **False notices:** they can carry legal liability.

### Agreeing to the terms

**Sign-up**
- The sign-up form gains a required, unticked checkbox: "I'm 18 or older and agree to the Terms of Service and Privacy Policy", with both linked.
- Create account stays disabled until it's ticked.

**The one-time window.** Anyone signed in who hasn't agreed to the current terms version sees it on any page. That covers:
- accounts created before this change;
- accounts created through Google or GitHub;
- everyone, after a version bump.

The window:
- shows "We've published our Terms of Service and Privacy Policy", with links;
- has the same checkbox, a **Continue** button and **Sign out**;
- can't be dismissed.

## Architecture

### Shared

`shared/types/legal.ts` holds:
- `TERMS_VERSION`, a date string such as `2026-10-13`;
- `LEGAL_ENTITY`: name, kind (Texas limited liability company), street, city, state, zip;
- `LEGAL_CONTACT`: support, privacy and copyright addresses;
- `TERMS_REQUIRED_MESSAGE` = "Agree to the Terms of Service and Privacy Policy to create an account".

The frontend imports them through `@/api-types`.

### Data (migration 0012)

`users` gains:
- `terms_accepted_at`, a timestamp, nullable;
- `terms_version`, text, nullable.

Existing rows stay null, so their users see the window.

### Server

**Sign-up**
- Email sign-up takes `acceptedTermsVersion`.
- If it isn't `TERMS_VERSION`, sign-up is refused with 400 `TERMS_REQUIRED_MESSAGE` before an account is created.
- Otherwise the account is created with `terms_accepted_at` = now and `terms_version` = `TERMS_VERSION`.

**The signed-in user's data** (the auth profile and session user) gains `termsAccepted: boolean`. It's true when `terms_version === TERMS_VERSION`.

**`POST /api/auth/accept-terms`** with `{ version }`:
- needs a signed-in user;
- refuses with 400 when the version isn't current;
- records the time and version;
- returns the updated user.

**`GET /api/limits/plan`**
- Public, and rate limited per client like the other public endpoints.
- Reads `getGlobalConfigurableSettings(env)`.
- Returns `{ newSitesPerDay: number | null, aiCreditsPerDay: number | null }`. A value is null when that limit is turned off.

### Frontend

**Layout and components**
- `PublicLayout`: a top bar, `SiteFooter` and the page content.
- `SiteFooter` holds the legal links, © with the entity name, and the support address. The sidebar gets a compact version of the links.

**Routes**
- `/`: `LandingPage` when signed out, the existing `Home` when signed in. While sign-in state loads, it shows the app's existing loading state, not the landing page.
- `/pricing`, `/terms`, `/privacy`, `/refunds` and `/copyright`: public, in `PublicLayout`.

**Landing page**
- `src/routes/landing/`: the landing page and its sections.
- It reuses the build box from the home page; that code is extracted into a shared component, not copied.
- It reuses the Discover list hook and card.

**Legal pages**
- Texts in `src/content/legal/{terms,privacy,refunds,copyright}.md`. Each starts with a header carrying the title, the version and the last-updated date.
- Imported raw and rendered by one `LegalPage` component through the app's existing Markdown renderer.
- Named fields such as `{{entity.name}}`, `{{entity.address}}` and `{{contact.privacy}}` are filled from `shared/types/legal.ts`, so the name and addresses are defined once.

**Agreeing to the terms**
- The sign-up form gets the checkbox and sends `acceptedTermsVersion`.
- `TermsGate` sits at the app root and shows the one-time window when `user && !user.termsAccepted`. It calls the accept endpoint and refreshes the user.

**Each page** sets its `<title>` and meta description.

### Known gap

Someone using the SDK or API without the web app never sees the window. The terms still bind them through use. Enforcing agreement on the API is out of scope.

## Error handling

| Case | Behavior |
|---|---|
| Sign-up without the current terms version | 400 `TERMS_REQUIRED_MESSAGE`, shown in the sign-up form; no account is created |
| Agreeing with an outdated version | 400; the window reloads the current version |
| The agree request fails | The window shows the error with **Try again** |
| `GET /api/limits/plan` fails or returns null | The pricing page and landing page leave the limit line out |
| The Discover list fails or is empty on the landing page | The featured stores section is hidden |
| A legal file is missing its header | Caught by a test at build time, not at runtime |

## Testing

### Unit

- Sign-up is refused with no version or an old version, and records both fields with the current one.
- The accept-terms endpoint records the agreement, refuses old versions and needs sign-in.
- `termsAccepted` is true only for the current version.
- The plan endpoint returns the limits in force, reads overrides through `getGlobalConfigurableSettings`, and returns null for a limit that's turned off.
- The pricing table's "you keep" amounts equal the price minus `platformFeeCents` for every price option.
- The legal text fills every named field, and fails a test when a field is unknown.

### Wiring and guard tests

- The public routes aren't wrapped in `ProtectedRoute`.
- `/` picks the landing page or home by sign-in state.
- The footer and sidebar link to all four legal pages.
- Each legal file has a version and a last-updated date, names the entity, and gives the right contact addresses.
- The landing page and the pricing page say "Coming soon" for store payments.
- The landing copy and the pricing copy name no competitor from a listed set.
- The sign-up form can't submit without the checkbox.
- The terms window is mounted at the app root.

### Live, local

1. Signed out, `/` shows the landing page, and the build box asks the visitor to sign up.
2. Sign-up needs the checkbox. The new account isn't shown the window.
3. An existing account is shown the window once, and after agreeing it isn't shown again.
4. The pricing page's numbers match the local configuration.
5. The pages work in dark and light themes and at phone width (390 px).
6. Signed in, `/` is still the builder home, and the sidebar shows the legal links.

## Launch checklist (owner, outside the code)

- Turn on Cloudflare Email Routing for support@, privacy@ and copyright@estori.app.
- Register the DMCA designated agent with the US Copyright Office, naming copyright@estori.app and the Gray Street address.
- Have a lawyer review the texts before taking live payments.
- Before live payments, decide on sales tax and VAT for digital sales; Stripe Tax is one option. Estori is the merchant of record, and EU VAT on digital sales applies from the first sale.

## Out of scope

- Account deletion, password reset and email verification: part 2.
- Turning off Cloudflare Access and cleaning up test data: part 3.
- Paid plans, credits, and payments inside generated stores.
- Pre-rendering for SEO, link previews for each page, and translations.
- A cookie banner: none is needed while there are no non-essential cookies.
