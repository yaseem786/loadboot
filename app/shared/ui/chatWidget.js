// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// chatWidget.js — mounts the real LoadBoot live chat (AI assistant + human handoff)
// in the portals. Auto-mounts on import for carrier/partner/agent; the Command
// Center is skipped (staff answer chats in CC → Live chat instead of chatting with
// themselves). The widget itself lives in liveChatCore.js (window.LBChat) so the
// exact same code also runs on the marketing site via /lc-init.js.
import './visitor-key.js';
import './liveChatCore.js';
import ENV from '../env.js';
import { getSession } from '../session.js';

export function mountChatWidget(opts = {}) {
  if (!window.LBChat) return;
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  const origin = opts.origin
    || (path.indexOf('/carrier') >= 0 ? 'carrier'
      : path.indexOf('/partner') >= 0 ? 'partner'
      : path.indexOf('/agent') >= 0 ? 'agent' : 'website');
  window.LBChat.mount({
    url: ENV.supabaseUrl,
    anon: ENV.supabaseAnonKey,
    origin,
    getToken: async () => {
      try { const s = await getSession(); return (s && s.access_token) || null; }
      catch (e) { return null; }
    },
  });
}

// 23 Sep 2026 (owner): in the portals the launcher lives in the premium header, not as a floating bubble.
// The header mounts after auth, so poll for it briefly; the marketing site keeps the floating FAB.
export function dockChatInHeader(selector, tries) {
  let n = 0; const max = tries || 60;                      // 60 × 250 ms = 15 s, then give up quietly
  const iv = setInterval(() => {
    n++;
    const host = document.querySelector(selector || '.cp-top-right');
    if (host && window.LBChat && window.LBChat.dock && window.LBChat.dock(host)) { clearInterval(iv); return; }
    if (n >= max) clearInterval(iv);
  }, 250);
  // the header is rebuilt on sign-in / role switch — re-dock whenever a new one appears
  try { new MutationObserver(() => { const host = document.querySelector(selector || '.cp-top-right'); const f = document.getElementById('lbc-fab'); if (host && f && f.parentNode !== host) window.LBChat.dock(host); }).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
}

// Auto-mount everywhere except the Command Center.
if (typeof location !== 'undefined' && location.pathname.indexOf('/command-center') < 0) {
  try { mountChatWidget(); } catch (e) { /* never break the app for a chat widget */ }
  try { dockChatInHeader('.cp-top-right'); } catch (_) {}
}
