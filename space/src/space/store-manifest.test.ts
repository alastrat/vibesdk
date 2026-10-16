import { describe, expect, it } from "vitest"
import { STORE_MANIFEST_PATH, storeManifestOf } from "./store-manifest"

describe("storeManifestOf", () => {
  it("reads the price list at the repository root only", () => {
    expect(STORE_MANIFEST_PATH).toBe("estori-store.json")
    expect(storeManifestOf({ "estori-store.json": "{}", "src/index.ts": "" })).toBe("{}")
    expect(storeManifestOf({ "public/estori-store.json": "{}" })).toBeNull()
  })
})
