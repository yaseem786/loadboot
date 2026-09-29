// dispatchHold.js — bl_disp_0501: "Hold from dispatchers" on Carrier 360.
// A held carrier stays visible in the dispatcher "Choose your carrier" list but is locked ("Not available yet");
// choosing it is refused by the database. Existing assignments are not touched; staff can still assign directly.
import { ccCarrierDispatchHold } from '../../shared/api.js';
import { el, mount } from '../../shared/ui/dom.js';
import { toast } from '../../shared/errors.js';

const day = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return ''; } };
const BTN = 'cursor:pointer;font:inherit;font-size:12.5px;font-weight:700;padding:6px 12px;border-radius:8px;border:1px solid ';

export function dispatchHoldPanel(orgId) {
  const host = el('div', { class: 'cc-sub', style: 'margin-top:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:12.5px;line-height:1.5' }, 'Loading dispatcher availability…');
  let busy = false;
  async function run(on, reason) {
    if (busy) return; busy = true;
    try {
      const r = await ccCarrierDispatchHold(orgId, on, reason);
      if (!r || r.error) throw new Error((r && r.error) || 'failed');
      if (on !== null) toast(on ? 'Held — dispatchers now see “Not available yet”' : 'Released — dispatchers can choose this carrier again');
      paint(r);
    } catch (e) { mount(host, 'Dispatcher hold unavailable: ' + (e.message || e)); }
    busy = false;
  }
  function paint(r) {
    if (r.held) {
      mount(host, [
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('b', { style: 'color:#0f172a' }, 'Dispatcher list'),
          el('span', { style: 'font-size:.68rem;font-weight:800;padding:1px 8px;border-radius:99px;border:1px solid #b45309;color:#b45309' }, 'HELD · Not available yet'),
          el('span', null, (r.reason ? r.reason + ' · ' : '') + (r.set_by_name ? r.set_by_name + ' · ' : '') + (r.set_at ? day(r.set_at) : '')),
          el('button', { type: 'button', style: BTN + '#15803d;background:#f0fdf4;color:#15803d;margin-left:auto', onClick: () => run(false) }, 'Release for dispatchers'),
        ]),
        el('div', { style: 'margin-top:4px' }, 'Dispatchers see this carrier in “Choose your carrier” but cannot pick it.'),
      ]);
    } else {
      const inp = el('input', { placeholder: 'Reason (internal) — e.g. owner not responding', style: 'flex:1;min-width:180px;font:inherit;font-size:12.5px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px' });
      mount(host, [
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('b', { style: 'color:#0f172a' }, 'Dispatcher list'),
          el('span', { style: 'font-size:.68rem;font-weight:800;padding:1px 8px;border-radius:99px;border:1px solid #15803d;color:#15803d' }, 'Open'),
          inp,
          el('button', { type: 'button', style: BTN + '#b45309;background:#fffbeb;color:#b45309', onClick: () => run(true, inp.value) }, 'Hold from dispatchers'),
        ]),
        el('div', { style: 'margin-top:4px' }, 'Hold keeps the carrier visible to dispatchers but locked (“Not available yet”). It does not end a current assignment.'),
      ]);
    }
  }
  run(null);
  return host;
}
