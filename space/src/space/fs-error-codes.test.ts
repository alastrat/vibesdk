import { InMemoryFs, type FileSystem, type FsStat } from "@cloudflare/shell"
import { createGit } from "@cloudflare/shell/git"
import { version as isomorphicGitVersion, type PromiseFsClient } from "isomorphic-git"
import { describe, expect, it } from "vitest"
import { withErrorCodes } from "./fs-error-codes"
import { createGitFs, resolveHead } from "./git-objects"

const AUTHOR = { name: "Estori Test", email: "test@estori.dev" }

/** The lockfile's isomorphic-git 1.38 skipped uncoded mkdir errors; 1.42 rethrows them. */
function rethrowsUncodedMkdirErrors(): boolean {
  const [major = 0, minor = 0] = isomorphicGitVersion().split(".").map(Number)
  return major > 1 || (major === 1 && minor >= 42)
}

/** The error a call throws or rejects with. */
async function failureOf(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  throw new Error("Expected the call to fail")
}

function gitFsPromises(fs: FileSystem): PromiseFsClient["promises"] {
  const client = createGitFs(fs)
  if (!("promises" in client)) throw new Error("Expected a promise-based git fs client")
  return client.promises
}

/** Its private field makes every method fail unless it runs against the real instance. */
class ProbeFs extends InMemoryFs {
  readonly label = "probe"
  #calls = 0

  get calls(): number {
    return this.#calls
  }

  throwNow(error: Error): never {
    this.#calls++
    throw error
  }

  async rejectWith(error: Error): Promise<never> {
    this.#calls++
    throw error
  }

  echo(value: string): string {
    this.#calls++
    return value
  }
}

class UnavailableFs extends InMemoryFs {
  override async stat(): Promise<FsStat> {
    throw new Error("storage unavailable")
  }
}

describe("withErrorCodes", () => {
  it("is needed because shell filesystem errors carry no code", async () => {
    const error = await failureOf(() => new InMemoryFs().readFile("/missing.txt"))
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toHaveProperty("code")
  })

  it("codes an uncoded ENOENT rejection from its message prefix", async () => {
    const error = await failureOf(() => withErrorCodes(new InMemoryFs()).readFile("/missing.txt"))
    expect(error).toHaveProperty("code", "ENOENT")
    expect(error).toHaveProperty("message", "ENOENT: no such file or directory, open '/missing.txt'")
  })

  it("codes an uncoded EEXIST rejection as EEXIST", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    await fs.mkdir("/src")
    expect(await failureOf(() => fs.mkdir("/src"))).toHaveProperty("code", "EEXIST")
  })

  it("codes errors thrown synchronously", async () => {
    const fs = withErrorCodes(new InMemoryFs())
    expect(await failureOf(() => fs.mkdirSync("/missing/child"))).toHaveProperty("code", "ENOENT")
  })

  it("rethrows the original error instance", async () => {
    const fs = withErrorCodes(new ProbeFs())
    const rejected = new Error("ENOTDIR: not a directory, scandir '/file'")
    const thrown = new Error("ENOTEMPTY: directory not empty, rm '/src'")
    expect(await failureOf(() => fs.rejectWith(rejected))).toBe(rejected)
    expect(await failureOf(() => fs.throwNow(thrown))).toBe(thrown)
    expect(rejected).toHaveProperty("code", "ENOTDIR")
    expect(thrown).toHaveProperty("code", "ENOTEMPTY")
  })

  it("keeps a code the error already has", async () => {
    const fs = withErrorCodes(new ProbeFs())
    const coded = () => Object.assign(new Error("ENOENT: no such file"), { code: "EACCES" })
    expect(await failureOf(() => fs.rejectWith(coded()))).toHaveProperty("code", "EACCES")
    expect(await failureOf(() => fs.throwNow(coded()))).toHaveProperty("code", "EACCES")
  })

  it("leaves errors without a leading code uncoded", async () => {
    const fs = withErrorCodes(new ProbeFs())
    expect(await failureOf(() => fs.rejectWith(new Error("storage unavailable")))).not.toHaveProperty("code")
    expect(await failureOf(() => fs.throwNow(new Error("read failed: ENOENT: x")))).not.toHaveProperty("code")
  })

  it("passes return values, properties and the instance binding through", async () => {
    const probe = new ProbeFs()
    const fs = withErrorCodes(probe)
    expect(fs.label).toBe("probe")
    expect(fs.echo("value")).toBe("value")
    await fs.writeFile("/note.txt", "hello")
    expect(await fs.readFile("/note.txt")).toBe("hello")
    expect(fs.calls).toBe(1)
    expect(probe.calls).toBe(1)
  })
})

describe("createGitFs error codes", () => {
  it("codes an uncoded EEXIST from mkdir as EEXIST", async () => {
    const promises = gitFsPromises(new InMemoryFs())
    await promises.mkdir("/src")
    expect(await failureOf(() => promises.mkdir("/src"))).toHaveProperty("code", "EEXIST")
  })

  it("codes readFile, readdir and rmdir errors from their message prefix", async () => {
    const fs = new InMemoryFs()
    await fs.writeFile("/src/index.ts", "export {}\n")
    const promises = gitFsPromises(fs)
    expect(await failureOf(() => promises.readFile("/src"))).toHaveProperty("code", "EISDIR")
    expect(await failureOf(() => promises.readdir("/src/index.ts"))).toHaveProperty("code", "ENOTDIR")
    expect(await failureOf(() => promises.readdir("/missing"))).toHaveProperty("code", "ENOENT")
    expect(await failureOf(() => promises.rmdir("/src"))).toHaveProperty("code", "ENOTEMPTY")
  })

  it("falls back to ENOENT when the message has no code prefix", async () => {
    const promises = gitFsPromises(new UnavailableFs())
    expect(await failureOf(() => promises.stat("/index.ts"))).toHaveProperty("code", "ENOENT")
  })
})

describe("git on a shell filesystem", () => {
  it.runIf(rethrowsUncodedMkdirErrors())("cannot init while filesystem errors are uncoded", async () => {
    const error = await failureOf(() => createGit(new InMemoryFs()).init({ defaultBranch: "main" }))
    expect(error).toHaveProperty("message", "ENOENT: no such file or directory, mkdir '/.git/hooks'")
  })

  it("inits and commits once filesystem errors carry codes", async () => {
    const fs = new InMemoryFs()
    const git = createGit(withErrorCodes(fs))
    await git.init({ defaultBranch: "main" })
    expect(await fs.exists("/.git/HEAD")).toBe(true)

    await fs.writeFile("/index.ts", "export const ready = true\n")
    await git.add({ filepath: "index.ts" })
    const { oid } = await git.commit({ message: "Initial commit", author: AUTHOR })
    expect(await resolveHead(fs, "main")).toBe(oid)
  })
})
