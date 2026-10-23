import { describe, expect, it } from 'bun:test';
import { parse } from 'acorn';
import { parseDocument, DomUtils } from 'htmlparser2';
import { buildStoreArtifacts } from '../stores';
import { catalogCategories } from '../artifact-types';
import { storeDesigns, type StoreProduct } from './data';
import { createStoreState } from './runtime';
import { buildSnapshot, parseBundle } from '../../../worker/services/templates/snapshot';

describe('deliverable storefront catalog', () => {
 it('delivers the approved 24 storefronts with the right category and pricing split', () => {
  const artifacts = buildStoreArtifacts();
  expect(artifacts).toHaveLength(24);
  expect(new Set(artifacts.map(entry => entry.slug)).size).toBe(24);
  expect(new Set(storeDesigns.map(design => design.art)).size).toBe(24);
  expect(new Set(storeDesigns.map(design => design.layout)).size).toBe(24);
  for (const category of catalogCategories) {
   const entries = artifacts.filter(entry => entry.categorySlug === category.slug);
   expect(entries).toHaveLength(3);
   expect(entries.map(entry => entry.priceCents)).toEqual([0,2900,2900]);
   expect(entries.map(entry => entry.tier)).toEqual(['free','premium','premium']);
   expect(entries.filter(entry => entry.featured)).toHaveLength(1);
  }
 });
 it('ships parseable scripts, local resource links, unique IDs and accessible controls for each store', () => {
  for (const entry of buildStoreArtifacts()) {
   const files = new Map(entry.files.map(file => [file.path,file.content]));
   expect(files.has('README.md')).toBe(true);
   expect(files.has('index.html')).toBe(true);
   expect(() => parse(files.get('store.js')!,{ecmaVersion:2022})).not.toThrow();
   expect(files.get('index.html')).toContain('href="./styles.css"');
   expect(files.get('index.html')).toContain('src="./store.js"');
   expect(entry.previewHtml).not.toMatch(/<script[^>]+src=|<link[^>]+href=|fetch\s*\(|https?:\/\/(?!www.w3.org\/2000\/svg)/);
   expect(entry.previewHtml).not.toMatch(/\son[a-z]+\s*=|javascript:/i);
   expect(entry.coverSvg).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|\shref=/i);
   const document = parseDocument(entry.previewHtml);
   const ids = DomUtils.findAll(node => !!node.attribs.id,document.children).map(node => node.attribs.id);
   expect(new Set(ids).size).toBe(ids.length);
   const productCards = DomUtils.findAll(node => !!node.attribs['data-product'],document.children);
   expect(productCards).toHaveLength(6);
   const dialogs = DomUtils.getElementsByTagName('dialog',document.children);
   expect(dialogs).toHaveLength(2);
   expect(dialogs.every(node => !!node.attribs['aria-labelledby'])).toBe(true);
   expect(files.get('styles.css')).toContain('prefers-reduced-motion:reduce');
   expect(files.get('styles.css')).toContain('@media(max-width:540px)');
   expect(files.get('store.js')).toContain('discover-motion');
   expect(files.get('store.js')).not.toMatch(/localStorage|sessionStorage|XMLHttpRequest|WebSocket|fetch\s*\(/);
  }
 });
 it('survives production source validation and exact byte round trips for every artifact', () => {
  for (const entry of buildStoreArtifacts()) {
   const snapshot = buildSnapshot(entry.files.map(file => ({path:file.path,bytes:new TextEncoder().encode(file.content)})));
   expect(snapshot.ok).toBe(true);
   if (!snapshot.ok) throw new Error(snapshot.error);
   expect(snapshot.fileCount).toBe(7);
   expect(snapshot.totalBytes).toBeLessThan(200_000);
   const restored = parseBundle(JSON.stringify(snapshot.bundle));
   expect(restored).toHaveLength(entry.files.length);
   for (const file of restored) expect(new TextDecoder().decode(file.bytes)).toBe(entry.files.find(original=>original.path===file.path)!.content);
  }
 });
 it('generates reproducible original artifacts with varied compositions and product collections', () => {
  const first=buildStoreArtifacts();
  expect(buildStoreArtifacts()).toEqual(first);
  expect(new Set(first.map(entry=>entry.coverSvg)).size).toBe(24);
  expect(new Set(first.map(entry=>entry.previewHtml)).size).toBe(24);
  expect(new Set(storeDesigns.flatMap(design=>design.products.map(product=>product.name))).size).toBe(144);
 });
});

describe('shipped storefront state model', () => {
 it.each(storeDesigns.map(design=>[design.title,design.products] as const))('%s combines category and text search without changing the cart', (_title: string,products: StoreProduct[]) => {
  const state=createStoreState(products);
  state.add(products[0].id);
  state.setCategory(products[1].category);
  expect(state.visible().every(product=>product.category===products[1].category)).toBe(true);
  state.setSearch(`  ${products[1].name.toUpperCase()}  `);
  expect(state.visible().map(product=>product.id)).toEqual([products[1].id]);
  state.setSearch('nothing-like-this');
  expect(state.visible()).toEqual([]);
  expect(state.count()).toBe(1);
  state.setCategory('All');state.setSearch('');
  expect(state.visible()).toHaveLength(6);
 });
 it('calculates cents exactly, clamps quantities, ignores invalid IDs and removes zero lines', () => {
  const products=storeDesigns[0].products;
  const state=createStoreState(products);
  state.add(products[0].id);state.add(products[0].id);state.add(products[1].id);
  expect(state.count()).toBe(3);
  expect(state.total()).toBe(products[0].price*2+products[1].price);
  state.setQuantity(products[0].id,2.9);expect(state.lines()[0].quantity).toBe(2);
  state.setQuantity(products[0].id,500);expect(state.lines()[0].quantity).toBe(99);
  state.setQuantity(products[0].id,NaN);expect(state.lines()[0].quantity).toBe(99);
  state.add('invalid');expect(state.lines()).toHaveLength(2);
  state.setQuantity(products[0].id,-1);expect(state.lines()).toHaveLength(1);
  state.setQuantity(products[1].id,0);expect(state.count()).toBe(0);expect(state.total()).toBe(0);
 });
});

// A small deterministic DOM boundary verifies shipped event wiring without a browser
// dependency. Visual layout, browser-native focus trapping and touch are reviewed in CUA.
type HarnessEvent = {target?: HarnessElement; source?: object; data?: {type:string;paused:boolean};clientX?:number;clientY?:number};
type Listener = (event: HarnessEvent)=>void;
class HarnessElement {
 dataset: Record<string,string> = {};
 attributes: Record<string,string> = {};
 children: HarnessElement[] = [];
 listeners = new Map<string,Listener>();
 named = new Map<string,HarnessElement>();
 textContent = '';
 className = '';
 type = '';
 id = '';
 value = '';
 hidden = false;
 disabled = false;
 open = false;
 focused = false;
 parentDialog?: HarnessElement;
 setAttribute(name:string,value:string){this.attributes[name]=value;}
 getAttribute(name:string){return this.attributes[name]??null;}
 addEventListener(name:string,listener:Listener){this.listeners.set(name,listener);}
 append(...nodes:HarnessElement[]){this.children.push(...nodes);}
 replaceChildren(...nodes:HarnessElement[]){this.children=nodes;}
 focus(){this.focused=true;}
 showModal(){this.open=true;}
 close(){this.open=false;this.listeners.get('close')?.({});}
 cloneNode(){return new HarnessElement();}
 closest(selector:string){return selector==='dialog'?this.parentDialog:this;}
 querySelector(selector:string):HarnessElement|null {
  if(this.named.has(selector)) return this.named.get(selector)!;
  const id=selector.match(/data-id="([^"]+)"/)?.[1];
  const action=selector.match(/data-action="([^"]+)"/)?.[1];
  const descend=(node:HarnessElement):HarnessElement|undefined=> {
   if((!id||node.dataset.id===id)&&action&&node.dataset.action===action) return node;
   for(const child of node.children){const match=descend(child);if(match)return match;}
   return undefined;
  };
  return descend(this)??null;
 }
 querySelectorAll(){return [];}
 getBoundingClientRect(){return {left:0,top:0,right:600,bottom:600};}
}
function runtimeHarness(script:string,design=storeDesigns[0]) {
 const nodes=new Map<string,HarnessElement>();
 const get=(selector:string)=>{let node=nodes.get(selector);if(!node){node=new HarnessElement();nodes.set(selector,node);}return node;};
 const cards=design.products.map(product=>{const node=new HarnessElement();node.dataset.product=product.id;return node;});
 const filters=['All',...new Set(design.products.map(product=>product.category))].map(category=>{const node=new HarnessElement();node.dataset.action='filter';node.dataset.category=category;return node;});
 const listeners=new Map<string,Listener>();
 const windowListeners=new Map<string,Listener>();
 const parent={};
 const opener=new HarnessElement();
 const document={
  activeElement:opener,documentElement:new HarnessElement(),
  querySelector:get,
  querySelectorAll:(selector:string)=>selector==='[data-product]'?cards:filters,
  createElement:()=>new HarnessElement(),
  addEventListener:(name:string,listener:Listener)=>listeners.set(name,listener),
 };
 for(const key of ['#product-dialog','#cart-dialog']) {
  const dialog=get(key);
  for(const selector of ['#product-title','#product-note','#product-category','#product-price','#product-art','[data-action="add"]','[data-action="close"]']){const node=new HarnessElement();node.parentDialog=dialog;node.dataset.action=selector.includes('close')?'close':'add';dialog.named.set(selector,node);}
  if(key==='#cart-dialog')dialog.children.push(get('#cart-lines'));
 }
 const window={parent,addEventListener:(name:string,listener:Listener)=>windowListeners.set(name,listener)};
 new Function('document','window','Element','HTMLElement',script)(document,window,HarnessElement,HarnessElement);
 const click=(action:string,id?:string)=>{const target=new HarnessElement();target.dataset.action=action;if(id)target.dataset.id=id;listeners.get('click')!({target});return target;};
 return {get,cards,filters,document,parent,windowListeners,opener,click,fire:(target:HarnessElement)=>listeners.get('click')!({target})};
}
describe('generated storefront event integration',()=>{
 it.each(storeDesigns.map((design,index)=>[design.title,index] as const))('%s wires filters, search, details, quantities, summary, and motion messages',(_title: string,index: number)=>{
  const entry=buildStoreArtifacts()[index];
  const design=storeDesigns[index];
  const h=runtimeHarness(entry.files.find(file=>file.path==='store.js')!.content,design);
  const first=design.products[0];
  expect(h.get('#cart-count').textContent).toBe('0');
  h.fire(h.filters[1]);
  expect(h.filters[1].attributes['aria-pressed']).toBe('true');
  expect(h.cards.filter(card=>!card.hidden).length).toBe(design.products.filter(product=>product.category===h.filters[1].dataset.category).length);
  const search=h.get('#product-search');search.value='unfindable';search.listeners.get('input')!({target:search});
  expect(h.get('#empty-results').hidden).toBe(false);
  search.value='';search.listeners.get('input')!({target:search});h.fire(h.filters[0]);
  expect(h.cards.every(card=>!card.hidden)).toBe(true);
  h.click('detail',first.id);
  const detail=h.get('#product-dialog');
  expect(detail.open).toBe(true);
  expect(detail.querySelector('#product-title')!.textContent).toBe(first.name);
  expect(detail.querySelector('[data-action="add"]')!.dataset.id).toBe(first.id);
  detail.close();expect(h.opener.focused).toBe(true);
  h.click('add',first.id);h.click('add',first.id);h.click('cart');
  expect(h.get('#cart-dialog').open).toBe(true);
  expect(h.get('#cart-count').textContent).toBe('2');
  expect(h.get('#cart-lines').children).toHaveLength(1);
  expect(h.get('#cart-total').textContent).toBe(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(first.price*2/100));
  h.click('decrease',first.id);expect(h.get('#cart-count').textContent).toBe('1');
  h.click('summary');expect(h.get('#cart-notice').textContent).toContain('No order was placed');
  h.click('remove',first.id);expect(h.get('#cart-count').textContent).toBe('0');expect(h.get('#cart-empty').hidden).toBe(false);
  h.click('summary');expect(h.get('#cart-notice').textContent).toContain('Your bag is empty');
  h.windowListeners.get('message')!({source:{},data:{type:'discover-motion',paused:true}});
  expect(h.document.documentElement.dataset.motion).toBeUndefined();
  h.windowListeners.get('message')!({source:h.parent,data:{type:'discover-motion',paused:true}});
  expect(h.document.documentElement.dataset.motion).toBe('paused');
  h.windowListeners.get('message')!({source:h.parent,data:{type:'discover-motion',paused:false}});
  expect(h.document.documentElement.dataset.motion).toBe('playing');
 });
});
