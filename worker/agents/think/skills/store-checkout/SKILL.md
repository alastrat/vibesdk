---
name: store-checkout
description: Products, prices, carts and checkout for stores. Load it before adding products, a cart, a checkout or an order confirmation page.
---

# Store checkout

Stores take payments through Estori. The store lists products and shows a cart; Estori prices the cart, runs the
checkout page on the store's own address, takes the payment and records the order. Store code never handles money.

## 1. Products, prices and the brand live in `estori-store.json`

Create `estori-store.json` at the repository root. It is the only place prices exist: render products from it, and
never copy a price into code.

```json
{
  "version": 1,
  "currency": "usd",
  "shipping": { "countries": ["US"], "flatRateCents": 600, "freeOverCents": 7500 },
  "brand": {
    "name": "Trailhead Supply",
    "logo": "/images/logo.svg",
    "colors": { "background": "#f6f1e7", "surface": "#ffffff", "text": "#1f2a24", "accent": "#2f6b4f" },
    "font": "Fraunces",
    "corners": "rounded"
  },
  "products": [
    {
      "id": "trail-mug",
      "name": "Trail Mug",
      "description": "Enamel camping mug.",
      "image": "/images/trail-mug.jpg",
      "variants": [
        { "id": "trail-mug-blue", "name": "Blue", "priceCents": 2400 },
        { "id": "trail-mug-red", "name": "Red", "priceCents": 2400, "available": false }
      ]
    }
  ]
}
```

Rules:

- Ids use lowercase letters, digits and dashes. Variant ids are unique across the file.
- `priceCents` is a whole number of cents from 50 to 1000000.
- `shipping.countries` lists two-letter country codes; `flatRateCents` is per order; shipping is free at or above
  `freeOverCents` when it is set.
- `image` is a path in the store (`/images/mug.jpg`) or an https address.
- Products may have `type: "physical"` or `type: "digital"`; omitted means physical. Digital-only carts have no
  shipping charge or shipping-address collection; mixed carts keep physical shipping. Keep the required shipping
  configuration for physical carts, but never promise shipment for a digital purchase.
- The owner's private account catalog is projected into this manifest when they publish. Preserve projected
  `accountProductId`, `downloadAssetIds` and `/__estori/product-images/:productId/:assetId` image paths exactly.
  Never invent or alter `accountProductId` or `downloadAssetIds`, copy private download files into the site, expose
  owner asset API URLs or storage keys, or add `catalogVariantId` to digital products. Manage private files through
  the account's Products UI; generated pages render the published projection. `downloadAssetIds` contains at most
  10 opaque IDs and appears only on digital products.
- No other fields: Estori refuses unknown fields.
- **Catalog products** carry `catalogVariantId` on their variant, and `priceCents` is the seller's retail price. Never
  write a catalog price or a supplier name anywhere in the store.
- **`brand`** dresses Estori's checkout page and its payment fields in the store's look. Always add it, matching the
  store's design:
  - `name` is the store's name, up to 80 characters. `logo` is optional, under the same rules as `image`.
  - `colors` are `#rrggbb`: `background`, `text` and `accent` are required; `surface` (cards and fields) defaults to
    `background`, and `accentText` (text on the accent) is picked for contrast when left out.
  - `font` is a Google Fonts family name, such as the store's heading or body font. `corners` is `square`, `rounded`
    or `pill`.

## 2. The store script

Every page loads:

```html
<script src="/__estori/store.js"></script>
```

It defines `window.Estori`:

- `Estori.cart` is the cart. Estori's checkout page shows and edits the same cart, so the store keeps it only here:
  - `Estori.cart.items()` returns `[{ variantId, quantity }]`, and `Estori.cart.count()` the number of units.
  - `Estori.cart.add(variantId, quantity)`, `Estori.cart.setQuantity(variantId, quantity)` (0 removes),
    `Estori.cart.remove(variantId)` and `Estori.cart.clear()` change it.
  - `Estori.cart.shipTo()` and `Estori.cart.setShipTo(country)` hold the ship-to country, one of `shipping.countries`.
  - `Estori.cart.note()` and `Estori.cart.setNote(text)` hold an optional order note, such as a gift message, up to
    500 characters. The checkout page shows it, and the seller sees it on the order. Clearing the cart removes it.
  - `Estori.cart.onChange(listener)` calls `listener(items)` after every change, including edits made on the checkout
    page or in another tab. Re-render the cart badge and cart view from it.
- `Estori.store()` resolves with `{ mode, paymentsAvailable, currency, shipping, products, brand }` from the deployed
  `estori-store.json`.
- `Estori.checkout({ successPath, cancelPath, note })` opens Estori's checkout page for the cart. `successPath` is the
  store's confirmation page; `cancelPath` is where "Continue shopping" goes back to. A `note` is saved to the cart, as
  `Estori.cart.setNote(note)` would.
- `Estori.order(orderId)` resolves with the shopper's receipt, and empties the cart once the order is paid.
  `receipt.downloads` is an optional array of `{ id, name, url }` for eligible paid digital files. Historical,
  refunded or disputed orders may have no downloads. Render only those returned links; never construct download
  entitlements from current product files. Access requires the signed receipt cookie set when Stripe returns to
  this browser; knowing an order ID or asset ID alone grants nothing.

## 3. Cart, checkout and confirmation

- Build the cart view in whatever form fits the store: a drawer, a page or both. Its contents come from
  `Estori.cart.items()`, with names, images and prices from `Estori.store()`.
- The Checkout button only calls `Estori.checkout()`. When `paymentsAvailable` is false, show "Checkout is unavailable
  right now" instead of the button.

```js
// Pages load store.js as a classic script, so await only inside an async function.
async function main() {
  const store = await Estori.store();

  function renderCart() {
    document.querySelector('#cart-count').textContent = String(Estori.cart.count());
    // Render Estori.cart.items() with each variant's name, image and price from store.products.
  }
  Estori.cart.onChange(renderCart);
  renderCart();

  document.querySelector('#add-to-cart').addEventListener('click', () => Estori.cart.add('trail-mug-blue', 1));
  document.querySelector('#checkout').addEventListener('click', () => Estori.checkout({ successPath: '/thanks', cancelPath: '/cart' }));
}

async function showConfirmation() {
  const orderId = new URLSearchParams(location.search).get('order');
  if (!orderId) return;
  const receipt = await Estori.order(orderId);
  if (!receipt) return;
  document.querySelector('#order-number').textContent = `Order #${receipt.orderNumber}`;
  const downloads = document.querySelector('#order-downloads');
  if (!downloads) return;
  downloads.replaceChildren();
  // The script URL carries /space/<app>/preview/<branch> in previews, and no prefix on live stores.
  const script = document.querySelector('script[src*="/__estori/store.js"]');
  const platformRoot = new URL(script.src, location.href).pathname.replace(/\/store\.js$/i, '');
  for (const file of receipt.downloads || []) {
    // Receipt URLs already include the preview prefix. Never prepend it a second time.
    const url = new URL(file.url, location.origin);
    const expectedPath = platformRoot + '/orders/' + encodeURIComponent(receipt.orderId) + '/downloads/' + encodeURIComponent(file.id);
    if (url.origin !== location.origin || url.pathname !== expectedPath) continue;
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = file.name;
    downloads.appendChild(link);
  }
}

main();
showConfirmation();
```

The confirmation page provides `#order-number` and `#order-downloads`. Download links use the platform's
`/__estori/orders/:orderId/downloads/:assetId` API on the same store origin; ordinary browser navigation sends the
HttpOnly receipt cookie. Use the returned URL, not an owner `/api/my-products/assets/` URL or a public file copy.
The platform streams an attachment only while the order is eligible. A digital receipt confirms payment and shows
available downloads; it must not tell shoppers to wait for shipping or require email delivery to obtain their files.

## 4. What store code must never do

- Never build a checkout page, and never route `/checkout` to a form. Estori's checkout page collects everything.
- Never collect an email, a shipping address or card details, never call Stripe, and never compute an amount to charge.
- Never keep the cart anywhere but `Estori.cart`, and never send prices, fees or accounts to Estori.
- Never write money copy that Estori doesn't do: no "Taxes included", "Free returns", "Secure checkout by ..." or
  delivery promises such as "Ships in 2 days" in the cart, product pages or confirmation. Shipping costs come only from
  `estori-store.json`.
- Never define files or routes under `/__estori/`, and never create tables named `estori_*`.

## 5. Before promising checkout

Call `get_payments_setup` once when the user asks for checkout or payments. When `ready` is false, finish building the
store as usual, then tell the user in one sentence what's left, using `nextStep`, and that they finish it in Estori at
`setupPath`. Never ask for their Stripe or bank details yourself.

## 6. Test and live

- In the preview, the store's owner pays with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC).
  Anyone else viewing the preview sees "This is a demo".
- The owner publishes the store with the Go live button in the editor. It then has its own address, where any
  shopper can pay. Payments are test payments until Estori turns on real ones.
- Your changes reach the preview only. When the user wants shoppers to see them, tell them to open Go live and press
  Publish changes. You can't publish for them.

## 7. Catalog products

Estori's catalog has products a store can sell without holding stock: Estori ships each order to the shopper.

1. Call `search_catalog` (or `get_catalog_product` with a `productId`) to find products. Each variant has a
   `catalogVariantId`, a `minimumRetailPriceCents` and a `suggestedRetailPriceCents`.
2. Add the product to `estori-store.json`. On each variant, set `catalogVariantId`, and set `priceCents` to the seller's
   price: at least `minimumRetailPriceCents`, by default `suggestedRetailPriceCents`.
3. Use the first of the catalog's `imageUrls` as the product `image` (one address, not a list).
4. Write your own product names, descriptions and variant names in the store's voice. Never copy a brand, a model
   number or wholesale terms from the catalog.
5. Catalog products ship to the US only: keep `"US"` in `shipping.countries`.
6. Never write a catalog price, a supplier name or a SKU anywhere in the store.
