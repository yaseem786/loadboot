// loadWizard.js — CC "Post a load" wizard, built to the SAME standard as the broker portal
// wizard (Inc 44) and tuned for staff entering externally-sourced freight (123Loadboard,
// DAT, Truckstop, direct brokers). 5 steps: Lane → Schedule → Equipment & freight →
// Rate card & source → Review. Draft auto-saves (localStorage lb_cc_wiz); address
// autocomplete geocodes real pins so live tracking gets a map from minute one; the
// LoadBoot standard rate card is a FLOOR (staff may raise, never lower); duplicate radar
// warns before double-posting a lane+date. Submits via cc_create_load_sourced with full
// source attribution (source_type/provider/reference + details.source broker block).
import { el, mount } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { createLoadSourced, rateStandards, getLoadsList } from '../../shared/api.js';
import { attachAddressSuggest } from '../../shared/addr-suggest.js';
import { suggestCommodities, lookupCommodity } from '../../partner/commodities.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STEPS = ['Lane', 'Schedule', 'Equipment & freight', 'Rate card & source', 'Review'];
const EQUIPMENT = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Conestoga', 'Power Only', 'Box Truck', 'Cargo Van', 'Sprinter Van', 'Hotshot'];
const RPM_KEY = { 'Dry Van': 'rpm_dry_van', 'Reefer': 'rpm_reefer', 'Flatbed': 'rpm_flatbed', 'Step Deck': 'rpm_step_deck', 'Conestoga': 'rpm_conestoga', 'Power Only': 'rpm_power_only', 'Box Truck': 'rpm_box_truck', 'Hotshot': 'rpm_hotshot' };
const BOARDS = ['Direct broker', '123Loadboard', 'DAT', 'Truckstop', 'Other board', 'LoadBoot (own freight)'];
const HZ_WORDS = ['gasoline', 'diesel', 'propane', 'butane', 'flammable', 'explosive', 'ammonia', 'chlorine', 'lithium', 'batter', 'paint', 'solvent', 'corrosive', 'acid', 'caustic', 'hazmat', 'hazardous', 'chemical', 'aerosol', 'oxidizer', 'radioactive', 'compressed gas', 'fireworks', 'ammunition', 'petroleum', 'ethanol', 'methanol', 'pesticide'];
const DRAFT_KEY = 'lb_cc_wiz';

const hav = (a, b, c, d) => { const r = (x) => x * Math.PI / 180; return 3958.8 * 2 * Math.asin(Math.sqrt(Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2)); };
const cityLine = (city, st) => [String(city || '').trim(), String(st || '').trim().toUpperCase()].filter(Boolean).join(', ');

export function openLoadWizard(opts = {}) {
  const w = {};
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (d && typeof d === 'object') Object.assign(w, d); } catch (_) { /* fresh */ }
  let step = 0, stds = null, dupAck = false, dups = [];
  let saveT = null;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(w)); } catch (_) {} }, 350); };
  rateStandards().then(rows => { const m = {}; (rows || []).forEach(r => { m[r.key] = r.value; }); stds = m; try { render(); } catch (_) {} }).catch(() => { stds = {}; });
  const sv = (k, dflt) => Number((stds && stds[k]) || dflt);

  const stepHost = el('div');
  const drawer = openDrawer('Post a load', stepHost, { subtitle: 'Broker-grade wizard — external boards, direct brokers or own freight' });

  // ---------- tiny form helpers ----------
  const lab = (t) => el('label', { style: 'font-weight:700;color:#10223B;font-size:.8rem;display:block;margin:10px 0 4px' }, t);
  const inp = (key, ph, type) => { const i = el('input', { class: 'cc-input', placeholder: ph, type: type || 'text', value: w[key] != null ? String(w[key]) : '' }); i.oninput = () => { w[key] = i.value; save(); }; return i; };
  const inpR = (key, ph, type, after) => { const i = inp(key, ph, type); const base = i.oninput; i.oninput = () => { base(); if (after) after(); }; return i; };
  const two = (a, b) => el('div', { class: 'cc-form-2' }, [a, b]);
  const sel = (key, options, ph) => { const s = el('select', { class: 'cc-input' }, [el('option', { value: '' }, ph || 'Select…')].concat(options.map(o => el('option', { value: o, selected: w[key] === o ? 'selected' : null }, o)))); s.onchange = () => { w[key] = s.value; save(); render(); }; return s; };
  const tgl = (key, label, hint) => { const c = el('input', { type: 'checkbox' }); c.checked = !!w[key]; c.onchange = () => { w[key] = c.checked; save(); render(); }; return el('label', { style: 'display:flex;gap:9px;align-items:flex-start;cursor:pointer;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-top:8px' }, [c, el('div', null, [el('b', null, label), hint ? el('div', { class: 'cc-sub' }, hint) : ''])]); };
  const note = (txt, tone) => el('div', { style: 'border-radius:12px;padding:9px 13px;font-size:.82rem;margin-top:8px;' + (tone === 'warn' ? 'background:#fffbeb;border:1px solid #fde68a;color:#92400e' : tone === 'bad' ? 'background:#fef2f2;border:1px solid #fecaca;color:#991b1b' : 'background:#eff6ff;border:1px solid #dbeafe;color:#1e40af') }, txt);

  function recalcMiles() {
    if (w.pickup_lat && w.pickup_lng && w.delivery_lat && w.delivery_lng && !w.__miles_manual) {
      w.miles = String(Math.round(hav(Number(w.pickup_lat), Number(w.pickup_lng), Number(w.delivery_lat), Number(w.delivery_lng)) * 1.18));
      save(); render();
    }
  }

  // ---------- step bodies ----------
  function bodyLane() {
    const oSt = inp('o_street', 'Street address'); const dSt = inp('d_street', 'Street address');
    try {
      attachAddressSuggest(oSt, { onPick: (r) => { w.o_street = r.street; w.o_city = r.city; w.o_state = r.state; w.o_zip = r.zip; if (r.lat && r.lng) { w.pickup_lat = r.lat; w.pickup_lng = r.lng; } save(); recalcMiles(); render(); } });
      attachAddressSuggest(dSt, { onPick: (r) => { w.d_street = r.street; w.d_city = r.city; w.d_state = r.state; w.d_zip = r.zip; if (r.lat && r.lng) { w.delivery_lat = r.lat; w.delivery_lng = r.lng; } save(); recalcMiles(); render(); } });
    } catch (_) { /* suggestions optional */ }
    const milesI = inp('miles', 'Miles', 'number'); const mBase = milesI.oninput; milesI.oninput = () => { mBase(); w.__miles_manual = true; save(); };
    const stops = Array.isArray(w.stops) ? w.stops : (w.stops = []);
    const stopRows = stops.map((sp, i) => el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:6px' }, [
      el('select', { class: 'cc-input', style: 'max-width:130px', onChange: (e) => { sp.kind = e.target.value; save(); } }, ['pickup', 'delivery'].map(k => el('option', { value: k, selected: (sp.kind || 'pickup') === k ? 'selected' : null }, k === 'pickup' ? 'Extra pickup' : 'Extra delivery'))),
      (() => { const i2 = el('input', { class: 'cc-input', placeholder: 'City, ST (or full address)', value: sp.address || '' }); i2.oninput = () => { sp.address = i2.value; save(); }; return i2; })(),
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onClick: () => { stops.splice(i, 1); save(); render(); } }, '✕'),
    ]));
    return el('div', null, [
      lab('Pickup facility'), oSt, two(inp('o_city', 'City'), inp('o_state', 'State (2 letters)')), inp('o_zip', 'ZIP'),
      lab('Delivery facility'), dSt, two(inp('d_city', 'City'), inp('d_state', 'State (2 letters)')), inp('d_zip', 'ZIP'),
      (w.pickup_lat && w.delivery_lat) ? note('📍 Both facilities pinned — live tracking map and geofence stamps are armed for this load.') : note('Tip: pick the address from the suggestions — it pins the facility so GPS tracking, geofenced detention proof and the route map all work.'),
      lab('Lane'), two(milesI, inp('reference', 'Broker load / PRO / reference #')),
      lab('Extra stops (optional)'), el('div', null, stopRows),
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', style: 'margin-top:6px', onClick: () => { stops.push({ kind: 'pickup', address: '' }); save(); render(); } }, '+ Add a stop'),
    ]);
  }

  function bodySchedule() {
    const mode = w.sched_mode || '';
    const modeCard = (v, ttl, sub) => el('div', { style: 'flex:1;min-width:150px;border:2px solid ' + (mode === v ? '#0883F7' : '#e2e8f0') + ';border-radius:12px;padding:10px 12px;cursor:pointer;background:' + (mode === v ? '#eff6ff' : '#fff'), onClick: () => { w.sched_mode = v; save(); render(); } }, [el('b', null, ttl), el('div', { class: 'cc-sub' }, sub)]);
    let eta = null;
    const mi = Number(w.miles) || 0;
    if (mi > 0 && w.pickup_date) {
      const drive = mi / 50; const hos = drive + Math.floor(drive / 11) * 10;
      const base = new Date(w.pickup_date + 'T' + (w.pu_time || '08:00'));
      if (!isNaN(base.getTime())) eta = new Date(base.getTime() + (hos + 2) * 3600e3);
    }
    return el('div', null, [
      lab('Pickup'), two(inp('pickup_date', 'Pickup date', 'date'), inp('pu_time', 'Time (HH:MM, for appt/ETA)', 'time')),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
        modeCard('fcfs', 'FCFS', 'first come, first served'),
        modeCard('appt', 'Appointment', 'fixed time — set it above'),
        modeCard('window', 'Window', 'e.g. 08:00–15:00 below'),
      ]),
      mode === 'window' ? inp('pickup_window', 'Pickup window (e.g. 08:00-15:00)') : '',
      lab('Delivery'), two(inp('delivery_date', 'Delivery date', 'date'), inp('delivery_window', 'Delivery window (optional)')),
      eta && !w.delivery_date ? note('🕐 HOS estimate (11h drive / 10h rest + 2h dock): arrives about ' + eta.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' — set the delivery date accordingly.') : '',
      tgl('team_required', 'Team drivers required', 'Nonstop driving — the load is only offered to team-capable carriers.'),
    ]);
  }

  function bodyFreight() {
    const c = String(w.commodity || '').toLowerCase();
    const dbm = c.length >= 3 ? lookupCommodity(w.commodity) : null;
    const looksHz = HZ_WORDS.some(k2 => c.indexOf(k2) >= 0);
    const commI = el('input', { class: 'cc-input', placeholder: 'Commodity (pick or type)', list: 'cc_comm_list', autocomplete: 'off', value: w.commodity || '' });
    commI.oninput = () => { w.commodity = commI.value; save(); };
    commI.onchange = () => { render(); };
    const rateI = inpR('rate', 'Rate to the carrier (USD)', 'number');
    const mi = Number(w.miles) || 0; const rt = Number(w.rate) || 0;
    const rpmStd = w.equipment && RPM_KEY[w.equipment] ? sv(RPM_KEY[w.equipment], 0) : 0;
    let rateHint = '';
    if (mi > 0 && rpmStd > 0) {
      const mkt = Math.round(mi * rpmStd);
      const rpm = rt > 0 ? (rt / mi) : 0;
      rateHint = note('💡 Market baseline for ' + w.equipment + ': ~$' + rpmStd.toFixed(2) + '/mi × ' + mi + ' mi ≈ $' + mkt.toLocaleString() + (rt > 0 ? ' · your rate = $' + rpm.toFixed(2) + '/mi' + (rpm < rpmStd * 0.8 ? ' — well below market, expect slow coverage' : rpm > rpmStd * 1.15 ? ' — above market, should cover fast' : ' — in range') : ''), rt > 0 && rpm < rpmStd * 0.8 ? 'warn' : undefined);
    }
    return el('div', null, [
      lab('Equipment & size'), two(sel('equipment', EQUIPMENT, 'Equipment *'), sel('load_size', ['Full truckload', 'Partial / LTL'], 'Load size')),
      lab('Commodity'), commI, el('datalist', { id: 'cc_comm_list' }, suggestCommodities(w.commodity, 15).map(n => el('option', { value: n }))),
      dbm && dbm.eq && dbm.eq !== w.equipment ? note('💡 “' + w.commodity + '” usually ships on a ' + dbm.eq + ' — you picked ' + (w.equipment || 'nothing') + '.') : '',
      looksHz && w.hazmat !== true ? note('☢ This looks hazmat — declare it below; only hazmat-certified carriers should get it.', 'warn') : '',
      two(inp('weight', 'Weight (e.g. 42,000 lbs)'), inp('pallets', 'Pallets / pieces', 'number')),
      lab('Money'), two(rateI, inp('cargo_value', 'Cargo value (USD, for COI limits)', 'number')),
      rateHint,
      w.equipment === 'Reefer' ? inp('temperature', 'Temperature (e.g. -10°F continuous)') : '',
      ['Flatbed', 'Step Deck', 'Conestoga', 'Hotshot'].indexOf(w.equipment) >= 0 ? sel('tarps', ['No tarps', '4-ft tarps', '6-ft tarps', '8-ft tarps'], 'Tarps') : '',
      tgl('hazmat', 'Hazmat load', 'Requires placards and a hazmat-certified carrier.'),
      w.hazmat ? el('div', null, [two(inp('hz_un', 'UN number (4 digits)'), inp('hz_class', 'Hazard class (e.g. 3)')), two(inp('hz_pg', 'Packing group (I/II/III)'), inp('hz_name', 'Proper shipping name'))]) : '',
      inp('requirements', 'Special instructions (optional)'),
    ]);
  }

  function bodyRateCardSource() {
    // standards are a FLOOR — auto-init, staff may only raise
    const F = { det: sv('detention_per_hr', 60), free: sv('detention_free_hours', 2), lay: sv('layover_per_day', 250), tonu: sv('tonu', 250), assist: sv('driver_assist', 75), stop: sv('stop_off', 100) };
    ['acc_det', 'acc_free', 'acc_lay', 'acc_tonu'].forEach((k, i) => { const f = [F.det, F.free, F.lay, F.tonu][i]; if (w[k] == null || w[k] === '' || Number(w[k]) < f) w[k] = String(f); });
    if (!w.acc_lumper) w.acc_lumper = String((stds && stds.lumper_policy) || 'Reimbursed with receipt');
    const num = (key, label2, floor, unit) => { const i = inp(key, label2, 'number'); i.min = String(floor); const base = i.oninput; i.oninput = () => { base(); }; i.onblur = () => { if (Number(w[key]) < floor) { w[key] = String(floor); i.value = w[key]; toast('Minimum is the LoadBoot standard $' + floor + unit + ' — you can only go higher.', 'error'); } save(); }; return el('div', null, [el('div', { class: 'cc-sub', style: 'font-weight:700' }, label2 + ' (floor $' + floor + unit + ')'), i]); };
    const isExternal = w.src_board && w.src_board !== 'LoadBoot (own freight)';
    return el('div', null, [
      note('These are LoadBoot marketplace standards — a floor, pre-agreed on every load so a carrier can book without a phone call. You cannot post below standard; raise them to attract carriers on a tough lane.'),
      el('div', { class: 'cc-form-2', style: 'margin-top:8px' }, [num('acc_det', 'Detention $/hr', F.det, '/hr'), num('acc_free', 'Free hours', F.free, 'h')]),
      el('div', { class: 'cc-form-2' }, [num('acc_lay', 'Layover $/day', F.lay, '/day'), num('acc_tonu', 'TONU $', F.tonu, '')]),
      inp('acc_lumper', 'Lumper policy'),
      (Array.isArray(w.stops) && w.stops.length) ? num('acc_stop', 'Extra stop $/stop', F.stop, '/stop') : '',
      tgl('driver_assist_required', 'Driver assist (load/unload)', 'Standard $' + F.assist + '/stop — appears on the rate confirmation.'),
      lab('Where did this load come from? (source attribution)'),
      sel('src_board', BOARDS, 'Source *'),
      isExternal || w.src_board === 'Direct broker' ? el('div', null, [
        two(inp('src_company', 'Broker / customer company *'), inp('src_mc', 'Broker MC #')),
        two(inp('src_contact', 'Contact name'), inp('src_phone', 'Contact phone')),
        inp('src_email', 'Contact email'),
        two(inp('src_credit', 'Credit score (TransCredit/other)'), inp('src_dtp', 'Days-to-pay', 'number')),
        two(inp('src_posted_rate', 'Rate posted on the board (USD)', 'number'), el('div', null, [tgl('src_ratecon', 'Rate confirmation received', 'Broker issued the rate con in the carrier’s (or our) name — load is verified.')])),
        Number(w.src_posted_rate) > 0 && Number(w.rate) > 0 && Number(w.rate) !== Number(w.src_posted_rate) ? note('Posted $' + Number(w.src_posted_rate).toLocaleString() + ' → negotiated $' + Number(w.rate).toLocaleString() + ' (' + (Number(w.rate) > Number(w.src_posted_rate) ? '+' : '') + (Number(w.rate) - Number(w.src_posted_rate)).toLocaleString() + ')') : '',
        lab('Broker document numbers (go on the driver’s packet)'),
        two(inp('doc_pu', 'Pickup / PU number'), inp('doc_dn', 'Delivery number')),
        inp('doc_appt', 'Appointment confirmation #'),
      ] ) : '',
      isExternal && !w.src_ratecon ? note('⚠ No rate con yet — the load posts as UNVERIFIED. Get the rate confirmation before dispatching a carrier.', 'warn') : '',
    ]);
  }

  function bodyReview() {
    const rows = [];
    const add = (k, v) => { if (v != null && String(v).trim() !== '') rows.push(el('div', { style: 'display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dashed #eef2f7' }, [el('span', { class: 'cc-sub', style: 'font-weight:700' }, k), el('b', { style: 'text-align:right;color:#10223B' }, String(v))])); };
    add('Lane', cityLine(w.o_city, w.o_state) + ' → ' + cityLine(w.d_city, w.d_state) + (Number(w.miles) ? ' · ' + w.miles + ' mi' : ''));
    add('Pickup', (w.pickup_date || '—') + (w.sched_mode === 'fcfs' ? ' · FCFS' : w.sched_mode === 'appt' ? ' · appt ' + (w.pu_time || '') : w.pickup_window ? ' · ' + w.pickup_window : ''));
    add('Delivery', (w.delivery_date || '—') + (w.delivery_window ? ' · ' + w.delivery_window : ''));
    add('Equipment', (w.equipment || '—') + (w.load_size ? ' · ' + w.load_size : '') + (w.team_required ? ' · TEAM' : '') + (w.hazmat ? ' · ☢ HAZMAT' : ''));
    add('Freight', [w.commodity, w.weight, w.pallets ? w.pallets + ' plt' : null].filter(Boolean).join(' · '));
    add('Rate', Number(w.rate) ? '$' + Number(w.rate).toLocaleString() + (Number(w.miles) ? ' ($' + (Number(w.rate) / Number(w.miles)).toFixed(2) + '/mi)' : '') : '—');
    add('Rate card', '$' + w.acc_det + '/hr after ' + w.acc_free + 'h · layover $' + w.acc_lay + ' · TONU $' + w.acc_tonu + ' · ' + w.acc_lumper);
    add('Source', (w.src_board || '—') + (w.src_company ? ' · ' + w.src_company : '') + (w.reference ? ' · ref ' + w.reference : '') + (w.src_ratecon ? ' · rate con ✓' : ''));
    if (w.src_credit || w.src_dtp) add('Broker credit', [w.src_credit, w.src_dtp ? w.src_dtp + ' days-to-pay' : null].filter(Boolean).join(' · '));
    return el('div', null, [
      el('div', { class: 'lb-card', style: 'padding:14px 16px' }, rows),
      dups.length ? el('div', null, [
        note('⚠ Possible duplicate — ' + dups.length + ' open load(s) already on this lane & pickup date.', 'bad'),
        tgl('__dup_ok', 'Post anyway', 'I checked — this is a different load.'),
      ]) : '',
      note('On post: the load is live for verified carriers instantly. Use Assign for a committed carrier, or Send offers to run 2–3 candidates with an expiry.'),
    ]);
  }

  // ---------- validation ----------
  function problems() {
    const miss = [];
    if (step === 0) {
      if (!String(w.o_city || '').trim() || !String(w.o_state || '').trim()) miss.push('pickup city + state');
      if (!String(w.d_city || '').trim() || !String(w.d_state || '').trim()) miss.push('delivery city + state');
    } else if (step === 1) {
      if (!w.pickup_date) miss.push('pickup date');
      if (!w.sched_mode) miss.push('FCFS / appointment / window choice');
      if (w.sched_mode === 'window' && !String(w.pickup_window || '').trim()) miss.push('the pickup window');
      if (w.sched_mode === 'appt' && !w.pu_time) miss.push('the appointment time');
    } else if (step === 2) {
      if (!w.equipment) miss.push('equipment');
      if (!String(w.commodity || '').trim()) miss.push('commodity');
      if (!Number(w.rate)) miss.push('rate');
      if (w.hazmat && !(/^\d{4}$/.test(w.hz_un || '') && String(w.hz_class || '').trim())) miss.push('hazmat UN # + class');
    } else if (step === 3) {
      if (!w.src_board) miss.push('source attribution');
      if (w.src_board && w.src_board !== 'LoadBoot (own freight)' && !String(w.src_company || '').trim()) miss.push('broker company');
    } else if (step === 4) {
      if (dups.length && !w.__dup_ok) miss.push('duplicate acknowledgement');
    }
    return miss;
  }

  async function findDups() {
    try {
      const list = (await getLoadsList({ limit: 200 })) || [];
      const o = cityLine(w.o_city, w.o_state).toLowerCase(); const d = cityLine(w.d_city, w.d_state).toLowerCase();
      dups = list.filter(l => ['available', 'booked'].indexOf(String(l.status || '')) >= 0
        && String(l.origin || '').toLowerCase() === o && String(l.destination || '').toLowerCase() === d
        && String(l.pickup_date || '').slice(0, 10) === String(w.pickup_date || ''));
    } catch (_) { dups = []; }
  }

  async function submit(btn) {
    btn.disabled = true; btn.textContent = 'Posting…';
    const external = w.src_board && ['Direct broker', 'LoadBoot (own freight)'].indexOf(w.src_board) < 0;
    const payload = {
      source_type: external ? 'unverified_external' : 'staff_entered',
      source_provider: w.src_board || null,
      source_reference: (w.reference || '').trim() || null,
      verification_state: w.src_ratecon ? 'partial' : (external ? 'unverified' : 'partial'),
      confidence: w.src_ratecon ? 'high' : 'medium',
      origin: cityLine(w.o_city, w.o_state), destination: cityLine(w.d_city, w.d_state),
      origin_full: [w.o_street, w.o_city, w.o_state, w.o_zip].filter(Boolean).join(', ') || null,
      destination_full: [w.d_street, w.d_city, w.d_state, w.d_zip].filter(Boolean).join(', ') || null,
      pickup_lat: w.pickup_lat || null, pickup_lng: w.pickup_lng || null,
      delivery_lat: w.delivery_lat || null, delivery_lng: w.delivery_lng || null,
      equipment: w.equipment || null, rate: w.rate || null, miles: w.miles || null,
      commodity: w.commodity || null, weight: w.weight || null,
      pickup_date: w.pickup_date || null, delivery_date: w.delivery_date || null,
      broker: (w.src_company || '').trim() || null,
      requirements: [w.requirements, w.temperature ? 'Temp: ' + w.temperature : null, w.tarps && w.tarps !== 'No tarps' ? w.tarps : null, w.team_required ? 'TEAM required' : null].filter(Boolean).join(' · ') || null,
      notes: [w.doc_pu ? 'PU #: ' + w.doc_pu : null, w.doc_dn ? 'DEL #: ' + w.doc_dn : null, w.doc_appt ? 'Appt conf: ' + w.doc_appt : null, w.src_contact ? 'Broker contact: ' + [w.src_contact, w.src_phone, w.src_email].filter(Boolean).join(' · ') : null].filter(Boolean).join('\n') || null,
      hazmat: w.hazmat ? 'true' : 'false',
      details: {
        load_size: w.load_size || null, pallets: w.pallets || null, temperature: w.temperature || null,
        tarps: w.tarps || null, team_required: !!w.team_required, cargo_value: w.cargo_value || null,
        hazmat_info: w.hazmat ? ('UN' + w.hz_un + ' · Class ' + w.hz_class + (w.hz_pg ? ' · PG ' + w.hz_pg : '') + (w.hz_name ? ' · ' + w.hz_name : '')) : null,
        stops: (Array.isArray(w.stops) ? w.stops.filter(s => String(s.address || '').trim()) : []),
        source: { board: w.src_board || null, company: (w.src_company || '').trim() || null, mc: (w.src_mc || '').trim() || null, contact: (w.src_contact || '').trim() || null, phone: (w.src_phone || '').trim() || null, email: (w.src_email || '').trim() || null, credit_score: (w.src_credit || '').trim() || null, days_to_pay: w.src_dtp || null, posted_rate: w.src_posted_rate || null, rate_con_received: !!w.src_ratecon },
        docs: { pickup_number: w.doc_pu || null, delivery_number: w.doc_dn || null, appointment: w.doc_appt || null },
      },
      field_meta: {
        pickup_window: w.sched_mode === 'window' ? (w.pickup_window || null) : (w.sched_mode === 'appt' && w.pu_time ? w.pu_time : null),
        delivery_window: w.delivery_window || null,
        appointment_required: w.sched_mode === 'appt',
        accessorials: {
          detention_per_hr: String(w.acc_det), detention_free_hours: String(w.acc_free),
          layover_per_day: String(w.acc_lay), tonu: String(w.acc_tonu),
          driver_assist: w.driver_assist_required ? String(sv('driver_assist', 75)) : null,
          extra_stop: (Array.isArray(w.stops) && w.stops.length) ? String(w.acc_stop || sv('stop_off', 100)) : null,
          lumper_policy: w.acc_lumper, fcfs: w.sched_mode === 'fcfs' ? 'true' : 'false',
        },
      },
    };
    try {
      const id = await createLoadSourced(payload);
      try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
      toast('Load posted — live for verified carriers', 'success');
      drawer.close();
      if (opts.onDone) opts.onDone(id);
    } catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; btn.textContent = 'Post load'; }
  }

  // ---------- frame ----------
  function render() {
    const bodies = [bodyLane, bodySchedule, bodyFreight, bodyRateCardSource, bodyReview];
    const errHost = el('div', { class: 'err', style: 'margin-top:8px' });
    const nextBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const miss = problems();
      if (miss.length) { errHost.textContent = 'Required: ' + miss.join(', ') + '.'; return; }
      if (step === 3) { await findDups(); }
      if (step < STEPS.length - 1) { step++; render(); return; }
      submit(ev.currentTarget);
    } }, step === STEPS.length - 1 ? 'Post load' : 'Continue →');
    mount(stepHost, el('div', null, [
      el('div', { style: 'display:flex;gap:4px;margin-bottom:14px' }, STEPS.map((s, i) => el('div', { style: 'flex:1;text-align:center' }, [
        el('div', { style: 'height:5px;border-radius:99px;background:' + (i < step ? '#22c55e' : i === step ? '#0883F7' : '#e2e8f0') }),
        el('div', { style: 'font-size:.62rem;font-weight:800;margin-top:4px;color:' + (i <= step ? '#10223B' : '#94a3b8') }, (i + 1) + '. ' + s),
      ]))),
      bodies[step](),
      errHost,
      el('div', { style: 'display:flex;gap:8px;justify-content:space-between;margin-top:16px' }, [
        step > 0 ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => { step--; render(); } }, '← Back') : el('span'),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onClick: () => { if (confirm('Clear the draft and start over?')) { for (const k in w) delete w[k]; try { localStorage.removeItem(DRAFT_KEY); } catch (_) {} step = 0; render(); } } }, 'Clear draft'),
          nextBtn,
        ]),
      ]),
    ]));
  }
  render();
  return drawer;
}
