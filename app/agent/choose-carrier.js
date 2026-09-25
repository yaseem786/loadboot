// choose-carrier.js — "Choose your carrier": the Carrier Fleet Book inside the dispatcher portal (bl_disp_0442).
//
// Yaseen 25 Sep 2026: until now a candidate who passed the skills test was e-mailed a hand-built PDF
// ("LoadBoot · Carrier Fleet Book") and asked to reply with the carrier they wanted. Now the portal does
// it: the moment the pass is released, this tab lists every AVAILABLE carrier with the same depth as the
// book — truck specs, loading gear, preferences and floor, FMCSA authority age, cargo, timeline, and the
// NULL / CONFIRM items to collect on the first call. Carriers whose equipment the candidate said they can
// manage come first ("exact match"); when there is none the screen says so and still lets them choose.
// Choosing puts the carrier on hold, tells Command Center (card + e-mail) and sends the candidate a
// receipt; CC's Accept starts the trial and assigns the carrier in one step.
//
// Everything that decides is on the SERVER: eligibility, availability, the hold, the match. This module
// only paints what dispatcher_carrier_options() returns. What a candidate may see before an assignment is
// decided there too (no owner/driver names, phones, dockets, documents, bank/factoring).
import { dispatcherCarrierOptions, dispatcherChooseCarrier, dispatcherWithdrawChoice } from '../shared/api.js';
import { lockPage, unlockPage } from '../shared/ui/scrollLock.js';

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach((c) => c != null && c !== false && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach((c) => c && el.appendChild(c)); };

// ---------------------------------------------------------------- formatting
const fmtD = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(iso); } };
const fmtDT = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (_) { return String(iso); } };
const num = (n) => (n == null || n === '' ? null : Number(n).toLocaleString('en-US'));
const lbs = (n) => (n == null ? null : num(n) + ' lb');
const inFt = (i) => { if (i == null) return null; const f = Math.floor(i / 12), r = i % 12; return f + ' ft' + (r ? ' ' + r + ' in' : ''); };
const money = (n, dp) => (n == null ? null : '$' + Number(n).toFixed(dp == null ? 2 : dp));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, ' ') : s);
const list = (a, sep) => (Array.isArray(a) && a.length ? a.join(sep || ' · ') : null);
const yesNo = (v, y, n) => (v === true ? y : v === false ? n : null);
const pad2 = (n) => String(n).padStart(2, '0');

const MATCH = {
  exact: ['#4ade80', 'rgba(74,222,128,.14)', 'rgba(74,222,128,.45)', 'EXACT MATCH'],
  partial: ['#fbbf24', 'rgba(251,191,36,.12)', 'rgba(251,191,36,.4)', 'PARTIAL MATCH'],
  related: ['#7cc0ff', 'rgba(8,131,247,.14)', 'rgba(8,131,247,.4)', 'RELATED CLASS'],
  unknown: ['#94a3b8', 'rgba(148,163,184,.12)', 'rgba(148,163,184,.35)', 'EQUIPMENT NOT ON FILE'],
  none: ['#f87171', 'rgba(248,113,113,.12)', 'rgba(248,113,113,.4)', 'OUTSIDE YOUR EQUIPMENT'],
};

// ---------------------------------------------------------------- scoped styles (dark portal, matches the workspace)
const CSS = `
.cyc,.cyc *{box-sizing:border-box;min-width:0}
.cyc{--line:rgba(130,165,225,.16);--panel:rgba(255,255,255,.03);--ink:#eaf1fb;--mut:#9fb0c9;--blue:#4EA6F9;--orange:#FC5305;font-family:Manrope,Inter,system-ui,sans-serif;color:var(--ink)}
.cyc-hero{border-radius:20px;padding:22px 18px;margin-bottom:14px;background:linear-gradient(135deg,#10223B 0%,#0d2a4d 55%,#0b1f3d 100%);border:1px solid rgba(8,131,247,.35);position:relative;overflow:hidden}
.cyc-hero:before{content:"";position:absolute;right:-90px;top:-90px;width:280px;height:280px;border-radius:50%;background:radial-gradient(closest-side,rgba(8,131,247,.28),transparent)}
.cyc-kick{font-size:.7rem;font-weight:900;letter-spacing:.14em;color:#7cc0ff}
.cyc-h1{font-size:1.65rem;font-weight:900;color:#fff;margin:6px 0 6px;line-height:1.15;letter-spacing:-.01em}
.cyc-sub{color:#c7d5ea;line-height:1.65;max-width:680px;font-size:.93rem}
.cyc-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.cyc-kpi{flex:1;min-width:130px;border-radius:14px;padding:11px 13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.cyc-kpi b{display:block;font-size:1.35rem;color:#fff;line-height:1.1}
.cyc-kpi span{font-size:.68rem;font-weight:800;letter-spacing:.1em;color:#8ea2c3;text-transform:uppercase}
.cyc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.cyc-chip{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 10px;font-size:.76rem;font-weight:800;background:rgba(255,255,255,.07);color:#cbd5e1;border:1px solid rgba(255,255,255,.1)}
.cyc-chip.on{background:rgba(74,222,128,.14);color:#4ade80;border-color:rgba(74,222,128,.35)}
.cyc-chip.off{background:rgba(248,113,113,.1);color:#fca5a5;border-color:rgba(248,113,113,.3)}
.cyc-chip.warn{background:rgba(251,191,36,.12);color:#fde68a;border-color:rgba(251,191,36,.35)}
.cyc-banner{border-radius:16px;padding:14px 18px;margin-bottom:14px;display:flex;gap:12px;align-items:flex-start;line-height:1.55;font-size:.92rem}
.cyc-banner.ok{background:rgba(74,222,128,.09);border:1.5px solid rgba(74,222,128,.4);color:#d1fae5}
.cyc-banner.warn{background:rgba(251,191,36,.09);border:1.5px solid rgba(251,191,36,.45);color:#fef3c7}
.cyc-banner.info{background:rgba(8,131,247,.09);border:1.5px solid rgba(8,131,247,.4);color:#dbeafe}
.cyc-banner b{color:#fff}
.cyc-grid{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:820px){.cyc-grid{grid-template-columns:1fr 1fr}}
.cyc-card{border-radius:20px;padding:20px;overflow:hidden;background:var(--panel);border:1px solid var(--line);display:flex;flex-direction:column;gap:12px;position:relative;transition:border-color .15s,transform .15s}
.cyc-card:hover{border-color:rgba(8,131,247,.45);transform:translateY(-1px)}
.cyc-card.exact{border-color:rgba(74,222,128,.4);box-shadow:0 0 0 1px rgba(74,222,128,.12) inset}
.cyc-idx{font-size:.68rem;font-weight:900;letter-spacing:.14em;color:#7cc0ff}
.cyc-name{font-size:1.18rem;font-weight:900;color:#fff;line-height:1.2;margin-top:2px}
.cyc-line{color:var(--mut);font-size:.86rem;margin-top:3px;line-height:1.5}
.cyc-match{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:.7rem;font-weight:900;letter-spacing:.08em;text-align:center;flex:none;max-width:46%}
@media(min-width:520px){.cyc-match{white-space:nowrap;max-width:none}}
.cyc-tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media(min-width:520px){.cyc-tiles{grid-template-columns:repeat(4,1fr)}}
.cyc-tile{border-radius:12px;padding:10px 11px;background:rgba(8,131,247,.06);border:1px solid rgba(8,131,247,.18);min-width:0}
.cyc-tile b{display:block;color:#fff;font-size:1.02rem;line-height:1.15;overflow:hidden;text-overflow:ellipsis;overflow-wrap:anywhere}
.cyc-tile span{display:block;font-size:.64rem;font-weight:800;letter-spacing:.1em;color:#7cc0ff;text-transform:uppercase;margin-top:3px;line-height:1.3}
.cyc-tile.null b{color:#fca5a5;font-size:.86rem;font-weight:800}
.cyc-badges{display:flex;gap:6px;flex-wrap:wrap}
.cyc-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:4px}
.cyc-btn{border:0;border-radius:11px;padding:11px 16px;font-weight:800;font-size:.9rem;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:7px;transition:filter .12s}
.cyc-btn:hover{filter:brightness(1.08)}
.cyc-btn.p{background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff;flex:1;justify-content:center}
.cyc-btn.g{background:rgba(255,255,255,.07);color:#eaf1fb;border:1px solid rgba(255,255,255,.12)}
.cyc-btn.o{background:linear-gradient(135deg,#FC5305,#e04a03);color:#fff}
.cyc-btn.d{background:rgba(248,113,113,.12);color:#fca5a5;border:1px solid rgba(248,113,113,.3)}
.cyc-btn[disabled]{opacity:.55;cursor:default;filter:none}
.cyc-gaps{font-size:.82rem;color:#fde68a;line-height:1.5}
.cyc-tabs{display:flex;gap:6px;padding:6px;border-radius:16px;background:var(--panel);border:1px solid var(--line);margin-bottom:14px;overflow:auto}
.cyc-tab{flex:1;border:0;background:transparent;color:var(--mut);font-weight:800;font-family:inherit;padding:10px 14px;border-radius:12px;cursor:pointer;white-space:nowrap;font-size:.9rem}
.cyc-tab.on{background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff}
/* the book (sheet) */
.cyc-ovl{position:fixed;inset:0;background:rgba(2,8,20,.78);z-index:9400;display:flex;align-items:flex-end;justify-content:center;padding:0}
@media(min-width:760px){.cyc-ovl{align-items:center;padding:18px}}
.cyc-sheet{width:100%;max-width:980px;max-height:100dvh;overflow:auto;background:#0b1a30;border:1px solid rgba(130,165,225,.25);border-radius:22px 22px 0 0;color:var(--ink);font-family:Manrope,Inter,system-ui,sans-serif}
@media(min-width:760px){.cyc-sheet{border-radius:22px;max-height:92vh}}
.cyc-sh{position:sticky;top:0;z-index:2;background:linear-gradient(135deg,#10223B,#0d2a4d);padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:12px;align-items:flex-start}
.cyc-x{margin-left:auto;border:0;background:rgba(255,255,255,.08);color:#fff;width:36px;height:36px;border-radius:10px;font-size:1.2rem;cursor:pointer;flex:none}
.cyc-body{padding:18px 22px 26px;display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:760px){.cyc-body{grid-template-columns:1fr 1fr}.cyc-span{grid-column:1/-1}}
@media(max-width:519px){.cyc-head{flex-direction:column-reverse;align-items:flex-start}.cyc-match{max-width:none}.cyc-tab{font-size:.8rem;padding:9px 8px}.cyc-body{padding:14px 14px 22px}.cyc-sh{padding:14px 16px}.cyc-kv{grid-template-columns:1fr;gap:2px 0}.cyc-kv .k{margin-top:6px;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase}}
.cyc-sec{border-radius:16px;padding:16px 18px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
.cyc-sec h4{margin:0 0 10px;font-size:.7rem;font-weight:900;letter-spacing:.14em;color:#7cc0ff;text-transform:uppercase}
.cyc-kv{display:grid;grid-template-columns:38% 1fr;gap:6px 12px;font-size:.88rem;line-height:1.5}
.cyc-kv .k{color:var(--mut)}
.cyc-kv .v{color:#eaf1fb}
.cyc-kv .v.null{color:#fca5a5;font-weight:800;font-size:.8rem;letter-spacing:.06em}
.cyc-strip{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media(min-width:620px){.cyc-strip{grid-template-columns:repeat(4,1fr)}}
.cyc-strip .cyc-tile{background:#10223B;border-color:rgba(255,255,255,.1)}
.cyc-tl{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid rgba(8,131,247,.35);display:flex;flex-direction:column;gap:9px}
.cyc-tl li{position:relative;font-size:.86rem;line-height:1.45}
.cyc-tl li:before{content:"";position:absolute;left:-19px;top:6px;width:8px;height:8px;border-radius:50%;background:#0883F7}
.cyc-tl b{display:block;color:#fff}
.cyc-tl span{color:var(--mut)}
.cyc-stop{border-radius:14px;padding:12px 14px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);color:#fecaca;font-size:.86rem;line-height:1.55}
.cyc-note{border-radius:14px;padding:12px 14px;background:rgba(252,83,5,.08);border-left:3px solid #FC5305;color:#fed7aa;font-size:.86rem;line-height:1.55}
.cyc-ta{width:100%;min-height:90px;border-radius:12px;border:1px solid rgba(130,165,225,.25);background:rgba(255,255,255,.04);color:#fff;padding:10px 12px;font-family:inherit;font-size:.92rem;resize:vertical}
.cyc-steps{display:flex;flex-direction:column;gap:9px}
.cyc-step{display:flex;gap:12px;align-items:flex-start;font-size:.9rem;line-height:1.55;color:#cbd5e1}
.cyc-step i{flex:none;width:28px;height:28px;border-radius:9px;background:rgba(8,131,247,.16);color:#7cc0ff;display:grid;place-items:center;font-style:normal;font-weight:900}
.cyc-hist{font-size:.84rem;color:var(--mut);line-height:1.6}
`;
function ensureStyle() { if (!document.getElementById('cyc-style')) { const s = document.createElement('style'); s.id = 'cyc-style'; s.textContent = CSS; document.head.appendChild(s); } }

// ---------------------------------------------------------------- small pieces
const chip = (label, tone) => h('span', { class: 'cyc-chip' + (tone ? ' ' + tone : '') }, label);
const matchPill = (kind) => { const m = MATCH[kind] || MATCH.unknown; return h('span', { class: 'cyc-match', style: 'color:' + m[0] + ';background:' + m[1] + ';border:1px solid ' + m[2] }, m[3]); };
const tile = (val, label, opts) => h('div', { class: 'cyc-tile' + (val == null ? ' null' : '') + (opts && opts.cls ? ' ' + opts.cls : '') }, [h('b', null, val == null ? 'NULL' : String(val)), h('span', null, label)]);
const kv = (rows) => h('div', { class: 'cyc-kv' }, rows.filter((r) => r && r[1] !== undefined).flatMap((r) => [h('div', { class: 'k' }, r[0]), h('div', { class: 'v' + (r[1] == null ? ' null' : '') }, r[1] == null ? 'NULL — ask' : (r[1] instanceof Node ? r[1] : String(r[1])))]));
const sec = (title, body, span) => h('div', { class: 'cyc-sec' + (span ? ' cyc-span' : '') }, [h('h4', null, title), body]);

// the loading-gear chips of one truck (what the book prints under each unit)
function truckChips(t) {
  const c = [];
  const on = (v, l) => { if (v === true) c.push(chip(l, 'on')); else if (v === false) c.push(chip('no ' + l.toLowerCase(), 'off')); };
  on(t.dock_high, 'Dock-high'); on(t.liftgate, 'Liftgate' + (t.liftgate_cap_lbs ? ' ' + num(t.liftgate_cap_lbs) + ' lb' : ''));
  on(t.has_pallet_jack, 'Pallet jack'); on(t.has_ramp, 'Ramps'); on(t.has_etrack, 'E-track'); on(t.has_load_bars, 'Load bars');
  on(t.has_straps, 'Straps'); on(t.has_tarps, 'Tarps'); on(t.has_chains, 'Chains'); on(t.has_blankets, 'Blankets');
  if (t.twic) c.push(chip('TWIC', 'on')); if (t.tsa_sta) c.push(chip('TSA/STA', 'on')); if (t.bonded) c.push(chip('Bonded', 'on'));
  if (t.hazmat_placarded) c.push(chip('Hazmat placarded', 'warn')); if (t.team_driven) c.push(chip('Team', 'on'));
  if (t.temp_control && !/^(none|no)$/i.test(t.temp_control)) c.push(chip('Temp: ' + cap(t.temp_control) + (t.temp_min_f != null ? ' ' + t.temp_min_f + '–' + (t.temp_max_f != null ? t.temp_max_f : '?') + '°F' : ''), 'on'));
  return c;
}
const truckHead = (t) => [t.year, t.make, t.model].filter(Boolean).join(' ') || (t.equipment || 'Truck');
const truckLen = (t) => (t.trailer_len_ft ? t.trailer_len_ft + ' ft' : t.cargo_len_in ? inFt(t.cargo_len_in) : null);

// the four KPI tiles of the card: payload · deck/length · floor · radius (the PDF's strip)
function kpiTiles(b) {
  const t0 = (b.fleet && b.fleet.trucks && b.fleet.trucks[0]) || {};
  const p = b.prefs || {};
  const payload = t0.payload_lbs != null ? lbs(t0.payload_lbs) : (p.max_weight_lbs != null ? lbs(p.max_weight_lbs) : null);
  const len = truckLen(t0);
  const floor = p.min_rpm != null ? money(p.min_rpm) + '/mi' : null;
  const radius = p.operating_radius_miles != null ? num(p.operating_radius_miles) + ' mi' : (t0.max_radius_miles != null ? num(t0.max_radius_miles) + ' mi' : null);
  return h('div', { class: 'cyc-tiles' }, [
    tile(payload, 'Payload'), tile(len, t0.trailer_type ? 'Deck · ' + cap(t0.trailer_type) : 'Trailer / box length'),
    tile(floor, 'Rate floor' + (p.min_rpm_basis ? ' · ' + p.min_rpm_basis : '')),
    tile(radius, 'Radius' + (p.max_deadhead_miles != null ? ' · ' + num(p.max_deadhead_miles) + ' deadhead' : '')),
  ]);
}

function badges(b) {
  const a = b.authority || {}; const out = [];
  if (b.org && b.org.approved_at) out.push(chip('APPROVED ' + fmtD(b.org.approved_at).toUpperCase(), 'on'));
  if (a.age_label) out.push(chip('AUTHORITY ' + a.age_label.toUpperCase() + (a.age_band === 'new' ? ' · NEW' : a.age_band === 'established' ? ' · ESTABLISHED' : ''), a.age_band === 'new' ? 'warn' : ''));
  if (a.cdl_drivers != null) out.push(chip(a.cdl_drivers > 0 ? 'CDL' : 'NON-CDL'));
  if (a.out_of_service) out.push(chip('OUT OF SERVICE', 'off'));
  const t0 = (b.fleet && b.fleet.trucks && b.fleet.trucks[0]);
  if (t0 && t0.twic) out.push(chip('TWIC', 'on'));
  if (b.gaps && b.gaps.length) out.push(chip(b.gaps.length + ' TO CONFIRM', 'warn'));
  if (b.fleet && b.fleet.count === 0) out.push(chip('NO TRUCK ON FILE', 'off'));
  return h('div', { class: 'cyc-badges' }, out);
}

// ---------------------------------------------------------------- the full book (sheet)
function openBook(b, idx, onChoose) {
  const a = b.authority || {}, p = b.prefs || {}, ops = b.ops || {}, org = b.org || {};
  const close = () => { try { unlockPage(ovl); } catch (_) {} try { ovl.remove(); } catch (_) {} document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const trucks = (b.fleet && b.fleet.trucks) || [];
  const eb = p.external_boards || {};
  const boards = ['dat', 'truckstop'].filter((k) => eb[k] && eb[k] !== 'none').map((k) => (k === 'dat' ? 'DAT' : 'Truckstop') + (eb[k] === 'interested' ? ' (interested)' : ''));
  const cost = p.weekly_operating_cost != null ? money(p.weekly_operating_cost, 0) + (p.weekly_cost_includes_pay === true ? ' incl. driver pay' : p.weekly_cost_includes_pay === false ? ' excl. driver pay' : '') : null;
  const headline = org.summary || '';
  const ovl = h('div', { class: 'cyc-ovl', onClick: (e) => { if (e.target === ovl) close(); } }, [
    h('div', { class: 'cyc-sheet cyc', role: 'dialog', 'aria-modal': 'true' }, [
      h('div', { class: 'cyc-sh' }, [
        h('div', { style: 'min-width:0' }, [
          h('div', { class: 'cyc-kick' }, 'CARRIER ' + pad2(idx + 1) + ' · FLEET BOOK'),
          h('div', { class: 'cyc-h1', style: 'font-size:1.35rem' }, org.name || 'Carrier'),
          h('div', { class: 'cyc-line' }, headline),
          h('div', { style: 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [b.match_kind ? matchPill(b.match_kind) : null, badges(b)]),
        ]),
        h('button', { class: 'cyc-x', title: 'Close (Esc)', onClick: close }, '×'),
      ]),
      h('div', { class: 'cyc-body' }, [
        h('div', { class: 'cyc-strip cyc-span' }, kpiTiles(b).childNodes.length ? Array.from(kpiTiles(b).childNodes) : []),
        b.flags && b.flags.length ? h('div', { class: 'cyc-span' }, b.flags.map((f) => h('div', { class: 'cyc-note', style: 'margin-bottom:6px' }, f))) : null,
        sec('Account', kv([
          ['Who drives', ops.owner_drives === 'owner' ? 'Owner drives' : ops.owner_drives === 'both' ? 'Owner + employed driver' : ops.owner_drives === 'employed' ? 'Employed driver(s)' : (a.drivers != null ? a.drivers + ' driver' + (a.drivers === 1 ? '' : 's') + ' per FMCSA — ask who is on this truck' : null)],
          ['Home base', org.home_base || null],
          ['FMCSA' + (a.last_checked ? ' (' + fmtD(a.last_checked) + ')' : ''), a.authority_date ? 'Authority since ' + fmtD(a.authority_date) + (a.age_label ? ' · ' + a.age_label : '') + (a.status ? ' · ' + a.status : '') + (a.power_units != null ? ' · ' + a.power_units + ' power unit' + (a.power_units === 1 ? '' : 's') : '') + (a.drivers != null ? ' · ' + a.drivers + ' driver' + (a.drivers === 1 ? '' : 's') : '') + (a.cdl_drivers != null ? ' · ' + a.cdl_drivers + ' CDL' : '') + (a.out_of_service === false ? ' · not out of service' : a.out_of_service ? ' · OUT OF SERVICE' : '') + (a.safety_rating ? ' · rating ' + a.safety_rating : ' · no safety rating yet') : (a.status || null)],
          a.operation ? ['Operation', Array.isArray(a.operation) ? a.operation.join(', ') : String(a.operation)] : null,
          a.cargo ? ['Cargo (FMCSA)', Array.isArray(a.cargo) ? a.cargo.join(', ') : String(a.cargo)] : null,
          a.mcs150_mileage ? ['MCS-150 mileage', num(a.mcs150_mileage) + (a.mcs150_year ? ' (' + a.mcs150_year + ')' : '')] : null,
          a.broker_authority === true ? ['Broker authority', 'Also on this entity — ask about it'] : null,
          ['Loads booked', (ops.loads_booked || 0) + (ops.loads_booked ? '' : ' — LoadBoot was hiring the dispatcher')],
          ['Drivers on file', ops.drivers_on_file != null ? String(ops.drivers_on_file) : null],
        ])),
        sec('Preferences' + (p.updated_at ? ' (portal, updated ' + fmtD(p.updated_at) + ')' : ''), kv([
          ['Rate floor', p.min_rpm != null ? money(p.min_rpm) + '/mi' + (p.min_rpm_basis ? ' · ' + p.min_rpm_basis + ' miles' : '') + (p.target_rpm != null ? ' · target ' + money(p.target_rpm) + '/mi' : '') : null],
          ['Haul', [list((p.haul_types || []).map(cap), ' · '), p.round_trip_pref === 'only' ? 'round trips only' : p.round_trip_pref === 'prefer' ? 'round trips preferred' : null, p.operating_radius_miles != null ? 'radius ' + num(p.operating_radius_miles) + ' mi' : null, p.max_deadhead_miles != null ? 'deadhead ≤ ' + num(p.max_deadhead_miles) + ' mi' : null].filter(Boolean).join(' · ') || null],
          ['Load size', [p.load_size ? cap(p.load_size === 'both' ? 'Full or partial' : p.load_size) : null, p.max_weight_lbs != null ? 'max ' + lbs(p.max_weight_lbs) : null].filter(Boolean).join(' · ') || null],
          ['Services', list(p.services, ' · ')],
          ['Lanes', list(p.preferred_lanes, ' · ')],
          ['Avoid', list(p.avoid_states, ', ')],
          ['Weekends', yesNo(p.weekend_ok, 'OK', 'No — home every weekend')],
          ['Home time', p.home_time ? cap(p.home_time) : null],
          ['Likes', list(p.facility_likes, ' · ')],
          ['Dislikes', list(p.facility_dislikes, ' · ')],
          ['Boards', boards.length ? boards.join(' + ') : (eb.dat === 'none' && eb.truckstop === 'none' ? 'Not on DAT or Truckstop' : null)],
          ['Weekly cost', cost],
          p.hazmat === false ? ['Hazmat', 'No'] : p.hazmat === true ? ['Hazmat', 'Yes'] : null,
          p.team_drivers === true ? ['Team', 'Yes'] : null,
          p.dat_seat ? ['DAT seat', p.dat_seat === 'yes' ? 'Allowed' : p.dat_seat === 'no' ? 'Not allowed' : 'Allowed — seat has a cost'] : null,
          p.notes ? ['Notes', p.notes] : null,
          p.equipment_detail && p.equipment_detail.note ? ['Equipment note', p.equipment_detail.note] : null,
        ])),
        ...(trucks.length ? trucks.map((t, i) => sec('Truck · unit ' + (t.unit_no || (i + 1)), h('div', null, [
          kv([
            ['Power unit / truck', [truckHead(t), t.gvwr_class ? 'GVWR ' + t.gvwr_class : null, t.body ? t.body : null].filter(Boolean).join(' · ') || null],
            ['Equipment', [t.equipment, t.trailer_type ? cap(t.trailer_type) : null, truckLen(t)].filter(Boolean).join(' · ') || null],
            ['Payload', t.payload_lbs != null ? lbs(t.payload_lbs) : null],
            ['Cargo space', (t.cargo_len_in || t.cargo_width_in || t.cargo_height_in) ? [t.cargo_len_in ? t.cargo_len_in + '″ L' : null, t.cargo_width_in ? t.cargo_width_in + '″ W' : null, t.cargo_height_in ? t.cargo_height_in + '″ H' : null].filter(Boolean).join(' × ') + (t.pallet_positions ? ' · ' + t.pallet_positions + ' pallet positions' : '') : (t.pallet_positions ? t.pallet_positions + ' pallet positions' : undefined)],
            t.deck_height_in != null ? ['Deck height', t.deck_height_in + '″'] : null,
            t.door_type ? ['Doors', cap(t.door_type) + (t.door_width_in ? ' · ' + t.door_width_in + '″ × ' + (t.door_height_in || '?') + '″' : '')] : null,
            t.domicile ? ['Domiciled', t.domicile] : null,
            t.home_time ? ['Home time', cap(t.home_time)] : null,
            t.min_rpm != null ? ['Truck floor', money(t.min_rpm) + '/mi'] : null,
            t.inspection_exp ? ['Inspection valid to', fmtD(t.inspection_exp)] : null,
            t.availability && (t.availability.empty_location || t.availability.status) ? ['Last posted', [t.availability.status ? cap(t.availability.status) : null, t.availability.empty_location || null, t.availability.empty_at ? fmtD(t.availability.empty_at) : null].filter(Boolean).join(' · ') + (t.availability.updated_at ? ' (' + fmtD(t.availability.updated_at) + ')' : '')] : null,
            t.spec_note ? ['Spec note', t.spec_note] : null,
            t.capacity_note ? ['Capacity note', t.capacity_note] : null,
          ]),
          h('div', { class: 'cyc-badges', style: 'margin-top:10px' }, truckChips(t)),
        ]), trucks.length === 1)) : [sec('Truck', h('div', { class: 'cyc-stop' }, 'No truck on the portal record yet. Call one is a data call: unit(s), year/make, box or deck length, payload, liftgate, dock-high, pallet jack, who drives, floor rate, empty location — then it gets entered before anything is posted.'), true)]),
        b.gaps && b.gaps.length ? sec('Confirm on the first call', h('div', { class: 'cyc-stop' }, [h('div', { style: 'font-weight:800;color:#fff;margin-bottom:6px' }, 'NULL is empty in the portal — it is not zero and not "no".'),
          ...b.gaps.map((g, i) => h('div', null, (i + 1) + '. ' + g))]), true) : null,
        sec('Timeline', h('ul', { class: 'cyc-tl' }, (b.timeline || []).map((t) => h('li', null, [h('b', null, fmtD(t.at)), h('span', null, t.label)]))), false),
        sec('How to win this carrier', h('div', { class: 'cyc-steps' }, [
          ['1', 'Day 1 — intro + confirm. Ten-minute call: truck, empty location, availability, floor, the constraints above. Fix anything wrong in the portal the same hour.'],
          ['2', 'Day 1 — post the exact equipment under the carrier’s authority, with your U.S. number. No rounding.'],
          ['3', 'Day 2–3 — show the market: 2–3 real options a day in the WhatsApp group with rate, miles, RPM, commodity, weight, both windows.'],
          ['4', 'Day 2–4 — book one good load at or above the floor, inside the constraints, RC in the carrier’s name before the truck moves. Then a second.'],
        ].map((s) => h('div', { class: 'cyc-step' }, [h('i', null, s[0]), h('div', null, s[1])]))), false),
        h('div', { class: 'cyc-span', style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-top:4px' }, [
          onChoose ? h('button', { class: 'cyc-btn p', style: 'flex:0 1 auto;padding:13px 22px', onClick: () => { close(); onChoose(); } }, 'Choose ' + (org.name || 'this carrier')) : null,
          h('div', { class: 'cyc-line', style: 'flex:1;min-width:220px' }, 'Contact details, driver names and documents are issued through the carrier’s WhatsApp group after the assignment — not before. Dispatcher copy · confidential.'),
        ]),
      ]),
    ]),
  ]);
  document.body.appendChild(ovl); try { lockPage(ovl); } catch (_) {}
  document.addEventListener('keydown', onKey);
}

// ---------------------------------------------------------------- choose dialog
function confirmChoose(b) {
  return new Promise((resolve) => {
    const close = (v) => { try { unlockPage(back); } catch (_) {} try { back.remove(); } catch (_) {} resolve(v); };
    const ta = h('textarea', { class: 'cyc-ta', placeholder: 'Optional — one line for LoadBoot. E.g. “Ran hotshots out of Ohio for two years; know the Cincinnati building-material lanes.”' });
    const err = h('div', { class: 'cp-err', style: 'min-height:18px;margin-top:6px' });
    const ok = h('button', { class: 'cyc-btn p', onClick: () => close({ note: ta.value.trim() }) }, 'Yes — choose ' + ((b.org && b.org.name) || 'this carrier'));
    const back = h('div', { class: 'cyc-ovl cyc', onClick: (e) => { if (e.target === back) close(null); } }, [
      h('div', { class: 'cyc-sheet', style: 'max-width:520px;padding:22px' }, [
        h('div', { class: 'cyc-kick' }, 'CHOOSE YOUR CARRIER'),
        h('div', { class: 'cyc-h1', style: 'font-size:1.3rem' }, (b.org && b.org.name) || 'This carrier'),
        h('div', { class: 'cyc-sub', style: 'margin-bottom:12px' }, 'This puts the carrier on hold for you and sends your choice to LoadBoot. You can withdraw it until LoadBoot confirms. Once confirmed your paid trial starts and you receive the full operating brief.'),
        b.match_kind && b.match_kind !== 'exact' ? h('div', { class: 'cyc-note', style: 'margin-bottom:12px' }, (MATCH[b.match_kind] || MATCH.unknown)[3].toLowerCase().replace(/^./, (c) => c.toUpperCase()) + (b.match_missing && b.match_missing.length ? ' — this carrier runs ' + b.match_missing.join(' / ') + ', which you did not list in your application. Say in the note why you can handle it.' : '.')) : null,
        ta, err,
        h('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px' }, [h('button', { class: 'cyc-btn g', onClick: () => close(null) }, 'Not yet'), ok]),
      ]),
    ]);
    document.body.appendChild(back); try { lockPage(back); } catch (_) {}
  });
}

function askConfirm(title, body, okLabel, danger) {
  return new Promise((resolve) => {
    const close = (v) => { try { unlockPage(back); } catch (_) {} try { back.remove(); } catch (_) {} resolve(v); };
    const back = h('div', { class: 'cyc-ovl cyc', onClick: (e) => { if (e.target === back) close(false); } }, [
      h('div', { class: 'cyc-sheet', style: 'max-width:460px;padding:22px' }, [
        h('div', { class: 'cyc-h1', style: 'font-size:1.15rem' }, title),
        h('div', { class: 'cyc-sub', style: 'margin-bottom:14px' }, body),
        h('div', { style: 'display:flex;gap:8px;justify-content:flex-end' }, [h('button', { class: 'cyc-btn g', onClick: () => close(false) }, 'Cancel'), h('button', { class: 'cyc-btn ' + (danger ? 'd' : 'p'), style: 'flex:0 1 auto', onClick: () => close(true) }, okLabel || 'Confirm')]),
      ]),
    ]);
    document.body.appendChild(back); try { lockPage(back); } catch (_) {}
  });
}

const toast = (msg) => { try { if (window.lbToast) return window.lbToast(msg); } catch (_) {} const t = h('div', { style: 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#10223B;color:#fff;border:1px solid rgba(8,131,247,.5);border-radius:12px;padding:11px 16px;font-weight:700;z-index:9600;font-family:Manrope,Inter,system-ui' }, msg); document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };

// ---------------------------------------------------------------- screens
function hero(o, title, sub) {
  const d = o.dispatcher || {};
  return h('div', { class: 'cyc-hero' }, [
    h('div', { class: 'cyc-kick' }, 'LOADBOOT DISPATCH · CARRIER FLEET BOOK'),
    h('div', { class: 'cyc-h1' }, title),
    h('div', { class: 'cyc-sub' }, sub),
    h('div', { class: 'cyc-kpis' }, [
      h('div', { class: 'cyc-kpi' }, [h('b', null, String(o.available_count || 0)), h('span', null, 'Carriers open')]),
      h('div', { class: 'cyc-kpi' }, [h('b', null, String(o.exact_count || 0)), h('span', null, 'Exact match')]),
      o.score != null ? h('div', { class: 'cyc-kpi' }, [h('b', null, o.score + ' / ' + (o.max_score || 100)), h('span', null, 'Your test')]) : null,
      h('div', { class: 'cyc-kpi', style: 'flex:2;min-width:220px' }, [h('span', null, 'Your equipment (from your application)'), h('div', { class: 'cyc-chips' }, (d.equipment || []).length ? d.equipment.map((e) => chip(e, 'on')) : [chip('none listed — every carrier will show as outside your equipment', 'warn')])]),
    ]),
  ]);
}

function pendingCard(o, reload) {
  const p = o.pending; const b = p.book || {}; const org = b.org || {};
  const withdraw = h('button', { class: 'cyc-btn d', onClick: async () => {
    if (!(await askConfirm('Withdraw this choice?', 'The carrier is released for other candidates and you can pick another one. LoadBoot is told.', 'Withdraw', true))) return;
    withdraw.disabled = true;
    const r = await dispatcherWithdrawChoice().catch((e) => ({ error: (e && e.message) || 'could not withdraw' }));
    if (r && r.error) { withdraw.disabled = false; toast(r.error); return; }
    toast('Choice withdrawn — pick another carrier'); reload();
  } }, 'Withdraw choice');
  return h('div', { class: 'cyc-card', style: 'border-color:rgba(74,222,128,.45);margin-bottom:14px' }, [
    h('div', { class: 'cyc-head', style: 'display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap' }, [
      h('div', { style: 'flex:1;min-width:200px' }, [
        h('div', { class: 'cyc-idx', style: 'color:#4ade80' }, '✓ YOUR CHOICE IS WITH LOADBOOT · ' + fmtDT(p.created_at).toUpperCase()),
        h('div', { class: 'cyc-name' }, org.name || 'Carrier'),
        h('div', { class: 'cyc-line' }, org.summary || ''),
      ]),
      p.match_kind ? matchPill(p.match_kind) : null,
    ]),
    kpiTiles(b), badges(b),
    p.note ? h('div', { class: 'cyc-note' }, ['Your note: ', p.note]) : null,
    h('div', { class: 'cyc-steps' }, [
      ['1', 'LoadBoot reviews your choice — usually within one working day. The carrier is on hold for you meanwhile.'],
      ['2', 'On acceptance your paid trial starts: you get the trial terms e-mail and this carrier’s full operating brief (truck, driver, rules, authority).'],
      ['3', 'Read the brief completely, then introduce yourself in the carrier’s WhatsApp group. Never contact the carrier before that.'],
    ].map((s) => h('div', { class: 'cyc-step' }, [h('i', null, s[0]), h('div', null, s[1])]))),
    h('div', { class: 'cyc-acts' }, [h('button', { class: 'cyc-btn g', onClick: () => openBook(b, 0, null) }, '📖 Open the fleet book'), withdraw]),
  ]);
}

function carrierCard(b, idx, onChoose) {
  const org = b.org || {};
  return h('div', { class: 'cyc-card' + (b.match_kind === 'exact' ? ' exact' : '') }, [
    h('div', { class: 'cyc-head', style: 'display:flex;gap:10px;align-items:flex-start' }, [
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { class: 'cyc-idx' }, 'CARRIER ' + pad2(idx + 1)),
        h('div', { class: 'cyc-name' }, org.name || 'Carrier'),
        h('div', { class: 'cyc-line' }, org.summary || ''),
      ]),
      matchPill(b.match_kind),
    ]),
    b.match_kind === 'partial' || b.match_kind === 'related' || b.match_kind === 'none' ? h('div', { class: 'cyc-line', style: 'margin-top:-6px' }, [
      b.match_common && b.match_common.length ? 'You know: ' + b.match_common.join(', ') + '. ' : '',
      b.match_missing && b.match_missing.length ? 'Also runs: ' + b.match_missing.join(', ') + '.' : '',
    ]) : null,
    kpiTiles(b), badges(b),
    b.gaps && b.gaps.length ? h('div', { class: 'cyc-gaps' }, '⚠ ' + b.gaps[0] + (b.gaps.length > 1 ? ' (+' + (b.gaps.length - 1) + ' more in the book)' : '')) : null,
    h('div', { class: 'cyc-acts' }, [
      h('button', { class: 'cyc-btn g', onClick: () => openBook(b, idx, () => onChoose(b)) }, '📖 Fleet book'),
      h('button', { class: 'cyc-btn p', onClick: () => onChoose(b) }, 'Choose this carrier'),
    ]),
  ]);
}

function historyBlock(o) {
  const hs = (o.history || []).filter((x) => x.status === 'declined' || x.status === 'withdrawn');
  if (!hs.length) return null;
  return h('div', { class: 'cyc-card', style: 'margin-top:14px' }, [
    h('div', { class: 'cyc-idx' }, 'EARLIER CHOICES'),
    h('div', { class: 'cyc-hist' }, hs.map((x) => h('div', null, [h('b', { style: 'color:#fff' }, x.carrier || 'Carrier'), ' · ' + fmtD(x.created_at) + ' · ' + (x.status === 'declined' ? 'LoadBoot asked you to choose another' : 'withdrawn by you') + (x.decision_note ? ' — “' + x.decision_note + '”' : '')]))),
  ]);
}

// ---------------------------------------------------------------- entry point
// Returns true when something was painted (eligible or pending), false when this candidate has nothing
// to choose yet — the caller then falls back to its normal screen.
export async function mountChooseCarrier(host, opts = {}) {
  ensureStyle();
  let o = null;
  try { o = await dispatcherCarrierOptions(); } catch (e) { o = { error: (e && e.message) || 'could not load' }; }
  if (!o || o.error) return false;
  if (!o.eligible && !o.pending) return false;

  const wrap = h('div', { class: 'cyc' });
  const body = h('div');
  const reload = () => mountChooseCarrier(host, opts);
  const onChoose = async (b) => {
    const ans = await confirmChoose(b);
    if (!ans) return;
    const r = await dispatcherChooseCarrier(b.org.id, ans.note || null).catch((e) => ({ error: (e && e.message) || 'could not send your choice' }));
    if (r && r.error) { toast(r.error); if (/no longer|taken/i.test(r.error)) reload(); return; }
    toast('✓ Your choice is with LoadBoot'); reload();
  };

  // optional second tab: the test result (the caller passes a mounter so this module never imports the test)
  const tabs = opts.testTab ? h('div', { class: 'cyc-tabs' }, [
    h('button', { class: 'cyc-tab on', onClick: (e) => { pick(0, e.currentTarget); } }, '🚚 Choose your carrier'),
    h('button', { class: 'cyc-tab', onClick: (e) => { pick(1, e.currentTarget); } }, '📝 Your test result'),
  ]) : null;
  const testHost = h('div', { style: 'display:none' });
  let testMounted = false;
  const pick = async (i, btn) => {
    if (tabs) Array.from(tabs.children).forEach((c) => c.classList.toggle('on', c === btn));
    body.style.display = i === 0 ? '' : 'none'; testHost.style.display = i === 1 ? '' : 'none';
    if (i === 1 && !testMounted) { testMounted = true; try { await opts.testTab(testHost); } catch (_) { mount(testHost, h('div', { class: 'cp-muted' }, 'Could not open the test result.')); } }
  };

  if (o.pending) {
    mount(body, [
      hero(o, 'Your carrier choice is with LoadBoot', 'You chose a carrier. LoadBoot confirms it, sets your trial terms and opens your workspace — you get an e-mail the moment it is done.'),
      pendingCard(o, reload), historyBlock(o),
    ]);
  } else if (!o.carriers || !o.carriers.length) {
    mount(body, [
      hero(o, 'No carrier is open right now', 'You passed the skills test — this tab is where you choose the carrier you will dispatch for. Every approved carrier has a dedicated dispatcher at the moment. LoadBoot onboards carriers every week; we e-mail you the moment one opens, and it appears here.'),
      h('div', { class: 'cyc-banner info' }, [h('div', null, 'ℹ️'), h('div', null, [h('b', null, 'Nothing is needed from you. '), 'Keep this inbox checked. When a carrier opens you will see its full fleet book here — truck, preferences, authority, lanes — and choose it in one tap.'])]),
      historyBlock(o),
    ]);
  } else {
    const exact = Number(o.exact_count || 0);
    mount(body, [
      hero(o, 'Choose your carrier', 'You passed the skills test' + (o.passed_at ? ' on ' + fmtD(o.passed_at) : '') + '. These carriers are approved by LoadBoot and waiting for a dedicated dispatcher. Read each fleet book — every truck, every preference, every constraint, the age of each authority — then choose the one you will dispatch for. LoadBoot confirms it and your paid trial starts.'),
      exact > 0
        ? h('div', { class: 'cyc-banner ok' }, [h('div', null, '✅'), h('div', null, [h('b', null, exact + (exact === 1 ? ' carrier matches' : ' carriers match') + ' your profile exactly'), ' — ' + (exact === 1 ? 'it is' : 'they are') + ' listed first. Every piece of equipment ' + (exact === 1 ? 'it runs' : 'they run') + ' is one you told us you can manage.'])])
        : h('div', { class: 'cyc-banner warn' }, [h('div', null, '⚠️'), h('div', null, [h('b', null, 'No exact match with your profile'), ' — but you can still choose from the following available carriers. The ones closest to your equipment are listed first. If you pick one outside your stated equipment, tell LoadBoot in the note why you can handle it.'])]),
      h('div', { class: 'cyc-grid' }, o.carriers.map((b, i) => carrierCard(b, i, onChoose))),
      h('div', { class: 'cyc-line', style: 'margin-top:12px;text-align:center' }, 'Dispatcher copy · confidential. Contact details are issued through each carrier’s WhatsApp group after the assignment, not here.'),
      historyBlock(o),
    ]);
  }
  mount(wrap, [tabs, body, testHost]);
  mount(host, wrap);
  return true;
}

export default { mountChooseCarrier };
