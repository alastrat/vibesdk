/** The store's price list. Mirrors STORE_MANIFEST_FILE in shared/types/store-payments.ts, which this package can't import. */
export const STORE_MANIFEST_PATH = "estori-store.json"

/** The raw manifest in a deployed tree, or null when the store has none. Validation happens in the worker. */
export function storeManifestOf(files: Record<string, string>): string | null {
  return files[STORE_MANIFEST_PATH] ?? null
}
