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

  it("refuses a draft at a commit that is not local and leaves no branch behind", async () => {
    const { fs } = await repo()
    const missing = "0123456789abcdef0123456789abcdef01234567"
    await expect(createDraftBranch(fs, "draft-cccc3333", missing)).rejects.toThrow()
    expect(await branchTip(fs, "draft-cccc3333")).toBeNull()
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

  it("counts a published commit whose objects are not local as not included", async () => {
    const { fs, commit } = await repo()
    const tip = await commit("/index.html", "v1", "first")
    const missing = "0123456789abcdef0123456789abcdef01234567"
    expect(await draftGitState(fs, tip, missing)).toEqual({ live: false, unpublishedChanges: true, behindLive: true })
  })

  it("says nothing before the first publish or for a draft with no commits", async () => {
    const { fs, commit } = await repo()
    const tip = await commit("/index.html", "v1", "first")
    const none = { live: false, unpublishedChanges: false, behindLive: false }
    expect(await draftGitState(fs, tip, null)).toEqual(none)
    expect(await draftGitState(fs, null, tip)).toEqual(none)
  })
})
