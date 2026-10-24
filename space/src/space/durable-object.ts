import { DurableObject } from "cloudflare:workers"
import { type FileSystem, type FileInfo } from "@cloudflare/shell"
import { type Git, type GitLogEntry, type GitStatusEntry } from "@cloudflare/shell/git"
import type { Env } from "../env"
import {
  buildBranchDeployment,
  DEPLOYMENTS_TABLE_SQL,
  handleDeployCommand,
  LIVE_BRANCH,
  LIVE_PATH_PREFIX,
  migrateDeploymentsTable,
  servedUrl,
  publishLiveDeployment,
  publishedVersion,
  readDeploymentTexts,
  type BranchDeploymentBundle,
  type DeployContext,
  type DeploymentTexts,
  type PublishedVersion,
} from "./deploy-engine"
import { globInfos, readDirInfos, toFileInfo } from "./fileinfo"
import { handleAssetRequest, buildAssetManifest, createMemoryStorage, type AssetConfig } from "@cloudflare/worker-bundler"
import {
  buildInspectorWrapperSource,
  VIBE_APP_MODULE,
} from "./inspector-wrapper"
import { ArtifactsBackend, resolveSpaceFsBackendMode, SqlBackend, type SpaceFsBackend } from "./fs-backend"
import { readCommitFiles, resolveHead, stageWorkdir, stagedTreeMatchesHead, writeWorkdirFiles } from "./git-objects"
import { stripPreviewSecurityHeaders } from "./preview-headers"
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
  type PublishDraftOptions,
  type PublishDraftResult,
} from "./drafts-store"
import { NEW_CATALOG_PRODUCTS_ERROR, newCatalogVariantIds, STORE_MANIFEST_PATH } from "./store-manifest"
import { mergeManagedStoreProducts } from "./managed-store-products"
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

// ─── Inspector result types ────────────────────────────────────────────────
// These mirror the shapes returned by the wrapper-subclass injected into
// the dynamic worker (see `inspector-wrapper.ts`). Re-exported at the
// package boundary so the host controller types match.

export interface AppDatabaseColumn {
  name: string
  type: string
  notnull: number
  pk: number
}
export interface AppDatabaseTable {
  name: string
  rowCount: number
  columns: AppDatabaseColumn[]
}
export interface AppDatabaseReadResult {
  columns: string[]
  rows: Record<string, unknown>[]
  totalCount: number
}

export interface AppTableQueryOpts {
  limit?: number
  offset?: number
  orderBy?: string
  orderDir?: "asc" | "desc"
}

interface DeploymentRow {
  branch: string
  commitHash: string
  mainModule: string
  modules: Record<string, string | Record<string, unknown>>
  assets: Record<string, string>
  assetConfig: AssetConfig
}

// Overlay-only paths that must never leak into a deploy, rollback tree, or any
// file listing: git's object store and the ArtifactsFileSystem bookkeeping dir.
function isReservedPath(path: string): boolean {
  return (
    path === "/.git" ||
    path.startsWith("/.git/") ||
    path === "/.afs" ||
    path.startsWith("/.afs/")
  )
}

// ─── SpaceDO ────────────────────────────────────────────────────────────────
// Agent space Durable Object backed by @cloudflare/shell.
//
// Each named instance provides an isolated filesystem + git repo.
// The host worker calls methods via DO RPC (same worker, no HTTP).
// Commits/deploys are mirrored to a per-app Cloudflare Artifacts repo
// (see artifacts-sync.ts), which is the durable source of truth for history.

// Built asset manifest + in-memory storage for a single deployment. Rebuilding
// these on every request is wasteful (CWE-770 amplification under a preview
// flood), so we cache them per `branch:commitHash` with an LRU + TTL bound.
type CachedAssets = {
  manifest: Awaited<ReturnType<typeof buildAssetManifest>>
  storage: ReturnType<typeof createMemoryStorage>
  expiresAt: number
}
const ASSET_CACHE_MAX_ENTRIES = 8
const ASSET_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export class SpaceDO extends DurableObject<Env> {
  private backend!: SpaceFsBackend
  private initializationPromise: Promise<void> | null = null
  private assetCache = new Map<string, CachedAssets>()
  /** The branch the workspace had checked out when this instance started; a cold start rebuilds from it. */
  private activeBranchAtStart = MAIN_BRANCH
  /** The draft operation running now; file writes and the next operation wait for it. */
  private draftOp: Promise<unknown> = Promise.resolve()

  private get overlay(): FileSystem { return this.backend.overlay }
  private get fs(): FileSystem { return this.backend.fs }
  private get git(): Git { return this.backend.git }
  private get stateBackend() { return this.backend.stateBackend }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  private async flushCheckpoint(): Promise<void> {
    await this.backend.flushCheckpoint()
  }

  // ── ArtifactsFileSystem hydration helpers ──

  private async hydrate(path: string): Promise<void> {
    await this.backend.hydrate(path)
  }

  private async materializeAll(): Promise<void> {
    await this.backend.materializeAll()
  }

  // ── Draft helpers ──

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

  private async ensureInit(): Promise<void> {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeSpace().catch((error) => {
        this.initializationPromise = null
        throw error
      })
    }
    await this.initializationPromise
  }

  private async initializeSpace(): Promise<void> {
    await this.initializeBackend()

    // Table needed by the deploy engine. (Git objects/refs live in the
    // Workspace FS under `.git/`, managed by isomorphic-git — the old `refs`
    // and `git_internal` tables from the retired smart-HTTP server are gone.)
    this.ctx.storage.sql.exec(DEPLOYMENTS_TABLE_SQL)

    // Migrate existing deployments tables that lack new columns
    migrateDeploymentsTable(this.ctx.storage.sql)
    this.ctx.storage.sql.exec(DRAFTS_TABLE_SQL)

    // Initialize git repo if not already done
    try {
      await this.git.init({ defaultBranch: this.activeBranchAtStart })
    } catch {
      // Already initialized — ignore
    }

    await this.backend.ready()
  }

  private async initializeBackend(): Promise<void> {
    const mode = await resolveSpaceFsBackendMode(this.ctx.storage, this.env)
    const repoName = this.ctx.id.name ?? "space"
    const activeBranch = (await this.ctx.storage.get<string>(ACTIVE_BRANCH_KEY)) ?? MAIN_BRANCH
    this.activeBranchAtStart = activeBranch
    this.backend = mode === "artifacts"
      ? new ArtifactsBackend(this.ctx, this.env, repoName, activeBranch)
      : new SqlBackend(this.ctx, repoName)
  }

  // ── Filesystem RPC methods ──────────────────────────────────────

  async readFile(path: string, opts?: { offset?: number; limit?: number }): Promise<string> {
    await this.ensureInit()
    // Read through the overlay FS: it hydrates the blob from the Artifacts base
    // on demand and honours whiteouts (a deleted base file stays deleted).
    let content: string
    try {
      content = await this.fs.readFile(path)
    } catch {
      throw new Error(`File not found: ${path}`)
    }

    if (opts?.offset !== undefined || opts?.limit !== undefined) {
      const lines = content.split("\n")
      const start = (opts.offset ?? 1) - 1
      const end = opts.limit !== undefined ? start + opts.limit : lines.length
      return lines
        .slice(start, end)
        .map((line, i) => `${start + i + 1}\t${line}`)
        .join("\n")
    }

    return content
  }

  async writeFile(path: string, content: string): Promise<{ path: string; size: number }> {
    await this.ensureInit()
    await this.draftOp
    // Route through the overlay FS so a write to a previously-deleted base path
    // clears its whiteout tombstone and makes the file visible again.
    await this.fs.writeFile(path, content)
    return { path, size: content.length }
  }

  async editFile(path: string, oldString: string, newString: string): Promise<{ path: string; size: number }> {
    await this.ensureInit()
    await this.draftOp
    await this.hydrate(path)
    const result = await this.stateBackend.replaceInFile(path, oldString, newString)
    if (result.replaced === 0) {
      throw new Error(`old_string not found in ${path}`)
    }
    // Read back size
    const content = await this.fs.readFile(path)
    return { path, size: content.length }
  }

  async deleteFile(path: string): Promise<void> {
    await this.ensureInit()
    await this.draftOp
    // Route through the overlay-aware FS so a base file is tombstoned
    // (whiteout), not silently resurrected by later hydration.
    await this.fs.rm(path, { force: true })
  }

  async glob(pattern: string): Promise<string[]> {
    await this.ensureInit()
    await this.materializeAll()
    const files = await globInfos(this.overlay, pattern)
    return files
      .filter((f: FileInfo) => f.type === "file" && !isReservedPath(f.path))
      .sort((a: FileInfo, b: FileInfo) => b.updatedAt - a.updatedAt)
      .map((f: FileInfo) => f.path)
  }

  async grep(query: string, include?: string): Promise<Array<{ path: string; line: number; content: string }>> {
    await this.ensureInit()
    await this.materializeAll()
    const results = await this.stateBackend.searchFiles(include ?? "**/*", query)
    const matches: Array<{ path: string; line: number; content: string }> = []
    for (const file of results) {
      for (const match of file.matches) {
        matches.push({
          path: file.path,
          line: match.line,
          content: match.lineText,
        })
      }
    }
    return matches
  }

  async list(prefix?: string): Promise<Array<{ path: string; mtime: number; size: number }>> {
    await this.ensureInit()
    await this.materializeAll()
    const pattern = prefix ? `${prefix.replace(/^\//, "")}/**/*` : "**/*"
    const files = await globInfos(this.overlay, pattern)
    return files
      .filter((f: FileInfo) => f.type === "file" && !isReservedPath(f.path))
      .map((f: FileInfo) => ({ path: f.path, mtime: f.updatedAt, size: f.size }))
  }

  // ── Workspace RPC methods consumed by VibeSDK's Think workspace tools ──
  // These mirror the `@cloudflare/shell` Workspace surface 1:1 so the host's
  // `createSpaceWorkspaceOps()` adapter can back `@cloudflare/think`'s
  // read/write/edit/list/find/grep/delete tools with this SpaceDO.

  async stat(path: string): Promise<FileInfo | null> {
    await this.ensureInit()
    await this.hydrate(path)
    try {
      return toFileInfo(path, await this.overlay.stat(path))
    } catch {
      return null
    }
  }

  async readFileBytes(path: string): Promise<Uint8Array | null> {
    await this.ensureInit()
    // Overlay FS hydrates from the base on demand and honours whiteouts; it
    // throws ENOENT for a missing path, but this RPC's contract returns null.
    try {
      return await this.fs.readFileBytes(path)
    } catch {
      return null
    }
  }

  async readDir(dir?: string, opts?: { limit?: number; offset?: number }): Promise<FileInfo[]> {
    await this.ensureInit()
    await this.materializeAll()
    return readDirInfos(this.overlay, dir, opts)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await this.ensureInit()
    await this.fs.mkdir(path, opts)
  }

  async rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await this.ensureInit()
    await this.draftOp
    // Route through the overlay-aware FS so base files are tombstoned.
    await this.fs.rm(path, opts)
  }

  async patch(diff: string): Promise<{ applied: string[]; failed: string[] }> {
    await this.ensureInit()
    await this.draftOp
    const edits = parseUnifiedDiffToEdits(diff)
    const applied: string[] = []
    const failed: string[] = []

    for (const edit of edits) {
      try {
        await this.fs.writeFile(edit.path, edit.content)
        applied.push(edit.path)
      } catch {
        failed.push(edit.path)
      }
    }

    return { applied, failed }
  }

  /** Resolve the branch HEAD currently points at (best-effort). */
  private async currentBranch(): Promise<string | null> {
    try {
      const result = await this.git.branch({ list: true })
      if ("current" in result && result.current) return result.current
    } catch {
      // ignore — treat as unknown
    }
    return null
  }

  // ── Git RPC methods ─────────────────────────────────────────────

  async gitCommitLocal(
    message: string,
    author?: { name: string; email: string }
  ): Promise<{ sha: string; message: string }> {
    await this.ensureInit()
    // Persist pending overlay writes before the commit captures the tree.
    await this.flushCheckpoint()
    // Stage the workdir (incl. deletions) but never reserved bookkeeping
    // paths — a committed `.afs/state.json` would pollute the Artifacts base.
    await stageWorkdir(this.fs, isReservedPath)
    // Skip no-op commits (nothing changed since HEAD) so callers that commit
    // defensively don't append empty restore points.
    if (await stagedTreeMatchesHead(this.fs, isReservedPath)) {
      const head = await resolveHead(this.fs, "HEAD")
      return { sha: head ?? "", message }
    }
    const result = await this.git.commit({
      message,
      author: author ?? DEFAULT_AUTHOR,
    })
    return { sha: result.oid, message: result.message }
  }

  /**
   * Commits the working tree to the checked-out branch. While the AI resolves a merge into it, the first commit is the
   * merge commit; nothing is mirrored until a deploy of it builds.
   */
  private async commitWorkingTree(
    message: string,
    author?: { name: string; email: string },
  ): Promise<{ sha: string; message: string; committed: boolean; branch: string | null }> {
    // Staging walks the whole tree; ensure the Artifacts base is materialized
    // so the commit captures every file, not just overlay writes. Reserved
    // bookkeeping paths (`.afs`) are skipped so they never enter a commit.
    await this.materializeAll()
    // Persist pending overlay writes before the commit captures the tree.
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
    // Skip no-op commits (e.g. a preview redeploy on page reload) so history is
    // not polluted with empty commits and the remote is not pushed needlessly.
    if (await stagedTreeMatchesHead(this.fs, isReservedPath)) {
      const head = await resolveHead(this.fs, "HEAD")
      return { sha: head ?? "", message, committed: false, branch }
    }
    const result = await this.git.commit({ message, author: author ?? DEFAULT_AUTHOR })
    if (branch) touchDraftBranch(this.ctx.storage.sql, branch, Date.now())
    return { sha: result.oid, message: result.message, committed: true, branch }
  }

  /**
   * Commits the working tree and mirrors it in the background, except while a merge is open. It never waits for the
   * draft lock, so locked operations can call it.
   */
  private async commitAndMirror(
    message: string,
    author?: { name: string; email: string },
  ): Promise<{ sha: string; message: string }> {
    const result = await this.commitWorkingTree(message, author)
    const branch = result.branch
    if (result.committed && branch && !(await this.mergeState())) {
      this.ctx.waitUntil(this.backend.push(branch).then(() => undefined))
    }
    return { sha: result.sha, message: result.message }
  }

  async gitCommit(
    message: string,
    author?: { name: string; email: string }
  ): Promise<{ sha: string; message: string }> {
    await this.ensureInit()
    await this.draftOp
    return this.commitAndMirror(message, author)
  }

  /**
   * Every file in the tree of `commit`, as bytes. Reads git objects, so the
   * result is the committed content even when the working tree has edits.
   *
   * A best-effort fetch first brings in the commit's objects when the startup
   * fetch of the Artifacts base did not complete.
   */
  async readTreeAtCommit(commit: string): Promise<Array<{ path: string; bytes: Uint8Array }>> {
    await this.ensureInit()
    try {
      const branch = (await this.currentBranch()) ?? "main"
      await this.backend.fetch(branch)
    } catch {
      // Best-effort: read whatever is already local.
    }
    const files = await readCommitFiles(this.fs, commit)
    return files.filter((file) => !isReservedPath(file.path))
  }

  /**
   * Write `files` into the working tree and commit them as one restore point.
   * Starts a new app from a template snapshot.
   */
  async importFiles(
    files: Array<{ path: string; bytes: Uint8Array }>,
    message: string,
  ): Promise<{ sha: string; message: string }> {
    await this.ensureInit()
    await this.draftOp
    await writeWorkdirFiles(this.fs, files, isReservedPath)
    return this.commitAndMirror(message)
  }

  async gitLog(limit?: number): Promise<GitLogEntry[]> {
    await this.ensureInit()
    return this.git.log({ depth: limit })
  }

  async gitStatus(): Promise<GitStatusEntry[]> {
    await this.ensureInit()
    return this.git.status()
  }

  async gitCheckout(ref: string): Promise<void> {
    await this.ensureInit()
    await this.git.checkout({ ref })
  }

  async gitBranch(opts?: { name?: string; list?: boolean; delete?: string }) {
    await this.ensureInit()
    return this.git.branch(opts)
  }

  async gitDiff(): Promise<Array<{ filepath: string; status: string }>> {
    await this.ensureInit()
    return this.git.diff()
  }

  /**
   * Export the raw git object store (`.git/**`) as `{ path, data }[]`, the same
   * shape the host's git-clone/GitHub-export pipeline consumes. Used to serve
   * clones and push the app's real repository (with full history) to GitHub for
   * think apps, whose files/commits live here in SpaceDO rather than in the
   * agent's own git.
   *
   * A best-effort full fetch first ensures the overlay `.git` holds the entire
   * history (isomorphic-git fetch is not shallow), not just what a cold start
   * materialized. Paths are returned without a leading slash (`.git/HEAD`,
   * `.git/objects/…`) to match the loose-object layout callers expect.
   */
  async exportGitObjects(): Promise<Array<{ path: string; data: Uint8Array }>> {
    await this.ensureInit()
    try {
      const branch = (await this.currentBranch()) ?? "main"
      await this.backend.fetch(branch)
    } catch {
      // Best-effort: export whatever is already local.
    }

    const out: Array<{ path: string; data: Uint8Array }> = []
    const walk = async (dir: string): Promise<void> => {
      let entries: Awaited<ReturnType<FileSystem["readdirWithFileTypes"]>>
      try {
        entries = await this.overlay.readdirWithFileTypes(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        const full = dir === "/" ? `/${entry.name}` : `${dir}/${entry.name}`
        let stat
        try {
          stat = await this.overlay.stat(full)
        } catch {
          continue
        }
        if (stat.type === "directory") {
          await walk(full)
        } else {
          const bytes = await this.overlay.readFileBytes(full)
          if (bytes) out.push({ path: full.replace(/^\/+/, ""), data: bytes })
        }
      }
    }
    await walk("/.git")
    return out
  }

  /**
   * Roll back `branch` to the tree of `commitHash` and redeploy. This is a
   * forward restore (not a destructive reset): it captures the file tree at the
   * target commit, reconciles the branch working tree to match it, then creates
   * a new commit on `branch` and deploys — so history stays intact and the
   * preview rebuilds from the restored files.
   */
  async rollbackToCommit(branch: string, commitHash: string): Promise<unknown> {
    await this.ensureInit()
    // Locked: HEAD is detached while the target's tree is read, so no draft operation may see it.
    return this.withDraftLock(async () => {
      if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }
      // The rollback ends on `branch`, so another draft would leave HEAD, and the AI's next writes, off the active one.
      if (branch !== ((await this.currentBranch()) ?? MAIN_BRANCH)) return { error: "Switch to this draft before rolling it back." }
      // Reads/walks the whole working tree below, so the Artifacts base must be
      // fully materialized into the overlay first.
      await this.materializeAll()

      await this.backend.fetch(branch)

      // Verify the target commit exists on this branch's history.
      const history = await this.git.log({ ref: branch, depth: 1000 })
      const target = history.find(
        (entry) => entry.oid === commitHash || entry.oid.startsWith(commitHash),
      )
      if (!target) {
        return { error: `Commit ${commitHash} not found on branch "${branch}"` }
      }

      // Capture the file tree at the target commit as raw bytes. Reading and
      // rewriting via bytes (not strings) keeps binary assets — fonts, images,
      // favicons — byte-for-byte intact. Round-tripping them through UTF-8
      // corrupts them and inflates each invalid byte into a 3-byte replacement
      // char, which can push a file past the SQLite inline-value limit and throw
      // SQLITE_TOOBIG (only reproduced on rollback, since normal deploys never
      // rewrite these files).
      await this.git.checkout({ ref: target.oid })
      const targetFiles = new Map<string, Uint8Array>()
      for (const info of await globInfos(this.overlay, "**/*")) {
        if (info.type !== "file") continue
        if (isReservedPath(info.path)) continue
        const bytes = await this.overlay.readFileBytes(info.path)
        if (bytes) targetFiles.set(info.path, bytes)
      }

      // Return to the branch HEAD and reconcile the working tree: remove files
      // that are absent from the target, then (over)write the captured files.
      await this.git.checkout({ ref: branch })
      for (const info of await globInfos(this.overlay, "**/*")) {
        if (info.type !== "file") continue
        if (isReservedPath(info.path)) continue
        if (!targetFiles.has(info.path)) {
          await this.overlay.rm(info.path, { force: true })
        }
      }
      for (const [path, bytes] of targetFiles) {
        await this.overlay.writeFileBytes(path, bytes)
      }

      // Commit the restored tree (no-op if nothing changed) and redeploy.
      try {
        await this.commitAndMirror(`rollback: restore ${target.oid.slice(0, 8)}`)
      } catch {
        // Clean tree (already at target) — proceed to redeploy existing HEAD.
      }
      return this.deploy(branch)
    })
  }

  // ── Deploy RPC methods ──────────────────────────────────────────

  async deploy(branch: string): Promise<unknown> {
    await this.ensureInit()
    // The deploy engine reads the branch's last commit from git objects, so
    // retry a failed startup load of the Artifacts base, which brings them in.
    await this.materializeAll()
    await this.flushCheckpoint()
    const fakeRequest = new Request("http://internal/?cmd=deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch }),
    })
    const ctx: DeployContext = {
      sql: this.ctx.storage.sql,
      git: this.git,
      fs: this.fs,
    }
    const res = await handleDeployCommand(ctx, "deploy", fakeRequest)
    const data = await res.json() as Record<string, unknown>
    const spaceName = this.ctx.id.name ?? "space"
    data.preview_url = `/space/${spaceName}/preview/${encodeURIComponent(branch)}/`

    if (!data.error) {
      const merge = await this.mergeState()
      if (merge && merge.branch === branch) {
        // The resolution isn't committed yet, so this built the draft's old version: nothing new to mirror.
        if (await mergeCommitPending(this.fs, merge)) return data
        await this.ctx.storage.delete(MERGE_STATE_KEY)
      }
      await this.backend.push(branch)
    }

    return data
  }

  async getDeploymentBundle(branch: string): Promise<BranchDeploymentBundle> {
    await this.ensureInit()
    await this.materializeAll()
    return buildBranchDeployment(
      {
        sql: this.ctx.storage.sql,
        git: this.git,
        fs: this.fs,
      },
      branch,
    )
  }

  async undeploy(branch: string): Promise<unknown> {
    await this.ensureInit()
    const fakeRequest = new Request("http://internal/?cmd=undeploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch }),
    })
    const ctx: DeployContext = {
      sql: this.ctx.storage.sql,
      git: this.git,
      fs: this.overlay,
    }
    const res = await handleDeployCommand(ctx, "undeploy", fakeRequest)
    return res.json()
  }

  async listDeployments(): Promise<unknown> {
    await this.ensureInit()
    const fakeRequest = new Request("http://internal/?cmd=list_deployments")
    const ctx: DeployContext = {
      sql: this.ctx.storage.sql,
      git: this.git,
      fs: this.overlay,
    }
    const res = await handleDeployCommand(ctx, "list_deployments", fakeRequest)
    return res.json()
  }

  async getDeployment(branch: string): Promise<unknown> {
    await this.ensureInit()
    const fakeRequest = new Request(`http://internal/?cmd=get_deployment&branch=${encodeURIComponent(branch)}`)
    const ctx: DeployContext = {
      sql: this.ctx.storage.sql,
      git: this.git,
      fs: this.overlay,
    }
    const res = await handleDeployCommand(ctx, "get_deployment", fakeRequest)
    return res.json()
  }

  /** The deployed branch's `estori-store.json` as committed, which prices checkout in previews. */
  async getStoreManifest(branch: string): Promise<{ commitHash: string; manifest: string | null } | null> {
    await this.ensureInit()
    return this.readStoreManifest(branch)
  }

  /** The text files of a deployed branch, `live` included. It reads the stored bundle alone, so a cold start works. */
  async getDeploymentTexts(branch: string): Promise<DeploymentTexts | null> {
    await this.ensureInit()
    return readDeploymentTexts(this.ctx.storage.sql, branch)
  }

  private readStoreManifest(branch: string): { commitHash: string; manifest: string | null } | null {
    const row = this.ctx.storage.sql
      .exec("SELECT commit_hash, store_manifest FROM deployments WHERE branch = ?", branch)
      .toArray()[0]
    if (!row) return null
    return { commitHash: row.commit_hash as string, manifest: (row.store_manifest as string | null) ?? null }
  }

  // ── Draft RPC methods ───────────────────────────────────────────

  async listDrafts(): Promise<DraftsSnapshot> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const sql = this.ctx.storage.sql
      // Fetched before any state is computed: a commit whose objects aren't local counts as not included.
      const published = await this.ensurePublishedObjects()
      const records = listDraftRecords(sql, Date.now())
      const active = (await this.currentBranch()) ?? MAIN_BRANCH
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
    })
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
      try {
        await createDraftBranch(this.fs, added.draft.branch, start)
      } catch {
        // The start's commit isn't local: a fetch failed without saying so.
        removeDraftRecord(sql, added.draft.id)
        return { error: "Couldn't load the version to start from. Try again." }
      }
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

  /**
   * Publishes the draft's build (the checked-out draft by default), deploying its latest version first. Catalog
   * products already live keep selling, so only ones the live version doesn't have are refused.
   */
  async publishDraft(id?: string, options: PublishDraftOptions = {}): Promise<PublishDraftResult> {
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
      let tip = await ensureLocalBranch(this.fs, draft.branch, this.fetchBranch)
      if (!tip) return { error: "Deploy the store's preview before publishing it." }
      // The catalog changes prices only through the same git/build/publication boundary as the builder.
      // Save and restore a different active draft using the existing draft lock, never writing into its tree.
      if (options.storeProducts?.managedProductIds.length) {
        if (await this.mergeState()) return { error: "Finish bringing in live changes before publishing catalog products." }
        const switched = draft.branch !== activeBranch
        if (switched) {
          await this.commitWorkingTree("Saved before publishing catalog products in another draft")
          await this.git.checkout({ ref: draft.branch, force: true })
          await this.ctx.storage.put(ACTIVE_BRANCH_KEY, draft.branch)
        }
        try {
          await this.materializeAll()
          const files = await globInfos(this.overlay, "**/*")
          const exists = files.some((file) => file.type === "file" && file.path === STORE_MANIFEST_PATH)
          const current = exists ? await this.fs.readFile(STORE_MANIFEST_PATH) : null
          const next = mergeManagedStoreProducts(current, options.storeProducts)
          if (current !== next) {
            await this.fs.writeFile(STORE_MANIFEST_PATH, next)
            tip = (await this.commitWorkingTree("Updated products from the account catalog")).sha
          }
        } catch (error) {
          return { error: error instanceof Error ? error.message : "Catalog products couldn't be prepared for publishing." }
        } finally {
          if (switched) {
            await this.git.checkout({ ref: activeBranch, force: true })
            await this.ctx.storage.put(ACTIVE_BRANCH_KEY, activeBranch)
          }
        }
      }
      if (this.readDeployment(draft.branch)?.commitHash !== tip) {
        const deployed = (await this.deploy(draft.branch)) as { error?: unknown }
        if (deployed.error) return { error: "This draft's preview doesn't build. Fix it before publishing." }
      }
      if (options.refuseNewCatalogProducts) {
        const draftManifest = this.readStoreManifest(draft.branch)?.manifest ?? null
        const liveManifest = this.readStoreManifest(LIVE_BRANCH)?.manifest ?? null
        if (newCatalogVariantIds(draftManifest, liveManifest).length > 0) return { error: NEW_CATALOG_PRODUCTS_ERROR }
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
      // Mirrored first, so the version a cancel returns to is still there after a cold start mid-merge.
      if (this.backend.mirrorsToArtifacts && !(await this.backend.push(draft.branch))) {
        return { error: "Couldn't save your work first. Try again." }
      }
      const outcome = await mergePublished(this.fs, draft.branch, published.commit, DEFAULT_AUTHOR, isReservedPath)
      if (outcome.result === "up-to-date" || outcome.result === "binary-changed-on-both-sides") return outcome
      if (outcome.result === "conflicts") {
        await this.ctx.storage.put(MERGE_STATE_KEY, {
          draftId: draft.id,
          branch: draft.branch,
          ours: outcome.ours,
          theirs: published.commit,
          files: outcome.files,
          deletedByDraft: outcome.deletedByDraft,
          deletedByLive: outcome.deletedByLive,
          merged: null,
        } satisfies MergeState)
        // Saved after the merge state, so a restart never brings back markers without the merge that explains them.
        await this.flushCheckpoint()
        return {
          result: "conflicts",
          files: outcome.files,
          deletedByDraft: outcome.deletedByDraft,
          deletedByLive: outcome.deletedByLive,
          liveChanges: await liveChangeMessages(this.fs, outcome.ours, published.commit),
        }
      }
      // A clean merge stays cancellable until it builds: the deploy below clears this and mirrors the draft.
      await this.ctx.storage.put(MERGE_STATE_KEY, {
        draftId: draft.id,
        branch: draft.branch,
        ours: before,
        theirs: published.commit,
        files: [],
        deletedByDraft: [],
        deletedByLive: [],
        merged: outcome.commit,
      } satisfies MergeState)
      await this.flushCheckpoint()
      touchDraftBranch(this.ctx.storage.sql, draft.branch, Date.now())
      const deploy = await this.deploy(draft.branch)
      return { result: outcome.result, commit: outcome.commit, deploy }
    })
  }

  async cancelBringingInLiveChanges(): Promise<{ cancelled: boolean }> {
    await this.ensureInit()
    return this.withDraftLock(async () => {
      const merge = await this.mergeState()
      if (!merge) return { cancelled: false }
      await this.materializeAll()
      await cancelMerge(this.fs, merge, isReservedPath)
      // Saved before the merge state goes, so a restart never brings back markers without the merge that explains them.
      await this.flushCheckpoint()
      await this.ctx.storage.delete(MERGE_STATE_KEY)
      return { cancelled: true }
    })
  }

  async getMergeState(): Promise<MergeState | null> {
    await this.ensureInit()
    return this.mergeState()
  }

  // ── Space info ──────────────────────────────────────────────────

  async getInfo(): Promise<{ fileCount: number; directoryCount: number; totalBytes: number }> {
    await this.ensureInit()
    await this.materializeAll()
    let fileCount = 0
    let directoryCount = 0
    let totalBytes = 0
    for (const info of await globInfos(this.overlay, "**/*")) {
      if (isReservedPath(info.path)) continue
      if (info.type === "file") {
        fileCount++
        totalBytes += info.size
      } else if (info.type === "directory") {
        directoryCount++
      }
    }
    return { fileCount, directoryCount, totalBytes }
  }

  // ── Deployment row reader (shared by servePreview + DB-viewer) ──

  private readDeployment(branch: string): DeploymentRow | null {
    const rows = this.ctx.storage.sql
      .exec(
        "SELECT branch, commit_hash, main_module, modules, assets, asset_config FROM deployments WHERE branch = ?",
        branch,
      )
      .toArray()
    if (rows.length === 0) return null
    const r = rows[0]
    return {
      branch: r.branch as string,
      commitHash: r.commit_hash as string,
      mainModule: r.main_module as string,
      modules: JSON.parse(r.modules as string) as Record<string, string | Record<string, unknown>>,
      assets: JSON.parse((r.assets as string) || "{}") as Record<string, string>,
      assetConfig: JSON.parse((r.asset_config as string) || "{}") as AssetConfig,
    }
  }

  // ── Preview serving via Dynamic Workers ─────────────────────────
  //
  // Architecture (matches Cloudflare's Durable Object Facets docs example):
  //
  //   - The LLM exports `class App extends DurableObject` from its main
  //     module. `App.fetch(request)` is the entire backend (Hono /
  //     itty-router / vanilla — the LLM decides).
  //   - SpaceDO acts as the supervisor ("AppRunner" in the docs).
  //     `servePreview` loads the user's worker via the Worker Loader,
  //     extracts the App class, and hosts it as a Facet keyed
  //     `app:<branch>`. Static assets are served host-side; everything
  //     else (including WebSocket upgrades) is forwarded into the Facet.
  //   - State is the Facet's own `ctx.storage` (SQLite + KV). No env.DB
  //     binding is injected.
  //   - To make the DB-viewer work without forcing the LLM to write
  //     inspector boilerplate, we don't load the user's main directly.
  //     We load a wrapper module (`inspector-wrapper.ts`) which imports
  //     the user's `App`, re-exports everything, and exports a subclass
  //     `App` that adds `__vibeInspectListTables` / `__vibeInspectRead`
  //     / `__vibeWipe`. The subclass shares the same `ctx.storage`.

  async servePreview(branch: string, request: Request): Promise<Response> {
    await this.ensureInit()

    const dep = this.readDeployment(branch)
    if (!dep) {
      return new Response(`No deployment found for branch "${branch}"`, { status: 404 })
    }

    // Serve static assets host-side before forwarding to the Facet. The built
    // manifest/storage are cached per deployment so repeat asset reads don't
    // re-spin the build on every request.
    if (Object.keys(dep.assets).length > 0) {
      const { manifest, storage } = await this.getCachedAssets(dep)
      const assetResponse = await handleAssetRequest(request, manifest, storage, dep.assetConfig)
      if (assetResponse) return assetResponse
    }

    let appClass: DurableObjectClass
    try {
      appClass = this.loadAppClass(dep)
    } catch (e) {
      return new Response(
        `Failed to load App class: ${e instanceof Error ? e.message : String(e)}`,
        { status: 500 },
      )
    }

    const facet = this.ctx.facets.get(facetNameForApp(branch), () => ({ class: appClass }))
    return facet.fetch(request)
  }

  /**
   * Return the built asset manifest + in-memory storage for a deployment,
   * reusing a cached build when available. Keyed by `branch:commitHash` so a
   * redeploy (new commit) transparently rebuilds. Bounded by an LRU cap + TTL.
   */
  private async getCachedAssets(dep: DeploymentRow): Promise<CachedAssets> {
    const key = `${dep.branch}:${dep.commitHash}`
    const now = Date.now()

    const cached = this.assetCache.get(key)
    if (cached && cached.expiresAt > now) {
      // Refresh LRU recency.
      this.assetCache.delete(key)
      this.assetCache.set(key, cached)
      return cached
    }

    const manifest = await buildAssetManifest(dep.assets)
    const storage = createMemoryStorage(dep.assets)
    const entry: CachedAssets = { manifest, storage, expiresAt: now + ASSET_CACHE_TTL_MS }

    this.assetCache.set(key, entry)

    // Evict expired / oldest entries to keep the cache bounded.
    for (const [k, v] of this.assetCache) {
      if (v.expiresAt <= now) this.assetCache.delete(k)
    }
    while (this.assetCache.size > ASSET_CACHE_MAX_ENTRIES) {
      const oldest = this.assetCache.keys().next().value
      if (oldest === undefined) break
      this.assetCache.delete(oldest)
    }

    return entry
  }

  // ── App-class loader ────────────────────────────────────────────
  //
  // Loads the dynamic worker for `branch`'s latest deployment with the
  // inspector wrapper as the main module. The wrapper imports the
  // user's main and exports a subclass of `App` with `__vibeInspect*`
  // methods (see `inspector-wrapper.ts`).
  //
  // `LOADER.get(id, ...)` caches by id. We key on
  // `<spaceName>-<branch>-<commitHash>` so a redeploy invalidates the
  // worker (and any Facet still pinned to the old class is aborted
  // implicitly the next time `ctx.facets.get(...)` runs the callback).
  private loadAppClass(dep: DeploymentRow): DurableObjectClass {
    const spaceName = this.ctx.id.name ?? "space"
    const workerId = `${spaceName}-${dep.branch}-${dep.commitHash}`
    const wrappedModules: Record<string, string | Record<string, unknown>> = {
      ...dep.modules,
      [VIBE_APP_MODULE]: buildInspectorWrapperSource(dep.mainModule),
    }
    const worker = this.env.LOADER.get(workerId, async () => ({
      mainModule: VIBE_APP_MODULE,
      modules: wrappedModules,
      compatibilityDate: "2025-04-01",
    }))
    return (
      worker as { getDurableObjectClass: (name: string) => DurableObjectClass }
    ).getDurableObjectClass("App")
  }

  /**
   * Returns a Facet stub for the App of `branch`, starting it (loading
   * the dynamic worker, wrapping the App class) on first call. Used by
   * the DB-viewer inspector RPCs.
   *
   * Returns `null` if there is no deployment yet for the branch.
   */
  private getAppFacet(branch: string): Fetcher | null {
    const dep = this.readDeployment(branch)
    if (!dep) return null
    const cls = this.loadAppClass(dep)
    return this.ctx.facets.get(facetNameForApp(branch), () => ({ class: cls })) as unknown as Fetcher
  }

  // ── DB-viewer RPC methods ───────────────────────────────────────
  //
  // The App's storage lives inside the Facet. The inspector wrapper
  // (`inspector-wrapper.ts`) extends the user's App class with
  // `__vibeInspect*` methods, so we just RPC into the Facet stub.

  async listAppTables(branch: string): Promise<AppDatabaseTable[]> {
    await this.ensureInit()
    const facet = this.getAppFacet(branch)
    if (!facet) return []
    return await (facet as unknown as {
      __vibeInspectListTables: () => Promise<AppDatabaseTable[]>
    }).__vibeInspectListTables()
  }

  async queryAppTable(
    branch: string,
    table: string,
    opts: AppTableQueryOpts = {},
  ): Promise<AppDatabaseReadResult> {
    await this.ensureInit()
    const facet = this.getAppFacet(branch)
    if (!facet) {
      return { columns: [], rows: [], totalCount: 0 }
    }
    return await (facet as unknown as {
      __vibeInspectRead: (
        table: string,
        opts: AppTableQueryOpts,
      ) => Promise<AppDatabaseReadResult>
    }).__vibeInspectRead(table, opts)
  }

  /**
   * Drop every user table inside the App Facet's SQLite. We use a
   * targeted drop rather than `ctx.facets.delete(...)` because the
   * latter aborts the Facet immediately and breaks any active
   * WebSocket connections — the user is usually in the middle of
   * preview-iteration when they hit Reset.
   */
  async wipeAppDatabase(branch: string): Promise<{ ok: true }> {
    await this.ensureInit()
    const facet = this.getAppFacet(branch)
    if (!facet) return { ok: true }
    await (facet as unknown as {
      __vibeWipe: () => Promise<{ ok: true }>
    }).__vibeWipe()
    return { ok: true }
  }

  // ── HTTP handler: preview serving + internal deploy commands ────

  async fetch(request: Request): Promise<Response> {
    await this.ensureInit()

    const url = new URL(request.url)
    const path = url.pathname

    // Live store routes: the platform worker forwards `/__live/<path>` for a store's own address. It's served at the
    // root, so nothing is rewritten, and from its own Facet, so the live store's data is apart from the preview's.
    if (path === LIVE_PATH_PREFIX || path.startsWith(`${LIVE_PATH_PREFIX}/`)) {
      const liveUrl = servedUrl(url, path.slice(LIVE_PATH_PREFIX.length))
      const response = await this.servePreview(LIVE_BRANCH, new Request(liveUrl.toString(), request))
      return stripPreviewSecurityHeaders(response)
    }

    // Preview routes: /space/:name/preview/:branch/*
    const previewMatch = path.match(/\/preview\/([^/]+)(\/.*)?$/)
    if (previewMatch) {
      const branch = decodeURIComponent(previewMatch[1])
      const spaceName = this.ctx.id.name ?? "space"
      const basePath = `/space/${spaceName}/preview/${encodeURIComponent(branch)}`

      // Rewrite the URL so the dynamic worker sees a clean path
      const previewUrl = servedUrl(url, previewMatch[2] || "/")
      const previewRequest = new Request(previewUrl.toString(), request)
      const response = await this.servePreview(branch, previewRequest)

      // Strip headers a generated app must not be able to set on the shared
      // preview origin (e.g. Service-Worker-Allowed scope expansion) before
      // any further rewriting.
      const safeResponse = stripPreviewSecurityHeaders(response)

      // Rewrite root-relative paths in HTML responses so they resolve
      // correctly when the preview is mounted on a sub-path
      return rewritePreviewResponse(safeResponse, basePath)
    }

    // Deploy command routes
    const cmd = url.searchParams.get("cmd")
    if (cmd && ["deploy", "get_deployment", "list_deployments", "undeploy"].includes(cmd)) {
      const deployCtx: DeployContext = {
        sql: this.ctx.storage.sql,
        git: this.git,
        fs: this.overlay,
      }
      return handleDeployCommand(deployCtx, cmd, request)
    }

    return new Response("Not Found", { status: 404 })
  }
}

// ─── Preview Response Rewriting ──────────────────────────────────────────────
// When a preview is served on /space/:name/preview/:branch/, root-relative
// paths like /style.css in HTML would resolve to the domain root instead of
// the preview path. We rewrite them so the browser fetches the correct URL.

function rewritePreviewResponse(response: Response, basePath: string): Response {
  // Rewrite Location header on redirects
  const location = response.headers.get("location")
  if (location?.startsWith("/")) {
    const rewritten = new Response(response.body, response)
    rewritten.headers.set("location", basePath + location)
    return rewritten
  }

  // Only rewrite HTML responses
  const ct = response.headers.get("content-type") ?? ""
  if (!ct.includes("text/html")) return response

  // Use HTMLRewriter to prefix root-relative src/href/action attributes
  return new HTMLRewriter()
    .on("[src],[href],[action]", {
      element(el) {
        for (const attr of ["src", "href", "action"] as const) {
          const val = el.getAttribute(attr)
          if (val?.startsWith("/") && !val.startsWith("//")) {
            el.setAttribute(attr, basePath + val)
          }
        }
      },
    })
    .transform(response)
}

// ─── Facet naming ───────────────────────────────────────────────────────────

function facetNameForApp(branch: string): string {
  return `app:${branch}`
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface PatchEdit {
  path: string
  content: string
}

function parseUnifiedDiffToEdits(diff: string): PatchEdit[] {
  const edits: PatchEdit[] = []
  const lines = diff.split("\n")
  let i = 0

  while (i < lines.length) {
    if (lines[i].startsWith("--- ")) {
      const oldPath = lines[i].slice(4).replace(/^[ab]\//, "")
      i++
      if (i < lines.length && lines[i].startsWith("+++ ")) {
        const newPath = lines[i].slice(4).replace(/^[ab]\//, "")
        i++
        const path = newPath === "/dev/null" ? oldPath : newPath
        const resultLines: string[] = []

        while (i < lines.length && !lines[i].startsWith("--- ")) {
          const l = lines[i]
          if (l.startsWith("@@")) {
            i++
            continue
          }
          if (l.startsWith("+") && !l.startsWith("+++")) {
            resultLines.push(l.slice(1))
          } else if (l.startsWith("-") && !l.startsWith("---")) {
            // removed line — skip
          } else if (l.startsWith(" ") || l === "") {
            resultLines.push(l.slice(1))
          } else {
            break
          }
          i++
        }

        edits.push({ path, content: resultLines.join("\n") })
        continue
      }
    }
    i++
  }

  return edits
}
