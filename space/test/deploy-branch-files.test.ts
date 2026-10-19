/**
 * A deploy reads the branch's last commit from git objects and never checks the branch out. Publishing deploys any
 * draft the seller picks, so a checkout would move the workspace off the draft being edited and drop its unsaved work;
 * and a deploy while the AI resolves a merge would throw the resolution away.
 */
import { describe, expect, it } from "vitest"
import * as git from "isomorphic-git"
import { InMemoryFs } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import { createGitFs } from "../src/space/git-objects"
import { withErrorCodes } from "../src/space/fs-error-codes"
import { readBranchFiles } from "../src/space/deploy-engine"
import { createDraftBranch } from "../src/space/draft-git"

const AUTHOR = { name: "Test", email: "test@vibesdk.local" }

async function repo() {
  const fs = withErrorCodes(new InMemoryFs())
  const g = createGit(fs)
  await g.init({ defaultBranch: "main" })
  const commit = async (files: Record<string, string>, message: string) => {
    for (const [path, text] of Object.entries(files)) await fs.writeFile(path, text)
    await g.add({ filepath: "." })
    return (await g.commit({ message, author: AUTHOR })).oid
  }
  const checkedOut = () => git.currentBranch({ fs: createGitFs(fs), dir: "/" })
  return { fs, g, commit, checkedOut }
}

describe("readBranchFiles", () => {
  it("reads a draft that isn't checked out, leaving the workspace on the draft being edited with its unsaved work", async () => {
    const { fs, g, commit, checkedOut } = await repo()
    const base = await commit({ "/index.html": "main v1", "/logo.txt": "logo" }, "base")
    await createDraftBranch(fs, "draft-aaaa1111", base)
    await g.checkout({ ref: "draft-aaaa1111" })
    const draftTip = await commit({ "/index.html": "spring sale, version 2", "/sale.html": "sale" }, "sale")
    await g.checkout({ ref: "main", force: true })
    await fs.writeFile("/index.html", "main unsaved")
    expect(await fs.exists("/sale.html")).toBe(false)

    const read = await readBranchFiles({ git: g, fs }, "draft-aaaa1111")

    expect(read).toEqual({ commitHash: draftTip, files: { "index.html": "spring sale, version 2", "logo.txt": "logo", "sale.html": "sale" } })
    expect(await checkedOut()).toBe("main")
    expect(await fs.readFile("/index.html")).toBe("main unsaved")
    expect(await fs.exists("/sale.html")).toBe(false)
  })

  it("reads the checked-out draft's last commit and keeps edits made since", async () => {
    const { fs, g, commit, checkedOut } = await repo()
    const tip = await commit({ "/index.html": "main v1" }, "base")
    await fs.writeFile("/index.html", "being resolved")
    await fs.writeFile("/added.html", "added since")

    const read = await readBranchFiles({ git: g, fs }, "main")

    expect(read).toEqual({ commitHash: tip, files: { "index.html": "main v1" } })
    expect(await checkedOut()).toBe("main")
    expect(await fs.readFile("/index.html")).toBe("being resolved")
    expect(await fs.readFile("/added.html")).toBe("added since")
  })
})
