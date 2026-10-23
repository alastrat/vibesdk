import type { CatalogArtifact } from './artifact-types';
import { storeDesigns } from './stores/data';
import { coverSvg, documentBody, previewDocument, stylesheet } from './stores/render';
import { runtimeSource } from './stores/runtime';
import { escapeText } from './stores/art';

/** Deterministic, dependency-free source artifacts for local seeding and R2 delivery. */
export function buildStoreArtifacts(): CatalogArtifact[] {
 return storeDesigns.map((design,index) => {
  const tier = index % 3 === 0 ? 'free' : 'premium';
  const css = stylesheet(design);
  const js = runtimeSource(design.products);
  const previewHtml = previewDocument(design);
  const cover = coverSvg(design);
  const indexHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeText(design.title)}</title><meta name="description" content="${escapeText(design.copy)}"><link rel="stylesheet" href="./styles.css"></head><body class="${design.layout}">${documentBody(design)}<script src="./store.js" defer></script></body></html>`;
  return {
   slug:design.slug,title:design.title,summary:design.detail,
   description:`${design.detail} Includes six illustrative products, working category and text filters, accessible product dialogs, and an interactive demo cart with quantity controls. Original vector artwork and all source files are included. Responsive down to 320px, with keyboard navigation and reduced-motion support. Product prices are examples; no payments, order processing, or external services are connected.`,
   categorySlug:design.categorySlug,kind:'store',tier,priceCents:tier==='free'?0:2900,
   tags:[design.categorySlug.replaceAll('-',' '),design.layout,'storefront','original artwork','responsive'],
   features:['Six curated demo products','Category and text search','Keyboard-accessible product dialogs','Demo cart with quantities and totals','Original inline SVG illustrations','Responsive layout and reduced motion','Self-contained HTML, CSS and JavaScript','No build step or network dependencies'],
   palette:[design.background,design.ink,design.accent,design.surface,design.secondary],
   animationKey:'store-editorial',featured:index%3===0,previewHtml,coverSvg:cover,
   files:[
    {path:'index.html',content:indexHtml},
    {path:'styles.css',content:css},
    {path:'store.js',content:js},
    {path:'preview.html',content:previewHtml},
    {path:'cover.svg',content:cover},
    {path:'products.json',content:JSON.stringify(design.products,null,2)+'\n'},
    {path:'README.md',content:`# ${design.title}\n\nAn original Estori storefront template. ${design.detail}\n\n## Run\n\nOpen index.html in a modern browser. No installation, build step, account, API key, or network connection is needed. All artwork is original inline SVG. preview.html is the complete single-file version.\n\n## Included files\n\n- index.html — semantic storefront and product markup\n- styles.css — responsive styling, this store's art direction, and reduced-motion handling\n- store.js — filter, product dialog, cart, and keyboard interactions\n- products.json — editable reference catalog, prices in integer USD cents\n- preview.html — standalone version with embedded styles and JavaScript\n- cover.svg — original catalog cover illustration\n\n## Customize\n\nEdit the product data passed to mountStore at the bottom of store.js, and keep the corresponding product names, categories, IDs, prices, and illustration markup in index.html in sync. products.json is a reference copy, not fetched at runtime. Change theme variables at the top of styles.css. Keep IDs unique. Copy the same edits into preview.html if you use the single-file version.\n\n## Try the interactions\n\nFilter by category, type in the search field, open a product with Enter or a tap, and add it to the bag. Open the bag to increase, decrease, or remove quantities. Escape closes the native modal and focus returns to its opener. The review action displays a demo summary.\n\n## Demo boundary\n\nThe products, availability, and prices are illustrative. No payment is taken, no order is placed, and nothing is sent to a server. The bag lives only in memory and resets when the page reloads. Digital-goods listings do not include the advertised sample packs, courses, or print downloads; this bundle contains the storefront template and its original preview artwork. Connect your own reviewed commerce, inventory, and fulfillment system before accepting real orders.\n\n## Accessibility and motion\n\nNative buttons and dialogs support keyboard and touch. Inputs have labels, cart changes are announced, and dialog focus is restored. CSS honors prefers-reduced-motion. A parent preview can post { type: 'discover-motion', paused: true } to pause animation. No autoplay media or external fonts.\n\n## Provenance\n\nOriginal Estori template composition, code, copy, and vector illustrations. No third-party imagery, fonts, testimonials, brand assets, or remote dependencies are bundled.\n`},
   ],
  };
 });
}
