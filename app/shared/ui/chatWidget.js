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
  fab.style.cssText = 'position:fixed;right:14px;bottom:18px;width:48px;height:48px;border-radius:50%;background:#0883F7;color:#fff;border:none;box-shadow:0 8px 24px rgba(8,131,247,.4);cursor:pointer;z-index:2147483647;font-size:1.25rem;line-height:1;display:flex;align-items:center;justify-content:center;transition:opacity .2s,transform .2s';
  // Mobile: sit above the bottom tab bar; never block taps — shrink & fade while typing.
  const mq = window.matchMedia('(max-width: 900px)');
  const place = () => { fab.style.bottom = mq.matches ? 'calc(84px + env(safe-area-inset-bottom))' : '18px'; };
  place(); try { mq.addEventListener('change', place); } catch (_) {}
  const isField = (el) => el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '');
  document.addEventListener('focusin', (e) => { if (isField(e.target)) { fab.style.opacity = '0'; fab.style.pointerEvents = 'none'; } });
  document.addEventListener('focusout', () => { setTimeout(() => { if (!isField(document.activeElement)) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; } }, 150); });
  fab.textContent = '💬';
  fab.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });
  document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== fab) panel.style.display = 'none'; });

  document.body.appendChild(panel);
  document.body.appendChild(fab);
}

function ready(fn) { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
if (typeof document !== 'undefined') ready(() => { try { mountChatWidget(); } catch (_) {} });

export default mountChatWidget;
