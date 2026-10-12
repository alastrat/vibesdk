/**
 * Tests for the Artifacts base-source plumbing in git-objects.ts:
 *
 * - `createArtifactsBaseSource.loadSnapshot()` must reconcile an unborn local
 *   branch onto the fetched head. Without this, the first commit after a
 *   SpaceDO cold start is a ROOT commit, and the mirrored force-push replaces
 *   the remote branch — destroying all earlier history (restore points).
 * - A failed fetch must THROW (retryable), not return null (cached forever).
 * - `stageWorkdir()` must stage the tree (incl. deletions) while never
 *   committing reserved bookkeeping paths (`.afs`).
 */
import { describe, it, expect } from "vitest"
import * as git from "isomorphic-git"
import { InMemoryFs, type FileSystem } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import {
  createArtifactsBaseSource,
  createGitFs,
  readCommitFiles,
  resolveHead,
  stageWorkdir,
  walkTreeFiles,
  writeWorkdirFiles,
} from "../src/space/git-objects"
import { withErrorCodes } from "../src/space/fs-error-codes"

const AUTHOR = { name: "Test", email: "test@vibesdk.local" }
const isReserved = (p: string) => p === "/.afs" || p.startsWith("/.afs/") || p === "/.git" || p.startsWith("/.git/")

/** Commit all current workdir files on `main`; returns the commit oid. */
async function commitAll(fs: FileSystem, message: string): Promise<string> {
  const g = createGit(fs)
  await g.add({ filepath: "." })
  const { oid } = await g.commit({ message, author: AUTHOR })
  return oid
}

/**
 * Simulate the cold-start state: the fetched objects + remote-tracking ref are
 * present in `.git`, but the local branch is unborn (fresh `git init`).
 */
async function simulateColdStart(fs: FileSystem, head: string): Promise<void> {
  const gitFs = createGitFs(fs)
  await git.writeRef({ fs: gitFs, dir: "/", ref: "refs/remotes/artifacts/main", value: head, force: true })
  await git.deleteRef({ fs: gitFs, dir: "/", ref: "refs/heads/main" })
}

function baseSource(fs: FileSystem, opts?: { hasRemote?: boolean; fetchOk?: boolean }) {
  return createArtifactsBaseSource({
    overlay: fs,
    branch: "main",
    hasRemote: async () => opts?.hasRemote ?? true,
    fetchBranch: async () => opts?.fetchOk ?? true,
  })
}

describe("createArtifactsBaseSource.loadSnapshot", () => {
  it("reconciles an unborn local branch onto the fetched head", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    const g = createGit(fs)
    await g.init({ defaultBranch: "main" })
    await fs.writeFile("/app.ts", "v1")
    const c1 = await commitAll(fs, "first")

    await simulateColdStart(fs, c1)
    expect(await resolveHead(fs, "refs/heads/main")).toBeNull()

    const snapshot = await baseSource(fs).loadSnapshot()
    expect(snapshot?.head).toBe(c1)
    // The fix: the local branch now points at the fetched head…
    expect(await resolveHead(fs, "refs/heads/main")).toBe(c1)

    // …so the next commit is a DESCENDANT of the remote head, not a root.
    await fs.writeFile("/app.ts", "v2")
    const c2 = await commitAll(fs, "second")
    const log = await g.log({ depth: 2 })
    expect(log[0].oid).toBe(c2)
    expect(log[0].parent).toContain(c1)
  })

  it("never clobbers an existing local branch", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    const g = createGit(fs)
    await g.init({ defaultBranch: "main" })
    await fs.writeFile("/app.ts", "v1")
    const c1 = await commitAll(fs, "first")

    await simulateColdStart(fs, c1)
    await baseSource(fs).loadSnapshot()

    await fs.writeFile("/app.ts", "v2")
    const c2 = await commitAll(fs, "second")

    // A later re-load (e.g. retry after a transient failure) must not reset
    // the local branch back to the older remote head.
    await baseSource(fs).loadSnapshot()
    expect(await resolveHead(fs, "refs/heads/main")).toBe(c2)
  })

  it("returns null without fetching when no remote repo is known", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    await createGit(fs).init({ defaultBranch: "main" })
    let fetches = 0
    const source = createArtifactsBaseSource({
      overlay: fs,
      branch: "main",
      hasRemote: async () => false,
      fetchBranch: async () => {
        fetches++
        return true
      },
    })
    expect(await source.loadSnapshot()).toBeNull()
    expect(fetches).toBe(0)
  })

  it("throws on a failed fetch so the caller can retry later", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    await createGit(fs).init({ defaultBranch: "main" })
    await expect(baseSource(fs, { fetchOk: false }).loadSnapshot()).rejects.toThrow(/fetch failed/i)
  })
})

describe("stageWorkdir", () => {
  it("stages new files but never reserved bookkeeping paths", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    const g = createGit(fs)
    await g.init({ defaultBranch: "main" })
    await fs.mkdir("/.afs", { recursive: true })
    await fs.writeFile("/.afs/state.json", "{}")
    await fs.writeFile("/a.ts", "a")
    await fs.writeFile("/dir/b.ts", "b")

    await stageWorkdir(fs, isReserved)
    const oid = (await g.commit({ message: "c", author: AUTHOR })).oid

    const files = await walkTreeFiles(fs, oid)
    expect([...files.keys()].sort()).toEqual(["/a.ts", "/dir/b.ts"])
  })

  it("stages deletions of tracked files", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    const g = createGit(fs)
    await g.init({ defaultBranch: "main" })
    await fs.writeFile("/keep.ts", "k")
    await fs.writeFile("/gone.ts", "g")
    await commitAll(fs, "first")

    await fs.rm("/gone.ts", { force: true })
    await stageWorkdir(fs, isReserved)
    const oid = (await g.commit({ message: "second", author: AUTHOR })).oid

    const files = await walkTreeFiles(fs, oid)
    expect([...files.keys()]).toEqual(["/keep.ts"])
  })
})

describe("readCommitFiles", () => {
  it("returns the committed bytes, not later working-tree edits", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    await createGit(fs).init({ defaultBranch: "main" })
    const logo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    await fs.writeFile("/index.html", "<h1>v1</h1>")
    await fs.mkdir("/public", { recursive: true })
    await fs.writeFileBytes("/public/logo.png", logo)
    const commit = await commitAll(fs, "first")
    await fs.writeFile("/index.html", "<h1>uncommitted</h1>")

    const files = await readCommitFiles(fs, commit)

    expect(files.map((file) => file.path)).toEqual(["/index.html", "/public/logo.png"])
    expect(new TextDecoder().decode(files[0].bytes)).toBe("<h1>v1</h1>")
    expect(files[1].bytes).toEqual(logo)
  })
})

describe("writeWorkdirFiles", () => {
  it("writes nested files byte-for-byte and skips reserved paths", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    const font = new Uint8Array([0, 1, 2, 250])

    const written = await writeWorkdirFiles(
      fs,
      [
        { path: "src/components/Hero.tsx", bytes: new TextEncoder().encode("export {}") },
        { path: "/fonts/a.woff2", bytes: font },
        { path: ".git/config", bytes: new TextEncoder().encode("[core]") },
      ],
      isReserved,
    )

    expect(written).toBe(2)
    expect(await fs.readFile("/src/components/Hero.tsx")).toBe("export {}")
    expect(await fs.readFileBytes("/fonts/a.woff2")).toEqual(font)
    expect(await fs.exists("/.git/config")).toBe(false)
  })
})
