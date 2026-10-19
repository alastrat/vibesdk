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
