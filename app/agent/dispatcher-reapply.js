// Dispatcher re-application card (bl_disp_0318 · premium rebuild bl_disp_0378).
// Shown on the dispatcher status screen when the application is 'rejected'. The server
// (public.dispatcher_reapply) is the only authority on eligibility: 14-day cooldown from the
// decision, max 3 re-applications. This module never computes eligibility itself — it asks
// (p_check = true), renders the answer, and on confirm flips the profile back to a draft so the
// application form opens pre-filled, behind the gap gate in app/agent/dispatcher-gaps.js.
//
// Usage: reapplyCard({ h, api: { dispatcherReapply }, prof, onReopened }) -> HTMLElement

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (_) { return String(iso || ''); }
};
const daysUntil = (iso) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

const PANEL = 'border-radius:20px;padding:20px 20px 18px;margin-bottom:14px;background:linear-gradient(150deg,#0d1f3a 0%,#122a4d 58%,#0b1f3d 100%);border:1.5px solid rgba(8,131,247,.45);box-shadow:0 18px 40px -26px rgba(8,131,247,.75)';
const KICKER = 'font-size:.7rem;font-weight:900;letter-spacing:.14em;color:#7cc0ff';
const HEAD = 'font-size:1.22rem;font-weight:900;color:#fff;margin:7px 0 4px;line-height:1.2';

export function reapplyCard({ h, api, prof, onReopened }) {
  const kicker = h('div', { style: KICKER }, 'RE-APPLY');
  const head = h('div', { style: HEAD }, 'Apply again');
  const body = h('div', { 'aria-live': 'polite' }, [h('div', { class: 'cp-row-s' }, 'Checking when you can re-apply…')]);
  const card = h('div', { style: PANEL }, [kicker, head, body]);
  const set = (k, hd, kids) => {
    if (k) kicker.textContent = k; if (hd) head.textContent = hd;
    body.replaceChildren(...(Array.isArray(kids) ? kids : [kids]).filter(Boolean));
  };
  const line = (t, style) => h('div', { class: 'cp-row-s', style: 'line-height:1.7;' + (style || '') }, t);

  // the countdown reads as progress, not as a wall
  const meter = (avail) => {
    const total = 14, left = daysUntil(avail), done = Math.max(0, Math.min(total, total - left));
    const bar = h('div', { style: 'height:8px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:12px' },
      h('div', { style: 'height:100%;width:' + Math.round((done / total) * 100) + '%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#4ade80);transition:width .4s' }));
    return h('div', null, [bar, h('div', { style: 'display:flex;justify-content:space-between;margin-top:6px;font-size:.74rem;font-weight:800;letter-spacing:.05em;color:#8fb4e0' }, [
      h('span', null, left + ' DAY' + (left === 1 ? '' : 'S') + ' LEFT'), h('span', null, fmtDate(avail).toUpperCase())])]);
  };

  const paint = (r) => {
    if (!r || r.error) {
      return set('RE-APPLY', 'Apply again', [line('We could not check your re-application status just now. Please refresh in a moment.', 'color:#fca5a5'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px', onClick: load }, 'Try again')]);
    }
    if (r.reason === 'not_rejected') { card.hidden = true; return; }
    if (r.reason === 'limit') {
      card.style.borderColor = 'rgba(148,163,184,.35)'; card.style.boxShadow = 'none';
      return set('RE-APPLY · CLOSED', 'You have used all your re-applications',
        line('All ' + (r.max || 3) + ' re-applications for this role have been used. If your situation has changed materially — your own load-board account, US carriers you have dispatched — write to hello@loadboot.com and we will take another look.'));
    }
    if (r.reason === 'cooldown') {
      const n = daysUntil(r.available_at);
      return set('RE-APPLY · OPENS ' + fmtDate(r.available_at).toUpperCase(), 'You can apply again in ' + n + ' day' + (n === 1 ? '' : 's'), [
        line('Your account and every answer you gave are kept. On ' + fmtDate(r.available_at) + ' this card turns into a button and your application reopens pre-filled.'),
        meter(r.available_at),
        h('div', { style: 'margin-top:14px;border-radius:12px;padding:12px 14px;background:rgba(2,8,20,.4);border:1px solid rgba(130,165,225,.2)' }, [
          h('div', { style: 'font-size:.66rem;font-weight:900;letter-spacing:.12em;color:#fdba74;margin-bottom:6px' }, 'USE THE TIME FOR THIS'),
          h('div', { class: 'cp-row-s', style: 'line-height:1.75' }, 'Close the points named above. The load board does not have to be in your own name, and you do not need a board at all \u2014 an employer\u2019s or a carrier\u2019s login, Facebook or WhatsApp freight groups, brokers you already work with, or direct shippers all count. What we need is two loads you found and booked yourself: the lane, the broker, the month and the rate.'),
        ]),
      ]);
    }
    // eligible
    const err = h('div', { class: 'cp-row-s', style: 'color:#fca5a5;margin-top:8px', role: 'alert' }, '');
    const btn = h('button', { class: 'cp-btn cp-btn-lg', style: 'margin-top:14px;width:100%' }, 'Update my application & re-apply →');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      btn.disabled = true; const label = btn.textContent; btn.textContent = 'Opening your application…'; err.textContent = '';
      let res = null;
      try { res = await api.dispatcherReapply(false); } catch (e) { res = { error: (e && e.message) || 'error' }; }
      if (res && res.ok) { if (typeof onReopened === 'function') onReopened(res); return; }
      if (res && res.reason && res.reason !== 'conflict') return paint(res); // state changed under us: show the truth
      btn.disabled = false; btn.textContent = label;
      err.textContent = 'That did not go through. Please try again.';
    });
    card.style.borderColor = 'rgba(74,222,128,.5)';
    card.style.boxShadow = '0 18px 40px -26px rgba(74,222,128,.75)';
    kicker.style.color = '#4ade80';
    const left = Math.max(0, (r.remaining || 1) - 1);
    set('RE-APPLY · OPEN NOW', 'You can apply again', [
      line('Your previous answers are saved. We reopen your application as a draft with everything filled in — update what has changed, close the points above, and submit it for a fresh review.'),
      h('div', { style: 'display:flex;gap:7px;flex-wrap:wrap;margin-top:11px' }, [
        h('span', { class: 'cp-pill', style: 'background:rgba(34,197,94,.12);border:1px solid rgba(74,222,128,.4);color:#4ade80;font-weight:700' }, '✓ Answers kept'),
        h('span', { class: 'cp-pill', style: 'background:rgba(255,255,255,.06);color:#cbd5e1;font-weight:700' }, left + ' re-application' + (left === 1 ? '' : 's') + ' left after this'),
      ]),
      btn, err,
    ]);
  };
  async function load() {
    let r = null;
    try { r = await api.dispatcherReapply(true); } catch (e) { r = { error: (e && e.message) || 'error' }; }
    paint(r);
  }
  load();
  return card;
}
