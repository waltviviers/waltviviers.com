(function () {
  var CACHE_KEY = 'wv_usd_zar';
  var CACHE_TTL = 86400000; // 24h

  // Load cached rate synchronously so formatPrice works on the first render
  try {
    var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (c && c.rate && (Date.now() - c.ts) < CACHE_TTL) {
      window.wvUsdZar = c.rate;
    }
  } catch (e) {}

  // "$480" → "$480 · R 8,765"  (returns original if rate not yet known)
  window.formatPrice = function (usdStr) {
    if (!usdStr || !window.wvUsdZar) return usdStr || '';
    var n = parseFloat(String(usdStr).replace(/[^0-9.]/g, ''));
    if (!n) return usdStr;
    var zar = Math.round(n * window.wvUsdZar);
    return usdStr + ' \xb7 R ' + zar.toLocaleString('en-ZA');
  };

  // Patch static .meta-value elements that contain a dollar price
  function patchDom() {
    if (!window.wvUsdZar) return;
    document.querySelectorAll('.meta-value').forEach(function (el) {
      var t = (el.dataset.usd || el.textContent).trim();
      if (!t.startsWith('$')) return;
      el.dataset.usd = t; // remember original so refresh doesn't double-convert
      el.textContent = window.formatPrice(t);
    });
  }

  // Fetch a fresh rate in the background, update cache and any DOM elements
  function refresh() {
    fetch('https://api.frankfurter.app/latest?from=USD&to=ZAR')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rate = d.rates && d.rates.ZAR;
        if (!rate) return;
        window.wvUsdZar = rate;
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ rate: rate, ts: Date.now() }));
        } catch (e) {}
        patchDom();
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { patchDom(); refresh(); });
  } else {
    patchDom();
    refresh();
  }
})();
