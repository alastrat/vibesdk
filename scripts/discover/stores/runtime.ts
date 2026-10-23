import type { StoreProduct } from './data';
/** Integer cents throughout. The same model is shipped in the standalone demos. */
export function createStoreState(products: StoreProduct[]) {
 const quantities = new Map<string, number>();
 let category = 'All';
 let search = '';
 return {
  setCategory(value: string) { category = value; },
  setSearch(value: string) { search = value.trim().toLowerCase(); },
  visible() { return products.filter(product => (category === 'All' || product.category === category) && `${product.name} ${product.note} ${product.category}`.toLowerCase().includes(search)); },
  setQuantity(id: string, quantity: number) {
   if (!products.some(product => product.id === id) || !Number.isFinite(quantity)) return;
   const bounded = Math.min(99, Math.max(0, Math.floor(quantity)));
   if (bounded === 0) quantities.delete(id); else quantities.set(id, bounded);
  },
  add(id: string) { this.setQuantity(id, (quantities.get(id) || 0) + 1); },
  lines() { return products.filter(product => quantities.has(product.id)).map(product => ({ ...product, quantity: quantities.get(product.id)! })); },
  count() { return [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0); },
  total() { return this.lines().reduce((sum, product) => sum + product.price * product.quantity, 0); },
 };
}
/** No storage, fetch, payment requests or imports: also works in a sandboxed opaque iframe. */
export function mountStore(products: StoreProduct[]) {
 const state = createStoreState(products);
 const money = (cents: number) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',maximumFractionDigits:2}).format(cents / 100);
 const detail = document.querySelector<HTMLDialogElement>('#product-dialog')!;
 const cart = document.querySelector<HTMLDialogElement>('#cart-dialog')!;
 const status = document.querySelector<HTMLElement>('#status')!;
 const lastFocused = new Map<HTMLDialogElement, HTMLElement | null>();
 const announce = (message: string) => { status.textContent = message; };
 const openDialog = (dialog: HTMLDialogElement) => {
  lastFocused.set(dialog, document.activeElement instanceof HTMLElement ? document.activeElement : null);
  dialog.showModal();
 };
 [detail, cart].forEach(dialog => {
  dialog.addEventListener('close', () => { lastFocused.get(dialog)?.focus(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
 });
 const updateCatalog = () => {
  const ids = new Set(state.visible().map(product => product.id));
  document.querySelectorAll<HTMLElement>('[data-product]').forEach(card => { card.hidden = !ids.has(card.dataset.product!); });
  document.querySelector<HTMLElement>('#empty-results')!.hidden = ids.size > 0;
  document.querySelector<HTMLElement>('#result-count')!.textContent = `${ids.size} ${ids.size === 1 ? 'piece' : 'pieces'}`;
  announce(`${ids.size} products shown.`);
 };
 const updateCart = () => {
  document.querySelector<HTMLElement>('#cart-count')!.textContent = String(state.count());
  document.querySelector<HTMLElement>('#cart-total')!.textContent = money(state.total());
  const lines = document.querySelector<HTMLElement>('#cart-lines')!;
  lines.replaceChildren();
  const cartLines = state.lines();
  document.querySelector<HTMLElement>('#cart-empty')!.hidden = cartLines.length > 0;
  cartLines.forEach(product => {
   const row = document.createElement('li'); row.className = 'cart-line';
   const name = document.createElement('strong'); name.textContent = product.name;
   const price = document.createElement('span'); price.textContent = money(product.price * product.quantity); price.className = 'line-price';
   const controls = document.createElement('div'); controls.className = 'quantity-controls';
   const minus = document.createElement('button'); minus.type = 'button'; minus.textContent = '−'; minus.dataset.action = 'decrease'; minus.dataset.id = product.id; minus.setAttribute('aria-label', `Decrease ${product.name} quantity`);
   const quantity = document.createElement('span'); quantity.textContent = String(product.quantity); quantity.setAttribute('aria-label', `Quantity: ${product.quantity}`);
   const plus = document.createElement('button'); plus.type = 'button'; plus.textContent = '+'; plus.dataset.action = 'increase'; plus.dataset.id = product.id; plus.setAttribute('aria-label', `Increase ${product.name} quantity`); plus.disabled = product.quantity >= 99;
   const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.className = 'remove'; remove.dataset.action = 'remove'; remove.dataset.id = product.id; remove.setAttribute('aria-label', `Remove ${product.name}`);
   controls.append(minus, quantity, plus, remove); row.append(name, price, controls); lines.append(row);
  });
 };
 document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id || '';
  const product = products.find(item => item.id === id);
  if (action === 'filter') {
   state.setCategory(button.dataset.category || 'All');
   document.querySelectorAll<HTMLButtonElement>('[data-action="filter"]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
   updateCatalog();
  }
  if (action === 'detail' && product) {
   detail.querySelector<HTMLElement>('#product-title')!.textContent = product.name;
   detail.querySelector<HTMLElement>('#product-note')!.textContent = product.note;
   detail.querySelector<HTMLElement>('#product-category')!.textContent = product.category;
   detail.querySelector<HTMLElement>('#product-price')!.textContent = money(product.price);
   const image = document.querySelector<HTMLElement>(`[data-product="${id}"] .product-image svg`)!;
   detail.querySelector<HTMLElement>('#product-art')!.replaceChildren(image.cloneNode(true));
   // Cloned inline SVG IDs must remain unique within the document.
   detail.querySelectorAll<SVGElement>('[id]').forEach(element => {
    if (!element.id.startsWith('product-')) {
     const old = element.id; element.id = `${old}-detail`;
     detail.querySelectorAll<SVGElement>('[fill]').forEach(filled => { if(filled.getAttribute('fill') === `url(#${old})`) filled.setAttribute('fill', `url(#${old}-detail)`); });
    }
   });
   detail.querySelector<HTMLButtonElement>('[data-action="add"]')!.dataset.id = id;
   openDialog(detail);
  }
  if (action === 'add' && product) { state.add(id); updateCart(); announce(`${product.name} added to your demo bag. ${state.count()} items.`); }
  if (action === 'cart') { updateCart(); openDialog(cart); }
  if (action === 'close') button.closest('dialog')?.close();
  if (['increase', 'decrease', 'remove'].includes(action || '') && product) {
   const line = state.lines().find(item => item.id === id);
   const oldQuantity = line?.quantity || 0;
   state.setQuantity(id, action === 'remove' ? 0 : oldQuantity + (action === 'increase' ? 1 : -1));
   updateCart();
   const next = cart.querySelector<HTMLButtonElement>(`[data-id="${id}"][data-action="${action}"]`);
   (next && !next.disabled ? next : cart.querySelector<HTMLButtonElement>('[data-action="close"]'))?.focus();
   announce(`Bag updated. ${state.count()} items, ${money(state.total())}.`);
  }
  if (action === 'summary') { document.querySelector<HTMLElement>('#cart-notice')!.textContent = state.count() ? `Your demo bag contains ${state.count()} items totaling ${money(state.total())}. This is a storefront demonstration. No order was placed and no payment was taken.` : 'Your bag is empty. Add something from the collection to try the demo.'; }
 });
 document.querySelector<HTMLInputElement>('#product-search')!.addEventListener('input', event => { state.setSearch((event.target as HTMLInputElement).value); updateCatalog(); });
 window.addEventListener('message', event => { if (event.source === window.parent && event.data && event.data.type === 'discover-motion' && typeof event.data.paused === 'boolean') document.documentElement.dataset.motion = event.data.paused ? 'paused' : 'playing'; });
 updateCatalog(); updateCart();
}
export function runtimeSource(products: StoreProduct[]): string {
 return `${createStoreState.toString()}\n${mountStore.toString()}\nmountStore(${JSON.stringify(products).replace(/</g, '\\u003c')});`;
}
