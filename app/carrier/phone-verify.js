// bl_onb_0490 — "Verify your phone number" dashboard card (owner-approved preview GKdvkFVL6yT5uKZDe2FBkP).
// Steps: start → confirm (or change number) → code (we call, a voice reads 6 digits) → done.
// All rules live in Postgres (carrier_phone_status / _call / _code); this file only draws the steps.
import { carrierPhoneStatus, carrierPhoneCall, carrierPhoneCode } from '../shared/api.js';

const fmt = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '+1 (' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : (p || ''); };
const mask = (p) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? '+1 (' + d.slice(0, 3) + ') ***-' + d.slice(6) : (p || ''); };

export function phoneVerifyCard(h, mount) {
  const host = h('div', { id: 'lb-phone-verify' });
  let st = null, step = 'start', target = null, err = '', busy = false, timer = null;

  const S = {
    card: 'display:grid;gap:10px;border-color:rgba(245,158,11,.45);margin-bottom:14px;background:linear-gradient(135deg,rgba(245,158,11,.08),transparent)',
    num: 'font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;font-size:1.05rem;font-variant-numeric:tabular-nums',
    link: 'background:none;border:0;padding:0;color:#fb923c;font-weight:700;cursor:pointer;font:inherit;text-align:left',
    input: 'width:100%;max-width:320px;padding:11px 12px;border-radius:10px;border:1px solid rgba(148,163,184,.35);background:rgba(15,23,42,.35);color:inherit;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.05rem',
    err: 'color:#f87171;font-size:.86rem',
  };
  const btn = (label, onClick, ghost) => h('button', { class: 'cp-btn' + (ghost ? ' ghost' : ''), style: 'margin:0;justify-self:start', onClick }, label);
  const secsLeft = () => (st && st.next_call_at) ? Math.max(0, Math.ceil((new Date(st.next_call_at).getTime() - Date.now()) / 1000)) : 0;

  async function load() {
    try { st = await carrierPhoneStatus(); } catch (_) { st = null; }
    if (!st || !st.applies || st.verified) { if (step !== 'done') { mount(host, []); return; } }
    if (st && st.pending && step === 'start') { step = 'code'; target = st.pending.to; }
    draw();
  }

  async function call(num) {
    if (busy) return; busy = true; err = ''; draw();
    try {
      const r = await carrierPhoneCall(num || null);
      if (r && r.already) { step = 'done'; }
      else if (r && r.ok) { step = 'code'; target = r.to; st = Object.assign({}, st, { next_call_at: r.next_call_at }); }
      else { err = (r && r.why) || 'The call could not be placed. Try again in a minute.'; if (r && r.next_call_at) st = Object.assign({}, st, { next_call_at: r.next_call_at }); }
    } catch (e) { err = 'The call could not be placed. Try again in a minute.'; }
    busy = false; draw();
  }

  async function check(code) {
    if (busy) return; busy = true; err = ''; draw();
    try {
      const r = await carrierPhoneCode(code);
      if (r && r.ok) { step = 'done'; st = Object.assign({}, st, { phone: r.phone, verified: true }); }
      else err = (r && r.why) || 'That code doesn’t match.';
    } catch (e) { err = 'Could not check the code. Try again.'; }
    busy = false; draw();
  }

  function draw() {
    clearInterval(timer);
    const phone = st && st.phone;
    const why = st && st.required_for_dispatcher ? 'Needed before your dedicated dispatcher is assigned. Takes 1 minute.' : 'Confirms we can reach you about loads. Takes 1 minute.';
    const errEl = err ? h('div', { style: S.err, role: 'alert' }, err) : null;
    let body;
    if (step === 'start') {
      body = [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Verify your phone number'),
        h('div', { class: 'cp-row-s' }, why),
        phone ? h('div', { style: S.num }, mask(phone)) : h('div', { class: 'cp-row-s' }, 'No US phone number on your account yet.'),
        btn('Verify now', () => { step = phone ? 'confirm' : 'change'; err = ''; draw(); }),
      ];
    } else if (step === 'confirm') {
      body = [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'We’ll call this number'),
        h('div', { style: S.num }, fmt(phone)),
        h('div', { class: 'cp-row-s' }, 'A LoadBoot call from +1 (815) 365-1168 will read you a 6-digit code. Keep this screen open.'),
        errEl,
        btn(busy ? 'Calling…' : 'Call me now', () => call(null)),
        h('button', { style: S.link, onClick: () => { step = 'change'; err = ''; draw(); } }, 'This isn’t my number? Change it'),
      ];
    } else if (step === 'change') {
      const inp = h('input', { id: 'lb-pv-newnum', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(704) 555-0142', style: S.input, 'aria-label': 'New US phone number' });
      body = [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'New phone number'),
        inp,
        h('div', { class: 'cp-row-s' }, 'We verify the new number the same way. Your current number stays on file until this one is verified.'),
        errEl,
        btn(busy ? 'Calling…' : 'Save and call this number', () => call(inp.value)),
        phone ? h('button', { style: S.link, onClick: () => { step = 'confirm'; err = ''; draw(); } }, 'Cancel') : null,
      ];
      setTimeout(() => { try { inp.focus(); } catch (_) {} }, 0);
    } else if (step === 'code') {
      const inp = h('input', { id: 'lb-pv-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '7', placeholder: '6-digit code', style: S.input + ';letter-spacing:.3em', 'aria-label': '6-digit code' });
      const again = h('button', { style: S.link }, '');
      const tick = () => { if (!document.body.contains(host)) { clearInterval(timer); return; } const s = secsLeft(); again.disabled = s > 0 || busy; again.textContent = s > 0 ? 'Call again in 0:' + String(s).padStart(2, '0') : 'Call again'; again.style.opacity = s > 0 ? '.6' : '1'; };
      again.onclick = () => { if (secsLeft() === 0) call(target); };
      inp.onkeydown = (e) => { if (e.key === 'Enter') check(inp.value); };
      body = [
        h('span', { style: 'display:inline-flex;gap:6px;align-items:center;justify-self:start;font-size:.8rem;font-weight:700;padding:4px 10px;border-radius:999px;background:rgba(251,146,60,.14);color:#fb923c' }, '📞 Calling ' + mask(target)),
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem' }, 'Type the code you hear'),
        inp,
        errEl,
        btn(busy ? 'Checking…' : 'Verify', () => check(inp.value)),
        h('div', { class: 'cp-row-s' }, ['Code works for 10 minutes. No call? ', again]),
      ];
      tick(); timer = setInterval(tick, 1000);
      setTimeout(() => { try { inp.focus(); } catch (_) {} }, 0);
    } else {
      body = [
        h('div', { class: 'cp-row-t', style: 'font-size:1.08rem;color:#34d399' }, '✓ Phone verified'),
        h('div', { class: 'cp-row-s' }, 'Your dispatcher will use ' + fmt(st && st.phone) + ' to reach you. Next: add your trucks and post availability.'),
      ];
    }
    mount(host, h('div', { class: 'cp-card', style: S.card + (step === 'done' ? ';border-color:rgba(52,211,153,.45);background:linear-gradient(135deg,rgba(52,211,153,.08),transparent)' : '') }, body.filter(Boolean)));
  }

  load();
  return host;
}
