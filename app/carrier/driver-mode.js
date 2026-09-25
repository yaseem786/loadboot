// driver-mode.js — the carrier app when the signed-in member is a DRIVER (bl_drv_0344, 14 Sep 2026).
// Same app, same login, same PWA/Play package; the shell asks cc_my_driver_context() first and, for a
// driver, builds the nav from the owner's permissions, swaps Dashboard for "Today" and Account for "Me",
// skips every owner prompt (onboarding, payments, referral, availability), gates Android drivers behind
// the Play Store app when the owner requires it, heartbeats presence/location, and listens for the
// owner's permission changes in real time. The server denies anything not granted regardless.
// UI primitives (h, mount, openModal, lbToast, icon, cardHead) come from app.js via window.__lbUI.
import { myDriverContext, driverHeartbeat, driverMyEarnings, driverMySettlements, driverMyDocs, driverDocUpload, driverUpdateMyProfile,
  pocketTrips, pocketCompliance, pocketTrucks, pocketDrivers } from '../shared/api.js';
import { uploadDriverOwnDoc, signedDocumentUrl } from '../shared/storage.js';
import { getClient } from '../shared/supabaseClient.js';
import { signOut } from '../shared/session.js';

const UI = () => window.__lbUI;
const PLAY_ID = 'com.loadboot.app';
const PLAY_URL = 'https://play.google.com/store/apps/details?id=' + PLAY_ID;

export function platformInfo() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  const android = /Android/i.test(ua);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const twa = /android-app:\/\//.test(document.referrer || '') || standalone;
  return { platform: ios ? 'ios' : android ? 'android' : 'web', standalone: !!standalone, twa: android && !!twa, model: (ua.match(/\(([^)]+)\)/) || [])[1] || null };
}

// Nav built from permissions. Order = what a driver reaches for most.
export function driverNav(ctx) {
  const p = new Set(ctx.perms || []);
  const has = (...k) => k.some((x) => p.has(x));
  const nav = [['dashboard', 'Today', 'dash'], ['trips', 'My loads', 'trips']];
  if (has('loads.view_board')) nav.push(['loads', 'Load board', 'loads']);   // truck posting lives on the board view and needs the board
  if (has('fleet.view', 'fleet.maintenance', 'fleet.edit_trucks')) nav.push(['fleet', 'Fleet', 'truck']);
  if (has('docs.view_status')) nav.push(['documents', 'Documents', 'docs']);
  if (has('finance.view_earnings', 'finance.add_expenses', 'finance.view_settlements')) nav.push(['finance', 'Earnings', 'finance']);
  if (has('loads.see_rates')) nav.push(['rates', 'Market rates', 'finance']);
  nav.push(['notifications', 'Alerts', 'bell'], ['safety', 'Safety', 'sos'], ['support', 'Support', 'support'], ['account', 'Me', 'user']);
  const seen = new Set(); return nav.filter((n) => { if (seen.has(n[0])) return false; seen.add(n[0]); return true; });
}
export const DRIVER_TABBAR = ['dashboard', 'trips', 'notifications', 'safety', 'account'];

// ---- Android install wall (owner setting: require_android_app) --------------------------------
export function installGate(root, ctx, user) {
  const pi = platformInfo();
  if (pi.platform !== 'android' || !ctx.require_android_app || pi.twa) return false;
  try { if (sessionStorage.getItem('lb_drv_installwall_ok') === '1') return false; } catch (_) {}
  const { h, mount } = UI();
  const intent = 'intent://loadboot.com/app/carrier/#Intent;scheme=https;package=' + PLAY_ID + ';S.browser_fallback_url=' + encodeURIComponent(PLAY_URL) + ';end';
  mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card dm-wall' }, [
    h('div', { class: 'dm-brand', style: 'display:flex;align-items:flex-start;gap:4px' }, [h('img', { src: '/logo-full-dark.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, 'Driver')]),
    h('h1', null, 'Install the LoadBoot app to continue'),
    h('p', { class: 'cp-auth-sub' }, (ctx.carrier || 'Your carrier') + ' requires the app on Android — GPS check-in, live tracking on active loads and POD upload only work inside it. It takes about 30 seconds.'),
    h('a', { class: 'cp-btn cp-btn-lg dm-play', href: PLAY_URL, target: '_blank', rel: 'noopener' }, '▶ Get it on Google Play'),
    h('a', { class: 'cp-btn cp-btn-lg ghost', href: intent, style: 'margin-top:8px' }, 'Already installed? Open the app'),
    h('div', { class: 'dm-steps' }, [
      h('span', null, '1 · Install from Google Play'),
      h('span', null, '2 · Open LoadBoot from your home screen — you stay signed in'),
      h('span', null, '3 · Allow Location and Notifications when asked'),
    ]),
    h('button', { class: 'dm-link', onClick: () => { try { sessionStorage.setItem('lb_drv_installwall_ok', '1'); } catch (_) {} location.reload(); } }, 'Continue in the browser this once (no background tracking)'),
    h('div', { class: 'cp-auth-sub', style: 'margin-top:14px;font-size:.78rem' }, (user && user.email) || ''),
  ])));
  return true;
}

// ---- suspended / not linked ------------------------------------------------------------------
export function renderBlocked(root, ctx, user) {
  const { h, mount } = UI();
  const paused = ctx.membership_status === 'suspended';
  mount(root, h('div', { class: 'cp-auth' }, h('div', { class: 'cp-auth-card dm-wall' }, [
    h('div', { class: 'dm-brand', style: 'display:flex;align-items:flex-start;gap:4px' }, [h('img', { src: '/logo-full-dark.png', alt: 'LoadBoot', style: 'height:34px;width:auto;display:block' }), h('span', { style: "font-family:'Manrope',sans-serif;font-size:12px;font-weight:600;color:#FB923C;line-height:1;margin-top:7px" }, 'Driver')]),
    h('h1', null, paused ? 'Access paused' : 'Almost there'),
    h('p', { class: 'cp-auth-sub' }, paused
      ? (ctx.carrier || 'Your carrier') + ' paused your app access. Nothing is lost — call the owner to resume it, and this screen updates by itself.'
      : 'Your login is not linked to a driver record at ' + (ctx.carrier || 'your carrier') + ' yet. Ask the owner to send you a fresh invite from Fleet → Invite to app.'),
    h('button', { class: 'cp-btn cp-btn-lg', onClick: () => location.reload() }, 'Check again'),
    h('button', { class: 'cp-btn cp-btn-lg ghost', style: 'margin-top:8px', onClick: async () => { await signOut(); location.href = location.pathname + '?role=driver'; } }, 'Sign out'),
    h('div', { class: 'cp-auth-sub', style: 'margin-top:14px;font-size:.78rem' }, (user && user.email) || ''),
  ])));
  subscribe(ctx, () => location.reload());
}

// ---- presence heartbeat + realtime ------------------------------------------------------------
let _hb = null;
export function startHeartbeat(ctx) {
  if (_hb) return;
  const pi = platformInfo();
  let locOn = null;
  async function locState() {
    try { if (navigator.permissions && navigator.permissions.query) { const s = await navigator.permissions.query({ name: 'geolocation' }); locOn = s.state === 'granted'; s.onchange = () => { locOn = s.state === 'granted'; beat(); }; } } catch (_) {}
  }
  async function beat() {
    if (document.visibilityState === 'hidden') return;
    try { await driverHeartbeat({ platform: pi.platform, standalone: pi.standalone || pi.twa, device: { model: pi.model, ua: (navigator.userAgent || '').slice(0, 160) }, locationOn: locOn }); } catch (_) {}
  }
  locState().then(beat);
  _hb = setInterval(beat, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
}

let _chan = null;
export async function subscribe(ctx, onChange) {
  const { lbToast } = UI();
  try {
    const sb = await getClient();
    const { data } = await sb.auth.getUser(); const me = data && data.user && data.user.id;
    if (_chan) { try { _chan.unsubscribe(); } catch (_) {} }
    _chan = sb.channel('drv-me-' + ctx.org_id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_access_events', filter: 'org_id=eq.' + ctx.org_id }, (payload) => {
        const ev = payload && payload.new; if (!ev) return;
        if (ev.user_id && ev.user_id !== me) return;
        const p = ev.payload || {};
        if (ev.kind === 'grants.changed' && ev.user_id === me) {
          const on = (p.added || []).length, off = (p.removed || []).length;
          if (lbToast) lbToast((on ? on + ' turned on' : '') + (on && off ? ' · ' : '') + (off ? off + ' turned off' : '') + ' — refreshing your app.', 'action', 'Your carrier updated your access');
          setTimeout(() => onChange && onChange(ev), 1200);
        } else if ((ev.kind === 'driver.suspended' || ev.kind === 'driver.removed' || ev.kind === 'driver.active') && ev.user_id === me) {
          setTimeout(() => onChange && onChange(ev), 600);
        } else if (ev.kind === 'doc.reviewed' && ev.user_id === me) {
          if (lbToast) lbToast((p.kind === 'cdl' ? 'CDL' : p.kind === 'medical' ? 'Medical card' : 'Document') + ' ' + p.status + (p.note ? ' — ' + p.note : ''), p.status === 'approved' ? 'success' : 'warning', 'Document reviewed');
        }
      }).subscribe();
  } catch (_) {}
}

// ---- Today ------------------------------------------------------------------------------------
const fmtWhen = (iso) => { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
const STATUS_LABEL = { planned: 'Planned', dispatched: 'Dispatched', at_pickup: 'At pickup', loaded: 'Loaded', in_transit: 'In transit', en_route: 'En route', at_delivery: 'At delivery', delivered: 'Delivered' };

export async function renderToday(content, ctx, api) {
  const { h, mount, icon, cardHead } = UI();
  const pi = platformInfo();
  const perms = new Set(ctx.perms || []);
  let trips = []; try { trips = (await pocketTrips(20)) || []; } catch (_) {}
  const active = trips.filter((t) => !['delivered', 'cancelled', 'completed', 'invoiced', 'paid'].includes(String(t.status)));
  const cur = active[0] || null; const next = active.slice(1, 3);
  // Same meaning as the owner's portal: onboarding decided + org active (server-computed). Falls back to status only if the flag is absent.
  const carrierOk = typeof ctx.carrier_verified === 'boolean' ? ctx.carrier_verified : (String(ctx.carrier_status || '').toLowerCase() === 'active');
  const go = (tab, id) => { if (id) { window.__lbDeepEnt = { tab, id }; location.hash = '#' + tab + '/' + id; } else api.go(tab); };
  const tripCard = (t, primary) => h('div', { class: 'cp-card dm-trip' + (primary ? ' primary' : ''), onClick: () => go('trips', t.id) }, [
    h('div', { class: 'cp-row-s dm-kicker' }, primary ? (STATUS_LABEL[t.status] || t.status || 'Load') : 'Next · ' + fmtWhen(t.scheduled_pickup)),
    h('div', { class: 'dm-lane' }, [h('b', null, t.origin || '—'), h('span', null, '→'), h('b', null, t.destination || '—')]),
    h('div', { class: 'cp-row-s' }, [t.scheduled_pickup ? 'Pickup ' + fmtWhen(t.scheduled_pickup) : null, t.scheduled_delivery ? 'Deliver ' + fmtWhen(t.scheduled_delivery) : null, t.rate != null ? '$' + Number(t.rate).toLocaleString() : (perms.has('loads.see_rates') ? null : 'Rate hidden by carrier')].filter(Boolean).join(' · ')),
    primary ? h('div', { class: 'cp-trip-actions', style: 'margin-top:10px' }, [h('button', { class: 'cp-btn' }, 'Open load — check in, POD, report issue')]) : null,
  ].filter(Boolean));
  const locCard = h('div', { class: 'cp-card dm-loc' }, [
    h('div', { class: 'cp-row-t' }, [icon('pin', 16), ' Location sharing'] ),
    h('div', { class: 'cp-row-s', id: 'dm-loc-state' }, 'Checking…'),
    h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Shared only while a load is active. Dispatch sees the truck; your carrier gets detention proof.'),
    h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => { try { navigator.geolocation.getCurrentPosition(() => paintLoc('granted'), () => paintLoc('denied')); } catch (_) {} } }, 'Allow location'),
  ]);
  function paintLoc(state) { const el = locCard.querySelector('#dm-loc-state'); if (!el) return; el.textContent = state === 'granted' ? '✓ Allowed on this phone' : state === 'denied' ? 'Blocked — turn it on in phone Settings → Apps → LoadBoot → Location' : 'Not allowed yet'; el.style.color = state === 'granted' ? '#4ade80' : state === 'denied' ? '#f87171' : '#fbbf24'; locCard.querySelector('button').hidden = state === 'granted'; }
  try { if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: 'geolocation' }).then((s) => paintLoc(s.state)); else paintLoc('prompt'); } catch (_) { paintLoc('prompt'); }
  const install = (pi.platform === 'android' && !pi.twa) ? h('div', { class: 'cpx-banner amber', onClick: () => window.open(PLAY_URL, '_blank', 'noopener') }, [h('span', null, icon('alert', 15)), h('span', null, 'Install the LoadBoot app from Google Play — background tracking and check-in need it'), h('span', { class: 'cpx-b-go' }, '›')])
    : (pi.platform === 'ios' && !pi.standalone) ? h('div', { class: 'cpx-banner amber' }, [h('span', null, icon('alert', 15)), h('span', null, 'Add LoadBoot to your Home Screen: tap Share ⎋ then “Add to Home Screen”'), h('span', { class: 'cpx-b-go' }, '›')]) : null;
  const can = (ctx.catalog && ctx.catalog.catalog || []).filter((c) => c.kind === 'optional' && perms.has(c.key)).map((c) => c.label);
  mount(content, h('div', null, [
    h('div', { class: 'dm-hero', 'data-tour': 'today' }, [
      h('div', null, [h('div', { class: 'dm-hi' }, 'Hi ' + ((ctx.fleet_driver && ctx.fleet_driver.name) || '').split(' ')[0]), h('div', { class: 'cp-row-s' }, 'Driving for ' + (ctx.carrier || 'your carrier'))]),
      h('span', { class: 'da-pill ' + (carrierOk ? 'ok' : 'warn') }, [h('i'), carrierOk ? 'Verified carrier' : 'Carrier setup pending']),
    ]),
    install,
    !carrierOk ? h('div', { class: 'cp-card', style: 'border-left:4px solid #f59e0b' }, [h('div', { class: 'cp-row-t' }, 'Your carrier is finishing setup'), h('div', { class: 'cp-row-s' }, 'Loads appear here once LoadBoot approves the account. Nothing for you to upload — the owner handles it.')]) : null,
    cur ? tripCard(cur, true) : h('div', { class: 'cp-card' }, [cardHead('No load assigned right now', 'your carrier assigns loads to your truck'), h('div', { class: 'cp-row-s' }, perms.has('loads.view_board') ? 'You can browse the load board and request loads for your truck.' : 'When dispatch assigns you a load it shows here with an alert.'), perms.has('loads.view_board') ? h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-top:8px', onClick: () => api.go('loads') }, 'Open load board') : null].filter(Boolean)),
    ...next.map((t) => tripCard(t, false)),
    locCard,
    ctx.docs_pending ? h('div', { class: 'cp-card', style: 'border-left:4px solid #0883F7' }, [h('div', { class: 'cp-row-t' }, ctx.docs_pending + ' document' + (ctx.docs_pending > 1 ? 's' : '') + ' waiting for your carrier’s review'), h('div', { class: 'cp-row-s' }, 'You will get an alert when it is approved.')]) : null,
    h('div', { class: 'cp-card' }, [cardHead('What you can do here', (11 + can.length) + ' permissions from ' + (ctx.carrier || 'your carrier')),
      h('div', { class: 'cp-row-s' }, 'Always: your loads, GPS check-in, live location on active loads, POD upload, detention / lumper / breakdown reports, SOS, alerts, support chat.'),
      can.length ? h('div', { class: 'da-chips', style: 'margin-top:8px' }, can.map((l) => h('span', { class: 'da-pill blue' }, l))) : h('div', { class: 'cp-row-s', style: 'margin-top:6px;color:#94a3b8' }, 'Need the load board, fleet or earnings? Ask the owner — changes reach this phone in seconds.'),
    ]),
  ].filter(Boolean)));
}

// ---- Me (profile, own docs, sign out) --------------------------------------------------------
// Me → App card. Platform-aware, in the driver's own words: installed → confirmation; Android browser → Play Store;
// iPhone → Home-Screen steps; desktop → both, plus the login link to copy / WhatsApp to their own phone.
const LOGIN_URL = 'https://loadboot.com/app/carrier/?role=driver';
const INTENT_URL = 'intent://loadboot.com/app/carrier/#Intent;scheme=https;package=' + PLAY_ID + ';S.browser_fallback_url=' + encodeURIComponent(PLAY_URL) + ';end';
function installCard(h, cardHead) {
  const pi = platformInfo();
  const steps = (rows) => h('div', { class: 'dm-steps' }, rows.map((r, i) => h('span', null, [h('b', { class: 'dm-n' }, String(i + 1)), ' '].concat(Array.isArray(r) ? r : [r]))));
  const play = () => h('a', { class: 'cp-btn cp-btn-lg dm-play', href: PLAY_URL, target: '_blank', rel: 'noopener' }, '▶ Get it on Google Play');
  const openApp = () => h('a', { class: 'cp-btn cp-btn-sm ghost', href: INTENT_URL, style: 'margin-top:8px' }, 'Already installed? Open the app');
  const linkBox = () => {
    const inp = h('input', { class: 'cp-in', readonly: 'readonly', value: LOGIN_URL, style: 'min-width:0;margin:0;font-size:.84rem', onClick: (e) => e.target.select() });
    const cp = h('button', { class: 'cp-btn cp-btn-sm', style: 'margin:0;flex:none' }, 'Copy');
    cp.onclick = async () => { try { await navigator.clipboard.writeText(LOGIN_URL); } catch (_) { inp.select(); try { document.execCommand('copy'); } catch (__) {} } cp.textContent = 'Copied ✓'; setTimeout(() => { cp.textContent = 'Copy'; }, 2000); };
    return h('div', { class: 'dm-link' }, [inp, cp]);
  };
  const waSelf = () => h('a', { class: 'cp-btn cp-btn-sm ghost', target: '_blank', rel: 'noopener', style: 'margin-top:8px', href: 'https://wa.me/?text=' + encodeURIComponent('LoadBoot Driver — sign in here: ' + LOGIN_URL + '\nAndroid app: ' + PLAY_URL) }, 'Send this link to my phone (WhatsApp)');
  const iosSteps = () => steps([['Open ', h('b', null, 'loadboot.com/app/carrier'), ' in ', h('b', null, 'Safari')], ['Tap ', h('b', null, 'Share ⎋'), ' at the bottom'], ['Tap ', h('b', null, 'Add to Home Screen'), ' → ', h('b', null, 'Add')], ['Open LoadBoot from your Home Screen and sign in once — then allow ', h('b', null, 'Location'), ' + ', h('b', null, 'Notifications')]]);
  if (pi.twa || pi.standalone) {
    return h('div', { class: 'cp-card' }, [cardHead('App', pi.platform === 'android' ? 'Android · installed' : pi.platform === 'ios' ? 'iPhone · Home Screen' : 'Installed'),
      h('div', { class: 'cp-row-s', style: 'color:#86efac' }, '✓ Installed — background tracking, GPS check-in and alerts work.'),
      pi.model ? h('div', { class: 'cp-row-s' }, 'Device: ' + pi.model) : null].filter(Boolean));
  }
  if (pi.platform === 'android') {
    return h('div', { class: 'cp-card' }, [cardHead('App', 'Android · browser'),
      h('div', { class: 'cp-row-s' }, 'GPS check-in and live tracking only work in the installed app. It takes about a minute and you stay signed in.'),
      play(), openApp(),
      steps(['Install from Google Play', 'Open it — you are already signed in', 'Allow Location + Notifications'])]);
  }
  if (pi.platform === 'ios') {
    return h('div', { class: 'cp-card' }, [cardHead('App', 'iPhone · Safari'),
      h('div', { class: 'cp-row-s' }, 'Add LoadBoot to your Home Screen — it opens full-screen like an app, and alerts and GPS work reliably.'),
      iosSteps()]);
  }
  return h('div', { class: 'cp-card' }, [cardHead('App', 'Desktop browser'),
    h('div', { class: 'cp-row-s' }, 'You are on a computer. GPS check-in, live tracking and POD photos happen on your phone — put LoadBoot on it:'),
    h('div', { class: 'dm-inst' }, [
      h('div', null, [h('div', { class: 'dm-h' }, 'Android'), play()]),
      h('div', null, [h('div', { class: 'dm-h' }, 'iPhone'), iosSteps()]),
      h('div', null, [h('div', { class: 'dm-h' }, 'Your login link'), linkBox(), waSelf()]),
    ])]);
}

export async function renderMe(content, ctx, api) {
  const { h, mount, lbToast, cardHead } = UI();
  const perms = new Set(ctx.perms || []);
  const fd = ctx.fleet_driver || {};
  const phone = h('input', { class: 'cp-in', type: 'tel', value: fd.phone || '', placeholder: 'Phone' });
  const saveP = h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.currentTarget.disabled = true; try { await driverUpdateMyProfile({ phone: phone.value.trim() }); lbToast('Phone updated.', 'success'); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } ev.currentTarget.disabled = false; } }, 'Save phone');
  const docsHost = h('div', { class: 'cp-muted' }, 'Loading…');
  async function loadDocs() {
    let rows = []; try { rows = await driverMyDocs(); } catch (e) { docsHost.textContent = (e && e.message) || 'Could not load.'; return; }
    docsHost.innerHTML = '';
    if (!rows.length) docsHost.appendChild(h('div', { class: 'cp-row-s' }, 'Nothing uploaded yet.'));
    rows.forEach((r) => docsHost.appendChild(h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [
      h('div', null, [h('div', { class: 'cp-row-t' }, [(r.kind === 'cdl' ? 'CDL' : r.kind === 'medical' ? 'Medical card' : 'Document') + ' ', h('span', { class: 'da-pill ' + (r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn') }, [h('i'), r.status])]),
        h('div', { class: 'cp-row-s' }, [r.expires_on ? 'expires ' + r.expires_on : null, r.note ? '“' + r.note + '”' : null].filter(Boolean).join(' · '))]),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { window.open(await signedDocumentUrl(r.path, 300), '_blank', 'noopener'); } catch (_) {} } }, 'Open')])])));
  }
  const uploadRow = (kind, label) => {
    const inp = h('input', { type: 'file', accept: 'image/*,application/pdf', style: 'display:none' });
    const exp = h('input', { class: 'cp-in', type: 'date', style: 'max-width:170px' });
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      try { const m = await uploadDriverOwnDoc(f, kind); await driverDocUpload({ kind, path: m.path, fileName: m.fileName, contentType: m.contentType, size: m.size, expiresOn: exp.value || null }); lbToast(label + ' sent to your carrier for approval.', 'success', 'Uploaded'); loadDocs(); }
      catch (e) { lbToast((e && e.message) || 'Upload failed.', 'urgent'); }
      inp.value = '';
    };
    return h('div', { class: 'cp-formrow2', style: 'align-items:center;gap:8px;margin-top:8px' }, [h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => inp.click() }, '📷 Upload ' + label), h('label', { class: 'cp-row-s' }, ['Expiry ', exp]), inp]);
  };
  mount(content, h('div', null, [
    h('div', { class: 'cp-card' }, [cardHead(fd.name || 'Driver', 'Driver at ' + (ctx.carrier || '')),
      h('div', { class: 'cp-row-s' }, [fd.license_no ? 'License ' + fd.license_no + (fd.license_state ? ' (' + fd.license_state + ')' : '') : 'License: not on file', fd.license_exp ? ' · expires ' + fd.license_exp : '', fd.medical_exp ? ' · medical ' + fd.medical_exp : ''].join('')),
      h('div', { class: 'cp-row-s', style: 'margin-top:4px;color:#94a3b8' }, 'Name and license are managed by your carrier. You can update your phone and emergency contacts (Safety).'),
      h('div', { class: 'cp-formrow2', style: 'margin-top:10px' }, [phone, saveP]),
    ]),
    perms.has('docs.upload_own') ? h('div', { class: 'cp-card' }, [cardHead('My documents', 'CDL and medical card — your carrier approves'), docsHost, uploadRow('cdl', 'CDL'), uploadRow('medical', 'medical card')]) : null,
    installCard(h, cardHead),
    h('div', { class: 'cp-card' }, [cardHead('Account', 'Your driver login'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:4px', onClick: async () => { await signOut(); location.href = location.pathname + '?role=driver'; } }, 'Sign out'),
    ]),
  ].filter(Boolean)));
  if (perms.has('docs.upload_own')) loadDocs();
}

// ---- Earnings (own trips only; rate visibility follows loads.see_rates) ------------------------
export async function renderEarnings(content, ctx) {
  const { h, mount, cardHead } = UI();
  const perms = new Set(ctx.perms || []);
  let e = null, s = null;
  if (perms.has('finance.view_earnings')) { try { e = await driverMyEarnings(30); } catch (_) {} }
  if (perms.has('finance.view_settlements')) { try { s = await driverMySettlements(); } catch (_) {} }
  const money = (v) => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  mount(content, h('div', null, [
    e ? h('div', { class: 'cp-card' }, [cardHead('Last 30 days', e.rates_visible ? 'gross load rates — your pay follows your agreement with the carrier' : 'rates hidden by your carrier'),
      h('div', { class: 'da-kpis' }, [h('div', null, [h('b', null, String(e.trips || 0)), h('span', null, 'Loads')]), h('div', null, [h('b', null, String(e.delivered || 0)), h('span', null, 'Delivered')]), h('div', null, [h('b', null, Number(e.miles || 0).toLocaleString()), h('span', null, 'Miles')]), h('div', null, [h('b', null, e.rates_visible ? money(e.gross) : '—'), h('span', null, 'Gross')])]),
      ...((e.rows || []).slice(0, 20).map((r) => h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, (r.origin || '—') + ' → ' + (r.destination || '—')), h('div', { class: 'cp-row-s' }, [r.status, r.miles ? r.miles + ' mi' : null, r.delivered_at ? fmtWhen(r.delivered_at) : null].filter(Boolean).join(' · '))]), h('b', null, r.rate != null ? money(r.rate) : '')])]))),
    ]) : null,
    perms.has('finance.add_expenses') ? h('div', { class: 'cp-card' }, [cardHead('Fuel & road expenses', 'receipts land in the carrier’s P&L and IFTA'), h('div', { class: 'cp-row-s' }, 'Add expenses from the load screen (My loads → open the load → Expenses).')]) : null,
    s ? h('div', { class: 'cp-card' }, [cardHead('Settlements', 'paid payroll rows matched to your name'), (s.rows || []).length ? h('div', null, s.rows.map((r) => h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, (r.period_start || '') + ' – ' + (r.period_end || '')), h('div', { class: 'cp-row-s' }, (r.pay_type || '') + (r.paid_at ? ' · paid ' + fmtWhen(r.paid_at) : ''))]), h('b', null, money(r.amount))])]))) : h('div', { class: 'cp-row-s' }, 'No paid settlements yet.')]) : null,
    (!e && !s && !perms.has('finance.add_expenses')) ? h('div', { class: 'cp-muted' }, 'Your carrier has not turned on earnings for you.') : null,
  ].filter(Boolean)));
}

// ---- Documents: read-only carrier status -------------------------------------------------------
export async function renderDocsStatus(content, ctx) {
  const { h, mount, cardHead } = UI();
  let c = null; try { c = await pocketCompliance(); } catch (e) { mount(content, h('div', { class: 'cp-muted' }, (e && e.message) || 'Not available.')); return; }
  const rs = (c && c.requirements) || [];
  mount(content, h('div', { class: 'cp-card' }, [cardHead((ctx.carrier || 'Carrier') + ' — documents', c && c.mandatory_ok ? 'all required documents valid' : 'the owner is completing these'),
    h('div', { class: 'cp-row-s', style: 'margin-bottom:8px' }, 'Read-only. Your carrier uploads and LoadBoot verifies; when something changes you see it here live.'),
    ...rs.map((r) => { const st = String(r.status || 'missing').toLowerCase(); return h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-trip-head' }, [h('div', { class: 'cp-row-t' }, r.name || r.doc_type || 'Document'), h('span', { class: 'da-pill ' + (st === 'valid' ? 'ok' : st === 'pending' || st === 'review' ? 'warn' : 'bad') }, [h('i'), st])])]); }),
  ]));
}

// ---- Fleet: read-only list (fleet.view) -------------------------------------------------------
export async function renderFleetReadOnly(content, ctx) {
  const { h, mount, cardHead } = UI();
  let trucks = [], drivers = [];
  try { [trucks, drivers] = await Promise.all([pocketTrucks(), new Set(ctx.perms || []).has('team.view_drivers') ? pocketDrivers() : Promise.resolve([])]); } catch (e) { mount(content, h('div', { class: 'cp-muted' }, (e && e.message) || 'Not available.')); return; }
  mount(content, h('div', null, [
    h('div', { class: 'cp-card' }, [cardHead('Trucks', (trucks || []).length + ' total'), ...(trucks || []).map((t) => h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-row-t' }, 'Unit ' + t.unit_no), h('div', { class: 'cp-row-s' }, [t.equipment, t.plate ? 'Plate ' + t.plate : null, t.next_service_date ? 'Service ' + t.next_service_date : null].filter(Boolean).join(' · '))]))]),
    (drivers || []).length ? h('div', { class: 'cp-card' }, [cardHead('Drivers', drivers.length + ' total'), ...drivers.map((d) => h('div', { class: 'cp-trip' }, [h('div', { class: 'cp-row-t' }, d.name), h('div', { class: 'cp-row-s' }, d.phone || '')]))]) : null,
  ].filter(Boolean)));
}

export default { platformInfo, driverNav, DRIVER_TABBAR, installGate, renderBlocked, startHeartbeat, subscribe, renderToday, renderMe, renderEarnings, renderDocsStatus, renderFleetReadOnly };
