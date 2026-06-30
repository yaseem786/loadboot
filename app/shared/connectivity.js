// connectivity.js — online/offline banner. Phase 2A has NO offline mutation queue:
// when offline, live areas show "Connection required" and mutations are disabled.
// We never serve stale private data from cache (see service worker policy).
import { el } from './ui/dom.js';

export function mountOfflineBanner() {
  const banner = el('div', { class: 'lb-offline', role: 'status', 'aria-live': 'polite' },
    'Connection required — you are offline. Live data and actions are paused.');
  banner.hidden = true;
  document.body.appendChild(banner);
  function sync() { banner.hidden = navigator.onLine; document.body.classList.toggle('lb-is-offline', !navigator.onLine); }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
  return { isOnline: () => navigator.onLine };
}

export default { mountOfflineBanner };
