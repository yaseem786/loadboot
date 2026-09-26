// carrier-fill.js — bl_disp_0459 (v2, 26 Sep 2026): the dispatcher fills the carrier file IN PLACE.
//
// Yaseen's rule: no separate "guide" block. The three sections the Trucks tab already shows — Carrier profile,
// Carrier preferences (set by the owner), Unit/Truck — plus Availability each get a short guide line on top,
// and inside each section every EMPTY field becomes editable right where it sits ("ask this, type it, Save").
// A value already on file (carrier / LoadBoot) stays read-only with a source pill; a value the dispatcher adds
// is saved live to the real table (so Carrier 360 / dispatcher 360 pick it up with no extra step) and shows
// "You · date" — CC sees "Dispatcher · <name> · date" on the same field.
//
// How it hooks in (dispatcher-workspace.js changes are 5 attributes + 1 call):
//   [data-carrier=<org>]                       the carrier card
//   [data-fill=profile] / [data-fill=prefs]    the dw-grid inside the carrier card / preferences block
//   [data-truck=<id>] [data-fill=truck]        the spec grid of each unit card
//   [data-truck=<id>] [data-fill=avail]        the availability box (guide only — availability itself is unchanged)
//   mountCarrierFill(root, assignments, { reload, toast })   after the tab is built
// Server: public.dispatcher_carrier_gaps(p_assignment) → fields + provenance; public.dispatcher_carrier_fill(...) → one field.

import { dispatcherCarrierGaps, dispatcherCarrierFill } from '../shared/api.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon as sharedIcon } from '../shared/ui/icons.js';

const h = el;
const ic = (n, s) => { try { return sharedIcon(n, s || 14); } catch (_) { return ''; } };
const CSS = `
.cf-guide{margin:8px 0 6px;padding:8px 11px;border-radius:10px;border:1px solid rgba(124,192,255,.28);background:rgba(8,131,247,.08);font-size:.83rem;line-height:1.55;color:#c9d6e5}
.cf-guide b{color:#fff}.cf-guide .s{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#0883F7;color:#fff;font-weight:800;font-size:.72rem;margin-right:6px;vertical-align:-4px}
.cf-guide ol{margin:4px 0 0 18px;padding:0}.cf-guide li{margin:1px 0}
.cf-strip{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 2px;font-size:.82rem;color:#9fb3c8}
.cf-strip i{flex:1;min-width:120px;max-width:260px;height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;display:block}
.cf-strip i b{display:block;height:100%;background:linear-gradient(90deg,#0883F7,#4ade80);border-radius:99px}
.cf-strip a.dw-tel{border:1px solid rgba(159,195,255,.5);border-radius:99px;padding:4px 10px;font-weight:700}
.cf-done{color:#4ade80;font-weight:800}
.cf-num{display:inline-flex;align-items:center;gap:4px;border:1px solid rgba(159,195,255,.35);border-radius:99px;padding:3px 6px 3px 10px;color:#e8eefc;font-weight:700;white-space:nowrap}
.cf-num .who{color:#9fb3c8;font-weight:600;margin-right:2px}.cf-num a.dw-tel{border:0;padding:2px 6px;background:rgba(8,131,247,.25);border-radius:99px}
.cf-num button{background:none;border:0;color:#7cc0ff;cursor:pointer;padding:2px 4px;display:inline-flex;align-items:center}
.cf-post{margin:8px 0 6px;padding:9px 12px;border-radius:10px;border:1px solid rgba(74,222,128,.35);background:rgba(74,222,128,.07);font-size:.84rem;line-height:1.55;color:#c9d6e5}
.cf-post b{color:#fff}.cf-post .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;margin-top:4px}.cf-post .g span{color:#9fb3c8;font-size:.72rem;text-transform:uppercase;letter-spacing:.03em;display:block}.cf-post .g div{color:#fff;font-weight:700}
.cf-post.stale{border-color:rgba(251,191,36,.4);background:rgba(251,191,36,.06)}
.cf-pill{font-size:.64rem;padding:1px 6px;border-radius:99px;border:1px solid currentColor;white-space:nowrap;display:inline-flex;align-items:center;gap:3px;font-weight:700;margin-left:6px;vertical-align:middle}
.cf-pill.carrier{color:#93c5fd}.cf-pill.staff,.cf-pill.system{color:#fbbf24}.cf-pill.dispatcher{color:#4ade80}.cf-pill.open{color:#fbbf24;border-style:dashed}
.cf-pen{background:none;border:0;color:#7cc0ff;cursor:pointer;padding:0 2px;display:inline-flex;vertical-align:middle;margin-left:4px}
.dw-f.cf-edit{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.05)}
.dw-f.cf-edit .k{color:#fbbf24}
.cf-ask{font-size:.74rem;color:#9fb3c8;line-height:1.4;margin:2px 0 4px;font-weight:500}
.cf-row{display:flex;gap:6px;align-items:center}.cf-row .dw-in{flex:1;min-width:0;padding:6px 8px;font-size:.86rem}.cf-row textarea.dw-in{min-height:48px}
.cf-row .dw-btn.sm{padding:6px 10px}
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; document.head.appendChild(h('style', { id: 'cf-css' }, CSS)); }

// grid label (as dispatcher-workspace.js prints it) → catalog field
const MAP = {
  profile: { 'MC': 'mc', 'USDOT': 'dot', 'Contact': 'contact_name', 'Phone': 'phone', 'WhatsApp': 'whatsapp' },
  prefs: { 'Rate floor': 'min_rpm', 'Target rate': 'target_rpm', 'Home base': 'home_base', 'Home time': 'home_time', 'Preferred lanes': 'preferred_lanes', 'Avoid states': 'avoid_states',
    'Equipment': 'preferred_equipment', 'Haul type': 'haul_types', 'Load size': 'load_size', 'Operating radius': 'operating_radius_miles', 'Max deadhead': 'max_deadhead_miles', 'Max weight': 'max_weight_lbs',
    'Hazmat': 'hazmat', 'Team drivers': 'team_drivers', 'Weekends': 'weekend_ok', 'Round trips': 'round_trip_pref', 'Notice needed': 'min_notice_hours', 'Services': 'services', 'Likes': 'facility_likes', 'Avoids': 'facility_dislikes' },
  truck: { 'Payload': 'payload_lbs', 'Pallet positions': 'pallet_positions', 'Trailer': 'trailer_type', 'Domicile': 'domicile_city', 'Max radius': 'max_radius_miles', 'Home time': 'home_time', 'Temp control': 'temp_control' },
};

const cell = (k, v) => v == null || v === '' ? null : h('div', null, [h('span', null, k), h('div', null, v)]);
const ago = (d) => { try { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; } catch (_) { return ''; } };
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
  const s = f.source || {}; const role = f.empty ? 'open' : (s.role || 'carrier');
  if (role === 'open') return h('span', { class: 'cf-pill open' }, 'ask');
  const who = role === 'dispatcher' ? (s.by_name || 'You') + (s.at ? ' · ' + fmtDay(s.at) : '') : role === 'carrier' ? 'Carrier' : 'LoadBoot';
  return h('span', { class: 'cf-pill ' + role, title: role === 'carrier' ? 'Entered by the carrier in their portal — read-only for you' : role === 'dispatcher' ? 'Added by a dispatcher' : 'Set by the LoadBoot team — read-only for you' }, [f.locked ? ic('lock', 9) : null, who]);
}

const GUIDE = {
  profile: (d) => h('div', { class: 'cf-guide' }, [h('span', { class: 's' }, '1'), h('b', null, 'Introduce yourself, then confirm the file. '),
    '“Hi ' + (d.contact_name || 'there') + ', this is ' + (d.dispatcher_name || 'your dispatcher') + ' with LoadBoot Dispatch — LoadBoot has appointed me your dedicated dispatcher effective today. Do you have five minutes so I can confirm what I have on file and start finding you loads?” ',
    'Read the MC and USDOT back digit by digit. Anything marked ', h('span', { class: 'cf-pill open', style: 'margin:0 2px' }, 'ask'), ' below: ask it and type the answer while you are on the call. Locked values were set by the carrier or LoadBoot — if the owner says one is wrong, tell LoadBoot in the Messages thread, do not argue it on the call. No answer? Try the driver, then message the owner from Texts → WhatsApp in your dock (the LoadBoot line).']),
  prefs: () => h('div', { class: 'cf-guide' }, [h('span', { class: 's' }, '2'), h('b', null, 'How the owner wants to run. '),
    'Floor first (“the lowest all-in rate per mile you will run?”), then the target, home base and home-time rule, lanes he likes, states he avoids, notice the driver needs, radius / deadhead, weekends. Every blank is a question; every answer goes straight into the field and is saved with your name.']),
  truck: (unit) => h('div', { class: 'cf-guide' }, [h('span', { class: 's' }, '3'), h('b', null, 'Confirm ' + (unit ? 'unit ' + unit : 'this unit') + '. '),
    'Trailer type and length, payload, what is on board (straps, load bars, chains, tarps, pallet jack, liftgate), where it parks when empty. One unit at a time — brokers ask exactly these.']),
  avail: (d) => h('div', { class: 'cf-guide' }, [h('span', { class: 's' }, '4'), h('b', null, 'Where is the truck now, and when is it empty? '),
    'Nothing posted by the carrier or the driver yet. Ask on the call and set it below — this is your daily line (status, empty at / from, must be home by, HOS, driver). ',
    h('b', null, 'Better: the carrier posts it themselves, then it lands here automatically and you never have to ask. Tell the owner exactly this: '),
    h('ol', null, [
      h('li', null, 'Open the LoadBoot app (carrier portal) → tap the blue “Post” button at the bottom of any screen (also: Dashboard → Availability card, or Fleet → “+ Post availability”).'),
      h('li', null, 'Pick the truck (if more than one) → “Where the truck is / frees up”: state, then city.'),
      h('li', null, '“Available from → until”. Every post expires 24 h after it starts — confirm it every morning, or post the backhaul the moment you are booked.'),
      h('li', null, '“Where I want to end up”: a state / city, or Anywhere → Post. Your dispatcher and brokers see it immediately.'),
    ]),
    h('div', { style: 'margin-top:4px' }, d.track === 'B'
      ? 'Track B — nothing posted in the last 7 days: call first (steps 1–3), present today’s loads, post the same day, first booking by day 4.'
      : 'Track A — this carrier is active: day 1 send 2–3 genuine offers (Texts → WhatsApp on the LoadBoot line, or the Messages thread), daily for 3 days regardless of reply; call on day 3 or sooner if the owner engages.'),
  ]),
  // the carrier / driver already posted → nothing to ask; show the post, lock the section
  posted: (p, d) => h('div', { class: 'cf-post' + (p.live ? '' : ' stale') }, [
    h('div', null, [ic(p.live ? 'check' : 'alert', 14), ' ', h('b', null, (p.posted_by_role === 'driver' ? 'The driver' : p.posted_by_role === 'carrier' ? 'The carrier' : (p.posted_by_name || 'LoadBoot')) + ' posted this availability' + (p.posted_by_name && p.posted_by_role !== 'dispatcher' ? ' (' + p.posted_by_name + ')' : '') + ' — do not ask for it again. '),
      p.live ? 'Confirmed ' + ago(p.last_confirmed_at || p.created_at) + ' · live to brokers. Work from it; your daily line below only needs touching if something changes on a call.'
             : 'Last confirmed ' + ago(p.last_confirmed_at || p.created_at) + ' — the post is older than 24 h, so it is not live to brokers. Ask the owner to confirm it (the “Still available” tap in the app) or confirm what changed on your call.',
      h('span', { class: 'cf-pill ' + (p.posted_by_role === 'driver' ? 'carrier' : p.posted_by_role), style: 'margin-left:8px' }, [ic('lock', 9), p.posted_by_role === 'driver' ? 'Driver' : p.posted_by_role === 'carrier' ? 'Carrier' : 'LoadBoot'])]),
    h('div', { class: 'g' }, [
      cell('Truck is / frees up', [p.origin, p.origin_zip].filter(Boolean).join(' ')), cell('Available', fmtDay(p.available_from) + (p.available_to ? ' → ' + fmtDay(p.available_to) : '')),
      cell('Wants to end up', p.dest_pref || 'Anywhere'), cell('Equipment', Array.isArray(p.equipment) && p.equipment.length ? p.equipment.join(', ') : null),
      cell('Min $/mi', p.min_rpm != null ? '$' + Number(p.min_rpm).toFixed(2) : null), cell('Radius', p.radius_miles != null ? p.radius_miles + ' mi' : null),
      cell('HOS left', p.hos_drive_left_h != null ? p.hos_drive_left_h + ' h' : null), p.notes ? cell('Note', p.notes) : null,
    ]),
  ]),
};

export function mountCarrierFill(root, assignments, opts) {
  opts = opts || {}; ensureCss();
  const toast = opts.toast || ((m) => console.log(m));
  let reloadTimer = null;
  const scheduleReload = () => { if (!opts.reload) return; clearTimeout(reloadTimer); reloadTimer = setTimeout(() => { try { opts.reload(); } catch (_) {} }, 4000); };
  (assignments || []).forEach((a) => decorateAssignment(a));

  async function decorateAssignment(a) {
    const card = root.querySelector('[data-carrier="' + a.carrier_org_id + '"]'); if (!card) return;
    let d;
    try { d = await dispatcherCarrierGaps(a.id); if (!d || d.error) throw new Error((d && d.error) || 'no data'); }
    catch (e) { const g = h('div', { class: 'dw-muted', style: 'font-size:.78rem;margin-top:4px' }, [ic('alert', 12), ' Carrier work sheet unavailable right now (' + (e.message || e) + ').']); const t = card.querySelector('h3'); if (t) t.after(g); return; }
    if (!card.isConnected) return;   // the tab re-rendered while we were loading
    const fields = d.fields || [];
    // progress + click-to-call strip under the carrier title
    const strip = h('div', { class: 'cf-strip' });
    const title = card.querySelector('h3'); if (title) title.after(strip);
    const paintStrip = () => {
      const open = fields.filter((f) => f.core && f.empty).length, total = fields.filter((f) => f.core).length;
      const pct = total ? Math.round(100 * (total - open) / total) : 100;
      const num = (who, n, name, title) => h('span', { class: 'cf-num' }, [h('span', { class: 'who' }, who), n, ' ',
        h('a', { href: 'tel:' + n, class: 'dw-tel', 'data-name': name, title: title }, [ic('phone', 11), ' Call']),
        h('button', { type: 'button', title: 'Copy number', 'aria-label': 'Copy ' + n, onClick: () => { try { navigator.clipboard.writeText(n).then(() => toast('Copied ' + n)); } catch (_) { toast('Could not copy', true); } } }, ic('copy', 12))]);
      mount(strip, [h('span', null, [ic('clipboard', 13), ' Carrier file']), h('i', null, h('b', { style: 'width:' + pct + '%' })),
        open ? h('span', null, open + ' of ' + total + ' still to ask') : h('span', { class: 'cf-done' }, [ic('check', 12), ' all ' + total + ' answered']),
        d.phone ? num('Owner' + (d.contact_name ? ' · ' + d.contact_name : ''), d.phone, d.contact_name || d.carrier_name || 'Carrier', 'Call the owner from your LoadBoot line') : null,
        !d.phone && d.whatsapp ? num('Owner WhatsApp', d.whatsapp, d.contact_name || d.carrier_name || 'Carrier', 'Call the owner’s WhatsApp number from your LoadBoot line') : null,
        ...(d.drivers || []).map((dr) => num('Driver · ' + (dr.name || '?'), dr.phone, (dr.name || 'Driver') + ' (driver)', 'No answer from the owner? Call the driver')),
        !d.phone && !d.whatsapp ? h('span', { class: 'cf-pill open' }, 'No owner phone on file — it is the first open task below; until then message the owner from Texts → WhatsApp') : null]);
    };
    paintStrip();

    // profile + preferences grids in the carrier card
    decorateGrid(card.querySelector('[data-fill="profile"]'), 'profile', null, fields.filter((f) => f.tbl === 'profile'), GUIDE.profile(d));
    decorateGrid(card.querySelector('[data-fill="prefs"]'), 'prefs', null, fields.filter((f) => f.tbl === 'prefs'), GUIDE.prefs());
    // each unit card
    root.querySelectorAll('[data-truck]').forEach((tc) => {
      const tid = tc.getAttribute('data-truck'); const tf = fields.filter((f) => f.tbl === 'truck' && f.truck_id === tid); if (!tf.length) return;
      decorateGrid(tc.querySelector('[data-fill="truck"]'), 'truck', tid, tf, GUIDE.truck(tf[0].unit_no));
      const av = tc.querySelector('[data-fill="avail"]');
      if (av && !(av.previousElementSibling && (av.previousElementSibling.classList.contains('cf-guide') || av.previousElementSibling.classList.contains('cf-post')))) {
        const post = (d.postings || []).find((p) => p.truck_id === tid) || ((d.postings || []).filter((p) => !p.truck_id)[0] || null);
        av.before(post ? GUIDE.posted(post, d) : GUIDE.avail(d));
      }
    });

    function decorateGrid(grid, tbl, truckId, tf, guide) {
      if (!grid) return;
      if (!grid.previousElementSibling || !grid.previousElementSibling.classList.contains('cf-guide')) grid.before(guide);
      const map = MAP[tbl] || {}; const done = new Set();
      const LEGACY = tbl === 'profile' ? ['Home base', 'Carrier min $/mi', 'Max deadhead', 'Avoid states', 'Weekends', 'Factoring'] : [];
      grid.querySelectorAll('.dw-f').forEach((cell) => {
        const k = cell.querySelector('.k'); if (!k) return;
        if (LEGACY.includes(k.textContent.trim())) {
          if (cell.classList.contains('empty')) { cell.remove(); return; }   // asked in Preferences, not here
          if (!k.querySelector('.cf-pill')) k.appendChild(h('span', { class: 'cf-pill carrier', title: 'From the carrier’s signup — the Preferences section below is what you work from' }, [ic('lock', 9), 'Carrier · signup']));
          return;
        }
        const field = map[k.textContent.trim()]; if (!field) return;
        const f = tf.find((x) => x.field === field); if (!f) return;
        done.add(field); paintCell(cell, f);
      });
      // open fields the grid never printed (straps, trailer length, domicile state, haul type…) → new cells, core first
      tf.filter((f) => !done.has(f.field) && f.empty).sort((x, y) => (y.core - x.core)).forEach((f) => {
        const cell = h('div', { class: 'dw-f' }, [h('div', { class: 'k' }, f.label), h('div', { class: 'v' }, '—')]); grid.appendChild(cell); paintCell(cell, f);
      });
    }

    function paintCell(cell, f) {
      const k = cell.querySelector('.k'); const v = cell.querySelector('.v'); if (!k || !v) return;
      k.querySelectorAll('.cf-pill, .cf-pen').forEach((x) => x.remove());
      if (f.empty) { cell.classList.add('cf-edit'); cell.classList.remove('empty'); k.appendChild(pill(f)); mount(v, editor(f, cell, false)); return; }
      cell.classList.remove('cf-edit'); k.appendChild(pill(f));
      if (!f.locked) k.appendChild(h('button', { class: 'cf-pen', title: 'Correct your own entry', onClick: () => { cell.classList.add('cf-edit'); mount(v, editor(f, cell, true)); } }, ic('pen', 11)));
      if (f.source && f.source.role === 'dispatcher') { const s = show(f); if (s != null && v.textContent.trim() === '—') v.textContent = s; }
    }

    function editor(f, cell, editing) {
      const cur = editing ? f.value : null;
      const curS = cur == null ? '' : Array.isArray(cur) ? cur.join(', ') : String(cur);
      const listId = f.options && f.options.length ? 'cf-dl-' + f.tbl + '-' + f.field : null;
      let node;
      if (f.kind === 'bool') node = h('select', { class: 'dw-in' }, [h('option', { value: '' }, 'Yes / No?'), h('option', { value: 'true', selected: cur === true ? '' : undefined }, 'Yes'), h('option', { value: 'false', selected: cur === false ? '' : undefined }, 'No')]);
      else if (f.kind === 'textarea') node = h('textarea', { class: 'dw-in', placeholder: 'What the owner said…' }, curS);
      else if (f.kind === 'number' || f.kind === 'money') node = h('input', { class: 'dw-in', type: 'number', inputmode: 'decimal', step: f.kind === 'money' ? '0.01' : '1', min: '0', placeholder: f.kind === 'money' ? '$ per mile' : f.label, value: curS });
      else node = h('input', { class: 'dw-in', type: 'text', value: curS, list: listId, placeholder: f.kind === 'list' ? 'comma-separated' + (f.options ? ' · e.g. ' + f.options.slice(0, 2).join(', ') : '') : (f.options ? 'e.g. ' + f.options.slice(0, 2).join(' / ') : f.label) });
      const read = () => { const x = node.value; if (x == null || String(x).trim() === '') return null; if (f.kind === 'bool') return x === 'true'; if (f.kind === 'number' || f.kind === 'money') return Number(x); if (f.kind === 'list') return String(x).split(',').map((s) => s.trim()).filter(Boolean); return String(x).trim(); };
      const btn = h('button', { class: 'dw-btn sm', onClick: () => { const val = read(); if (val == null && !editing) { toast('Type the answer first', true); node.focus(); return; } save(f, val, cell, btn); } }, editing ? 'Update' : 'Save');
      node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && f.kind !== 'textarea') { e.preventDefault(); btn.click(); } });
      return [h('div', { class: 'cf-ask' }, 'Ask: ' + (f.why || f.label)), h('div', { class: 'cf-row' }, [node, listId ? h('datalist', { id: listId }, f.options.map((o) => h('option', { value: o }))) : null, btn])];
    }

    async function save(f, val, cell, btn) {
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const r = await dispatcherCarrierFill(a.id, f.tbl, f.field, val, f.truck_id || null);
        if (!r || r.error) throw new Error((r && (r.message || r.error)) || 'save failed');
        f.value = r.value; f.empty = r.value == null; f.locked = false; f.source = r.source;
        const v = cell.querySelector('.v'); mount(v, show(f) == null ? '—' : show(f)); paintCell(cell, f); paintStrip();
        toast(f.label + (f.unit_no ? ' (unit ' + f.unit_no + ')' : '') + ' saved — LoadBoot sees it as added by you'); scheduleReload();
      } catch (e) { toast(e.message || String(e), true); btn.disabled = false; btn.textContent = 'Save'; }
    }
  }
}
