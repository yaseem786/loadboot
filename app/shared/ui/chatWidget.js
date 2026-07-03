// chatWidget.js — floating "Live chat / Support" launcher, mounted on every dashboard.
// Auto-mounts on import (side-effect). Opens WhatsApp live chat when a business number is
// configured; always offers real, reachable email channels so the option is never fake.
// Set WHATSAPP to E.164 digits (e.g. '15551234567') to enable the WhatsApp channel.
const WHATSAPP = '';
const SUPPORT_EMAIL = 'hello@loadboot.com';
const DISPATCH_EMAIL = 'dispatch@loadboot.com';

export function mountChatWidget(opts = {}) {
  if (typeof document === 'undefined' || document.getElementById('lb-chat-fab')) return;
  const wa = opts.whatsapp || WHATSAPP;
  const email = opts.email || SUPPORT_EMAIL;

  const panel = document.createElement('div');
  panel.id = 'lb-chat-panel';
  panel.style.cssText = 'position:fixed;right:18px;bottom:86px;width:300px;max-width:calc(100vw - 36px);background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 18px 50px rgba(2,6,23,.28);padding:16px;z-index:2147483646;display:none;font-family:inherit';
  panel.innerHTML =
    '<div style="font-weight:800;font-size:1rem;color:#0f172a;margin-bottom:2px">Chat with LoadBoot</div>' +
    '<div style="color:#64748b;font-size:.85rem;margin-bottom:12px">Real people, fast replies. Pick a channel:</div>' +
    (wa ? '<a href="https://wa.me/' + wa + '" target="_blank" rel="noopener" style="display:flex;gap:10px;align-items:center;padding:11px;border-radius:11px;background:#25D366;color:#fff;font-weight:700;text-decoration:none;margin-bottom:8px">💬 Live chat on WhatsApp</a>' : '') +
    '<a href="mailto:' + email + '" style="display:flex;gap:10px;align-items:center;padding:11px;border-radius:11px;background:#0883F7;color:#fff;font-weight:700;text-decoration:none;margin-bottom:8px">✉️ Email support</a>' +
    '<a href="mailto:' + DISPATCH_EMAIL + '" style="display:flex;gap:10px;align-items:center;padding:11px;border-radius:11px;background:#f1f5f9;color:#0f172a;font-weight:700;text-decoration:none">🚚 Dispatch desk</a>';

  const fab = document.createElement('button');
  fab.id = 'lb-chat-fab';
  fab.type = 'button';
  fab.title = 'Chat with support';
  fab.setAttribute('aria-label', 'Chat with support');
  fab.style.cssText = 'position:fixed;right:18px;bottom:18px;width:56px;height:56px;border-radius:50%;background:#0883F7;color:#fff;border:none;box-shadow:0 10px 30px rgba(8,131,247,.42);cursor:pointer;z-index:2147483647;font-size:1.5rem;line-height:1;display:flex;align-items:center;justify-content:center';
  fab.textContent = '💬';
  fab.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== fab) panel.style.display = 'none'; });

  document.body.appendChild(panel);
  document.body.appendChild(fab);
}

function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
if (typeof document !== 'undefined') ready(() => { try { mountChatWidget(); } catch (_) {} });

export default mountChatWidget;
