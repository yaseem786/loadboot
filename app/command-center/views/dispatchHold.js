// dispatchHold.js — Carrier 360 "Dispatcher list" control.
// bl_disp_0501: Hold   = carrier stays in the dispatcher "Choose your carrier" list but locked ("Not available yet").
// bl_disp_0525: Hide   = carrier is unpublished — dispatchers do not see it at all and cannot choose it.
//               Open   = listed and choosable.
// None of these end a current assignment; staff can still assign directly.
// Falls back to the 0501 hold-only RPC when cc_carrier_dispatch_visibility is not deployed yet.
import { ccCarrierDispatchHold, ccCarrierDispatchVisibility } from '../../shared/api.js';
import { el, mount } from '../../shared/ui/dom.js';
import { toast } from '../../shared/errors.js';

const day = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return ''; } };
const BTN = 'cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:8px;border:1px solid ';
const STATE = {
  open:   { pill: 'Published', color: '#15803d', help: 'Dispatchers see this carrier in “Choose your carrier” and can pick it.' },
  hold:   { pill: 'HELD · Not available yet', color: '#b45309', help: 'Dispatchers see this carrier but cannot pick it.' },
  hidden: { pill: 'HIDDEN · Unpublished', color: '#b91c1c', help: 'Dispatchers do not see this carrier at all and cannot pick it.' },
};
const TOAST = {
  open: 'Published — dispatchers can see and choose this carrier',
  hold: 'Held — dispatchers now see “Not available yet”',
  hidden: 'Hidden — this carrier no longer appears to dispatchers',
};

export function dispatchHoldPanel(orgId) {
  const host = el('div', { class: 'cc-sub', style: 'margin-top:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:12.5px;line-height:1.5' }, 'Loading dispatcher availability…');
  let busy = false, legacy = false;

  async function call(mode, reason) {
    if (!legacy) {
      try {
        const r = await ccCarrierDispatchVisibility(orgId, mode, reason);
        if (r && !r.error) return r;
        if (r && r.error) throw new Error(r.error);
      } catch (e) {
        const m = String((e && e.message) || e);
        if (!/cc_carrier_dispatch_visibility|could not find|does not exist|PGRST202/i.test(m)) throw e;
        legacy = true;   // new RPC not deployed on this DB yet — hold-only mode
      }
    }
    if (mode === 'hidden') throw new Error('Hide needs the bl_disp_0525 update on this database');
    const r = await ccCarrierDispatchHold(orgId, mode === null ? null : mode === 'hold', reason);
    if (!r || r.error) throw new Error((r && r.error) || 'failed');
    return Object.assign({ mode: r.held ? 'hold' : 'open' }, r);
  }

  async function run(mode, reason) {
    if (busy) return; busy = true;
    try {
      const r = await call(mode, reason);
      if (mode) toast(TOAST[mode]);
      paint(r);
    } catch (e) { toast('Dispatcher list: ' + (e.message || e)); if (mode === null) mount(host, 'Dispatcher list control unavailable: ' + (e.message || e)); }
    busy = false;
  }

  function paint(r) {
    const mode = STATE[r.mode] ? r.mode : (r.held ? 'hold' : 'open');
    const st = STATE[mode];
    const inp = el('input', { placeholder: 'Reason (internal) — e.g. owner not responding, profile incomplete', value: mode === 'open' ? '' : (r.reason || ''), style: 'flex:1;min-width:200px;font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px' });
    const btn = (m, label, color, bg) => mode === m ? null
      : el('button', { type: 'button', style: BTN + color + ';background:' + bg + ';color:' + color, onClick: () => run(m, m === 'open' ? null : inp.value) }, label);
    mount(host, [
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
        el('b', { style: 'color:#0f172a' }, 'Dispatcher list'),
        el('span', { style: 'font-size:.68rem;font-weight:800;padding:1px 8px;border-radius:99px;border:1px solid ' + st.color + ';color:' + st.color }, st.pill),
        mode !== 'open' ? el('span', null, (r.reason ? r.reason + ' · ' : '') + (r.set_by_name ? r.set_by_name + ' · ' : '') + (r.set_at ? day(r.set_at) : '')) : null,
      ]),
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px' }, [
        mode === 'open' ? inp : null,
        btn('open', 'Publish to dispatchers', '#15803d', '#f0fdf4'),
        btn('hold', 'Hold (visible, locked)', '#b45309', '#fffbeb'),
        legacy ? null : btn('hidden', 'Hide from dispatchers', '#b91c1c', '#fef2f2'),
      ]),
      el('div', { style: 'margin-top:6px;color:#64748b' }, st.help + ' A current assignment is not affected.'),
    ]);
  }

  run(null);
  return host;
}
