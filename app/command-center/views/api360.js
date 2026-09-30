// api360.js — API 360: developer accounts, API keys and usage in one place (Command Center).
// List:   #/api360            → cc_api360_list   (KPIs, accounts, staff-issued / non-developer keys, settings)
// Detail: #/api360?id=<uuid>  → cc_api360_get    (account, requests, keys, usage, calls, errors, webhooks, audit)
// Reads need integrations.view; every write needs integrations.manage (the server enforces it, the UI only hides buttons).
// All text is inserted through el() as text nodes — nothing user-typed is ever injected as HTML.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import {
  sectionHead, statCard, barChart, toolbar, searchBox, segmented, openDrawer, askReason, askConfirm, card,
  fmtDate, fmtDateTime, stackTables,
} from '../../shared/ui/components.js';
import {
  api360List, api360Get, api360SetStatus, api360RevokeKey, api360IssueKey, api360SaveProfile, api360SettingsSave,
  api360Reclassify, retryWebhookDelivery,
} from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { injectStyles, kpiRow, sectionNav, section, head, facts, block, pill, dash, n0, when, agoOr } from './partner360-kit.js';

const STATUS_TONE = { approved: 'green', pending: 'amber', open: 'amber', denied: 'red', suspended: 'red' };
const SOURCE_LABEL = { signup: 'Sign-up', portal: 'Developer portal', reclassified: 'Moved from carrier', staff: 'Staff' };
const FILTERS = [
  { value: '', label: 'All' }, { value: 'requests', label: 'Requests' }, { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' }, { value: 'denied', label: 'Denied' }, { value: 'suspended', label: 'Suspended' },
];

const statusBadge = (s) => el('span', { class: 'cc-pill cc-pill-' + (STATUS_TONE[s] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), s || 'unknown']);
const sourceLabel = (s) => SOURCE_LABEL[s] || dash(s);
const httpTone = (c) => { const n = Number(c); if (n === 429 || n >= 500) return 'red'; if (n >= 400) return 'amber'; if (n >= 200 && n < 300) return 'green'; return 'gray'; };
const scopePills = (scopes) => el('span', { style: 'display:inline-flex;gap:4px;flex-wrap:wrap' }, (scopes || []).map((s) => pill(s === 'sandbox' ? 'violet' : s === 'write' ? 'amber' : 'blue', s)));
const code = (t) => el('code', { style: 'font-size:.82rem;word-break:break-all' }, t);
const btn = (label, cls, onClick) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), onClick }, label);
const goDetail = (uid) => { if (uid) location.hash = '#/api360?id=' + uid; };
// only http(s) links are ever rendered as <a>; anything else (javascript:, data:…) stays plain text
const safeUrl = (u) => { const s = String(u || '').trim(); if (/^https?:\/\//i.test(s)) return s; if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return null; return 'https://' + s; };
const linkOrText = (u, style) => { const h = safeUrl(u); return h ? el('a', { href: h, target: '_blank', rel: 'noopener', style: style || null }, String(u)) : dash(u); };

function tableOf(heads, rows) {
  return el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
    el('thead', null, el('tr', null, heads.map((h) => el('th', null, h)))),
    el('tbody', null, rows),
  ]));
}
const labelled = (text, input) => el('label', { style: 'display:flex;flex-direction:column;gap:4px' }, [el('span', { class: 'cc-sub', style: 'font-weight:700' }, text), input]);

export function renderApi360(host, id) {
  injectStyles();
  if (id) renderDetail(host, id); else renderList(host);
}

// ================================================================================================
// LIST
// ================================================================================================
function renderList(host) {
  const manage = can('integrations.manage');
  const state = { search: '', status: '' };
  let last = null;
  const kpiHost = el('div');
  const segHost = el('div', { style: 'max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch' });  // 6 filters: scroll on phones, never widen the page
  const listHost = el('div');
  const otherHost = el('div', { style: 'margin-top:16px' });

  function drawSeg() { mount(segHost, segmented(FILTERS, state.status, (v) => { state.status = v; load(); })); }

  function drawKpis() {
    const k = (last && last.kpis) || {};
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Developer accounts', value: String(n0(k.accounts)), sub: n0(k.pending) + ' pending · ' + n0(k.approved) + ' approved · ' + n0(k.suspended) + ' suspended', accent: 'blue' }),
      statCard({ icon: 'clipboard', label: 'Open requests', value: String(n0(k.open_requests)), sub: 'production access, waiting for review', accent: n0(k.open_requests) > 0 ? 'amber' : 'green', onClick: () => { state.status = 'requests'; drawSeg(); load(); } }),
      statCard({ icon: 'lock', label: 'Active keys', value: String(n0(k.active_keys)), sub: 'not revoked', accent: 'green' }),
      statCard({ icon: 'activity', label: 'Calls today', value: String(n0(k.calls_today)), sub: 'API requests', accent: 'blue' }),
      statCard({ icon: 'alert', label: 'Errors today', value: String(n0(k.errors_today)), sub: 'failed requests', accent: n0(k.errors_today) > 0 ? 'red' : 'green' }),
    ]));
  }

  function drawAccounts() {
    const rows = (last && last.accounts) || [];
    if (!rows.length) { showEmpty(listHost, 'No developer accounts match these filters.'); return; }
    mount(listHost, tableOf(
      ['Developer', 'Status', 'Source', 'Keys', 'Calls 7d', 'Errors 7d', 'Last call', 'Signed up'],
      rows.map((a) => el('tr', { class: 'cc-row cc-row-click', onClick: () => goDetail(a.user_id) }, [
        el('td', null, [el('b', null, a.company || a.name || a.email || '—'), el('div', { class: 'cc-sub' }, a.company || a.name ? (a.email || '') : '')]),
        el('td', null, el('span', { style: 'display:inline-flex;gap:6px;align-items:center;flex-wrap:wrap' }, [statusBadge(a.status), a.open_request ? pill('amber', 'Open request') : null])),
        el('td', null, sourceLabel(a.source)),
        el('td', null, String(n0(a.keys_active))),
        el('td', null, String(n0(a.calls_7d))),
        el('td', null, n0(a.errors_7d) > 0 ? pill('red', String(n0(a.errors_7d))) : '0'),
        el('td', null, agoOr(a.last_call, 'never')),
        el('td', null, fmtDate(a.created_at)),
      ])),
    ));
    stackTables(listHost);
  }

  function drawOther() {
    const rows = (last && last.other_keys) || [];
    mount(otherHost, card([
      el('h4', { class: 'cc-card-title', style: 'margin:0 0 10px' }, 'Other API keys (staff-issued / non-developer logins)'),
      rows.length ? tableOf(
        ['Owner', 'Key', 'Prefix', 'Scopes', 'Partner', 'Last used', 'Status'],
        rows.map((k) => el('tr', { class: 'cc-row cc-row-click', onClick: () => goDetail(k.owner) }, [
          el('td', null, [el('b', null, k.owner_email || '—'), el('div', { class: 'cc-sub' }, k.owner_company || '')]),
          el('td', null, k.name || '—'),
          el('td', null, code((k.prefix || '') + '…')),
          el('td', null, scopePills(k.scopes)),
          el('td', null, dash(k.partner_slug)),
          el('td', null, agoOr(k.last_used_at, 'never')),
          el('td', null, k.revoked_at ? pill('red', 'revoked') : pill('green', 'active')),
        ])),
      ) : el('div', { class: 'cc-sub' }, 'None.'),
    ]));
    stackTables(otherHost);
  }

  async function load() {
    showLoading(listHost, 'Loading developer accounts…');
    try { last = await api360List(state.status || null, state.search || null); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    drawKpis(); drawAccounts(); drawOther();
  }

  function openSettings() {
    const s = (last && last.settings) || {};
    const rate = el('input', { class: 'cc-input', type: 'number', min: '1', step: '1', value: String(s.rate_limit_per_min ?? 60) });
    const sandbox = el('input', { type: 'checkbox' }); sandbox.checked = !!s.sandbox_self_serve;
    const keep = el('input', { class: 'cc-input', type: 'number', min: '1', step: '1', value: String(s.log_retention_days ?? 90) });
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const r = parseInt(rate.value, 10), d = parseInt(keep.value, 10);
      if (!(r > 0) || !(d > 0)) { err.textContent = 'Rate limit and log retention must be whole numbers above zero.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…'; err.textContent = '';
      try { await api360SettingsSave({ rate_limit_per_min: r, sandbox_self_serve: sandbox.checked, log_retention_days: d }); toast('API settings saved', 'success'); dlg.close(); load(); }
      catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save settings'; }
    } }, 'Save settings');
    const dlg = openDrawer('API settings', el('div', { class: 'cc-form' }, [
      labelled('Default rate limit (requests per minute, per key)', rate),
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.9rem;cursor:pointer' }, [sandbox, 'Developers can create sandbox keys without review']),
      labelled('Keep API call logs for (days)', keep),
      s.updated_at ? el('div', { class: 'cc-sub' }, 'Last changed ' + fmtDateTime(s.updated_at) + (s.updated_by ? ' by ' + s.updated_by : '')) : null,
      err, save,
    ]), { subtitle: 'Applies to all developer keys', size: 'sm' });
  }

  function openReclassify() {
    const email = el('input', { class: 'cc-input', type: 'email', placeholder: 'login email, e.g. dev@example.com' });
    const note = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Why (recorded in the audit trail)' });
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const go = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const em = email.value.trim();
      if (!em) { err.textContent = 'Enter the email they signed up with.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Moving…'; err.textContent = '';
      try {
        const r = await api360Reclassify(em, note.value.trim() || null);
        toast('Moved to developer accounts', 'success'); dlg.close();
        if (r && r.user_id) goDetail(r.user_id); else load();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Move to developer accounts'; }
    } }, 'Move to developer accounts');
    const dlg = openDrawer('Move a carrier signup here', el('div', { class: 'cc-form' }, [
      el('div', { class: 'cc-sub' }, 'For someone who wrongly signed up as a carrier but is really a developer. Real carriers are refused by the server.'),
      labelled('Login email', email), labelled('Note', note), err, go,
    ]), { subtitle: 'Reclassify a login', size: 'sm' });
  }

  const actions = manage ? [
    el('button', { class: 'lb-btn', onClick: openReclassify }, 'Move a carrier signup here'),
    el('button', { class: 'lb-btn', onClick: openSettings }, 'Settings'),
  ] : null;

  drawSeg();
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('API 360', 'Developer accounts, API keys and usage in one place.', actions),
    kpiHost,
    toolbar([searchBox('Search company, name or email…', (v) => { state.search = v; load(); }), segHost]),
    listHost,
    otherHost,
  ]));
  load();
}

// ================================================================================================
// DETAIL
// ================================================================================================
function renderDetail(host, id) {
  const manage = can('integrations.manage');
  let d = null;
  const body = el('div');
  mount(host, el('div', { class: 'cc-view p360' }, [el('a', { class: 'cc-back', href: '#/api360' }, '← Back to API 360'), body]));

  async function load(silent) {
    if (!silent) showLoading(body, 'Loading API account…');
    try { d = await api360Get(id); }
    catch (e) { if (!silent) showError(body, humanizeError(e), () => load(false)); else toast(humanizeError(e), 'error'); return; }
    draw(silent);
  }

  // Run a mutation; the RPCs return the same payload as get, so re-render straight from it.
  async function act(fn, okMsg) {
    try {
      const r = await fn();
      if (r && r.user_id) { d = r; draw(true); } else await load(true);
      toast(okMsg, 'success');
      return true;
    } catch (e) { toast(humanizeError(e), 'error'); return false; }
  }

  // ---- status actions ----
  async function approve() {
    const ok = await askConfirm('Approve production access?', { body: 'The developer is emailed and their live keys start working.', confirmLabel: 'Approve production', subtitle: 'Emailed to the developer' });
    if (ok) act(() => api360SetStatus(d.user_id, 'approved', null), 'Production access approved');
  }
  async function deny() {
    const note = await askReason('Deny production access', { note: 'The developer sees this reason in the email and in their portal.', submitLabel: 'Deny', subtitle: 'Emailed to the developer' });
    if (note) act(() => api360SetStatus(d.user_id, 'denied', note), 'Request denied');
  }
  async function suspend() {
    const note = await askReason('Suspend this developer', { note: 'All of their keys stop working immediately. The developer sees this reason.', submitLabel: 'Suspend', subtitle: 'Emailed to the developer' });
    if (note) act(() => api360SetStatus(d.user_id, 'suspended', note), 'Developer suspended');
  }
  async function reopen(label) {
    const ok = await askConfirm(label + '?', { body: 'The account goes back to pending review. The developer is emailed.', confirmLabel: label, subtitle: 'Emailed to the developer' });
    if (ok) act(() => api360SetStatus(d.user_id, 'pending', null), label === 'Reinstate' ? 'Developer reinstated (pending)' : 'Reopened as pending');
  }
  async function revoke(k) {
    const reason = await askReason('Revoke key ' + (k.prefix || '') + '…', { note: 'The key stops working at once. Its owner is emailed with this reason.', submitLabel: 'Revoke key', subtitle: 'Emailed to the key owner' });
    if (reason) act(() => api360RevokeKey(k.id, reason), 'Key revoked');
  }
  async function retry(delivery) {
    try { await retryWebhookDelivery(delivery.id); toast('Delivery queued for retry', 'success'); await load(true); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  // ---- issue key ----
  function openIssueKey() {
    const a = d.account;
    let scope = a && a.status === 'approved' ? 'read' : 'sandbox';
    const name = el('input', { class: 'cc-input', placeholder: 'Key name, e.g. Production integration' });
    const slug = el('input', { class: 'cc-input', placeholder: 'optional, e.g. acme-tms' });
    slug.value = (a && a.partner_slug) || '';
    const rate = el('input', { class: 'cc-input', type: 'number', min: '1', step: '1', placeholder: 'blank = default' });
    const OPTS = [['sandbox', 'Sandbox only', 'test data, no live loads'], ['read', 'Read', 'live data, read only'], ['read+write', 'Read + write', 'live data, can create and change']];
    const radios = el('div', { style: 'display:flex;flex-direction:column;gap:6px' }, OPTS.map(([v, l, sub]) =>
      el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.9rem;cursor:pointer' }, [
        el('input', { type: 'radio', name: 'api360-scope', value: v, checked: v === scope, onChange: () => { scope = v; } }),
        el('span', null, [el('b', null, l), ' — ' + sub]),
      ])));
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const go = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const nm = name.value.trim();
      if (!nm) { err.textContent = 'Give the key a name.'; return; }
      const rl = rate.value.trim() ? parseInt(rate.value, 10) : null;
      if (rl !== null && !(rl > 0)) { err.textContent = 'Rate limit must be a whole number above zero, or blank.'; return; }
      const scopes = scope === 'read+write' ? ['read', 'write'] : [scope];
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Issuing…'; err.textContent = '';
      let res;
      try { res = await api360IssueKey(d.user_id, nm, scopes, slug.value.trim() || null, rl); }
      catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Issue key'; return; }
      showSecret(dlg, res);
      load(true);
    } }, 'Issue key');
    const dlg = openDrawer('Issue an API key', el('div', { class: 'cc-form' }, [
      labelled('Key name', name),
      el('div', null, [el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:4px' }, 'Access'), radios]),
      labelled('Partner slug (for link-back attribution)', slug),
      labelled('Per-key rate limit (requests per minute)', rate),
      err, go,
    ]), { subtitle: 'For ' + ((a && (a.company || a.name)) || (d.login && d.login.email) || 'this login'), size: 'sm' });
  }

  function showSecret(dlg, res) {
    const secret = (res && (res.key || res.api_key || res.secret)) || '';
    const box = el('textarea', { class: 'cc-input', readonly: true, rows: '3', style: 'font-family:ui-monospace,monospace;font-size:.82rem;word-break:break-all', onClick: (ev) => ev.currentTarget.select() });
    box.value = secret;
    const copy = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
      try { await navigator.clipboard.writeText(secret); toast('Key copied', 'success'); }
      catch (_) { try { box.focus(); box.select(); document.execCommand('copy'); toast('Key copied', 'success'); } catch (__) { toast('Could not copy - select the key and copy it by hand', 'error'); } }
    } }, 'Copy key');
    mount(dlg.body, el('div', { class: 'cc-form' }, [
      el('div', { class: 'p360-warn' }, [el('b', null, 'Copy it now - it will not be shown again. '), 'Only a hash is stored, so this key cannot be recovered. Send it to the developer over a private channel.']),
      secret ? box : el('div', { class: 'cc-sub' }, 'Key issued, but the server did not return the secret. Revoke it and issue a new one.'),
      el('div', { class: 'cc-sub' }, ['Prefix ', code((res && res.prefix) || ''), ' · scopes ', scopePills(res && res.scopes)]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [secret ? copy : null, el('button', { class: 'lb-btn', onClick: () => dlg.close() }, 'Done')]),
    ]));
  }

  // ---- edit profile ----
  function openEditProfile() {
    const a = d.account || {};
    const mk = (v, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '' }); i.value = v || ''; return i; };
    const mkTa = (v, ph) => { const t = el('textarea', { class: 'cc-input', rows: '3', placeholder: ph || '' }); t.value = v || ''; return t; };
    const f = {
      company: mk(a.company), website: mk(a.website, 'https://…'), partner_slug: mk(a.partner_slug, 'e.g. acme-tms'),
      verification_note: mkTa(a.verification_note, 'What we checked to verify this developer'), staff_notes: mkTa(a.staff_notes, 'Internal - the developer never sees this'),
    };
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      const p = {}; Object.keys(f).forEach((k) => { const v = f[k].value.trim(); if (v !== String(a[k] || '')) p[k] = v; });
      if (!Object.keys(p).length) { dlg.close(); return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…'; err.textContent = '';
      try {
        const r = await api360SaveProfile(d.user_id, p);
        if (r && r.user_id) { d = r; draw(true); } else await load(true);
        toast('Profile saved', 'success'); dlg.close();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save profile'; }
    } }, 'Save profile');
    const dlg = openDrawer('Edit developer profile', el('div', { class: 'cc-form' }, [
      labelled('Company', f.company), labelled('Website', f.website), labelled('Partner slug', f.partner_slug),
      labelled('Verification note', f.verification_note), labelled('Staff notes (internal)', f.staff_notes), err, save,
    ]), { subtitle: a.email || '', size: 'sm' });
  }

  // ---- render ----
  function draw(keepScroll) {
    const y = window.scrollY;
    const a = d.account, lg = d.login || {};
    const email = (a && a.email) || lg.email || '';
    const title = (a && (a.company || a.name)) || email || 'Unknown login';
    const init = title.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
    const keys = d.keys || [], usage = d.usage || [];
    const activeKeys = keys.filter((k) => !k.revoked_at);
    const calls30 = usage.reduce((s, u) => s + n0(u.calls), 0), errs30 = usage.reduce((s, u) => s + n0(u.errors), 0);
    const ctx = { sections: [] };

    // hero + actions
    const acts = [];
    if (manage) {
      if (a) {
        if (a.status === 'pending') { acts.push(btn('Approve production', 'lb-btn-primary', approve)); acts.push(btn('Deny', 'lb-btn-ghost', deny)); }
        if (a.status === 'denied') { acts.push(btn('Approve production', 'lb-btn-primary', approve)); acts.push(btn('Reopen as pending', 'lb-btn-ghost', () => reopen('Reopen'))); }
        if (a.status === 'approved') acts.push(btn('Suspend', 'lb-btn-ghost', suspend));
        if (a.status === 'suspended') acts.push(btn('Reinstate', 'lb-btn-primary', () => reopen('Reinstate')));
      }
      acts.push(btn('Issue key', 'lb-btn-ghost', openIssueKey));
      if (a) acts.push(btn('Edit profile', 'lb-btn-ghost', openEditProfile));
    }
    const heroNode = el('div', { class: 'p360-hero' }, [
      el('div', { class: 'p360-hero-row' }, [
        el('div', { class: 'p360-avatar broker' }, init),
        el('div', { style: 'flex:1;min-width:240px' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('span', { class: 'p360-name' }, title),
            a ? statusBadge(a.status) : pill('gray', 'not a developer account'),
            a ? pill('blue', sourceLabel(a.source)) : null,
          ]),
          el('div', { class: 'p360-sub' }, [
            email ? el('span', null, ['email ', el('b', null, email)]) : null,
            a && a.website ? el('span', null, ['website ', el('b', null, linkOrText(a.website, 'color:#bfdbfe'))]) : null,
            el('span', null, ['signed up ', el('b', null, fmtDate((a && a.created_at) || lg.created_at))]),
          ]),
          el('div', { class: 'p360-sub', style: 'margin-top:4px' }, [
            el('span', null, ['email confirmed ', el('b', null, lg.confirmed ? 'yes' : 'no')]),
            el('span', null, ['last sign-in ', el('b', null, agoOr(lg.last_sign_in_at))]),
          ]),
        ]),
      ]),
      acts.length ? el('div', { class: 'p360-hero-actions' }, acts) : null,
    ]);

    const kpis = kpiRow([
      { icon: 'check', label: 'Status', value: a ? a.status : 'n/a', sub: a ? sourceLabel(a.source) : 'no developer account', accent: a ? (STATUS_TONE[a.status] === 'green' ? 'green' : STATUS_TONE[a.status] === 'red' ? 'red' : 'amber') : 'blue' },
      { icon: 'lock', label: 'Active keys', value: String(activeKeys.length), sub: keys.length + ' issued in total', accent: 'blue' },
      { icon: 'activity', label: 'Calls (30 d)', value: String(calls30), sub: 'API requests', accent: 'blue' },
      { icon: 'alert', label: 'Errors (30 d)', value: String(errs30), sub: 'failed requests', accent: errs30 > 0 ? 'red' : 'green' },
    ]);

    // overview
    const slug = a && a.partner_slug;
    const overview = card([
      head('Overview'),
      a ? null : el('div', { class: 'p360-note', style: 'margin-bottom:10px' }, 'This login is not a developer account (e.g. a partner key issued by staff). Keys, usage and the audit trail are still shown below.'),
      a ? facts([
        ['Use case', a.use_case], ['Expected volume', a.expected_volume], ['Partner slug', a.partner_slug],
        ['API use terms', a.terms_version ? 'accepted ' + fmtDate(a.terms_accepted_at) + ' (' + a.terms_version + ')' : (a.terms_accepted_at ? 'old wording only (' + fmtDate(a.terms_accepted_at) + ') - not the current version' : 'not yet')],
        ['Verification note', a.verification_note], ['Staff notes (internal)', a.staff_notes],
        ['Status reason', a.status_reason],
        ['Reviewed', a.reviewed_at ? fmtDateTime(a.reviewed_at) + (a.reviewed_by ? ' by ' + a.reviewed_by : '') + (a.review_note ? ' - ' + a.review_note : '') : 'not yet'],
        ['Welcome email sent', a.welcomed_at ? fmtDateTime(a.welcomed_at) : 'not yet'],
        a.legacy_org_id ? ['Legacy carrier org', a.legacy_org_id + (a.legacy_org_status ? ' (' + a.legacy_org_status + ')' : '') + ' - signed up as a carrier before being moved here'] : null,
      ]) : null,
      a ? el('div', { style: 'margin-top:12px' }, [
        el('div', { class: 'p360-fact-l' }, 'Link-back example'),
        el('div', { style: 'margin-top:3px' }, slug ? code('https://loadboot.com/app/carrier/?src=' + slug + '&ref={ref}') : el('span', { class: 'cc-sub' }, 'Set a partner slug to get a link-back URL.')),
      ]) : null,
    ]);

    // production requests
    const reqs = d.requests || [];
    const requests = card([
      head('Production requests'),
      reqs.length ? tableOf(['Requested', 'Status', 'Use case', 'Volume', 'Integration URL', 'Message', 'Decision'],
        reqs.map((r) => el('tr', null, [
          el('td', null, when(r.created_at)),
          el('td', null, statusBadge(r.status)),
          el('td', null, dash(r.use_case)), el('td', null, dash(r.expected_volume)),
          el('td', null, r.integration_url ? linkOrText(r.integration_url) : '—'),
          el('td', null, dash(r.message)),
          el('td', null, r.decided_at ? [when(r.decided_at), r.decision_note ? el('div', { class: 'cc-sub' }, r.decision_note) : null] : '—'),
        ]))) : el('div', { class: 'p360-empty' }, 'No production requests yet.'),
    ]);

    // keys
    const keysCard = card([
      head('API keys'),
      keys.length ? tableOf(['Key', 'Prefix', 'Scopes', 'Created', 'Last used', 'Calls 30d', 'Errors 30d', 'Status', ''],
        keys.map((k) => el('tr', null, [
          el('td', null, [el('b', null, k.name || '(unnamed)'), el('div', { class: 'cc-sub' }, [k.staff_issued ? 'issued by staff' : 'self-serve', k.partner_slug ? ' · partner ' + k.partner_slug : '', k.rate_limit_per_min ? ' · ' + k.rate_limit_per_min + '/min' : ''].join(''))]),
          el('td', null, code((k.prefix || '') + '…')),
          el('td', null, scopePills(k.scopes)),
          el('td', null, fmtDate(k.created_at)),
          el('td', null, agoOr(k.last_used_at, 'never')),
          el('td', null, String(n0(k.calls_30d))),
          el('td', null, n0(k.errors_30d) > 0 ? pill('red', String(n0(k.errors_30d))) : '0'),
          el('td', null, k.revoked_at ? el('span', { title: k.revoke_reason || '' }, [pill('red', 'revoked'), el('div', { class: 'cc-sub' }, [fmtDate(k.revoked_at), k.revoke_reason ? ' - ' + k.revoke_reason : ''].join(''))]) : pill('green', 'active')),
          el('td', null, (manage && !k.revoked_at) ? btn('Revoke', 'p360-danger', () => revoke(k)) : ''),
        ]))) : el('div', { class: 'p360-empty' }, 'No keys issued yet.'),
    ]);

    // usage
    const usageCard = card([
      head('Usage - last 30 days', el('span', { class: 'cc-sub' }, calls30 + ' calls · ' + errs30 + ' errors')),
      usage.length ? el('div', null, [
        el('div', { class: 'p360-fact-l' }, 'Calls per day'),
        barChart(usage.map((u) => ({ d: u.day, c: n0(u.calls) })), { height: 90 }),
        el('div', { class: 'p360-fact-l', style: 'margin-top:12px' }, 'Errors per day'),
        barChart(usage.map((u) => ({ d: u.day, c: n0(u.errors) })), { height: 56 }),
        el('div', { class: 'cc-sub', style: 'display:flex;justify-content:space-between;margin-top:4px' }, [el('span', null, fmtDate(usage[0].day)), el('span', null, fmtDate(usage[usage.length - 1].day))]),
      ]) : el('div', { class: 'p360-empty' }, 'No usage recorded yet.'),
    ]);

    // recent calls / errors
    const callsTable = (rows, empty) => rows.length ? tableOf(['Time', 'Method', 'Endpoint', 'Status', 'Latency', 'Key', ''],
      rows.map((c) => el('tr', null, [
        el('td', null, when(c.created_at)),
        el('td', null, el('b', null, c.method || '—')),
        el('td', null, [code(c.endpoint || '—'), c.error ? el('div', { class: 'cc-sub' }, c.error) : null]),
        el('td', null, pill(httpTone(c.status), String(c.status))),
        el('td', null, c.latency_ms != null ? n0(c.latency_ms) + ' ms' : '—'),
        el('td', null, c.key_prefix ? code(c.key_prefix + '…') : '—'),
        el('td', null, c.sandbox ? pill('violet', 'sandbox') : ''),
      ]))) : el('div', { class: 'p360-empty' }, empty);
    const recent = card([head('Recent calls', el('span', { class: 'cc-sub' }, 'latest 50')), callsTable(d.recent || [], 'No calls yet.')]);
    const errors = card([head('Error log', el('span', { class: 'cc-sub' }, 'latest 50')), callsTable(d.errors || [], 'No errors - good.')]);

    // webhooks
    const hooks = d.webhooks || [];
    const FAILED = ['failed', 'error', 'dead'];
    const webhooks = card([
      head('Webhooks'),
      hooks.length ? hooks.map((w) => block(w.name || 'Webhook', w.active ? pill('green', 'active') : pill('gray', 'off'), [
        el('div', { class: 'cc-sub', style: 'word-break:break-all' }, w.url),
        el('div', { class: 'cc-sub', style: 'margin:4px 0 8px' }, (w.event_types || []).length ? 'Events: ' + w.event_types.join(', ') : 'No events subscribed'),
        (w.deliveries || []).length ? tableOf(['When', 'Event', 'Status', 'Attempts', 'Note', ''],
          w.deliveries.map((x) => el('tr', null, [
            el('td', null, when(x.created_at)), el('td', null, dash(x.event_type)),
            el('td', null, pill(FAILED.includes(x.status) ? 'red' : x.status === 'delivered' || x.status === 'sent' ? 'green' : 'amber', dash(x.status))),
            el('td', null, String(n0(x.attempts))), el('td', null, dash(x.note)),
            el('td', null, (manage && FAILED.includes(x.status)) ? btn('Retry', '', () => retry(x)) : ''),
          ]))) : el('div', { class: 'p360-empty' }, 'No deliveries yet.'),
      ])) : el('div', { class: 'p360-empty' }, 'No webhook endpoints.'),
    ]);

    // audit
    const audit = d.audit || [];
    const auditCard = card([
      head('Audit trail'),
      audit.length ? tableOf(['Time', 'Actor', 'Action', 'Summary'],
        audit.map((x) => el('tr', { title: x.detail ? (typeof x.detail === 'string' ? x.detail : JSON.stringify(x.detail)) : null }, [
          el('td', null, when(x.at)), el('td', null, dash(x.actor)), el('td', null, el('b', null, dash(x.action))), el('td', null, dash(x.summary)),
        ]))) : el('div', { class: 'p360-empty' }, 'Nothing recorded yet.'),
    ]);

    const secs = [
      section('api360-overview', 'Overview', overview, ctx),
      section('api360-requests', 'Requests', requests, ctx),
      section('api360-keys', 'Keys', keysCard, ctx),
      section('api360-usage', 'Usage', usageCard, ctx),
      section('api360-recent', 'Recent calls', recent, ctx),
      section('api360-errors', 'Errors', errors, ctx),
      section('api360-webhooks', 'Webhooks', webhooks, ctx),
      section('api360-audit', 'Audit trail', auditCard, ctx),
    ];
    mount(body, [heroNode, kpis, sectionNav(ctx.sections), ...secs]);
    stackTables(body);
    if (keepScroll) window.scrollTo(0, y);
  }

  load(false);
}

export default renderApi360;
