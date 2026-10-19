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
  type MergeOutcome,
  type MergeState,
} from "../src/space/draft-git"

const AUTHOR = { name: "Test", email: "test@vibesdk.local" }
const isReserved = (p: string) => p === "/.afs" || p.startsWith("/.afs/") || p === "/.git" || p.startsWith("/.git/")

/** One file change in a commit: new content as text or bytes, or null to delete the file. */
interface Edit {
  path: string
  text: string | Uint8Array | null
}

/** Not valid UTF-8, so a round trip through text corrupts it. */
const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80])
const BANNER_V1 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xfe, 0xff, 0x00, 0x81])
const BANNER_V2 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xc0, 0xc1, 0x00, 0x82, 0xf5])
const SEAL_V1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xfd, 0x00, 0x90])
const SEAL_V2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xfc, 0x00, 0x91, 0xa0])

/**
 * Main and a quick fix that both start at `base`; the fix is what's published. `base` adds files to the first version.
 */
async function quickFixRepo(fix: Edit | Edit[], baseFiles: Edit[] = []) {
  const fs = withErrorCodes(new InMemoryFs())
  const g = createGit(fs)
  await g.init({ defaultBranch: "main" })
  const commitEdits = async (edits: Edit[], message: string) => {
    for (const { path, text } of edits) {
      if (text === null) await fs.rm(path)
      else if (typeof text === "string") await fs.writeFile(path, text)
      else await fs.writeFileBytes(path, text)
    }
    // add(".") trusts a file's size and mtime to the second, so a same-length edit made right after a commit goes
    // unstaged; staging each edited path directly always hashes it.
    for (const { path, text } of edits) if (text !== null) await g.add({ filepath: path.slice(1) })
    await g.add({ filepath: "." })
    return (await g.commit({ message, author: AUTHOR })).oid
  }
  const commit = (path: string, text: string, message: string) => commitEdits([{ path, text }], message)
  await fs.writeFile("/about.html", "Our tea is grown wiht care.\n")
  const base = await commitEdits([{ path: "/index.html", text: "<h1>Northwind</h1>\n" }, ...baseFiles], "first version")
  await createDraftBranch(fs, "draft-fix00001", base)
  await g.checkout({ ref: "draft-fix00001", force: true })
  const published = await commitEdits(Array.isArray(fix) ? fix : [fix], "Fix the typo on the about page")
  await g.checkout({ ref: "main", force: true })
  return { fs, g, commit, commitEdits, base, published }
}

const bytes = (data: Uint8Array) => Array.from(data)

function conflictsOf(outcome: MergeOutcome) {
  if (outcome.result !== "conflicts") throw new Error(`expected conflicts, got ${outcome.result}`)
  return outcome
}

function mergeStateOf(outcome: ReturnType<typeof conflictsOf>, theirs: string): MergeState {
  return {
    draftId: "main",
    branch: "main",
    ours: outcome.ours,
    theirs,
    files: outcome.files,
    deletedByDraft: outcome.deletedByDraft,
    deletedByLive: outcome.deletedByLive,
    merged: null,
  }
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
    expect(outcome).toEqual({ result: "conflicts", files: ["about.html"], deletedByDraft: [], deletedByLive: [], ours })
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await filesWithConflictMarkers(fs, ["about.html"])).toEqual(["about.html"])
    expect(await liveChangeMessages(fs, ours, published)).toEqual(["Fix the typo on the about page"])
  })
})

describe("a conflicted merge", () => {
  const liveFix: Edit = { path: "/about.html", text: "Our tea is grown with care.\n" }
  const rewrite = "Our teas are grown wiht love.\n"

  it("keeps binary files as they were: untouched, changed only by the live side, changed only by the draft", async () => {
    const { fs, commitEdits, published } = await quickFixRepo(
      [liveFix, { path: "/banner.gif", text: BANNER_V2 }],
      [
        { path: "/logo.png", text: LOGO },
        { path: "/banner.gif", text: BANNER_V1 },
        { path: "/seal.png", text: SEAL_V1 },
      ],
    )
    const ours = await commitEdits([{ path: "/about.html", text: rewrite }, { path: "/seal.png", text: SEAL_V2 }], "Rewrite the about page")
    const merge = mergeStateOf(conflictsOf(await mergePublished(fs, "main", published, AUTHOR)), published)
    expect(merge.ours).toBe(ours)
    expect(bytes(await fs.readFileBytes("/logo.png"))).toEqual(bytes(LOGO))
    expect(bytes(await fs.readFileBytes("/banner.gif"))).toEqual(bytes(BANNER_V2))
    expect(bytes(await fs.readFileBytes("/seal.png"))).toEqual(bytes(SEAL_V2))

    await fs.writeFile("/about.html", "Our teas are grown with love.\n")
    const resolved = await commitMergeResolution(fs, merge, AUTHOR, isReserved)
    if ("error" in resolved) throw new Error(resolved.error)
    const gitFs = createGitFs(fs)
    for (const [filepath, expected] of [["logo.png", LOGO], ["banner.gif", BANNER_V2], ["seal.png", SEAL_V2]] as const) {
      const { blob } = await git.readBlob({ fs: gitFs, dir: "/", oid: resolved.commit, filepath })
      expect(bytes(blob)).toEqual(bytes(expected))
    }
  })

  it("drops a file the live side deleted from the working tree, as a clean merge would", async () => {
    const { fs, commit, published } = await quickFixRepo(
      [liveFix, { path: "/old.html", text: null }],
      [{ path: "/old.html", text: "Old page.\n" }],
    )
    await commit("/about.html", rewrite, "Rewrite the about page")
    conflictsOf(await mergePublished(fs, "main", published, AUTHOR))
    expect(await fs.exists("/old.html")).toBe(false)
  })

  it("reports a file the draft deleted and the live side changed, holding the live version", async () => {
    const { fs, g, published } = await quickFixRepo(liveFix)
    await fs.rm("/about.html")
    await g.add({ filepath: "." })
    const ours = (await g.commit({ message: "Remove the about page", author: AUTHOR })).oid
    const outcome = await mergePublished(fs, "main", published, AUTHOR)
    expect(outcome).toEqual({ result: "conflicts", files: [], deletedByDraft: ["about.html"], deletedByLive: [], ours })
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await fs.readFile("/about.html")).toBe("Our tea is grown with care.\n")
  })

  it("reports a file the live side deleted and the draft changed, holding the draft version", async () => {
    const { fs, commit, published } = await quickFixRepo({ path: "/about.html", text: null })
    const ours = await commit("/about.html", rewrite, "Rewrite the about page")
    const outcome = await mergePublished(fs, "main", published, AUTHOR)
    expect(outcome).toEqual({ result: "conflicts", files: [], deletedByDraft: [], deletedByLive: ["about.html"], ours })
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await fs.readFile("/about.html")).toBe(rewrite)
  })

  it("keeps the surviving side of a deleted file as bytes", async () => {
    const { fs, g, published } = await quickFixRepo({ path: "/banner.gif", text: BANNER_V2 }, [{ path: "/banner.gif", text: BANNER_V1 }])
    await fs.rm("/banner.gif")
    await g.add({ filepath: "." })
    await g.commit({ message: "Remove the banner", author: AUTHOR })
    const outcome = conflictsOf(await mergePublished(fs, "main", published, AUTHOR))
    expect(outcome.deletedByDraft).toEqual(["banner.gif"])
    expect(bytes(await fs.readFileBytes("/banner.gif"))).toEqual(bytes(BANNER_V2))
  })

  it("commits the merge once the AI has settled a file the draft deleted", async () => {
    const { fs, g, published } = await quickFixRepo(liveFix)
    await fs.rm("/about.html")
    await g.add({ filepath: "." })
    const ours = (await g.commit({ message: "Remove the about page", author: AUTHOR })).oid
    const merge = mergeStateOf(conflictsOf(await mergePublished(fs, "main", published, AUTHOR)), published)
    await fs.rm("/about.html")
    const resolved = await commitMergeResolution(fs, merge, AUTHOR, isReserved)
    if ("error" in resolved) throw new Error(resolved.error)
    const gitFs = createGitFs(fs)
    expect((await git.readCommit({ fs: gitFs, dir: "/", oid: resolved.commit })).commit.parent).toEqual([ours, published])
    expect(await git.listFiles({ fs: gitFs, dir: "/", ref: resolved.commit })).toEqual(["index.html"])
  })
})

describe("resolving and cancelling", () => {
  async function conflicted() {
    const setup = await quickFixRepo({ path: "/about.html", text: "Our tea is grown with care.\n" })
    await setup.fs.writeFile("/shipping.html", "Free shipping over $50.\n")
    const ours = await setup.commit("/about.html", "Our teas are grown wiht love.\n", "Rewrite the about page")
    const merge = mergeStateOf(conflictsOf(await mergePublished(setup.fs, "main", setup.published, AUTHOR)), setup.published)
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
    await cancelMerge(fs, merge, isReserved)
    expect(await branchTip(fs, "main")).toBe(ours)
    expect(await fs.readFile("/about.html")).toBe("Our teas are grown wiht love.\n")
    expect(await fs.readFile("/shipping.html")).toBe("Free shipping over $50.\n")
  })

  it("clears the files the live side added and the AI created when cancelling, but keeps reserved ones", async () => {
    const setup = await quickFixRepo(
      [{ path: "/about.html", text: "Our tea is grown with care.\n" }, { path: "/returns.html", text: "Returns within 30 days.\n" }],
      [{ path: "/logo.png", text: LOGO }],
    )
    const ours = await setup.commit("/about.html", "Our teas are grown wiht love.\n", "Rewrite the about page")
    const merge = mergeStateOf(conflictsOf(await mergePublished(setup.fs, "main", setup.published, AUTHOR)), setup.published)
    expect(await setup.fs.exists("/returns.html")).toBe(true)
    await setup.fs.writeFile("/broken-import.js", "import './missing.js'\n")
    await setup.fs.mkdir("/.afs", { recursive: true })
    await setup.fs.writeFile("/.afs/state.json", "{}")

    await cancelMerge(setup.fs, merge, isReserved)
    expect(await branchTip(setup.fs, "main")).toBe(ours)
    expect(await setup.fs.exists("/returns.html")).toBe(false)
    expect(await setup.fs.exists("/broken-import.js")).toBe(false)
    expect(await setup.fs.exists("/.afs/state.json")).toBe(true)
    expect(await setup.fs.readFile("/about.html")).toBe("Our teas are grown wiht love.\n")
    expect(bytes(await setup.fs.readFileBytes("/logo.png"))).toEqual(bytes(LOGO))
  })

  it("cancels a committed merge back to the draft's last version, dropping files only the live side added", async () => {
    const setup = await quickFixRepo({ path: "/returns.html", text: "Returns within 30 days.\n" })
    const ours = await setup.commit("/index.html", "<h1>Northwind Tea</h1>\n", "Redesign the home page")
    const outcome = await mergePublished(setup.fs, "main", setup.published, AUTHOR)
    if (outcome.result !== "merged") throw new Error("expected a clean merge")
    expect(await setup.fs.exists("/returns.html")).toBe(true)
    await cancelMerge(
      setup.fs,
      { draftId: "main", branch: "main", ours, theirs: setup.published, files: [], deletedByDraft: [], deletedByLive: [], merged: outcome.commit },
      isReserved,
    )
    expect(await branchTip(setup.fs, "main")).toBe(ours)
    expect(await setup.fs.exists("/returns.html")).toBe(false)
    expect(await setup.fs.readFile("/index.html")).toBe("<h1>Northwind Tea</h1>\n")
  })
})
