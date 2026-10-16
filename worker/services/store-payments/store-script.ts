/** `/__estori/store.js`: the only way a store reaches payments. It finds the platform path from its own address. */

export const STORE_SCRIPT = `(function () {
  var script = document.currentScript;
  var base = new URL(script.src, window.location.href).pathname.replace(/\\/__estori\\/store\\.js$/i, '') + '/__estori';
  function call(path, init) {
    return fetch(base + path, Object.assign({ credentials: 'same-origin' }, init)).then(function (response) {
      return response.json();
    });
  }
  window.Estori = {
    store: function () {
      return call('/store');
    },
    checkout: function (request) {
      return call('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }).then(function (result) {
        if (result.ok) {
          // Stripe Checkout can't be framed: a framed store opens it in a new tab.
          if (window.top !== window.self) window.open(result.checkoutUrl, '_blank', 'noopener');
          else window.location.assign(result.checkoutUrl);
        }
        return result;
      });
    },
    order: function (orderId) {
      return call('/orders/' + encodeURIComponent(orderId));
    },
  };
})();
`;
