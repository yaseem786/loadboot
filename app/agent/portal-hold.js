// bl_disp_0604 — Dispatcher portal hold (owner decision, 13 Nov 2026).
// When Command Center puts a dispatcher's portal on hold (cc_dispatcher_portal_hold), the agent portal shows a
// full-screen lock with the reason and a WhatsApp button to regain access. Nothing else changes: the carrier
// assignment, trial window, LoadBoot line and mailbox keep running — this only locks the portal screen.
// The flag comes from dispatcher_my_status(), which returns the whole profile row (portal_hold_at / _reason).
import { dispatcherMyStatus, getContactChannel } from '../shared/api.js';

const WA_FALLBACK = { url: 'https://wa.me/18153651168', display: '+1 (815) 365-1168' };
const ID = 'lb-portal-hold';

const mk = (tag, style, text) => { const n = document.createElement(tag); if (style) n.setAttribute('style', style); if (text != null) n.textContent = text; return n; };

export async function checkPortalHold() {
  if (document.getElementById(ID)) return true;
  let d = null;
  try { d = await dispatcherMyStatus(); } catch (_) { return false; }
  const p = d && d.profile;
  if (!p || !p.portal_hold_at) return false;

  let wa = WA_FALLBACK;
  try { const c = await getContactChannel(); const one = c && c.one; if (one && one.url) wa = { url: one.url, display: one.display || WA_FALLBACK.display }; } catch (_) {}
  const msg = 'Hi LoadBoot, this is ' + (p.full_name || 'a dispatcher') + '. My dispatcher portal is on hold and I would like to regain access.';
  const href = wa.url + (wa.url.indexOf('?') >= 0 ? '&' : '?') + 'text=' + encodeURIComponent(msg);

  const ov = mk('div', 'position:fixed;inset:0;z-index:2147483646;background:rgba(10,22,40,.97);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:Manrope,system-ui,sans-serif');
  ov.id = ID; ov.setAttribute('role', 'alertdialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', ID + '-t');
  const card = mk('div', 'max-width:520px;width:100%;background:#10223B;border:1.5px solid rgba(252,83,5,.55);border-radius:18px;padding:26px 22px;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,.45)');
  const chip = mk('div', 'display:inline-block;background:rgba(252,83,5,.15);color:#FC5305;font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:5px 11px;margin-bottom:12px', '⚠ Portal access on hold');
  const t = mk('h2', 'margin:0 0 10px;font-size:22px;line-height:1.3;color:#fff', 'Your dispatcher portal is on hold');
  t.id = ID + '-t';
  const intro = mk('p', 'margin:0 0 14px;line-height:1.6;color:#cbd5e1', 'LoadBoot has paused your access to this portal while we review an issue with you.');
  const rb = mk('div', 'background:rgba(255,255,255,.06);border-left:4px solid #FC5305;border-radius:10px;padding:12px 14px;margin:0 0 16px');
  rb.appendChild(mk('div', 'font-weight:800;font-size:13px;color:#FC5305;margin-bottom:4px', 'Reason'));
  rb.appendChild(mk('div', 'line-height:1.6;color:#f1f5f9;white-space:pre-wrap', p.portal_hold_reason || 'Contact LoadBoot for details.'));
  const how = mk('p', 'margin:0 0 18px;line-height:1.6;color:#cbd5e1', 'To regain access, message LoadBoot on WhatsApp. Please do not contact your carrier or brokers about this.');
  const btn = mk('a', 'display:flex;align-items:center;justify-content:center;gap:8px;background:#FC5305;color:#fff;text-decoration:none;font-weight:800;font-size:16px;border-radius:12px;padding:14px 16px', '💬 Message LoadBoot on WhatsApp');
  btn.href = href; btn.target = '_blank'; btn.rel = 'noopener';
  const num = mk('div', 'text-align:center;margin-top:10px;font-size:13px;color:#94a3b8', '📞💬 Call or WhatsApp · ' + wa.display);
  const re = mk('button', 'display:block;margin:14px auto 0;background:none;border:0;color:#94a3b8;font-size:13px;text-decoration:underline;cursor:pointer', 'Access restored? Reload');
  re.type = 'button'; re.addEventListener('click', () => location.reload());
  [chip, t, intro, rb, how, btn, num, re].forEach((n) => card.appendChild(n));
  ov.appendChild(card);
  document.body.appendChild(ov);
  try { document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; } catch (_) {}
  return true;
}
