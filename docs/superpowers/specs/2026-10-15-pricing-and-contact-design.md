# Pricing, credits calculator and contact sales

Date: 2026-10-15. Requested overnight by the owner; built without a review round, so every decision taken on the owner's behalf is listed under Rulings.

## What the owner asked for

1. A pricing page like 1Password's business pricing, with two plans: **Basic** (free) and **Premium** (99 USD). Each plan shows the credits it comes with; on Premium the visitor can change the credits amount.
2. Below the two plans, an **Enterprise** plan with no public price and a **Talk to sales** link to a contact page.
3. A **Compare plans** section like Apollo's, whose column headers stay pinned while scrolling.
4. A **What are Estori credits?** section like Apollo's, with a button to a **credits calculator** page modelled on apollo.io/pricing/calculator, fully functional.
5. A **contact sales** page like 1Password's, with a section like their illustration of a person walking toward a glowing globe beside a customer quote, adapted to Estori. The form must work, and the person who sends it gets an email saying we'll be in touch.
6. Then: plan the signup work, without building it.

## References studied

- 1Password business pricing: two plan cards in one frame, then "Additional ways to buy", a comparison table and an FAQ.
- Apollo pricing: a comparison table with sticky plan headers (name, price, credits, button) and grouped rows; a credits section with a coin and a list of what each action costs.
- Apollo calculator: step 1 seats, step 2 usage by category (each with its formula, for example "375 × (2 + 8) credits = 3,750 credits/month"), and a pinned panel with the recommended plan, credits needed against credits included, the price and buttons.
- 1Password contact sales: a heading and a stats card on the left, a form card on the right.

## Design

### Credits, one source of truth (`src/lib/credits.ts`)

- AI credits already exist in the product: each AI step costs its model's `creditCost` (served by the public `GET /api/capabilities`), and Basic accounts get a daily allowance served by `GET /api/limits/plan` (`aiCreditsPerDay`, `newSitesPerDay`).
- The pricing page, the credits section and the calculator read the same table of **actions** (`CREDIT_ACTIONS`), priced at the live model rate, so the three never disagree.
- The calculator's maths are pure functions with unit tests: credits per category, the monthly total, and the recommended plan.

### Plans (`src/lib/plans.ts`)

- **Basic**, free: the live daily allowance from the API, shown as credits a day and new stores a day.
- **Premium**, from 99 USD a month: a pool of monthly credits chosen from tiers. The first tier is 99 USD; picking a larger tier updates the price on the card.
- **Enterprise**: custom credits and terms, no public price, Talk to sales.
- The comparison table keeps the capability rows the page already had (built-in features available today, coming-soon features tagged by the capability registry) mapped to the three plans.

### Pages

- `/pricing`: a charcoal hero, then the Basic and Premium cards in one frame (1Password), the Enterprise band, Compare plans with sticky headers (Apollo), What are Estori credits? (Apollo), Selling templates in Discover (kept), and the FAQ.
- `/pricing/calculator`: Apollo's calculator with stores in place of seats, plus a model picker fed by the live model rates.
- `/contact`: 1Password's contact page with a working form, then the illustration band with an Estori statement in place of the customer quote.

### Contact backend

- D1 table `contact_requests`; `POST /api/contact` is public, validated, limited per IP and has a honeypot field.
- On success the request is stored, and the sender gets a confirmation email through the existing email service; the team gets a notification when an inbox is configured.
- Admins can read the requests at `/admin/contact-requests`, linked from the admin reviews page.

## Rulings

Each line: what I decided, why, and what it costs if wrong.

1. **Premium credit tiers and prices**: 20,000 credits for 99 USD, 50,000 for 199, 100,000 for 349 and 200,000 for 599, billed monthly. Why: the owner fixed Premium at 99 USD but gave no tiers, and the first tier must clearly beat the free daily allowance. If wrong: the numbers live in one table in `src/lib/plans.ts`.
2. **Premium can't be bought yet**: subscriptions aren't built, so its button says "Get Premium" and leads to the contact form with the plan and the chosen tier filled in. The card says paid plans are coming soon. Why: the page must not take money it can't deliver. If wrong: swap the button for checkout once subscriptions exist.
3. **Credits per action are steps times the model's rate**: building a store is about 30 AI steps and a change by chatting about 4, each priced at the chosen model's live `creditCost` (Claude Sonnet 5.5, the default, is 8 credits a step; Gemini Flash 3; Claude Opus 16). The coming-soon store assistant (3 credits a task) and personalized shopping (3 credits per 1,000 visits) are flat estimates. The page labels them "about" and carries a disclaimer like Apollo's. Why: the product meters credits per AI step, not per action, and there is no usage history to average yet. If wrong: tune the step counts in `CREDIT_ACTIONS` (`src/lib/credits.ts`); every page follows.
4. **No annual billing toggle** on the calculator or the cards. Why: no annual discount was set and inventing one would be a pricing promise. If wrong: add a toggle once there's a discount.
5. **No customer quote on the contact page**: the illustration band carries a statement from the Estori team instead of a testimonial. Why: there are no customer quotes yet and the site deliberately shows none. If wrong: drop a real quote into the same band.
6. **No invented stats** on the contact page: 1Password's left-hand stats card becomes "What happens next", with plain promises the team controls (we read every request, we reply by email). Why: same reason as 5.
7. **Contact form fields**: first name, last name, work email, company, company size, what it's about (Enterprise, Premium, partnership, something else) and an optional message, plus a hidden honeypot. No phone or country. Why: enough to reply and to route; fewer fields convert better. If wrong: add fields in one place.
8. **Team notification**: sent to `SALES_INBOX` when that variable is set, and skipped otherwise, without failing the request. Why: no sales inbox exists yet. If wrong: set the variable.
9. **Rate limit**: the existing per-IP limiter guards `POST /api/contact`. Why: the form is public. If wrong: tune the limit in the existing config.
10. **Honeypot as the bot check**: a hidden `website` field that people, keyboards and screen readers never reach; a request that fills it gets a normal success response and nothing is stored or emailed. Why: the codebase has no CAPTCHA or Turnstile, and a visible challenge adds friction to a sales form. If wrong: add Turnstile in front of the same endpoint.
11. **Limit of 5 requests an hour per IP**, counted in a durable object. Invalid requests and honeypot hits don't count, so a typo never locks a person out. Why: generous for a person, tight for a script. If wrong: one number in `worker/services/rate-limit/config.ts`.
12. **Error messages name an address**: when the limit is reached or saving fails, the form says to email `support@estori.app`, the address the legal pages already publish (`LEGAL_CONTACT.support`). Why: "email us" without an address is a dead end. If wrong: change `CONTACT_LIMITED_MESSAGE` and `CONTACT_FAILED_MESSAGE` in `shared/types/contact.ts`.
13. **Phones see one plan at a time in Compare plans**, picked from the empty corner of the pinned header, instead of a table that scrolls sideways; tablets keep the sideways scroll. Why: at 375 px the three-plan table showed only the labels and a sliver of Basic. If wrong: the switch is `useIsMobile()` in `ComparePlans.tsx`.
14. **The calculator pins a summary bar to the bottom of phone screens** (recommended plan, credits needed, price) that settles above the full panel and jumps to it on tap. Why: on phones the panel sits below every input, so changes were invisible while adjusting. If wrong: remove the bar; the panel is unchanged.
