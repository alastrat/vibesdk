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
    // add(".") trusts a file's size and mtime to the second, so a same-length edit made right after a commit goes
    // unstaged; staging the edited path directly always hashes it.
    await g.add({ filepath: path.slice(1) })
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
