/** The store's price list. Mirrors STORE_MANIFEST_FILE in shared/types/store-payments.ts, which this package can't import. */
export const STORE_MANIFEST_PATH = "estori-store.json"

/** Mirrors NEW_CATALOG_PRODUCTS_ERROR in shared/types/billing.ts, which this package can't import. */
export const NEW_CATALOG_PRODUCTS_ERROR = "This version adds catalog products, which need Pro or Premium."

/** The raw manifest in a deployed tree, or null when the store has none. Validation happens in the worker. */
export function storeManifestOf(files: Record<string, string>): string | null {
  return files[STORE_MANIFEST_PATH] ?? null
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

/** The catalog variants a manifest sells; a manifest that doesn't parse sells none. Validation happens in the worker. */
export function catalogVariantIdsOf(manifest: string | null): Set<string> {
  const ids = new Set<string>()
  if (!manifest) return ids
  let parsed: unknown
  try {
    parsed = JSON.parse(manifest)
  } catch {
    return ids
  }
  const products = fieldOf(parsed, "products")
  if (!Array.isArray(products)) return ids
  for (const product of products) {
    const variants = fieldOf(product, "variants")
    if (!Array.isArray(variants)) continue
    for (const variant of variants) {
      const id = fieldOf(variant, "catalogVariantId")
      if (typeof id === "string") ids.add(id)
    }
  }
  return ids
}

/** The catalog variants the draft's manifest sells that the live one doesn't. */
export function newCatalogVariantIds(draft: string | null, live: string | null): string[] {
  const published = catalogVariantIdsOf(live)
  return [...catalogVariantIdsOf(draft)].filter((id) => !published.has(id))
}
