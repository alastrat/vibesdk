/**
 * Git work behind drafts, on the workspace's own repository: draft branches, how each relates to the published
 * commit, and bringing the published commit into a draft. `@cloudflare/shell/git` has no merge, so this uses
 * isomorphic-git directly, as git-objects.ts does.
 */
import * as git from "isomorphic-git"
import type { FileSystem } from "@cloudflare/shell"
import { createGitFs, resolveHead, stageWorkdir } from "./git-objects"

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

/** Starts `branch` at `startCommit`, which must be local; throws if the branch exists or the commit is missing. */
export async function createDraftBranch(fs: FileSystem, branch: string, startCommit: string): Promise<void> {
  const gitFs = createGitFs(fs)
  await git.readCommit({ fs: gitFs, dir: "/", oid: startCommit })
  await git.writeRef({ fs: gitFs, dir: "/", ref: `refs/heads/${branch}`, value: startCommit })
}

export async function deleteDraftBranch(fs: FileSystem, branch: string): Promise<void> {
  if (!(await branchTip(fs, branch))) return
  await git.deleteRef({ fs: createGitFs(fs), dir: "/", ref: `refs/heads/${branch}` })
}

/**
 * True when `tip`'s history includes `commit`. A commit whose objects aren't local counts as not included, so callers
 * fetch the published commit's branch first; other errors propagate.
 */
async function includes(fs: FileSystem, tip: string, commit: string): Promise<boolean> {
  if (tip === commit) return true
  try {
    return await git.isDescendent({ fs: createGitFs(fs), dir: "/", oid: tip, ancestor: commit, depth: -1 })
  } catch (error) {
    if ((error as { code?: unknown }).code !== "NotFoundError") throw error
    return false
  }
}

export async function draftGitState(fs: FileSystem, tip: string | null, published: string | null): Promise<DraftGitState> {
  if (!tip || !published) return { live: false, unpublishedChanges: false, behindLive: false }
  if (tip === published) return { live: true, unpublishedChanges: false, behindLive: false }
  const [hasPublished, publishedHasTip] = await Promise.all([includes(fs, tip, published), includes(fs, published, tip)])
  return { live: false, unpublishedChanges: !publishedHasTip, behindLive: !hasPublished }
}

export const LIVE_CHANGES_MESSAGE = "Brought in the live store's changes"
/** Durable storage key of the merge the AI is resolving. */
export const MERGE_STATE_KEY = "drafts:merge"
const CONFLICT_MARKER = /^(<{7}|>{7}) /m

/**
 * `files` hold conflict markers. `deletedByDraft` are files the draft deleted and the live store changed (the working
 * tree holds the live version); `deletedByLive` are files the live store deleted and the draft changed (it holds the
 * draft's version). Neither has markers, so the AI has to decide whether the file stays.
 */
export type MergeOutcome =
  | { result: "up-to-date" }
  | { result: "fast-forward" | "merged"; commit: string }
  | { result: "conflicts"; files: string[]; deletedByDraft: string[]; deletedByLive: string[]; ours: string }
  | BinaryChangedOnBothSides

/** Nothing was merged: git can't combine two different versions of a binary file, so the seller has to pick one. */
export interface BinaryChangedOnBothSides {
  result: "binary-changed-on-both-sides"
  files: string[]
}

/** What bringing in the live store's changes did, as SpaceDO reports it. */
export type BringInOutcome =
  | { result: "up-to-date" }
  | { result: "fast-forward" | "merged"; commit: string; deploy: unknown }
  | { result: "conflicts"; files: string[]; deletedByDraft: string[]; deletedByLive: string[]; liveChanges: string[] }
  | BinaryChangedOnBothSides
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
  /** Files with conflict markers. */
  files: string[]
  /** Files the draft deleted that the live store changed. */
  deletedByDraft: string[]
  /** Files the live store deleted that the draft changed. */
  deletedByLive: string[]
  /** The merge (or fast-forward) commit once there is one. */
  merged: string | null
}

interface ConflictSets {
  files: string[]
  deletedByDraft: string[]
  deletedByLive: string[]
}

function conflictSets(error: unknown): ConflictSets | null {
  if (!(error instanceof Error) || (error as { code?: unknown }).code !== "MergeConflictError") return null
  const data = (error as { data?: { filepaths?: unknown; deleteByUs?: unknown; deleteByTheirs?: unknown } }).data
  const names = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])
  const deletedByDraft = names(data?.deleteByUs)
  const deletedByLive = names(data?.deleteByTheirs)
  const deleted = new Set([...deletedByDraft, ...deletedByLive])
  return { files: names(data?.filepaths).filter((file) => !deleted.has(file)), deletedByDraft, deletedByLive }
}

interface WalkedFile {
  filepath: string
  base: string | null
  ours: string | null
  theirs: string | null
}

/**
 * Every file in the merge base, the draft and the published commit with its blob oid in each (null where absent).
 * Empty when the two have no single merge base, which `git.merge` reports itself.
 */
async function walkThreeWays(fs: FileSystem, ours: string, published: string): Promise<WalkedFile[]> {
  const gitFs = createGitFs(fs)
  const [base] = await git.findMergeBase({ fs: gitFs, dir: "/", oids: [ours, published] })
  if (!base) return []
  const walked = (await git.walk({
    fs: gitFs,
    dir: "/",
    trees: [git.TREE({ ref: base }), git.TREE({ ref: ours }), git.TREE({ ref: published })],
    map: async (filepath, entries) => {
      if (filepath === ".") return undefined
      const kinds = await Promise.all(entries.map((entry) => entry?.type() ?? null))
      if (kinds.some((kind) => kind !== null && kind !== "blob")) return undefined
      const [baseOid, oursOid, theirsOid] = await Promise.all(entries.map((entry) => entry?.oid() ?? null))
      return { filepath, base: baseOid, ours: oursOid, theirs: theirsOid }
    },
  })) as Array<WalkedFile | undefined>
  return walked.filter((file): file is WalkedFile => file !== undefined)
}

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** A NUL byte, or bytes that aren't valid UTF-8: text decoding would change them. */
function isBinary(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return true
  try {
    UTF8.decode(bytes)
    return false
  } catch {
    return true
  }
}

/**
 * Paths both sides changed to different content (or added with different content) where either version is binary.
 * isomorphic-git decodes both sides as UTF-8 before merging and writes the merged text back, so two different binary
 * versions can decode to the same text and merge cleanly into bytes that neither side had.
 */
async function binaryChangedOnBothSides(fs: FileSystem, walked: WalkedFile[]): Promise<string[]> {
  const gitFs = createGitFs(fs)
  const files: string[] = []
  for (const { filepath, base, ours, theirs } of walked) {
    if (!ours || !theirs || ours === theirs || ours === base || theirs === base) continue
    const versions = await Promise.all([ours, theirs].map((oid) => git.readBlob({ fs: gitFs, dir: "/", oid })))
    if (versions.some(({ blob }) => isBinary(blob))) files.push(filepath)
  }
  return files
}

/**
 * The blob a file settles to when the merge didn't conflict on it (null: deleted), or "text" when both sides changed
 * it and isomorphic-git merged the two.
 */
function cleanSettlement(file: WalkedFile): string | null | "text" {
  if (file.ours === file.theirs || file.theirs === file.base) return file.ours
  if (file.ours === file.base) return file.theirs
  return "text"
}

/**
 * A conflicted merge makes isomorphic-git write every file of the merged tree back as text, which corrupts binary
 * files neither side touched, and it never removes a file the live store deleted. This puts each file the merge
 * settled without a conflict back to the exact bytes git holds, and the surviving side of a one-side deletion too.
 * Files both sides changed without a conflict keep the text merge's result; none of them is binary, which
 * `mergePublished` checks first.
 */
async function restoreSettledFiles(fs: FileSystem, walked: WalkedFile[], conflicts: ConflictSets): Promise<void> {
  const gitFs = createGitFs(fs)
  const marked = new Set(conflicts.files)
  const deletedByDraft = new Set(conflicts.deletedByDraft)
  const deletedByLive = new Set(conflicts.deletedByLive)
  for (const file of walked) {
    if (marked.has(file.filepath)) continue
    const settled = deletedByDraft.has(file.filepath)
      ? file.theirs
      : deletedByLive.has(file.filepath)
        ? file.ours
        : cleanSettlement(file)
    if (settled === "text") continue
    const path = `/${file.filepath}`
    if (settled === null) {
      await fs.rm(path, { force: true })
      continue
    }
    const current = await fs.readFileBytes(path).catch(() => null)
    if (current && (await git.hashBlob({ object: current })).oid === settled) continue
    const { blob } = await git.readBlob({ fs: gitFs, dir: "/", oid: settled })
    await fs.mkdir(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true })
    await fs.writeFileBytes(path, blob)
  }
}

/**
 * A conflicted merge leaves the index at the draft's version, and git trusts an index entry whose size and second
 * match the file: a same-size change written in the same second would look unchanged, so the merge commit would keep
 * the draft's version and a cancel wouldn't put it back. This stages every file the merge settled to something other
 * than the draft's version. Conflicted files keep the index entries isomorphic-git left.
 */
async function stageSettledFiles(
  fs: FileSystem,
  walked: WalkedFile[],
  conflicts: ConflictSets,
  isReserved: (path: string) => boolean,
): Promise<void> {
  const gitFs = createGitFs(fs)
  const conflicted = new Set([...conflicts.files, ...conflicts.deletedByDraft, ...conflicts.deletedByLive])
  for (const file of walked) {
    if (conflicted.has(file.filepath) || isReserved(`/${file.filepath}`)) continue
    const settled = cleanSettlement(file)
    if (settled === file.ours) continue
    if (settled === null) await git.remove({ fs: gitFs, dir: "/", filepath: file.filepath })
    else await git.add({ fs: gitFs, dir: "/", filepath: file.filepath })
  }
}

/**
 * Merges the published commit into the checked-out draft `branch`. The working tree must be saved first (callers
 * commit before merging), since the merge and a later cancel treat anything untracked as the merge's own. When both
 * sides changed the same binary file it merges nothing and says so, as git can't combine them. On a text conflict,
 * the markers stay in the working tree and the branch stays where it was, for the AI to resolve.
 */
export async function mergePublished(
  fs: FileSystem,
  branch: string,
  published: string,
  author: GitAuthor,
  isReserved: (path: string) => boolean,
): Promise<MergeOutcome> {
  const ours = await branchTip(fs, branch)
  if (!ours) throw new Error(`Draft branch "${branch}" has no commits`)
  if (await includes(fs, ours, published)) return { result: "up-to-date" }
  const walked = await walkThreeWays(fs, ours, published)
  const binary = await binaryChangedOnBothSides(fs, walked)
  if (binary.length > 0) return { result: "binary-changed-on-both-sides", files: binary }
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
    const conflicts = conflictSets(error)
    if (conflicts === null) throw error
    await restoreSettledFiles(fs, walked, conflicts)
    await stageSettledFiles(fs, walked, conflicts, isReserved)
    return { result: "conflicts", ...conflicts, ours }
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

/**
 * Puts the draft back at its tip from before the merge, working tree included. Files the live store added and files
 * created while resolving are untracked, so the checkout leaves them; they go too, except reserved paths.
 */
export async function cancelMerge(fs: FileSystem, merge: MergeState, isReserved: (path: string) => boolean): Promise<void> {
  const gitFs = createGitFs(fs)
  await git.writeRef({ fs: gitFs, dir: "/", ref: `refs/heads/${merge.branch}`, value: merge.ours, force: true })
  await git.checkout({ fs: gitFs, dir: "/", ref: merge.branch, force: true })
  for (const [filepath, head, , stage] of await git.statusMatrix({ fs: gitFs, dir: "/" })) {
    if (head === 0 && stage === 0 && !isReserved(`/${filepath}`)) await fs.rm(`/${filepath}`, { force: true })
  }
}
