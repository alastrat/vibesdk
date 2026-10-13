# One gallery: every published site can be reused

Status: approved in chat, 2026-10-12. This replaces the separate templates gallery from `2026-10-12-templates-design.md`, which shipped only on the unmerged branch `feat/templates`. The use flow, personalization, the paid review machinery and test-mode purchases from that work stay. The separate submission step and the separate gallery go.

## Goal

There is one gallery, Discover. Publishing an app is what makes it reusable:
- any public site can be used to start a new app;
- the new app is a copy of the site's files, deployed at once and optionally rewritten for the user's business in the first agent turn;
- creators can set a price, and paid sites are reviewed by an admin before anyone can use them.

## Decisions

| Question | Decision |
|---|---|
| Discover vs templates | One gallery, Discover at `/discover`. `/templates` and `/templates/:slug` redirect to it. |
| What "published" means | The existing "Make public". It now asks for consent to reuse, an optional category and a price. |
| Admin approval | Only for paid sites. Free publishing is instant, and admins can remove any public app from Discover afterwards. |
| What a new app copies | Free: the creator's latest deployed version, read when someone uses it. Paid: the exact version an admin approved. |
| Apps already public before this change | Reusable as soon as this ships. Public code is already downloadable through Clone. |
| Payments | Test mode, as on `feat/templates`: "Buy" records a purchase and charges nothing. |

## What people see

- **Owner, publishing.**
  - "Make public" opens a dialog with:
    - a required checkbox, "Others may copy and adapt this site";
    - a category (optional; `store`, `landing`, `portfolio`, `restaurant`, `saas`, `services`, `other`);
    - a price (Free, $9, $19, $29 or $49; Free by default).
  - **Free:** the app becomes public and reusable at once.
  - **Paid:**
    - The app becomes public, so others can view it, but it can't be used until an admin approves.
    - The app page shows "Price in review", then "Approved" or "Rejected: {reason}".
    - After deploying changes, the owner can "Send update for review". Buyers keep getting the approved version until the update is approved.
    - Switching a paid app to Free makes it reusable at once. Existing purchases stay recorded.
  - On a public app, the owner's "Public" control opens the same dialog to change the category or price, or to make the app private.
  - Switching a free public app to a price pauses reuse until an admin approves the price.
  - Making the app private removes it from Discover and stops new reuse. Apps already made from it keep working.
  - The profile's "Paid listings" section shows each paid site's review status, versions and buyer count.
- **Everyone, in Discover.**
  - The current grid, search and sorts (popular, trending, recent, starred), plus a category filter and an All / Free / Paid filter.
  - Cards show the use count. Approved paid sites show a price badge. A paid site still in review has no badge and no Use button.
  - The home page strip under the prompt box becomes "Start from a published site" and shows reusable Discover apps.
- **Using a site.**
  - On a public app's page, people other than the owner see "Use this site". It needs sign-in and opens the existing dialog: "Describe your business (optional)" and the model picker.
  - On an approved paid site the button reads "Buy for $X" until the user has bought it (test mode, no charge).
  - The owner can also use their own site, free or paid, without buying.
  - The new app opens in chat with the copy already deployed. With a description, the agent personalizes it in the first turn exactly as on `feat/templates`.
  - The new app's page shows "Started from {source app title} by {creator}". If the source is private or removed, it shows "Started from a site that is no longer available".
- **Admins.**
  - `/admin/templates` becomes `/admin/reviews`. It lists pending paid versions with screenshots, file list, size, creator and price, and opens any file read-only. Actions: Approve, and Reject (a reason is required).
  - On any public app's page, admins see "Remove from Discover", which takes a reason, and "Restore". Removal hides the app from Discover and blocks reuse, but doesn't change the app's visibility. The owner sees "Removed from Discover by an admin: {reason}".

## Architecture

### Data

Migration 0009 has never run in production. It is regenerated to the shape below instead of adding a corrective migration. Local databases that already applied the old 0009 drop its tables and the `migrations` row, then re-apply.

- **`users.role`**: `'user' | 'admin'`, as on `feat/templates`. The migration still sets `admin` for alastrat@pluriza.com.
- **`apps` gains:**
  - `category` (nullable, same enum as above);
  - `reuseConsentAt` (timestamp, set when the owner publishes with the checkbox);
  - `reuseCount` (integer, default 0);
  - `removedFromDiscoverAt`, `removedFromDiscoverBy` and `removedFromDiscoverReason` (nullable).
- **`apps.parentAppId`** (existing, unused today): set to the source app on every reuse.
- **`apps.fromTemplateVersionId`**: set to the approved version on a paid reuse.
- **`templates`** now means "the paid listing for an app":
  - one row per app, `sourceAppId` unique and not null;
  - `creatorUserId`, `priceCents`, `currentVersionId` (nullable until the first approval);
  - `status` (`listed` | `unlisted`);
  - `createdAt`, `updatedAt`.
  - `slug`, `name`, `description`, `category` and `useCount` are dropped; the app supplies them, and `apps.reuseCount` counts uses.
  - Deleting the source app deletes the listing. The R2 objects stay and the buyers' purchases are kept.
- **`template_versions`**: as on `feat/templates`, plus `priceCents`, the price the owner asked for in that submission.
- **`template_purchases`**: unchanged from `feat/templates`.
- **R2 `TEMPLATES_BUCKET`**: unchanged layout, written only for paid versions.

The internal table names stay `templates*` to reuse the tested services. The code calls them paid listings in comments and new identifiers.

### Publishing

**Endpoint:** `PUT /api/apps/:id/visibility` (owner only).
- **Making an app public:** the body becomes `{ visibility: 'public', reuseConsent: true, category?, priceCents }`.
- **Making an app private:** `{ visibility: 'private' }` works as today.

**Steps for public:**
1. Validate the body. `reuseConsent` must be true; `priceCents` must be one of the allowed options.
2. Check the app is a Think app with a deployed commit; otherwise return 400 with the reason.
3. Read the deployed commit's files, using the agent's `getTemplateSource` and SpaceDO `readTreeAtCommit`, and run the snapshot rules:
   - path exclusions;
   - secret patterns (with the file name in the error);
   - 500 files and 10 MB.
4. **Free:** set `visibility`, `category` and `reuseConsentAt` in one update. If a listed paid listing exists, set it to `unlisted`.
5. **Paid:** create the listing if it doesn't exist (status `listed`), then run `submitTemplateVersion` (R2 snapshot, screenshots, pending version with its `priceCents`). Only then set `visibility = 'public'`. If anything fails:
   - no version row is created;
   - the app keeps its previous visibility (private for a first publish);
   - the error is returned.
   A listing with no approved version blocks reuse, so an app that was free and public stops being reusable until the price is approved.
6. **Changing settings on a public app:** the same request with the new category or price.
   - A free-to-free change updates the category.
   - A move to paid follows step 5.
   - A paid-to-paid price change submits a new pending version from the latest deploy.
   - A move from paid to free follows step 4.

**Paid update:** `POST /api/apps/:id/paid-listing/versions` (owner only, rate limited to 5 per user per day) snapshots the latest deploy as a new pending version.
- **Price changes:** approval copies the version's `priceCents` to the listing. Until then, buyers see and pay the approved version's price.
- **Withdraw:** `POST /api/apps/:id/paid-listing/versions/:versionId/withdraw` withdraws a pending version.

### Using a site

**Endpoint:** the existing app-creation request with `sourceAppId` (replacing `templateId`). The frontend route is `/chat/new?source=<appId>`.

**Steps:**
1. **Resolve the source, before the app-creation rate limit:**
   - it must be public, not removed from Discover, a Think app, and deployed;
   - otherwise return 404 "This site is no longer available" or 400 with the reason.
2. **Pick the files:**
   - **Paid listing in effect** (a listed listing with a current approved version): the caller must own the source app or hold a purchase, otherwise 402 "Buy this site before using it". The files come from the approved version's R2 snapshot.
   - **Paid listing pending its first approval:** 409 "This site isn't available to use yet".
   - **Otherwise (free):** read the source's deployed commit live and apply the snapshot rules. A rule violation returns 400 "This site can't be reused right now", and no app is created.
3. **Create the app:**
   - through the normal agent initialization, with `parentAppId` and, for paid, `fromTemplateVersionId`;
   - the title is derived from the description, or "{source title} copy" when there is none;
   - seed the files, commit "Start from {source title}", and deploy.
4. **Increment `apps.reuseCount`** on the source.
5. **Personalization turn** with the hidden instruction, as on `feat/templates`, with "template" replaced by "site".

The tool-ordering fix (`serializeTools`, commit 6eddebf) stays.

### Discover

- **Endpoint:** `GET /api/apps/public` (existing), extended:
  - excludes apps removed from Discover;
  - left-joins the listing and its current version for price and paid status;
  - accepts `category`, `pricing=all|free|paid` and `reusableOnly`.
- **Response fields:** each item gains `category`, `reuseCount`, `priceCents` (null for free) and `reusable` (deployed Think app, and free or approved paid).
- **Home strip:** reuses the same endpoint with `reusableOnly=true` and `sort=popular`.

### Admin

- **Review endpoints:** the existing ones under `/api/admin/template-versions/*` stay.
- **Pending list:** it moves to `GET /api/admin/reviews` and includes the app title, owner and price.
- **Removal:** `PUT /api/admin/apps/:id/discover` with `{ removed: true, reason }` or `{ removed: false }`, at the `admin` auth level.

### Removed from `feat/templates`

- the "Submit as template" button, its dialog and the submit endpoint `POST /api/apps/:id/template-submissions` (its logic moves into publishing);
- the `/templates` gallery and detail pages and their endpoints `GET /api/templates` and `GET /api/templates/:slug`, plus the screenshot route for the current version (Discover cards use app thumbnails);
- `PUT /api/templates/:id/listing` (replaced by publishing and admin removal);
- the "My templates" list on the profile (replaced by "Paid listings");
- the template strip on the home page (replaced by the Discover strip).

## Error handling

| Case | Behavior |
|---|---|
| Publish without the consent checkbox | 400: `Confirm that others may copy and adapt this site` |
| Publish a non-Think or never-deployed app | 400 with the reason; the app stays private |
| A file looks like a secret at publish | 400: `{path} looks like it contains a secret key; remove it and redeploy` |
| Too many files or too large at publish | 400: `Sites can have at most 500 files and 10 MB to be published` |
| Paid publish fails (snapshot, R2 or capture) | The app stays private; no version row; the error is returned |
| Paid update rate limit | 429 with the existing rate-limit message format |
| Use a private, removed or missing site | 404: `This site is no longer available` |
| Use a paid site without a purchase | 402: `Buy this site before using it` |
| Use a paid site still in its first review | 409: `This site isn't available to use yet` |
| Free reuse hits a rule violation (an app published before this change) | 400: `This site can't be reused right now`; no app is created |
| Seeding the new app fails | The new app is deleted; 500 with the reason |
| Non-admin calls an admin endpoint | 403 |

## Testing

- **Unit (pure):**
  - the reuse decision: free, paid in effect, paid pending, own app, purchase present, removed, private, not deployed;
  - publish validation: consent, price options, category;
  - the snapshot rules (existing tests carried over);
  - the Discover query options, `pricing` and `category`;
  - the turn message wording.
- **Services:** paid-listing creation and price changes; approval copying the version's price; unlisting on switch to free; removal and restore.
- **Workspace package:** the live read path on the in-memory filesystem returns the deployed commit, not uncommitted edits (the existing `readTreeAtCommit` tests).
- **DTO:** Discover items never include the owner's email, snapshot keys or private fields.
- **Auth:** owner-only publishing and paid updates; admin-only review and removal.
- **Frontend wiring guards:**
  - the publish dialog;
  - Use and Buy on the app page;
  - the Discover filters and price badge;
  - the redirects from `/templates`;
  - the admin review page and the removal action.
- **Live, locally and after deploy:**
  1. publish free, then use it with and without a description;
  2. publish paid, reject, resubmit, approve, buy and use;
  3. deploy a change to a paid site, send the update for review, and confirm buyers get the approved version until it passes;
  4. remove a site from Discover as admin, and confirm it disappears while apps made from it keep working;
  5. make a site private, with the same checks;
  6. use a site that was public before this change.

## Out of scope

- Real checkout, payouts and refunds.
- Updating apps already made from a site when the source changes.
- Email notifications.
- Ratings, comments and public creator profiles.
- Reuse of phasic or agentic (pre-Think) apps.
- Renaming the internal `templates*` tables and services.
