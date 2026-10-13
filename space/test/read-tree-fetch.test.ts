/**
 * Guard for SpaceDO.readTreeAtCommit: the Artifacts base must be fetched
 * before the commit's tree is read. Without it, a workspace whose startup
 * fetch failed never has the submitted commit's objects locally, and every
 * template submission from it fails.
 */
import { describe, it, expect } from "vitest"

const sources = import.meta.glob<string>(["/space/src/space/durable-object.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
})

function methodBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  if (start === -1) throw new Error(`Method not found: ${signature}`)
  const end = source.indexOf("\n  }\n", start)
  return source.slice(start, end)
}

describe("SpaceDO.readTreeAtCommit", () => {
  const source = sources["/space/src/space/durable-object.ts"]
  if (source === undefined) throw new Error("Source not found: durable-object.ts")
  const body = methodBody(source, "async readTreeAtCommit(")

  it("fetches the current branch, best-effort, before reading the commit", () => {
    expect(body).toContain('const branch = (await this.currentBranch()) ?? "main"')
    const fetch = body.indexOf("await this.backend.fetch(branch)")
    expect(fetch).toBeGreaterThan(-1)
    expect(fetch).toBeLessThan(body.indexOf("} catch {"))
    expect(body.indexOf("} catch {")).toBeLessThan(body.indexOf("readCommitFiles(this.fs, commit)"))
  })
})
