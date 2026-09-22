// bl_dial_0390 — one-time SMS opt-in ask for carriers who registered BEFORE the signup checkbox existed.
//
// Those accounts never saw an SMS box, so they have NOT consented and nothing may be assumed on their
// behalf. This asks them once, in their own portal, with the same words the signup form carries. A yes
// is recorded as a web_form consent and is what lets a dispatcher text them; a no is recorded too, so
// they are never asked again. Snoozed for 30 days if they close it without answering.
//
// Self-contained on purpose: plain DOM, no imports from app.js, so it cannot break the portal if it throws.

import { smsConsentSelfState, smsConsentSetSelf } from '../shared/api.js';

const SNOOZE_KEY = 'lb_sms_optin_snooze';
const SNOOZE_DAYS = 30;

const CSS = `
.lbsms-wrap{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;justify-content:center;padding:12px;pointer-events:none}
.lbsms{pointer-events:auto;width:100%;max-width:520px;background:#10223B;color:#e7eefb;border:1px solid rgba(148,163,184,.22);
  border-radius:16px;padding:16px 16px 14px;box-shadow:0 18px 48px rgba(0,0,0,.45);font-family:'Manrope',system-ui,sans-serif}
.lbsms h4{margin:0 0 6px;font-size:15px;font-weight:800;letter-spacing:-.01em}
.lbsms p{margin:0 0 10px;font-size:12.5px;line-height:1.5;opacity:.82}
.lbsms a{color:#4aa3ff}
.lbsms-row{display:flex;gap:9px;flex-wrap:wrap}
.lbsms-b{flex:1 1 150px;height:42px;border-radius:12px;border:0;background:#0883F7;color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;font-family:inherit}
.lbsms-b.ghost{background:transparent;border:1px solid rgba(148,163,184,.3);color:#cbd5e1}
.lbsms-b[disabled]{opacity:.55;cursor:default}
.lbsms-x{position:absolute;top:8px;right:10px;background:none;border:0;color:#94a3b8;font-size:19px;line-height:1;cursor:pointer}
.lbsms-in{position:relative}
@media (max-width:420px){.lbsms-b{flex:1 1 100%}}
`;

function snoozed() {
  try { const t = Number(localStorage.getItem(SNOOZE_KEY) || 0); return t && Date.now() < t; } catch (_) { return false; }
}
function snooze() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5)); } catch (_) {}
}

export async function maybeAskSmsOptIn() {
  if (snoozed()) return;
  let st = null;
  try { st = await smsConsentSelfState(); } catch (_) { return; }
  if (!st || st.error || !st.has_number || st.answered) return;

  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const wrap = document.createElement('div'); wrap.className = 'lbsms-wrap';
  wrap.innerHTML =
    '<div class="lbsms lbsms-in" role="dialog" aria-label="Text message updates">'
  +   '<button class="lbsms-x" aria-label="Not now">×</button>'
  +   '<h4>Want load updates by text?</h4>'
  +   '<p>We can text you at <b>' + String(st.number || '').replace(/[<>&]/g, '') + '</b> about your loads and account '
  +     '— dispatch updates, check calls and paperwork requests. This is optional and it is not a condition of '
  +     'using LoadBoot or of any purchase. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt '
  +     'out, HELP for help. See our <a href="/terms.html#s11" target="_blank" rel="noopener">Terms</a> and '
  +     '<a href="/privacy.html#sms" target="_blank" rel="noopener">Privacy Policy</a>.</p>'
  +   '<div class="lbsms-row">'
  +     '<button class="lbsms-b" data-yes>Yes, text me</button>'
  +     '<button class="lbsms-b ghost" data-no>No, email only</button>'
  +   '</div>'
  +   '<div class="lbsms-err" style="margin-top:9px;font-size:12px;color:#fca5a5"></div>'
  + '</div>';
  document.body.appendChild(wrap);

  const err = wrap.querySelector('.lbsms-err');
  const close = () => { try { wrap.remove(); style.remove(); } catch (_) {} };
  const answer = async (on, btn) => {
    const bs = wrap.querySelectorAll('.lbsms-b'); bs.forEach((b) => { b.disabled = true; });
    btn.textContent = 'Saving…'; err.textContent = '';
    try {
      const r = await smsConsentSetSelf(on);
      if (r && r.ok) { close(); return; }
      err.textContent = (r && r.error) || 'Could not save that. Try again later.';
    } catch (e) { err.textContent = (e && e.message) || 'Could not save that. Try again later.'; }
    bs.forEach((b) => { b.disabled = false; });
    btn.textContent = on ? 'Yes, text me' : 'No, email only';
  };
  wrap.querySelector('[data-yes]').onclick = (e) => answer(true, e.currentTarget);
  wrap.querySelector('[data-no]').onclick  = (e) => answer(false, e.currentTarget);
  wrap.querySelector('.lbsms-x').onclick   = () => { snooze(); close(); };
}
