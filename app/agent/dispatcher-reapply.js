// Dispatcher re-application card (bl_disp_0318).
// Shown on the dispatcher status screen when the application is 'rejected'. The server
// (public.dispatcher_reapply) is the only authority on eligibility: 14-day cooldown from the
// decision, max 3 re-applications. This module never computes eligibility itself — it asks
// (p_check = true), renders the answer, and on confirm flips the profile back to a draft so the
// normal application form opens pre-filled with the previous answers.
//
// Usage: reapplyCard({ h, api: { dispatcherReapply }, onReopened }) -> HTMLElement
const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch (_) { return String(iso || ''); }
};
const daysUntil = (iso) => Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));

export function reapplyCard({ h, api, onReopened }) {
  const body = h('div', { 'aria-live': 'polite' }, [h('div', { class: 'cp-row-s' }, 'Checking when you can re-apply…')]);
  const card = h('div', { class: 'cp-card', style: 'border-color:rgba(8,131,247,.4)' }, [
    h('div', { class: 'cp-cardhead' }, [h('h3', null, '↻ Apply again')]),
    body,
  ]);
  const set = (kids) => { body.replaceChildren(...(Array.isArray(kids) ? kids : [kids]).filter(Boolean)); };
  const line = (t, style) => h('div', { class: 'cp-row-s', style: 'line-height:1.7;' + (style || '') }, t);

  const paint = (r) => {
    if (!r || r.error) {
      return set([line('We could not check your re-application status just now. Please refresh in a moment.', 'color:#fca5a5'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:10px', onClick: load }, 'Try again')]);
    }
    if (r.reason === 'not_rejected') { card.hidden = true; return; }
    if (r.reason === 'limit') {
      return set(line('You have used all ' + (r.max || 3) + ' re-applications for this role. If your situation has changed materially, write to hello@loadboot.com and we will take a look.'));
    }
    if (r.reason === 'cooldown') {
      const n = daysUntil(r.available_at);
      return set([
        line('You can re-apply from ' + fmtDate(r.available_at) + ' (' + n + ' day' + (n === 1 ? '' : 's') + ' from now). Your account and your previous answers are kept.'),
        line('Use the time to close the gap named in the note above — for most applicants that means your own active load-board login (DAT, Truckstop or 123Loadboard) and loads you have booked independently.', 'margin-top:6px;opacity:.85'),
      ]);
    }
    // eligible
    const err = h('div', { class: 'cp-row-s', style: 'color:#fca5a5;margin-top:8px', role: 'alert' }, '');
    const btn = h('button', { class: 'cp-btn cp-btn-lg', style: 'margin-top:12px' }, 'Update my application & re-apply');
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
    set([
      line('You are welcome to apply again. Your previous answers are saved — we will reopen your application as a draft so you can update what has changed, then submit it for a fresh review.'),
      line('Re-applications left after this one: ' + Math.max(0, (r.remaining || 1) - 1) + '.', 'margin-top:6px;opacity:.85'),
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
