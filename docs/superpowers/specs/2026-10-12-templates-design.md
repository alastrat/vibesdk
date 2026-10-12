# Templates: publish an app as a template and start new apps from it

Status: approved in chat, 2026-10-12.

## Goal

Let people start a new Estori app from a good existing one instead of a blank prompt, and let creators share their apps for others to reuse:
- anyone can submit one of their apps as a template;
- Estori admins review each submission and publish the ones that belong in the gallery;
- anyone signed in can pick a published template, describe their business, and get a working site adapted to them.

This is the first of three projects. Paid templates (prices, checkout, payouts) and a creator marketplace come later and build on this data model. Seeding the gallery with launch templates happens after this ships, through the same flow.

## Decisions

| Question | Decision |
|---|---|
| Who the catalog is for | Both new users and creators. It starts as a curated gallery and opens to creators through review. |
| Who can submit | Any owner of a deployed Think app. |
| Who publishes | Admins approve or reject each submitted version. Nothing appears in the gallery without approval. |
| What "use this template" does | The new app starts from a copy of the template's files, deployed at once. If the user describes their business, the agent's first turn rewrites all text, names, prices and images for them while keeping the layout and working features. With no description they keep an exact copy. |
| How files are copied | From an immutable snapshot taken at submission and stored in R2. Never from the creator's live app or its git history. |
| Versions | Each app has at most one template. Submitting again adds a version. Approving a version publishes it and supersedes the previous one. |
| Previews before use | Desktop and phone screenshots captured at submission. Live demos are out of scope. |
| Payments | Out of scope. Nothing in the data model blocks adding a price later. |

## What people see

- **Creator.**
  - A "Submit as template" button appears on the app page and next to the deploy controls in chat, for Think apps that have been deployed at least once.
  - The form asks for a name, a short description and a category, plus a required checkbox: "I own the rights to this content and allow others to copy and adapt it."
  - After submitting, the app shows the template's status: In review, Published, or Rejected with the reviewer's reason. A pending version can be withdrawn, and a published template can be unlisted at any time.
  - A "My templates" list on the profile shows each template, its versions and its use count.
- **Admin.**
  - `/admin/templates` lists pending versions with their screenshots, file list, size, creator and source app.
  - Any file in the snapshot can be opened read-only, so reviewers can check for copied brand content.
  - Actions: Approve, Reject (a reason is required), and Unlist for a published template.
- **Everyone.**
  - `/templates` shows published templates as a grid: screenshot, name, category, creator and use count, with a category filter and search.
  - `/templates/:slug` shows desktop and phone screenshots, the description, the creator, the publish date and a "Use this template" button.
  - The home page shows a "Start from a template" strip under the prompt box.
- **Using a template.**
  - Clicking "Use this template" requires signing in and opens a dialog: "Describe your business (optional)" and the model picker.
  - The new app opens in chat with the template already deployed in the preview, within seconds and with no model cost.
  - With a description, the description is the user's first chat message and the agent personalizes the site in that turn.
  - The app page shows "Started from template {name} by {creator}".

## Architecture

### Data (D1, one drizzle migration)

- **`users.role`**: `'user' | 'admin'`, default `'user'`. The owner's account is set to `admin` with one D1 update after deploy.
- **`templates`** (the catalog entry, stable across versions):
  - `id`, `slug` (unique), `creatorUserId`, `sourceAppId` (nullable; set to null when the source app is deleted);
  - `name`, `description`, `category` (`store`, `landing`, `portfolio`, `restaurant`, `saas`, `services`, `other`);
  - `currentVersionId` (nullable until the first approval), `status` (`listed` | `unlisted`), `useCount`;
  - `createdAt`, `updatedAt`.
- **`template_versions`** (one row per submission):
  - `id`, `templateId`, `version` (1, 2, …), `sourceCommit`;
  - `snapshotKey`, `fileCount`, `totalBytes`, `desktopShotKey`, `mobileShotKey`;
  - `status` (`pending` | `approved` | `rejected` | `withdrawn` | `superseded`);
  - `rightsConfirmedAt`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `createdAt`.
- **`apps.fromTemplateVersionId`** (nullable): set on apps started from a template. The existing `parentAppId` is not used.

### Storage (R2, `TEMPLATES_BUCKET`)

Under `templates/<templateId>/<versionId>/`:
- `files.json`: `{ files: [{ path, encoding: 'utf8' | 'base64', content }] }` with every file at the submitted commit;
- `desktop.jpg` and `mobile.jpg`.

Limits per version: 500 files and 10 MB total. Snapshots are never deleted when a template is unlisted or a source app is deleted.

### Submitting

- **Endpoint:** `POST /api/apps/:id/template-submissions`, owner-only, rate limited to 5 submissions per user per day.
- **Steps:**
  1. Check that the app is a Think app with a deployed commit.
  2. Read the files at the last deployed commit through a new SpaceDO RPC, `readTreeAtCommit(commit)`, built on the existing `walkTreeFiles` and `readBlobBytes`.
  3. Drop `.git/`, `.think/`, `.env*` and `.dev.vars`.
  4. Reject files that look like secrets, naming the file in the error. The patterns cover:
     - private key blocks (`-----BEGIN … PRIVATE KEY-----`);
     - AWS access keys (`AKIA` + 16 characters);
     - GitHub tokens (`ghp_`, `github_pat_`);
     - Slack tokens (`xox[abprs]-`);
     - Stripe live keys (`sk_live_`, `rk_live_`);
     - OpenAI and Anthropic keys (`sk-…`, `sk-ant-…`);
     - assignments such as `api_key = "…"` or `secret: '…'` with a value of 20 or more characters.
  5. Enforce the limits, write `files.json`, and capture desktop and phone screenshots of the deployed preview with the existing capture code (one retry).
  6. Create the `templates` row on the first submission, then a `pending` version. The slug is the kebab-cased name; when it's taken, a 4-character random suffix is added. The slug doesn't change when later versions are submitted.
- **Atomicity:** if any step fails, no version row is created. Objects already written are removed best-effort.
- **Withdraw:** `POST /api/templates/:id/versions/:versionId/withdraw`, creator only, for `pending` versions.
- **Unlist:** `PUT /api/templates/:id/listing`, by the creator or an admin.

### Reviewing

- **Auth:** a new `AuthConfig.admin` level checks `users.role` from D1 on each request.
- **Endpoints:**
  - `GET /api/admin/templates/pending`;
  - `GET /api/admin/template-versions/:id/files/*path`, which reads one file from the snapshot;
  - `POST /api/admin/template-versions/:id/approve`;
  - `POST /api/admin/template-versions/:id/reject` with `{ reason }`.
- **Approve:** sets the version `approved`, the previous approved version `superseded`, `templates.currentVersionId` to this version, and `status` to `listed`, all in one D1 batch.

### Gallery

- **Endpoints:** `GET /api/templates?category=&q=&page=` and `GET /api/templates/:slug` are public and reuse the public-apps rate limit.
- **Response:** a whitelisted DTO, following the pattern of `publicAppDto.ts`.
- **Screenshots:** served by a new public route, `GET /api/templates/:id/screenshots/:kind`, for the current version only.

### Using a template

- **Endpoint:** `POST /api/templates/:id/use` with `{ description?, model? }`, authenticated, counted by the existing app-creation rate limit.
- **Steps:**
  1. Create a Think app through the normal agent initialization, with `fromTemplateVersionId` set. Its title is derived from the description, or "{template name} copy" when there is none.
  2. Seed the new workspace from `files.json`: validate every path again (no `..`, no reserved paths), write the files, and commit "Start from template {name} v{version}".
  3. Deploy the preview.
  4. Increment `templates.useCount`.
  5. If there is a description, queue it as the first user input. The turn message carries a hidden part (`providerMetadata.estori.hidden`, as with reference digests): "This app started from the template {name}. Keep its layout, components, styles and working features. Rewrite every piece of text, every brand and product name, every price and every image for: {description}. Keep none of the template's original copy. Then deploy."
- **Failure:** if seeding fails, the new app is deleted and the error is returned.

## Error handling

| Case | Behavior |
|---|---|
| App not a Think app, or never deployed | Submit button hidden; endpoint returns 400 with the reason |
| Too many files or too large | 400: `Templates can have at most 500 files and 10 MB` |
| A file looks like a secret | 400: `{path} looks like it contains a secret key; remove it and redeploy` |
| Snapshot or R2 write fails | 500; no version row; partial objects removed best-effort |
| Screenshot capture fails twice | 400: `Couldn't capture your site; make sure it's deployed and loads` |
| Submission rate limit | 429 with the existing rate-limit message format |
| Non-admin calls an admin endpoint | 403 |
| Template unlisted or not found when used | 404: `This template is no longer available` |
| Seeding the new app fails | The new app is deleted; 500 with the reason |
| Personalization turn fails | The normal turn-error card; the deployed template copy stays |
| Source app deleted | Template keeps working; `sourceAppId` set to null |

## Testing

- **Unit (pure):**
  - snapshot building: path filtering, limits, secret detection;
  - bundle encoding round trip (text and binary);
  - seeding path validation;
  - the personalization turn message (hidden part present, user text visible);
  - slug generation;
  - version state transitions (approve supersedes, withdraw only from pending, reject requires a reason).
- **Services:** the template service against a local D1 (the repo's existing service-test setup), covering submit, approve, use count and unlisting.
- **Auth:** `AuthConfig.admin` allows admins and returns 403 for others; owner-only submission.
- **Workspace package:** `readTreeAtCommit` on the in-memory filesystem, returning committed content rather than uncommitted edits.
- **DTO:** the public template DTO never includes the creator's email, the source app's private fields, or snapshot keys.
- **Frontend wiring guards** (repo pattern): the gallery page, the use dialog, the admin queue, and the submit button visibility.
- **Live, after deploy:**
  1. submit a deployed app;
  2. reject it, then resubmit and approve;
  3. use the template with a description;
  4. use it without one;
  5. unlist it and confirm it disappears from the gallery while the app made from it keeps working.

## Out of scope

- Paid templates, checkout, entitlements and creator payouts.
- Live interactive demos of templates before use.
- Email notifications.
- Public creator profiles, ratings and comments.
- Templates for phasic or agentic (pre-Think) apps.
- Updating apps already made from a template when a new version is published.
- Launch seeding, which happens after deploy through this same flow.
