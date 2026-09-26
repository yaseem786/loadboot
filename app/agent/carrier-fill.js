// carrier-fill.js — bl_disp_0459: the dispatcher's guided carrier work sheet (Trucks tab of the dispatcher workspace).
//
// The moment a carrier is assigned, its profile / preferences / unit facts become a work sheet:
//   • anything already on file (carrier or LoadBoot) is READ-ONLY here, with a source pill;
//   • every EMPTY field that matters is an open task at the top, with a progress count;
//   • a guided call script sits above the tasks (click-to-call through the LoadBoot dialer — the tel: links
//     carry class dw-tel so shared/dialer.js intercepts them);
//   • every value the dispatcher types is stamped dispatcher / user / time on the server (dispatcher_carrier_fill);
//     the dispatcher may correct his OWN earlier entry, never a carrier / LoadBoot value.
// Server: public.dispatcher_carrier_gaps(p_assignment) → the sheet; public.dispatcher_carrier_fill(...) → one field.
// Mounted by dispatcher-workspace.js with a single call; everything else lives here.

import { dispatcherCarrierGaps, dispatcherCarrierFill } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon as sharedIcon } from '../shared/ui/icons.js';

const h = el;
const ic = (n, s) => { try { return sharedIcon(n, s || 14); } catch (_) { return ''; } };
const CSS = `
.cf-wrap{margin-top:12px;border:1px solid rgba(124,192,255,.28);border-radius:14px;background:linear-gradient(180deg,rgba(8,131,247,.10),rgba(16,34,59,.35));padding:12px 14px}
.cf-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.cf-head b{color:#7cc0ff;display:inline-flex;align-items:center;gap:6px;font-size:.98rem}
.cf-prog{flex:1;min-width:160px;max-width:320px;display:flex;align-items:center;gap:8px;font-size:.8rem;color:#9fb3c8}
.cf-prog i{flex:1;height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;display:block}
.cf-prog i b{display:block;height:100%;background:linear-gradient(90deg,#0883F7,#4ade80);border-radius:99px;transition:width .3s}
.cf-done{color:#4ade80;font-weight:800}
.cf-script{margin-top:10px;border-radius:10px;border:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.18)}
.cf-script summary{cursor:pointer;padding:9px 12px;font-weight:800;color:#fff;display:flex;align-items:center;gap:8px;list-style:none}
.cf-script summary::-webkit-details-marker{display:none}
.cf-step{display:grid;grid-template-columns:26px 1fr;gap:8px;padding:8px 12px;border-top:1px solid rgba(255,255,255,.06);font-size:.86rem;line-height:1.55}
.cf-step .n{width:22px;height:22px;border-radius:50%;background:#0883F7;color:#fff;font-weight:800;font-size:.75rem;display:grid;place-items:center;margin-top:2px}
.cf-step .t{color:#fff;font-weight:800}.cf-step .d{color:#c9d6e5}
.cf-call{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.cf-call a.dw-tel{border:1px solid rgba(159,195,255,.5);border-radius:99px;padding:5px 11px;font-weight:700}
.cf-tasks{margin-top:10px}
.cf-task{display:grid;grid-template-columns:minmax(150px,1fr) minmax(180px,1.4fr) auto;gap:10px;align-items:start;padding:9px 0;border-top:1px solid rgba(255,255,255,.07)}
.cf-task .lbl{color:#fff;font-weight:700;font-size:.88rem}.cf-task .lbl small{display:block;color:#9fb3c8;font-weight:500;font-size:.76rem;margin-top:2px;line-height:1.45}
.cf-task .unit{display:inline-block;margin-left:6px;font-size:.7rem;padding:1px 6px;border-radius:99px;border:1px solid rgba(255,255,255,.25);color:#cbd5e1;vertical-align:middle}
.cf-task .dw-in,.cf-task textarea,.cf-task select{width:100%;box-sizing:border-box}
.cf-task textarea{min-height:56px;resize:vertical}
.cf-sec{margin-top:14px}.cf-sec>b{color:#7cc0ff;display:inline-flex;align-items:center;gap:6px}
.cf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 12px;margin-top:6px}
.cf-f{padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);min-width:0}
.cf-f .k{font-size:.72rem;color:#9fb3c8;text-transform:uppercase;letter-spacing:.03em}
.cf-f .v{color:#fff;font-weight:600;font-size:.88rem;display:flex;justify-content:space-between;gap:6px;align-items:center;word-break:break-word}
.cf-f.empty .v{color:#fbbf24;font-weight:500}
.cf-pill{font-size:.66rem;padding:1px 7px;border-radius:99px;border:1px solid currentColor;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;font-weight:700}
.cf-pill.carrier{color:#93c5fd}.cf-pill.staff,.cf-pill.system{color:#fbbf24}.cf-pill.dispatcher{color:#4ade80}.cf-pill.open{color:#fbbf24;border-style:dashed}
.cf-pen{background:none;border:0;color:#7cc0ff;cursor:pointer;padding:0 2px;display:inline-flex}
.cf-more summary{cursor:pointer;color:#9fb3c8;font-size:.82rem;padding:6px 0}
@media (max-width:640px){.cf-task{grid-template-columns:1fr}.cf-task .dw-btn{width:100%}}
`;

let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; document.head.appendChild(h('style', { id: 'cf-css' }, CSS)); }

const fmtDay = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (_) { return ''; } };
function show(f) {
  const v = f.value;
  if (v == null || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.join(', ') : null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (f.kind === 'money') return '$' + Number(v).toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function pill(f) {
  if (f.empty) return h('span', { class: 'cf-pill open' }, 'open');
  const s = f.source || {}; const role = s.role || 'carrier';
  const who = role === 'dispatcher' ? (s.by_name ? s.by_name : 'You') : role === 'carrier' ? 'Carrier' : 'LoadBoot';
  return h('span', { class: 'cf-pill ' + role, title: role === 'carrier' ? 'Entered by the carrier in their portal — read-only for you' : role === 'dispatcher' ? 'Added by a dispatcher' + (s.at ? ' on ' + fmtDay(s.at) : '') : 'Set by the LoadBoot team — read-only for you' },
    [f.locked ? ic('lock', 10) : null, who + (role === 'dispatcher' && s.at ? ' · ' + fmtDay(s.at) : '')]);
}

export function mountCarrierFill(host, assignment, opts) {
  opts = opts || {};
  ensureCss();
  const toast = opts.toast || ((m) => console.log(m));
  let data = null; let reloadTimer = null;
  const scheduleReload = () => { if (!opts.reload) return; clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { try { opts.reload(); } catch (_) {} }, 4000); };

  mount(host, h('div', { class: 'cf-wrap' }, [h('div', { class: 'dw-muted' }, [ic('refresh', 14), ' Loading the carrier work sheet…'])]));
  refresh();

  async function refresh() {
    try {
      const r = await dispatcherCarrierGaps(assignment.id);
      if (!r || r.error) throw new Error((r && r.error) || 'no data');
      data = r; render();
    } catch (e) {
      // server not deployed yet / offline → the plain preferences block the tab showed before bl_disp_0459
      mount(host, [h('div', { class: 'dw-muted', style: 'margin-top:10px;font-size:.8rem' }, [ic('alert', 13), ' Carrier work sheet unavailable right now (' + (e.message || e) + ').']), opts.fallback ? opts.fallback() : null]);
    }
  }

  async function save(f, value, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const r = await dispatcherCarrierFill(assignment.id, f.tbl, f.field, value, f.truck_id || null);
      if (!r || r.error) throw new Error((r && (r.message || r.error)) || 'save failed');
      toast(f.label + (f.unit_no ? ' (unit ' + f.unit_no + ')' : '') + ' saved');
      await refresh(); scheduleReload();
    } catch (e) {
      toast(e.message || String(e), true);
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  function input(f, current) {
    const cur = current == null ? '' : Array.isArray(current) ? current.join(', ') : String(current);
    const listId = f.options && f.options.length ? 'cf-dl-' + f.tbl + '-' + f.field : null;
    const dl = listId ? h('datalist', { id: listId }, f.options.map((o) => h('option', { value: o }))) : null;
    let node;
    if (f.kind === 'bool') node = h('select', { class: 'dw-in' }, [h('option', { value: '' }, 'Choose…'), h('option', { value: 'true', selected: current === true ? '' : undefined }, 'Yes'), h('option', { value: 'false', selected: current === false ? '' : undefined }, 'No')]);
    else if (f.kind === 'textarea') node = h('textarea', { class: 'dw-in', placeholder: 'Type what the owner said…' }, cur);
    else if (f.kind === 'number' || f.kind === 'money') node = h('input', { class: 'dw-in', type: 'number', inputmode: 'decimal', step: f.kind === 'money' ? '0.01' : '1', min: '0', placeholder: f.kind === 'money' ? '0.00' : '0', value: cur });
    else node = h('input', { class: 'dw-in', type: 'text', value: cur, list: listId || null, placeholder: f.kind === 'list' ? 'Comma-separated' + (f.options ? ' — e.g. ' + f.options.slice(0, 3).join(', ') : '') : f.options ? 'e.g. ' + f.options.slice(0, 2).join(' / ') : '' });
    const read = () => {
      const v = node.value;
      if (v == null || String(v).trim() === '') return null;
      if (f.kind === 'bool') return v === 'true';
      if (f.kind === 'number' || f.kind === 'money') return Number(v);
      if (f.kind === 'list') return String(v).split(',').map((x) => x.trim()).filter(Boolean);
      return String(v).trim();
    };
    return { node: dl ? h('div', null, [node, dl]) : node, read, focus: () => node.focus() };
  }

  function taskRow(f, editing) {
    const inp = input(f, editing ? f.value : null);
    const btn = h('button', { class: 'dw-btn sm', onClick: () => { const v = inp.read(); if (v == null && !editing) { toast('Type the answer first', true); inp.focus(); return; } save(f, v, btn); } }, editing ? 'Update' : 'Save');
    if (!editing) inp.node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && f.kind !== 'textarea') { e.preventDefault(); btn.click(); } });
    return h('div', { class: 'cf-task', 'data-field': f.tbl + '.' + f.field + (f.truck_id ? '.' + f.truck_id : '') }, [
      h('div', { class: 'lbl' }, [f.label, f.unit_no ? h('span', { class: 'unit' }, 'Unit ' + f.unit_no) : null, f.why ? h('small', null, f.why) : null]),
      inp.node, btn,
    ]);
  }

  function field(f) {
    const v = show(f);
    const own = !f.empty && !f.locked;
    const box = h('div', { class: 'cf-f' + (f.empty ? ' empty' : '') }, [
      h('div', { class: 'k' }, [f.label, f.unit_no ? ' · unit ' + f.unit_no : '']),
      h('div', { class: 'v' }, [h('span', null, v == null ? 'not on file' : v), h('span', { style: 'display:inline-flex;gap:4px;align-items:center' }, [pill(f),
        own ? h('button', { class: 'cf-pen', title: 'Correct your own entry', onClick: () => mount(box, [h('div', { class: 'k' }, f.label), taskRow(f, true)]) }, ic('pen', 12)) : null])]),
    ]);
    return box;
  }

  function render() {
    const d = data; const fields = d.fields || [];
    const open = fields.filter((f) => f.empty && f.core);
    const more = fields.filter((f) => f.empty && !f.core);
    const pct = d.total_core ? Math.round(100 * (d.total_core - d.open_core) / d.total_core) : 100;
    const groups = [['profile', 'Carrier profile', 'building'], ['prefs', 'Carrier preferences', 'filter'], ['truck', 'Unit / truck', 'truck']];
    const units = [...new Map(fields.filter((f) => f.tbl === 'truck').map((f) => [f.truck_id, f.unit_no])).entries()];

    mount(host, h('div', { class: 'cf-wrap' }, [
      h('div', { class: 'cf-head' }, [
        h('b', null, [ic('clipboard', 16), ' Carrier work sheet']),
        h('div', { class: 'cf-prog' }, [h('i', null, h('b', { style: 'width:' + pct + '%' })), d.open_core ? h('span', null, d.open_core + ' of ' + d.total_core + ' still open') : h('span', { class: 'cf-done' }, [ic('check', 12), ' All ' + d.total_core + ' answered'])]),
      ]),
      h('div', { class: 'dw-muted', style: 'font-size:.8rem;margin-top:4px;line-height:1.5' }, 'Values already on file were entered by the carrier or LoadBoot and are locked for you. Fill the blanks on the call; every answer you add is stamped with your name and the date, and LoadBoot sees it.'),

      // guided call script
      h('details', { class: 'cf-script', open: d.open_core ? '' : undefined }, [
        h('summary', null, [ic('phone', 15), ' Guided call — introduce yourself, then walk the open tasks', h('span', { class: 'cf-pill ' + (d.track === 'B' ? 'staff' : 'dispatcher'), style: 'margin-left:auto' }, 'Track ' + d.track)]),
        ...(d.script || []).map((s) => h('div', { class: 'cf-step' }, [h('div', { class: 'n' }, String(s.step)), h('div', null, [h('div', { class: 't' }, s.title), h('div', { class: 'd' }, s.text),
          s.step === 1 ? h('div', { class: 'cf-call' }, [
            d.phone ? h('a', { href: 'tel:' + d.phone, class: 'dw-tel', 'data-name': (d.contact_name || d.carrier_name || 'Carrier'), title: 'Call with your LoadBoot phone' }, [ic('phone', 13), ' Call owner ' + d.phone]) : h('span', { class: 'cf-pill open' }, 'No owner phone on file — ask in the WhatsApp group; it is an open task below'),
            d.driver && d.driver.phone ? h('a', { href: 'tel:' + d.driver.phone, class: 'dw-tel', 'data-name': (d.driver.name || 'Driver') + ' (driver)', title: 'Call the driver with your LoadBoot phone' }, [ic('phone', 13), ' Call driver ' + (d.driver.name || '') + ' ' + d.driver.phone]) : null,
          ]) : null])])),
      ]),

      // open tasks
      h('div', { class: 'cf-tasks' }, [
        h('b', { style: 'color:#fff;display:inline-flex;align-items:center;gap:6px' }, [ic('alert', 15), open.length ? ' Open tasks — ask these on the call (' + open.length + ')' : ' No open tasks — the core profile is complete']),
        !d.has_trucks ? h('div', { class: 'dw-muted', style: 'margin-top:4px' }, 'No active truck on file — unit questions appear once LoadBoot adds the truck.') : null,
        ...open.map((f) => taskRow(f, false)),
        more.length ? h('details', { class: 'cf-more' }, [h('summary', null, more.length + ' more to ask if there is time (optional fields)'), ...more.map((f) => taskRow(f, false))]) : null,
      ]),

      // everything on file, with provenance
      ...groups.map(([tbl, title, icn]) => {
        if (tbl === 'truck') return units.length ? h('div', null, units.map(([tid, unit]) => h('div', { class: 'cf-sec' }, [h('b', null, [ic(icn, 15), ' Unit ' + (unit || '?')]), h('div', { class: 'cf-grid' }, fields.filter((f) => f.tbl === 'truck' && f.truck_id === tid).map(field))]))) : null;
        const fs = fields.filter((f) => f.tbl === tbl); if (!fs.length) return null;
        return h('div', { class: 'cf-sec' }, [h('b', null, [ic(icn, 15), ' ' + title]), h('div', { class: 'cf-grid' }, fs.map(field))]);
      }),
    ]));
  }
}
