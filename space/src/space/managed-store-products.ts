import { parseStoreManifest } from './store-manifest-schema'
/** Private account products are projected into a draft only when the owner publishes. */
export interface ManagedStoreProducts {
  managedProductIds: string[]
  /** Legacy records explicitly adopted from this store's verified published manifest. */
  adoptedProductIds?: string[]
  productsJson: string
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function mergeManagedStoreProducts(text: string | null, update: ManagedStoreProducts): string {
  const original: unknown = text === null ? {version:1,currency:'usd',shipping:{countries:['US'],flatRateCents:0},products:[]} : JSON.parse(text)
  if (!record(original) || original.version !== 1 || original.currency !== 'usd' || !Array.isArray(original.products)) throw new Error('The store product file needs attention before publishing.')
  const incoming: unknown = JSON.parse(update.productsJson)
  if (!Array.isArray(incoming)) throw new Error('Invalid catalog projection.')
  const managed = new Set(update.managedProductIds)
  const adopted = new Set(update.adoptedProductIds ?? [])
  const retained = original.products.filter((product: unknown) => {
    if (!record(product) || typeof product.id !== 'string') throw new Error('The store product file needs attention before publishing.')
    if (!managed.has(product.id)) return true
    if (product.accountProductId !== product.id && !adopted.has(product.id)) throw new Error('A product identifier already belongs to the store. Choose a different identifier.')
    return false
  })
  const productIds = new Set<string>()
  const variantIds = new Set<string>()
  for (const product of incoming) {
    if (!record(product) || typeof product.id !== 'string' || !managed.has(product.id) || product.accountProductId !== product.id) throw new Error('Invalid private catalog product.')
  }
  const products: unknown[] = [...retained,...incoming]
  if (products.length > 200) throw new Error('A store can contain up to 200 products.')
  for (const product of products) {
    if (!record(product) || typeof product.id !== 'string' || productIds.has(product.id) || !Array.isArray(product.variants)) throw new Error('Duplicate or invalid product identifier.')
    productIds.add(product.id)
    for (const variant of product.variants) {
      if (!record(variant) || typeof variant.id !== 'string' || variantIds.has(variant.id)) throw new Error('Duplicate or invalid variant identifier.')
      variantIds.add(variant.id)
    }
  }
  // Validate the exact file that will be written, including retained products and
  // formatted UTF-8 byte size. Checkout consumes this same canonical parser.
  const merged = JSON.stringify({...original, products},null,2)+'\n'
  const validated = parseStoreManifest(merged)
  if (!validated.ok) throw new Error(`The store product file needs attention before publishing: ${validated.errors.join('; ')}`)
  return merged
}
