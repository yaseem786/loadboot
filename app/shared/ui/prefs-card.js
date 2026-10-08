// prefs-card.js — bl_pref_0536 (8 Oct 2026, owner): ONE "Dispatch preferences" card for the three places a carrier's
// preferences are read — CC → Carrier 360 (🎯 card), the dispatcher work sheet (Trucks tab) and the carrier's own
// portal (Account → Dispatch, compact on My Profile). Same tiles, same words, same dark premium look (brand tokens
// docs/brand-kit/loadboot-tokens.css — navy / blue / light-blue, orange only as the accent).
//
//   prefsCard(pf, opts)  → element
//     pf          the carrier_dispatch_prefs row (cc_carrier_prefs / cc_get_dispatch_prefs / assignment.prefs)
//     opts.viewer 'carrier' | 'dispatcher' | 'staff'   — decides the provenance wording and which buttons show
//     opts.sources { [field]: { role, by_name, at } }   — from carrier_field_sources; the carrier reads
//                 "Updated by your dispatcher on Oct 8" when the last change was not theirs. Staff notes never pass here.
//     opts.suggestions  pending bl_fill_0534 rows (tbl = 'prefs'); shown ON the field with Accept / Keep mine (carrier),
//                 Accept / Reject (staff) or "Suggested · pending" (dispatcher). opts.onDecide(row, accept) → Promise
//     opts.onEdit      "Edit" button (carrier portal: opens the existing form — the form's own save path is reused)
//     opts.compact     first 8 answered tiles + "+N more" (My Profile)
//     opts.bare        grid only, no card chrome (inside an existing card)
//     opts.fillCompat  tiles carry the dispatcher work sheet's classes (dw-grid / dw-f / .k / .v) and the catalog
//                 labels, so carrier-fill.js keeps editing empty fields in place and pinning provenance pills.
// Mobile-first: 2 columns under 600px, 1 column under 380px.
import { el, mount } from './dom.js';

const HOME_TIME = { daily: 'Home daily', weekly: 'Home weekly', biweekly: 'Every 2 weeks', '2_weeks': 'Every 2 weeks', flexible: 'Flexible',
  otr: 'OTR — out as long as it pays', local: 'Local — home every night', regional_daily: 'Regional, home daily', weekends: 'Home on weekends' };
const ROUND = { any: 'One-way is fine', prefer: 'Round trips preferred', only: 'Round trips only' };
const LOAD = { full: 'Full truckload', partial: 'Partials', both: 'Full or partial' };
const HAUL = { local: 'Local (≤250 mi)', regional: 'Regional (250–800 mi)', otr: 'OTR (800+ mi)' };
export const PREF_LABELS = { HOME_TIME, ROUND, LOAD, HAUL };

const money = (v) => (v == null || v === '' ? null : '$' + Number(v).toFixed(2));
const num = (v) => (v == null || v === '' ? null : Number(v).toLocaleString('en-US'));
const arr = (v, map) => (Array.isArray(v) && v.length ? v.map((x) => (map && map[String(x).toLowerCase()]) || x).join(', ') : null);
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);
// label text = the dispatcher work sheet's catalog labels (carrier-fill.js MAP.prefs) — do not rename
const FIELDS = [
  ['min_rpm', 'Rate floor', (p) => money(p.min_rpm) ? money(p.min_rpm) + '/mi' + (p.min_rpm_basis ? ' (' + p.min_rpm_basis + ' miles)' : '') : (p.min_total_rate != null ? money(p.min_total_rate) + ' minimum' : null)],
  ['target_rpm', 'Target rate', (p) => money(p.target_rpm) ? money(p.target_rpm) + '/mi' : null],
  ['cost_per_mile', 'Cost per mile', (p) => money(p.cost_per_mile) ? money(p.cost_per_mile) + '/mi' : null],
  ['preferred_equipment', 'Equipment', (p) => arr(p.preferred_equipment)],
  ['haul_types', 'Haul type', (p) => arr(p.haul_types, HAUL)],
  ['home_base', 'Home base', (p) => p.home_base || null],
  ['operating_radius_miles', 'Operating radius', (p) => num(p.operating_radius_miles) ? num(p.operating_radius_miles) + ' mi' : null],
  ['max_deadhead_miles', 'Max deadhead', (p) => num(p.max_deadhead_miles) ? num(p.max_deadhead_miles) + ' mi' : null],
  ['preferred_lanes', 'Preferred lanes', (p) => arr(p.preferred_lanes)],
  ['avoid_states', 'Avoid states', (p) => arr(p.avoid_states)],
  ['home_time', 'Home time', (p) => (p.home_time ? HOME_TIME[p.home_time] || p.home_time : null)],
  ['round_trip_pref', 'Round trips', (p) => (p.round_trip_pref ? ROUND[p.round_trip_pref] || p.round_trip_pref : null)],
  ['weekend_ok', 'Weekends', (p) => yn(p.weekend_ok)],
  ['min_notice_hours', 'Notice needed', (p) => (p.min_notice_hours != null && p.min_notice_hours !== '' ? p.min_notice_hours + ' h' : null)],
  ['_trip', 'Trip length', (p) => (p.min_trip_miles != null || p.max_trip_miles != null ? (num(p.min_trip_miles) || '0') + ' – ' + (num(p.max_trip_miles) || '∞') + ' mi' : null)],
  ['max_weight_lbs', 'Max weight', (p) => num(p.max_weight_lbs) ? num(p.max_weight_lbs) + ' lb' : null],
  ['load_size', 'Load size', (p) => (p.load_size ? LOAD[p.load_size] || p.load_size : null)],
  ['hazmat', 'Hazmat', (p) => yn(p.hazmat)],
  ['team_drivers', 'Team drivers', (p) => yn(p.team_drivers)],
  ['services', 'Services', (p) => arr(p.services)],
  ['facility_likes', 'Likes', (p) => arr(p.facility_likes)],
  ['facility_dislikes', 'Avoids', (p) => arr(p.facility_dislikes)],
];

const CSS = `
.lbp{--lbp-navy:#10223B;--lbp-blue:#0883F7;--lbp-blue-l:#4EA6F9;--lbp-orange:#f9a86b;--lbp-ink:#eaf1fb;--lbp-ink2:#c3d1e6;--lbp-muted:#7f92b3;--lbp-line:rgba(255,255,255,.09);--lbp-panel:rgba(255,255,255,.045);
  background:linear-gradient(135deg,#10223B 0%,#0a1020 100%);color:var(--lbp-ink);border:1px solid var(--lbp-line);border-radius:16px;padding:14px 16px 12px;box-shadow:0 18px 40px -30px rgba(15,30,54,.8);font-size:.86rem;line-height:1.45}
.lbp.bare{background:none;border:0;border-radius:0;padding:0;box-shadow:none}
.lbp-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.lbp-title{font-weight:800;font-size:1rem;color:#fff;display:flex;align-items:center;gap:8px;margin:0}
.lbp-sub{color:var(--lbp-muted);font-size:.78rem;font-weight:600;margin-top:2px}
.lbp-btn{background:var(--lbp-blue);color:#fff;border:0;border-radius:10px;padding:8px 14px;font:800 .82rem inherit;cursor:pointer;white-space:nowrap}
.lbp-btn.ghost{background:transparent;border:1px solid rgba(255,255,255,.22);color:var(--lbp-ink2)}
.lbp-btn:disabled{opacity:.55;cursor:default}
.lbp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px 10px}
.lbp-tile{background:var(--lbp-panel);border:1px solid var(--lbp-line);border-radius:12px;padding:8px 10px;min-width:0}
.lbp-tile.empty{opacity:.62;border-style:dashed}
.lbp-tile .k{font-size:.64rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--lbp-muted);display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.lbp-tile .v{font-weight:700;color:#fff;margin-top:2px;word-break:break-word}
.lbp-src{font-size:.68rem;color:var(--lbp-orange);font-weight:700;margin-top:3px}
.lbp-src.mine{color:var(--lbp-muted);font-weight:600}
.lbp-sug{margin-top:6px;padding:7px 9px;border-radius:9px;border:1px solid rgba(78,166,249,.45);background:rgba(8,131,247,.14);font-size:.76rem;color:var(--lbp-ink2);line-height:1.45}
.lbp-sug b{color:#fff}.lbp-sug .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.lbp-sug .lbp-btn{padding:5px 10px;font-size:.74rem}
.lbp-more{margin-top:8px;color:var(--lbp-blue-l);font-weight:700;font-size:.8rem;background:none;border:0;cursor:pointer;padding:0}
.lbp-empty{color:var(--lbp-muted);font-weight:600;padding:6px 2px}
@media(max-width:600px){.lbp-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:380px){.lbp-grid{grid-template-columns:minmax(0,1fr)}}
`;
let cssDone = false;
function ensureCss() { if (cssDone || document.getElementById('lbp-css')) { cssDone = true; return; } cssDone = true; document.head.appendChild(el('style', { id: 'lbp-css' }, CSS)); }
const day = (d) => { try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (_) { return ''; } };

function provenance(src, viewer) {
  if (!src || !src.role) return null;
  const when = src.at ? ' on ' + day(src.at) : '';
  if (viewer === 'carrier') {
    if (src.role === 'dispatcher') return el('div', { class: 'lbp-src' }, 'Updated by your dispatcher' + (src.by_name ? ' (' + src.by_name + ')' : '') + when);
    if (src.role === 'staff' || src.role === 'system') return el('div', { class: 'lbp-src' }, 'Updated by LoadBoot' + when);
    return null;   // the carrier's own answer needs no line
  }
  if (src.role === 'carrier') return el('div', { class: 'lbp-src mine' }, 'Carrier' + when);
  if (src.role === 'dispatcher') return el('div', { class: 'lbp-src' }, 'Dispatcher' + (src.by_name ? ' · ' + src.by_name : '') + when);
  return el('div', { class: 'lbp-src' }, 'LoadBoot' + (src.by_name ? ' · ' + src.by_name : '') + when);
}

function suggestionBlock(x, opts) {
  const who = x.source === 'call_ai' ? 'From your call' + (x.suggested_by_name ? ' with ' + x.suggested_by_name : '') : (opts.viewer === 'carrier' ? 'Your dispatcher suggests' : (x.suggested_by_name || 'Dispatcher') + ' suggests');
  const box = el('div', { class: 'lbp-sug', 'data-sug': String(x.id) }, [
    el('div', null, [el('b', null, who + ': '), (x.old_text && x.old_text !== '—' ? x.old_text + ' → ' : ''), el('b', null, x.new_text), x.reason ? el('span', { style: 'opacity:.85' }, ' — “' + x.reason + '”') : null]),
  ]);
  if (opts.viewer === 'dispatcher' || typeof opts.onDecide !== 'function') { box.appendChild(el('div', { class: 'row', style: 'color:#c4b5fd;font-weight:700' }, 'Waiting for the carrier / LoadBoot to confirm')); return box; }
  const btn = (t, ok, ghost) => el('button', { type: 'button', class: 'lbp-btn' + (ghost ? ' ghost' : ''), onClick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true;
    try { await opts.onDecide(x, ok); box.innerHTML = ''; box.appendChild(el('b', null, ok ? 'Accepted ✓' : (opts.viewer === 'carrier' ? 'Kept yours' : 'Rejected'))); setTimeout(() => { try { box.remove(); } catch (_) {} }, 1800); }
    catch (e) { b.disabled = false; try { alert((e && e.message) || 'Could not save.'); } catch (_) {} }
  } }, t);
  box.appendChild(el('div', { class: 'row' }, [btn('Accept', true, false), btn(opts.viewer === 'carrier' ? 'Keep mine' : 'Reject', false, true)]));
  return box;
}

export function prefsCard(pf, opts) {
  opts = opts || {}; ensureCss(); pf = pf || {};
  const viewer = opts.viewer || 'carrier';
  const sources = opts.sources || {};
  const sugs = (opts.suggestions || []).filter((x) => x && x.status === 'pending' && (x.tbl === 'prefs' || !x.tbl));
  const tiles = FIELDS.map(([field, label, fmt]) => ({ field, label, value: fmt(pf), src: sources[field] || null, sug: sugs.filter((x) => x.field === field) }));
  const answered = tiles.filter((t) => t.value != null);
  let show = tiles; let hidden = 0;
  if (opts.compact) { show = answered.slice(0, 8); hidden = answered.length - show.length; }
  const tile = (t) => el('div', { class: 'lbp-tile' + (opts.fillCompat ? ' dw-f' : '') + (t.value == null ? ' empty' : ''), 'data-pref': t.field }, [
    el('div', { class: 'k' }, t.label),
    el('div', { class: 'v' }, t.value == null ? '—' : t.value),
    t.value != null ? provenance(t.src, viewer) : null,
    ...t.sug.map((x) => suggestionBlock(x, opts)),
  ].filter(Boolean));
  const gridAttrs = { class: 'lbp-grid' + (opts.fillCompat ? ' dw-grid' : '') }; if (opts.fillCompat) gridAttrs['data-fill'] = 'prefs';
  const grid = el('div', gridAttrs, show.map(tile));
  // suggestions on fields the grid does not print (none today, but the catalog can grow)
  const orphan = sugs.filter((x) => !FIELDS.some((f) => f[0] === x.field)).map((x) => suggestionBlock(x, opts));
  const parts = [];
  if (!opts.bare) {
    const head = el('div', { class: 'lbp-head' }, [
      el('div', null, [el('h3', { class: 'lbp-title' }, [opts.icon == null ? '🎯 ' : opts.icon, opts.title || 'Dispatch preferences']),
        el('div', { class: 'lbp-sub' }, opts.sub || (answered.length ? answered.length + ' of ' + FIELDS.length + ' answered' + (pf.updated_at ? ' · updated ' + day(pf.updated_at) : '') : 'Nothing set yet'))]),
      typeof opts.onEdit === 'function' ? el('button', { type: 'button', class: 'lbp-btn' + (answered.length ? ' ghost' : ''), onClick: opts.onEdit }, answered.length ? 'Edit' : 'Set preferences') : null,
    ].filter(Boolean));
    parts.push(head);
  }
  if (!answered.length && opts.compact) parts.push(el('div', { class: 'lbp-empty' }, 'No dispatch preferences yet — set them so loads match the way you run.'));
  else parts.push(grid);
  if (hidden > 0) parts.push(el('button', { type: 'button', class: 'lbp-more', onClick: (ev) => { mount(grid, answered.map(tile)); ev.currentTarget.remove(); } }, '+' + hidden + ' more'));
  orphan.forEach((o) => parts.push(o));
  if (pf.notes && !opts.compact && viewer !== 'carrier') parts.push(el('div', { class: 'lbp-sub', style: 'margin-top:8px;white-space:pre-wrap' }, 'Owner note: ' + pf.notes));
  const root = el('div', { class: 'lbp' + (opts.bare ? ' bare' : ''), 'data-lb': 'prefs-card' }, parts);
  root.lbpGrid = grid;
  return root;
}
// sources helper: carrier_field_sources rows → { field: {role, by_name, at} } for tbl = 'prefs'
export function prefsSourcesMap(rows) {
  const m = {};
  (rows || []).forEach((r) => { if (r && (r.tbl === 'prefs' || !r.tbl) && r.field) m[r.field] = { role: r.role || r.set_by_role, by_name: r.by_name, at: r.at || r.set_at }; });
  return m;
}
export default prefsCard;
