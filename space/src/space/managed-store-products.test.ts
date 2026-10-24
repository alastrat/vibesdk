import { describe, expect, it } from 'vitest'
import { mergeManagedStoreProducts } from './managed-store-products'
const original = JSON.stringify({version:1,currency:'usd',shipping:{countries:['US','CO'],flatRateCents:700},brand:{name:'North Ridge',colors:{background:'#ffffff',text:'#111111',accent:'#0000ff'}},products:[{id:'legacy',name:'Legacy',variants:[{id:'legacy-v',name:'Default',priceCents:1000}]},{id:'managed',accountProductId:'managed',name:'Old',variants:[]}]})
const next = {id:'managed',accountProductId:'managed',name:'New',type:'digital',downloadAssetIds:['asset-a'],variants:[{id:'managed-v',name:'Default',priceCents:1200}]}
describe('private catalog publication projection',()=>{
 it('preserves unmanaged products, shipping and brand while replacing owned records',()=>{
  const result=JSON.parse(mergeManagedStoreProducts(original,{managedProductIds:['managed'],productsJson:JSON.stringify([next])}))
  expect(result.products).toEqual([JSON.parse(original).products[0],next])
  expect(result.shipping).toEqual({countries:['US','CO'],flatRateCents:700})
  expect(result.brand).toEqual(JSON.parse(original).brand)
 })
 it('removes hidden and detached managed products without deleting legacy records',()=>{
  expect(JSON.parse(mergeManagedStoreProducts(original,{managedProductIds:['managed'],productsJson:'[]'})).products.map((p:{id:string})=>p.id)).toEqual(['legacy'])
 })
 it('creates the first manifest with explicit free US shipping',()=>{
  expect(JSON.parse(mergeManagedStoreProducts(null,{managedProductIds:['managed'],productsJson:JSON.stringify([next])}))).toEqual({version:1,currency:'usd',shipping:{countries:['US'],flatRateCents:0},products:[next]})
 })
 it('refuses corrupt existing files and ID collisions rather than silently erasing data',()=>{
  expect(()=>mergeManagedStoreProducts('{',{managedProductIds:['managed'],productsJson:'[]'})).toThrow()
  expect(()=>mergeManagedStoreProducts('{}',{managedProductIds:['managed'],productsJson:'[]'})).toThrow()
  expect(()=>mergeManagedStoreProducts(original,{managedProductIds:['legacy'],productsJson:JSON.stringify([{...next,id:'legacy',accountProductId:'legacy'}])})).toThrow(/already belongs/)
 })
 it('rejects unowned projection IDs and duplicate variant identifiers',()=>{
  expect(()=>mergeManagedStoreProducts(original,{managedProductIds:[],productsJson:JSON.stringify([next])})).toThrow()
  expect(()=>mergeManagedStoreProducts(original,{managedProductIds:['managed'],productsJson:JSON.stringify([{...next,variants:[{id:'legacy-v',priceCents:1200}]}])})).toThrow(/variant/)
 })
})


describe('canonical validation of the final published manifest', () => {
 const manifest = (products: unknown[]) => JSON.stringify({version: 1, currency: 'usd', shipping: {countries: ['US'], flatRateCents: 0}, products})
 const product = (index: number, variants = 30) => ({id: `p-${index}`, accountProductId: `p-${index}`, name: `Product ${index}`, variants: Array.from({length: variants}, (_, v) => ({id: `p-${index}-v-${v}`, name: `Variant ${v}`, priceCents: 1000}))})
 it('rejects aggregate variants beyond the checkout parser limit', () => {
  const products = Array.from({length: 34}, (_, index) => product(index))
  expect(() => mergeManagedStoreProducts(null, {managedProductIds: products.map(p => p.id), productsJson: JSON.stringify(products)})).toThrow(/at most 1000 variants/)
 })
 it('includes retained variants in the aggregate limit', () => {
  const incoming = Array.from({length: 33}, (_, index) => product(index))
  expect(() => mergeManagedStoreProducts(manifest([product(99)]), {managedProductIds: incoming.map(p => p.id), productsJson: JSON.stringify(incoming)})).toThrow(/at most 1000 variants/)
 })
 it('validates exact formatted UTF-8 bytes, not only compact input length', () => {
  const products = Array.from({length: 18}, (_, index) => ({...product(index, 1), description: '漢'.repeat(4900)}))
  const json = JSON.stringify(products)
  expect(json.length).toBeLessThan(256 * 1024)
  expect(() => mergeManagedStoreProducts(null, {managedProductIds: products.map(p => p.id), productsJson: json})).toThrow(/at most 256 KB/)
 })
 it('rejects a compact projection whose formatted published file exceeds the byte limit', () => {
  const products = Array.from({length: 10}, (_, index) => {
   const item = product(index, 100)
   return {...item, variants: item.variants.map(variant => ({...variant, name: 'A'.repeat(180)}))}
  })
  const json = JSON.stringify(products)
  expect(new TextEncoder().encode(json).byteLength).toBeLessThan(256 * 1024)
  expect(() => mergeManagedStoreProducts(null, {managedProductIds: products.map(p => p.id), productsJson: json})).toThrow(/at most 256 KB/)
 })
 it('rejects malformed retained products, shipping, and unknown fields before publication', () => {
  const valid = JSON.parse(manifest([product(99, 1)]))
  for (const invalid of [
   {...valid, shipping: {countries: ['not-a-country'], flatRateCents: 0}},
   {...valid, products: [{...product(99, 1), variants: [{id: 'legacy-v', name: 'Default', priceCents: -1}]}]},
   {...valid, unexpected: 'field'},
  ]) {
   expect(() => mergeManagedStoreProducts(JSON.stringify(invalid), {managedProductIds: [], productsJson: '[]'})).toThrow(/needs attention/)
  }
 })
 it('allows the canonical boundary of 1000 total variants', () => {
  const products = Array.from({length: 10}, (_, index) => product(index, 100))
  const published = mergeManagedStoreProducts(null, {managedProductIds: products.map(p => p.id), productsJson: JSON.stringify(products)})
  expect(JSON.parse(published).products).toHaveLength(10)
 })
})
