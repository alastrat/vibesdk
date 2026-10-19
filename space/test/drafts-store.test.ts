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
