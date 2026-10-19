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
    const space = methodBody(spaceDo, "private async initializeSpace(")
    expect(space).toContain("this.git.init({ defaultBranch: this.activeBranchAtStart })")
    expect(space).toContain("this.ctx.storage.sql.exec(DRAFTS_TABLE_SQL)")
    expect(space.indexOf("this.ctx.storage.sql.exec(DEPLOYMENTS_TABLE_SQL)")).toBeLessThan(space.indexOf("migrateDeploymentsTable(this.ctx.storage.sql)"))
    expect(space).not.toContain("ALTER TABLE")
    expect(backend).toContain("baseBranch: string = ARTIFACTS_BASE_BRANCH")
    expect(backend).toMatch(/createArtifactsBaseSource\(\{\s*overlay,\s*branch: baseBranch,/)
  })

  it("keeps the checked-out draft's checkpoint when another branch is pushed", () => {
    const push = methodBody(backend, "async push(branch: string)")
    expect(push).toContain("(await this.checkedOutBranch()) === branch")
    expect(push.indexOf("checkedOutBranch")).toBeLessThan(push.indexOf("this.resetCheckpointAfterPush()"))
  })

  const lockedMethods = [
    "async listDrafts(",
    "async createDraft(",
    "async deleteDraft(",
    "async activateDraft(",
    "async publishDraft(",
    "async bringInLiveChanges(",
    "async cancelBringingInLiveChanges(",
    "async rollbackToCommit(",
  ]

  it("runs draft operations one at a time and makes file writes and commits wait for them", () => {
    for (const signature of lockedMethods) {
      expect(methodBody(spaceDo, signature), signature).toContain("this.withDraftLock(")
    }
    for (const signature of ["async writeFile(", "async editFile(", "async deleteFile(", "async rm(", "async patch(", "async gitCommit(", "async importFiles("]) {
      expect(methodBody(spaceDo, signature), signature).toContain("await this.draftOp")
    }
  })

  it("never waits for the draft lock from inside it", () => {
    const waiting = ["this.gitCommit(", "this.importFiles(", "this.writeFile(", "this.editFile(", "this.deleteFile(", "this.rm(", "this.patch("]
    for (const signature of lockedMethods) {
      const body = methodBody(spaceDo, signature)
      for (const call of waiting) expect(body, `${signature} calls ${call}`).not.toContain(call)
    }
    for (const signature of ["private async commitWorkingTree(", "private async commitAndMirror(", "async deploy(branch: string)", "async undeploy("]) {
      expect(methodBody(spaceDo, signature), signature).not.toContain("this.draftOp")
    }
  })

  it("rolls back under the lock, committing without waiting for it, and refuses mid-merge", () => {
    const rollback = methodBody(spaceDo, "async rollbackToCommit(")
    expect(rollback).toContain("if (await this.mergeState()) return { error: MERGE_IN_PROGRESS }")
    expect(rollback).toContain("this.commitAndMirror(`rollback: restore ${target.oid.slice(0, 8)}`)")
    expect(rollback.indexOf("this.commitAndMirror(")).toBeLessThan(rollback.indexOf("this.deploy(branch)"))
  })

  it("leaves no draft behind when its start can't be loaded or saved", () => {
    const create = methodBody(spaceDo, "async createDraft(")
    const start = create.indexOf("await createDraftBranch(this.fs, added.draft.branch, start)")
    const refusal = create.indexOf("Couldn't load the version to start from. Try again.")
    expect(start).toBeGreaterThan(-1)
    const failedStart = create.slice(start, refusal)
    expect(failedStart).toContain("} catch {")
    expect(failedStart).toContain("removeDraftRecord(sql, added.draft.id)")
    expect(create.slice(refusal)).toContain("removeDraftRecord(sql, added.draft.id)")
  })

  it("fetches the live store's version before computing any draft's state", () => {
    const list = methodBody(spaceDo, "async listDrafts(")
    expect(list.indexOf("await this.ensurePublishedObjects()")).toBeGreaterThan(-1)
    expect(list.indexOf("await this.ensurePublishedObjects()")).toBeLessThan(list.indexOf("draftGitState("))
    expect(list).not.toContain("publishedVersion(")
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
    expect(methodBody(spaceDo, "async gitCommit(")).toContain("this.commitAndMirror(message, author)")
    expect(methodBody(spaceDo, "private async commitAndMirror(")).toContain("!(await this.mergeState())")
    const deploy = methodBody(spaceDo, "async deploy(branch: string)")
    expect(deploy).toContain("mergeCommitPending(this.fs, merge)")
    expect(deploy.indexOf("this.ctx.storage.delete(MERGE_STATE_KEY)")).toBeLessThan(deploy.indexOf("await this.backend.push(branch)"))
  })

  it("mirrors the draft's saved work before merging, so a cancel after a cold start finds its version", () => {
    const bringIn = methodBody(spaceDo, "async bringInLiveChanges(")
    const save = bringIn.indexOf("this.commitWorkingTree(\"Saved before bringing in the live store's changes\")")
    const push = bringIn.indexOf("this.backend.push(draft.branch)")
    expect(save).toBeGreaterThan(-1)
    expect(save).toBeLessThan(push)
    expect(push).toBeLessThan(bringIn.indexOf("mergePublished("))
  })

  it("cancels a merge back to the draft's version, removing files the merge left untracked", () => {
    const cancel = methodBody(spaceDo, "async cancelBringingInLiveChanges(")
    expect(cancel).toContain("cancelMerge(this.fs, merge, isReservedPath)")
    expect(cancel.indexOf("cancelMerge(")).toBeLessThan(cancel.indexOf("this.ctx.storage.delete(MERGE_STATE_KEY)"))
  })

  it("saves the checkpoint of unsaved work after a merge and after a cancel, so a restart can't undo either", () => {
    const bringIn = methodBody(spaceDo, "async bringInLiveChanges(")
    const conflicts = bringIn.slice(bringIn.indexOf('if (outcome.result === "conflicts")'), bringIn.indexOf('result: "conflicts",'))
    expect(conflicts.indexOf("await this.flushCheckpoint()")).toBeGreaterThan(conflicts.indexOf("this.ctx.storage.put(MERGE_STATE_KEY"))
    const merged = bringIn.slice(bringIn.lastIndexOf("this.ctx.storage.put(MERGE_STATE_KEY"))
    expect(merged.indexOf("await this.flushCheckpoint()")).toBeGreaterThan(-1)
    expect(merged.indexOf("await this.flushCheckpoint()")).toBeLessThan(merged.indexOf("this.deploy(draft.branch)"))
    const cancel = methodBody(spaceDo, "async cancelBringingInLiveChanges(")
    const flush = cancel.indexOf("await this.flushCheckpoint()")
    expect(flush).toBeGreaterThan(cancel.indexOf("cancelMerge("))
    expect(flush).toBeLessThan(cancel.indexOf("this.ctx.storage.delete(MERGE_STATE_KEY)"))
  })

  it("publishes a draft only after its latest version is deployed, never mid-merge", () => {
    const publish = methodBody(spaceDo, "async publishDraft(")
    expect(publish).toContain("Wait for the AI to finish bringing in the live store's changes.")
    expect(publish.indexOf("await this.deploy(draft.branch)")).toBeLessThan(publish.indexOf("publishLiveDeployment(sql, Date.now(), draft.branch)"))
    expect(spaceDo).not.toContain("async publishLive(")
  })
})
