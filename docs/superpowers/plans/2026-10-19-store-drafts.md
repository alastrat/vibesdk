# Store Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sellers keep several drafts of a store, each with its own preview, publish whichever one they pick, and have the AI bring published changes into the others.

**Architecture:**
- **Drafts are git branches** in the store's SpaceDO workspace. Main is `main`; other drafts are `draft-{id}`. A `drafts` table in SpaceDO's SQLite holds their names.
- **One draft is checked out at a time.** SpaceDO remembers which one in durable storage, and a cold start rebuilds the workspace from it.
- **What's live** is SpaceDO's `live` deployment row. It already holds the published commit, and gains the branch it came from.
- **Merging** uses isomorphic-git directly, since `@cloudflare/shell/git` has no merge. A merge the AI is resolving stays unmirrored until it builds, and it never outlives the turn that started it.
- **The Think host** keeps its `currentBranch` in step with the workspace. The owner-only API and the AI's tools both switch drafts through it.

**Tech Stack:** Cloudflare Workers, Durable Objects (SpaceDO, the Think agent), isomorphic-git 1.38, `@cloudflare/shell`, Cloudflare Artifacts, Hono, React 19, TanStack Query, vitest-pool-workers.

**Spec:** `docs/superpowers/specs/2026-10-19-store-drafts-design.md`

## Rulings against the spec

Each of these keeps the spec's behavior but changes how it's built. Each gets a `Ruling:` line in the ledger at Task 1.

1. **Branch names are `draft-{id}`, not `draft/{id}`.**
   - **Why:** the branch is one segment of the preview path (`/space/{space}/preview/{branch}/`) and of its cookie path. A slash would have to be encoded everywhere.
   - **Cost if wrong:** a rename of the prefix before any draft exists.
2. **The published marker is the `live` deployment row, not a `published` git branch.**
   - **Why:** in production the workspace's git lives in memory and is rebuilt from Artifacts after a restart, so a local-only branch would vanish. Artifacts also refuses to move a branch backwards, so the marker couldn't be mirrored either.
   - **How:** the row already holds the published commit and moves on every publish. A new `source_branch` column records the draft it came from. Merges and states use that commit.
   - **Cost if wrong:** none for sellers. The Repo tab won't list a `published` branch.
3. **No D1 migration.** The spec's `live_stores.published_draft_id` is replaced by the `source_branch` column above.
   - **Why:** the UI reads the published draft from SpaceDO, which holds the commits. This also avoids a clash over migration 0029 with the email marketing plan.
   - **Cost if wrong:** one migration later, if D1 ever needs to know the draft.
4. **The drafts API lives under `/api/stores/:id/drafts`, beside `/api/stores/:id/live`.** `/api/apps/*` is a sub-router.
5. **"Bring in live changes" in the UI sends a chat request.** The AI then calls `bring_in_live_changes`, so one code path handles fast-forwards, clean merges and conflicts. Bringing changes in costs an AI turn.

## Global Constraints

- No `any`. No emojis in code, comments or copy.
- **Seller copy:**
  - never says "git", "branch", "merge" or "commit";
  - follows `src/routes/copy-rules.ts`, so no AI assistant or supplier names (saying "the AI" is fine);
  - says "draft" and "the live store".
- **Draft rules:** 5 drafts per store, counting Main. Names are 1–40 characters after trimming, unique per store ignoring case, and have no control characters.
- **Main** always exists. It can't be renamed or deleted, and its id and branch are both `main`.
- **Owner-only:** every drafts endpoint uses `AuthConfig.ownerOnly`. The AI can't publish.
- **Commits:** subjects are lowercase after the type. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit:**
  - `.dev.vars` or `bun.lockb`;
  - anything under `.superpowers/` or `.playwright-mcp/`;
  - `src/routes/landing/LandingPage.tsx` or `wrangler.jsonc`, which carry local changes;
  - the untracked `docs/superpowers/specs/2026-10-18-shopper-order-access-design.md`.
- **Tests:**
  - Run from the repo root, as `rtk proxy bun run test -- <files>`. Space tests run from the root too.
  - Run a few files at a time: many files at once exhausts ports.
- **Before the PR:** `npx eslint .`, `bun run typecheck`, `bun run build`, `bun run bundle:check`, and `bun run test` (sharded).
- **Don't merge the PR.** The owner merges.

## Review Focus

1. **A cold start while a draft other than Main is active:**
   - **Expect:** after the dev server restarts, the workspace and preview still show that draft, and its uncommitted work survives.
   - **Guarded by:** the base-branch wiring in Task 5, and the by-eye restart in Task 10.
2. **Pushing a branch other than the checked-out one:**
   - **Expect:** the checkpoint of the active draft's unsaved work is kept. Today every successful push clears it.
   - **Guarded by:** the source guard in Task 5.
3. **A merge the AI leaves unfinished**, through a step limit, the seller pressing stop, or a crash:
   - **Expect:** the draft returns to its last version, and switching isn't blocked afterwards.
   - **Guarded by:** the turn-end and turn-start cancel tests in Task 6, and the cancel before every switch.
4. **Publishing while the AI is mid-merge on that draft:**
   - **Expect:** refused. Publishing a draft whose latest version isn't deployed deploys it first, and a broken build refuses.
   - **Guarded by:** the `publishDraft` source guard in Task 5.
5. **Two switches, or a switch and an AI write, at once:**
   - **Expect:** they run one after another, never interleaved, and a turn queued during a switch waits for it.
   - **Guarded by:** the lock guard in Task 5 and the turn-waits test in Task 6.

---

### Task 1: Draft records

**Files:**
- Create `space/src/space/drafts-store.ts`.
- Test: `space/test/drafts-store.test.ts`.

**Interfaces:**
- **Consumes:** nothing.
- **Produces:**
  - constants: `MAIN_DRAFT_ID`, `MAIN_DRAFT_NAME`, `MAIN_BRANCH`, `DRAFT_LIMIT`, `DRAFT_NAME_MAX_LENGTH`, `ACTIVE_BRANCH_KEY` and `DRAFTS_TABLE_SQL`;
  - types: `DraftStart`, `DraftRecord`, `DraftSummary`, `DraftsSnapshot`, `ActiveDraft`, `ActivateDraftResult`, `CreateDraftResult`, `PublishDraftResult` and `PublishContext`;
  - functions:
    - `draftBranchOf(id): string`;
    - `newDraftId(randomBytes?): string`;
    - `draftNameProblem(name, drafts, exceptId?): string | null`;
    - `listDraftRecords(sql, nowMs): DraftRecord[]`;
    - `draftById(sql, nowMs, id): DraftRecord | null`;
    - `draftByBranch(sql, nowMs, branch): DraftRecord | null`;
    - `addDraft(sql, nowMs, { name, startedFrom }): { draft: DraftRecord } | { error: string }`;
    - `renameDraftRecord(sql, nowMs, id, name): { draft: DraftRecord } | { error: string }`;
    - `removeDraftRecord(sql, id): void`;
    - `touchDraftBranch(sql, branch, nowMs): void`.

- [ ] **Step 1: Ledger the five rulings** from "Rulings against the spec", one `Ruling:` line each.

- [ ] **Step 2: Write the failing test**

```ts
/// <reference path="../../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />
/**
 * Draft records against a real DO SqlStorage: Main always exists, names follow the seller-facing rules, and the
 * five-draft limit holds.
 */
import { describe, expect, it } from "vitest"
import { env, runInDurableObject } from "cloudflare:test"
import {
  addDraft,
  DRAFT_LIMIT,
  DRAFTS_TABLE_SQL,
  draftBranchOf,
  draftByBranch,
  draftById,
  draftNameProblem,
  listDraftRecords,
  newDraftId,
  removeDraftRecord,
  renameDraftRecord,
  touchDraftBranch,
} from "../src/space/drafts-store"
import type {} from "./test-env"

function uniqueStub(name: string) {
  return env.FsHarnessDO.get(env.FsHarnessDO.idFromName(`drafts-${name}-${Date.now()}-${Math.random()}`))
}

describe("draft records", () => {
  it("creates Main on first use, so stores from before drafts need no migration", async () => {
    await runInDurableObject(uniqueStub("main"), async (_instance, state) => {
      const sql = state.storage.sql
      sql.exec(DRAFTS_TABLE_SQL)
      const drafts = listDraftRecords(sql, 10)
      expect(drafts).toEqual([{ id: "main", name: "Main", branch: "main", startedFrom: "main", createdAt: 10, updatedAt: 10 }])
      expect(listDraftRecords(sql, 20)).toHaveLength(1)
    })
  })

  it("adds drafts on generated branches, Main first and then oldest first", async () => {
    await runInDurableObject(uniqueStub("add"), async (_instance, state) => {
      const sql = state.storage.sql
      sql.exec(DRAFTS_TABLE_SQL)
      const fix = addDraft(sql, 30, { name: "  Typo fix ", startedFrom: "live" })
      const sale = addDraft(sql, 40, { name: "Spring sale", startedFrom: "main" })
      if ("error" in fix || "error" in sale) throw new Error("expected drafts")
      expect(fix.draft.name).toBe("Typo fix")
      expect(fix.draft.branch).toBe(`draft-${fix.draft.id}`)
      expect(fix.draft.id).toMatch(/^[a-z0-9]{8}$/)
      expect(listDraftRecords(sql, 50).map((d) => d.name)).toEqual(["Main", "Typo fix", "Spring sale"])
      expect(draftById(sql, 50, sale.draft.id)?.startedFrom).toBe("main")
      expect(draftByBranch(sql, 50, fix.draft.branch)?.id).toBe(fix.draft.id)
      expect(draftById(sql, 50, "nope")).toBeNull()
    })
  })

  it("stops at five drafts, counting Main", async () => {
    await runInDurableObject(uniqueStub("limit"), async (_instance, state) => {
      const sql = state.storage.sql
      sql.exec(DRAFTS_TABLE_SQL)
      for (let i = 1; i < DRAFT_LIMIT; i++) expect(addDraft(sql, i, { name: `Draft ${i}`, startedFrom: "main" })).toHaveProperty("draft")
      expect(addDraft(sql, 99, { name: "One more", startedFrom: "main" })).toEqual({ error: "Delete a draft to start a new one." })
    })
  })

  it("renames any draft but Main, and removes a record", async () => {
    await runInDurableObject(uniqueStub("rename"), async (_instance, state) => {
      const sql = state.storage.sql
      sql.exec(DRAFTS_TABLE_SQL)
      const added = addDraft(sql, 1, { name: "Sale", startedFrom: "main" })
      if ("error" in added) throw new Error("expected a draft")
      expect(renameDraftRecord(sql, 2, "main", "Home")).toEqual({ error: "Main keeps its name." })
      expect(renameDraftRecord(sql, 2, "missing", "Home")).toEqual({ error: "That draft doesn't exist." })
      expect(renameDraftRecord(sql, 2, added.draft.id, "MAIN")).toEqual({ error: "Another draft already has that name." })
      const renamed = renameDraftRecord(sql, 3, added.draft.id, "Summer sale")
      expect(renamed).toMatchObject({ draft: { name: "Summer sale", branch: added.draft.branch, updatedAt: 3 } })
      touchDraftBranch(sql, added.draft.branch, 7)
      expect(draftById(sql, 8, added.draft.id)?.updatedAt).toBe(7)
      removeDraftRecord(sql, added.draft.id)
      expect(draftById(sql, 9, added.draft.id)).toBeNull()
    })
  })
})

describe("draft names", () => {
  const drafts = [{ id: "main", name: "Main", branch: "main", startedFrom: "main" as const, createdAt: 0, updatedAt: 0 }]

  it("takes 1 to 40 characters after trimming, unique ignoring case, without control characters", () => {
    expect(draftNameProblem("   ", drafts)).toBe("Give the draft a name.")
    expect(draftNameProblem("x".repeat(41), drafts)).toBe("Keep the name to 40 characters or fewer.")
    expect(draftNameProblem(` ${"x".repeat(40)} `, drafts)).toBeNull()
    expect(draftNameProblem("Line\nbreak", drafts)).toBe("The name can't contain line breaks or tabs.")
    expect(draftNameProblem("Tab\there", drafts)).toBe("The name can't contain line breaks or tabs.")
    expect(draftNameProblem(" main ", drafts)).toBe("Another draft already has that name.")
    expect(draftNameProblem("Main", drafts, "main")).toBeNull()
    expect(draftNameProblem("Rebajas de primavera", drafts)).toBeNull()
  })
})

describe("draft ids and branches", () => {
  it("draws 8 lowercase letters and digits, skipping bytes that would bias the draw", () => {
    // Each call takes the next 8 bytes. The first 8 skip 255 and 252 and give a, b, z, 0, 9, a (36 % 36 = 0); the
    // next 8 start 251 (% 36 = 35, "9") and 100 (% 36 = 28, "2"), which complete the id.
    const bytes = [255, 252, 0, 1, 25, 26, 35, 36, 251, 100]
    let at = 0
    const id = newDraftId((length) => Uint8Array.from({ length }, () => bytes[at++ % bytes.length] ?? 0))
    expect(id).toBe("abz09a92")
    expect(newDraftId()).toMatch(/^[a-z0-9]{8}$/)
    expect(draftBranchOf("main")).toBe("main")
    expect(draftBranchOf("k3x9q2mf")).toBe("draft-k3x9q2mf")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `rtk proxy bun run test -- space/test/drafts-store.test.ts`
Expected: FAIL, "Failed to resolve import ../src/space/drafts-store".

- [ ] **Step 4: Write the implementation**

```ts
/**
 * A store's drafts: named versions of it, each backed by a git branch in the workspace. Sellers name drafts; branch
 * names are generated from the id, so nothing a seller types reaches git.
 */

export const MAIN_DRAFT_ID = "main"
export const MAIN_DRAFT_NAME = "Main"
export const MAIN_BRANCH = "main"
/** Drafts per store, counting Main. Mirrored in shared/types/drafts.ts. */
export const DRAFT_LIMIT = 5
export const DRAFT_NAME_MAX_LENGTH = 40
/** Durable storage key holding the checked-out draft's branch, which a cold start rebuilds the workspace from. */
export const ACTIVE_BRANCH_KEY = "drafts:activeBranch"

const DRAFT_ID_LENGTH = 8
const DRAFT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
/** 252 = 36 * 7: bytes below it map onto the alphabet evenly. */
const UNBIASED_BYTE_LIMIT = 252

export const DRAFTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    branch TEXT NOT NULL UNIQUE,
    started_from TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`

export type DraftStart = "main" | "live"

export interface DraftRecord {
  id: string
  name: string
  branch: string
  startedFrom: DraftStart
  createdAt: number
  updatedAt: number
}

/** One draft as the seller sees it. */
export interface DraftSummary {
  id: string
  name: string
  startedFrom: DraftStart
  updatedAt: number
  /** Checked out: the chat edits it and the preview shows it. */
  active: boolean
  /** Its latest version is what the live store serves. */
  live: boolean
  /** The live store was last published from it. */
  publishedFromHere: boolean
  /** It has changes the live store doesn't. */
  unpublishedChanges: boolean
  /** The live store has changes it doesn't. */
  behindLive: boolean
  /** The AI is bringing the live store's changes into it. */
  bringingInLiveChanges: boolean
}

export interface DraftsSnapshot {
  drafts: DraftSummary[]
  activeDraftId: string
  /** The store has been published at least once. */
  published: boolean
  limit: number
}

export interface ActiveDraft {
  id: string
  name: string
  branch: string
}

export type ActivateDraftResult = { draft: ActiveDraft; previewStale: boolean } | { error: string }
export type CreateDraftResult = { id: string; name: string } | { error: string }
export type PublishDraftResult =
  | { commitHash: string; storeManifest: string | null; draftId: string; draftName: string }
  | { error: string }

/** What the Go live panel needs: the draft being edited, and the draft the live store came from. */
export interface PublishContext {
  active: { id: string; name: string; tip: string | null }
  publishedDraft: { id: string; name: string } | null
}

export function draftBranchOf(id: string): string {
  return id === MAIN_DRAFT_ID ? MAIN_BRANCH : `draft-${id}`
}

export function newDraftId(
  randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length)),
): string {
  let id = ""
  while (id.length < DRAFT_ID_LENGTH) {
    for (const byte of randomBytes(DRAFT_ID_LENGTH)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue
      id += DRAFT_ID_ALPHABET[byte % DRAFT_ID_ALPHABET.length]
      if (id.length === DRAFT_ID_LENGTH) break
    }
  }
  return id
}

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return code < 32 || code === 127
  })
}

/** Why `name` can't name a draft among `drafts`, or null. `exceptId` is the draft being renamed. */
export function draftNameProblem(name: string, drafts: DraftRecord[], exceptId?: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return "Give the draft a name."
  if (trimmed.length > DRAFT_NAME_MAX_LENGTH) return `Keep the name to ${DRAFT_NAME_MAX_LENGTH} characters or fewer.`
  if (hasControlCharacter(trimmed)) return "The name can't contain line breaks or tabs."
  const lower = trimmed.toLowerCase()
  if (drafts.some((draft) => draft.id !== exceptId && draft.name.toLowerCase() === lower)) {
    return "Another draft already has that name."
  }
  return null
}

function recordOf(row: Record<string, SqlStorageValue>): DraftRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    branch: String(row.branch),
    startedFrom: row.started_from === "live" ? "live" : "main",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

/** Every draft, Main first and then oldest first. Main's row is created on first use. */
export function listDraftRecords(sql: SqlStorage, nowMs: number): DraftRecord[] {
  sql.exec(
    "INSERT OR IGNORE INTO drafts (id, name, branch, started_from, created_at, updated_at) VALUES (?, ?, ?, 'main', ?, ?)",
    MAIN_DRAFT_ID,
    MAIN_DRAFT_NAME,
    MAIN_BRANCH,
    nowMs,
    nowMs,
  )
  return sql
    .exec("SELECT * FROM drafts ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at, id", MAIN_DRAFT_ID)
    .toArray()
    .map(recordOf)
}

export function draftById(sql: SqlStorage, nowMs: number, id: string): DraftRecord | null {
  return listDraftRecords(sql, nowMs).find((draft) => draft.id === id) ?? null
}

export function draftByBranch(sql: SqlStorage, nowMs: number, branch: string): DraftRecord | null {
  return listDraftRecords(sql, nowMs).find((draft) => draft.branch === branch) ?? null
}

export function addDraft(
  sql: SqlStorage,
  nowMs: number,
  input: { name: string; startedFrom: DraftStart },
): { draft: DraftRecord } | { error: string } {
  const drafts = listDraftRecords(sql, nowMs)
  if (drafts.length >= DRAFT_LIMIT) return { error: "Delete a draft to start a new one." }
  const problem = draftNameProblem(input.name, drafts)
  if (problem) return { error: problem }
  let id = newDraftId()
  while (drafts.some((draft) => draft.id === id)) id = newDraftId()
  const draft: DraftRecord = {
    id,
    name: input.name.trim(),
    branch: draftBranchOf(id),
    startedFrom: input.startedFrom,
    createdAt: nowMs,
    updatedAt: nowMs,
  }
  sql.exec(
    "INSERT INTO drafts (id, name, branch, started_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    draft.id,
    draft.name,
    draft.branch,
    draft.startedFrom,
    draft.createdAt,
    draft.updatedAt,
  )
  return { draft }
}

export function renameDraftRecord(
  sql: SqlStorage,
  nowMs: number,
  id: string,
  name: string,
): { draft: DraftRecord } | { error: string } {
  if (id === MAIN_DRAFT_ID) return { error: "Main keeps its name." }
  const drafts = listDraftRecords(sql, nowMs)
  const draft = drafts.find((candidate) => candidate.id === id)
  if (!draft) return { error: "That draft doesn't exist." }
  const problem = draftNameProblem(name, drafts, id)
  if (problem) return { error: problem }
  sql.exec("UPDATE drafts SET name = ?, updated_at = ? WHERE id = ?", name.trim(), nowMs, id)
  return { draft: { ...draft, name: name.trim(), updatedAt: nowMs } }
}

export function removeDraftRecord(sql: SqlStorage, id: string): void {
  sql.exec("DELETE FROM drafts WHERE id = ? AND id != ?", id, MAIN_DRAFT_ID)
}

/** Records that the draft on `branch` changed, for the switcher's last-changed time. */
export function touchDraftBranch(sql: SqlStorage, branch: string, nowMs: number): void {
  sql.exec("UPDATE drafts SET updated_at = ? WHERE branch = ?", nowMs, branch)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `rtk proxy bun run test -- space/test/drafts-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add space/src/space/drafts-store.ts space/test/drafts-store.test.ts
git commit -m "feat(drafts): draft records with names, the five-draft limit and main created on first use

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Draft branches and their states

**Files:**
- Create `space/src/space/draft-git.ts`.
- Test: `space/test/draft-git.test.ts`.

**Interfaces:**
- **Consumes:** `createGitFs`, `resolveHead` and `stageWorkdir` from `space/src/space/git-objects.ts`.
- **Produces:**
  - types: `GitAuthor` and `DraftGitState`;
  - `branchTip(fs, branch): Promise<string | null>`;
  - `ensureLocalBranch(fs, branch, fetchBranch): Promise<string | null>`;
  - `createDraftBranch(fs, branch, startCommit): Promise<void>`;
  - `deleteDraftBranch(fs, branch): Promise<void>`;
  - `draftGitState(fs, tip, published): Promise<DraftGitState>`.

**Facts from the spike** (run on 2026-10-19 against `withErrorCodes(new InMemoryFs())`, then thrown away):
- `git.isDescendent({ oid: x, ancestor: x })` is `false`, so state checks compare equality first.
- `git.merge` accepts a commit oid as `theirs`.
- A checkout to another branch carries uncommitted files along. Switching therefore commits first and checks out with `force: true`, which restores the target exactly.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Draft branches on a real isomorphic-git repository in memory: creating one at a commit, fetching one a cold start
 * left behind, and each draft's relation to the published commit.
 */
import { describe, expect, it } from "vitest"
import * as git from "isomorphic-git"
import { InMemoryFs, type FileSystem } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import { createGitFs } from "../src/space/git-objects"
import { withErrorCodes } from "../src/space/fs-error-codes"
import { branchTip, createDraftBranch, deleteDraftBranch, draftGitState, ensureLocalBranch } from "../src/space/draft-git"

const AUTHOR = { name: "Test", email: "test@vibesdk.local" }

async function repo() {
  const fs = withErrorCodes(new InMemoryFs())
  const g = createGit(fs)
  await g.init({ defaultBranch: "main" })
  const commit = async (path: string, text: string, message: string) => {
    await fs.writeFile(path, text)
    await g.add({ filepath: "." })
    return (await g.commit({ message, author: AUTHOR })).oid
  }
  return { fs, g, commit }
}

async function pointRemote(fs: FileSystem, branch: string, oid: string) {
  await git.writeRef({ fs: createGitFs(fs), dir: "/", ref: `refs/remotes/artifacts/${branch}`, value: oid, force: true })
}

describe("draft branches", () => {
  it("starts a draft at a commit and deletes it, never touching other branches", async () => {
    const { fs, commit } = await repo()
    const base = await commit("/index.html", "v1", "base")
    await createDraftBranch(fs, "draft-aaaa1111", base)
    expect(await branchTip(fs, "draft-aaaa1111")).toBe(base)
    await expect(createDraftBranch(fs, "draft-aaaa1111", base)).rejects.toThrow()
    await deleteDraftBranch(fs, "draft-aaaa1111")
    await deleteDraftBranch(fs, "draft-aaaa1111")
    expect(await branchTip(fs, "draft-aaaa1111")).toBeNull()
    expect(await branchTip(fs, "main")).toBe(base)
  })

  it("fetches a branch a cold start left behind and makes it local", async () => {
    const { fs, commit } = await repo()
    const base = await commit("/index.html", "v1", "base")
    const fetched: string[] = []
    await pointRemote(fs, "draft-bbbb2222", base)
    expect(await ensureLocalBranch(fs, "draft-bbbb2222", async (b) => void fetched.push(b))).toBe(base)
    expect(fetched).toEqual(["draft-bbbb2222"])
    expect(await branchTip(fs, "draft-bbbb2222")).toBe(base)
    expect(await ensureLocalBranch(fs, "draft-bbbb2222", async (b) => void fetched.push(b))).toBe(base)
    expect(fetched).toHaveLength(1)
    expect(await ensureLocalBranch(fs, "draft-missing0", async () => undefined)).toBeNull()
    expect(await ensureLocalBranch(fs, "draft-failing0", async () => { throw new Error("offline") })).toBeNull()
  })
})

describe("draft states", () => {
  it("says live, unpublished changes, behind, or both, against the published commit", async () => {
    const { fs, g, commit } = await repo()
    const published = await commit("/index.html", "v1", "published")
    await createDraftBranch(fs, "draft-fix00001", published)
    const mainWork = await commit("/index.html", "redesign", "redesign")

    expect(await draftGitState(fs, published, published)).toEqual({ live: true, unpublishedChanges: false, behindLive: false })
    expect(await draftGitState(fs, mainWork, published)).toEqual({ live: false, unpublishedChanges: true, behindLive: false })

    await g.checkout({ ref: "draft-fix00001", force: true })
    const fix = await commit("/about.html", "fixed typo", "fix typo")
    // The quick fix is published: Main has its own work and lacks the fix.
    expect(await draftGitState(fs, mainWork, fix)).toEqual({ live: false, unpublishedChanges: true, behindLive: true })
    // A draft the published version already contains is only behind.
    expect(await draftGitState(fs, published, fix)).toEqual({ live: false, unpublishedChanges: false, behindLive: true })
  })

  it("says nothing before the first publish or for a draft with no commits", async () => {
    const { fs, commit } = await repo()
    const tip = await commit("/index.html", "v1", "first")
    const none = { live: false, unpublishedChanges: false, behindLive: false }
    expect(await draftGitState(fs, tip, null)).toEqual(none)
    expect(await draftGitState(fs, null, tip)).toEqual(none)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk proxy bun run test -- space/test/draft-git.test.ts`
Expected: FAIL, "Failed to resolve import ../src/space/draft-git".

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Git work behind drafts, on the workspace's own repository: draft branches, how each relates to the published
 * commit, and bringing the published commit into a draft. `@cloudflare/shell/git` has no merge, so this uses
 * isomorphic-git directly, as git-objects.ts does.
 */
import * as git from "isomorphic-git"
import type { FileSystem } from "@cloudflare/shell"
import { createGitFs, resolveHead } from "./git-objects"

const REMOTE_PREFIX = "refs/remotes/artifacts/"

export interface GitAuthor {
  name: string
  email: string
}

export interface DraftGitState {
  live: boolean
  unpublishedChanges: boolean
  behindLive: boolean
}

export async function branchTip(fs: FileSystem, branch: string): Promise<string | null> {
  return resolveHead(fs, `refs/heads/${branch}`)
}

/**
 * The branch's tip, fetching it first when the workspace doesn't have it: after a cold start only the checked-out
 * draft is local. Null when it can't be found.
 */
export async function ensureLocalBranch(
  fs: FileSystem,
  branch: string,
  fetchBranch: (branch: string) => Promise<void>,
): Promise<string | null> {
  const local = await branchTip(fs, branch)
  if (local) return local
  try {
    await fetchBranch(branch)
  } catch {
    return null
  }
  const remote = await resolveHead(fs, `${REMOTE_PREFIX}${branch}`)
  if (!remote) return null
  await git.writeRef({ fs: createGitFs(fs), dir: "/", ref: `refs/heads/${branch}`, value: remote })
  return remote
}

export async function createDraftBranch(fs: FileSystem, branch: string, startCommit: string): Promise<void> {
  await git.writeRef({ fs: createGitFs(fs), dir: "/", ref: `refs/heads/${branch}`, value: startCommit })
}

export async function deleteDraftBranch(fs: FileSystem, branch: string): Promise<void> {
  if (!(await branchTip(fs, branch))) return
  await git.deleteRef({ fs: createGitFs(fs), dir: "/", ref: `refs/heads/${branch}` })
}

/** True when `tip`'s history includes `commit`. Missing objects count as not included. */
async function includes(fs: FileSystem, tip: string, commit: string): Promise<boolean> {
  if (tip === commit) return true
  try {
    return await git.isDescendent({ fs: createGitFs(fs), dir: "/", oid: tip, ancestor: commit, depth: -1 })
  } catch {
    return false
  }
}

export async function draftGitState(fs: FileSystem, tip: string | null, published: string | null): Promise<DraftGitState> {
  if (!tip || !published) return { live: false, unpublishedChanges: false, behindLive: false }
  if (tip === published) return { live: true, unpublishedChanges: false, behindLive: false }
  const [hasPublished, publishedHasTip] = await Promise.all([includes(fs, tip, published), includes(fs, published, tip)])
  return { live: false, unpublishedChanges: !publishedHasTip, behindLive: !hasPublished }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk proxy bun run test -- space/test/draft-git.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add space/src/space/draft-git.ts space/test/draft-git.test.ts
git commit -m "feat(drafts): draft branches, fetching one a cold start left behind, and each draft's state against the live store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Bringing the published version into a draft

**Files:**
- Modify `space/src/space/draft-git.ts`.
- Test: `space/test/draft-merge.test.ts`.

**Interfaces:**
- **Consumes:** Task 2's helpers.
- **Produces:**
  - constants: `LIVE_CHANGES_MESSAGE` (`"Brought in the live store's changes"`) and `MERGE_STATE_KEY` (`"drafts:merge"`);
  - types:
    - `MergeOutcome` = `{ result: "up-to-date" } | { result: "fast-forward" | "merged"; commit: string } | { result: "conflicts"; files: string[]; ours: string }`;
    - `MergeState` = `{ draftId; branch; ours; theirs; files: string[]; merged: string | null }`;
    - `BringInOutcome` = `{ result: "up-to-date" } | { result: "fast-forward" | "merged"; commit: string; deploy: unknown } | { result: "conflicts"; files: string[]; liveChanges: string[] } | { error: string }`;
  - functions:
    - `mergePublished(fs, branch, published, author): Promise<MergeOutcome>`;
    - `liveChangeMessages(fs, ours, published, limit?): Promise<string[]>`;
    - `filesWithConflictMarkers(fs, files): Promise<string[]>`;
    - `mergeCommitPending(fs, merge): Promise<boolean>`;
    - `commitMergeResolution(fs, merge, author, isReserved): Promise<{ commit: string } | { error: string }>`;
    - `cancelMerge(fs, merge): Promise<void>`.

**Facts from the spike** (isomorphic-git 1.38.4):
- **Fast-forward:** `merge` returns `{ oid, fastForward: true }` and moves the branch.
- **Clean merge:** it returns `{ oid, tree, mergeCommit: true }`, a commit with 2 parents, and updates the working tree.
- **Conflict with `abortOnConflict: false`:**
  - it throws an error whose `code` is `"MergeConflictError"` and whose `data.filepaths` lists the files (no leading slash);
  - the files get `<<<<<<< {ours}` / `>>>>>>> {theirs}` markers;
  - the branch doesn't move, and no `MERGE_HEAD` is written. That's why `MergeState` keeps `theirs`.
- **Resolving:** `git.commit({ parent: [ours, theirs] })` after `stageWorkdir` makes the merge commit and moves the branch.
- **Aborting:** `git.abortMerge` restores every file to the draft's version.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Bringing the published commit into a draft, on a real repository in memory: fast-forwards, clean merges, conflicts
 * left for the AI with their markers, the merge commit once resolved, and cancelling back to the draft's last version.
 */
import { describe, expect, it } from "vitest"
import * as git from "isomorphic-git"
import { InMemoryFs } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import { createGitFs } from "../src/space/git-objects"
import { withErrorCodes } from "../src/space/fs-error-codes"
import {
  branchTip,
  cancelMerge,
  commitMergeResolution,
  createDraftBranch,
  draftGitState,
  filesWithConflictMarkers,
  LIVE_CHANGES_MESSAGE,
  liveChangeMessages,
  mergeCommitPending,
  mergePublished,
  type MergeState,
} from "../src/space/draft-git"

const AUTHOR = { name: "Test", email: "test@vibesdk.local" }
const isReserved = (p: string) => p === "/.afs" || p.startsWith("/.afs/") || p === "/.git" || p.startsWith("/.git/")

/** Main and a quick fix that both start at `base`; the fix is what's published. */
async function quickFixRepo(fix: { path: string; text: string }) {
  const fs = withErrorCodes(new InMemoryFs())
  const g = createGit(fs)
  await g.init({ defaultBranch: "main" })
  const commit = async (path: string, text: string, message: string) => {
    await fs.writeFile(path, text)
    await g.add({ filepath: "." })
    return (await g.commit({ message, author: AUTHOR })).oid
  }
  await fs.writeFile("/about.html", "Our tea is grown wiht care.\n")
  const base = await commit("/index.html", "<h1>Northwind</h1>\n", "first version")
  await createDraftBranch(fs, "draft-fix00001", base)
  await g.checkout({ ref: "draft-fix00001", force: true })
  const published = await commit(fix.path, fix.text, "Fix the typo on the about page")
  await g.checkout({ ref: "main", force: true })
  return { fs, g, commit, base, published }
}

describe("mergePublished", () => {
  it("fast-forwards a draft with nothing of its own", async () => {
    const { fs, published } = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    expect(await mergePublished(fs, "main", published, AUTHOR)).toEqual({ result: "fast-forward", commit: published })
    expect(await branchTip(fs, "main")).toBe(published)
    expect(await fs.readFile("/about.html")).toBe("Our tea is grown with care.\n")
  })

  it("says up to date when the draft already has the published version", async () => {
    const { fs, published } = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    await mergePublished(fs, "main", published, AUTHOR)
    expect(await mergePublished(fs, "main", published, AUTHOR)).toEqual({ result: "up-to-date" })
  })

  it("makes a merge commit when both sides changed different files, keeping both", async () => {
    const { fs, commit, published } = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    const redesign = await commit("/index.html", "<h1>Northwind Tea</h1>\n", "Redesign the home page")
    const outcome = await mergePublished(fs, "main", published, AUTHOR)
    expect(outcome.result).toBe("merged")
    const tip = await branchTip(fs, "main")
    if (!tip) throw new Error("expected Main to have a tip")
    const { commit: merged } = await git.readCommit({ fs: createGitFs(fs), dir: "/", oid: tip })
    expect(merged.parent).toEqual([redesign, published])
    expect(merged.message.trim()).toBe(LIVE_CHANGES_MESSAGE)
    expect(await fs.readFile("/index.html")).toBe("<h1>Northwind Tea</h1>\n")
    expect(await fs.readFile("/about.html")).toBe("Our tea is grown with care.\n")
    expect(await draftGitState(fs, tip, published)).toEqual({ live: false, unpublishedChanges: true, behindLive: false })
  })

  it("leaves conflict markers and the draft where it was when both sides changed the same lines", async () => {
    const { fs, commit, published } = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    const ours = await commit("/about.html", "Our teas are grown wiht love.\n", "Rewrite the about page")
    const outcome = await mergePublished(fs, "main", published, AUTHOR)
    expect(outcome).toEqual({ result: "conflicts", files: ["about.html"], ours })
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await filesWithConflictMarkers(fs, ["about.html"])).toEqual(["about.html"])
    expect(await liveChangeMessages(fs, ours, published)).toEqual(["Fix the typo on the about page"])
  })
})

describe("resolving and cancelling", () => {
  async function conflicted() {
    const setup = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    await setup.fs.writeFile("/shipping.html", "Free shipping over $50.\n")
    const ours = await setup.commit("/about.html", "Our teas are grown wiht love.\n", "Rewrite the about page")
    const outcome = await mergePublished(setup.fs, "main", setup.published, AUTHOR)
    if (outcome.result !== "conflicts") throw new Error("expected conflicts")
    const merge: MergeState = { draftId: "main", branch: "main", ours, theirs: setup.published, files: outcome.files, merged: null }
    return { ...setup, ours, merge }
  }

  it("refuses the merge commit while a file still has markers, then commits it with both parents", async () => {
    const { fs, ours, published, merge } = await conflicted()
    expect(await mergeCommitPending(fs, merge)).toBe(true)
    expect(await commitMergeResolution(fs, merge, AUTHOR, isReserved)).toEqual({ error: "Remove the conflict markers from about.html first." })
    expect(await branchTip(fs, "main")).toBe(ours)

    await fs.writeFile("/about.html", "Our teas are grown with love.\n")
    const resolved = await commitMergeResolution(fs, merge, AUTHOR, isReserved)
    if ("error" in resolved) throw new Error(resolved.error)
    const { commit } = await git.readCommit({ fs: createGitFs(fs), dir: "/", oid: resolved.commit })
    expect(commit.parent).toEqual([ours, published])
    expect(await branchTip(fs, "main")).toBe(resolved.commit)
    expect(await mergeCommitPending(fs, { ...merge, merged: resolved.commit })).toBe(false)
  })

  it("treats a merge commit lost with a cold start as still pending", async () => {
    const { fs, merge } = await conflicted()
    expect(await mergeCommitPending(fs, { ...merge, merged: "0123456789abcdef0123456789abcdef01234567" })).toBe(true)
  })

  it("cancels an unresolved merge back to the draft's last version", async () => {
    const { fs, ours, merge } = await conflicted()
    await fs.writeFile("/about.html", "half edited\n")
    await cancelMerge(fs, merge)
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await fs.readFile("/about.html")).toBe("Our teas are grown wiht love.\n")
    expect(await fs.readFile("/shipping.html")).toBe("Free shipping over $50.\n")
  })

  it("cancels a committed merge back to the draft's last version, dropping files only the live side added", async () => {
    const setup = await quickFixRepo({ path: "/returns.html", text: "Returns within 30 days.\n" })
    const ours = await setup.commit("/index.html", "<h1>Northwind Tea</h1>\n", "Redesign the home page")
    const outcome = await mergePublished(setup.fs, "main", setup.published, AUTHOR)
    if (outcome.result !== "merged") throw new Error("expected a clean merge")
    expect(await setup.fs.exists("/returns.html")).toBe(true)
    await cancelMerge(setup.fs, { draftId: "main", branch: "main", ours, theirs: setup.published, files: [], merged: outcome.commit })
    expect(await branchTip(setup.fs, "main")).toBe(ours)
    expect(await setup.fs.exists("/returns.html")).toBe(false)
    expect(await setup.fs.readFile("/index.html")).toBe("<h1>Northwind Tea</h1>\n")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk proxy bun run test -- space/test/draft-merge.test.ts`
Expected: FAIL, "mergePublished is not exported" (or a SyntaxError on the missing named imports).

- [ ] **Step 3: Write the implementation.** In `space/src/space/draft-git.ts`, change the git-objects import to `import { createGitFs, resolveHead, stageWorkdir } from "./git-objects"`, then append:

```ts
export const LIVE_CHANGES_MESSAGE = "Brought in the live store's changes"
/** Durable storage key of the merge the AI is resolving. */
export const MERGE_STATE_KEY = "drafts:merge"
const CONFLICT_MARKER = /^(<{7}|>{7}) /m

export type MergeOutcome =
  | { result: "up-to-date" }
  | { result: "fast-forward" | "merged"; commit: string }
  | { result: "conflicts"; files: string[]; ours: string }

/** What bringing in the live store's changes did, as SpaceDO reports it. */
export type BringInOutcome =
  | { result: "up-to-date" }
  | { result: "fast-forward" | "merged"; commit: string; deploy: unknown }
  | { result: "conflicts"; files: string[]; liveChanges: string[] }
  | { error: string }

/**
 * A merge of the published commit into a draft that hasn't built yet. It spans tool calls, so it lives in durable
 * storage. Nothing is mirrored to Artifacts until a deploy of the draft builds.
 */
export interface MergeState {
  draftId: string
  branch: string
  /** The draft's tip before the merge: cancelling returns to it. */
  ours: string
  /** The published commit being brought in. */
  theirs: string
  files: string[]
  /** The merge (or fast-forward) commit once there is one. */
  merged: string | null
}

function conflictFiles(error: unknown): string[] | null {
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== "MergeConflictError") return null
  const filepaths = (error as { data?: { filepaths?: unknown } }).data?.filepaths
  return Array.isArray(filepaths) ? filepaths.map(String) : []
}

/**
 * Merges the published commit into the checked-out draft `branch`. On a conflict, the markers stay in the working
 * tree and the branch stays where it was, for the AI to resolve.
 */
export async function mergePublished(
  fs: FileSystem,
  branch: string,
  published: string,
  author: GitAuthor,
): Promise<MergeOutcome> {
  const ours = await branchTip(fs, branch)
  if (!ours) throw new Error(`Draft branch "${branch}" has no commits`)
  if (await includes(fs, ours, published)) return { result: "up-to-date" }
  const gitFs = createGitFs(fs)
  try {
    const merged = await git.merge({
      fs: gitFs,
      dir: "/",
      ours: branch,
      theirs: published,
      author,
      committer: author,
      message: LIVE_CHANGES_MESSAGE,
      abortOnConflict: false,
    })
    await git.checkout({ fs: gitFs, dir: "/", ref: branch, force: true })
    const commit = merged.oid ?? (await branchTip(fs, branch)) ?? ours
    return { result: merged.fastForward ? "fast-forward" : "merged", commit }
  } catch (error) {
    const files = conflictFiles(error)
    if (files === null) throw error
    return { result: "conflicts", files, ours }
  }
}

/** The published side's commit messages the draft doesn't have, newest first: what the AI is told it brings in. */
export async function liveChangeMessages(fs: FileSystem, ours: string, published: string, limit = 20): Promise<string[]> {
  const messages: string[] = []
  for (const entry of await git.log({ fs: createGitFs(fs), dir: "/", ref: published, depth: 200 })) {
    if (messages.length >= limit || (await includes(fs, ours, entry.oid))) break
    messages.push(entry.commit.message.trim())
  }
  return messages
}

export async function filesWithConflictMarkers(fs: FileSystem, files: string[]): Promise<string[]> {
  const marked: string[] = []
  for (const file of files) {
    let text: string
    try {
      text = await fs.readFile(file.startsWith("/") ? file : `/${file}`)
    } catch {
      continue
    }
    if (CONFLICT_MARKER.test(text)) marked.push(file)
  }
  return marked
}

/** True until the draft's history has the merge commit, including when a cold start lost an unmirrored one. */
export async function mergeCommitPending(fs: FileSystem, merge: MergeState): Promise<boolean> {
  if (merge.merged === null) return true
  const tip = await branchTip(fs, merge.branch)
  return tip === null || !(await includes(fs, tip, merge.merged))
}

/** Commits the resolved working tree as the merge commit, with the draft's tip and the published commit as parents. */
export async function commitMergeResolution(
  fs: FileSystem,
  merge: MergeState,
  author: GitAuthor,
  isReserved: (path: string) => boolean,
): Promise<{ commit: string } | { error: string }> {
  const marked = await filesWithConflictMarkers(fs, merge.files)
  if (marked.length > 0) return { error: `Remove the conflict markers from ${marked.join(", ")} first.` }
  const head = await branchTip(fs, merge.branch)
  if (!head) return { error: `Draft branch "${merge.branch}" has no commits` }
  await stageWorkdir(fs, isReserved)
  const commit = await git.commit({
    fs: createGitFs(fs),
    dir: "/",
    message: LIVE_CHANGES_MESSAGE,
    author,
    committer: author,
    parent: [head, merge.theirs],
  })
  return { commit }
}

/** Puts the draft back at its tip from before the merge, working tree included. */
export async function cancelMerge(fs: FileSystem, merge: MergeState): Promise<void> {
  const gitFs = createGitFs(fs)
  if (merge.merged === null) {
    try {
      await git.abortMerge({ fs: gitFs, dir: "/" })
    } catch {
      // The forced checkout below restores the working tree either way.
    }
  }
  await git.writeRef({ fs: gitFs, dir: "/", ref: `refs/heads/${merge.branch}`, value: merge.ours, force: true })
  await git.checkout({ fs: gitFs, dir: "/", ref: merge.branch, force: true })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- space/test/draft-merge.test.ts space/test/draft-git.test.ts`
Expected: PASS (12 tests).

**If the committed-merge cancel test fails because `/returns.html` is still there**, isomorphic-git's forced checkout kept a file that only the merge commit tracked. In that case:
1. Before the `writeRef` in `cancelMerge`, list the files in the tree of `merge.merged` that aren't in the tree of `merge.ours`. Use `git.walk` with two `TREE` walkers, as `walkTreeFiles` in git-objects.ts does.
2. After the checkout, remove each of them with `fs.rm(path, { force: true })`.
3. Ledger the ruling.

- [ ] **Step 5: Commit**

```bash
git add space/src/space/draft-git.ts space/test/draft-merge.test.ts
git commit -m "feat(drafts): bring the published version into a draft, with conflicts left for the ai and cancel back to the draft

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Publishing any draft

**Files:**
- Modify `space/src/space/deploy-engine.ts`: `DEPLOYMENTS_TABLE_SQL` gains `source_branch TEXT`; `publishLiveDeployment` takes the branch; add `publishedVersion`.
- Test: `space/test/live-deployment.test.ts`.

**Interfaces:**
- **Consumes:** nothing new.
- **Produces:**
  - `publishLiveDeployment(sql, nowMs, branch): { commitHash: string; storeManifest: string | null } | null`;
  - `publishedVersion(sql): PublishedVersion | null`;
  - `interface PublishedVersion { commit: string; sourceBranch: string }`.

- [ ] **Step 1: Write the failing test.** In `space/test/live-deployment.test.ts`:
  - change both existing calls `publishLiveDeployment(sql, 50)` and `(sql, 60)` to pass `'main'` as the third argument;
  - add `publishedVersion` to the import;
  - add the following inside `describe('publishLiveDeployment', ...)`:

```ts
	it("publishes a draft's own build and records the draft it came from", async () => {
		await runInDurableObject(uniqueStub('draft'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			deployMain(sql, 'm1', null);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('draft-fix00001', 'f1', 'index.js', '{}', '{}', '{}', '{"version":2}', 2)`,
			);
			expect(publishedVersion(sql)).toBeNull();
			expect(publishLiveDeployment(sql, 70, 'draft-fix00001')).toEqual({ commitHash: 'f1', storeManifest: '{"version":2}' });
			expect(publishedVersion(sql)).toEqual({ commit: 'f1', sourceBranch: 'draft-fix00001' });
			expect(rowOf(sql, 'main')).toMatchObject({ commit_hash: 'm1' });
			expect(publishLiveDeployment(sql, 80, 'draft-never00')).toBeNull();
			expect(publishLiveDeployment(sql, 80, 'live')).toBeNull();
			expect(publishedVersion(sql)).toEqual({ commit: 'f1', sourceBranch: 'draft-fix00001' });
		});
	});

	it('reads a store published before drafts as published from Main', async () => {
		await runInDurableObject(uniqueStub('legacy'), async (_instance, state) => {
			const sql = state.storage.sql;
			sql.exec(DEPLOYMENTS_TABLE_SQL);
			sql.exec(
				`INSERT INTO deployments (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at) VALUES ('live', 'old', 'index.js', '{}', '{}', '{}', NULL, 1)`,
			);
			expect(publishedVersion(sql)).toEqual({ commit: 'old', sourceBranch: 'main' });
		});
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `rtk proxy bun run test -- space/test/live-deployment.test.ts`
Expected: FAIL, because `publishedVersion` isn't exported.

- [ ] **Step 3: Implement it.** In `deploy-engine.ts`:
  1. Add `    source_branch TEXT,` after `store_manifest TEXT,` in `DEPLOYMENTS_TABLE_SQL`.
  2. Replace `publishLiveDeployment` with:

```ts
/** What the live store serves, and the draft branch it was published from. */
export interface PublishedVersion {
  commit: string
  sourceBranch: string
}

/**
 * Copies a draft's deployment into `live` unchanged, so shoppers get exactly the build the seller previewed. It
 * neither rebuilds nor checks anything out, so the working tree never moves. Null when the draft was never deployed.
 */
export function publishLiveDeployment(
  sql: SqlStorage,
  nowMs: number,
  branch: string,
): { commitHash: string; storeManifest: string | null } | null {
  if (isReservedBranch(branch)) return null
  const preview = sql
    .exec("SELECT commit_hash, store_manifest FROM deployments WHERE branch = ?", branch)
    .toArray()[0]
  if (!preview) return null
  sql.exec(
    `INSERT OR REPLACE INTO deployments
     (branch, commit_hash, main_module, modules, assets, asset_config, store_manifest, deployed_at, source_branch)
     SELECT ?, commit_hash, main_module, modules, assets, asset_config, store_manifest, ?, ?
     FROM deployments WHERE branch = ?`,
    LIVE_BRANCH,
    nowMs,
    branch,
    branch,
  )
  return { commitHash: String(preview.commit_hash), storeManifest: preview.store_manifest === null ? null : String(preview.store_manifest) }
}

/** The live store's commit and its draft branch. A store published before drafts came from Main. */
export function publishedVersion(sql: SqlStorage): PublishedVersion | null {
  const row = sql.exec("SELECT commit_hash, source_branch FROM deployments WHERE branch = ?", LIVE_BRANCH).toArray()[0]
  if (!row) return null
  const source = row.source_branch
  return { commit: String(row.commit_hash), sourceBranch: typeof source === "string" && source.length > 0 ? source : PREVIEW_BRANCH }
}
```

  3. Update the doc comment on `PREVIEW_BRANCH` to "Main's branch, which stores published before drafts were published from".

- [ ] **Step 4: Run the test to verify it passes**

Run: `rtk proxy bun run test -- space/test/live-deployment.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add space/src/space/deploy-engine.ts space/test/live-deployment.test.ts
git commit -m "feat(drafts): publish any draft's build to the live store and record the draft it came from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: SpaceDO drafts

**Files:**
- **Modify `space/src/space/fs-backend.ts`:**
  - `ArtifactsBackend` takes its base branch;
  - the backend says whether it mirrors to Artifacts;
  - a push only clears the checkpoint for the checked-out branch.
- **Modify `space/src/space/durable-object.ts`:** the drafts table, the active branch, the lock, the RPCs, merge-aware commits and deploys; `publishLive` is removed.
- **Modify `space/src/index.ts`:** export the draft types.
- **Test:** `space/test/drafts-wiring.test.ts`, a source guard in the style of `space/test/read-tree-fetch.test.ts`. The git and SQL behavior is already covered by Tasks 1–4. SpaceDO itself needs the Artifacts binding, which the test pool lacks.

**Interfaces:**
- **Consumes:** everything from Tasks 1–4.
- **Produces these SpaceDO RPCs:**
  - `listDrafts(): Promise<DraftsSnapshot>`;
  - `getActiveDraft(): Promise<ActiveDraft & { tip: string | null }>`;
  - `getPublishContext(): Promise<PublishContext>`;
  - `createDraft(name: string, from: DraftStart): Promise<CreateDraftResult>`;
  - `renameDraft(id: string, name: string): Promise<{ ok: true } | { error: string }>`;
  - `deleteDraft(id: string): Promise<{ ok: true } | { error: string }>`;
  - `activateDraft(id: string): Promise<ActivateDraftResult>`;
  - `publishDraft(id?: string): Promise<PublishDraftResult>`;
  - `bringInLiveChanges(id: string): Promise<BringInOutcome>`;
  - `cancelBringingInLiveChanges(): Promise<{ cancelled: boolean }>`;
  - `getMergeState(): Promise<MergeState | null>`.
- **Exported from `@space-do/space`:** `DraftStart`, `DraftSummary`, `DraftsSnapshot`, `ActiveDraft`, `ActivateDraftResult`, `CreateDraftResult`, `PublishDraftResult`, `PublishContext`, `BringInOutcome` and `MergeState`.

- [ ] **Step 1: Write the failing source guard**

```ts
/**
 * Guards for the SpaceDO drafts wiring, which the test pool can't run (it needs the Artifacts binding):
 * - a cold start rebuilds the workspace from the checked-out draft, not always Main;
 * - pushing another branch never clears the checked-out draft's checkpoint of unsaved work;
 * - draft operations run one at a time, and file writes wait for the one running;
 * - a merge the AI is resolving isn't mirrored until it builds;
 * - publishing refuses a draft mid-merge and deploys a stale draft first.
 */
import { describe, expect, it } from "vitest"

const sources = import.meta.glob<string>(["/space/src/space/durable-object.ts", "/space/src/space/fs-backend.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
})

function source(path: string): string {
  const text = sources[path]
  if (text === undefined) throw new Error(`Source not found: ${path}`)
  return text
}

function methodBody(text: string, signature: string): string {
  const start = text.indexOf(signature)
  if (start === -1) throw new Error(`Method not found: ${signature}`)
  return text.slice(start, text.indexOf("\n  }\n", start))
}

describe("SpaceDO drafts wiring", () => {
  const spaceDo = source("/space/src/space/durable-object.ts")
  const backend = source("/space/src/space/fs-backend.ts")

  it("rebuilds the workspace from the checked-out draft after a cold start", () => {
    const init = methodBody(spaceDo, "private async initializeBackend(")
    expect(init).toContain("this.ctx.storage.get<string>(ACTIVE_BRANCH_KEY)")
    expect(init).toContain("new ArtifactsBackend(this.ctx, this.env, repoName, activeBranch)")
    expect(methodBody(spaceDo, "private async initializeSpace(")).toContain("this.git.init({ defaultBranch: this.activeBranchAtStart })")
    expect(methodBody(spaceDo, "private async initializeSpace(")).toContain("this.ctx.storage.sql.exec(DRAFTS_TABLE_SQL)")
    expect(backend).toContain("baseBranch: string = ARTIFACTS_BASE_BRANCH")
    expect(backend).toMatch(/createArtifactsBaseSource\(\{\s*overlay,\s*branch: baseBranch,/)
  })

  it("keeps the checked-out draft's checkpoint when another branch is pushed", () => {
    const push = methodBody(backend, "async push(branch: string)")
    expect(push).toContain("(await this.checkedOutBranch()) === branch")
    expect(push.indexOf("checkedOutBranch")).toBeLessThan(push.indexOf("this.resetCheckpointAfterPush()"))
  })

  it("runs draft operations one at a time and makes file writes wait for them", () => {
    for (const signature of ["async createDraft(", "async deleteDraft(", "async activateDraft(", "async publishDraft(", "async bringInLiveChanges(", "async cancelBringingInLiveChanges("]) {
      expect(methodBody(spaceDo, signature), signature).toContain("this.withDraftLock(")
    }
    for (const signature of ["async writeFile(", "async editFile(", "async deleteFile(", "async rm(", "async patch("]) {
      expect(methodBody(spaceDo, signature), signature).toContain("await this.draftOp")
    }
  })

  it("switches by saving, mirroring and force-checking-out, and refuses mid-merge", () => {
    const activate = methodBody(spaceDo, "async activateDraft(")
    const save = activate.indexOf("this.commitWorkingTree(`Saved before switching to '${target.name}'`)")
    const push = activate.indexOf("this.backend.push(current)")
    const checkout = activate.indexOf("this.git.checkout({ ref: target.branch, force: true })")
    const remember = activate.indexOf("this.ctx.storage.put(ACTIVE_BRANCH_KEY, target.branch)")
    expect(activate).toContain("if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }")
    expect(save).toBeGreaterThan(-1)
    expect(save).toBeLessThan(push)
    expect(push).toBeLessThan(checkout)
    expect(checkout).toBeLessThan(remember)
  })

  it("deletes a draft's version, preview and record, but never Main, the draft being edited or the live one", () => {
    const remove = methodBody(spaceDo, "async deleteDraft(")
    for (const refusal of ["Main can't be deleted.", "Switch to another draft before deleting this one.", "The live store was published from this draft."]) {
      expect(remove, refusal).toContain(refusal)
    }
    const refusals = remove.indexOf("The live store was published from this draft.")
    for (const step of ["deleteDraftBranch(this.fs, draft.branch)", "this.undeploy(draft.branch)", "removeDraftRecord(sql, draft.id)"]) {
      expect(remove.indexOf(step), step).toBeGreaterThan(refusals)
    }
  })

  it("doesn't mirror a merge until a deploy of it builds", () => {
    const commit = methodBody(spaceDo, "async gitCommit(")
    expect(commit).toContain("!(await this.mergeState())")
    const deploy = methodBody(spaceDo, "async deploy(branch: string)")
    expect(deploy).toContain("mergeCommitPending(this.fs, merge)")
    expect(deploy.indexOf("this.ctx.storage.delete(MERGE_STATE_KEY)")).toBeLessThan(deploy.indexOf("await this.backend.push(branch)"))
  })

  it("publishes a draft only after its latest version is deployed, never mid-merge", () => {
    const publish = methodBody(spaceDo, "async publishDraft(")
    expect(publish).toContain("Wait for the AI to finish bringing in the live store's changes.")
    expect(publish.indexOf("await this.deploy(draft.branch)")).toBeLessThan(publish.indexOf("publishLiveDeployment(sql, Date.now(), draft.branch)"))
    expect(spaceDo).not.toContain("async publishLive(")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy bun run test -- space/test/drafts-wiring.test.ts`
Expected: FAIL, "Method not found" or failed `toContain` assertions.

- [ ] **Step 3: Implement `fs-backend.ts`**
  1. Add to `SpaceFsBackend`:

```ts
  /** True when commits are mirrored to Artifacts, so a switch must not proceed if the mirror fails. */
  readonly mirrorsToArtifacts: boolean
```

  2. `ArtifactsBackend`:
     - set `readonly mirrorsToArtifacts = true`;
     - give the constructor a fourth parameter, `baseBranch: string = ARTIFACTS_BASE_BRANCH`;
     - use `baseBranch` where the constructor uses `ARTIFACTS_BASE_BRANCH`: `fetchSync.fetch(baseBranch)`, `createArtifactsBaseSource({ overlay, branch: baseBranch, ... })` and `new ArtifactsFileSystem(overlay, { source, branch: baseBranch, ... })`.
  3. Replace `push`:

```ts
  async push(branch: string): Promise<boolean> {
    const pushed = await this.getArtifactsSync().push(branch)
    // The checkpoint holds the checked-out branch's unmirrored work; pushing another branch must keep it.
    if (pushed && (await this.checkedOutBranch()) === branch) this.resetCheckpointAfterPush()
    return pushed
  }

  private async checkedOutBranch(): Promise<string | null> {
    try {
      const result = await this.git.branch({ list: true })
      return "current" in result && result.current ? result.current : null
    } catch {
      return null
    }
  }
```

  4. `SqlBackend`: set `readonly mirrorsToArtifacts = false`.

- [ ] **Step 4: Implement `durable-object.ts`**

**4a. Imports and constants** at the top:

```ts
import { publishedVersion, type PublishedVersion } from "./deploy-engine" // add to the existing deploy-engine import
import {
  ACTIVE_BRANCH_KEY,
  addDraft,
  DRAFT_LIMIT,
  DRAFTS_TABLE_SQL,
  draftById,
  draftByBranch,
  listDraftRecords,
  MAIN_BRANCH,
  MAIN_DRAFT_ID,
  removeDraftRecord,
  renameDraftRecord,
  touchDraftBranch,
  type ActivateDraftResult,
  type ActiveDraft,
  type CreateDraftResult,
  type DraftStart,
  type DraftSummary,
  type DraftsSnapshot,
  type PublishContext,
  type PublishDraftResult,
} from "./drafts-store"
import {
  branchTip,
  cancelMerge,
  commitMergeResolution,
  createDraftBranch,
  deleteDraftBranch,
  draftGitState,
  ensureLocalBranch,
  LIVE_CHANGES_MESSAGE,
  liveChangeMessages,
  MERGE_STATE_KEY,
  mergeCommitPending,
  mergePublished,
  type BringInOutcome,
  type MergeState,
} from "./draft-git"

const DEFAULT_AUTHOR = { name: "Agent", email: "agent@vibesdk.local" }
const MERGE_IN_PROGRESS = "Finish or cancel bringing in the live store's changes first."
```

Replace the two inline `{ name: "Agent", email: "agent@vibesdk.local" }` literals with `DEFAULT_AUTHOR`.

**4b. Fields and the lock** inside the class:

```ts
  /** The branch the workspace had checked out when this instance started; a cold start rebuilds from it. */
  private activeBranchAtStart = MAIN_BRANCH
  /** The draft operation running now; file writes and the next operation wait for it. */
  private draftOp: Promise<unknown> = Promise.resolve()

  private withDraftLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.draftOp.then(operation, operation)
    this.draftOp = run.catch(() => undefined)
    return run
  }

  private async mergeState(): Promise<MergeState | null> {
    return (await this.ctx.storage.get<MergeState>(MERGE_STATE_KEY)) ?? null
  }

  private fetchBranch = (branch: string): Promise<void> => this.backend.fetch(branch)

  /** The live store's version, with its commits fetched so merges and states can read them. */
  private async ensurePublishedObjects(): Promise<PublishedVersion | null> {
    const published = publishedVersion(this.ctx.storage.sql)
    if (published) await ensureLocalBranch(this.fs, published.sourceBranch, this.fetchBranch)
    return published
  }
```

**4c. Initialization:**
- In `initializeBackend`, before constructing the backend:

```ts
    const activeBranch = (await this.ctx.storage.get<string>(ACTIVE_BRANCH_KEY)) ?? MAIN_BRANCH
    this.activeBranchAtStart = activeBranch
```

  Construct it as `new ArtifactsBackend(this.ctx, this.env, repoName, activeBranch)`.
- In `initializeSpace`:
  - add `this.ctx.storage.sql.exec(DRAFTS_TABLE_SQL)` after `DEPLOYMENTS_TABLE_SQL`;
  - add `try { this.ctx.storage.sql.exec(`ALTER TABLE deployments ADD COLUMN source_branch TEXT`) } catch {}` beside the other `ALTER TABLE` lines;
  - change the init to `await this.git.init({ defaultBranch: this.activeBranchAtStart })`.

**4d. File writes wait for draft operations.** In `writeFile`, `editFile`, `deleteFile`, `rm` and `patch`, add `await this.draftOp` on the line after `await this.ensureInit()`.

**4e. Merge-aware commits.** Replace the body of `gitCommit` (keep `gitCommitLocal` as it is):

```ts
  /**
   * Commits the working tree to the checked-out branch. While the AI resolves a merge into it, the first commit is the
   * merge commit; nothing is mirrored until a deploy of it builds.
   */
  private async commitWorkingTree(
    message: string,
    author?: { name: string; email: string },
  ): Promise<{ sha: string; message: string; committed: boolean; branch: string | null }> {
    await this.materializeAll()
    await this.flushCheckpoint()
    const branch = await this.currentBranch()
    const merge = await this.mergeState()
    if (merge && branch === merge.branch && (await mergeCommitPending(this.fs, merge))) {
      await this.ensurePublishedObjects()
      const resolved = await commitMergeResolution(this.fs, merge, author ?? DEFAULT_AUTHOR, isReservedPath)
      if ("error" in resolved) throw new Error(resolved.error)
      await this.ctx.storage.put(MERGE_STATE_KEY, { ...merge, merged: resolved.commit } satisfies MergeState)
      touchDraftBranch(this.ctx.storage.sql, merge.branch, Date.now())
      return { sha: resolved.commit, message: LIVE_CHANGES_MESSAGE, committed: true, branch }
    }
    await stageWorkdir(this.fs, isReservedPath)
    if (await stagedTreeMatchesHead(this.fs, isReservedPath)) {
      const head = await resolveHead(this.fs, "HEAD")
      return { sha: head ?? "", message, committed: false, branch }
    }
    const result = await this.git.commit({ message, author: author ?? DEFAULT_AUTHOR })
    if (branch) touchDraftBranch(this.ctx.storage.sql, branch, Date.now())
    return { sha: result.oid, message: result.message, committed: true, branch }
  }

  async gitCommit(
    message: string,
    author?: { name: string; email: string }
  ): Promise<{ sha: string; message: string }> {
    await this.ensureInit()
    const result = await this.commitWorkingTree(message, author)
    const branch = result.branch
    if (result.committed && branch && !(await this.mergeState())) {
      this.ctx.waitUntil(this.backend.push(branch).then(() => undefined))
    }
    return { sha: result.sha, message: result.message }
  }
```

Keep the existing comments about materializing, staging and skipping no-op commits on the matching lines of `commitWorkingTree`.

**4f. Deploys end a merge.** In `deploy(branch)`, replace `if (!data.error) await this.backend.push(branch)` with:

```ts
    if (!data.error) {
      const merge = await this.mergeState()
      if (merge && merge.branch === branch) {
        // The resolution isn't committed yet, so this built the draft's old version: nothing new to mirror.
        if (await mergeCommitPending(this.fs, merge)) return data
        await this.ctx.storage.delete(MERGE_STATE_KEY)
      }
      await this.backend.push(branch)
    }
```

**4g. Replace `publishLive` with the draft RPCs** (in a `// ── Draft RPC methods ──` section):

```ts
  async listDrafts(): Promise<DraftsSnapshot> {
    await this.ensureInit()
    const sql = this.ctx.storage.sql
    const records = listDraftRecords(sql, Date.now())
    const active = (await this.currentBranch()) ?? MAIN_BRANCH
    const published = publishedVersion(sql)
    const merge = await this.mergeState()
    const drafts: DraftSummary[] = []
    for (const record of records) {
      const tip = await ensureLocalBranch(this.fs, record.branch, this.fetchBranch)
      const state = await draftGitState(this.fs, tip, published?.commit ?? null)
      drafts.push({
        id: record.id,
        name: record.name,
        startedFrom: record.startedFrom,
        updatedAt: record.updatedAt,
        active: record.branch === active,
        ...state,
        publishedFromHere: published?.sourceBranch === record.branch,
        bringingInLiveChanges: merge?.draftId === record.id,
      })
    }
    return {
      drafts,
      activeDraftId: drafts.find((draft) => draft.active)?.id ?? MAIN_DRAFT_ID,
      published: published !== null,
      limit: DRAFT_LIMIT,
    }
  }

  async getActiveDraft(): Promise<ActiveDraft & { tip: string | null }> {
    await this.ensureInit()
    const branch = (await this.currentBranch()) ?? MAIN_BRANCH
    const records = listDraftRecords(this.ctx.storage.sql, Date.now())
    const draft = records.find((record) => record.branch === branch) ?? records.find((record) => record.id === MAIN_DRAFT_ID)
    if (!draft) throw new Error("Main's draft record is missing")
    return { id: draft.id, name: draft.name, branch: draft.branch, tip: await branchTip(this.fs, draft.branch) }
  }

  async getPublishContext(): Promise<PublishContext> {
    const active = await this.getActiveDraft()
    const published = publishedVersion(this.ctx.storage.sql)
    const source = published ? draftByBranch(this.ctx.storage.sql, Date.now(), published.sourceBranch) : null
    return {
      active: { id: active.id, name: active.name, tip: active.tip },
      publishedDraft: source ? { id: source.id, name: source.name } : null,
    }
  }

  async createDraft(name: string, from: DraftStart): Promise<CreateDraftResult> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const sql = this.ctx.storage.sql
      if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }
      let start: string | null
      if (from === "live") {
        const published = await this.ensurePublishedObjects()
        if (!published) return { error: "Publish your store before starting a quick fix from it." }
        start = published.commit
      } else {
        // The seller expects what the preview shows, so Main's unsaved work comes along.
        if ((await this.currentBranch()) === MAIN_BRANCH) await this.commitWorkingTree("Saved before starting a new draft")
        start = await ensureLocalBranch(this.fs, MAIN_BRANCH, this.fetchBranch)
        if (!start) return { error: "Main has no saved version yet." }
      }
      const added = addDraft(sql, Date.now(), { name, startedFrom: from })
      if ("error" in added) return added
      await createDraftBranch(this.fs, added.draft.branch, start)
      if (this.backend.mirrorsToArtifacts && !(await this.backend.push(added.draft.branch))) {
        await deleteDraftBranch(this.fs, added.draft.branch)
        removeDraftRecord(sql, added.draft.id)
        return { error: "Couldn't save the new draft. Try again." }
      }
      return { id: added.draft.id, name: added.draft.name }
    })
  }

  async renameDraft(id: string, name: string): Promise<{ ok: true } | { error: string }> {
    await this.ensureInit()
    const renamed = renameDraftRecord(this.ctx.storage.sql, Date.now(), id, name)
    return "error" in renamed ? renamed : { ok: true }
  }

  async deleteDraft(id: string): Promise<{ ok: true } | { error: string }> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const sql = this.ctx.storage.sql
      const draft = draftById(sql, Date.now(), id)
      if (!draft) return { error: "That draft doesn't exist." }
      if (draft.id === MAIN_DRAFT_ID) return { error: "Main can't be deleted." }
      if (draft.branch === (await this.currentBranch())) return { error: "Switch to another draft before deleting this one." }
      if (publishedVersion(sql)?.sourceBranch === draft.branch) {
        return { error: "The live store was published from this draft. Publish another draft before deleting it." }
      }
      await deleteDraftBranch(this.fs, draft.branch)
      await this.undeploy(draft.branch)
      removeDraftRecord(sql, draft.id)
      return { ok: true }
    })
  }

  /** Checks out the draft. The caller deploys its preview when `previewStale`. */
  async activateDraft(id: string): Promise<ActivateDraftResult> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const target = draftById(this.ctx.storage.sql, Date.now(), id)
      if (!target) return { error: "That draft doesn't exist." }
      const current = (await this.currentBranch()) ?? MAIN_BRANCH
      if (target.branch !== current) {
        if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }
        await this.commitWorkingTree(`Saved before switching to '${target.name}'`)
        if (this.backend.mirrorsToArtifacts && !(await this.backend.push(current))) {
          return { error: "Couldn't save your work before switching. Try again." }
        }
        if (!(await ensureLocalBranch(this.fs, target.branch, this.fetchBranch))) {
          return { error: "That draft couldn't be loaded. Try again." }
        }
        // Forced, so the working tree is exactly the draft's: a plain checkout carries uncommitted files along.
        await this.git.checkout({ ref: target.branch, force: true })
        await this.ctx.storage.put(ACTIVE_BRANCH_KEY, target.branch)
      }
      const tip = await branchTip(this.fs, target.branch)
      return {
        draft: { id: target.id, name: target.name, branch: target.branch },
        previewStale: tip !== null && this.readDeployment(target.branch)?.commitHash !== tip,
      }
    })
  }

  /** Publishes the draft's build (the checked-out draft by default), deploying its latest version first. */
  async publishDraft(id?: string): Promise<PublishDraftResult> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const sql = this.ctx.storage.sql
      const records = listDraftRecords(sql, Date.now())
      const activeBranch = (await this.currentBranch()) ?? MAIN_BRANCH
      const draft = id ? records.find((record) => record.id === id) : records.find((record) => record.branch === activeBranch) ?? records[0]
      if (!draft) return { error: "That draft doesn't exist." }
      if ((await this.mergeState())?.branch === draft.branch) {
        return { error: "Wait for the AI to finish bringing in the live store's changes." }
      }
      const tip = await ensureLocalBranch(this.fs, draft.branch, this.fetchBranch)
      if (!tip) return { error: "Deploy the store's preview before publishing it." }
      if (this.readDeployment(draft.branch)?.commitHash !== tip) {
        const deployed = (await this.deploy(draft.branch)) as { error?: unknown }
        if (deployed.error) return { error: "This draft's preview doesn't build. Fix it before publishing." }
      }
      const published = publishLiveDeployment(sql, Date.now(), draft.branch)
      if (!published) return { error: "Deploy the store's preview before publishing it." }
      return { ...published, draftId: draft.id, draftName: draft.name }
    })
  }

  /** Brings the live store's version into the checked-out draft. Conflicts are left for the AI. */
  async bringInLiveChanges(id: string): Promise<BringInOutcome> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const draft = draftById(this.ctx.storage.sql, Date.now(), id)
      if (!draft) return { error: "That draft doesn't exist." }
      if (draft.branch !== (await this.currentBranch())) return { error: "Switch to this draft first." }
      if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }
      const published = await this.ensurePublishedObjects()
      if (!published) return { error: "Your store isn't published yet." }
      await this.commitWorkingTree("Saved before bringing in the live store's changes")
      const before = await branchTip(this.fs, draft.branch)
      if (!before) return { error: "This draft has no saved version yet." }
      const outcome = await mergePublished(this.fs, draft.branch, published.commit, DEFAULT_AUTHOR)
      if (outcome.result === "up-to-date") return outcome
      if (outcome.result === "conflicts") {
        await this.ctx.storage.put(MERGE_STATE_KEY, {
          draftId: draft.id,
          branch: draft.branch,
          ours: outcome.ours,
          theirs: published.commit,
          files: outcome.files,
          merged: null,
        } satisfies MergeState)
        return { result: "conflicts", files: outcome.files, liveChanges: await liveChangeMessages(this.fs, outcome.ours, published.commit) }
      }
      // A clean merge stays cancellable until it builds: the deploy below clears this and mirrors the draft.
      await this.ctx.storage.put(MERGE_STATE_KEY, {
        draftId: draft.id,
        branch: draft.branch,
        ours: before,
        theirs: published.commit,
        files: [],
        merged: outcome.commit,
      } satisfies MergeState)
      touchDraftBranch(this.ctx.storage.sql, draft.branch, Date.now())
      const deploy = await this.deploy(draft.branch)
      return { result: outcome.result, commit: outcome.commit, deploy }
    })
  }
```

The remaining two RPCs:

```ts
  async cancelBringingInLiveChanges(): Promise<{ cancelled: boolean }> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const merge = await this.mergeState()
      if (!merge) return { cancelled: false }
      await this.materializeAll()
      await cancelMerge(this.fs, merge)
      await this.ctx.storage.delete(MERGE_STATE_KEY)
      return { cancelled: true }
    })
  }

  async getMergeState(): Promise<MergeState | null> {
    await this.ensureInit()
    return this.mergeState()
  }
```

- [ ] **Step 5: Export the types from `space/src/index.ts`**

```ts
export type {
  ActivateDraftResult,
  ActiveDraft,
  CreateDraftResult,
  DraftStart,
  DraftSummary,
  DraftsSnapshot,
  PublishContext,
  PublishDraftResult,
} from "./space/drafts-store"
export type { BringInOutcome, MergeState } from "./space/draft-git"
```

- [ ] **Step 6: Run the guard and the space tests**

Run: `rtk proxy bun run test -- space/test/drafts-wiring.test.ts space/test/read-tree-fetch.test.ts space/test/fs-backend.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- space/test/drafts-store.test.ts space/test/draft-git.test.ts space/test/draft-merge.test.ts space/test/live-deployment.test.ts`
Expected: PASS.

Run: `bun run typecheck`
Expected: one error, in `worker/api/controllers/liveStores/controller.ts`, which still calls `publishLive`. Task 7 fixes it. Leave it, ledger the expected error, and commit.

- [ ] **Step 7: Commit**

```bash
git add space/src/space/fs-backend.ts space/src/space/durable-object.ts space/src/index.ts space/test/drafts-wiring.test.ts
git commit -m "feat(drafts): spacedo drafts with the active draft surviving cold starts, one draft operation at a time and merges mirrored only once they build

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: The Think host follows the active draft

**Files:**
- Create `worker/agents/think/draft-change.ts`: the shared result type, the busy message, and parsing a tool's active draft.
- Modify `worker/agents/core/behaviors/think.ts`:
  - `switchDraft`, `createDraft`, `applyActiveDraft`, `runDraftChange` and `cancelUnfinishedMerge`;
  - the draft tool outputs;
  - turns wait for a switch;
  - merges never outlive a turn.
- Modify `worker/agents/core/codingAgent.ts`: delegate `switchDraft` and `createDraft`.
- Test: `worker/agents/think/draft-change.test.ts`, plus the guard `worker/agents/core/behaviors/think-drafts-guard.test.ts`.

**Interfaces:**
- **Consumes:**
  - SpaceDO's `activateDraft`, `createDraft` and `cancelBringingInLiveChanges`;
  - the types `ActiveDraft`, `ActivateDraftResult`, `CreateDraftResult` and `DraftStart` from `@space-do/space`.
- **Produces:**
  - `type DraftChangeResult = { ok: true; draftId: string } | { error: string; status: 400 | 404 | 409 }`;
  - `DRAFT_BUSY_MESSAGE = "Wait for the AI to finish, then switch drafts."`;
  - `DRAFT_SWITCHING_TOOLS: ReadonlySet<string>` = `create_draft`, `switch_draft` and `bring_in_live_changes`;
  - `activeDraftOf(output: unknown): ActiveDraft | null`;
  - `ThinkCodingBehavior.switchDraft(draftId): Promise<DraftChangeResult>`;
  - `ThinkCodingBehavior.createDraft(name, from): Promise<DraftChangeResult>`;
  - `CodeGeneratorAgent.switchDraft(...)` and `CodeGeneratorAgent.createDraft(...)`, with the same signatures.

- [ ] **Step 1: Write the failing tests**

`worker/agents/think/draft-change.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { activeDraftOf, DRAFT_SWITCHING_TOOLS, draftErrorStatus } from './draft-change';

describe('activeDraftOf', () => {
	it("reads the draft a tool switched to from its JSON output, so the host's preview follows it", () => {
		const output = JSON.stringify({ activeDraft: { id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' } });
		expect(activeDraftOf(output)).toEqual({ id: 'k3x9q2mf', name: 'Spring sale', branch: 'draft-k3x9q2mf' });
		expect(activeDraftOf({ activeDraft: { id: 'main', name: 'Main', branch: 'main' } })).toEqual({ id: 'main', name: 'Main', branch: 'main' });
	});

	it('ignores outputs without a well-formed draft', () => {
		for (const output of ['not json', '{}', JSON.stringify({ activeDraft: { id: 1 } }), null, 42]) {
			expect(activeDraftOf(output)).toBeNull();
		}
	});

	it('lists the tools that can change the active draft', () => {
		expect([...DRAFT_SWITCHING_TOOLS].sort()).toEqual(['bring_in_live_changes', 'create_draft', 'switch_draft']);
	});

	it('answers 404 for a missing draft and 409 for any other refusal', () => {
		expect(draftErrorStatus("That draft doesn't exist.")).toBe(404);
		expect(draftErrorStatus("Couldn't save your work before switching. Try again.")).toBe(409);
	});
});
```

`worker/agents/core/behaviors/think-drafts-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/agents/core/behaviors/think.ts', '/worker/agents/core/codingAgent.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

function methodBody(text: string, signature: string): string {
	const start = text.indexOf(signature);
	if (start === -1) throw new Error(`Method not found: ${signature}`);
	return text.slice(start, text.indexOf('\n\t}\n', start));
}

describe('the Think host and drafts', () => {
	const think = source('/worker/agents/core/behaviors/think.ts');

	it('refuses to switch while the AI works, and cancels a leftover merge before switching', () => {
		const body = methodBody(think, 'async switchDraft(');
		expect(body.indexOf('this.isCodeGenerating()')).toBeLessThan(body.indexOf('space.activateDraft(draftId)'));
		expect(body.indexOf('space.cancelBringingInLiveChanges()')).toBeLessThan(body.indexOf('space.activateDraft(draftId)'));
		expect(body).toContain('this.runDraftChange(');
	});

	it('points the preview and the agent at the new draft, deploying it only when stale', () => {
		const body = methodBody(think, 'private async applyActiveDraft(');
		expect(body).toContain('currentBranch: draft.branch');
		expect(body).toContain('await this.deployCurrentBranch()');
		expect(body).toContain('WebSocketMessageResponses.DEPLOYMENT_COMPLETED');
		expect(body).toContain("`Now working on '${draft.name}'.`");
		expect(body).toContain('await this.configureThinkAgent()');
	});

	it('follows the draft a tool switched to without deploying from the host mid-turn', () => {
		expect(think).toContain('DRAFT_SWITCHING_TOOLS.has(toolName)');
		expect(think).toMatch(/activeDraftOf\(output\)[\s\S]{0,200}applyActiveDraft\(draft, false\)/);
	});

	it('makes a turn wait for a switch, and never lets a merge outlive its turn', () => {
		const build = methodBody(think, 'async build(');
		expect(build).toContain('await this.draftChange');
		expect(build.indexOf('await this.cancelUnfinishedMerge()')).toBeLessThan(build.indexOf('while (this.state.pendingUserInputs.length > 0)'));
		const runPrompt = methodBody(think, 'private async runPrompt(');
		expect(runPrompt).toContain('await this.cancelUnfinishedMerge()');
	});

	it('exposes switching and creating drafts on the agent for the drafts API', () => {
		const agent = source('/worker/agents/core/codingAgent.ts');
		expect(agent).toContain('async switchDraft(draftId: string): Promise<DraftChangeResult>');
		expect(agent).toContain('async createDraft(name: string, from: DraftStart): Promise<DraftChangeResult>');
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/agents/think/draft-change.test.ts worker/agents/core/behaviors/think-drafts-guard.test.ts`
Expected: FAIL. The module isn't found, and the guard's methods aren't there.

- [ ] **Step 3: Create `worker/agents/think/draft-change.ts`**

```ts
/** Switching drafts from the API and from the AI's tools: their shared result, refusals and tool-output parsing. */
import type { ActiveDraft } from '@space-do/space';

export type DraftChangeResult = { ok: true; draftId: string } | { error: string; status: 400 | 404 | 409 };

export const DRAFT_BUSY_MESSAGE = 'Wait for the AI to finish, then switch drafts.';
const MISSING_DRAFT = "That draft doesn't exist.";

/** Tools whose output names the draft now checked out. */
export const DRAFT_SWITCHING_TOOLS: ReadonlySet<string> = new Set(['create_draft', 'switch_draft', 'bring_in_live_changes']);

export function draftErrorStatus(error: string): 404 | 409 {
	return error === MISSING_DRAFT ? 404 : 409;
}

function isActiveDraft(value: unknown): value is ActiveDraft {
	if (!value || typeof value !== 'object') return false;
	const draft = value as Record<string, unknown>;
	return typeof draft.id === 'string' && typeof draft.name === 'string' && typeof draft.branch === 'string';
}

/** The `activeDraft` a draft tool reports, from its JSON string or object output. */
export function activeDraftOf(output: unknown): ActiveDraft | null {
	let parsed: unknown = output;
	if (typeof output === 'string') {
		try {
			parsed = JSON.parse(output);
		} catch {
			return null;
		}
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const draft = (parsed as { activeDraft?: unknown }).activeDraft;
	return isActiveDraft(draft) ? draft : null;
}
```

- [ ] **Step 4: Implement the host** in `think.ts`

**4a. Imports and the `SpaceRpcStub` type.**
- Import `ActiveDraft`, `ActivateDraftResult`, `CreateDraftResult` and `DraftStart` (type-only) from `@space-do/space`.
- Import `activeDraftOf`, `DRAFT_BUSY_MESSAGE`, `DRAFT_SWITCHING_TOOLS`, `draftErrorStatus` and `type DraftChangeResult` from `../../think/draft-change`.
- Add to `SpaceRpcStub`:

```ts
	activateDraft: (id: string) => Promise<ActivateDraftResult>;
	createDraft: (name: string, from: DraftStart) => Promise<CreateDraftResult>;
	cancelBringingInLiveChanges: () => Promise<{ cancelled: boolean }>;
```

**4b. Field and methods** (place them after `rollbackToCommit`):

```ts
	/** A draft switch in progress. A turn waits for it, so the AI never edits the draft being left. */
	private draftChange: Promise<unknown> | null = null;

	/** Switches the workspace to the draft. Refused while the AI works on the store. */
	async switchDraft(draftId: string): Promise<DraftChangeResult> {
		if (this.isCodeGenerating()) return { error: DRAFT_BUSY_MESSAGE, status: 409 };
		return this.runDraftChange(async (): Promise<DraftChangeResult> => {
			// A merge left by a crashed turn would block the switch; no turn is running, so none is being resolved.
			await this.callSpace((space) => space.cancelBringingInLiveChanges());
			const result = await this.callSpace((space) => space.activateDraft(draftId));
			if ('error' in result) return { error: result.error, status: draftErrorStatus(result.error) };
			await this.applyActiveDraft(result.draft, result.previewStale);
			return { ok: true, draftId: result.draft.id };
		});
	}

	/** Starts a draft from Main or from the live store, then switches to it. */
	async createDraft(name: string, from: DraftStart): Promise<DraftChangeResult> {
		if (this.isCodeGenerating()) return { error: DRAFT_BUSY_MESSAGE, status: 409 };
		const created = await this.callSpace((space) => space.createDraft(name, from));
		if ('error' in created) return { error: created.error, status: 400 };
		return this.switchDraft(created.id);
	}

	private async runDraftChange<T>(change: () => Promise<T>): Promise<T> {
		const run = change();
		this.draftChange = run;
		try {
			return await run;
		} finally {
			if (this.draftChange === run) this.draftChange = null;
		}
	}

	/** Points the session at the draft the workspace now has checked out: the agent, the preview and the chat. */
	private async applyActiveDraft(draft: ActiveDraft, deployPreview: boolean): Promise<void> {
		const changed = this.state.currentBranch !== draft.branch;
		this.setState({ ...this.state, currentBranch: draft.branch });
		// The agent's default preview address for its browser tools is per draft.
		await this.configureThinkAgent();
		if (deployPreview) {
			await this.deployCurrentBranch();
		} else {
			this.broadcast(WebSocketMessageResponses.DEPLOYMENT_COMPLETED, { previewURL: await this.getBrowserPreviewURL() });
		}
		if (changed) {
			this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
				message: `Now working on '${draft.name}'.`,
				conversationId: IdGenerator.generateConversationId(),
				isStreaming: false,
			});
		}
	}

	/** Merges never outlive the turn that started them, so a draft is never left half-merged or unbuilt. */
	private async cancelUnfinishedMerge(): Promise<void> {
		try {
			const { cancelled } = await this.callSpace((space) => space.cancelBringingInLiveChanges());
			if (!cancelled) return;
			this.broadcast(WebSocketMessageResponses.CONVERSATION_RESPONSE, {
				message: "Bringing in the live store's changes didn't finish, so this draft is back as it was. Ask again to retry.",
				conversationId: IdGenerator.generateConversationId(),
				isStreaming: false,
			});
		} catch (error) {
			this.logger.warn('Cancelling an unfinished merge failed', error);
		}
	}
```

**4c. Tool outputs.** In `translateChunk`'s `'tool-output-available'` case, add a branch after the `deploy_space` one:

```ts
				} else if (DRAFT_SWITCHING_TOOLS.has(toolName)) {
					// The tool deployed the draft itself, in order with the AI's other tools; the host only follows it.
					const draft = activeDraftOf(output);
					if (draft) await this.applyActiveDraft(draft, false);
```

**4d. `build()`.**
- Right after `this.buildProgress = new BuildProgressTracker(Date.now());` and inside the `try`, before the `while`, add `await this.cancelUnfinishedMerge();`.
- As the first statement inside the `while` loop, add `if (this.draftChange) await this.draftChange.catch(() => undefined);`.

**4e. `runPrompt()`.** As the last statement of its outer `finally` block, add `await this.cancelUnfinishedMerge();`.

**4f. `codingAgent.ts`.**
- Import `type DraftChangeResult` from `'../think/draft-change'`, and `type DraftStart` from `'@space-do/space'`.
- Add after `getDeployedCommit`:

```ts
    /** Switches the store's workspace to a draft; refused while the AI works. Think apps only. */
    async switchDraft(draftId: string): Promise<DraftChangeResult> {
        if (!(this.behavior instanceof ThinkCodingBehavior)) return { error: "Drafts aren't available for this project.", status: 409 };
        return this.behavior.switchDraft(draftId);
    }

    /** Starts a draft and switches to it; refused while the AI works. Think apps only. */
    async createDraft(name: string, from: DraftStart): Promise<DraftChangeResult> {
        if (!(this.behavior instanceof ThinkCodingBehavior)) return { error: "Drafts aren't available for this project.", status: 409 };
        return this.behavior.createDraft(name, from);
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/agents/think/draft-change.test.ts worker/agents/core/behaviors/think-drafts-guard.test.ts`
Expected: PASS (9 tests).

Run: `rtk proxy bun run test -- worker/agents/core/behaviors`
Expected: PASS, with no regressions in the existing Think host tests.

- [ ] **Step 6: Commit**

```bash
git add worker/agents/think/draft-change.ts worker/agents/think/draft-change.test.ts worker/agents/core/behaviors/think.ts worker/agents/core/behaviors/think-drafts-guard.test.ts worker/agents/core/codingAgent.ts
git commit -m "feat(drafts): the think host follows the active draft, turns wait for a switch and merges never outlive their turn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The drafts API and publishing a draft

**Files:**
- Create:
  - `worker/api/controllers/drafts/types.ts` and `worker/api/controllers/drafts/controller.ts`;
  - `worker/api/routes/draftRoutes.ts`;
  - `shared/types/drafts.ts`.
- Modify:
  - `worker/api/routes/index.ts`, to register the routes;
  - `worker/api/controllers/liveStores/controller.ts` (`publishDraft` and the draft context);
  - `worker/services/live-stores/view.ts`;
  - `shared/types/live-stores.ts` (`LiveStoreView.draft`, `LiveStoreView.publishedDraft` and `PublishLiveStoreRequest.draftId`);
  - `src/api-types.ts`.
- Test:
  - `worker/api/controllers/drafts/controller.test.ts`;
  - `worker/api/controllers/drafts/draft-routes-wiring.test.ts`;
  - the updated `worker/services/live-stores/view.test.ts` and `worker/api/controllers/liveStores/controller.sql.test.ts`.

**Interfaces:**
- **Consumes:**
  - from SpaceDO: `listDrafts`, `renameDraft`, `deleteDraft`, `publishDraft` and `getPublishContext`;
  - from the agent: `switchDraft` and `createDraft`;
  - `getAgentStub(env, appId)` from `worker/agents`.
- **Produces these routes:**
  - `GET /api/stores/:id/drafts` returns `DraftsSnapshot`;
  - `POST /api/stores/:id/drafts` takes `{ name, from }`;
  - `POST /api/stores/:id/drafts/:draftId/activate`;
  - `PATCH /api/stores/:id/drafts/:draftId` takes `{ name }`;
  - `DELETE /api/stores/:id/drafts/:draftId`.

  Every route answers the store's `DraftsSnapshot`.
- **Produces these types:**
  - `CreateDraftRequest = { name: string; from: DraftStart }` and `RenameDraftRequest = { name: string }`;
  - `MAIN_DRAFT_ID` and `DRAFT_NAME_MAX_LENGTH` in `shared/types/drafts.ts`, which mirror space's values;
  - on `LiveStoreView`: `draft: { id: string; name: string } | null` and `publishedDraft: { id: string; name: string } | null`.

- [ ] **Step 1: Write the failing tests**

`worker/api/controllers/drafts/controller.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DraftsSnapshot } from '@space-do/space';
import { draftsResponse, parseCreateDraft, parseRenameDraft } from './controller';

const SNAPSHOT: DraftsSnapshot = { drafts: [], activeDraftId: 'main', published: false, limit: 5 };

describe('drafts requests', () => {
	it('takes a name and where the draft starts from', () => {
		expect(parseCreateDraft({ name: ' Spring sale ', from: 'live' })).toEqual({ name: ' Spring sale ', from: 'live' });
		expect(parseCreateDraft({ name: 'Sale' })).toEqual({ name: 'Sale', from: 'main' });
		expect(parseCreateDraft({ name: 'Sale', from: 'published' })).toEqual({ error: 'Start the draft from Main or from the live store.' });
		expect(parseCreateDraft({ from: 'main' })).toEqual({ error: 'Give the draft a name.' });
		expect(parseRenameDraft({ name: 'Summer' })).toEqual({ name: 'Summer' });
		expect(parseRenameDraft({ name: 7 })).toEqual({ error: 'Give the draft a name.' });
	});
});

describe('drafts responses', () => {
	it('answers the store snapshot, or the refusal with its status', async () => {
		expect(await draftsResponse({ ok: true }, async () => SNAPSHOT)).toEqual({ data: SNAPSHOT });
		expect(await draftsResponse({ error: 'Main can\'t be deleted.' }, async () => SNAPSHOT)).toEqual({ error: "Main can't be deleted.", status: 409 });
		expect(await draftsResponse({ error: 'Wait for the AI to finish, then switch drafts.', status: 409 }, async () => SNAPSHOT)).toEqual({
			error: 'Wait for the AI to finish, then switch drafts.',
			status: 409,
		});
		expect(await draftsResponse({ error: "That draft doesn't exist." }, async () => SNAPSHOT)).toEqual({ error: "That draft doesn't exist.", status: 404 });
	});
});
```

`worker/api/controllers/drafts/draft-routes-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/worker/api/routes/draftRoutes.ts', '/worker/api/routes/index.ts', '/worker/api/controllers/liveStores/controller.ts'], {
	query: '?raw',
	import: 'default',
	eager: true,
});

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

describe('drafts routes', () => {
	it('are all owner-only and registered', () => {
		const routes = source('/worker/api/routes/draftRoutes.ts');
		for (const route of [
			"app.get('/api/stores/:id/drafts'",
			"app.post('/api/stores/:id/drafts'",
			"app.post('/api/stores/:id/drafts/:draftId/activate'",
			"app.patch('/api/stores/:id/drafts/:draftId'",
			"app.delete('/api/stores/:id/drafts/:draftId'",
		]) {
			expect(routes, route).toContain(route);
		}
		expect(routes.match(/setAuthLevel\(AuthConfig\.ownerOnly\)/g)).toHaveLength(5);
		expect(source('/worker/api/routes/index.ts')).toContain('setupDraftRoutes(app)');
	});

	it('publishes a draft through SpaceDO, which deploys it first when stale', () => {
		const live = source('/worker/api/controllers/liveStores/controller.ts');
		expect(live).toContain('space.publishDraft(draftId)');
		expect(live).not.toContain('publishLive()');
		expect(live).toContain('space?.getPublishContext()');
	});
});
```

Then update `worker/services/live-stores/view.test.ts`:
1. Add `draft: { id: 'main', name: 'Main' }, publishedDraft: null` to the `BASE` constant.
2. Add the same two fields, `draft: { id: 'main', name: 'Main' }` and `publishedDraft: null`, to the object the "suggests an address" test expects with `toEqual`.
3. Add this test:

```ts
	it('names the draft that would be published and the one the live store came from', () => {
		const view = liveStoreView({ ...BASE, draft: { id: 'k3x9q2mf', name: 'Typo fix' }, publishedDraft: { id: 'main', name: 'Main' } });
		expect(view.draft).toEqual({ id: 'k3x9q2mf', name: 'Typo fix' });
		expect(view.publishedDraft).toEqual({ id: 'main', name: 'Main' });
	});
```

In `worker/api/controllers/liveStores/controller.sql.test.ts`:
1. Replace the fake inside `spaces()` with:

```ts
		get: (appId: string) => ({
			publishDraft: async (draftId?: string) => {
				published.push(draftId ? `${appId}:${draftId}` : appId);
				await duringPublish?.();
				return { commitHash: 'c0ffee1', storeManifest: null, draftId: draftId ?? 'main', draftName: draftId ? 'Typo fix' : 'Main' };
			},
			getPublishContext: async () => ({ active: { id: 'main', name: 'Main', tip: 'c0ffee1' }, publishedDraft: null }),
			getStoreManifest: async () => ({ commitHash: 'c0ffee1', manifest: null }),
		}),
```

2. Give `publishAs` a fourth parameter, `draftId?: string`, and send `JSON.stringify(draftId ? { slug, draftId } : { slug })`.
3. Add this test inside `describe('publishing a live store', ...)`:

```ts
	it('publishes the draft the seller picked', async () => {
		const { namespace, published } = spaces();
		const response = await publishAs('app_tea', 'northwind-fix', namespace, 'k3x9q2mf');
		expect(response.status).toBe(200);
		expect(published).toEqual(['app_tea:k3x9q2mf']);
		expect((await bodyOf(response)).data).toMatchObject({ status: 'live', slug: 'northwind-fix' });
		const row = await db.prepare("SELECT published_commit FROM live_stores WHERE app_id = 'app_tea'").first();
		expect(row).toEqual({ published_commit: 'c0ffee1' });
	});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/api/controllers/drafts worker/services/live-stores/view.test.ts`
Expected: FAIL. The modules are missing, and the view has no `draft` field.

- [ ] **Step 3: Implement**

`shared/types/drafts.ts`:

```ts
/** Mirrors of the drafts values in space/src/space/drafts-store.ts, for the frontend. */
export const MAIN_DRAFT_ID = 'main';
export const DRAFT_NAME_MAX_LENGTH = 40;
```

`worker/api/controllers/drafts/types.ts`:

```ts
import type { DraftStart, DraftSummary, DraftsSnapshot } from '@space-do/space';

export type { DraftStart, DraftSummary, DraftsSnapshot };

export interface CreateDraftRequest {
	name: string;
	from: DraftStart;
}

export interface RenameDraftRequest {
	name: string;
}
```

`worker/api/controllers/drafts/controller.ts`:

```ts
/** A store's drafts, for its owner: list, start, switch, rename and delete. Publishing stays in the live store controller. */

import { BaseController } from '../baseController';
import type { RouteContext } from '../../types/route-context';
import type { ApiResponse, ControllerResponse } from '../types';
import type { DraftsSnapshot } from '@space-do/space';
import { getAgentStub } from '../../../agents';
import { draftErrorStatus } from '../../../agents/think/draft-change';
import type { CreateDraftRequest, RenameDraftRequest } from './types';

/** Starting and switching drafts go through the agent, which keeps its preview in step; the rest go to SpaceDO. */
interface DraftsSpaceStub {
	listDrafts(): Promise<DraftsSnapshot>;
	renameDraft(id: string, name: string): Promise<{ ok: true } | { error: string }>;
	deleteDraft(id: string): Promise<{ ok: true } | { error: string }>;
}

function spaceOf(env: Env, appId: string): DraftsSpaceStub | null {
	const namespace = (env as unknown as { SPACE_DO?: DurableObjectNamespace }).SPACE_DO;
	return namespace ? (namespace.get(namespace.idFromName(appId)) as unknown as DraftsSpaceStub) : null;
}

const NAME_REQUIRED = 'Give the draft a name.';

export function parseCreateDraft(body: { name?: unknown; from?: unknown }): CreateDraftRequest | { error: string } {
	if (typeof body.name !== 'string') return { error: NAME_REQUIRED };
	if (body.from !== undefined && body.from !== 'main' && body.from !== 'live') return { error: 'Start the draft from Main or from the live store.' };
	return { name: body.name, from: body.from === 'live' ? 'live' : 'main' };
}

export function parseRenameDraft(body: { name?: unknown }): RenameDraftRequest | { error: string } {
	return typeof body.name === 'string' ? { name: body.name } : { error: NAME_REQUIRED };
}

type DraftsOutcome = { ok: true } | { ok: true; draftId: string } | { error: string; status?: number };

/** The store's snapshot after a change, or the change's refusal with its status. */
export async function draftsResponse(
	outcome: DraftsOutcome,
	snapshot: () => Promise<DraftsSnapshot>,
): Promise<{ data: DraftsSnapshot } | { error: string; status: number }> {
	if ('error' in outcome) return { error: outcome.error, status: outcome.status ?? draftErrorStatus(outcome.error) };
	return { data: await snapshot() };
}

export class DraftsController extends BaseController {
	private static async respond(
		env: Env,
		appId: string | undefined,
		change: (space: DraftsSpaceStub, appId: string) => Promise<DraftsOutcome>,
	): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		if (!appId) return this.createErrorResponse<DraftsSnapshot>('Store not found', 404);
		const space = spaceOf(env, appId);
		if (!space) return this.createErrorResponse<DraftsSnapshot>("Drafts aren't available right now.", 503);
		try {
			const result = await draftsResponse(await change(space, appId), () => space.listDrafts());
			return 'error' in result ? this.createErrorResponse<DraftsSnapshot>(result.error, result.status) : this.createSuccessResponse(result.data);
		} catch (error) {
			return this.handleError(error, "update the store's drafts") as ControllerResponse<ApiResponse<DraftsSnapshot>>;
		}
	}

	static async list(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		return this.respond(env, context.pathParams.id, async () => ({ ok: true }));
	}

	static async create(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const body = await this.parseJsonBody<{ name?: unknown; from?: unknown }>(request);
		const parsed = parseCreateDraft(body.success && body.data ? body.data : {});
		return this.respond(env, context.pathParams.id, async (_space, appId) =>
			'error' in parsed ? { error: parsed.error, status: 400 } : (await getAgentStub(env, appId)).createDraft(parsed.name, parsed.from),
		);
	}

	static async activate(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (_space, appId) => (await getAgentStub(env, appId)).switchDraft(draftId));
	}

	static async rename(request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const body = await this.parseJsonBody<{ name?: unknown }>(request);
		const parsed = parseRenameDraft(body.success && body.data ? body.data : {});
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (space) => {
			if ('error' in parsed) return { error: parsed.error, status: 400 };
			const renamed = await space.renameDraft(draftId, parsed.name);
			return 'error' in renamed ? { error: renamed.error, status: renamed.error === "That draft doesn't exist." ? 404 : 400 } : renamed;
		});
	}

	static async remove(_request: Request, env: Env, _ctx: ExecutionContext, context: RouteContext): Promise<ControllerResponse<ApiResponse<DraftsSnapshot>>> {
		const draftId = context.pathParams.draftId ?? '';
		return this.respond(env, context.pathParams.id, async (space) => space.deleteDraft(draftId));
	}
}
```

`worker/api/routes/draftRoutes.ts`:

```ts
import { Hono } from 'hono';
import { AppEnv } from '../../types/appenv';
import { adaptController } from '../honoAdapter';
import { AuthConfig, setAuthLevel } from '../../middleware/auth/routeAuth';
import { DraftsController } from '../controllers/drafts/controller';

/** A store's drafts, for the app's owner. */
export function setupDraftRoutes(app: Hono<AppEnv>): void {
    app.get('/api/stores/:id/drafts', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.list));
    app.post('/api/stores/:id/drafts', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.create));
    app.post('/api/stores/:id/drafts/:draftId/activate', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.activate));
    app.patch('/api/stores/:id/drafts/:draftId', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.rename));
    app.delete('/api/stores/:id/drafts/:draftId', setAuthLevel(AuthConfig.ownerOnly), adaptController(DraftsController, DraftsController.remove));
}
```

In `worker/api/routes/index.ts`, import `setupDraftRoutes` and call `setupDraftRoutes(app);` right after `setupLiveStoreRoutes(app);`.

**The live store controller:**
1. Change `LiveSpaceStub` to:

```ts
interface LiveSpaceStub {
    publishDraft(id?: string): Promise<PublishDraftResult>;
    getPublishContext(): Promise<PublishContext>;
    getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null>;
}
```

   Import `PublishContext` and `PublishDraftResult` as types from `@space-do/space`.
2. In `viewOf`:
   - replace `space?.getStoreManifest('main') ?? null` with `space?.getPublishContext() ?? null`, and name it `context`;
   - pass `previewCommit: context?.active.tip ?? null`, `draft: context ? { id: context.active.id, name: context.active.name } : null` and `publishedDraft: context?.publishedDraft ?? null`.
3. In `publish`:
   - read `draftId` from the body: `const draftId = body.success && typeof body.data?.draftId === 'string' ? body.data.draftId : undefined;`, with `parseJsonBody<{ slug?: unknown; draftId?: unknown }>`;
   - replace `space.publishLive()` with `space.publishDraft(draftId)`.

**The live store view:**
- `liveStoreView` input gains `draft: { id: string; name: string } | null` and `publishedDraft: { id: string; name: string } | null`, and passes both through to the view.
- Reword the `previewCommit` doc to "The latest version of the draft being edited; null before it has one."
- In `shared/types/live-stores.ts`, add to `LiveStoreView`:

```ts
	/** The draft being edited, which Publish sends live. */
	draft: { id: string; name: string } | null;
	/** The draft the live store was published from. */
	publishedDraft: { id: string; name: string } | null;
```

  and to `PublishLiveStoreRequest`:

```ts
	/** Defaults to the draft being edited. */
	draftId?: string;
```

**`src/api-types.ts`:**
- add `CreateDraftRequest`, `RenameDraftRequest`, `DraftStart`, `DraftSummary` and `DraftsSnapshot` to a re-export from `'worker/api/controllers/drafts/types'`, following the existing `appDatabase/types` re-export;
- add `export { MAIN_DRAFT_ID, DRAFT_NAME_MAX_LENGTH } from 'shared/types/drafts';`, following how the file re-exports shared values.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/api/controllers/drafts worker/services/live-stores/view.test.ts worker/api/controllers/liveStores`
Expected: PASS.

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/types/drafts.ts shared/types/live-stores.ts worker/api/controllers/drafts worker/api/routes/draftRoutes.ts worker/api/routes/index.ts worker/api/controllers/liveStores/controller.ts worker/api/controllers/liveStores/controller.sql.test.ts worker/services/live-stores/view.ts worker/services/live-stores/view.test.ts src/api-types.ts
git commit -m "feat(drafts): owner-only drafts api, and publish takes the draft to send live

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: The AI's draft tools and guidance

**Files:**
- Create:
  - `worker/agents/think/draft-tools.ts`, with its test `worker/agents/think/draft-tools.test.ts`;
  - `worker/agents/think/skills/store-drafts/SKILL.md`.
- Modify:
  - `worker/agents/think/space-workspace-ops.ts` (`SpaceWorkspaceStub`);
  - `worker/agents/think/deploy-tool.ts` and its test;
  - `worker/agents/think/ThinkAgent.ts` (`getTools`);
  - `worker/agents/think/skills.ts`.

**Interfaces:**
- **Consumes:**
  - SpaceDO's `listDrafts`, `createDraft`, `activateDraft`, `getActiveDraft`, `bringInLiveChanges`, `cancelBringingInLiveChanges` and `deploy`;
  - `DRAFT_SWITCHING_TOOLS` and the `activeDraft` output convention from Task 6.
- **Produces:**
  - `createDraftTools({ getStub }): Record<'list_drafts' | 'create_draft' | 'switch_draft' | 'bring_in_live_changes' | 'cancel_bringing_in_live_changes', Tool>`;
  - each switching tool returns JSON with `activeDraft: ActiveDraft` after it deploys the draft when stale.

- [ ] **Step 1: Write the failing tests**

`worker/agents/think/draft-tools.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DraftsSnapshot } from '@space-do/space';
import { createDraftTools } from './draft-tools';
import type { SpaceWorkspaceStub } from './space-workspace-ops';

type Execute = (args: Record<string, unknown>, options: { toolCallId: string; messages: [] }) => Promise<string>;

const DRAFTS: DraftsSnapshot = {
	activeDraftId: 'main',
	published: true,
	limit: 5,
	drafts: [
		{ id: 'main', name: 'Main', startedFrom: 'main', updatedAt: 1, active: true, live: false, publishedFromHere: false, unpublishedChanges: true, behindLive: true, bringingInLiveChanges: false },
		{ id: 'k3x9q2mf', name: 'Typo fix', startedFrom: 'live', updatedAt: 2, active: false, live: true, publishedFromHere: true, unpublishedChanges: false, behindLive: false, bringingInLiveChanges: false },
	],
};

function harness(overrides: Partial<Record<string, unknown>> = {}) {
	const calls: string[] = [];
	const stub = {
		listDrafts: async () => DRAFTS,
		getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' }),
		createDraft: async (name: string, from: string) => (calls.push(`create ${name} ${from}`), { id: 'n3wdraft', name }),
		activateDraft: async (id: string) => (calls.push(`activate ${id}`), { draft: { id, name: id === 'main' ? 'Main' : 'Typo fix', branch: id === 'main' ? 'main' : `draft-${id}` }, previewStale: true }),
		deploy: async (branch: string) => (calls.push(`deploy ${branch}`), { preview_url: `/space/s/preview/${branch}/` }),
		bringInLiveChanges: async (id: string) => (calls.push(`bring ${id}`), { result: 'conflicts', files: ['about.html'], liveChanges: ['Fix the typo'] }),
		cancelBringingInLiveChanges: async () => (calls.push('cancel'), { cancelled: true }),
		...overrides,
	} as unknown as SpaceWorkspaceStub;
	const tools = createDraftTools({ getStub: () => stub });
	const run = async (name: keyof typeof tools, args: Record<string, unknown> = {}) =>
		JSON.parse(await (tools[name].execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] }));
	return { calls, run };
}

describe('draft tools', () => {
	it('lists drafts in plain words, with the one being edited', async () => {
		const { run } = harness();
		const listed = await run('list_drafts');
		expect(listed.drafts).toEqual([
			{ name: 'Main', editing: true, status: ['unpublished changes', 'behind the live store'] },
			{ name: 'Typo fix', editing: false, status: ['live'] },
		]);
		expect(JSON.stringify(listed)).not.toMatch(/branch|draft-k3x9q2mf/);
	});

	it('starts a draft and switches to it, deploying its preview', async () => {
		const { calls, run } = harness();
		const result = await run('create_draft', { name: 'Spring sale', from: 'main' });
		expect(calls).toEqual(['create Spring sale main', 'activate n3wdraft', 'deploy draft-n3wdraft']);
		expect(result.activeDraft).toMatchObject({ id: 'n3wdraft' });
	});

	it('switches by name, ignoring case', async () => {
		const { calls, run } = harness();
		const result = await run('switch_draft', { draft: 'typo FIX' });
		expect(calls).toEqual(['activate k3x9q2mf', 'deploy draft-k3x9q2mf']);
		expect(result.activeDraft.name).toBe('Typo fix');
		expect((await run('switch_draft', { draft: 'Nope' })).error).toBe("There's no draft named 'Nope'.");
	});

	it('brings live changes into the draft being edited and hands back the conflicts to resolve', async () => {
		const { calls, run } = harness();
		const result = await run('bring_in_live_changes', {});
		expect(calls).toEqual(['bring main']);
		expect(result.result).toBe('conflicts');
		expect(result.files).toEqual(['about.html']);
		expect(result.next).toContain('cancel_bringing_in_live_changes');
		expect(result.activeDraft).toMatchObject({ id: 'main' });
	});

	it('switches first when asked to bring changes into another draft', async () => {
		const { calls, run } = harness();
		await run('bring_in_live_changes', { draft: 'Typo fix' });
		expect(calls).toEqual(['activate k3x9q2mf', 'deploy draft-k3x9q2mf', 'bring k3x9q2mf']);
	});

	it('cancels bringing changes in', async () => {
		const { calls, run } = harness();
		expect(await run('cancel_bringing_in_live_changes')).toEqual({ cancelled: true });
		expect(calls).toEqual(['cancel']);
	});
});
```

In `worker/agents/think/deploy-tool.test.ts`:
- give the fake stub `getActiveDraft: async () => ({ id: 'main', name: 'Main', branch: 'main', tip: 'c1' })`;
- keep the existing tests;
- add:

```ts
	it("deploys the draft being edited, and refuses any other version, including 'published'", async () => {
		const deployed: string[] = [];
		const stub = {
			gitCommit: async () => ({}),
			getActiveDraft: async () => ({ id: 'k3x9q2mf', name: 'Typo fix', branch: 'draft-k3x9q2mf', tip: 'c1' }),
			deploy: async (branch: string) => (deployed.push(branch), { preview_url: `/space/s/preview/${branch}/` }),
			readFile: async () => { throw new Error('ENOENT'); },
		} as unknown as SpaceWorkspaceStub;
		const tool = createDeploySpaceTool({ getStub: () => stub });
		const run = (args: { branch?: string }) => (tool.execute as unknown as Execute)(args, { toolCallId: 'call_1', messages: [] });
		await run({});
		expect(deployed).toEqual(['draft-k3x9q2mf']);
		for (const branch of ['main', 'published']) {
			expect(JSON.parse(await run({ branch })).error).toContain('Switch to it with switch_draft first');
		}
		expect(deployed).toEqual(['draft-k3x9q2mf']);
	});
```

Change the existing `'deploys main by default'` test's expectation to `['main']` still: its stub's active draft is Main.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- worker/agents/think/draft-tools.test.ts worker/agents/think/deploy-tool.test.ts`
Expected: FAIL. `./draft-tools` is missing, and the deploy tool doesn't read the active draft.

- [ ] **Step 3: Implement**

Add to `SpaceWorkspaceStub` in `space-workspace-ops.ts`, importing the types from `@space-do/space`:

```ts
	// Draft RPC methods (used by the draft tools and the deploy tool).
	getActiveDraft(): Promise<ActiveDraft & { tip: string | null }>;
	listDrafts(): Promise<DraftsSnapshot>;
	createDraft(name: string, from: DraftStart): Promise<CreateDraftResult>;
	activateDraft(id: string): Promise<ActivateDraftResult>;
	bringInLiveChanges(id: string): Promise<BringInOutcome>;
	cancelBringingInLiveChanges(): Promise<{ cancelled: boolean }>;
```

`worker/agents/think/draft-tools.ts`:

```ts
/**
 * Drafts for the AI: versions of the store with their own previews. The tools talk to the SpaceDO directly, run in
 * order with the AI's other tools, and report `activeDraft` after a switch so the host's preview follows it.
 * Publishing stays the seller's click: there is no publish tool.
 */
import { tool, type Tool } from 'ai';
import { z } from 'zod';
import type { ActiveDraft, DraftSummary } from '@space-do/space';
import { withDurableObjectResetRetry, type SpaceWorkspaceStub } from './space-workspace-ops';

type GetStub = () => SpaceWorkspaceStub;

function statusOf(draft: DraftSummary): string[] {
	if (draft.bringingInLiveChanges) return ['bringing in live changes'];
	if (draft.live) return ['live'];
	const status: string[] = [];
	if (draft.unpublishedChanges) status.push('unpublished changes');
	if (draft.behindLive) status.push('behind the live store');
	return status;
}

async function findDraft(getStub: GetStub, name: string | undefined): Promise<DraftSummary | { error: string }> {
	const { drafts } = await withDurableObjectResetRetry(getStub, (stub) => stub.listDrafts());
	if (name === undefined || name.trim() === '') {
		return drafts.find((draft) => draft.active) ?? drafts[0] ?? { error: 'This store has no drafts yet.' };
	}
	const wanted = name.trim().toLowerCase();
	return drafts.find((draft) => draft.name.toLowerCase() === wanted) ?? { error: `There's no draft named '${name.trim()}'.` };
}

/** Switches to the draft and deploys its preview when stale, in order with the AI's other tools. */
async function activate(getStub: GetStub, id: string): Promise<{ activeDraft: ActiveDraft; deploy?: unknown } | { error: string }> {
	const result = await withDurableObjectResetRetry(getStub, (stub) => stub.activateDraft(id));
	if ('error' in result) return result;
	if (!result.previewStale) return { activeDraft: result.draft };
	const deploy = await withDurableObjectResetRetry(getStub, (stub) => stub.deploy(result.draft.branch));
	return { activeDraft: result.draft, deploy };
}

const RESOLVE_CONFLICTS = [
	'These files have conflict markers. In each marked block the first part is this draft and the second is the live store.',
	"Keep this draft's changes and the live store's fix, remove every marker line, then call deploy_space.",
	'If the build fails, fix it and deploy again. If you cannot get a clean build, call cancel_bringing_in_live_changes and tell the seller what blocked it.',
].join(' ');

export function createDraftTools(opts: { getStub: GetStub }): Record<string, Tool> {
	const { getStub } = opts;
	return {
		list_drafts: tool({
			description: "List the store's drafts: versions of the store, each with its own preview. Shows which one you are editing and how each compares with the live store.",
			inputSchema: z.object({}),
			execute: async () => {
				const snapshot = await withDurableObjectResetRetry(getStub, (stub) => stub.listDrafts());
				return JSON.stringify({
					published: snapshot.published,
					limit: snapshot.limit,
					drafts: snapshot.drafts.map((draft) => ({ name: draft.name, editing: draft.active, status: statusOf(draft) })),
				});
			},
		}),
		create_draft: tool({
			description: [
				'Start a new draft and switch to it. from "main" copies Main; from "live" copies the live store, for a quick fix that can be published alone while Main keeps unpublished work.',
				'Suggest a quick fix when the seller asks for a small change to the live store and Main has unpublished changes.',
			].join(' '),
			inputSchema: z.object({
				name: z.string().describe('Short name the seller will see, e.g. "Typo fix".'),
				from: z.enum(['main', 'live']).describe('Where the draft starts.'),
			}),
			execute: async (args: { name: string; from: 'main' | 'live' }) => {
				const created = await withDurableObjectResetRetry(getStub, (stub) => stub.createDraft(args.name, args.from));
				if ('error' in created) return JSON.stringify(created);
				return JSON.stringify(await activate(getStub, created.id));
			},
		}),
		switch_draft: tool({
			description: 'Switch to another draft by its name. Your edits then go to that draft, and the preview shows it.',
			inputSchema: z.object({ draft: z.string().describe("The draft's name.") }),
			execute: async (args: { draft: string }) => {
				const draft = await findDraft(getStub, args.draft);
				if ('error' in draft) return JSON.stringify(draft);
				return JSON.stringify(await activate(getStub, draft.id));
			},
		}),
		bring_in_live_changes: tool({
			description: "Bring the live store's changes into a draft (the one you are editing by default), for a draft that is behind the live store. Never call it unless the seller asks.",
			inputSchema: z.object({ draft: z.string().optional().describe("The draft's name; defaults to the one you are editing.") }),
			execute: async (args: { draft?: string }) => {
				const draft = await findDraft(getStub, args.draft);
				if ('error' in draft) return JSON.stringify(draft);
				let activeDraft: ActiveDraft;
				if (draft.active) {
					activeDraft = await withDurableObjectResetRetry(getStub, (stub) => stub.getActiveDraft());
				} else {
					const switched = await activate(getStub, draft.id);
					if ('error' in switched) return JSON.stringify(switched);
					activeDraft = switched.activeDraft;
				}
				const outcome = await withDurableObjectResetRetry(getStub, (stub) => stub.bringInLiveChanges(draft.id));
				const next = 'result' in outcome && outcome.result === 'conflicts' ? { next: RESOLVE_CONFLICTS } : {};
				return JSON.stringify({ ...outcome, ...next, activeDraft: { id: activeDraft.id, name: activeDraft.name, branch: activeDraft.branch } });
			},
		}),
		cancel_bringing_in_live_changes: tool({
			description: "Cancel bringing in the live store's changes. The draft goes back to how it was before.",
			inputSchema: z.object({}),
			execute: async () => JSON.stringify(await withDurableObjectResetRetry(getStub, (stub) => stub.cancelBringingInLiveChanges())),
		}),
	};
}
```

**The deploy tool.** In `deploy-tool.ts`:
- update `DESCRIPTION`'s third paragraph to:

  > "Deploys the draft you are editing. To deploy another draft, switch to it with switch_draft first. The 'live' version is the seller's published store: never deploy it."

- in `execute`, before the existing `live` check, resolve the branch:

```ts
			const active = await withDurableObjectResetRetry(getStub, (stub) => stub.getActiveDraft());
			const requested = args.branch && args.branch.length > 0 ? args.branch : active.branch;
```

- use `requested` where `branch` was;
- keep the `LIVE_BRANCH` refusal;
- then add:

```ts
			if (requested !== active.branch) {
				return JSON.stringify({ branch: requested, error: `That isn't the draft you are editing. Switch to it with switch_draft first.` });
			}
```

- update the `branch` input's `.describe(...)` to "Leave empty: deploys the draft you are editing."

**`ThinkAgent.getTools()`.** Import `createDraftTools`, and add `...createDraftTools({ getStub: () => this.getSpaceStub() }),` inside the `serializeTools({ ... })` object, after `deploy_space`.

**`skills/store-drafts/SKILL.md`:**

```markdown
---
name: store-drafts
description: Drafts are versions of the store, each with its own preview. Load it when the seller asks for a quick fix to the live store, wants to try another direction, mentions drafts, or asks to bring the live store's changes into a draft.
---

# Store drafts

A store has up to five drafts, counting Main. One is being edited at a time: your edits go to it and the preview shows
it. Publishing sends one draft to the live store, and only the seller publishes, with the Publish button. You can't
publish, so when asked, tell the seller to use Publish; the draft switcher shows which draft is ready.

Talk about drafts, versions and the live store. Never say branch, merge, commit or git to the seller.

## Quick fixes

When the seller asks for a small change to the live store (a typo, a price, a phone number) and `list_drafts` shows
Main has unpublished changes, suggest a quick fix so the change goes out alone:

1. `create_draft` with `from: "live"` and a short name such as "Typo fix".
2. Make the change and `deploy_space`.
3. Tell the seller to check the preview and publish it. Main keeps its own work.

## Bringing in the live store's changes

When a draft is behind the live store (for example Main after a quick fix was published) and the seller asks, call
`bring_in_live_changes`. Never call it on your own.

- **up-to-date / fast-forward / merged:** done; the preview rebuilt. Tell the seller.
- **conflicts:** the result lists the files and the live store's changes. In each file, every conflict looks like:

      <<<<<<< draft
      this draft's version
      =======
      the live store's version
      >>>>>>> live

  Keep the intent of both: this draft's work and the live fix. Remove every marker line, then `deploy_space`. If the
  build fails, fix it and deploy again. If you can't get a clean build, call `cancel_bringing_in_live_changes` and
  tell the seller what blocked it. Finish or cancel within the same turn: an unfinished one is cancelled when your
  turn ends.
```

**`skills.ts`.** Import `STORE_DRAFTS from './skills/store-drafts/SKILL.md?raw'` and add `'store-drafts': STORE_DRAFTS` to `RAW_SKILLS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- worker/agents/think/draft-tools.test.ts worker/agents/think/deploy-tool.test.ts worker/agents/think/serial-tools.test.ts worker/agents/think/store-checkout-skill.test.ts`
Expected: PASS.

Run: `rtk proxy bun run test -- src/routes/copy-rules.test.ts`. If the copy-rules test scans skills, it must pass. If no such test exists, grep the new SKILL.md for every name in `AI_ASSISTANT_NAMES` and `SUPPLIER_NAMES`.
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add worker/agents/think/draft-tools.ts worker/agents/think/draft-tools.test.ts worker/agents/think/space-workspace-ops.ts worker/agents/think/deploy-tool.ts worker/agents/think/deploy-tool.test.ts worker/agents/think/ThinkAgent.ts worker/agents/think/skills.ts worker/agents/think/skills/store-drafts/SKILL.md
git commit -m "feat(drafts): the ai lists, starts and switches drafts, brings in live changes and resolves conflicts, and deploys only the draft it edits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: The drafts switcher, the Go live dialog and Main's banner

**Files:**
- Create:
  - `src/components/drafts/draft-view.ts` and its test `src/components/drafts/draft-view.test.ts`;
  - `src/components/drafts/DraftSwitcher.tsx`, `src/components/drafts/DraftNameDialog.tsx` and `src/components/drafts/LiveFixBanner.tsx`;
  - `src/hooks/use-drafts.ts`;
  - the guard `src/components/drafts/drafts-guard.test.ts`.
- Modify:
  - `src/lib/api-client.ts` and `src/lib/query-keys.ts`;
  - `src/routes/chat/components/main-content-panel.tsx` (props `draftSwitcher` and `previewNotice`);
  - `src/routes/chat/chat.tsx`;
  - `src/components/live-store/GoLiveDialog.tsx`, and `publish-action.ts` with its test.

**Interfaces:**
- **Consumes:**
  - the Task 7 API and types: `DraftsSnapshot`, `DraftSummary`, `CreateDraftRequest`, `RenameDraftRequest` and `MAIN_DRAFT_ID` from `@/api-types`;
  - `LiveStoreView.draft` and `LiveStoreView.publishedDraft`.
- **Produces these API client methods:**
  - `getDrafts(appId)`;
  - `createDraft(appId, CreateDraftRequest)`;
  - `activateDraft(appId, draftId)`;
  - `renameDraft(appId, draftId, RenameDraftRequest)`;
  - `deleteDraft(appId, draftId)`.

  Each returns `ApiResponse<DraftsSnapshot>`.
- **Produces these hooks:** `useDrafts(appId, enabled, refreshKey)`, `useCreateDraft`, `useActivateDraft`, `useRenameDraft` and `useDeleteDraft`.
- **Produces these pure helpers:** `draftBadges`, `canDeleteDraft`, `bringInRequest` and `showsLiveFixBanner`.

- [ ] **Step 1: Write the failing tests**

`src/components/drafts/draft-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DraftSummary, DraftsSnapshot } from '@/api-types';
import { bringInRequest, canDeleteDraft, draftBadges, showsLiveFixBanner } from './draft-view';

const DRAFT: DraftSummary = { id: 'k3x9q2mf', name: 'Typo fix', startedFrom: 'live', updatedAt: 1, active: false, live: false, publishedFromHere: false, unpublishedChanges: false, behindLive: false, bringingInLiveChanges: false };

describe('draftBadges', () => {
	it('says Live, Unpublished changes, Behind the live store, or both', () => {
		expect(draftBadges({ ...DRAFT, live: true })).toEqual([{ label: 'Live', variant: 'success' }]);
		expect(draftBadges({ ...DRAFT, unpublishedChanges: true })).toEqual([{ label: 'Unpublished changes', variant: 'secondary' }]);
		expect(draftBadges({ ...DRAFT, behindLive: true })).toEqual([{ label: 'Behind the live store', variant: 'outline' }]);
		expect(draftBadges({ ...DRAFT, unpublishedChanges: true, behindLive: true }).map((b) => b.label)).toEqual(['Unpublished changes', 'Behind the live store']);
		expect(draftBadges({ ...DRAFT, behindLive: true, bringingInLiveChanges: true })).toEqual([{ label: 'Bringing in live changes', variant: 'secondary' }]);
		expect(draftBadges(DRAFT)).toEqual([]);
	});
});

describe('canDeleteDraft', () => {
	it("isn't offered for Main, the draft being edited, or the one the live store came from", () => {
		expect(canDeleteDraft(DRAFT)).toBe(true);
		expect(canDeleteDraft({ ...DRAFT, id: 'main' })).toBe(false);
		expect(canDeleteDraft({ ...DRAFT, active: true })).toBe(false);
		expect(canDeleteDraft({ ...DRAFT, publishedFromHere: true })).toBe(false);
	});
});

describe("Main's banner and the bring-in request", () => {
	const main: DraftSummary = { ...DRAFT, id: 'main', name: 'Main', startedFrom: 'main', active: true, unpublishedChanges: true, behindLive: true };
	const fix: DraftSummary = { ...DRAFT, live: true, publishedFromHere: true };
	const snapshot = (drafts: DraftSummary[]): DraftsSnapshot => ({ drafts, activeDraftId: drafts.find((d) => d.active)?.id ?? 'main', published: true, limit: 5 });

	it('shows on Main while a fix published from another draft is missing from it', () => {
		expect(showsLiveFixBanner(snapshot([main, fix]))).toBe(true);
		expect(showsLiveFixBanner(snapshot([{ ...main, behindLive: false }, fix]))).toBe(false);
		expect(showsLiveFixBanner(snapshot([{ ...main, active: false }, { ...fix, active: true }]))).toBe(false);
		expect(showsLiveFixBanner(snapshot([{ ...main, publishedFromHere: true }]))).toBe(false);
	});

	it('asks the AI in plain words', () => {
		expect(bringInRequest('Main')).toBe("Bring the live store's changes into 'Main'.");
	});
});
```

`src/components/drafts/drafts-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AI_ASSISTANT_NAMES, SUPPLIER_NAMES } from '@/routes/copy-rules';

const sources = import.meta.glob<string>(
	[
		'/src/components/drafts/DraftSwitcher.tsx',
		'/src/components/drafts/DraftNameDialog.tsx',
		'/src/components/drafts/LiveFixBanner.tsx',
		'/src/components/drafts/draft-view.ts',
		'/src/routes/chat/chat.tsx',
		'/src/routes/chat/components/main-content-panel.tsx',
		'/src/components/live-store/GoLiveDialog.tsx',
	],
	{ query: '?raw', import: 'default', eager: true },
);

function source(path: string): string {
	const text = sources[path];
	if (text === undefined) throw new Error(`Source not found: ${path}`);
	return text;
}

/** The seller-facing strings in a component: JSX text and string literals, without imports. */
function copyOf(text: string): string {
	return text.replace(/^import .*$/gm, '');
}

describe('the drafts UI', () => {
	it('puts the switcher in the preview header and the banner above the preview, for the owner of a Think store', () => {
		const chat = source('/src/routes/chat/chat.tsx');
		expect(chat).toContain('<DraftSwitcher');
		expect(chat).toContain('<LiveFixBanner');
		expect(chat).toMatch(/isOwner && behaviorType === 'think'/);
		const panel = source('/src/routes/chat/components/main-content-panel.tsx');
		expect(panel).toContain('{draftSwitcher}');
		expect(panel).toContain('{previewNotice}');
	});

	it('switches, starts, renames and deletes drafts, asking before a delete', () => {
		const switcher = source('/src/components/drafts/DraftSwitcher.tsx');
		for (const part of ['useActivateDraft(', 'useDeleteDraft(', 'draftBadges(', 'canDeleteDraft(', 'ConfirmButton', 'New draft', 'Rename', 'Bring in live changes', 'bringInRequest(']) {
			expect(switcher, part).toContain(part);
		}
		const dialog = source('/src/components/drafts/DraftNameDialog.tsx');
		for (const part of ['useCreateDraft(', 'useRenameDraft(', 'Start from', 'The live store (quick fix)', 'DRAFT_NAME_MAX_LENGTH']) {
			expect(dialog, part).toContain(part);
		}
	});

	it('names the draft Publish sends, and warns that Main falls behind', () => {
		const goLive = source('/src/components/live-store/GoLiveDialog.tsx');
		expect(goLive).toContain('view.draft');
		expect(goLive).toContain('Main will be behind the live store until you bring these changes in.');
	});

	it('never says git words or names an AI assistant or supplier', () => {
		for (const path of ['/src/components/drafts/DraftSwitcher.tsx', '/src/components/drafts/DraftNameDialog.tsx', '/src/components/drafts/LiveFixBanner.tsx', '/src/components/drafts/draft-view.ts']) {
			const copy = copyOf(source(path)).toLowerCase();
			for (const word of ['>git', ' git ', 'branch', 'merge', 'commit']) expect(copy, `${path}: ${word}`).not.toContain(word);
			for (const name of [...AI_ASSISTANT_NAMES, ...SUPPLIER_NAMES]) expect(copy, `${path}: ${name}`).not.toContain(name);
		}
	});
});
```

In `src/components/live-store/publish-action.test.ts`, add:

```ts
	it("names the draft Publish sends once the store has drafts", () => {
		const draft = { id: 'k3x9q2mf', name: 'Typo fix' };
		expect(publishAction({ status: 'unpublished', slug: null, hasChanges: true, draft }, 'northwind-tea')).toEqual({ label: "Publish 'Typo fix'", disabled: false });
		expect(publishAction({ ...LIVE, hasChanges: true, draft }, 'northwind-tea')).toEqual({ label: "Publish 'Typo fix'", disabled: false });
		expect(publishAction({ ...LIVE, draft }, 'northwind-tea')).toEqual({ label: 'Up to date', disabled: true });
	});
```

`go-live-guard.test.ts` needs no change: the dialog still calls `publishAction(view, slug)` and shows `view.hasChanges`.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk proxy bun run test -- src/components/drafts src/components/live-store`
Expected: FAIL. The modules are missing, and the publish label has no draft name.

- [ ] **Step 3: Implement**

`src/components/drafts/draft-view.ts`:

```ts
import { MAIN_DRAFT_ID, type DraftSummary, type DraftsSnapshot } from '@/api-types';

export interface DraftBadge {
	label: string;
	variant: 'success' | 'secondary' | 'outline';
}

/** What the switcher says about a draft against the live store. */
export function draftBadges(draft: Pick<DraftSummary, 'live' | 'unpublishedChanges' | 'behindLive' | 'bringingInLiveChanges'>): DraftBadge[] {
	if (draft.bringingInLiveChanges) return [{ label: 'Bringing in live changes', variant: 'secondary' }];
	if (draft.live) return [{ label: 'Live', variant: 'success' }];
	const badges: DraftBadge[] = [];
	if (draft.unpublishedChanges) badges.push({ label: 'Unpublished changes', variant: 'secondary' });
	if (draft.behindLive) badges.push({ label: 'Behind the live store', variant: 'outline' });
	return badges;
}

/** Delete isn't offered for Main, the draft being edited, or the one the live store came from. */
export function canDeleteDraft(draft: Pick<DraftSummary, 'id' | 'active' | 'publishedFromHere'>): boolean {
	return draft.id !== MAIN_DRAFT_ID && !draft.active && !draft.publishedFromHere;
}

/** The chat request the "Bring in live changes" buttons send. */
export function bringInRequest(draftName: string): string {
	return `Bring the live store's changes into '${draftName}'.`;
}

/** Main's banner: Main is being edited and lacks a fix that went live from another draft. */
export function showsLiveFixBanner(snapshot: DraftsSnapshot): boolean {
	const main = snapshot.drafts.find((draft) => draft.id === MAIN_DRAFT_ID);
	const source = snapshot.drafts.find((draft) => draft.publishedFromHere);
	return !!main && main.active && main.behindLive && !!source && source.id !== MAIN_DRAFT_ID;
}
```

**`src/lib/query-keys.ts`:** add `drafts: (appId: string) => ['drafts', appId] as const,` after `liveStore`, with the doc comment `/** A store's drafts and which one is being edited, for its owner. */`.

**`src/lib/api-client.ts`:** add after `removeStoreDomain`:

```ts
	async getDrafts(appId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts`);
	}

	async createDraft(appId: string, request: CreateDraftRequest): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts`, { method: 'POST', body: request });
	}

	async activateDraft(appId: string, draftId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}/activate`, { method: 'POST' });
	}

	async renameDraft(appId: string, draftId: string, request: RenameDraftRequest): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}`, { method: 'PATCH', body: request });
	}

	async deleteDraft(appId: string, draftId: string): Promise<ApiResponse<DraftsSnapshot>> {
		return this.request<DraftsSnapshot>(`/api/stores/${encodeURIComponent(appId)}/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
	}
```

Import `CreateDraftRequest`, `DraftsSnapshot` and `RenameDraftRequest` with the other `@/api-types` imports.

`src/hooks/use-drafts.ts`:

```ts
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { unwrap } from '@/lib/unwrap-response';
import type { DraftStart, DraftsSnapshot } from '@/api-types';

/** `refreshKey` changes whenever the preview reloads (a deploy or a switch), so states follow them. */
export function useDrafts(appId: string, enabled: boolean, refreshKey: string | undefined) {
	const query = useQuery({
		queryKey: queryKeys.drafts(appId),
		queryFn: () => unwrap(apiClient.getDrafts(appId), "Couldn't load your drafts"),
		enabled: enabled && !!appId,
		retry: false,
	});
	const { refetch } = query;
	useEffect(() => {
		if (enabled && appId && refreshKey) void refetch();
	}, [enabled, appId, refreshKey, refetch]);
	return query;
}

/** Every call answers the store's drafts; a switch or a new draft also changes what Publish sends. */
function useDraftsMutation<TInput>(appId: string, call: (input: TInput) => Promise<DraftsSnapshot>, changesPublish: boolean) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: call,
		onSuccess: (snapshot) => {
			queryClient.setQueryData(queryKeys.drafts(appId), snapshot);
			if (changesPublish) void queryClient.invalidateQueries({ queryKey: queryKeys.liveStore(appId) });
		},
	});
}

export function useCreateDraft(appId: string) {
	return useDraftsMutation(appId, (input: { name: string; from: DraftStart }) => unwrap(apiClient.createDraft(appId, input), "Couldn't start the draft"), true);
}

export function useActivateDraft(appId: string) {
	return useDraftsMutation(appId, (draftId: string) => unwrap(apiClient.activateDraft(appId, draftId), "Couldn't switch drafts"), true);
}

export function useRenameDraft(appId: string) {
	return useDraftsMutation(appId, (input: { draftId: string; name: string }) => unwrap(apiClient.renameDraft(appId, input.draftId, { name: input.name }), "Couldn't rename the draft"), true);
}

export function useDeleteDraft(appId: string) {
	return useDraftsMutation(appId, (draftId: string) => unwrap(apiClient.deleteDraft(appId, draftId), "Couldn't delete the draft"), false);
}
```

`src/components/drafts/DraftNameDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@cloudflare/kumo';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { DRAFT_NAME_MAX_LENGTH, type DraftStart, type DraftSummary } from '@/api-types';
import { useCreateDraft, useRenameDraft } from '@/hooks/use-drafts';

interface DraftNameDialogProps {
	appId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Renames this draft; without it, the dialog starts a new one. */
	draft?: DraftSummary;
	/** A quick fix needs a live store to start from. */
	published: boolean;
}

export function DraftNameDialog({ appId, open, onOpenChange, draft, published }: DraftNameDialogProps) {
	const create = useCreateDraft(appId);
	const rename = useRenameDraft(appId);
	const [name, setName] = useState(draft?.name ?? '');
	const [from, setFrom] = useState<DraftStart>('main');
	useEffect(() => {
		if (open) {
			setName(draft?.name ?? '');
			setFrom('main');
		}
	}, [open, draft?.name]);

	const pending = create.isPending || rename.isPending;
	const done = () => onOpenChange(false);
	const onError = (error: Error) => toast.error(error.message);
	const onSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (draft) rename.mutate({ draftId: draft.id, name }, { onSuccess: done, onError });
		else create.mutate({ name, from }, { onSuccess: done, onError });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{draft ? 'Rename draft' : 'New draft'}</DialogTitle>
					<DialogDescription>
						{draft ? 'Only the name changes.' : 'A draft is a version of your store with its own preview. Nothing reaches shoppers until you publish it.'}
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={onSubmit}>
					<Input aria-label="Name" value={name} maxLength={DRAFT_NAME_MAX_LENGTH} onChange={(event) => setName(event.target.value)} placeholder="Spring sale" autoFocus />
					{!draft && (
						<fieldset className="grid gap-2">
							<legend className="text-sm font-medium">Start from</legend>
							<RadioGroup value={from} onValueChange={(value) => setFrom(value === 'live' ? 'live' : 'main')}>
								<label className="flex items-center gap-2 text-sm">
									<RadioGroupItem value="main" /> Main
								</label>
								<label className={published ? 'flex items-center gap-2 text-sm' : 'flex items-center gap-2 text-sm text-kumo-subtle'}>
									<RadioGroupItem value="live" disabled={!published} /> The live store (quick fix)
								</label>
							</RadioGroup>
							{!published && <p className="text-sm text-kumo-subtle">Publish your store to start a quick fix from it.</p>}
						</fieldset>
					)}
					<div className="flex justify-end gap-2">
						<Button type="button" variant="secondary" size="sm" onClick={done}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" size="sm" disabled={name.trim() === '' || pending} loading={pending}>
							{draft ? 'Rename' : 'Start draft'}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
```

`src/components/drafts/DraftSwitcher.tsx`:

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button } from '@cloudflare/kumo';
import { CaretDown, Check } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ConfirmButton } from '@/components/confirm-button';
import type { DraftSummary } from '@/api-types';
import { useActivateDraft, useDeleteDraft, useDrafts } from '@/hooks/use-drafts';
import { bringInRequest, canDeleteDraft, draftBadges } from './draft-view';
import { DraftNameDialog } from './DraftNameDialog';

interface DraftSwitcherProps {
	appId: string;
	/** Changes whenever the preview reloads, so states follow deploys and switches. */
	refreshKey: string | undefined;
	isGenerating: boolean;
	/** Sends a chat request to the AI, as if the seller typed it. */
	onSendMessage: (message: string) => void;
}

function Badges({ draft }: { draft: DraftSummary }) {
	return (
		<>
			{draftBadges(draft).map((badge) => (
				<Badge key={badge.label} variant={badge.variant}>
					{badge.label}
				</Badge>
			))}
		</>
	);
}

export function DraftSwitcher({ appId, refreshKey, isGenerating, onSendMessage }: DraftSwitcherProps) {
	const drafts = useDrafts(appId, true, refreshKey);
	const activate = useActivateDraft(appId);
	const remove = useDeleteDraft(appId);
	const [open, setOpen] = useState(false);
	const [naming, setNaming] = useState<{ draft?: DraftSummary } | null>(null);

	const snapshot = drafts.data;
	const active = snapshot?.drafts.find((draft) => draft.active) ?? snapshot?.drafts[0];
	if (!snapshot || !active) return null;
	const onError = (error: Error) => toast.error(error.message);
	const switchTo = (draft: DraftSummary) => {
		setOpen(false);
		activate.mutate(draft.id, { onError });
	};
	const bringIn = (draft: DraftSummary) => {
		setOpen(false);
		onSendMessage(bringInRequest(draft.name));
	};

	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-kumo-elevated" title="Drafts">
						<span className="truncate font-medium">{active.name}</span>
						<Badges draft={active} />
						<CaretDown className="size-3.5 shrink-0 text-text-primary/50" />
					</button>
				</PopoverTrigger>
				<PopoverContent align="start" className="grid w-80 gap-2 p-2">
					{snapshot.drafts.map((draft) => (
						<div key={draft.id} className="grid gap-1 rounded p-2 hover:bg-kumo-elevated">
							<button className="flex items-center gap-2 text-left text-sm" onClick={() => switchTo(draft)} disabled={draft.active || isGenerating || activate.isPending}>
								{draft.active ? <Check className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
								<span className="truncate font-medium">{draft.name}</span>
								<Badges draft={draft} />
							</button>
							<div className="flex flex-wrap items-center gap-2 pl-6 text-xs text-kumo-subtle">
								<span>Changed {new Date(draft.updatedAt).toLocaleString()}</span>
								{draft.behindLive && !draft.bringingInLiveChanges && (
									<Button variant="ghost" size="sm" onClick={() => bringIn(draft)}>
										Bring in live changes
									</Button>
								)}
								{draft.id !== 'main' && (
									<Button variant="ghost" size="sm" onClick={() => { setOpen(false); setNaming({ draft }); }}>
										Rename
									</Button>
								)}
								{canDeleteDraft(draft) && (
									<ConfirmButton
										variant="ghost"
										label="Delete"
										title={`Delete '${draft.name}'?`}
										description="Its preview is removed. Its earlier versions stay in the store's history."
										pending={remove.isPending}
										onConfirm={() => remove.mutate(draft.id, { onError })}
									/>
								)}
							</div>
						</div>
					))}
					{isGenerating && <p className="px-2 text-xs text-kumo-subtle">Wait for the AI to finish, then switch drafts.</p>}
					<Button variant="secondary" size="sm" onClick={() => { setOpen(false); setNaming({}); }} disabled={snapshot.drafts.length >= snapshot.limit || isGenerating}>
						New draft
					</Button>
					{snapshot.drafts.length >= snapshot.limit && <p className="px-2 text-xs text-kumo-subtle">Delete a draft to start a new one.</p>}
				</PopoverContent>
			</Popover>
			<DraftNameDialog appId={appId} open={naming !== null} onOpenChange={(next) => !next && setNaming(null)} draft={naming?.draft} published={snapshot.published} />
		</>
	);
}
```

`src/components/drafts/LiveFixBanner.tsx`:

```tsx
import { Button } from '@cloudflare/kumo';
import { useDrafts } from '@/hooks/use-drafts';
import { bringInRequest, showsLiveFixBanner } from './draft-view';

/** On Main, after a fix went live from another draft: offers to bring it in. */
export function LiveFixBanner({ appId, refreshKey, onSendMessage }: { appId: string; refreshKey: string | undefined; onSendMessage: (message: string) => void }) {
	const drafts = useDrafts(appId, true, refreshKey);
	if (!drafts.data || !showsLiveFixBanner(drafts.data)) return null;
	return (
		<div className="flex items-center justify-between gap-3 border-b border-kumo-line bg-kumo-elevated px-3 py-2 text-sm">
			<span>The live store has a fix Main doesn't have.</span>
			<Button variant="secondary" size="sm" onClick={() => onSendMessage(bringInRequest('Main'))}>
				Bring it in
			</Button>
		</div>
	);
}
```

**`main-content-panel.tsx`:**
- add these to `MainContentPanelProps`:

```ts
	/** The drafts switcher, shown before the preview's title. */
	draftSwitcher?: ReactNode;
	/** A notice above the preview, such as Main's live-fix banner. */
	previewNotice?: ReactNode;
```

- destructure both;
- in `renderPreviewView`'s header, render `{draftSwitcher}` as the first child of the `<div className="flex min-w-0 items-center gap-2">` that holds the `previewTitle` span;
- render `{previewNotice}` right before `<PreviewCompatBanner previewUrl={previewUrl} />`.

**`chat.tsx`:**
1. Import `DraftSwitcher` and `LiveFixBanner`.
2. Near the existing send handlers, add:

```tsx
	const sendChatRequest = useCallback(
		(message: string) => {
			if (sendWebSocketMessage(websocket, 'user_suggestion', { message })) sendUserMessage(message);
		},
		[websocket, sendUserMessage],
	);
	const showDrafts = !!app && isOwner && behaviorType === 'think';
```

   If `behaviorType` isn't named that way in `chat.tsx`, use the variable that holds the app's behavior type there: `MainContentPanel` receives `behaviorType`.
3. Pass both to `<MainContentPanel ...>`:

```tsx
									draftSwitcher={showDrafts && app ? <DraftSwitcher appId={app.id} refreshKey={previewUrl} isGenerating={isGenerating} onSendMessage={sendChatRequest} /> : undefined}
									previewNotice={showDrafts && app ? <LiveFixBanner appId={app.id} refreshKey={previewUrl} onSendMessage={sendChatRequest} /> : undefined}
```

   The guard test looks for the text `isOwner && behaviorType === 'think'`, so keep that expression literally in `showDrafts`.

**The Go live dialog.** In `publish-action.ts`:

```ts
/** What the publish button says for the address being edited, and whether there's anything to publish. */
export function publishAction(
	view: Pick<LiveStoreView, 'status' | 'slug' | 'hasChanges'> & { draft?: LiveStoreView['draft'] },
	slug: string,
): { label: string; disabled: boolean } {
	const named = view.draft ? `Publish '${view.draft.name}'` : null;
	if (view.status !== 'live' || view.slug !== slug) return { label: named ?? 'Publish', disabled: false };
	return view.hasChanges ? { label: named ?? 'Publish changes', disabled: false } : { label: 'Up to date', disabled: true };
}
```

In `GoLiveDialog.tsx`, after the `view.hasChanges` notice paragraph, add:

```tsx
				{view.draft && view.draft.id !== MAIN_DRAFT_ID && action.disabled === false && (
					<p className="text-sm text-kumo-subtle">Main will be behind the live store until you bring these changes in.</p>
				)}
```

Change the `hasChanges` notice to name the draft: `Your preview of '{view.draft?.name ?? 'Main'}' has changes that aren't live yet.` Import `MAIN_DRAFT_ID` from `@/api-types`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `rtk proxy bun run test -- src/components/drafts src/components/live-store`
Expected: PASS.

Run: `bun run typecheck && npx eslint src/components/drafts src/hooks/use-drafts.ts src/routes/chat src/components/live-store`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/drafts src/hooks/use-drafts.ts src/lib/api-client.ts src/lib/query-keys.ts src/routes/chat/components/main-content-panel.tsx src/routes/chat/chat.tsx src/components/live-store/GoLiveDialog.tsx src/components/live-store/publish-action.ts src/components/live-store/publish-action.test.ts
git commit -m "feat(drafts): drafts switcher in the preview header, publish names the draft, and main offers to bring in a live fix

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: By-eye check, CI steps and the PR

**Files:** none new. Fix whatever the checks find, each fix with its own failing test first.

- [ ] **Step 1: Restart the dev server on port 8100** so the SpaceDO code reloads. Run it the way this checkout always runs it. Sign in to localhost with the test account from `.superpowers/realtest/local-accounts.md`. Never paste its password into chat.

- [ ] **Step 2: The quick-fix flow** (spec section 14), on a store that is already published:
  1. Ask the AI for a visible change in Main, and don't publish it. The switcher shows Main with "Unpublished changes".
  2. Open the switcher: New draft, "Typo fix", Start from "The live store (quick fix)". The preview switches to it, and the chat says "Now working on 'Typo fix'."
  3. Ask the AI to change one word, then open Go live:
     - the button reads "Publish 'Typo fix'";
     - the notice says Main will be behind.
  4. Publish. Then check two things:
     - the live store shows the one-word fix and not Main's change;
     - the switcher shows "Typo fix" as Live.
  5. Switch to Main:
     - the banner "The live store has a fix Main doesn't have." shows;
     - Main has both "Unpublished changes" and "Behind the live store".
  6. Press "Bring it in":
     - the AI brings the fix in without a conflict;
     - the preview shows both changes;
     - the banner goes away.

- [ ] **Step 3: The conflict flow.**
  1. Start another quick fix that edits the same sentence Main edited, and publish it.
  2. On Main, press "Bring it in". The AI resolves the conflict, deploys, and the preview keeps both intents.
  3. Repeat, and stop the AI mid-resolution. The chat says the draft is back as it was, and switching works.

- [ ] **Step 4: Cold start** (Review Focus 1).
  1. With "Typo fix" active and an uncommitted AI edit in it, restart the dev server.
  2. Reload the editor. The preview and the files are still "Typo fix", with the edit.

- [ ] **Step 5: Limits and refusals.**
  - Create drafts until five. "New draft" is disabled, with "Delete a draft to start a new one."
  - Deleting is offered neither for Main, the active draft, nor the live draft.
  - While the AI runs, switching shows "Wait for the AI to finish, then switch drafts."

- [ ] **Step 6: The CI steps**

```bash
npx eslint .
```

```bash
bun run typecheck
```

```bash
bun run build
```

```bash
bun run bundle:check
```

```bash
bun run test
```

Expected: all pass. Report the shard totals.

- [ ] **Step 7: Final review.** Run the fresh whole-branch review the execution skill names, with this plan's Review Focus. Fix its Critical and Important findings with failing tests first.

- [ ] **Step 8: Open the PR into `main`.**
  - Push `feat/store-drafts`. PR #25 already holds the spec and this plan, so the implementation commits land on it.
  - Update its description with:
    - what was built;
    - the five rulings against the spec;
    - the by-eye results;
    - the test totals.
  - End the description with "Generated with [Claude Code](https://claude.com/claude-code)".
  - Don't merge.
