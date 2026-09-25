// Email catalog — every email LoadBoot can send, in one screen.
// bl_comm_0391..0396. Rebuilt 22 Sep 2026: the first cut passed positional args to
// statCard() (which takes an object), so the KPI row rendered String.prototype.sub,
// and the detail/new-email panels used .cc-modal-* classes that no loaded stylesheet
// defines, which is why they came out dark-on-dark. This version uses only the shared
// CC helpers, so it follows the theme like every other screen.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, statCard, searchBox, segmented, openDrawer, fmtDateTime, ago } from '../../shared/ui/components.js';
import { toast, humanizeError } from '../../shared/errors.js';
import { showLoading, showError } from '../../shared/loading.js';
import { can } from '../../shared/permissions.js';
import {
  emailCatalog, emailDetail, emailSave, emailOverrideSave, emailPreview,
  emailTemplateNew, emailSends, emailMode,
} from '../../shared/api.js';

const CLASS_TONE = { T: 'blue', O: 'violet', P: 'amber', M: 'red', S: 'gray' };
const CLASS_WORD = { T: 'Transactional', O: 'Operational', P: 'Lifecycle', M: 'Marketing', S: 'Staff alert' };
const CLASS_MEANS = {
  T: 'The person asked for it, or the law expects it. No opt-out.',
  O: 'Part of getting work done. Opt-out allowed.',
  P: 'Lifecycle nudge. Opt-out allowed.',
  M: 'Marketing. Consent required, unsubscribe link always.',
  S: 'Internal — only LoadBoot staff ever see it.',
};
const STATUS_TONE = {
  live: 'green', delivered: 'green', sent: 'blue', queued: 'blue', claimed: 'blue',
  planned: 'violet', legacy: 'gray', retired: 'gray', dynamic: 'gray', test: 'gray',
  undocumented: 'red', bounced: 'red', complained: 'red', dead_letter: 'red',
  blocked: 'amber', unsubscribed: 'amber',
};

const pill = (label, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, String(label || '—'));
const statusPillOf = (s) => pill(String(s || 'unknown').replace(/_/g, ' '), STATUS_TONE[s] || 'gray');
const mono = (s, extra) => el('div', { class: 'cc-sub', style: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;' + (extra || '') }, s || '');
const num = (n) => Number(n || 0).toLocaleString();

// The switch, in plain words. 'live' is the normal state, so it is not shouted about.
const MODE = {
  live: { label: 'Live', tone: 'green', says: 'Goes to the real person.' },
  test: { label: 'Test only', tone: 'amber', says: 'Goes ONLY to the test address. The real recipient is written in the subject, so nobody outside LoadBoot is contacted.' },
  off:  { label: 'Switched off', tone: 'red', says: 'Goes to nobody. Every attempt is still written down, so you can see what would have been sent.' },
};

export async function renderEmailCatalog(host) {
  const manage = can('comm.manage') || can('settings.manage') || can('content.manage');
  let status = 'live', q = '';

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const filters = el('div', { class: 'cc-toolbar', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0 16px' });
  const listBox = el('div');

  const head = sectionHead(
    'Email catalog',
    'Every email LoadBoot can send, in one list: why it goes out, who gets it, what fires it, how often it can repeat, and which address it comes from. Open any email to see exactly who received it and what happened.',
    manage ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: () => newEmailDrawer(load) }, '+ New email')] : null,
  );

  mount(host, el('div', { class: 'cc-view' }, [head, kpis, filters, listBox]));

  const setStatus = (v) => { status = v; load(); };

  mount(filters, [
    searchBox('Search key, name, purpose or the function that sends it…', (v) => { q = v; load(); }),
    segmented([
      { value: '', label: 'All' },
      { value: 'live', label: 'Live' },
      { value: 'planned', label: 'Planned' },
      { value: 'legacy', label: 'Legacy' },
      { value: 'retired', label: 'Retired' },
      { value: 'undocumented', label: 'Needs a look' },
      { value: 'test', label: 'Test' },
    ], status, setStatus),
  ]);

  async function load() {
    showLoading(listBox, 'Loading the catalog…');
    let res;
    try { res = await emailCatalog(status || null, q || null); }
    catch (e) { showError(listBox, humanizeError(e), load); return; }

    const rows = res.rows || [];
    const groups = res.groups || [];
    const s = res.summary || {};

    mount(kpis, [
      statCard({ icon: 'mail', label: 'Live emails', value: num(s.live), sub: 'can send today', accent: 'green', onClick: () => setStatus('live') }),
      statCard({ icon: 'grid', label: 'Planned', value: num(s.planned), sub: 'written, not wired yet', accent: 'blue', onClick: () => setStatus('planned') }),
      statCard({ icon: 'alert', label: 'Needs a look', value: num(s.undocumented), sub: s.undocumented ? 'sending without an entry' : 'nothing unaccounted for', accent: s.undocumented ? 'red' : 'green', onClick: () => setStatus('undocumented') }),
      statCard({ icon: 'archive', label: 'Retired / legacy', value: num((s.retired || 0) + (s.legacy || 0)), sub: 'superseded or hand-sent', accent: 'amber', onClick: () => setStatus('retired') }),
    ]);

    if (!rows.length) {
      mount(listBox, el('div', { class: 'lb-card', style: 'padding:28px;text-align:center' }, [
        el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Nothing matches'),
        el('div', { class: 'cc-sub' }, q ? 'No email matches “' + q + '” in this status.' : 'No email in this status.'),
      ]));
      return;
    }

    const byGroup = new Map();
    rows.forEach(r => {
      const key = r.preference_group || 'ungrouped';
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(r);
    });
    const order = groups.map(g => g.code).concat(['ungrouped']);
    const sorted = [...byGroup.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));

    mount(listBox, sorted.map(code => {
      const g = groups.find(x => x.code === code);
      const items = byGroup.get(code);
      // UX audit CC3 (24 Sep 2026): 228 emails in 8 groups drew as one 21,000px page. Each group is a
      // <details>: folded on a phone (≤780px, the CC bar breakpoint), open on desktop. Search still
      // narrows every group; a group that is open stays open across reloads within the session.
      const phone = window.matchMedia('(max-width:780px)').matches;
      const openKey = 'cc-email-catalog:open:' + code;
      let wasOpen = null; try { wasOpen = sessionStorage.getItem(openKey); } catch (_) {}
      const isOpen = wasOpen != null ? wasOpen === '1' : !phone;
      const d = el('details', { class: 'cc-cat-group', style: 'margin:22px 0 10px', open: isOpen ? 'open' : null }, [
        el('summary', { style: 'cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px' }, [
          el('span', { class: 'cc-cat-caret', 'aria-hidden': 'true', style: 'font-size:.8rem;color:var(--lb-muted,#64748b)' }, isOpen ? '▾' : '▸'),
          el('h3', { style: 'margin:0;font-size:1rem' }, g ? g.label : 'Not grouped yet'),
          el('span', { class: 'cc-sub' }, items.length + ' email' + (items.length === 1 ? '' : 's')),
          g ? pill(g.opt_out_allowed ? 'opt-out allowed' : 'no opt-out', g.opt_out_allowed ? 'blue' : 'gray') : '',
        ]),
        g && g.description ? el('div', { class: 'cc-sub', style: 'margin:-4px 0 10px' }, g.description) : '',
        table(items),
      ]);
      d.addEventListener('toggle', () => {
        const c = d.querySelector('.cc-cat-caret'); if (c) c.textContent = d.open ? '▾' : '▸';
        try { sessionStorage.setItem(openKey, d.open ? '1' : '0'); } catch (_) {}
      });
      return d;
    }));
  }

  function table(items) {
    return el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Email'), el('th', null, 'Who gets it'), el('th', null, 'What fires it'),
        el('th', null, 'How often'), el('th', null, 'Sends from'),
        el('th', { style: 'text-align:right' }, '30 days'), el('th', null, 'Status'),
      ])),
      el('tbody', null, items.map(r => el('tr', {
        class: 'cc-row', style: 'cursor:pointer',
        onClick: () => detailDrawer(r.key, load),
      }, [
        el('td', null, [
          el('div', { style: 'font-weight:600' }, r.name || r.key),
          mono(r.key),
          r.purpose ? el('div', { class: 'cc-sub', style: 'max-width:42ch' }, r.purpose) : '',
        ]),
        el('td', null, [
          el('div', null, r.audience_role || '—'),
          pill(CLASS_WORD[r.class] || 'Unclassified', CLASS_TONE[r.class]),
        ]),
        el('td', null, [
          el('div', { class: 'cc-sub' }, r.trigger_type || '—'),
          mono(r.trigger_source || ''),
        ]),
        el('td', null, [
          el('div', null, r.cadence || '—'),
          el('div', { class: 'cc-sub' }, r.cap_note || (r.unsub_allowed ? 'unsubscribe allowed' : 'no opt-out')),
        ]),
        el('td', null, [
          el('div', null, r.sender || '—'),
          el('div', { class: 'cc-sub' }, r.from_address || ''),
        ]),
        el('td', { style: 'text-align:right;font-variant-numeric:tabular-nums' }, [
          el('div', { style: 'font-weight:700' }, num(r.sends_30d)),
          el('div', { class: 'cc-sub' }, r.sends_total ? num(r.sends_total) + ' all time' : 'never sent'),
        ]),
        el('td', null, [
          statusPillOf(r.status),
          (r.send_mode && r.send_mode !== 'live')
            ? pill(MODE[r.send_mode].label, MODE[r.send_mode].tone) : '',
          r.has_override ? el('div', { class: 'cc-sub' }, 'override on') : '',
        ]),
      ]))),
    ]));
  }

  load();
}

// ---------------------------------------------------------------- detail drawer

function fact(label, value, hint) {
  return el('div', { style: 'margin-bottom:14px' }, [
    el('div', { class: 'cc-sub', style: 'text-transform:uppercase;font-size:10px;letter-spacing:.06em' }, label),
    el('div', { style: 'font-weight:600;margin-top:2px' }, value == null || value === '' ? '—' : value),
    hint ? el('div', { class: 'cc-sub' }, hint) : '',
  ]);
}

async function detailDrawer(key, onSaved) {
  const body = el('div', null, el('div', { class: 'cc-sub' }, 'Loading…'));
  const drawer = openDrawer(key, body, { subtitle: 'Email · ' + key });
  let d;
  try { d = await emailDetail(key); }
  catch (e) { mount(body, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }

  const r = d.row || {};
  const manage = can('comm.manage') || can('settings.manage');
  const stats = el('div', { class: 'cc-kpi-grid', style: 'grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 16px' });
  const feedBox = el('div');
  const previewBox = el('div');

  mount(body, [
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' }, [
      pill(CLASS_WORD[r.class] || 'Unclassified', CLASS_TONE[r.class]),
      statusPillOf(r.status),
      pill(r.preference_group || 'no group', 'gray'),
      r.cc_deep_link ? el('a', { class: 'lb-btn lb-btn-secondary', href: r.cc_deep_link, style: 'margin-left:auto' }, 'Open where it lives →') : '',
    ]),
    el('div', { style: 'font-weight:700;font-size:1.05rem' }, r.name || key),
    el('div', { class: 'cc-sub', style: 'margin-bottom:16px' }, r.purpose || ''),
    manage ? modeSwitch(key, r, onSaved) : el('div', { class: 'lb-card', style: 'padding:12px;margin-bottom:16px' }, [
      el('div', { style: 'font-weight:600' }, 'Sending: ' + MODE[r.send_mode || 'live'].label),
      el('div', { class: 'cc-sub' }, MODE[r.send_mode || 'live'].says),
    ]),
    stats,
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 18px' }, [
      fact('Who gets it', r.audience_role),
      fact('What fires it', (r.trigger_type || '') + (r.trigger_source ? ' · ' + r.trigger_source : '')),
      fact('How often', r.cadence, r.cap_note),
      fact('Stops when', r.stop_condition),
      fact('Class', CLASS_WORD[r.class] || 'Unclassified', CLASS_MEANS[r.class]),
      fact('Sends from', d.from_address || d.sender, r.unsub_allowed ? 'Unsubscribe link included.' : 'No unsubscribe link — operational or account-critical.'),
      r.replaced_by ? fact('Replaced by', r.replaced_by) : '',
      fact('First / last send', (r.first_seen ? fmtDateTime(r.first_seen) : 'never') + ' → ' + (r.last_seen ? fmtDateTime(r.last_seen) : 'never')),
    ]),
    r.owner_note ? el('div', { class: 'lb-card', style: 'padding:12px;margin:6px 0 16px' }, [
      el('div', { class: 'cc-sub', style: 'text-transform:uppercase;font-size:10px' }, 'Note'),
      el('div', null, r.owner_note),
    ]) : '',
    el('h4', { style: 'margin:18px 0 8px' }, 'Who actually got it'),
    feedBox,
    el('h4', { style: 'margin:22px 0 8px' }, 'The real email'),
    previewBox,
    manage ? overrideEditor(key, r, onSaved) : '',
  ]);

  renderPreview(previewBox, d.sample, d.from_address || '');
  loadFeed(key, feedBox, stats);
}

function renderPreview(box, sample, from) {
  if (!sample || sample === null || !sample.html) {
    mount(box, el('div', { class: 'lb-card', style: 'padding:16px' }, [
      el('div', { class: 'cc-sub' }, 'This key has not sent yet, so there is no real body to show. It will appear here the first time it goes out.'),
    ]));
    return;
  }
  const frame = el('iframe', {
    sandbox: '', style: 'width:100%;height:420px;border:0;border-radius:12px;background:#fff',
    srcdoc: '<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#0f172a">' + sample.html + '</body>',
  });
  mount(box, el('div', { class: 'lb-card', style: 'padding:14px' }, [
    el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'From: ' + (from || '—')),
    el('div', { style: 'font-weight:600;margin-bottom:2px' }, 'Subject: ' + (sample.subject || '—')),
    el('div', { class: 'cc-sub', style: 'margin-bottom:10px' }, 'Last real send · ' + (sample.sent_at ? fmtDateTime(sample.sent_at) : '')),
    frame,
    el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'This is the inner fragment. The delivery worker wraps it in the brand shell before it leaves.'),
  ]));
}

// --------------------------------------------------------------- the live feed

function loadFeed(key, box, statsBox) {
  let status = '', q = '', offset = 0, timer = null;
  const rowsHost = el('div');
  const more = el('button', { class: 'lb-btn lb-btn-secondary', style: 'margin-top:10px', onClick: () => { offset += 50; go(true); } }, 'Load more');
  const stamp = el('span', { class: 'cc-sub' });

  const chips = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px' });
  const chip = (v, label) => el('button', {
    class: 'cc-chip-btn' + (status === v ? ' on' : ''),
    onClick: () => { status = v; offset = 0; chips.querySelectorAll('.cc-chip-btn').forEach(b => b.classList.remove('on')); go(); },
  }, label);

  mount(chips, [
    chip('', 'All'), chip('delivered', 'Delivered'), chip('sent', 'Sent'),
    chip('queued', 'Queued'), chip('bounced', 'Bounced'), chip('blocked', 'Blocked'),
    searchBox('name, company or address…', (v) => { q = v; offset = 0; go(); }),
    el('span', { style: 'margin-left:auto;display:flex;gap:8px;align-items:center' }, [
      stamp, el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => { offset = 0; go(); } }, 'Refresh'),
    ]),
  ]);

  mount(box, [chips, rowsHost, more]);

  async function go(append) {
    if (!append) showLoading(rowsHost, 'Loading the send history…');
    let res;
    try { res = await emailSends(key, { status: status || null, q: q || null, limit: 50, offset }); }
    catch (e) { showError(rowsHost, humanizeError(e), () => go()); return; }

    const st = res.stats || {};
    mount(statsBox, [
      statCard({ icon: 'mail', label: 'Sent', value: num(st.sent), sub: num(st.people) + ' people · ' + num(st.last_30d) + ' in 30 days', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Delivered', value: num(st.delivered), sub: st.bounced ? num(st.bounced) + ' bounced or complained' : 'no bounces', accent: st.bounced ? 'amber' : 'green' }),
      statCard({ icon: 'shield', label: 'Blocked', value: num(st.blocked), sub: st.blocked ? 'stopped by a preference' : 'nobody opted out', accent: st.blocked ? 'amber' : 'green' }),
    ]);
    stamp.textContent = 'as of ' + new Date(res.as_of || Date.now()).toLocaleTimeString();

    const rows = res.rows || [];
    more.style.display = (offset + rows.length) < (res.total || 0) ? '' : 'none';

    const table = el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [
        el('th', null, 'Who'), el('th', null, 'When'), el('th', null, 'What happened'), el('th', null, 'Subject'),
      ])),
      el('tbody', null, rows.length ? rows.map(feedRow) : [el('tr', null, el('td', { colspan: '4' },
        el('div', { class: 'cc-sub', style: 'padding:14px' }, 'No send matches this filter.')))]),
    ]));

    if (append) rowsHost.appendChild(table); else mount(rowsHost, table);

    if (st.open_tracking === false) {
      rowsHost.appendChild(el('div', { class: 'cc-sub', style: 'margin-top:8px' },
        'Opens and clicks are not tracked on this mail yet, so those columns would always read zero — they are left out rather than shown as nobody opened it.'));
    }

    clearTimeout(timer);
    timer = setTimeout(() => { if (document.getElementById('cc-drawer-root')) { offset = 0; go(); } }, 30000);
  }

  function feedRow(r) {
    const who = r.contact_name || r.company || r.org_name || '';
    return el('tr', { class: 'cc-row' }, [
      el('td', null, [
        el('div', { style: 'font-weight:600' }, who || r.email),
        mono(r.email),
        r.org_name ? el('div', { class: 'cc-sub' }, [
          r.deep_link ? el('a', { href: r.deep_link }, r.org_name + ' →') : r.org_name,
          r.org_kind ? ' · ' + r.org_kind : '',
        ]) : el('div', { class: 'cc-sub' }, 'no account on file'),
      ]),
      el('td', null, [
        el('div', null, fmtDateTime(r.at_ts)),
        el('div', { class: 'cc-sub' }, ago(r.at_ts)),
      ]),
      el('td', null, [
        statusPillOf(r.status),
        r.note ? el('div', { class: 'cc-sub', style: 'max-width:34ch' }, r.note) : '',
        r.kind === 'blocked' ? el('div', { class: 'cc-sub' }, 'never left the building') : '',
      ]),
      el('td', null, el('div', { class: 'cc-sub', style: 'max-width:40ch' }, r.subject || '—')),
    ]);
  }

  go();
}

// ------------------------------------------------------------ override editor

function overrideEditor(key, r, onSaved) {
  const subject = el('input', { class: 'cc-input', placeholder: 'Subject line (leave blank to keep the one the code builds)', value: r.subject_override || '' });
  const html = el('textarea', { class: 'cc-input', rows: '10', style: 'font-family:ui-monospace,monospace;font-size:12px', placeholder: 'HTML. Put {{BODY}} where the dynamic part (names, amounts, links) should go.' }, r.html_override || '');
  const active = el('input', { type: 'checkbox' });
  if (r.override_active) active.checked = true;

  const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
    try {
      const res = await emailOverrideSave(key, subject.value, html.value, active.checked);
      toast(res && res.warning ? res.warning : 'Override saved', res && res.warning ? 'info' : 'success');
      if (onSaved) onSaved();
    } catch (e) { toast(humanizeError(e), 'error'); }
  } }, 'Save override');

  const preview = el('button', { class: 'lb-btn lb-btn-secondary', onClick: async () => {
    try {
      const p = await emailPreview(key, subject.value, html.value);
      const box = el('div', null, [
        el('div', { class: 'cc-sub' }, 'From: ' + (p.from || '—')),
        el('div', { style: 'font-weight:600;margin-bottom:10px' }, 'Subject: ' + (p.subject || '—')),
        el('iframe', { sandbox: '', style: 'width:100%;height:60vh;border:0;border-radius:12px;background:#fff', srcdoc: p.html || '' }),
      ]);
      openDrawer('Preview · ' + key, box, { subtitle: 'Nothing is sent by previewing.' });
    } catch (e) { toast(humanizeError(e), 'error'); }
  } }, 'Preview');

  return el('details', { style: 'margin-top:22px' }, [
    el('summary', { style: 'cursor:pointer;font-weight:700' }, 'Rewrite this email'),
    el('div', { class: 'cc-sub', style: 'margin:6px 0 12px' },
      'This email is built inside the code. An override replaces the wording without touching the code — keep {{BODY}} where the dynamic part belongs, or it will be dropped.'),
    el('div', { style: 'display:grid;gap:10px' }, [
      subject, html,
      el('label', { style: 'display:flex;gap:8px;align-items:center' }, [active, el('span', null, 'Use this override for real sends')]),
      el('div', { style: 'display:flex;gap:8px' }, [save, preview]),
    ]),
  ]);
}

// --------------------------------------------------------------- new email

function newEmailDrawer(onDone) {
  const key = el('input', { class: 'cc-input', placeholder: 'key — e.g. billing.statement_monthly' });
  const name = el('input', { class: 'cc-input', placeholder: 'Name shown in this list' });
  const subject = el('input', { class: 'cc-input', placeholder: 'Subject line' });
  const purpose = el('input', { class: 'cc-input', placeholder: 'One line: why this email exists' });
  const audience = select([['carrier', 'Carrier'], ['broker', 'Broker'], ['shipper', 'Shipper'], ['dispatcher', 'Dispatcher'], ['agent', 'Agent'], ['driver', 'Driver'], ['lead', 'Lead'], ['staff', 'Staff']]);
  const klass = select([['T', 'Transactional — no opt-out'], ['O', 'Operational — opt-out allowed'], ['P', 'Lifecycle — opt-out allowed'], ['M', 'Marketing — consent required'], ['S', 'Staff alert']]);
  const group = select([['account_critical', 'Account & security'], ['load_ops', 'Loads & trips'], ['compliance', 'Documents & compliance'], ['billing', 'Billing & payouts'], ['digests', 'Summaries'], ['product_announcements', 'Product news'], ['marketing', 'Marketing'], ['staff_internal', 'Internal (staff)']]);
  const html = el('textarea', { class: 'cc-input', rows: '12', style: 'font-family:ui-monospace,monospace;font-size:12px', placeholder: 'HTML body' });
  const file = el('input', { type: 'file', accept: '.html,.htm,.txt' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0]; if (!f) return;
    html.value = await f.text(); toast('Loaded ' + f.name, 'success');
  });

  const field = (label, node, hint) => el('div', { style: 'margin-bottom:12px' }, [
    el('label', { style: 'display:block;font-weight:600;font-size:.85rem;margin-bottom:4px' }, label),
    node, hint ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, hint) : '',
  ]);

  const create = el('button', { class: 'lb-btn lb-btn-primary' }, 'Create email');
  const body = el('div', null, [
    el('div', { class: 'cc-sub', style: 'margin-bottom:14px' },
      'This writes a real, sendable template and files it in the catalog at the same time, so it can never become an email nobody knows about.'),
    field('Key', key, 'lower case, area.thing — this is what the code and the log will call it'),
    field('Name', name),
    field('Purpose', purpose),
    field('Who gets it', audience),
    field('Class', klass),
    field('Preference group', group, 'Decides whether someone can opt out of it'),
    field('Subject', subject),
    field('Body', html),
    field('…or upload an .html file', file),
    el('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [create]),
  ]);

  const drawer = openDrawer('New email', body, { subtitle: 'Goes into comm_templates and the catalog together' });

  create.addEventListener('click', async () => {
    if (!key.value.trim() || !name.value.trim() || !html.value.trim()) { toast('Key, name and body are required', 'error'); return; }
    create.disabled = true;
    try {
      await emailTemplateNew({
        p_key: key.value.trim(), p_name: name.value.trim(), p_subject: subject.value.trim(),
        p_html: html.value, p_class: klass.value, p_group: group.value,
        p_audience: audience.value, p_purpose: purpose.value.trim() || null,
      });
      toast('Email created and filed in the catalog', 'success');
      drawer.close(); if (onDone) onDone();
    } catch (e) { toast(humanizeError(e), 'error'); create.disabled = false; }
  });
}

function select(pairs) {
  return el('select', { class: 'cc-input' }, pairs.map(([v, label]) => el('option', { value: v }, label)));
}

// ------------------------------------------------------- the Live / Test / Off switch

function modeSwitch(key, r, onSaved) {
  let mode = r.send_mode || 'live';
  const testTo = el('input', { class: 'cc-input', placeholder: 'test address (blank = the default test inbox)', value: r.test_to || '' });
  const says = el('div', { class: 'cc-sub', style: 'margin-top:8px' }, MODE[mode].says);
  const testRow = el('div', { style: 'margin-top:10px;display:' + (mode === 'test' ? 'block' : 'none') }, [
    el('label', { style: 'display:block;font-weight:600;font-size:.85rem;margin-bottom:4px' }, 'Send the test copy to'),
    testTo,
  ]);
  const buttons = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' });

  const paint = () => {
    buttons.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    says.textContent = MODE[mode].says;
    testRow.style.display = mode === 'test' ? 'block' : 'none';
  };

  const set = async (v) => {
    const was = mode; mode = v; paint();
    try {
      await emailMode(key, v, testTo.value, null);
      toast(v === 'live' ? 'Now sending to real recipients' : v === 'test' ? 'Test only — nobody outside LoadBoot will get it' : 'Switched off', 'success');
      if (onSaved) onSaved();
    } catch (e) { mode = was; paint(); toast(humanizeError(e), 'error'); }
  };

  ['live', 'test', 'off'].forEach(v => buttons.appendChild(
    el('button', { class: 'cc-chip-btn', dataset: { mode: v }, onClick: () => set(v) }, MODE[v].label)));
  testTo.addEventListener('change', () => { if (mode === 'test') set('test'); });
  paint();

  return el('div', { class: 'lb-card', style: 'padding:14px;margin-bottom:16px' }, [
    el('div', { style: 'font-weight:700;margin-bottom:8px' }, 'Who is this email reaching right now?'),
    buttons, says, testRow,
    r.send_mode_note ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, r.send_mode_note) : '',
  ]);
}
