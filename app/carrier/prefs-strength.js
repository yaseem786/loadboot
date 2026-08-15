// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// prefs-strength.js v2 — Carrier Preferences Completion System (LinkedIn-style).
// Ring card (fully clickable) → checklist sheet of all sections → chip popups with PREFILL
// (edit any answered section) → save auto-advances to the next missing section (chain) → 🎉 at 100%.
// Data truth: answers save into carrier_dispatch_prefs (same row Account → Dispatch reads);
// removing data later deducts the score again (prefs_strength v2, bl_pref_0193).
// Backend: cc_prefs_profile_strength() + cc_prefs_save_section() + cc_get_dispatch_prefs().
import { prefsProfileStrength, prefsSaveSection, getDispatchPrefs } from '../shared/api.js';

const SEC = {
  lanes:      { icon: '🛣️', title: 'Your favorite lanes', sub: 'We push loads on these lanes to the top of your board.', pct: 15 },
  home_base:  { icon: '📍', title: 'Home base & radius', sub: 'How far from home do you want to run?', pct: 15 },
  equipment:  { icon: '🚛', title: 'Your equipment', sub: 'Only see loads your trailer can actually haul.', pct: 15 },
  rate_floor: { icon: '💵', title: 'Your minimum rate', sub: 'We flag anything under your floor before you waste a call.', pct: 10 },
  home_time:  { icon: '🏠', title: 'Home time', sub: 'Matches plan your reloads around getting you home.', pct: 10 },
  load_size:  { icon: '📦', title: 'Load size', sub: 'Full truckload, partials, or both?', pct: 10 },
  facility:   { icon: '🏭', title: 'Facility likes & dislikes', sub: 'We remember which docks treat drivers right.', pct: 10 },
  weekends:   { icon: '📅', title: 'Weekend driving', sub: 'Should we offer Saturday/Sunday pickups?', pct: 5 },
  boards:     { icon: '🖥️', title: 'Load board access', sub: 'Optional — if you run DAT or Truckstop, your dedicated dispatcher can work those boards for you too.', pct: 10 },
};
const ORDER = ['lanes', 'home_base', 'equipment', 'rate_floor', 'home_time', 'load_size', 'facility', 'weekends', 'boards'];
const EQUIP = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Power Only', 'Hotshot', 'Box Truck'];
const FAC_LIKES = ['Drop & hook', 'Fast loading', 'Overnight parking', 'Flexible appointment', 'Driver restrooms'];
const FAC_DISLIKES = ['Long detention', 'No parking', 'Strict appointments', 'Heavy lumper use', 'No overnight'];

let _strength = null;
let _prefs = null;
let _host = null;

export async function fetchStrength() {
  try { _strength = await prefsProfileStrength(); } catch (_) { _strength = null; }
  return _strength;
}
async function fetchPrefs() {
  try { _prefs = await getDispatchPrefs(); } catch (_) { _prefs = _prefs || {}; }
  return _prefs || {};
}

function ringSVG(score, size) {
  size = size || 84;
  const R = 34, C = 2 * Math.PI * R, off = C * (1 - Math.max(0, Math.min(100, score)) / 100);
  const col = score >= 80 ? '#34d399' : score >= 40 ? '#0883F7' : '#FC5305';
  return '<svg viewBox="0 0 84 84" width="' + size + '" height="' + size + '" role="img" aria-label="Profile strength ' + score + '%">'
    + '<circle cx="42" cy="42" r="' + R + '" fill="none" stroke="rgba(255,255,255,.09)" stroke-width="8"/>'
    + '<circle cx="42" cy="42" r="' + R + '" fill="none" stroke="' + col + '" stroke-width="8" stroke-linecap="round"'
    + ' stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 42 42)" style="transition:stroke-dashoffset .8s ease"/>'
    + '<text x="42" y="47" text-anchor="middle" font-size="20" font-weight="800" fill="#eaf1fb">' + score + '%</text></svg>';
}

export async function mountStrengthCard(host) {
  _host = host;
  const s = _strength || await fetchStrength();
  if (!s || s.error || typeof s.score !== 'number') { host.innerHTML = ''; return; }
  const missing = (s.sections || []).filter((x) => !x.filled);
  host.innerHTML = '<div class="psx-card" style="background:#111c31;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:16px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:14px;cursor:pointer;transition:border-color .15s" '
    + 'onmouseover="this.style.borderColor=\'rgba(8,131,247,.45)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.09)\'">'
    + '<div>' + ringSVG(s.score) + '</div>'
    + '<div style="flex:1;min-width:220px">'
    + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-weight:800;color:#eaf1fb;font-size:1.02rem">Profile strength</span>'
    + (missing.length ? '<span style="background:rgba(252,83,5,.15);border:1px solid rgba(252,83,5,.4);color:#ff8a50;border-radius:999px;padding:2px 9px;font-size:.72rem;font-weight:800">' + missing.length + ' missing</span>' : '')
    + '</div>'
    + '<div style="color:#8ea2c3;font-size:.86rem;margin:2px 0 8px">' + (s.score >= 100 ? 'Fully tuned — you get our best-matched loads first.' : 'Stronger profile = better-matched loads, first. Tap to complete.') + '</div>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap">'
    + missing.slice(0, 3).map((m) => '<button type="button" class="psx-chip" data-sec="' + m.key + '" style="background:rgba(8,131,247,.14);border:1px solid rgba(8,131,247,.35);color:#7cc0ff;border-radius:999px;padding:5px 12px;font-size:.8rem;font-weight:700;cursor:pointer">+' + m.weight + '% · ' + ((SEC[m.key] && SEC[m.key].title) || m.label) + '</button>').join('')
    + (missing.length > 3 ? '<button type="button" class="psx-more" style="background:none;border:1px dashed rgba(255,255,255,.25);color:#8ea2c3;border-radius:999px;padding:5px 12px;font-size:.8rem;font-weight:700;cursor:pointer">+' + (missing.length - 3) + ' more ›</button>' : '')
    + (missing.length === 0 ? '<span style="color:#34d399;font-size:.85rem;font-weight:700">✓ All set — matching runs on your full profile · tap to review</span>' : '')
    + '</div></div>'
    + '<div style="color:#3d5375;font-size:1.3rem;font-weight:800">›</div></div>';
  const card = host.querySelector('.psx-card');
  card.addEventListener('click', (e) => {
    const chipBtn = e.target.closest('.psx-chip');
    if (chipBtn) { e.stopPropagation(); openMicroAsk(chipBtn.dataset.sec, host, { chain: true }); return; }
    openChecklist(host);
  });
}

export async function maybeShowMicroAsk() {
  const s = _strength || await fetchStrength();
  if (!s || s.error || !s.next || !s.next.key) return;
  const k = 'lb:psx:last'; let last = 0;
  try { last = +(localStorage.getItem(k) || 0); } catch (_) {}
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  try { localStorage.setItem(k, String(Date.now())); } catch (_) {}
  openMicroAsk(s.next.key, _host, { chain: true });
}

// ---------- shared sheet shell ----------
function sheet(innerHTML) {
  const old = document.getElementById('psxModal'); if (old) old.remove();
  const wrap = document.createElement('div'); wrap.id = 'psxModal';
  wrap.innerHTML = '<div class="psx-ov" style="position:fixed;inset:0;background:rgba(4,8,16,.72);z-index:2400;display:flex;align-items:flex-end;justify-content:center">'
    + '<div class="psx-sheet" style="background:#0d1526;border:1px solid rgba(255,255,255,.1);border-radius:20px 20px 0 0;max-width:560px;width:100%;max-height:86vh;overflow:auto;padding:22px 20px 18px;box-shadow:0 -20px 60px rgba(0,0,0,.5)">'
    + innerHTML + '</div></div>'
    + '<style>#psxModal .mx-chips{display:flex;gap:8px;flex-wrap:wrap}'
    + '#psxModal .mx-chip{background:#0a1322;border:1.5px solid rgba(255,255,255,.14);color:#c7d5ea;border-radius:999px;padding:9px 16px;font-size:.9rem;font-weight:700;cursor:pointer}'
    + '#psxModal .mx-chip.on{background:rgba(8,131,247,.2);border-color:#0883F7;color:#7cc0ff}'
    + '#psxModal .mx-sub{color:#8ea2c3;font-size:.84rem;margin-bottom:6px}'
    + '#psxModal .mx-in{background:#0a1322;border:1.5px solid rgba(255,255,255,.14);border-radius:10px;color:#eaf1fb;padding:10px 12px;font-size:.92rem}'
    + '#psxModal .psx-row{display:flex;align-items:center;gap:12px;padding:13px 10px;border-radius:12px;cursor:pointer;border:1px solid transparent}'
    + '#psxModal .psx-row:hover{background:rgba(8,131,247,.08);border-color:rgba(8,131,247,.25)}'
    + '@keyframes psxPop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}'
    + '#psxModal .psx-anim{animation:psxPop .28s ease}'
    + '@media(min-width:640px){#psxModal .psx-ov{align-items:center!important}#psxModal .psx-sheet{border-radius:20px!important}}</style>';
  document.body.appendChild(wrap);
  wrap.querySelector('.psx-ov').addEventListener('click', (e) => { if (e.target === e.currentTarget) wrap.remove(); });
  return wrap;
}
const refreshCard = () => { if (_host) mountStrengthCard(_host); };

// ---------- LinkedIn-style checklist of ALL sections ----------
export async function openChecklist(refreshHost) {
  if (refreshHost) _host = refreshHost;
  const s = _strength || await fetchStrength();
  if (!s || s.error) return;
  const bykey = {}; (s.sections || []).forEach((x) => { bykey[x.key] = x; });
  const wrap = sheet('<div class="psx-anim">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px">'
    + '<div style="display:flex;align-items:center;gap:14px">' + ringSVG(s.score, 64)
    + '<div><div style="font-weight:800;color:#eaf1fb;font-size:1.08rem">Complete your profile</div>'
    + '<div style="color:#8ea2c3;font-size:.85rem">Each answer sharpens your load matches — edit any time.</div></div></div>'
    + '<button type="button" id="psxX" style="background:none;border:0;color:#8ea2c3;font-size:1.4rem;cursor:pointer;line-height:1">×</button></div>'
    + '<div style="margin-top:14px">'
    + ORDER.map((key) => {
      const m = SEC[key], st = bykey[key] || {};
      return '<div class="psx-row" data-sec="' + key + '">'
        + '<span style="font-size:1.25rem;width:30px;text-align:center">' + m.icon + '</span>'
        + '<div style="flex:1"><div style="color:#eaf1fb;font-weight:700;font-size:.94rem">' + m.title + '</div>'
        + '<div style="color:#8ea2c3;font-size:.78rem">' + m.sub + '</div></div>'
        + (st.filled
          ? '<span style="color:#34d399;font-weight:800;font-size:.82rem;white-space:nowrap">✓ Added</span>'
          : '<span style="background:rgba(252,83,5,.15);border:1px solid rgba(252,83,5,.4);color:#ff8a50;border-radius:999px;padding:4px 11px;font-size:.78rem;font-weight:800;white-space:nowrap">+' + (st.weight || m.pct) + '%</span>')
        + '</div>';
    }).join('')
    + '</div></div>');
  wrap.querySelector('#psxX').onclick = () => wrap.remove();
  wrap.querySelectorAll('.psx-row').forEach((r) => r.addEventListener('click', () => openMicroAsk(r.dataset.sec, _host, { backToList: true })));
}

// ---------- section bodies (with PREFILL from saved prefs) ----------
function chip(v, label, group, multi, on) {
  return '<button type="button" class="mx-chip' + (on ? ' on' : '') + '" data-g="' + group + '" data-v="' + String(v).replace(/"/g, '&quot;') + '" data-multi="' + (multi ? 1 : 0) + '">' + label + '</button>';
}
function laneChipHTML(lane) {
  return '<span data-lane="' + lane.replace(/"/g, '&quot;') + '" style="background:rgba(8,131,247,.14);border:1px solid rgba(8,131,247,.35);color:#7cc0ff;border-radius:999px;padding:6px 12px;font-size:.84rem;font-weight:700;cursor:pointer">' + lane + '  ✕</span>';
}
function bodyFor(key, p) {
  p = p || {};
  const eb = p.external_boards || {};
  switch (key) {
    case 'lanes': return '<div style="display:flex;gap:8px;flex-wrap:wrap"><input class="mx-in" id="mxFrom" list="lb-uscities" placeholder="From (City, ST)" style="flex:1;min-width:130px"><input class="mx-in" id="mxTo" list="lb-uscities" placeholder="To (City, ST)" style="flex:1;min-width:130px">'
      + '<button type="button" id="mxAddLane" style="background:#0883F7;color:#fff;border:0;border-radius:10px;padding:9px 16px;font-weight:800;cursor:pointer">Add</button></div>'
      + '<div id="mxLaneList" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' + (Array.isArray(p.preferred_lanes) ? p.preferred_lanes.map(laneChipHTML).join('') : '') + '</div>';
    case 'home_base': { const rad = p.operating_radius_miles;
      return '<input class="mx-in" id="mxCity" list="lb-uscities" placeholder="Home city (City, ST)" value="' + String(p.home_base || '').replace(/"/g, '&quot;') + '" style="width:100%;box-sizing:border-box;margin-bottom:10px">'
      + '<div class="mx-sub">How far out will you run?</div>'
      + '<div class="mx-chips">' + [100, 250, 500, 750, 1000].map((r) => chip(r, r + ' mi', 'radius', false, rad === r)).join('') + chip('', 'Anywhere', 'radius', false, p.home_base && !rad) + '</div>'; }
    case 'equipment': { const cur = p.preferred_equipment || []; const extra = cur.filter((e) => EQUIP.indexOf(e) < 0);
      return '<div class="mx-chips">' + EQUIP.concat(extra).map((e) => chip(e, e, 'equip', true, cur.indexOf(e) >= 0)).join('') + '</div>'
      + '<input class="mx-in" id="mxEqDetail" placeholder="Detail (optional): 53ft, air-ride, tarps, temp range…" value="' + String((p.equipment_detail && p.equipment_detail.note) || '').replace(/"/g, '&quot;') + '" style="width:100%;box-sizing:border-box;margin-top:10px">'; }
    case 'rate_floor': { const cur = p.min_rpm != null ? Number(p.min_rpm).toFixed(2) : ''; const std = ['1.75', '2.00', '2.25', '2.50', '3.00'];
      return '<div class="mx-sub">Never show me below…</div>'
      + '<div class="mx-chips">' + std.map((r) => chip(r, '$' + r + '/mi', 'rpm', false, cur === r)).join('') + '</div>'
      + '<input class="mx-in" id="mxRpm" inputmode="decimal" placeholder="Custom $/mi" value="' + (cur && std.indexOf(cur) < 0 ? cur : '') + '" style="width:160px;margin-top:10px">'; }
    case 'home_time': return '<div class="mx-chips">' + [['daily', 'Home daily'], ['weekly', 'Home weekly'], ['biweekly', 'Every 2 weeks'], ['flexible', 'Flexible'], ['otr', 'OTR — out long']].map(([v, l]) => chip(v, l, 'ht', false, p.home_time === v)).join('') + '</div>';
    case 'weekends': return '<div class="mx-chips">' + chip('true', 'Weekends OK', 'wk', false, p.weekend_ok === true) + chip('false', 'Keep my weekends', 'wk', false, p.weekend_ok === false) + '</div>';
    case 'load_size': return '<div class="mx-chips">' + [['full', 'Full truckload'], ['partial', 'Partials'], ['both', 'Both']].map(([v, l]) => chip(v, l, 'ls', false, p.load_size === v)).join('') + '</div>';
    case 'facility': { const fl = p.facility_likes || [], fd = p.facility_dislikes || [];
      const exL = fl.filter((f) => FAC_LIKES.indexOf(f) < 0), exD = fd.filter((f) => FAC_DISLIKES.indexOf(f) < 0);
      return '<div class="mx-sub">Love to see:</div><div class="mx-chips">' + FAC_LIKES.concat(exL).map((f) => chip(f, f, 'flike', true, fl.indexOf(f) >= 0)).join('') + '</div>'
      + '<div class="mx-sub" style="margin-top:12px">Avoid:</div><div class="mx-chips">' + FAC_DISLIKES.concat(exD).map((f) => chip(f, f, 'fdis', true, fd.indexOf(f) >= 0)).join('') + '</div>'; }
    case 'boards': return '<div class="mx-sub">DAT:</div><div class="mx-chips">' + [['active', 'I have DAT'], ['interested', 'Want it'], ['none', 'No']].map(([v, l]) => chip(v, l, 'dat', false, eb.dat === v)).join('') + '</div>'
      + '<div class="mx-sub" style="margin-top:12px">Truckstop:</div><div class="mx-chips">' + [['active', 'I have Truckstop'], ['interested', 'Want it'], ['none', 'No']].map(([v, l]) => chip(v, l, 'ts', false, eb.truckstop === v)).join('') + '</div>';
  }
  return '';
}

function collect(modal, key) {
  const picked = (g) => Array.prototype.slice.call(modal.querySelectorAll('.mx-chip.on[data-g="' + g + '"]')).map((b) => b.dataset.v);
  switch (key) {
    case 'lanes': { const lanes = Array.prototype.slice.call(modal.querySelectorAll('#mxLaneList [data-lane]')).map((x) => x.dataset.lane); return lanes.length ? { preferred_lanes: lanes } : null; }
    case 'home_base': { const c = modal.querySelector('#mxCity').value.trim(); const r = picked('radius')[0]; if (!c) return null; const out = { home_base: c }; if (r) out.operating_radius_miles = +r; return out; }
    case 'equipment': { const eq = picked('equip'); if (!eq.length) return null; const d = modal.querySelector('#mxEqDetail').value.trim(); return { preferred_equipment: eq, equipment_detail: d ? { note: d } : {} }; }
    case 'rate_floor': { const v = modal.querySelector('#mxRpm').value.trim() || picked('rpm')[0]; if (!v || isNaN(+v)) return null; return { min_rpm: v }; }
    case 'home_time': { const v = picked('ht')[0]; return v ? { home_time: v } : null; }
    case 'weekends': { const v = picked('wk')[0]; return v ? { weekend_ok: v === 'true' } : null; }
    case 'load_size': { const v = picked('ls')[0]; return v ? { load_size: v } : null; }
    case 'facility': { const l = picked('flike'), d = picked('fdis'); if (!l.length && !d.length) return null; return { facility_likes: l, facility_dislikes: d }; }
    case 'boards': { const dat = picked('dat')[0], ts = picked('ts')[0]; if (!dat && !ts) return null; const eb = {}; if (dat) eb.dat = dat; if (ts) eb.truckstop = ts; return { external_boards: eb }; }
  }
  return null;
}

// ---------- one section popup (chain: save → next missing; back: return to checklist) ----------
export async function openMicroAsk(key, refreshHost, opts) {
  opts = opts || {};
  if (refreshHost) _host = refreshHost;
  const meta = SEC[key]; if (!meta) return;
  const p = await fetchPrefs();
  const prevScore = (_strength && _strength.score) || 0;
  const wrap = sheet('<div class="psx-anim">'
    + '<div id="psxGain"></div>'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'
    + '<div><span style="font-size:1.5rem">' + meta.icon + '</span>'
    + '<span style="background:rgba(252,83,5,.15);border:1px solid rgba(252,83,5,.4);color:#ff8a50;border-radius:999px;padding:3px 10px;font-size:.75rem;font-weight:800;margin-left:8px;vertical-align:6px">+' + meta.pct + '% better matches</span>'
    + '<div style="font-weight:800;color:#eaf1fb;font-size:1.08rem;margin-top:6px">' + meta.title + '</div>'
    + '<div style="color:#8ea2c3;font-size:.86rem;margin-top:2px">' + meta.sub + '</div></div>'
    + '<button type="button" id="psxX" style="background:none;border:0;color:#8ea2c3;font-size:1.4rem;cursor:pointer;line-height:1">×</button></div>'
    + '<div style="margin:16px 0 18px" id="psxBody">' + bodyFor(key, p) + '</div>'
    + '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center">'
    + (opts.backToList ? '<button type="button" id="psxBack" style="background:none;border:0;color:#7cc0ff;font-weight:700;cursor:pointer;padding:10px">‹ All sections</button>' : '<span></span>')
    + '<div style="display:flex;gap:10px;align-items:center">'
    + '<button type="button" id="psxSkip" style="background:none;border:0;color:#8ea2c3;font-weight:700;cursor:pointer;padding:10px">Ask me later</button>'
    + '<button type="button" id="psxSave" style="background:#FC5305;border:0;color:#fff;border-radius:12px;padding:12px 26px;font-weight:800;font-size:.95rem;cursor:pointer">Save</button></div></div>'
    + '</div>');
  wrap.querySelectorAll('.mx-chip').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.multi === '1') { b.classList.toggle('on'); }
    else { wrap.querySelectorAll('.mx-chip[data-g="' + b.dataset.g + '"]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }
  }));
  const addLane = () => {
    const f = wrap.querySelector('#mxFrom'), t = wrap.querySelector('#mxTo');
    if (!f || !t || !f.value.trim() || !t.value.trim()) return;
    const lane = f.value.trim() + ' → ' + t.value.trim();
    const list = wrap.querySelector('#mxLaneList'); const tmp = document.createElement('div');
    tmp.innerHTML = laneChipHTML(lane); const el2 = tmp.firstChild; el2.onclick = () => el2.remove();
    list.appendChild(el2); f.value = ''; t.value = ''; f.focus();
  };
  const al = wrap.querySelector('#mxAddLane'); if (al) al.addEventListener('click', addLane);
  wrap.querySelectorAll('#mxLaneList [data-lane]').forEach((el2) => { el2.onclick = () => el2.remove(); });
  const close = () => { wrap.remove(); refreshCard(); };
  wrap.querySelector('#psxX').onclick = close;
  const back = wrap.querySelector('#psxBack'); if (back) back.onclick = () => { refreshCard(); openChecklist(_host); };
  wrap.querySelector('#psxSkip').onclick = async () => { close(); try { _strength = await prefsSaveSection(key, { _skip: true }); } catch (_) {} refreshCard(); };
  wrap.querySelector('#psxSave').onclick = async () => {
    const payload = collect(wrap, key);
    const btn = wrap.querySelector('#psxSave');
    if (!payload) { btn.textContent = 'Pick one first'; setTimeout(() => { btn.textContent = 'Save'; }, 1400); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      _strength = await prefsSaveSection(key, payload);
      _prefs = null; // re-fetch next time (data changed)
      refreshCard();
      const ns = _strength && _strength.next;
      if (opts.backToList) { openChecklist(_host); return; }
      if (ns && ns.key && SEC[ns.key]) {
        // LinkedIn-style chain: straight to the next missing section, with a gain banner.
        openMicroAsk(ns.key, _host, { chain: true });
        const g = document.querySelector('#psxModal #psxGain');
        if (g) g.innerHTML = '<div class="psx-anim" style="background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.35);color:#34d399;border-radius:11px;padding:9px 13px;font-weight:800;font-size:.85rem;margin-bottom:12px">✓ Saved — profile now ' + (_strength.score || 0) + '% (was ' + prevScore + '%)</div>';
        return;
      }
      // Nothing missing → celebration.
      sheet('<div class="psx-anim" style="text-align:center;padding:18px 6px">'
        + '<div style="font-size:2.6rem">🎉</div>'
        + '<div style="margin:10px auto">' + ringSVG((_strength && _strength.score) || 100, 96) + '</div>'
        + '<h3 style="color:#eaf1fb;margin:6px 0 6px">Profile fully tuned</h3>'
        + '<p style="color:#8ea2c3;font-size:.9rem;max-width:380px;margin:0 auto 16px">Matching now runs on your complete profile — best-fit loads reach you first. Edit any answer from the Profile strength card.</p>'
        + '<button type="button" id="psxDone" style="background:#0883F7;border:0;color:#fff;border-radius:12px;padding:12px 30px;font-weight:800;cursor:pointer">Done</button></div>')
        .querySelector('#psxDone').onclick = () => { const m2 = document.getElementById('psxModal'); if (m2) m2.remove(); refreshCard(); };
    } catch (e) { btn.disabled = false; btn.textContent = 'Retry'; }
  };
}
