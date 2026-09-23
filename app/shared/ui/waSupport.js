// waSupport.js — bl_wa_0411 (23 Sep 2026, owner): a real WhatsApp support button in the premium header of every
// portal (carrier / partner-broker-shipper / agent), next to the docked live-chat launcher. Option (a) of the two
// discussed: it opens the official LoadBoot WhatsApp line (wa.me) with a short prefilled line saying which portal
// the person is in — no in-portal WhatsApp chat UI, the conversation happens in WhatsApp itself and lands in the
// CC WhatsApp inbox (wa_* tables) like every other WhatsApp message. Never on the Command Center.
// The number is the ONE official number already served to the marketing site by lb_contact_channel()
// (bl_wa_0390/0391) — no new endpoint, no number hard-coded here. If the RPC fails or has no number, no button.
import { getContactChannel } from '../api.js';

const CSS = '#lb-wa-fab{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;background:rgba(37,211,102,.12);border:1px solid rgba(37,211,102,.35);color:#25D366;text-decoration:none;flex:none;margin-right:8px;transition:background .15s,color .15s}'
  + '#lb-wa-fab:hover{background:rgba(37,211,102,.28);color:#fff}'
  + '#lb-wa-fab svg{width:20px;height:20px;display:block}'
  + '@media (max-width:480px){#lb-wa-fab{margin-right:6px}}';
const ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 3.5A11.9 11.9 0 0 0 12 0C5.5 0 .2 5.3.2 11.8c0 2.1.5 4.1 1.6 5.9L0 24l6.5-1.7a11.8 11.8 0 0 0 5.5 1.4c6.5 0 11.8-5.3 11.8-11.8 0-3.2-1.2-6.1-3.3-8.4ZM12 21.7c-1.8 0-3.5-.5-5-1.4l-.4-.2-3.8 1 1-3.7-.2-.4a9.7 9.7 0 0 1-1.5-5.2C2.2 6.4 6.6 2 12 2c2.6 0 5.1 1 6.9 2.9a9.7 9.7 0 0 1 2.9 6.9c0 5.4-4.4 9.9-9.8 9.9Zm5.4-7.3c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-1 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5.3-.5c.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4Z"/></svg>';

function portalName() {
  const p = (typeof location !== 'undefined' && location.pathname) || '';
  return p.indexOf('/app/carrier/') === 0 ? 'carrier portal' : p.indexOf('/app/partner/') === 0 ? 'broker / shipper portal' : p.indexOf('/app/agent/') === 0 ? 'agent portal' : 'portal';
}
function ensureCss() { if (document.getElementById('lb-wa-css')) return; const s = document.createElement('style'); s.id = 'lb-wa-css'; s.textContent = CSS; document.head.appendChild(s); }
function build(wa) {
  const a = document.createElement('a');
  a.id = 'lb-wa-fab'; a.href = wa.url + '?text=' + encodeURIComponent('Hi LoadBoot — I need help in the ' + portalName() + '.');
  a.target = '_blank'; a.rel = 'noopener'; a.title = 'WhatsApp LoadBoot support · ' + (wa.display || ''); a.setAttribute('aria-label', 'WhatsApp LoadBoot support');
  a.innerHTML = ICON;
  return a;
}
function place(host, a) { const chat = host.querySelector('#lbc-fab'); if (chat) host.insertBefore(a, chat); else host.appendChild(a); }

// Poll briefly for the header (it mounts after auth), then keep the button alive across header rebuilds.
export function mountWaSupport(selector) {
  const sel = selector || '.cp-top-right';
  let wa = null; let n = 0;
  getContactChannel().then((c) => { wa = c && c.whatsapp && c.whatsapp.url ? c.whatsapp : null; }).catch(() => { wa = null; });
  const tick = () => {
    n++;
    const host = document.querySelector(sel);
    if (wa && host) {
      const cur = document.getElementById('lb-wa-fab');
      if (cur && cur.parentNode === host) return true;
      ensureCss(); if (cur) cur.remove(); place(host, build(wa)); return true;
    }
    return false;
  };
  const iv = setInterval(() => { if (tick() || n >= 60) clearInterval(iv); }, 250);
  try { new MutationObserver(() => { tick(); }).observe(document.body, { childList: true, subtree: true }); } catch (_) {}
}

if (typeof location !== 'undefined' && location.pathname.indexOf('/command-center') < 0) {
  try { mountWaSupport('.cp-top-right'); } catch (_) {}
}
