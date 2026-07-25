// chatWidget.js — mounts the real LoadBoot live chat (AI assistant + human handoff)
// in the portals. Auto-mounts on import for carrier/partner/agent; the Command
// Center is skipped (staff answer chats in CC → Live chat instead of chatting with
// themselves). The widget itself lives in liveChatCore.js (window.LBChat) so the
// exact same code also runs on the marketing site via /lc-init.js.
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

// Auto-mount everywhere except the Command Center.
if (typeof location !== 'undefined' && location.pathname.indexOf('/command-center') < 0) {
  try { mountChatWidget(); } catch (e) { /* never break the app for a chat widget */ }
}
