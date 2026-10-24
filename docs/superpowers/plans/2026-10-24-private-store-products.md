# Private store products — implementation and validation

Products belong to the signed-in account and can be assigned to multiple owned stores. Seller submissions to the public Estori catalog are out of scope. The existing curated supplier catalog remains separate; a supplier import retains its real source identifiers, availability and retail-price constraints.

## Model and publication

- D1 `account_products`, `product_assets` and `store_product_listings` hold private products, revisions, file metadata and store assignments. Ownership is enforced for products, assets and stores. Optimistic revisions prevent a stale editor from overwriting newer changes.
- Products are physical or digital; origin remains own or supplier catalog. USD one-time pricing retains the platform's existing 50-cent minimum. Variants retain stable identifiers through editing.
- Files are stored under owner-scoped private R2 keys. Uploads are bounded to 20 MB per file, validate allowed content and file signatures, and never expose bucket keys in frontend responses. Public store image delivery only allows image assets present in a published snapshot (or an authenticated owner preview).
- Changes remain draft until the normal store publication workflow. The projection updates the selected draft's manifest under the existing draft lock, preserves unmanaged products and store shipping/brand settings, and restores another active draft afterward.
- The final serialized manifest is checked by the same parser used by checkout, before any write or commit. Product/variant IDs, 200-product and 1,000-variant limits, the 256 KiB UTF-8 limit, shipping and retained product fields are validated. Existing live versions remain authoritative until successful publication.
- Adopting a verified older published product creates new account/variant IDs and keeps provenance for metrics and pending removals. Removing a product from a store preserves it in the account catalog.

## UI

The Kumo table follows the inspected Whop Products layout: compact rows, thumbnails, fine horizontal rules, search, visibility/type filters, export, selectable columns, bulk show/hide actions and pagination. Estori-specific columns describe product type, origin and real store order metrics. A full-screen editor pairs product details with a desktop/mobile preview, variants, image uploads, physical weight or protected digital files. Account-private products are available in the main Catalog view and the store picker. Already attached products are marked explicitly; switching stores clears attachment success state.

English, Spanish and Brazilian Portuguese copy are included. The existing Estori theme and fonts remain, with light/dark support and blue primary actions. Mobile editing was checked at 390 px.

## Digital commerce

Digital-only checkout requires no shipping address and charges no shipping fee; mixed orders retain physical shipping. Purchased file IDs are snapshotted in the priced checkout. Paid receipt access requires the signed receipt cookie and matching store/order/mode; refunds revoke downloads. Digital products are excluded from shipping queues, shipping actions and physical-shipment email content. Generated storefront receipt instructions render safe, same-origin download links from `receipt.downloads` and handle preview URL prefixes.

## Local sample collection

Seven real private products were saved to the local North Ridge Coffee account/store through the application APIs and browser:

- House Blend (250 g and 1 kg variants)
- Ethiopia Guji
- Ceramic Pour-over Dripper
- Everyday Insulated Bottle
- The Tasting Flight (created through the actual UI with image upload)
- The Home Brewing Guide (PDF)
- Coffee Tasting Journal (printable PDF)

Images and PDFs are persisted in local R2 storage; records are in local D1. They are unpublished draft products, not fabricated live sales. Migrations 0039–0041 were applied locally only. No production migration, storefront publication, real payment or customer email was performed.

## Verification

- Root typecheck and production build passed. Lint: zero errors, six existing Fast Refresh warnings. Space typecheck/build passed.
- Independent code review identified and verified fixes for invalid merged manifest publication, pending removal of adopted products, and state leaking across selected stores. Independent screenshot comparison found no further important design defects.
- Browser verification covered persisted collection, create, uploaded image, edit, digital files, type filters, catalog attachment status, publication dialog, responsive editor, and both themes. The original System appearance setting was restored.
- Regression coverage includes actual D1 ownership/revision behavior, private assets, digital/mixed checkout, paid/refunded download entitlements, immutable publication limits, seller shipping exclusions, catalog reuse, and EN/ES/PT completeness.
- Final full coverage: 611 Worker-compatible suites passed (5,307 tests, 2 skipped), plus the remaining 3 React suites under Node (13 tests). Total: 614 suites / 5,320 passed tests. The default parallel Workers pool exhausted macOS loopback ports; the established single-Worker configuration was used. Three React suites require the Node configuration because Workers cannot resolve a `react-remove-scroll` dependency.
