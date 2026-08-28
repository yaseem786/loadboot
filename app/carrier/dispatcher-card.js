// dispatcher-card.js — carrier-portal card: "Your LoadBoot dispatcher" + the shared 3-way thread.
// Mounted from the carrier dashboard via dynamic import (same pattern as economics.js). Renders
// nothing when the carrier has no active dispatcher assignment. Backend: bl_disp_0288
// (carrier_my_dispatcher, dispatcher_thread_list/send — both accept carrier org members).
import { carrierMyDispatcher, dispatcherThreadList, dispatcherThreadSend, dispatcherSetAvailability } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon } from '../shared/ui/icons.js';

const h = el;
const dtLocal = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
const when = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export async function mountDispatcherCard(host) {
  let rows = [];
  try { rows = await carrierMyDispatcher(); } catch (_) { rows = []; }
  if (!Array.isArray(rows) || !rows.length) { host.remove(); return; }
  const a = rows[0]; const d = a.dispatcher || {};
  const thread = h('div', { style: 'max-height:260px;overflow:auto;padding:4px 2px;margin:8px 0' });
  const inp = h('textarea', { class: 'cp-in', rows: 2, placeholder: 'Message your dispatcher (LoadBoot sees this too)…' });
  const err = h('div', { class: 'cp-err', style: 'display:none' });
  async function paint() {
    try {
      const r = await dispatcherThreadList(a.assignment_id, 100); if (r && r.error) throw new Error(r.error);
      const ms = (r && r.messages) || [];
      mount(thread, ms.length ? ms.map((m) => h('div', { style: 'max-width:82%;padding:8px 11px;border-radius:13px;margin:5px 0;' + (m.mine ? 'margin-left:auto;background:rgba(8,131,247,.18);border:1px solid rgba(8,131,247,.35)' : 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)') }, [
        h('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.65' }, (m.role === 'system' ? 'LoadBoot' : m.role === 'staff' ? 'LoadBoot staff' : m.role) + (m.by && !m.mine ? ' · ' + m.by : '') + ' · ' + when(m.at)),
        h('div', { style: 'white-space:pre-wrap' }, m.body),
      ])) : h('div', { class: 'cp-muted' }, 'No messages yet — your dispatcher will reach out here with pickup details and updates.'));
      thread.scrollTop = thread.scrollHeight;
    } catch (e) { mount(thread, h('div', { class: 'cp-muted' }, e.message || 'Could not load messages.')); }
  }
  function availRow(t) {
    const av = t.availability || {}; const box = h('div', { style: 'padding:8px 0;border-top:1px solid rgba(255,255,255,.08)' });
    const view = () => mount(box, h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
      h('div', { style: 'flex:1;min-width:200px' }, [h('b', { style: 'color:#fff' }, 'Unit ' + (t.unit_no || '?') + (t.equipment ? ' · ' + t.equipment : '')),
        h('div', { class: 'cp-row-s' }, [(av.status || 'empty').toUpperCase(), av.empty_location ? ' · empty at ' + av.empty_location + (av.empty_at ? ' from ' + when(av.empty_at) : '') : ' · location not set', av.must_be_home_by ? ' · home by ' + when(av.must_be_home_by) : '', av.hos_drive_left_h != null ? ' · HOS ' + av.hos_drive_left_h + ' h' : '', av.updated_at ? ' · updated ' + ago(av.updated_at) : ''])]),
      h('button', { class: 'cp-btn cp-btn-sm', onClick: edit }, 'Update'),
    ]));
    const edit = () => {
      const I = (k, type) => h('input', { class: 'cp-in', type: type || 'text', value: av[k] == null ? '' : (type === 'datetime-local' ? dtLocal(av[k]) : String(av[k])) });
      const st = h('select', { class: 'cp-in' }, ['empty', 'loaded', 'off', 'maintenance'].map((v) => h('option', { value: v, selected: (av.status || 'empty') === v }, v.toUpperCase())));
      const loc = I('empty_location'), eat = I('empty_at', 'datetime-local'), home = I('must_be_home_by', 'datetime-local'), hloc = I('home_location'), hos = I('hos_drive_left_h', 'number'), dn = I('driver_name'), dp = I('driver_phone'), note = h('input', { class: 'cp-in', value: av.note || '', placeholder: 'anything your dispatcher should know' });
      const owe = h('input', { type: 'checkbox', checked: av.overnight_weekends === true }), owd = h('input', { type: 'checkbox', checked: av.overnight_weekdays !== false });
      const e2 = h('div', { class: 'cp-err', style: 'display:none' });
      const L = (l, x) => h('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:.74rem;font-weight:800;opacity:.85' }, [l, x]);
      mount(box, h('div', null, [h('b', { style: 'color:#fff' }, 'Unit ' + (t.unit_no || '?')), h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:6px 0' }, [
        L('Status', st), L('Empty at (City, ST)', loc), L('Empty from', eat), L('Must be home by', home), L('Home location', hloc), L('Drive hours left', hos), L('Driver', dn), L('Driver phone', dp),
        h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:.8rem' }, [owd, 'Overnight OK weekdays']), h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:.8rem' }, [owe, 'Overnight OK weekends']),
      ]), note, e2, h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [
        h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.target.disabled = true; try { const r = await dispatcherSetAvailability(t.id, { status: st.value, empty_location: loc.value, empty_at: fromLocal(eat.value), must_be_home_by: fromLocal(home.value), home_location: hloc.value, hos_drive_left_h: hos.value || null, driver_name: dn.value, driver_phone: dp.value, overnight_weekdays: owd.checked, overnight_weekends: owe.checked, note: note.value }); if (r && r.error) throw new Error(r.error); Object.assign(av, { status: st.value, empty_location: loc.value, empty_at: fromLocal(eat.value), must_be_home_by: fromLocal(home.value), hos_drive_left_h: hos.value || null, updated_at: new Date().toISOString() }); view(); } catch (x) { e2.textContent = x.message; e2.style.display = 'block'; ev.target.disabled = false; } } }, 'Save'),
        h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: view }, 'Cancel'),
      ])]));
    };
    view(); return box;
  }
  const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => {
    if (!inp.value.trim()) return; send.disabled = true; err.style.display = 'none';
    try { const r = await dispatcherThreadSend(a.assignment_id, inp.value); if (r && r.error) throw new Error(r.error); inp.value = ''; await paint(); }
    catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    send.disabled = false;
  } }, 'Send');
  mount(host, h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [h('h3', { style: 'display:flex;align-items:center;gap:8px' }, [icon('users', 18), 'Your LoadBoot dispatcher'])]),
    h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
      h('div', { style: 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff' }, String(d.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()),
      h('div', null, [h('div', { style: 'font-weight:900;color:#fff' }, d.name || 'Dispatcher'), h('div', { class: 'cp-row-s' }, [d.status === 'trial' ? 'On trial with LoadBoot' : 'LoadBoot dispatcher', d.country ? ' · ' + d.country : '', ' · since ' + when(a.assigned_at)])]),
    ]),
    h('div', { class: 'cp-row-s', style: 'margin-top:8px;line-height:1.6' }, 'They find and book loads under your MC, send you the rate confirmation, and keep the broker updated. Every load is approved by LoadBoot before your driver moves. Keep your truck’s location and home-time current so they can plan.'),
    (a.trucks || []).length ? h('div', { style: 'margin-top:12px' }, [h('div', { style: 'font-weight:900;color:#fff;margin-bottom:4px' }, 'Where is your truck? (your dispatcher plans from this)'), ...(a.trucks || []).map((t) => availRow(t))]) : null,
    thread, inp, err,
    h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [send, h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: paint }, 'Refresh')]),
  ]));
  paint();
}

export default mountDispatcherCard;
