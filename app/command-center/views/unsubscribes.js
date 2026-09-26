// Unsubscribes — the unsubscribe engine's Command Center screen (bl_comm_0446, 25 Sep 2026).
// One place that answers: who stopped which emails, how (one-click, the preferences page, a reply,
// the app, staff), why (their own words), from which email — and what the engine has refused to send
// since, with the exact reason. Every row opens the person: their per-category state, the whole
// timeline, every blocked send, and (for staff with comm.manage) the switches to change it, each
// change written to the same ledger with who did it and why.
// "Can I send this?" is the question to ask BEFORE any hand send: cc_email_can_send(to, key).
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, statCard, searchBox, segmented, openDrawer, fmtDateTime, ago, askConfirm } from '../../shared/ui/components.js';
import { toast, humanizeError } from '../../shared/errors.js';
import { showLoading, showError } from '../../shared/loading.js';
import { can } from '../../shared/permissions.js';
import {
  unsubOverview, unsubEvents, unsubAddresses, unsubPerson, unsubSet, unsubSettingsSet, unsubReasonSet,
  unsubBlocked, emailCanSend, emailCatalog, unsubFrequencySet,
} from '../../shared/api.js';

const SOURCES = [
  ['one_click', 'One-click (mail app)'], ['preference_page', 'Preferences page'], ['legacy_link', 'Older link'],
  ['reply', 'Replied "unsubscribe"'], ['app_prefs', 'App settings'], ['cc_manual', 'Staff (CC)'],
  ['sms_stop', 'SMS STOP'], ['backfill', 'Backfilled'],
];
const SOURCE_TONE = { one_click: 'amber', preference_page: 'blue', legacy_link: 'gray', reply: 'violet', app_prefs: 'blue', cc_manual: 'gray', sms_stop: 'amber', backfill: 'gray' };
const CODE_TONE = { suppressed: 'red', unsubscribed_all: 'red', unsubscribed_group: 'amber', unsubscribed_marketing: 'amber', preference_opted_out: 'amber', frequency_cap: 'violet', essential: 'green', ok: 'green' };
const PACE = { 7: 'at most 1 a week', 30: 'at most 1 a month' };
const ACTION = (a, m) => a === 'unsubscribe' ? pill('Unsubscribed', 'amber') : a === 'resubscribe' ? pill('Resubscribed', 'green')
  : pill('Fewer emails' + (m && m.max_per_days ? ': ' + PACE[m.max_per_days] : ': every email'), 'violet');

const pill = (label, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, String(label || '—'));
// "Route" chip (26 Sep 2026, owner): the server's source_label is sentence text ("the email preferences page"),
// which .cc-pill title-cased and wrapped into a three-line blob. The chip shows the short label from SOURCES
// with an icon, on one line; the full sentence stays in the tooltip.
const ROUTE_ICON = {
  one_click: 'M4 6h16v12H4z M4 7l8 6 8-6', preference_page: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5v4 M10 15v4',
  legacy_link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  reply: 'M9 10 4 14l5 4 M4 14h11a5 5 0 0 0 5-5V6', app_prefs: 'M7 3h10v18H7z M11 18h2',
  cc_manual: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0', sms_stop: 'M4 5h16v11H9l-5 4z M9 10h6',
  backfill: 'M4 12a8 8 0 1 0 2.3-5.7 M4 4v4h4',
};
if (!document.getElementById('ux-route-css')) {
  document.head.appendChild(el('style', { id: 'ux-route-css' }, `
.ux-route{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;text-transform:none;font-size:.76rem;font-weight:700;
  letter-spacing:.01em;padding:5px 11px 5px 8px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 24%,transparent);
  box-shadow:0 1px 2px rgba(15,23,42,.08)}
.ux-route svg{flex:none;opacity:.9}
.ux-unsub td .cc-pill,.ux-unsub td .ux-when{white-space:nowrap}`));
}
const routeChip = (source, fullLabel) => {
  const label = SOURCES.find(s => s[0] === source)?.[1] || fullLabel || source || '—';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '13'); svg.setAttribute('height', '13'); svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ROUTE_ICON[source] || 'M12 12h.01'); svg.appendChild(path);
  return el('span', { class: 'cc-pill cc-pill-' + (SOURCE_TONE[source] || 'gray') + ' ux-route', title: fullLabel ? 'Via ' + fullLabel : label }, [svg, label]);
};
const num = (n) => Number(n || 0).toLocaleString();
const sub = (t, style) => el('div', { class: 'cc-sub', style: style || '' }, t);
const when = (ts) => ts ? el('span', { class: 'ux-when', title: fmtDateTime(ts) }, ago(ts)) : '—';
const groupsText = (labels, codes) => (labels && labels.length ? labels : (codes || [])).map(x => x === '*' ? 'every optional email' : x).join(', ') || '—';
const reasonText = (r) => [r.reason_label, r.reason_text].filter(Boolean).join(' — ') || (r.reason_code || '');
const qs = () => { try { return new URLSearchParams((location.hash.split('?')[1] || '')); } catch (_) { return new URLSearchParams(); } };

function bars(items, keyLabel, total) {
  if (!items || !items.length) return sub('Nothing in this period.');
  const max = Math.max(1, ...items.map(i => Number(i.n) || 0));
  return el('div', { style: 'display:flex;flex-direction:column;gap:7px' }, items.slice(0, 8).map(i => el('div', null, [
    el('div', { style: 'display:flex;justify-content:space-between;font-size:.84rem' }, [
      el('span', { style: 'font-weight:600' }, String(i[keyLabel] || i.label || '—')),
      el('span', { class: 'cc-sub' }, num(i.n) + (total ? ' · ' + Math.round(100 * (Number(i.n) || 0) / total) + '%' : '')),
    ]),
    el('div', { style: 'height:6px;background:#eef2f7;border-radius:4px;overflow:hidden' },
      el('div', { style: 'height:100%;width:' + Math.max(3, Math.round(100 * (Number(i.n) || 0) / max)) + '%;background:#0883F7;border-radius:4px' })),
  ])));
}

function table(cols, rows, onRow) {
  return el('div', { class: 'cc-table-wrap ux-unsub' }, el('table', { class: 'cc-table' }, [
    el('thead', null, el('tr', null, cols.map(c => el('th', null, c)))),
    el('tbody', null, rows.map(r => el('tr', { class: onRow ? 'clickable' : '', onClick: onRow ? () => onRow(r.row) : null }, r.cells.map(c => el('td', null, c))))),
  ]));
}

function verdictCard(v) {
  const ok = !!v.allowed;
  return el('div', { class: 'lb-card', style: 'padding:16px 18px;border-left:5px solid ' + (ok ? '#15803d' : '#dc2626') }, [
    el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
      pill(ok ? (v.essential ? 'Allowed — essential' : 'Allowed') : 'Do not send', ok ? 'green' : 'red'),
      v.group_label ? pill(v.group_label, 'blue') : null,
      v.code ? pill(String(v.code).replace(/_/g, ' '), CODE_TONE[v.code] || 'gray') : null,
    ]),
    el('div', { style: 'font-size:.92rem;line-height:1.55' }, v.reason || ''),
    (v.blocked_groups && v.blocked_groups.length) ? sub('Switched off for this address: ' + v.blocked_groups.join(', '), 'margin-top:8px') : null,
    v.state && v.state.hard_suppressed ? sub('Hard-suppressed (' + v.state.hard_reason + ') since ' + fmtDateTime(v.state.hard_since) + '. Nothing is sent to this address.', 'margin-top:6px;color:#dc2626') : null,
  ]);
}

export async function renderUnsubscribes(host) {
  const manage = can('comm.manage') || can('settings.manage') || can('content.manage');
  let days = 30, tab = 'activity', q = '', group = '', source = '', action = '';
  let overview = null;

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const breakdown = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:6px 0 18px' });
  const tabsBox = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 12px' });
  const filters = el('div', { class: 'cc-toolbar', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 14px' });
  const listBox = el('div');

  const head = sectionHead(
    'Unsubscribes',
    'Every unsubscribe and resubscribe, whatever the route: one-click in their mail app, the preferences page, a reply, the app, or staff. Open a row for the whole story — which categories are off, why they said so, and every email the engine has refused since.',
    [
      el('button', { class: 'lb-btn lb-btn-primary', onClick: () => checkDrawer() }, 'Can I send this?'),
      manage ? el('button', { class: 'lb-btn', onClick: () => settingsDrawer() }, 'Settings & reasons') : null,
      el('button', { class: 'lb-btn', onClick: exportCsv }, 'Export CSV'),
    ],
  );
  mount(host, el('div', { class: 'cc-view' }, [head, kpis, breakdown, tabsBox, filters, listBox]));

  mount(tabsBox, [
    segmented([
      { value: 'activity', label: 'Activity' }, { value: 'people', label: 'People' },
      { value: 'blocked', label: 'Blocked sends' },
    ], tab, (v) => { tab = v; renderFilters(); loadList(); }),
    el('span', { class: 'cc-sub' }, 'Period'),
    segmented([{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1y' }], days, (v) => { days = v; loadOverview(); }),
  ]);

  function select(opts, current, onPick, placeholder) {
    const s = el('select', { class: 'cc-input', style: 'width:auto;min-width:150px', onChange: () => onPick(s.value) },
      [el('option', { value: '' }, placeholder)].concat(opts.map(([v, l]) => el('option', { value: v, selected: v === current ? 'selected' : null }, l))));
    return s;
  }
  function renderFilters() {
    const groups = (overview && overview.by_group_all) || [];
    mount(filters, [
      searchBox(tab === 'blocked' ? 'Search address or email key…' : 'Search address, name or company…', (v) => { q = v; loadList(); }),
      tab !== 'blocked' ? select(groups.map(g => [g.code, g.label]), group, (v) => { group = v; loadList(); }, 'Any category') : null,
      tab === 'activity' ? select(SOURCES, source, (v) => { source = v; loadList(); }, 'Any route') : null,
      tab === 'activity' ? select([['unsubscribe', 'Unsubscribed'], ['resubscribe', 'Resubscribed'], ['frequency', 'Chose fewer emails']], action, (v) => { action = v; loadList(); }, 'Every change') : null,
    ]);
  }

  async function loadOverview() {
    try { overview = await unsubOverview(days); }
    catch (e) { showError(kpis, humanizeError(e), loadOverview); return; }
    const k = overview.kpis || {};
    // the category list for the filter comes from the state shape; cheap to derive from by_group + known groups
    overview.by_group_all = [
      ['load_ops', 'Loads & trips'], ['compliance', 'Documents & compliance'], ['billing', 'Billing & payouts'], ['digests', 'Summaries'],
      ['product_announcements', 'Product news'], ['marketing', 'Marketing'], ['*', 'Every optional email'],
    ].map(([code, label]) => ({ code, label }));
    mount(kpis, [
      statCard({ icon: 'shield', label: 'Unsubscribed', value: num(k.unsubs_period), sub: 'last ' + days + ' days · ' + num(k.unsubs_7d) + ' in 7d', accent: k.unsubs_7d ? 'amber' : 'green', onClick: () => { tab = 'activity'; action = 'unsubscribe'; renderFilters(); loadList(); } }),
      statCard({ icon: 'refresh', label: 'Came back', value: num(k.resubs_period), sub: 'resubscribed · ' + num(k.fewer) + ' kept on fewer emails', accent: 'green', onClick: () => { tab = 'activity'; action = 'resubscribe'; renderFilters(); loadList(); } }),
      statCard({ icon: 'users', label: 'Addresses off', value: num(k.addresses_out), sub: num(k.all_off) + ' stopped everything · ' + num(k.marketing_off) + ' no marketing', accent: 'blue', onClick: () => { tab = 'people'; renderFilters(); loadList(); } }),
      statCard({ icon: 'alert', label: 'Blocked sends', value: num(k.blocked_period), sub: num(k.blocked_unsub_period) + ' because they unsubscribed · ' + num(k.sent_period) + ' sent', accent: k.blocked_period ? 'amber' : 'green', onClick: () => { tab = 'blocked'; renderFilters(); loadList(); } }),
      statCard({ icon: 'x', label: 'Hard suppressed', value: num(k.hard_suppressed), sub: 'bounced, complained or blocked by staff', accent: k.hard_suppressed ? 'red' : 'green', to: '/delivery' }),
    ]);
    const total = Number(k.unsubs_period) || 0;
    mount(breakdown, [
      el('div', { class: 'lb-card', style: 'padding:16px 18px' }, [el('div', { style: 'font-weight:700;margin-bottom:10px' }, 'By route'), bars(overview.by_source, 'label', total)]),
      el('div', { class: 'lb-card', style: 'padding:16px 18px' }, [el('div', { style: 'font-weight:700;margin-bottom:10px' }, 'By category'), bars(overview.by_group, 'label', null)]),
      el('div', { class: 'lb-card', style: 'padding:16px 18px' }, [el('div', { style: 'font-weight:700;margin-bottom:10px' }, 'Why they said'), bars(overview.by_reason, 'label', total)]),
      el('div', { class: 'lb-card', style: 'padding:16px 18px' }, [el('div', { style: 'font-weight:700;margin-bottom:10px' }, 'From which email'), bars((overview.by_template || []).map(t => ({ label: t.name || t.template, n: t.n })), 'label', total)]),
    ]);
    renderFilters();
  }

  async function loadList() {
    showLoading(listBox, 'Loading…');
    try {
      if (tab === 'activity') {
        const res = await unsubEvents({ q, group, source, action, limit: 200 });
        const rows = res.rows || [];
        if (!rows.length) { mount(listBox, empty('No activity matches. When someone unsubscribes — by any route — it shows up here within the second.')); return; }
        mount(listBox, [
          sub(num(res.total) + ' events' + (rows.length < res.total ? ' · showing the latest ' + rows.length : ''), 'margin-bottom:8px'),
          table(['When', 'Who', 'What', 'Categories', 'Route', 'Why', 'From email'], rows.map(r => ({ row: r, cells: [
            when(r.at),
            el('div', null, [el('div', { style: 'font-weight:600' }, r.email), sub([r.name, r.org_name].filter(Boolean).join(' · ') || (r.is_user ? 'signed-in user' : 'not a user'))]),
            ACTION(r.action, r.meta),
            groupsText(r.group_labels, r.groups),
            el('div', null, [routeChip(r.source, r.source_label), r.actor_name ? sub('by ' + r.actor_name) : null]),
            reasonText(r) || sub('—'),
            r.origin_name || r.origin_template || '—',
          ] })), (r) => personDrawer(r.email)),
        ]);
      } else if (tab === 'people') {
        const res = await unsubAddresses({ q, group, limit: 200 });
        const rows = res.rows || [];
        if (!rows.length) { mount(listBox, empty('Nobody is switched off for this filter.')); return; }
        mount(listBox, [
          sub(num(res.total) + ' addresses with something switched off', 'margin-bottom:8px'),
          table(['Address', 'Off', 'Since', 'Blocked (30d)', 'Events', 'Suppression'], rows.map(r => ({ row: r, cells: [
            el('div', null, [el('div', { style: 'font-weight:600' }, r.email), sub(r.name || (r.is_user ? 'signed-in user' : 'not a user'))]),
            r.all_off ? pill('Every optional email', 'red') : groupsText(r.group_labels, r.groups),
            when(r.last_at),
            r.blocked_30d ? pill(num(r.blocked_30d) + ' blocked', 'amber') : sub('0'),
            num(r.events),
            r.hard ? pill(r.hard, 'red') : sub('—'),
          ] })), (r) => personDrawer(r.email)),
        ]);
      } else {
        const res = await unsubBlocked({ q, limit: 200 });
        const rows = res.rows || [];
        if (!rows.length) { mount(listBox, empty('Nothing has been refused. Every attempt the engine blocks lands here with the reason it gave.')); return; }
        mount(listBox, [
          sub(num(res.total) + ' refused sends · the engine writes one row per attempt it stops', 'margin-bottom:8px'),
          table(['When', 'To', 'Email', 'Category', 'Why it was refused'], rows.map(r => ({ row: r, cells: [
            when(r.at), el('div', { style: 'font-weight:600' }, r.email), el('div', null, [r.name || r.key, r.name ? sub(r.key) : null]),
            r.group ? pill(r.group_label || r.group, CODE_TONE[r.code] || 'gray') : '—',
            el('div', { style: 'max-width:520px;line-height:1.45' }, r.reason || '—'),
          ] })), (r) => personDrawer(r.email)),
        ]);
      }
    } catch (e) { showError(listBox, humanizeError(e), loadList); }
  }

  const empty = (t) => el('div', { class: 'lb-card', style: 'padding:28px;text-align:center' }, [el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Nothing here'), sub(t)]);

  async function exportCsv() {
    try {
      const res = await unsubEvents({ q, group, source, action, limit: 2000 });
      const rows = res.rows || [];
      const cols = ['at', 'email', 'name', 'org_name', 'action', 'scope', 'groups', 'reason_code', 'reason_text', 'source', 'origin_template', 'actor_name', 'ip'];
      const esc = (v) => '"' + String(v == null ? '' : Array.isArray(v) ? v.join('|') : v).replace(/"/g, '""') + '"';
      const csv = [cols.join(',')].concat(rows.map(r => cols.map(c => esc(r[c])).join(','))).join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'loadboot-unsubscribes-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  // ---------------------------------------------------------------- one person, the whole story
  async function personDrawer(email) {
    const body = el('div');
    const drawer = openDrawer('Email preferences', body, { subtitle: email, size: 'lg' });
    showLoading(body, 'Loading…');
    let p;
    try { p = await unsubPerson(email); } catch (e) { showError(body, humanizeError(e), () => personDrawer(email)); return; }
    const st = p.state || {}; const id = p.identity || {};
    const groups = st.groups || [];

    const paceCell = (g) => {
      if (!g.frequency_allowed || g.opted_out) return null;
      if (!manage) return g.max_per_days ? pill(PACE[g.max_per_days], 'violet') : null;
      const s = el('select', { class: 'cc-input', style: 'width:auto;margin-top:6px;padding:4px 8px;font-size:.8rem', onChange: async () => {
        try { const r = await unsubFrequencySet(email, g.code, s.value ? Number(s.value) : null, 'set in CC');
          if (r && r.ok === false) { toast(r.error || 'Could not save', 'error'); return; }
          toast('Saved', 'success'); personDrawer(email); loadOverview(); loadList(); } catch (e) { toast(humanizeError(e), 'error'); } } },
        [['', 'Every email'], ['7', 'At most 1 a week'], ['30', 'At most 1 a month']].map(([v, l]) => el('option', { value: v, selected: String(g.max_per_days || '') === v ? 'selected' : null }, l)));
      return el('div', null, s);
    };
    const toggle = (g) => {
      if (!g.opt_out_allowed) return pill('Always on', 'green');
      const on = !g.opted_out;
      const b = el('button', { class: 'lb-btn lb-btn-sm', style: on ? 'background:#ecfdf3;color:#15803d;border-color:#bbf7d0' : 'background:#fef2f2;color:#b91c1c;border-color:#fecaca', disabled: manage ? null : 'disabled',
        onClick: () => changeDrawer(email, g, on) }, on ? 'On' : 'Off');
      return b;
    };
    mount(body, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
        st.hard_suppressed ? pill('Hard suppressed: ' + st.hard_reason, 'red') : null,
        st.all_off ? pill('Every optional email off', 'red') : null,
        id.user_id ? pill(id.role || 'user', 'blue') : pill('Not a signed-in user', 'gray'),
        p.outreach ? pill('Outreach contact: ' + p.outreach.status, p.outreach.status === 'unsubscribed' ? 'amber' : 'gray') : null,
        id.is_demo ? pill('Demo account', 'violet') : null,
      ]),
      (id.name || id.org_name) ? sub([id.name, id.company, id.org_name && id.org_name !== id.company ? id.org_name : null].filter(Boolean).join(' · '), 'margin-bottom:10px') : null,
      p.sms && p.sms.opted_out_at ? sub('SMS: opted out ' + fmtDateTime(p.sms.opted_out_at) + (p.sms.keyword ? ' (' + p.sms.keyword + ')' : ''), 'margin-bottom:10px;color:#b45309') : null,

      el('div', { style: 'font-weight:700;margin:8px 0 6px' }, 'Categories'),
      el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Category', 'State', 'Since', 'How', 'Why'].map(c => el('th', null, c)))),
        el('tbody', null, groups.map(g => el('tr', null, [
          el('td', null, [el('div', { style: 'font-weight:600' }, g.label), sub(g.description)]),
          el('td', null, [toggle(g), paceCell(g)]),
          el('td', null, g.opted_out && g.since ? when(g.since) : '—'),
          el('td', null, g.opted_out && g.source ? routeChip(g.source) : '—'),
          el('td', null, g.opted_out ? ([g.reason_code, g.reason_text].filter(Boolean).join(' — ') || (g.origin_template ? 'from ' + g.origin_template : '—')) : '—'),
        ]))),
      ])),
      manage ? el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 4px' }, [
        st.all_off ? null : el('button', { class: 'lb-btn lb-btn-sm', onClick: () => changeDrawer(email, { code: '*', label: 'every optional email', opt_out_allowed: true }, true) }, 'Stop every optional email'),
        st.all_off ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => changeDrawer(email, { code: '*', label: 'every optional email', opt_out_allowed: true }, false) }, 'Turn optional emails back on') : null,
      ]) : sub('You can see everything; changing a switch needs comm.manage.', 'margin:8px 0'),

      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Check before you send'),
      checkInline(email, groups),

      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Timeline'),
      (p.events || []).length ? table(['When', 'What', 'Categories', 'Route', 'Why', 'From email', 'Detail'], p.events.map(e => ({ row: e, cells: [
        when(e.at), ACTION(e.action, e.meta),
        groupsText(e.group_labels, e.groups), el('div', null, [routeChip(e.source, e.source_label), e.actor_name ? sub('by ' + e.actor_name) : null]),
        reasonText(e) || '—', e.origin_name || e.origin_template || '—',
        sub([e.meta && e.meta.note ? 'note: ' + e.meta.note : null, e.ip ? 'ip ' + e.ip : null].filter(Boolean).join(' · ')),
      ] }))) : sub('No events recorded for this address.'),

      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Refused sends'),
      (p.blocked || []).length ? table(['When', 'Email', 'Category', 'Reason'], p.blocked.map(b => ({ row: b, cells: [when(b.at), b.name || b.key, b.group_label || b.group || '—', el('div', { style: 'max-width:480px;line-height:1.45' }, b.reason)] }))) : sub('Nothing has been refused for this address.'),

      (p.suppressions || []).length ? el('div', null, [el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Suppression list'),
        table(['Channel', 'Reason', 'Since'], p.suppressions.map(s => ({ row: s, cells: [s.channel, pill(s.reason, s.reason === 'unsubscribed' ? 'amber' : 'red'), fmtDateTime(s.since)] })))]) : null,

      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Recent emails'),
      (p.deliveries || []).length ? table(['When', 'Email', 'Category', 'Status', 'Note'], p.deliveries.map(d => ({ row: d, cells: [when(d.at), d.name || d.key, d.group || '—', pill(d.status, { sent: 'green', delivered: 'green', opened: 'green', clicked: 'green', unsubscribed: 'amber', bounced: 'red', complained: 'red', failed: 'amber' }[d.status] || 'gray'), sub(d.reason || '')] }))) : sub('No emails on record.'),
    ]);

    function changeDrawer(addr, g, currentlyOn) {
      const action = currentlyOn ? 'unsubscribe' : 'resubscribe';
      const note = el('textarea', { class: 'cc-input', rows: '3', placeholder: action === 'resubscribe' ? 'Required: where did the consent come from? (their reply, a call, a form…)' : 'Optional note (what they told you)' });
      const reasons = (overview && overview.reasons || []).filter(r => r.active);
      let rc = null;
      const chips = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px' }, reasons.map(r => { const b = el('button', { class: 'cc-chip-btn', onClick: () => { rc = rc === r.code ? null : r.code; chips.querySelectorAll('.cc-chip-btn').forEach(x => x.classList.toggle('on', x.dataset.code === rc)); }, dataset: { code: r.code } }, r.label); return b; }));
      const b2 = el('div');
      const d2 = openDrawer((action === 'unsubscribe' ? 'Switch off ' : 'Switch on ') + g.label, b2, { subtitle: addr, size: 'sm' });
      mount(b2, [
        sub(action === 'unsubscribe' ? 'This is recorded as a staff action with your name. The person can turn it back on from any LoadBoot email or the app.' : 'Turning a category back on needs a note saying where the consent came from — it goes in the ledger next to your name.', 'margin-bottom:10px'),
        action === 'unsubscribe' && reasons.length ? el('div', null, [sub('Reason (optional)'), chips]) : null,
        note,
        el('div', { style: 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end' }, [
          el('button', { class: 'lb-btn', onClick: () => d2.close() }, 'Cancel'),
          el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
            try {
              const r = await unsubSet({ email: addr, action, scope: g.code === '*' ? 'all' : 'group', groups: g.code === '*' ? null : [g.code], reason_code: rc, reason_text: null, note: note.value.trim() || null });
              if (r && r.ok === false) { toast(r.error || 'Could not save', 'error'); return; }
              toast('Saved', 'success'); d2.close(); personDrawer(addr); loadOverview(); loadList();
            } catch (e) { toast(humanizeError(e), 'error'); }
          } }, action === 'unsubscribe' ? 'Switch off' : 'Switch on'),
        ]),
      ]);
    }
    return drawer;
  }

  function checkInline(email, groups) {
    const out = el('div', { style: 'margin-top:8px' });
    const keyIn = el('input', { class: 'cc-input', list: 'cc-unsub-keys', placeholder: 'Catalog key, e.g. carrier_weekly_summary', style: 'flex:1;min-width:220px' });
    const dl = el('datalist', { id: 'cc-unsub-keys' });
    emailCatalog('live', null).then(res => mount(dl, (res.rows || []).map(r => el('option', { value: r.key }, r.name || r.key)))).catch(() => {});
    const run = async () => {
      const key = keyIn.value.trim(); if (!key) { toast('Type the catalog key of the email you want to send', 'error'); return; }
      showLoading(out, 'Asking the engine…');
      try { mount(out, verdictCard(await emailCanSend(email, key))); } catch (e) { showError(out, humanizeError(e), run); }
    };
    return el('div', null, [
      sub('Type the catalog key of the email you are about to send. The engine answers exactly as it would at send time.', 'margin-bottom:6px'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [keyIn, dl, el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: run }, 'Check')]),
      groups.some(g => g.opted_out) ? sub('Off right now: ' + groups.filter(g => g.opted_out).map(g => g.label).join(', '), 'margin-top:6px;color:#b45309') : null,
      out,
    ]);
  }

  // ---------------------------------------------------------------- "Can I send this?" — any address
  function checkDrawer(prefill) {
    const body = el('div');
    const d = openDrawer('Can I send this?', body, { subtitle: 'Ask before any hand send. Same answer the engine gives at send time.', size: 'md' });
    const emailIn = el('input', { class: 'cc-input', type: 'email', placeholder: 'recipient@example.com', value: prefill || '' });
    const keyIn = el('input', { class: 'cc-input', list: 'cc-unsub-keys2', placeholder: 'Catalog key (optional — without it only the hard suppression list is checked)' });
    const dl = el('datalist', { id: 'cc-unsub-keys2' });
    emailCatalog('live', null).then(res => mount(dl, (res.rows || []).map(r => el('option', { value: r.key }, r.name || r.key)))).catch(() => {});
    const out = el('div', { style: 'margin-top:12px' });
    const run = async () => {
      const to = emailIn.value.trim(); if (!to) return;
      showLoading(out, 'Asking the engine…');
      try {
        const v = await emailCanSend(to, keyIn.value.trim() || null);
        mount(out, [verdictCard(v),
          (v.recent_events || []).length ? el('div', { style: 'margin-top:10px' }, [sub('Recent activity', 'font-weight:700;color:inherit'), el('ul', { style: 'margin:6px 0 0 18px;padding:0;font-size:.86rem;line-height:1.6' }, v.recent_events.map(e => el('li', null, fmtDateTime(e.at) + ' · ' + e.action + ' ' + (e.groups || []).join(', ') + ' via ' + e.source_label + (e.reason_text || e.reason_code ? ' — ' + (e.reason_text || e.reason_code) : ''))))]) : null,
          el('div', { style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { d.close(); personDrawer(to.toLowerCase()); } }, 'Open the full picture')),
        ]);
      } catch (e) { showError(out, humanizeError(e), run); }
    };
    mount(body, [
      el('div', { style: 'display:grid;gap:8px' }, [emailIn, keyIn, dl]),
      el('div', { style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: run }, 'Check')),
      out,
    ]);
    if (prefill) run();
  }

  // ---------------------------------------------------------------- settings + the reason dictionary
  async function settingsDrawer() {
    const body = el('div');
    const d = openDrawer('Unsubscribe engine — settings', body, { size: 'md', subtitle: 'What each route means, and the reasons the preferences page offers.' });
    const s = (overview && overview.settings) || {};
    const scopeSel = (cur, allowGroup) => el('select', { class: 'cc-input' }, [
      allowGroup ? el('option', { value: 'group', selected: cur === 'group' ? 'selected' : null }, 'Only the category that email belonged to (recommended)') : null,
      el('option', { value: 'marketing', selected: cur === 'marketing' ? 'selected' : null }, 'All marketing / cold outreach'),
      el('option', { value: 'all', selected: cur === 'all' ? 'selected' : null }, 'Every optional email'),
    ]);
    const oneClick = scopeSel(s.one_click_scope || 'group', true), reply = scopeSel(s.reply_scope || 'marketing', true), legacy = scopeSel(s.legacy_link_scope || 'marketing', false);
    const cb = (key, label, help) => { const c = el('input', { type: 'checkbox', checked: s[key] !== false ? 'checked' : null }); return { c, node: el('label', { style: 'display:flex;gap:10px;align-items:flex-start;margin:8px 0' }, [c, el('div', null, [el('div', { style: 'font-weight:600' }, label), sub(help)])]) }; };
    const offerAll = cb('page_offer_all', 'Offer "stop every optional email" on the page', 'Amazon/Uber do. Without it people report spam instead.');
    const askReason = cb('ask_reason', 'Ask why (never required)', 'The reason chips below, plus a free-text box.');
    const resub = cb('resubscribe_via_link', 'Let people switch a category back on from the page', 'Recorded as a resubscribe with source "preferences page".');
    const reasonsBox = el('div');
    const renderReasons = (list) => mount(reasonsBox, [
      table(['Code', 'Label (what the person sees)', 'Order', 'Active'], (list || []).map(r => ({ row: r, cells: [
        el('code', { style: 'font-size:.8rem' }, r.code),
        r.label, String(r.sort),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { renderReasons(await unsubReasonSet(r.code, r.label, null, !r.active)); } catch (e) { toast(humanizeError(e), 'error'); } } }, r.active ? 'On' : 'Off'),
      ] }))),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, (() => {
        const code = el('input', { class: 'cc-input', placeholder: 'code (e.g. moved_on)', style: 'flex:1;min-width:120px' });
        const label = el('input', { class: 'cc-input', placeholder: 'Label the person sees', style: 'flex:2;min-width:180px' });
        return [code, label, el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { renderReasons(await unsubReasonSet(code.value, label.value, 80, true)); code.value = ''; label.value = ''; } catch (e) { toast(humanizeError(e), 'error'); } } }, '+ Add reason')];
      })()),
    ]);
    renderReasons(overview && overview.reasons);
    mount(body, [
      el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'What an unsubscribe means, per route'),
      el('div', { style: 'display:grid;gap:10px' }, [
        el('div', null, [sub('One-click in the mail app (Gmail / Yahoo / Apple), and a plain click on the footer link'), oneClick]),
        el('div', null, [sub('A reply that says "unsubscribe"'), reply]),
        el('div', null, [sub('Links in outreach emails sent before 25 Sep 2026 (the old loadboot.com/unsub.html link)'), legacy]),
      ]),
      el('div', { style: 'font-weight:700;margin:16px 0 4px' }, 'The preferences page'),
      offerAll.node, askReason.node, resub.node,
      el('div', { style: 'display:flex;justify-content:flex-end;margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        try {
          overview.settings = await unsubSettingsSet({ one_click_scope: oneClick.value, reply_scope: reply.value, legacy_link_scope: legacy.value, page_offer_all: offerAll.c.checked, ask_reason: askReason.c.checked, resubscribe_via_link: resub.c.checked });
          toast('Settings saved', 'success');
        } catch (e) { toast(humanizeError(e), 'error'); }
      } }, 'Save settings')),
      el('div', { style: 'font-weight:700;margin:18px 0 6px' }, 'Reasons offered on the page'),
      sub('Switching one off hides it from the page; history keeps it. Codes are permanent.', 'margin-bottom:6px'),
      reasonsBox,
      sub('Essential emails (account & security, billing notices, staff alerts) are never switchable, whatever is set here.', 'margin-top:14px'),
    ]);
    return d;
  }

  await loadOverview();
  await loadList();
  const wanted = qs().get('email');
  if (wanted) personDrawer(wanted.toLowerCase());
}
