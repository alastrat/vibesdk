# Store drafts: design

- **Date:** 2026-10-19
- **Status:** design approved in conversation; this spec awaits the owner's review.
- **Owner's choices:**
  - **Use cases:** both. Quick fixes to the live store while bigger work continues, and alternative directions side by side.
  - **Naming:** sellers see "Drafts" in the UI and in chat, never "branches".
  - **Combining work:** when one draft is published, the AI brings the published changes into another draft on request.

## 1. Purpose

**The gap today.** Publishing copies all of `main` to the live store. A seller halfway through a redesign can't fix a typo on the live store without shipping the unfinished redesign. They also can't keep two directions to compare.

**What drafts add:**
- **Several drafts of one store**, each with its own preview.
- **Quick fixes:** a draft that starts from the live store, so a small fix goes out alone.
- **Publishing any draft:** whichever one the seller picks.
- **Bringing published changes into the others**, merged by git and resolved by the AI when they conflict.

**What doesn't change:** nothing reaches shoppers until the seller publishes. The preview and version history work as they do today.

**Success means a seller can:**
1. keep working on a redesign in Main;
2. start a quick fix from the live store, fix the typo, and publish only that;
3. bring the fix into Main with one click, and keep going.

There are no git words in the UI, and no draft can be published by accident.

## 2. What exists today

| Piece | Where | Today |
| --- | --- | --- |
| Workspace and git | `space/src/space/durable-object.ts` (SpaceDO) | one working tree per app; `gitCommit` commits to the checked-out branch and pushes it to Cloudflare Artifacts; `gitCheckout(ref)`; `gitBranch({ name, list, delete })` |
| Git library | `@cloudflare/shell/git` (`createGit`), over isomorphic-git 1.42 | clone, log, branch, checkout, commit; **no merge**. isomorphic-git itself has `merge` and `isDescendent`. |
| Previews | `deploy(branch)` in SpaceDO, served at `/space/{space}/preview/{branch}/` (`worker/api/handlers/space-preview.ts`) | one deployment per branch name (`deployments` table) |
| Live store | `publishLive()` calls `publishLiveDeployment` (`space/src/space/deploy-engine.ts`) | copies the `main` deployment (`PREVIEW_BRANCH`) to the `live` deployment (`LIVE_BRANCH`); D1 `live_stores.published_commit` records the commit |
| Publish UI | `src/components/live-store/GoLiveDialog.tsx`, `publish-action.ts` | the seller publishes; "has changes" compares the preview commit with `published_commit` |
| AI | `worker/agents/think/deploy-tool.ts` (deploys a branch, refuses `live`), `commit-tool.ts`; Think state `currentBranch` (always `main`) | the AI edits and deploys `main` and **can't publish** |
| Rollback | `rollbackToCommit(branch, commit)` | restores an earlier tree as a new commit |
| Repo tab | `src/routes/chat/components/artifact-repo-viewer.tsx`; `GET` branches (`ArtifactsController.listBranches`) | read-only branch picker |

## 3. Concepts

- **Draft:** a named version of the store, backed by a git branch.
  - **Main** is today's `main`, always present, and can't be renamed or deleted.
  - **Other drafts** are branches named `draft/{id}`, where `id` is 8 lowercase letters and digits. The draft's name is stored separately, so renaming never renames a branch.
- **Quick fix:** a draft that starts from the published commit instead of Main's tip.
- **Published marker:** a git branch `published`, moved to the published commit on every publish.
  - It gives merges their base and lets draft states be computed.
  - It's never checked out or edited. The AI's tools refuse it, as they refuse `live`.
  - It's created on first publish. For stores published before this feature, it's created from `live_stores.published_commit` on first use.
- **Active draft:** the draft checked out in the workspace. The chat edits it and the preview panel shows it. There's one per store, since there's one working tree.
- **Limit:** five drafts per store, counting Main.

## 4. Data

A new SpaceDO SQLite table, in the same database as the workspace's git, so draft records and branches can't drift apart:

```sql
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,            -- 'main' for Main, else 8 chars
  name TEXT NOT NULL,             -- seller-facing, 1-40 chars, unique per store (case-insensitive)
  branch TEXT NOT NULL UNIQUE,    -- 'main' or 'draft/{id}'
  started_from TEXT NOT NULL,     -- 'main' | 'live'
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

- **Main's row** is created lazily, so existing stores need no migration.
- **No D1 changes.** `live_stores.published_commit` stays the source of truth for what's live. A new column, `published_draft_id`, records which draft was published so the UI can label it. That needs one D1 migration, the next free number.

## 5. Draft states

All are computed with isomorphic-git `isDescendent` against the `published` marker. For each draft:
- **live:** its tip equals the published commit.
- **unpublished changes:** its tip isn't the published commit, and the draft has commits the published version doesn't. The published commit is an ancestor of the tip.
- **behind the live store:** the published commit isn't an ancestor of its tip (and isn't the tip). Something published since isn't in this draft.
- **never published:** the store has no published commit yet.

A draft can be both behind and have unpublished changes; the UI then shows both badges.

## 6. UI

- **A switcher in the preview panel's header** (`main-content-panel.tsx`). It shows the active draft's name and badges: "Live", "Unpublished changes" or "Behind the live store".
- **The switcher's menu** lists every draft with its badges and last-changed time. It also has:
  - **New draft:** pick a name and "Start from: Main" or "Start from: The live store (quick fix)".
  - **Rename** and **Delete:** delete asks first, and isn't offered for Main or the draft that's live.
  - **Bring in live changes:** shown on drafts that are behind (section 9).
- **Publishing:**
  - **The Go live dialog** publishes the active draft and names it: "Publish 'Spring sale'".
  - **Publishing a draft other than Main:** the dialog adds "Main will be behind the live store until you bring these changes in".
  - **After a quick fix is published,** Main shows a banner: "The live store has a fix Main doesn't have. Bring it in". The banner has a button that brings the fix in.
- **Copy:** the words "git" and "branch" never appear, and the copy rules apply (no AI assistant names).
- **The Repo tab** keeps its read-only branch picker, since it's a code view for technical sellers.

## 7. Switching drafts

- **The endpoint:** `POST /api/apps/:id/drafts/:draftId/activate`, owner-only. It refuses with 409 while the AI is running a task, saying "Wait for the AI to finish, then switch".
- **The steps:**
  1. Commit pending work on the active draft: "Saved before switching to '{name}'". A no-op commit is skipped, as today.
  2. `gitCheckout(target branch)`.
  3. Set the Think agent's `currentBranch` to the target. It's restored on reconnect, as today.
  4. Deploy the target's preview if it has none, or its deployment is older than its tip.
  5. Broadcast the change over the existing WebSocket. The preview iframe reloads at the target's preview URL, and the chat says which draft is active.
- **A lock:** switching takes a short lock in SpaceDO, so two switches, or a switch and an AI write, can't interleave.

## 8. Publishing a draft

- **A generalized publish:** `publishLiveDeployment(sql, nowMs, branch)` copies the chosen branch's deployment, not always `main`'s. The live-store controller's `publish` takes an optional `draftId`, which defaults to the active draft.
- **Order of work:**
  1. Deploy the draft's preview if it's stale.
  2. Copy the deployment to `live`.
  3. Move the `published` marker to the draft's tip with a forced branch update.
  4. Update `live_stores` (`published_commit` and `published_draft_id`).
- **Unchanged:** the publishing checks: the store manifest, payments set up, and the seller's level and limits.
- **The AI can't publish**, as today. When asked, it says to use Publish, and the switcher shows the draft is ready.

## 9. Bringing live changes into a draft

**The trigger:** a button on a draft that's behind, or a chat request ("bring the live changes into Main").

**The merge:** it merges `published` into the draft on the draft's branch, using isomorphic-git `merge` against the workspace's git directory (`@cloudflare/shell/git` has no merge):
1. **Fast-forward** when the draft has nothing of its own. The draft simply moves to the published commit.
2. **A clean three-way merge** makes a merge commit, "Brought in the live store's changes". The preview redeploys.
3. **On conflicts,** with `abortOnConflict: false`:
   - the conflicting files keep conflict markers;
   - the merge is left in progress;
   - the AI gets a task listing each conflicting file, with both versions and the published change's commit messages, plus an instruction to keep the draft's intent and the live fix, remove all markers and run the build.
   - **Then** it commits ("Brought in the live store's changes"), and the preview redeploys for the seller to review.
   - **If the AI can't produce a clean build,** it aborts the merge back to the draft's last commit and says what blocked it.

**Merging needs the draft to be active,** since it uses the single working tree. Bringing changes into another draft switches to it first, so the seller sees what changed.

**Never automatic:** publishing never merges into other drafts on its own.

## 10. AI tools

- **New tools** in `worker/agents/think/`, registered in `ThinkAgent.getTools()`:
  - `list_drafts`: names, states, and which is active;
  - `create_draft(name, from: 'main' | 'live')`: creates the draft and switches to it;
  - `switch_draft(draft)`;
  - `bring_in_live_changes(draft)`.
- **The deploy tool** keeps refusing `live` and also refuses `published`.
- **The AI's guidance** in its prompts and skills:
  - when to suggest a quick fix: the seller asks for a small fix while Main has unpublished work;
  - that publishing is the seller's click;
  - how to resolve merge conflicts.

## 11. Limits and cleanup

- **Five drafts per store, counting Main.** Creating a sixth says "Delete a draft to start a new one".
- **Deleting a draft** removes its branch, its preview deployment and its row. It's refused for Main, the live draft and the active draft (switch first). Its commits stay in Cloudflare Artifacts' history.
- **Names** are 1–40 characters, trimmed, unique per store ignoring case, and without control characters.

## 12. Shared data

- **Shared:** drafts share the store's orders, payments setup, emails and live address.
- **Per draft:**
  - **Prices:** previews price checkout from the deployed draft's own `estori-store.json`, as previews do today with `main`.
  - **The live store** uses the published draft's manifest, as today.

## 13. Security

- **Owner-only:** every drafts endpoint is owner-only (`AuthConfig.ownerOnly`), like the other app routes.
- **Branch names never come from sellers:** they're built from the generated id, and the name is only stored.
- **The `published` marker and `live` can't be targeted** by any draft operation or AI tool.

## 14. Testing

- **SpaceDO** (vitest, real git in the workspace pool):
  - creating drafts from Main and from the live store;
  - switching while dirty and while locked;
  - state computation in every case, including behind and with unpublished changes at once;
  - publishing a non-Main draft, which moves the marker;
  - a fast-forward, a clean merge and a conflicting merge (markers left, merge in progress, abort restores);
  - the delete rules;
  - the five-draft limit.
- **Worker:**
  - the drafts controller (owner checks, 409 while the AI runs, names);
  - publish with a `draftId`;
  - the new AI tools (they refuse `published` and `live`).
- **UI:** guard tests for the switcher, the badges, the publish dialog naming the draft, the Main banner after a quick fix, and the copy rules.
- **By eye** on localhost:
  1. Make an unpublished change in Main.
  2. Start a quick fix from the live store and change one word.
  3. Publish it, and check the live store changed while Main's work didn't ship.
  4. Bring the fix into Main, with and without a conflict.

## 15. Out of scope

- Several drafts live at the same time (A/B tests, a second live address).
- Bringing changes between two unpublished drafts.
- Drafts for team members working in parallel. One store has one working tree, so one active draft at a time.
- Showing a draft-to-draft diff in the UI. The Repo tab already shows code.

## 16. Decisions for the owner

| Decision | Proposed | Why |
| --- | --- | --- |
| Draft limit | 5 per store, counting Main | enough for a quick fix and two alternatives; each draft keeps a preview build |
| AI publishing drafts | No, publishing stays the seller's click | matches today; the live store never changes without the seller |
| A merge the AI can't resolve | Abort to the draft's last commit and explain | the draft is never left broken |
| Plans | Drafts on every plan | they protect live stores, which every plan can have |
