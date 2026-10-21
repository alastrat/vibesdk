import { describe, expect, it } from "vitest"
import { NEW_CATALOG_PRODUCTS_ERROR, STORE_MANIFEST_PATH, catalogVariantIdsOf, newCatalogVariantIds, storeManifestOf } from "./store-manifest"

describe("storeManifestOf", () => {
  it("reads the price list at the repository root only", () => {
    expect(STORE_MANIFEST_PATH).toBe("estori-store.json")
    expect(storeManifestOf({ "estori-store.json": "{}", "src/index.ts": "" })).toBe("{}")
    expect(storeManifestOf({ "public/estori-store.json": "{}" })).toBeNull()
  })
})

const manifest = (...ids: string[]) =>
  JSON.stringify({ products: [{ id: "lamp", name: "Lamp", variants: ids.map((id, index) => ({ id: `v${index}`, name: "V", priceCents: 1000, catalogVariantId: id })) }, { id: "own", name: "Own", variants: [{ id: "o", name: "O", priceCents: 500 }] }] })

describe("catalog products in a version", () => {
  it("reads the catalog variants, and finds those the draft adds to the live version", () => {
    expect(catalogVariantIdsOf(manifest("cv_a", "cv_b"))).toEqual(new Set(["cv_a", "cv_b"]))
    expect(catalogVariantIdsOf(null)).toEqual(new Set())
    expect(catalogVariantIdsOf("{")).toEqual(new Set())
    expect(newCatalogVariantIds(manifest("cv_a", "cv_c"), manifest("cv_a", "cv_b"))).toEqual(["cv_c"])
    expect(newCatalogVariantIds(manifest("cv_a"), manifest("cv_a", "cv_b"))).toEqual([])
    expect(newCatalogVariantIds(manifest("cv_a"), null)).toEqual(["cv_a"])
    expect(NEW_CATALOG_PRODUCTS_ERROR).toBe("This version adds catalog products, which need Pro or Premium.")
  })
})
