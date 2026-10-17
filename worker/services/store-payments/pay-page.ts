/**
 * Estori's checkout page, `{store}/__estori/pay`: the same page for every store, in the store's brand, on the store's own
 * address. The order summary edits the shared cart (`Estori.cart`); shipping and payment are Stripe Elements on a Checkout
 * Session, and the email is the page's own field, sent to each session. Store code never runs here, and the page loads only its own script, the store script and Stripe.js.
 */

import { STORE_CHECKOUT_MESSAGES, type StoreBrand, type StoreInfo } from '../../../shared/types/store-payments';
import { STRIPE_API_VERSION } from '../payments/stripe-client';

/** Stripe.js built for the API version the server pins. */
export const STRIPE_JS_URL = `https://js.stripe.com/${STRIPE_API_VERSION.split('.')[1]}/stripe.js`;

const NEUTRAL_BRAND: StoreBrand = {
	name: '',
	colors: { background: '#f7f7f5', surface: '#ffffff', text: '#1a1a1a', accent: '#1a1a1a', accentText: '#ffffff' },
	corners: 'rounded',
};

const RADIUS: Readonly<Record<StoreBrand['corners'], { box: string; field: string; button: string }>> = {
	square: { box: '0px', field: '0px', button: '0px' },
	rounded: { box: '14px', field: '8px', button: '10px' },
	pill: { box: '20px', field: '12px', button: '999px' },
};

export interface PayPageInput {
	/** The store's base path, such as `/space/{appId}/preview/{branch}`. */
	basePath: string;
	publishableKey: string | null;
	info: StoreInfo | null;
	/** Fresh for each response; marks the page's own inline script for the CSP. */
	nonce: string;
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** JSON that can sit inside a script element: nothing in it can close the element or start markup. */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function isDark(hex: string): boolean {
	const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

/** An image the store names, on the store (`/images/x.png`) or absolute. */
function imageOnStore(basePath: string, image: string | undefined): string | null {
	if (!image) return null;
	return image.startsWith('/') ? `${basePath}${image}` : image;
}

/** Headers for the page: Stripe's scripts and frames, the store's own address, framing only by Estori. */
export function payPageHeaders(nonce: string, appOrigin: string | null): Record<string, string> {
	const stripe = 'https://js.stripe.com https://*.js.stripe.com';
	const policy = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' ${stripe} https://maps.googleapis.com`,
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		"font-src 'self' https://fonts.gstatic.com",
		"img-src 'self' https: data:",
		`frame-src ${stripe} https://hooks.stripe.com https://checkout.stripe.com`,
		"connect-src 'self' https://api.stripe.com https://merchant-ui-api.stripe.com https://maps.googleapis.com https://*.stripe.com https://*.stripe.network",
		`frame-ancestors 'self'${appOrigin ? ` ${appOrigin}` : ''}`,
		"base-uri 'none'",
		"form-action 'self'",
	].join('; ');
	return {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'no-store',
		'Content-Security-Policy': policy,
		'Referrer-Policy': 'same-origin',
		'X-Content-Type-Options': 'nosniff',
	};
}

export function renderPayPage(input: PayPageInput): string {
	const brand = input.info?.brand ?? NEUTRAL_BRAND;
	const radius = RADIUS[brand.corners];
	const products = (input.info?.products ?? []).map((product) => ({
		id: product.id,
		name: product.name,
		image: imageOnStore(input.basePath, product.image),
		variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name, priceCents: variant.priceCents })),
	}));
	const config = {
		basePath: input.basePath,
		publishableKey: input.publishableKey,
		paymentsAvailable: input.info?.paymentsAvailable ?? false,
		brand: { ...brand, logo: imageOnStore(input.basePath, brand.logo) },
		dark: isDark(brand.colors.background),
		radius,
		countries: input.info?.shipping.countries ?? [],
		products,
		unavailable: STORE_CHECKOUT_MESSAGES.payments_unavailable,
	};
	const fontLink = brand.font
		? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(brand.font).replace(/%20/g, '+')}:wght@400;500;600;700&amp;display=swap">`
		: '';
	const fontFamily = brand.font ? `'${brand.font}', ui-sans-serif, system-ui, sans-serif` : 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
	const logo = config.brand.logo ? `<img class="logo" src="${escapeHtml(config.brand.logo)}" alt="">` : '';
	const notice = !input.publishableKey || !input.info ? `<div class="notice" id="notice">${escapeHtml(STORE_CHECKOUT_MESSAGES.payments_unavailable)}</div>` : '<div class="notice" id="notice" hidden></div>';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${brand.name ? `Checkout · ${escapeHtml(brand.name)}` : 'Checkout'}</title>
${fontLink}
<style>
:root {
  --bg: ${brand.colors.background};
  --surface: ${brand.colors.surface};
  --text: ${brand.colors.text};
  --accent: ${brand.colors.accent};
  --accent-text: ${brand.colors.accentText};
  --muted: color-mix(in srgb, var(--text) 62%, var(--bg));
  --line: color-mix(in srgb, var(--text) 14%, transparent);
  --box: ${radius.box};
  --field: ${radius.field};
  --button: ${radius.button};
  --font: ${fontFamily};
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 var(--font); -webkit-font-smoothing: antialiased; }
a { color: inherit; }
.bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 1180px; margin: 0 auto; padding: 20px 24px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 20px; }
.logo { height: 32px; width: auto; display: block; }
.back { color: var(--muted); text-decoration: none; font-size: 15px; }
.back:hover { color: var(--text); }
.page { max-width: 1180px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.1; margin: 0 0 24px; letter-spacing: -0.01em; }
.grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 32px; align-items: start; }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--box); padding: 28px; }
.step + .step { margin-top: 28px; padding-top: 28px; border-top: 1px solid var(--line); }
.step h2 { display: flex; align-items: center; gap: 12px; font-size: 20px; margin: 0 0 16px; }
.step h2 span { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 999px; background: var(--accent); color: var(--accent-text); font-size: 15px; }
.field-label { display: block; margin: 0 0 6px; font-size: 14px; }
.field { width: 100%; padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--field); background: var(--surface); color: var(--text); font: 16px var(--font); }
.field:focus { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 1px; border-color: var(--accent); }
.field-error { margin: 6px 0 0; color: #d92d20; font-size: 14px; }
.pay { width: 100%; margin-top: 28px; padding: 16px 20px; border: 0; border-radius: var(--button); background: var(--accent); color: var(--accent-text); font: 600 17px var(--font); cursor: pointer; }
.pay:disabled { opacity: 0.55; cursor: default; }
.fine { color: var(--muted); font-size: 13px; margin: 12px 0 0; text-align: center; }
.summary { position: sticky; top: 24px; }
.summary h2 { font-size: 22px; margin: 0 0 16px; }
.lines { list-style: none; margin: 0; padding: 0; }
.line { display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.thumb { width: 64px; height: 64px; border-radius: var(--field); background: color-mix(in srgb, var(--text) 8%, var(--surface)); object-fit: cover; }
.line-name { font-weight: 600; }
.line-variant { color: var(--muted); font-size: 14px; }
.line-total { font-weight: 600; text-align: right; }
.controls { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.stepper { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: var(--button); }
.stepper button { width: 34px; height: 32px; border: 0; background: none; color: var(--text); font-size: 17px; cursor: pointer; }
.stepper output { min-width: 26px; text-align: center; font-size: 15px; }
.remove { background: none; border: 0; padding: 0; color: var(--muted); font: 14px var(--font); text-decoration: underline; cursor: pointer; }
.country { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; }
.country select { font: 15px var(--font); color: var(--text); background: var(--surface); border: 1px solid var(--line); border-radius: var(--field); padding: 6px 8px; }
.totals { margin: 16px 0 0; display: grid; grid-template-columns: 1fr auto; gap: 8px 0; }
.totals dd { padding-left: 16px; }
.totals dt { color: var(--muted); }
.totals dd { margin: 0; text-align: right; }
.totals .total { font-size: 20px; font-weight: 700; color: var(--text); padding-top: 12px; border-top: 1px solid var(--line); }
.notice { margin: 0 0 20px; padding: 14px 16px; border-radius: var(--field); background: color-mix(in srgb, #d92d20 14%, var(--surface)); border: 1px solid color-mix(in srgb, #d92d20 40%, transparent); }
.empty { text-align: center; padding: 48px 24px; }
.busy { opacity: 0.6; pointer-events: none; transition: opacity 0.15s; }
@media (max-width: 860px) {
  .grid { grid-template-columns: 1fr; }
  .summary { position: static; order: -1; }
  .panel { padding: 20px; }
}
</style>
</head>
<body>
<header class="bar">
  <a class="back" id="back" href="${escapeHtml(input.basePath)}/">&larr; Continue shopping</a>
  <div class="brand">${logo}${brand.name ? `<span>${escapeHtml(brand.name)}</span>` : ''}</div>
</header>
<main class="page">
  <h1>Checkout</h1>
  ${notice}
  <div class="grid" id="checkout">
    <section class="panel" id="steps">
      <div class="step"><h2><span>1</span> Contact</h2><label class="field-label" for="email">Email</label><input class="field" id="email" type="email" name="email" autocomplete="email" inputmode="email" maxlength="254" placeholder="you@example.com"><p class="field-error" id="email-error" hidden></p></div>
      <div class="step"><h2><span>2</span> Shipping address</h2><div id="shipping-element"></div></div>
      <div class="step"><h2><span>3</span> Payment</h2><div id="payment-element"></div></div>
      <button class="pay" id="pay" type="button" disabled>Pay</button>
      <p class="fine">Payments are processed securely by Stripe. ${brand.name ? escapeHtml(brand.name) : 'This store'} is the seller.</p>
    </section>
    <aside class="panel summary" aria-label="Order summary">
      <h2>Order summary</h2>
      <ul class="lines" id="lines"></ul>
      <div class="country" id="country-row" hidden><label for="country">Ship to</label><select id="country"></select></div>
      <dl class="totals">
        <dt>Subtotal</dt><dd id="subtotal">&mdash;</dd>
        <dt>Shipping</dt><dd id="shipping">&mdash;</dd>
        <dt class="total">Total</dt><dd class="total" id="total">&mdash;</dd>
      </dl>
    </aside>
  </div>
  <div class="panel empty" id="empty" hidden>
    <h2>Your cart is empty</h2>
    <p><a id="empty-back" href="${escapeHtml(input.basePath)}/">Continue shopping</a></p>
  </div>
</main>
<script type="application/json" id="estori-pay-config">${jsonForScript(config)}</script>
<script src="${escapeHtml(input.basePath)}/__estori/store.js"></script>
<script src="${STRIPE_JS_URL}"></script>
<script nonce="${escapeHtml(input.nonce)}">${PAY_PAGE_SCRIPT}</script>
</body>
</html>`;
}

/** The page's own script: the order summary, the shared cart, and Stripe's form on a Checkout Session. */
export const PAY_PAGE_SCRIPT = `(function () {
  var config = JSON.parse(document.getElementById('estori-pay-config').textContent);
  var params = new URLSearchParams(window.location.search);
  function storePath(value) {
    return typeof value === 'string' && value.charAt(0) === '/' && value.charAt(1) !== '/' && value.indexOf('\\\\') === -1 ? value : '/';
  }
  var successPath = storePath(params.get('success'));
  var cancelPath = storePath(params.get('cancel'));
  var note = params.get('note');
  var $ = function (id) { return document.getElementById(id); };
  $('back').href = config.basePath + cancelPath;
  $('empty-back').href = config.basePath + cancelPath;

  function money(cents) { return '$' + (cents / 100).toFixed(2); }
  function showNotice(message) { var notice = $('notice'); notice.textContent = message; notice.hidden = false; }
  function hideNotice() { $('notice').hidden = true; }

  var cart = window.Estori && window.Estori.cart;
  if (!config.publishableKey || !cart || typeof window.Stripe !== 'function') {
    showNotice(config.unavailable);
    $('pay').disabled = true;
    return;
  }

  var variants = {};
  config.products.forEach(function (product) {
    product.variants.forEach(function (variant) {
      variants[variant.id] = { product: product, variant: variant };
    });
  });

  var checkout = null;
  var elements = [];
  // The open checkout is kept for the tab, so a reload replaces it instead of holding a second one against the weekly cap.
  var CHECKOUT_KEY = 'estori:checkout:' + config.basePath;
  function remember(id) {
    try {
      if (id) window.sessionStorage.setItem(CHECKOUT_KEY, id);
      else window.sessionStorage.removeItem(CHECKOUT_KEY);
    } catch (error) {}
  }
  var checkoutId = null;
  try {
    checkoutId = window.sessionStorage.getItem(CHECKOUT_KEY);
  } catch (error) {}
  // Stripe's own email field can't be given an email, and Stripe won't pay once the page sets the email while that field
  // is mounted. So the email is the page's own field, sent to each session, and it survives a cart edit.
  var emailField = $('email');
  function sendEmail(showErrors) {
    var current = checkout;
    if (!current) return Promise.resolve(false);
    return current.loadActions().then(function (loaded) {
      if (loaded.type !== 'success') return false;
      return Promise.resolve(loaded.actions.updateEmail(emailField.value.trim())).then(function (result) {
        if (result && result.type === 'error') {
          if (showErrors) {
            $('email-error').textContent = result.error.message;
            $('email-error').hidden = false;
          }
          return false;
        }
        $('email-error').hidden = true;
        return true;
      });
    }).catch(function () {
      return false;
    });
  }
  emailField.addEventListener('change', function () {
    if (emailField.value.trim()) sendEmail(true);
  });
  // Stripe puts the address on the session only at payment, so the page keeps what the address field last held.
  var typedAddress = null;
  var starting = false;
  var again = false;
  var timer = null;

  function shipTo() {
    var chosen = cart.shipTo();
    return chosen && config.countries.indexOf(chosen) !== -1 ? chosen : config.countries[0];
  }

  function renderCountries() {
    if (config.countries.length < 2) return;
    var select = $('country');
    select.innerHTML = '';
    config.countries.forEach(function (country) {
      var option = document.createElement('option');
      option.value = country;
      option.textContent = country;
      select.appendChild(option);
    });
    select.value = shipTo();
    $('country-row').hidden = false;
    select.onchange = function () { cart.setShipTo(select.value); };
  }

  function renderLines(summary) {
    var list = $('lines');
    list.innerHTML = '';
    cart.items().forEach(function (item) {
      var known = variants[item.variantId];
      var priced = summary && summary.lines.filter(function (line) { return line.variantId === item.variantId; })[0];
      var li = document.createElement('li');
      li.className = 'line';
      var thumb = document.createElement(known && known.product.image ? 'img' : 'div');
      thumb.className = 'thumb';
      if (known && known.product.image) { thumb.src = known.product.image; thumb.alt = ''; }
      var body = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'line-name';
      name.textContent = known ? known.product.name : 'An item no longer sold here';
      var variant = document.createElement('div');
      variant.className = 'line-variant';
      variant.textContent = known ? known.variant.name + ' \\u00b7 ' + money(priced ? priced.unitPriceCents : known.variant.priceCents) + ' each' : '';
      var controls = document.createElement('div');
      controls.className = 'controls';
      var stepper = document.createElement('div');
      stepper.className = 'stepper';
      var minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '\\u2212';
      minus.setAttribute('aria-label', 'One fewer');
      minus.onclick = function () { cart.setQuantity(item.variantId, item.quantity - 1); };
      var count = document.createElement('output');
      count.textContent = String(item.quantity);
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'One more');
      plus.onclick = function () { cart.setQuantity(item.variantId, item.quantity + 1); };
      stepper.appendChild(minus);
      stepper.appendChild(count);
      stepper.appendChild(plus);
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = 'Remove';
      remove.onclick = function () { cart.remove(item.variantId); };
      controls.appendChild(stepper);
      controls.appendChild(remove);
      body.appendChild(name);
      body.appendChild(variant);
      body.appendChild(controls);
      var total = document.createElement('div');
      total.className = 'line-total';
      total.textContent = priced ? money(priced.lineTotalCents) : known ? money(known.variant.priceCents * item.quantity) : '';
      li.appendChild(thumb);
      li.appendChild(body);
      li.appendChild(total);
      list.appendChild(li);
    });
    $('subtotal').textContent = summary ? money(summary.subtotalCents) : '\\u2014';
    $('shipping').textContent = summary ? (summary.shippingCents === 0 ? 'Free' : money(summary.shippingCents)) : '\\u2014';
    $('total').textContent = summary ? money(summary.totalCents) : '\\u2014';
  }

  function setBusy(busy) {
    $('steps').classList.toggle('busy', busy);
    if (busy) $('pay').disabled = true;
  }

  function showEmpty() {
    $('checkout').hidden = true;
    $('empty').hidden = false;
  }

  function appearance() {
    var brand = config.brand;
    return {
      theme: config.dark ? 'night' : 'stripe',
      variables: {
        colorPrimary: brand.colors.accent,
        colorBackground: brand.colors.surface,
        colorText: brand.colors.text,
        fontFamily: brand.font ? "'" + brand.font + "', ui-sans-serif, system-ui, sans-serif" : 'ui-sans-serif, system-ui, sans-serif',
        borderRadius: config.radius.field,
      },
    };
  }

  function fonts() {
    var font = config.brand.font;
    return font ? [{ cssSrc: 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(font).replace(/%20/g, '+') + ':wght@400;500;600&display=swap' }] : [];
  }

  function unmount() {
    elements.forEach(function (element) {
      try { element.destroy(); } catch (error) {}
    });
    elements = [];
  }

  function mount(clientSecret) {
    var address = typedAddress;
    unmount();
    // Stripe.js can't confirm a second session started on the same instance, so each session gets its own.
    checkout = window.Stripe(config.publishableKey).initCheckoutElementsSdk({ clientSecret: clientSecret, elementsOptions: { appearance: appearance(), fonts: fonts() } });
    checkout.on('change', function (session) {
      var cents = session.total && session.total.total ? session.total.total.minorUnitsAmount : null;
      $('pay').textContent = typeof cents === 'number' ? 'Pay ' + money(cents) : 'Pay';
    });
    // Stripe's address field shows only what it is given when created, so a typed address comes back as a saved one.
    var shipping = null;
    if (address && address.address.country === shipTo()) {
      var saved = {};
      Object.keys(address.address).forEach(function (key) {
        if (typeof address.address[key] === 'string' && address.address[key]) saved[key] = address.address[key];
      });
      try {
        shipping = checkout.createShippingAddressElement({ contacts: [{ name: address.name, address: saved }] });
      } catch (error) {
        shipping = null;
      }
    }
    if (!shipping) shipping = checkout.createShippingAddressElement();
    shipping.on('change', function (event) {
      typedAddress = event.complete && event.value && event.value.address ? event.value : null;
    });
    shipping.mount('#shipping-element');
    var payment = checkout.createPaymentElement();
    payment.mount('#payment-element');
    elements = [shipping, payment];
    return emailField.value.trim() ? sendEmail(false) : Promise.resolve(false);
  }

  function start() {
    if (starting) { again = true; return; }
    if (cart.count() === 0) { showEmpty(); return; }
    starting = true;
    setBusy(true);
    hideNotice();
    var body = { items: cart.items(), shipTo: shipTo(), successPath: successPath, cancelPath: cancelPath };
    if (note) body.note = note;
    if (checkoutId) body.replaces = checkoutId;
    fetch(config.basePath + '/__estori/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (response) { return response.json(); })
      .catch(function () { return null; })
      .then(function (answer) {
        if (!answer || answer.ok !== true) {
          renderLines(null);
          showNotice(answer && answer.message ? answer.message : "Checkout couldn't start. Refresh the page and try again.");
          if (answer && answer.ok === false) {
            checkoutId = null;
            remember(null);
            // The earlier session was expired when this one was asked for, so nothing is left to pay.
            unmount();
            checkout = null;
          }
          return;
        }
        checkoutId = answer.checkoutId;
        remember(checkoutId);
        renderLines(answer.summary);
        return mount(answer.clientSecret);
      })
      .catch(function () {
        showNotice("Checkout couldn't start. Refresh the page and try again.");
      })
      .then(function () {
        starting = false;
        setBusy(false);
        $('pay').disabled = !checkout;
        if (again) { again = false; start(); }
      });
  }

  // A cart edit, here or in another tab: wait for more edits, then price the new cart.
  cart.onChange(function () {
    renderLines(null);
    if (cart.count() === 0) { showEmpty(); return; }
    clearTimeout(timer);
    timer = setTimeout(start, 400);
  });

  $('pay').onclick = function () {
    if (!checkout) return;
    var current = checkout;
    $('pay').disabled = true;
    hideNotice();
    sendEmail(true).then(function (sent) {
      if (!sent) return null;
      return current.loadActions().then(function (loaded) {
        if (loaded.type !== 'success') throw new Error('Checkout is not ready');
        return loaded.actions.confirm();
      });
    }).then(function (result) {
      // A successful payment leaves for the return page; anything that comes back is an error to show.
      if (result && result.type === 'error') showNotice(result.error.message);
    }).catch(function (error) {
      if (window.console) window.console.error('Estori checkout: the payment could not be confirmed', error);
      showNotice("The payment didn't go through. Check your details and try again.");
    }).then(function () {
      $('pay').disabled = !checkout;
    });
  };

  renderCountries();
  renderLines(null);
  start();
})();`;
