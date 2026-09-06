// Daily truck availability — owner rule 5 Sep 2026.
//
// One card, three places (Dashboard, Load Board, and the posting form's footer) that always says the
// same thing: LoadBoot's dedicated dispatcher works a carrier's loads ONLY while at least one
// availability post was confirmed in the last 24 hours. A post is either "my truck is empty at X"
// or "I'm booked, I deliver at X on <date> and need a backhaul toward Y". Posts go stale daily.
//
// Additive module. It receives the portal's own h() so it renders in the portal's theme, and it
// never talks to the backend itself — the caller passes the status object from
// cc_my_availability_status() and the callbacks. Nothing here can break booking/settlement engines.

export const AVAIL_RULE = 'Your dedicated LoadBoot dispatcher works your loads only while an availability post is confirmed within the last 24 hours. Posts expire daily — confirm every morning, or post the backhaul the moment you are booked.';

export function fleetGap(status) {
  const s = status || {};
  if (s.has_truck === false && s.has_driver === false) return 'truck and driver';
  if (s.has_truck === false) return 'truck';
  if (s.has_driver === false) return 'driver';
  return null;
}

function agoText(hours) {
  if (hours == null) return '';
  if (hours < 1) return 'just now';
  if (hours < 24) return hours + 'h ago';
  const d = Math.floor(hours / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

// Route the carrier to the exact missing Fleet step. #fleet/add-truck and #fleet/add-driver are
// existing deep links (LB_DEEP in app.js) that open the matching form on arrival.
export function goFleet(which) {
  try { location.hash = which === 'driver' ? '#fleet/add-driver' : '#fleet/add-truck'; } catch (_) {}
}

// opts: { h, status, variant: 'dashboard'|'board', onPost(kind), onConfirm(), busy }
export function renderAvailabilityCard(host, opts) {
  const h = opts.h; const s = opts.status || {}; const variant = opts.variant || 'dashboard';
  host.innerHTML = '';
  const gap = fleetGap(s);
  const live = Number(s.live || 0), fresh = Number(s.fresh || 0);
  const hrs = s.hours_since_confirm;

  let tone, title, body, actions;
  if (gap) {
    tone = { c: '#FC5305', bg: 'rgba(252,83,5,.08)', label: 'Setup needed' };
    title = 'Post your availability — add your ' + gap + ' first';
    body = 'We post trucks, not accounts. Add at least one truck and one driver under Fleet, then post where the truck is today.';
    actions = [
      (s.has_truck === false) ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => goFleet('truck') }, '+ Add truck') : null,
      (s.has_driver === false) ? h('button', { class: 'cp-btn cp-btn-sm' + (s.has_truck === false ? ' ghost' : ''), onClick: () => goFleet('driver') }, '+ Add driver') : null,
    ];
  } else if (fresh > 0) {
    tone = { c: '#4ade80', bg: 'rgba(74,222,128,.07)', label: 'Dispatcher working your loads' };
    title = fresh + ' truck' + (fresh === 1 ? '' : 's') + ' posted · confirmed ' + agoText(hrs);
    body = 'Your dispatcher is sourcing against this post right now. It expires ' + (hrs != null ? 'in ' + Math.max(0, 24 - hrs) + 'h' : 'in 24h') + ' — confirm again tomorrow morning, or post the backhaul as soon as you are booked.';
    if (Number(s.paused || 0) > 0) body += ' ' + s.paused + ' other truck' + (Number(s.paused) === 1 ? ' is' : 's are') + ' switched off.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => opts.onPost && opts.onPost('empty') }, '+ Post another truck'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('backhaul') }, 'Booked — post backhaul'),
    ];
  } else if (Number(s.paused || 0) > 0 && live === 0) {
    // The carrier switched the truck off themselves — say that, not "you forgot to post".
    const np = Number(s.paused || 0);
    tone = { c: '#94a3b8', bg: 'rgba(148,163,184,.08)', label: 'You marked it not available' };
    title = np + ' truck' + (np === 1 ? '' : 's') + ' switched off — dispatcher stopped';
    body = 'Nothing is being sourced for you right now, by your own choice. When the truck frees up, tap Available: everything you posted last time comes back, and you only enter today’s dates.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => opts.onReactivate ? opts.onReactivate() : (opts.onPost && opts.onPost('empty')) }, 'Available again'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('backhaul') }, 'Booked — post backhaul'),
    ];
  } else if (live > 0) {
    tone = { c: '#fbbf24', bg: 'rgba(251,191,36,.08)', label: 'Confirm today' };
    title = 'Your post is ' + (hrs != null ? hrs + ' hours' : 'a day') + ' old — still right?';
    body = 'Until you confirm, your dedicated dispatcher is paused on your loads. One tap if the truck is still there; update it if it moved.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', disabled: opts.busy ? 'disabled' : null, onClick: () => opts.onConfirm && opts.onConfirm() }, '✓ Still available today'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('empty') }, 'Truck moved — update'),
    ];
  } else {
    tone = { c: '#FC5305', bg: 'rgba(252,83,5,.08)', label: 'Dispatcher paused' };
    title = 'No availability posted today';
    body = 'Your dedicated dispatcher is not working your loads right now — we only source for trucks we know are free. Tell us where the truck is (30 seconds), or where it delivers if you are booked and need a backhaul.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => opts.onPost && opts.onPost('empty') }, '+ Post availability'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('backhaul') }, 'Booked — need a backhaul'),
    ];
  }

  const card = h('div', { class: 'cp-card', 'data-lb': 'avail-card', style: 'border-left:4px solid ' + tone.c + ';background:' + tone.bg + (variant === 'board' ? ';margin-bottom:12px' : '') }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap' }, [
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { class: 'cp-row-s', style: 'color:' + tone.c + ';font-weight:800;letter-spacing:.02em;text-transform:uppercase;font-size:.72rem' }, tone.label),
        h('div', { class: 'cp-row-t', style: 'margin-top:2px' }, title),
        h('div', { class: 'cp-row-s', style: 'margin-top:4px;line-height:1.5' }, body),
      ]),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, actions.filter(Boolean)),
    ]),
    h('div', { class: 'cp-row-s', style: 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(148,163,184,.18);font-size:.78rem;color:#94a3b8;line-height:1.5' }, [
      h('span', { style: 'font-weight:800;color:#cbd5e1' }, 'The rule: '), AVAIL_RULE,
    ]),
  ]);
  host.appendChild(card);
  return card;
}

// Short line for the posting form footer and the per-post rows.
export function freshnessLine(h, p) {
  if (!p) return null;
  if (p.status === 'paused') return null;
  if (p.is_fresh) return h('div', { class: 'cp-row-s', style: 'color:#4ade80;font-weight:700;margin-top:2px' }, '● Confirmed ' + agoText(p.hours_since_confirm) + ' · dispatcher working it');
  if (p.is_live) return h('div', { class: 'cp-row-s', style: 'color:#fbbf24;font-weight:700;margin-top:2px' }, '◐ Not confirmed today (' + agoText(p.hours_since_confirm) + ') — dispatcher paused until you confirm');
  return null;
}

// ---------------------------------------------------------------------------------------------
// Place pickers (5 Sep 2026 v2): State → City dropdowns from the offline US_CITIES list, free-text
// "other city", optional ZIP. Returns { el, get(), set(v) }. get() → { city, state, zip, text }.
// ---------------------------------------------------------------------------------------------
export const US_STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],
  ['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],
  ['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],
  ['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
];

function citiesIn(all, st) {
  const out = [];
  (all || []).forEach((c) => { const i = c.lastIndexOf(', '); if (i > 0 && c.slice(i + 2) === st) out.push(c.slice(0, i)); });
  return out;
}

// opts: { h, cities: US_CITIES, withZip: bool, value: {city,state,zip}, cityPlaceholder }
export function buildPlacePicker(opts) {
  const h = opts.h; const cities = opts.cities || [];
  const stSel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'State…')].concat(US_STATES.map((s) => h('option', { value: s[0] }, s[0] + ' — ' + s[1]))));
  const citySel = h('select', { class: 'cp-in' }, [h('option', { value: '' }, 'Pick a state first')]);
  const cityTxt = h('input', { class: 'cp-in', placeholder: opts.cityPlaceholder || 'City name (e.g. Laredo)', style: 'display:none' });
  const zip = opts.withZip ? h('input', { class: 'cp-in', inputmode: 'numeric', maxlength: '5', placeholder: 'ZIP (optional, e.g. 75201) — exact deadhead' }) : null;
  const OTHER = '__other__';
  const fillCities = (st, keep) => {
    const list = citiesIn(cities, st);
    citySel.innerHTML = '';
    citySel.appendChild(h('option', { value: '' }, list.length ? 'City… (' + list.length + ' in ' + st + ')' : 'City…'));
    list.forEach((c) => citySel.appendChild(h('option', { value: c }, c)));
    citySel.appendChild(h('option', { value: OTHER }, 'Other city — type it'));
    if (keep && list.indexOf(keep) >= 0) { citySel.value = keep; cityTxt.style.display = 'none'; }
    else if (keep) { citySel.value = OTHER; cityTxt.value = keep; cityTxt.style.display = ''; }
    else { cityTxt.style.display = 'none'; cityTxt.value = ''; }
  };
  stSel.addEventListener('change', () => fillCities(stSel.value, null));
  citySel.addEventListener('change', () => { cityTxt.style.display = citySel.value === OTHER ? '' : 'none'; if (citySel.value === OTHER) cityTxt.focus(); });
  if (zip) zip.addEventListener('input', () => { zip.value = zip.value.replace(/\D/g, '').slice(0, 5); });
  const row = h('div', { class: 'cp-formrow2', style: 'grid-template-columns:1fr 1.4fr' }, [stSel, citySel]);
  const el = h('div', null, [row, cityTxt, zip].filter(Boolean));
  const api = {
    el,
    get() {
      const state = stSel.value || '';
      const city = (citySel.value === OTHER ? cityTxt.value : citySel.value || '').trim();
      const z = zip ? zip.value.trim() : '';
      return { city, state, zip: z, text: city && state ? city + ', ' + state : '' };
    },
    set(v) {
      v = v || {};
      let city = v.city || '', state = v.state || '';
      if ((!city || !state) && v.text) { const i = String(v.text).lastIndexOf(', '); if (i > 0) { city = city || v.text.slice(0, i); state = state || v.text.slice(i + 2).toUpperCase(); } }
      stSel.value = state || '';
      fillCities(state || '', city || null);
      if (zip) zip.value = v.zip || '';
    },
    focusState() { stSel.focus(); },
  };
  api.set(opts.value || {});
  return api;
}

// Destination: Anywhere | A state | A city. get() → text for dest_pref ('' = anywhere).
// opts: { h, cities, value: text, allowAnywhere: bool }
export function buildDestPicker(opts) {
  const h = opts.h;
  const mode = h('select', { class: 'cp-in' }, [
    opts.allowAnywhere !== false ? h('option', { value: 'any' }, 'Anywhere — best paying load wins') : null,
    h('option', { value: 'state' }, 'Toward a state (e.g. TX)'),
    h('option', { value: 'city' }, 'Toward a city (e.g. Dallas, TX)'),
  ].filter(Boolean));
  const stSel = h('select', { class: 'cp-in', style: 'display:none' }, [h('option', { value: '' }, 'State…')].concat(US_STATES.map((s) => h('option', { value: s[0] }, s[0] + ' — ' + s[1]))));
  const place = buildPlacePicker({ h, cities: opts.cities, withZip: false, cityPlaceholder: 'City you want to reload toward' });
  place.el.style.display = 'none';
  const paint = () => { stSel.style.display = mode.value === 'state' ? '' : 'none'; place.el.style.display = mode.value === 'city' ? '' : 'none'; };
  mode.addEventListener('change', paint);
  const el = h('div', null, [mode, stSel, place.el]);
  const api = {
    el,
    get() { if (mode.value === 'any') return ''; if (mode.value === 'state') return stSel.value || ''; const p = place.get(); return p.text || ''; },
    set(text) {
      text = (text || '').trim();
      if (!text) { mode.value = opts.allowAnywhere !== false ? 'any' : 'state'; stSel.value = ''; place.set({}); }
      else if (/^[A-Za-z]{2}$/.test(text)) { mode.value = 'state'; stSel.value = text.toUpperCase(); }
      else if (text.indexOf(',') > 0) { mode.value = 'city'; place.set({ text }); }
      else { mode.value = 'state'; const m = US_STATES.find((s) => s[1].toLowerCase() === text.toLowerCase()); stSel.value = m ? m[0] : ''; }
      paint();
    },
    setAllowAnywhere(ok) { const o = mode.querySelector('option[value="any"]'); if (o) o.disabled = !ok; if (!ok && mode.value === 'any') { mode.value = 'state'; paint(); } },
    isValid() { if (mode.value === 'any') return true; if (mode.value === 'state') return !!stSel.value; const p = place.get(); return !!(p.city && p.state); },
  };
  api.set(opts.value || '');
  return api;
}

// Hard fleet gate modal body: explains and routes. opts: { h, status }
export function fleetGateBody(opts) {
  const h = opts.h; const s = opts.status || {}; const gap = fleetGap(s) || 'truck and driver';
  return h('div', null, [
    h('div', { style: 'border-left:4px solid #FC5305;background:rgba(252,83,5,.08);border-radius:12px;padding:12px 14px;margin-bottom:12px' }, [
      h('div', { class: 'cp-row-t' }, 'Add your ' + gap + ' first'),
      h('div', { class: 'cp-row-s', style: 'margin-top:4px;line-height:1.55' }, 'Availability is posted per truck, and a dispatcher only sells a unit with a driver behind it. Add at least one truck (with its VIN) and one driver under Fleet — then come back here; it takes a minute.'),
    ]),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      (s.has_truck === false) ? h('button', { class: 'cp-btn', onClick: () => goFleet('truck') }, '+ Add truck') : null,
      (s.has_driver === false) ? h('button', { class: 'cp-btn' + (s.has_truck === false ? ' ghost' : ''), onClick: () => goFleet('driver') }, '+ Add driver') : null,
    ].filter(Boolean)),
    h('div', { class: 'cp-row-s', style: 'margin-top:12px;font-size:.8rem;color:#94a3b8;line-height:1.5' }, AVAIL_RULE),
  ]);
}

// Expiry line for a posting row (v2): counts down to expires_at; expired → red.
export function expiryLine(h, p) {
  if (!p) return null;
  if (p.status === 'paused') return h('div', { class: 'cp-row-s', style: 'color:#94a3b8;font-weight:700;margin-top:2px' }, '⏸ Not available — off the board, dispatcher stopped. Tap Available when the truck frees up.');
  if (p.status === 'expired' || (p.is_live === false && p.hours_left === 0)) return h('div', { class: 'cp-row-s', style: 'color:#fca5a5;font-weight:700;margin-top:2px' }, '⚠ Expired — dispatcher stopped. Tap Repost if the truck is still there, or post where it is now.');
  if (p.is_fresh) return h('div', { class: 'cp-row-s', style: 'color:#4ade80;font-weight:700;margin-top:2px' }, '● Live · expires in ' + (p.hours_left != null ? p.hours_left + 'h' : '24h') + ' · dispatcher working it' + (p.geocoded ? '' : ' · locating…'));
  if (p.is_live) return h('div', { class: 'cp-row-s', style: 'color:#fbbf24;font-weight:700;margin-top:2px' }, '◐ Not confirmed today (' + agoText(p.hours_since_confirm) + ') — dispatcher paused until you confirm');
  return null;
}
