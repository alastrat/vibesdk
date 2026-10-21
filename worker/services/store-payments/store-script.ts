/**
 * `/__estori/store.js`: the only way a store reaches payments. It finds the platform path from its own address, and
 * every call resolves, so a store never waits on an answer it can't read (an expired preview, a network error).
 *
 * `Estori.cart` is the one cart a store and Estori's checkout page share. It lives in `localStorage` under a key that
 * names the store, because stores on the preview domain share one origin. `Estori.checkout()` opens Estori's checkout
 * page on the store's own address; the store never builds a checkout page or touches a payment.
 *
 * The script is worded for the shopper's language. A page in one of the store's languages also names it on each request
 * to the platform (`?lang=`), since a preview inside the app's frame may not keep the language cookie.
 */

import { LOCALES, type Locale } from '../../../shared/i18n/locales';
import { msg } from '../../../shared/i18n/translate';
import { STORE_CART_MAX_LINES, STORE_LINE_MAX_QUANTITY, STORE_NOTE_MAX_LENGTH } from '../../../shared/types/store-payments';
import { jsonForScript } from '../../utils/html';
import { translateFor } from '../../utils/server-translate';

const EMPTY_CART_MESSAGE = msg('Your cart is empty.');

/**
 * The script for a shopper in `locale`. `languages` are the store's languages, which a page's own language is matched
 * against; the script knows the empty-cart message in each, so a page in one of them is answered in it.
 */
export function storeScript(locale: Locale, languages: readonly Locale[] = [locale]): string {
	const offered = LOCALES.filter((candidate) => candidate === locale || languages.includes(candidate));
	const emptyCart = Object.fromEntries(offered.map((candidate) => [candidate, translateFor(candidate, EMPTY_CART_MESSAGE)]));
	return `(function () {
  var script = document.currentScript;
  var basePath = new URL(script.src, window.location.href).pathname.replace(/\\/__estori\\/store\\.js$/i, '');
  var base = basePath + '/__estori';
  var CART_KEY = 'estori:cart:' + basePath;
  // Orders whose receipt already cleared the cart in this browser, newest last.
  var CLEARED_KEY = 'estori:cleared-orders:' + basePath;
  var CLEARED_KEEP = 20;
  var MAX_LINES = ${STORE_CART_MAX_LINES};
  var MAX_QUANTITY = ${STORE_LINE_MAX_QUANTITY};
  var MAX_NOTE = ${STORE_NOTE_MAX_LENGTH};
  var LANGUAGES = ${jsonForScript(offered)};
  var DEFAULT_LANGUAGE = ${jsonForScript(locale)};
  var EMPTY_CART_MESSAGES = ${jsonForScript(emptyCart)};
  var listeners = [];

  // The page's language when it is one of the store's: the root element's own spelling, matched without regard to case.
  function pageLanguage() {
    var root = document.documentElement;
    var tag = root && typeof root.lang === 'string' ? root.lang.trim().toLowerCase() : '';
    for (var i = 0; i < LANGUAGES.length; i++) {
      if (LANGUAGES[i].toLowerCase() === tag) return LANGUAGES[i];
    }
    return null;
  }

  function withLanguage(path) {
    var language = pageLanguage();
    return language ? path + (path.indexOf('?') === -1 ? '?' : '&') + 'lang=' + encodeURIComponent(language) : path;
  }

  function call(path, init) {
    return fetch(base + withLanguage(path), Object.assign({ credentials: 'same-origin' }, init))
      .then(function (response) {
        return response.json();
      })
      .catch(function () {
        return null;
      });
  }

  function quantityOf(value) {
    var quantity = Math.floor(Number(value));
    if (!isFinite(quantity) || quantity < 0) return 0;
    return Math.min(quantity, MAX_QUANTITY);
  }

  // A damaged or foreign value reads as an empty cart rather than breaking the store.
  function read() {
    var saved = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(CART_KEY) || 'null');
    } catch (error) {
      saved = null;
    }
    var items = [];
    if (saved && Array.isArray(saved.items)) {
      saved.items.forEach(function (item) {
        if (!item || typeof item.variantId !== 'string' || item.variantId.length === 0) return;
        var quantity = quantityOf(item.quantity);
        if (quantity > 0 && items.length < MAX_LINES) items.push({ variantId: item.variantId, quantity: quantity });
      });
    }
    return {
      items: items,
      shipTo: saved && typeof saved.shipTo === 'string' ? saved.shipTo : null,
      note: saved && typeof saved.note === 'string' ? saved.note.slice(0, MAX_NOTE) : '',
    };
  }

  function notify() {
    var items = read().items;
    listeners.slice().forEach(function (listener) {
      try {
        listener(items);
      } catch (error) {}
    });
  }

  function firstReceipt(orderId) {
    var cleared = [];
    try {
      var saved = JSON.parse(window.localStorage.getItem(CLEARED_KEY) || '[]');
      if (Array.isArray(saved)) cleared = saved.filter(function (id) { return typeof id === 'string'; });
    } catch (error) {}
    if (cleared.indexOf(orderId) !== -1) return false;
    try {
      window.localStorage.setItem(CLEARED_KEY, JSON.stringify(cleared.concat(orderId).slice(-CLEARED_KEEP)));
    } catch (error) {}
    return true;
  }

  function write(saved) {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(saved));
    } catch (error) {}
    notify();
  }

  function withItems(change) {
    var saved = read();
    saved.items = change(saved.items);
    write(saved);
  }

  var cart = {
    items: function () {
      return read().items;
    },
    add: function (variantId, quantity) {
      var amount = quantity === undefined ? 1 : quantityOf(quantity);
      if (typeof variantId !== 'string' || variantId.length === 0 || amount === 0) return;
      withItems(function (items) {
        var line = items.filter(function (item) { return item.variantId === variantId; })[0];
        if (line) line.quantity = Math.min(line.quantity + amount, MAX_QUANTITY);
        else if (items.length < MAX_LINES) items.push({ variantId: variantId, quantity: amount });
        return items;
      });
    },
    setQuantity: function (variantId, quantity) {
      var amount = quantityOf(quantity);
      withItems(function (items) {
        if (amount === 0) return items.filter(function (item) { return item.variantId !== variantId; });
        var line = items.filter(function (item) { return item.variantId === variantId; })[0];
        if (line) line.quantity = amount;
        else if (items.length < MAX_LINES) items.push({ variantId: variantId, quantity: amount });
        return items;
      });
    },
    remove: function (variantId) {
      withItems(function (items) {
        return items.filter(function (item) { return item.variantId !== variantId; });
      });
    },
    // An empty cart has no order left for its note.
    clear: function () {
      var saved = read();
      saved.items = [];
      saved.note = '';
      write(saved);
    },
    count: function () {
      return read().items.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    },
    shipTo: function () {
      return read().shipTo;
    },
    setShipTo: function (country) {
      if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) return;
      var saved = read();
      saved.shipTo = country.toUpperCase();
      write(saved);
    },
    note: function () {
      return read().note;
    },
    setNote: function (note) {
      if (typeof note !== 'string') return;
      var saved = read();
      saved.note = note.trim().slice(0, MAX_NOTE);
      write(saved);
    },
    onChange: function (listener) {
      listeners.push(listener);
      return function () {
        listeners = listeners.filter(function (candidate) { return candidate !== listener; });
      };
    },
  };

  // The checkout page, or another tab of the store, changed the cart.
  window.addEventListener('storage', function (event) {
    if (event.key === CART_KEY) notify();
  });

  window.Estori = {
    cart: cart,
    store: function () {
      return call('/store');
    },
    // Opens Estori's checkout page on the store's own address. Stores written for the earlier contract pass the items.
    checkout: function (request) {
      request = request || {};
      if (Array.isArray(request.items)) {
        cart.clear();
        request.items.forEach(function (item) {
          if (item) cart.setQuantity(item.variantId, item.quantity);
        });
      }
      if (request.shipTo) cart.setShipTo(request.shipTo);
      // The note goes with the cart, which the checkout page reads, never in the page address.
      if (typeof request.note === 'string') cart.setNote(request.note);
      if (cart.count() === 0) return Promise.resolve({ ok: false, reason: 'invalid_request', message: EMPTY_CART_MESSAGES[pageLanguage() || DEFAULT_LANGUAGE] });
      var query = new URLSearchParams();
      if (typeof request.successPath === 'string') query.set('success', request.successPath);
      if (typeof request.cancelPath === 'string') query.set('cancel', request.cancelPath);
      var language = pageLanguage();
      if (language) query.set('lang', language);
      var search = query.toString();
      window.location.assign(base + '/pay' + (search ? '?' + search : ''));
      return Promise.resolve({ ok: true });
    },
    // A receipt means the order was paid, so the cart it came from is done: cleared the first time only, so reopening
    // an old confirmation leaves a cart the shopper has filled since.
    order: function (orderId) {
      return call('/orders/' + encodeURIComponent(orderId)).then(function (receipt) {
        if (receipt && receipt.orderId === orderId && firstReceipt(orderId)) cart.clear();
        return receipt;
      });
    },
  };
})();
`;
}
