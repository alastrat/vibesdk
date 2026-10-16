---
name: store-checkout
description: Products, prices, carts and checkout for stores. Load it before adding products, a cart, a checkout or an order confirmation page.
---

# Store checkout

Stores take payments through Estori. The store lists products and keeps a cart; Estori prices the cart, takes the
payment and records the order. Store code never handles money.

## 1. Products and prices live in `estori-store.json`

Create `estori-store.json` at the repository root. It is the only place prices exist: render products from it, and
never copy a price into code.

```json
{
  "version": 1,
  "currency": "usd",
  "shipping": { "countries": ["US"], "flatRateCents": 600, "freeOverCents": 7500 },
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
- No other fields: Estori refuses unknown fields.
- **Catalog products** carry `catalogVariantId` on their variant, and `priceCents` is the seller's retail price. Never
  write a catalog price or a supplier name anywhere in the store.

## 2. The store script

Every page that shows products, the cart or the confirmation loads:

```html
<script src="/__estori/store.js"></script>
```

It defines `window.Estori`:

- `Estori.store()` resolves with `{ mode, paymentsAvailable, currency, shipping, products }` from the deployed
  `estori-store.json`.
- `Estori.checkout({ items, shipTo, successPath, cancelPath, note })` starts a checkout and sends the shopper to pay. When
  it resolves with `{ ok: false, message }`, show `message`.
- `Estori.order(orderId)` resolves with the shopper's receipt.

## 3. Cart, checkout and confirmation

- Keep the cart as `[{ variantId, quantity }]` in `localStorage`, plus a ship-to country from `shipping.countries`.
- Show prices from `Estori.store()` (or by importing `estori-store.json` in server code).
- When `paymentsAvailable` is false, show "Checkout is unavailable right now" instead of the checkout button.

```js
async function startCheckout(cart, shipTo) {
  const result = await Estori.checkout({ items: cart, shipTo, successPath: '/thanks', cancelPath: '/cart' });
  if (!result.ok) document.querySelector('#checkout-error').textContent = result.message;
}

async function showConfirmation() {
  const orderId = new URLSearchParams(location.search).get('order');
  if (!orderId) return;
  const receipt = await Estori.order(orderId);
  document.querySelector('#order-number').textContent = `Order #${receipt.orderNumber}`;
  localStorage.removeItem('cart');
}
```

## 4. What store code must never do

- Never collect card details, build a payment form, call Stripe, or compute an amount to charge.
- Never define files or routes under `/__estori/`, and never create tables named `estori_*`.
- Never send prices, fees or accounts to `Estori.checkout`: it accepts only variant ids, quantities, the country, return
  paths and a note.

## 5. Test and live

In the preview, the store's owner pays with Stripe's test cards (4242 4242 4242 4242, any future date, any CVC). Anyone
else viewing the preview sees "This is a demo".

## 6. Catalog products

Estori's catalog has products a store can sell without holding stock: Estori ships each order to the shopper.

1. Call `search_catalog` (or `get_catalog_product` with a `productId`) to find products. Each variant has a
   `catalogVariantId`, a `minimumRetailPriceCents` and a `suggestedRetailPriceCents`.
2. Add the product to `estori-store.json`. On each variant, set `catalogVariantId`, and set `priceCents` to the seller's
   price: at least `minimumRetailPriceCents`, by default `suggestedRetailPriceCents`.
3. Use the catalog's `imageUrls` as the product `image`.
4. Catalog products ship to the US only: keep `"US"` in `shipping.countries`.
5. Never write a catalog price, a supplier name or a SKU anywhere in the store.
