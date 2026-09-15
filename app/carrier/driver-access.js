// driver-access.js — owner side of Driver Access (bl_drv_0344, 14 Sep 2026).
// Invite a fleet driver to the app, choose what they may do in plain words (presets + 30-key catalog,
// core keys always on, money/legal/team never), see live status (invited · joined · online · location),
// review the driver's own CDL/medical uploads, pause/resume/remove. Everything is enforced server-side
// (driver_gate); this file only shapes the choices and shows the truth the server returns.
// UI primitives (h, mount, openModal, lbToast, icon, cardHead) come from app.js via window.__lbUI.
import { myCarrierOrg, driverAccessList, driverPermissionCatalog, carrierInviteDriver, driverInviteResend, driverInviteRevoke,
  driverGrantsSet, driverSetStatus, driverOrgSettings, driverDocsForOwner, driverDocReview } from '../shared/api.js';
import { signedDocumentUrl } from '../shared/storage.js';
import { getClient } from '../shared/supabaseClient.js';
import { getUser } from '../shared/session.js';

const UI = () => window.__lbUI;
let _cat = null;                       // { catalog:[], presets:[] } — static, cached per page load
async function catalog() { if (!_cat) _cat = await driverPermissionCatalog(); return _cat; }

const STATUS = {
  not_invited: { label: 'Not invited', cls: 'bad' },
  invited:     { label: 'Invited · pending', cls: 'warn' },
  expired:     { label: 'Invite expired', cls: 'dim' },
  revoked:     { label: 'Invite revoked', cls: 'dim' },
  joined:      { label: 'Joined', cls: 'ok' },
  suspended:   { label: 'Paused', cls: 'bad' },
};
const pill = (h, st, online) => {
  const s = STATUS[st] || STATUS.not_invited;
  return h('span', { class: 'da-pill ' + s.cls }, [h('i'), (st === 'joined' && online) ? 'Joined · online' : s.label]);
};
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const hr = Math.round(m / 60); if (hr < 24) return hr + ' h ago';
  return Math.round(hr / 24) + ' d ago';
};
const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));
const initials = (n) => String(n || '?').trim().split(/\s+/).map((x) => x.charAt(0)).join('').slice(0, 2).toUpperCase();
const waLink = (phone, text) => 'https://wa.me/' + String(phone || '').replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(text);
const inviteText = (carrier, link) => 'Hi — ' + carrier + ' added you as a driver on LoadBoot. Open this on your phone to set your password and join: ' + link + ' (you only see your own loads; link valid 14 days)';

// What the driver will actually see for a given permission set — mirrors driverNav() in driver-mode.js.
function whatTheySee(perms) {
  const has = (k) => perms.has(k);
  return [
    ['My loads · GPS check-in · POD · issues · SOS', true],
    ['Load board', has('loads.view_board')],
    ['Load rates & pay', has('loads.see_rates')],
    ['Book / request loads', has('loads.request_book')],
    ['Post truck available · go online', has('avail.post_truck') || has('avail.toggle_online')],
    ['Fleet & maintenance', has('fleet.view') || has('fleet.maintenance')],
    ['Carrier document status', has('docs.view_status')],
    ['Upload own CDL / medical', has('docs.upload_own')],
    ['Earnings · expenses · settlements', has('finance.view_earnings') || has('finance.add_expenses') || has('finance.view_settlements')],
    ['Other drivers', has('team.view_drivers')],
    ['Payments, agreements, team settings — never', false],
  ];
}

// ---- permission editor (shared by invite + manage) -------------------------------------------
function permEditor(cat, initialPerms, initialPreset) {
  const { h } = UI();
  const state = new Set(initialPerms || []);
  let preset = initialPreset || null;
  const groups = [];
  cat.catalog.forEach((c) => { let g = groups.find((x) => x.grp === c.grp); if (!g) { g = { grp: c.grp, label: c.grp_label, why: c.grp_why, items: [] }; groups.push(g); } g.items.push(c); if (c.grp_why && !g.why) g.why = c.grp_why; });
  const presetHost = h('div', { class: 'da-presets' });
  const listHost = h('div');
  const seesHost = h('ul', { class: 'da-sees' });
  const countEl = h('span', { class: 'da-pill blue' }, '');
  const optional = cat.catalog.filter((c) => c.kind === 'optional' && c.available);
  const core = cat.catalog.filter((c) => c.kind === 'core');
  function paint() {
    presetHost.innerHTML = '';
    cat.presets.forEach((p) => presetHost.appendChild(h('button', { class: 'da-preset' + (preset === p.key ? ' on' : ''), type: 'button', onClick: () => { preset = p.key; state.clear(); (p.perms || []).forEach((k) => state.add(k)); paint(); } },
      [h('b', null, p.label), h('span', null, p.description || '')])));
    listHost.innerHTML = '';
    groups.forEach((g) => {
      const on = g.items.filter((i) => i.kind === 'core' || state.has(i.key)).length;
      const box = h('div', { class: 'da-grp' }, [
        h('h4', null, [g.label, h('small', null, on + ' / ' + g.items.length + ' on')]),
        g.why ? h('p', { class: 'da-why' }, g.why) : null,
      ].filter(Boolean));
      g.items.forEach((i) => {
        const lock = i.kind === 'core'; const isOn = lock || state.has(i.key);
        const sw = h('button', { type: 'button', class: 'da-sw' + (lock ? ' lock' : isOn ? ' on' : '') + (!i.available ? ' off' : ''), 'aria-label': i.label, 'aria-pressed': isOn ? 'true' : 'false', disabled: (lock || !i.available) ? 'disabled' : null,
          onClick: () => { if (state.has(i.key)) state.delete(i.key); else state.add(i.key); preset = null; paint(); } });
        box.appendChild(h('div', { class: 'da-perm' }, [
          h('div', null, [h('div', { class: 'da-l' }, [i.label, lock ? h('span', { class: 'da-tag lock' }, 'always on') : !i.available ? h('span', { class: 'da-tag dim' }, 'coming soon') : null]), i.description ? h('div', { class: 'da-d' }, i.description) : null]),
          sw]));
      });
      listHost.appendChild(box);
    });
    listHost.appendChild(h('div', { class: 'da-grp' }, [
      h('h4', null, ['Owner only', h('small', null, 'locked')]),
      h('p', { class: 'da-why' }, 'Never available to a driver — payment profile, factoring, bank details, invoices, agreements, W-9, compliance uploads, inviting drivers, permissions, ELD, cost model, closing the account.'),
    ]));
    seesHost.innerHTML = '';
    whatTheySee(state).forEach((s) => seesHost.appendChild(h('li', { class: s[1] ? '' : 'no' }, s[0])));
    countEl.textContent = (core.length + state.size) + ' of ' + (core.length + optional.length) + ' permissions on';
  }
  paint();
  const el = h('div', { class: 'da-editor' }, [
    h('div', { class: 'da-ed-left' }, [h('div', { class: 'da-eyebrow' }, 'Start from a preset'), presetHost, listHost]),
    h('div', { class: 'da-ed-right' }, [h('div', { class: 'da-eyebrow' }, 'What they will see'), countEl, seesHost]),
  ]);
  return { el, perms: () => Array.from(state), preset: () => preset };
}

// ---- invite flow ------------------------------------------------------------------------------
async function inviteModal(d, ctx) {
  const { h, openModal, lbToast } = UI();
  const cat = await catalog();
  const ed = permEditor(cat, (cat.presets.find((p) => p.key === 'driver') || {}).perms || [], 'driver');
  const email = h('input', { class: 'cp-in', type: 'email', placeholder: 'Driver email (the invite is emailed here)', value: d.email || '', autocomplete: 'off' });
  const phone = h('input', { class: 'cp-in', type: 'tel', placeholder: 'Phone (for WhatsApp / link sharing)', value: d.phone || '' });
  const err = h('div', { class: 'cp-row-s', style: 'color:#f87171;min-height:1.2em' });
  const send = h('button', { class: 'cp-btn', style: 'background:#FC5305' }, 'Send invite');
  send.onclick = async () => {
    err.textContent = '';
    const em = email.value.trim();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { err.textContent = 'That email does not look right.'; return; }
    if (em && ctx.meEmail && em.toLowerCase() === ctx.meEmail) { err.textContent = 'That is your own login email. An owner login can’t also be a driver login — if you drive yourself, your owner account already has the driver tools. Use the driver’s own email.'; return; }
    send.disabled = true; send.textContent = 'Sending…';
    try {
      const r = await carrierInviteDriver(d.id, em || null, phone.value.trim() || null, ed.perms(), ed.preset() || 'custom', em ? ['email'] : ['link']);
      close(); resultModal(d, r, ctx, phone.value.trim());
      lbToast(r.emailed ? 'Invite emailed to ' + r.email : 'Invite link ready — share it with ' + (d.name || 'the driver'), 'success', 'Invite sent');
      ctx.refresh();
    } catch (e) { send.disabled = false; send.textContent = 'Send invite'; err.textContent = (e && e.message) || 'Could not create the invite.'; }
  };
  const close = openModal('Invite ' + (d.name || 'driver') + ' to the LoadBoot app', [
    h('p', { class: 'cp-row-s', style: 'margin:0 0 10px' }, 'Choose what ' + (d.name || 'they') + ' can do. You can change this any time from Manage access — changes reach their phone in seconds.'),
    ed.el,
    h('div', { class: 'da-send' }, [email, phone]),
    h('div', { class: 'cp-row-s', style: 'margin-top:6px' }, 'They get a link → pick a password → land in the app already joined to your account. No paperwork. Android drivers install the Play Store app; iPhone drivers add LoadBoot to their Home Screen.'),
    err,
    h('div', { class: 'cp-trip-actions', style: 'margin-top:10px' }, [send]),
  ]);
  { const card = ed.el.closest('.cp-modal-card'); if (card) card.scrollTop = 0; const fp = ed.el.querySelector('.da-preset'); if (fp) fp.focus({ preventScroll: true }); }
}

function resultModal(d, r, ctx, phone) {
  const { h, openModal, lbToast } = UI();
  const link = r.link || '';
  const inp = h('input', { class: 'cp-in', value: link, readonly: 'readonly', onClick: (e) => e.currentTarget.select() });
  const copy = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { await navigator.clipboard.writeText(link); lbToast('Invite link copied.', 'success', 'Copied'); } catch (_) { inp.select(); } } }, 'Copy link');
  const wa = phone ? h('a', { class: 'cp-btn cp-btn-sm ghost', href: waLink(phone, inviteText(ctx.carrier, link)), target: '_blank', rel: 'noopener' }, 'Send on WhatsApp') : null;
  const share = (navigator.share) ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { try { navigator.share({ title: 'Join ' + ctx.carrier + ' on LoadBoot', text: inviteText(ctx.carrier, link), url: link }); } catch (_) {} } }, 'Share…') : null;
  openModal('Invite ready for ' + (d.name || 'driver'), [
    r.emailed ? h('div', { class: 'cp-row-s', style: 'color:#4ade80;font-weight:700' }, '✓ Emailed to ' + r.email) : h('div', { class: 'cp-row-s', style: 'color:#fbbf24' }, 'No email on file — share the link below yourself.'),
    h('p', { class: 'cp-row-s' }, 'Preset: ' + (r.preset || 'custom') + ' · ' + ((r.perms || []).length) + ' optional permission' + ((r.perms || []).length === 1 ? '' : 's') + ' on top of the always-on trip tools. Expires in 14 days.'),
    inp,
    h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, [copy, wa, share].filter(Boolean)),
    h('div', { class: 'da-steps' }, [
      h('b', null, 'What ' + (d.name || 'the driver') + ' does next (about a minute)'),
      h('span', null, '1 · Opens the link on their phone and sets a password'),
      h('span', null, '2 · Android: installs the LoadBoot app from Google Play (required) · iPhone: adds LoadBoot to the Home Screen'),
      h('span', null, '3 · Allows Location + Notifications — you get a “joined” alert and the card here turns green'),
    ]),
  ]);
}

// ---- manage access (joined / paused) ----------------------------------------------------------
async function manageModal(d, ctx) {
  const { h, openModal, lbToast } = UI();
  const cat = await catalog();
  const ed = permEditor(cat, d.perms || [], d.preset || null);
  const err = h('div', { class: 'cp-row-s', style: 'color:#f87171;min-height:1.2em' });
  const save = h('button', { class: 'cp-btn' }, 'Save access');
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Saving…'; err.textContent = '';
    try {
      const r = await driverGrantsSet(d.user_id, ed.perms(), ed.preset() || 'custom');
      const n = ((r.added || []).length + (r.removed || []).length);
      lbToast(n ? (r.added || []).length + ' turned on · ' + (r.removed || []).length + ' turned off — live on ' + (d.name || 'the driver') + '’s phone.' : 'No changes.', 'success', 'Access updated');
      close(); ctx.refresh();
    } catch (e) { save.disabled = false; save.textContent = 'Save access'; err.textContent = (e && e.message) || 'Could not save.'; }
  };
  const status = async (st, label) => {
    if (!confirm(label + ' ' + (d.name || 'this driver') + '?' + (st === 'removed' ? ' Their app access ends now; the driver record stays for history.' : ''))) return;
    try { await driverSetStatus(d.user_id, st); lbToast((d.name || 'Driver') + ' ' + (st === 'active' ? 'resumed' : st === 'suspended' ? 'paused — their app now shows “Access paused”' : 'removed from the app'), st === 'active' ? 'success' : 'warning', 'Driver access'); close(); ctx.refresh(); }
    catch (e) { err.textContent = (e && e.message) || 'Could not update.'; }
  };
  const close = openModal('Manage access — ' + (d.name || 'driver'), [
    h('div', { class: 'cp-row-s', style: 'margin:0 0 10px' }, [pill(h, d.app_status, d.online), ' · last seen ' + ago(d.last_seen_at) + (d.app_platform ? ' · ' + d.app_platform : '') + (d.location_on ? ' · location sharing on' : ' · location off')]),
    ed.el, err,
    h('div', { class: 'cp-trip-actions', style: 'margin-top:10px;flex-wrap:wrap;gap:6px' }, [
      save,
      d.app_status === 'suspended' ? h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => status('active', 'Resume') }, 'Resume') : h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => status('suspended', 'Pause') }, 'Pause access'),
      h('button', { class: 'cp-btn cp-btn-sm da-danger', onClick: () => status('removed', 'Remove') }, 'Remove from app'),
    ]),
  ]);
}

// ---- driver's own documents (CDL / medical) ---------------------------------------------------
async function docsModal(d, ctx) {
  const { h, openModal, lbToast } = UI();
  const host = h('div', { class: 'cp-muted' }, 'Loading…');
  const close = openModal((d.name || 'Driver') + ' — documents', [
    h('p', { class: 'cp-row-s', style: 'margin:0 0 8px' }, 'Uploaded by the driver from their phone. Approving a CDL or medical card with an expiry date updates the expiry reminders automatically.'), host]);
  async function load() {
    let rows = []; try { rows = await driverDocsForOwner(d.id); } catch (e) { host.textContent = (e && e.message) || 'Could not load.'; return; }
    host.innerHTML = '';
    if (!rows.length) { host.appendChild(h('div', { class: 'cp-muted' }, 'Nothing uploaded yet.')); return; }
    rows.forEach((r) => {
      const st = h('span', { class: 'da-pill ' + (r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn') }, [h('i'), r.status]);
      const open = h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: async () => { try { const u = await signedDocumentUrl(r.path, 300); window.open(u, '_blank', 'noopener'); } catch (e) { lbToast((e && e.message) || 'Could not open.', 'urgent'); } } }, 'Open');
      const act = r.status === 'pending' ? [
        h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { await driverDocReview(r.id, 'approved', null); lbToast('Approved.', 'success'); load(); ctx.refresh(); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } } }, 'Approve'),
        h('button', { class: 'cp-btn cp-btn-sm da-danger', onClick: async () => { const note = prompt('Why is it rejected? (the driver sees this)'); if (note === null) return; try { await driverDocReview(r.id, 'rejected', note || null); lbToast('Rejected — driver notified.', 'warning'); load(); ctx.refresh(); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } } }, 'Reject'),
      ] : [];
      host.appendChild(h('div', { class: 'cp-trip' }, [
        h('div', { class: 'cp-trip-head' }, [
          h('div', null, [h('div', { class: 'cp-row-t' }, [(r.kind === 'cdl' ? 'CDL' : r.kind === 'medical' ? 'Medical card' : 'Document') + ' ', st]),
            h('div', { class: 'cp-row-s' }, [r.file_name || r.path.split('/').pop(), r.expires_on ? ' · expires ' + r.expires_on : '', ' · ' + ago(r.created_at), r.note ? ' · “' + r.note + '”' : ''].join(''))]),
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [open, ...act]),
        ]),
      ]));
    });
  }
  load();
  return close;
}

// ---- main mount -------------------------------------------------------------------------------
export async function mountDriverAccess(host, opts) {
  const { h, mount, lbToast } = UI();
  const ctx = { carrier: (opts && opts.carrier) || 'Your carrier', refresh: null };
  let rows = [], settings = { require_android_app: true };
  let channel = null; let refreshTimer = null;
  // Owner-operator detection: a fleet driver whose email or phone matches the OWNER's login is the owner themself.
  // They do not need a driver login (the owner account already has the driver tools), and the accept RPC would
  // refuse it anyway — so say it up front, with a one-tap override for a genuinely different person who shares a phone.
  const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
  let me = null; try { me = await getUser(); } catch (_) {}
  const meEmail = String((me && me.email) || '').toLowerCase(), mePhone = digits(me && me.user_metadata && me.user_metadata.phone);
  const selfOverride = new Set();
  ctx.meEmail = meEmail;
  const isSelf = (x) => !selfOverride.has(x.id) && ((x.email && meEmail && x.email.toLowerCase() === meEmail) || (mePhone && mePhone.length === 10 && digits(x.phone) === mePhone));

  async function load() {
    try { [rows, settings] = await Promise.all([driverAccessList(), driverOrgSettings(null)]); }
    catch (e) { mount(host, h('div', { class: 'cp-muted' }, (e && e.message) || 'Could not load driver access.')); return; }
    paint();
    runDeepLink();
  }
  ctx.refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(load, 250); };

  function actions(d) {
    const b = (label, cls, fn, attrs) => h('button', Object.assign({ class: 'cp-btn cp-btn-sm ' + (cls || 'ghost'), onClick: fn }, attrs || {}), label);
    const edit = b('Edit', 'ghost', () => opts.onEdit && opts.onEdit(opts.drivers.find((x) => x.id === d.id) || d));
    const st = d.app_status;
    if (st === 'joined') return [b('Manage access', 'ghost', () => manageModal(d, ctx), { 'data-da': 'access' }), b('Documents' + (d.docs_pending ? ' · ' + d.docs_pending + ' to review' : ''), d.docs_pending ? '' : 'ghost', () => docsModal(d, ctx), { 'data-da': 'docs' }), edit];
    if (st === 'suspended') return [b('Manage access', 'ghost', () => manageModal(d, ctx), { 'data-da': 'access' }), b('Resume', '', async () => { try { await driverSetStatus(d.user_id, 'active'); lbToast((d.name || 'Driver') + ' resumed.', 'success'); load(); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } }), edit];
    if (st === 'invited') {
      const inv = d.invite || {}; const link = inv.token ? 'https://loadboot.com/app/carrier/driver-invite.html?t=' + inv.token : '';
      return [
        b('Resend', 'ghost', async () => { try { const r = await driverInviteResend(inv.id); lbToast(r.emailed ? 'Invite re-sent to ' + (inv.email || 'the driver') : 'Invite renewed — share the link.', 'success', 'Resent'); load(); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } }),
        link ? b('Copy link', 'ghost', async () => { try { await navigator.clipboard.writeText(link); lbToast('Invite link copied.', 'success', 'Copied'); } catch (_) { prompt('Copy this link', link); } }) : null,
        (link && (inv.phone || d.phone)) ? h('a', { class: 'cp-btn cp-btn-sm ghost', href: waLink(inv.phone || d.phone, inviteText(ctx.carrier, link)), target: '_blank', rel: 'noopener' }, 'WhatsApp') : null,
        b('Revoke', 'da-danger', async () => { if (!confirm('Revoke this invite? The link stops working immediately.')) return; try { await driverInviteRevoke(inv.id); lbToast('Invite revoked.', 'warning'); load(); } catch (e) { lbToast((e && e.message) || 'Failed', 'urgent'); } }),
        edit,
      ].filter(Boolean);
    }
    return [b('Invite & set permissions', '', () => inviteModal(d, ctx), { style: 'background:#FC5305', 'data-da': 'invite' }), edit,
      h('div', { class: 'da-hint' }, 'Custom access \u2014 you choose exactly what this driver can see and do.')];
  }

  function card(d) {
    const st = d.app_status; const joined = st === 'joined';
    const meta = [d.phone, d.license_no ? 'Lic ' + d.license_no + (d.license_state ? ' (' + d.license_state + ')' : '') : null, d.last_unit ? 'Unit ' + d.last_unit : null].filter(Boolean).join(' · ') || '—';
    let live = joined ? [
      'Last seen ' + ago(d.last_seen_at),
      d.location_on ? 'Location sharing on' : 'Location off',
      d.app_platform ? (d.app_platform === 'android' ? 'Android' + (d.installed_app ? ' · app installed' : ' · browser only') : d.app_platform === 'ios' ? 'iPhone' + (d.installed_app ? ' · on Home Screen' : ' · Safari') : d.app_platform) : null,
      d.current_trip ? 'On ' + (d.current_trip.origin || '?') + ' → ' + (d.current_trip.destination || '?') : null,
    ].filter(Boolean).join(' · ')
      : st === 'invited' ? 'Sent ' + ago(d.invite && d.invite.last_sent_at) + (d.invite && d.invite.email ? ' by email' : ' as a link') + ' · expires in ' + daysLeft(d.invite && d.invite.expires_at) + ' days' + (d.invite && d.invite.resend_count ? ' · resent ' + d.invite.resend_count + '×' : '')
      : st === 'expired' ? 'The invite link expired — resend a fresh one.'
      : st === 'suspended' ? 'Access paused by you · their app shows “Access paused”'
      : 'Not on the app: no GPS check-in, no live tracking, POD and detention proof stay manual.';
    const self = isSelf(d) && ['not_invited', 'expired', 'revoked'].includes(st);
    if (self) live = 'You drive this unit yourself — sign in on your phone with your owner login for GPS check-in and POD.';
    const chips = [];
    if (joined || st === 'suspended') { const p = (d.perms || []).length; chips.push(h('span', { class: 'da-pill blue' }, d.preset ? ({ driver: 'Driver only', book: 'Driver + book loads', lead: 'Lead driver', full: 'Full trust' }[d.preset] || 'Custom') : 'Custom')); chips.push(h('span', { class: 'da-pill dim' }, (11 + p) + ' permissions')); if (d.docs_pending) chips.push(h('span', { class: 'da-pill warn' }, [h('i'), d.docs_pending + ' doc' + (d.docs_pending > 1 ? 's' : '') + ' to review'])); }
    else if (st === 'invited' && d.invite && d.invite.preset) chips.push(h('span', { class: 'da-pill blue' }, ({ driver: 'Driver only', book: 'Driver + book loads', lead: 'Lead driver', full: 'Full trust' }[d.invite.preset] || 'Custom') + ' on join'));
    if (d.license_exp && new Date(d.license_exp) < new Date()) chips.push(h('span', { class: 'da-pill bad' }, [h('i'), 'License expired']));
    return h('div', { class: 'da-card' + (st === 'not_invited' && !self ? ' need' : ''), 'data-driver': d.id }, [
      h('div', { class: 'da-av' + (joined && d.online ? ' on' : '') }, initials(d.name)),
      h('div', { class: 'da-body' }, [
        h('div', { class: 'da-name' }, [d.name || 'Driver', ' ', pill(h, st, d.online)]),
        h('div', { class: 'da-meta' }, meta),
        h('div', { class: 'da-meta ' + (st === 'not_invited' && !self ? 'need' : '') }, live),
        chips.length ? h('div', { class: 'da-chips' }, chips) : null,
      ].filter(Boolean)),
      h('div', { class: 'da-acts' }, self ? [edit0(d)] : actions(d)),
      self ? h('div', { class: 'da-self' }, [h('span', { style: 'font-size:18px;line-height:1' }, '🪪'), h('div', null, [
        h('div', null, [h('b', null, 'Looks like this is you'), ' — same ' + ((d.email && meEmail && d.email.toLowerCase() === meEmail) ? 'email' : 'phone') + ' as your owner login. You don’t need a separate driver account: your owner login already has the driver tools (GPS check-in, POD, trips).']),
        h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => { selfOverride.add(d.id); paint(); inviteModal(d, ctx); } }, 'Driver is a different person →'),
      ])]) : null,
    ].filter(Boolean));
  }
  function edit0(d) { return h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onEdit && opts.onEdit(opts.drivers.find((x) => x.id === d.id) || d) }, 'Edit'); }

  function paint() {
    const n = (s) => rows.filter((d) => d.app_status === s).length;
    const joined = n('joined'), pending = n('invited'), none = rows.length - joined - pending - n('suspended');
    const uninvited = rows.filter((d) => ['not_invited', 'expired', 'revoked'].includes(d.app_status) && d.email);
    const bulk = uninvited.length > 1 ? h('button', { class: 'cp-btn cp-btn-sm', style: 'background:#FC5305', onClick: async () => {
      if (!confirm('Send the default “Driver only” invite to ' + uninvited.length + ' drivers by email?')) return;
      let ok = 0; for (const d of uninvited) { try { await carrierInviteDriver(d.id, d.email, d.phone || null, null, 'driver', ['email']); ok++; } catch (_) {} }
      lbToast(ok + ' of ' + uninvited.length + ' invites sent.', ok ? 'success' : 'urgent', 'Bulk invite'); load();
    } }, 'Invite all ' + uninvited.length + ' by email') : null;
    const req = h('label', { class: 'da-setting' }, [
      h('input', { type: 'checkbox', checked: settings.require_android_app ? 'checked' : null, onChange: async (e) => { try { settings = await driverOrgSettings(e.currentTarget.checked); lbToast(settings.require_android_app ? 'Android drivers must use the Play Store app.' : 'Android drivers may use the browser.', 'success', 'Saved'); } catch (er) { lbToast((er && er.message) || 'Failed', 'urgent'); } } }),
      h('span', null, [h('b', null, 'Require the app on Android'), h('small', null, 'GPS check-in and background tracking only work in the installed app. iPhone drivers get a Home-Screen guide either way.')]),
    ]);
    mount(host, [
      h('div', { class: 'da-kpis' }, [
        h('div', null, [h('b', null, String(rows.length)), h('span', null, 'Drivers')]),
        h('div', null, [h('b', { style: 'color:#4ade80' }, String(joined)), h('span', null, 'On the app')]),
        h('div', null, [h('b', { style: 'color:#fbbf24' }, String(pending)), h('span', null, 'Invite pending')]),
        h('div', null, [h('b', { style: none ? 'color:#f87171' : '' }, String(none)), h('span', null, 'Not on the app')]),
      ]),
      bulk ? h('div', { style: 'margin:0 0 10px' }, bulk) : null,
      rows.length ? h('div', null, rows.map(card)) : h('div', { class: 'cp-muted' }, 'No drivers yet. Add your first driver — then invite them so their phone tracks the truck.'),
      req,
    ].filter(Boolean));
  }

  // #fleet/driver/<id>[/access|/docs] · #fleet/invite/<id> — from notifications and CC deep links
  function runDeepLink() {
    let de; try { de = window.__lbDeepEnt; } catch (_) { return; }
    if (!de || de.tab !== 'fleet' || !de.id) return;
    const parts = String(de.id).split('/');
    if (parts[0] !== 'driver' && parts[0] !== 'invite') return;
    window.__lbDeepEnt = null;
    const d = parts[0] === 'driver' ? rows.find((x) => x.id === parts[1]) : rows.find((x) => x.invite && x.invite.id === parts[1]);
    if (!d) return;
    const el = host.querySelector('[data-driver="' + d.id + '"]');
    if (el) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {} el.style.outline = '2px solid #0883F7'; el.style.outlineOffset = '3px'; setTimeout(() => { el.style.outline = ''; }, 3500); }
    const sub = parts[2];
    setTimeout(() => {
      if (sub === 'access' && d.user_id) manageModal(d, ctx);
      else if (sub === 'docs' && d.user_id) docsModal(d, ctx);
      else if (sub === 'invite' || (parts[0] === 'driver' && !d.user_id && d.app_status !== 'invited' && sub === 'invite')) inviteModal(d, ctx);
    }, 400);
  }

  // Realtime: the owner's card flips the moment a driver joins / comes online / shares location.
  async function subscribe() {
    try {
      const sb = await getClient();
      let orgId = opts && opts.orgId; if (!orgId) { try { orgId = await myCarrierOrg(); } catch (_) {} } if (!orgId) return;
      channel = sb.channel('drv-access-' + orgId)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'driver_access_events', filter: 'org_id=eq.' + orgId }, (payload) => {
          const ev = payload && payload.new; if (!ev) return;
          const p = ev.payload || {};
          if (ev.kind === 'driver.joined') lbToast((p.name || 'A driver') + ' joined the app' + (p.platform ? ' on ' + p.platform : '') + '. Assign a truck to start tracking.', 'success', 'Driver joined');
          else if (ev.kind === 'driver.online') lbToast((p.name || 'Driver') + ' is online.', 'action', 'Live');
          else if (ev.kind === 'doc.uploaded') lbToast((p.name || 'Driver') + ' uploaded a ' + (p.kind === 'cdl' ? 'CDL' : p.kind === 'medical' ? 'medical card' : 'document') + ' — review it.', 'action', 'Document');
          ctx.refresh();
        }).subscribe();
    } catch (_) {}
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ctx.refresh(); });
  }

  await load();
  subscribe();
  return { refresh: load, destroy: () => { try { channel && channel.unsubscribe(); } catch (_) {} } };
}

export default mountDriverAccess;
