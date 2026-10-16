/**
 * `/__estori/store.js`: the only way a store reaches payments. It finds the platform path from its own address, and
 * every call resolves, so a store never waits on an answer it can't read (an expired preview, a network error).
 */

const UNREADABLE = JSON.stringify({ ok: false, reason: 'stripe_failed', message: "Checkout couldn't start. Refresh the page and try again." });
const POPUP_BLOCKED = JSON.stringify({
	ok: false,
	reason: 'stripe_failed',
	message: 'Your browser blocked the checkout window. Allow pop-ups for this page, or open the store in its own tab.',
});

export const STORE_SCRIPT = `(function () {
  var script = document.currentScript;
  var base = new URL(script.src, window.location.href).pathname.replace(/\\/__estori\\/store\\.js$/i, '') + '/__estori';
  function call(path, init) {
    return fetch(base + path, Object.assign({ credentials: 'same-origin' }, init))
      .then(function (response) {
        return response.json();
      })
      .catch(function () {
        return null;
      });
  }
  window.Estori = {
    store: function () {
      return call('/store');
    },
    checkout: function (request) {
      // Stripe Checkout can't be framed. A framed store opens its tab now, while the click still counts as the
      // shopper's, so pop-up blockers allow it.
      var framed = window.top !== window.self;
      var tab = framed ? window.open('', '_blank') : null;
      return call('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }).then(function (result) {
        if (!result || typeof result.ok !== 'boolean') result = ${UNREADABLE};
        if (!result.ok) {
          if (tab) tab.close();
          return result;
        }
        if (!framed) {
          window.location.assign(result.checkoutUrl);
          return result;
        }
        if (!tab) return ${POPUP_BLOCKED};
        tab.opener = null;
        tab.location.href = result.checkoutUrl;
        return result;
      });
    },
    order: function (orderId) {
      return call('/orders/' + encodeURIComponent(orderId));
    },
  };
})();
`;
