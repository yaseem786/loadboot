// Shared by the callback form, marketing chat and portal chat. No weak fallback.
(function () {
  if (typeof window === 'undefined' || window.LBVisitorIdentity) return;
  var key = null;
  function valid(value) {
    return typeof value === 'string' && value.length >= 16 && value.length <= 64 && value.indexOf('novkey') !== 0;
  }
  function getKey() {
    if (key) return key; // one identity per tab, including when storage is unavailable
    var storage = null, previous = null;
    try { storage = window.localStorage; previous = storage.getItem('lb_lc_key'); } catch (_) {}
    if (valid(previous)) { key = previous; return key; }
    var bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes); // failure must stop the request, never use the clock
    key = 'v' + Array.from(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    try {
      if (storage) {
        storage.removeItem('lb_lc_conv'); // a rotated invalid key cannot resume the previous conversation
        storage.setItem('lb_lc_key', key);
      }
    } catch (_) {} // retain the secure key in this tab's memory
    return key;
  }
  window.LBVisitorIdentity = { getKey: getKey };
})();
