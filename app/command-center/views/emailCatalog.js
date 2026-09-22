// emailCatalog.js — ONE place for every email LoadBoot can send (bl_comm_0391-0394).
// Answers, per email: what it is, why it goes, who gets it, what fires it, how often,
// which address it leaves from, which preference group governs it, and where in the
// Command Center it lives. Also: live preview of the real body, override editor, and
// "+ New email" so a template can be written or pasted in without a migration.
// Staff-gated: read = comm.view, write = comm.manage (app_private.can_manage_comms).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime } from '../../shared/ui/components.js';
import { emailCatalog, emailDetail, emailOverrideSave, emailPreview, emailTemplateNew } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const CLASS_TONE = { T: 'blue', O: 'amber', P: 'gray', M: 'orange', S: 'gray', unclassified: 'red' };
const CLASS_HELP = {
  T: 'Transactional — the person asked for it or the law expects it. No opt-out.',
  O: 'Operational — work related, but the person should be able to turn it down.',
  P: 'Lifecycle — nudges and invites. Opt-out required.',
  M: 'Marketing — consent required, unsubscribe in every send.',
  S: 'Staff alert — never leaves LoadBoot.',
  unclassified: 'Not classified yet. It is sending without a catalog entry.',
};
const STATUS_TONE = { live: 'green', planned: 'blue', legacy: 'amber', retired: 'gray', dead: 'red', test: 'gray', undocumented: 'red', dynamic: 'gray' };
const STATUSES = [['', 'All'], ['live', 'Live'], ['planned', 'Planned'], ['legacy', 'Legacy'], ['retired', 'Retired'], ['undocumented', 'Undocumented'], ['test', 'Test']];
const CLASSES = ['', 'T', 'O', 'P', 'M', 'S'];

export function renderEmailCatalog(host) {
  const manage = can('comm.manage') || can('settings.manage');
  let rows = [], groups = [], statusFilter = 'live', classFilter = '', q = '';

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const listBox = el('div');
  const search = el('input', { class: 'cc-input', placeholder: 'Search key, name, purpose or the function that sends it…', style: 'max-width:420px', onInput: (e) => { q = e.currentTarget.value.trim(); draw(); } });
  const statusBar = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    STATUSES.map(([v, l]) => el('button', { class: 'cc-chip-btn' + (v === statusFilter ? ' on' : ''), onClick: () => { statusFilter = v; paintChips(); draw(); } }, l)));
  const classBar = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
    [['', 'Every class'], ['T', 'Transactional'], ['O', 'Operational'], ['P', 'Lifecycle'], ['M', 'Marketing'], ['S', 'Staff']]
      .map(([v, l]) => el('button', { class: 'cc-chip-btn' + (v === classFilter ? ' on' : ''), onClick: () => { classFilter = v; paintChips(); draw(); } }, l)));

  function paintChips() {
    [...statusBar.children].forEach((b, i) => b.classList.toggle('on', STATUSES[i][0] === statusFilter));
    [...classBar.children].forEach((b, i) => b.classList.toggle('on', CLASSES[i] === classFilter));
  }

  const newBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => newEmailForm() }, '+ New email') : null;
  mount(host, el('div', null, [
    sectionHead('Email catalog',
      'Every email LoadBoot can send, in one list: why it goes out, who gets it, what fires it, how often it can repeat, and which address it comes from. The catalog re-scans the code and the delivery log, so anything new that starts sending shows up here as Undocumented instead of going unnoticed.',
      newBtn),
    kpis,
    el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0' }, [search, statusBar, classBar]),
    listBox,
  ]));
  load();

  async function load() {
    showLoading(listBox, 'Reading the catalog…');
    try {
      const res = await emailCatalog(null, null);
      rows = (res && res.rows) || []; groups = (res && res.groups) || [];
      const s = (res && res.summary) || {};
      mount(kpis, el('div', { class: 'cc-kpi-grid' }, [
        statCard('Live', String(s.live || 0), 'sending today'),
        statCard('Planned', String(s.planned || 0), 'built, not wired'),
        statCard('Retired', String((s.retired || 0) + (s.legacy || 0)), 'superseded or hand-sent'),
        statCard('Undocumented', String(s.undocumented || 0), s.undocumented ? 'sending without an entry' : 'nothing unaccounted for'),
      ]));
      draw();
      const deep = (location.hash || '').split('/')[2];
      if (deep) openDetail(decodeURIComponent(deep));
    } catch (e) { showError(listBox, humanizeError(e)); }
  }

  function visible() {
    const needle = q.toLowerCase();
    return rows.filter((r) => (!statusFilter || r.status === statusFilter)
      && (!classFilter || r.class === classFilter)
      && (!needle || [r.key, r.name, r.purpose, r.trigger_source].some((f) => String(f || '').toLowerCase().includes(needle))));
  }

  function draw() {
    const list = visible();
    if (!list.length) { mount(listBox, el('div', { class: 'cc-empty' }, 'Nothing matches that filter.')); return; }
    const byGroup = new Map();
    list.forEach((r) => { const k = r.group_label || 'Ungrouped'; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(r); });
    mount(listBox, el('div', null, [...byGroup.entries()].map(([label, items]) => el('div', { style: 'margin-bottom:22px' }, [
      el('div', { class: 'cc-card-head', style: 'margin-bottom:6px' }, [
        el('h4', { class: 'cc-card-title' }, label),
        el('span', { class: 'cc-sub' }, items.length + ' email' + (items.length === 1 ? '' : 's')),
      ]),
      el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, ['Email', 'Who gets it', 'What fires it', 'How often', 'Sends from', '30d', ''].map((h) => el('th', null, h)))),
        el('tbody', null, items.map(rowEl)),
      ])),
    ]))));
  }

  function rowEl(r) {
    return el('tr', { style: 'cursor:pointer', onClick: () => openDetail(r.key) }, [
      el('td', null, [
        el('div', { style: 'font-weight:600' }, r.name || r.key),
        el('div', { class: 'cc-sub', style: 'font-family:ui-monospace,monospace;font-size:11px' }, r.key),
        el('div', { class: 'cc-sub' }, r.purpose || ''),
      ]),
      el('td', null, [
        el('div', null, r.audience_role || '—'),
        el('span', { class: 'cc-pill cc-pill-' + (CLASS_TONE[r.class] || 'gray'), title: CLASS_HELP[r.class] || '' }, r.class_label || r.class),
      ]),
      el('td', null, [
        el('div', null, r.trigger_type || '—'),
        el('div', { class: 'cc-sub', style: 'font-family:ui-monospace,monospace;font-size:11px' }, r.trigger_source || ''),
      ]),
      el('td', null, [
        el('div', null, r.cadence || '—'),
        el('div', { class: 'cc-sub' }, r.cap_note || (r.unsub_allowed ? 'unsubscribe allowed' : 'no opt-out')),
      ]),
      el('td', null, [
        el('div', { style: 'font-size:12px' }, r.from_address || '—'),
        el('div', { class: 'cc-sub' }, r.sender || ''),
      ]),
      el('td', null, String(r.sends_30d || 0)),
      el('td', null, el('span', { class: 'cc-pill cc-pill-' + (STATUS_TONE[r.status] || 'gray') }, r.status)),
    ]);
  }

  async function openDetail(key) {
    const box = el('div', { class: 'cc-modal-body' }, el('div', { class: 'cc-sub' }, 'Loading…'));
    const close = openModal('Email · ' + key, box);
    let d;
    try { d = await emailDetail(key); } catch (e) { mount(box, el('div', { class: 'cc-error' }, humanizeError(e))); return; }
    const r = d.row || {};
    const frame = el('iframe', { style: 'width:100%;height:420px;border:1px solid var(--cc-border,#1e293b);border-radius:10px;background:#fff' });
    const subjIn = el('input', { class: 'cc-input', value: r.subject_override || '', placeholder: 'Subject override (leave blank to keep the one the code builds)' });
    const htmlIn = el('textarea', { class: 'cc-input', rows: '12', style: 'font-family:ui-monospace,monospace;font-size:12px', placeholder: 'HTML override. Use {{BODY}} where the dynamic part should go.' }, r.html_override || '');
    const activeIn = el('input', { type: 'checkbox', checked: !!r.override_active });

    async function paint(draftSubject, draftHtml) {
      try {
        const p = await emailPreview(key, draftSubject || null, draftHtml || null);
        frame.srcdoc = '<!doctype html><meta charset="utf-8"><div style="font:14px/1.6 system-ui;padding:18px;max-width:640px;margin:0 auto">'
          + '<div style="border-bottom:1px solid #e2e8f0;padding-bottom:10px;margin-bottom:14px;color:#475569;font-size:12px">'
          + '<div><b>From:</b> ' + esc(p.from || '') + '</div><div><b>Subject:</b> ' + esc(p.subject || '') + '</div></div>'
          + (p.html || '') + '</div>';
      } catch (e) { frame.srcdoc = '<pre>' + esc(humanizeError(e)) + '</pre>'; }
    }
    paint();

    const meta = (label, value, hint) => el('div', { style: 'margin-bottom:8px' }, [
      el('div', { class: 'cc-sub', style: 'text-transform:uppercase;font-size:10px;letter-spacing:.06em' }, label),
      el('div', null, value || '—'),
      hint ? el('div', { class: 'cc-sub' }, hint) : null,
    ]);

    mount(box, el('div', null, [
      el('div', { class: 'cc-two-col', style: 'display:grid;grid-template-columns:1fr 1fr;gap:18px' }, [
        el('div', null, [
          meta('What it is', r.name, r.purpose),
          meta('Class', CLASS_HELP[r.class] || r.class),
          meta('Who gets it', r.audience_role),
          meta('What fires it', (r.trigger_type || '') + ' · ' + (r.trigger_source || '')),
          meta('How often', r.cadence, r.cap_note),
          meta('Stops when', r.stop_condition),
          meta('Preference group', r.preference_group, r.unsub_allowed ? 'Unsubscribe link is carried.' : 'No unsubscribe link — operational or account-critical.'),
          meta('Sends from', r.from_address),
          meta('Status', r.status + (r.replaced_by ? ' → replaced by ' + r.replaced_by : '')),
          meta('Seen in', (r.discovered_in || []).join(', ')),
          meta('Volume', (r.sends_total || 0) + ' all time · ' + (r.sends_30d || 0) + ' in 30 days',
            r.last_seen ? 'last sent ' + fmtDateTime(r.last_seen) : 'never sent'),
          r.cc_deep_link ? el('a', { class: 'lb-btn lb-btn-sm', href: r.cc_deep_link }, 'Open where it lives') : null,
        ]),
        el('div', null, [
          el('div', { class: 'cc-sub', style: 'margin-bottom:6px' },
            d.sample ? 'Live preview — the last real body sent under this key, on ' + fmtDateTime(d.sample.sent_at) + '.'
              : 'This key has never sent, so there is no real body to show yet.'),
          frame,
        ]),
      ]),
      manage ? el('div', { style: 'margin-top:18px' }, [
        el('h4', { class: 'cc-card-title' }, 'Rewrite this email'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:8px' },
          'Most of these bodies are built inside a database function. An override replaces the wrapper and the copy; put {{BODY}} where the generated part (names, amounts, links) should be dropped in, or it will be lost.'),
        subjIn, htmlIn,
        el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, [activeIn, el('span', null, 'Use this override for real sends')]),
        el('div', { style: 'display:flex;gap:8px' }, [
          el('button', { class: 'lb-btn lb-btn-sm', onClick: () => paint(subjIn.value, htmlIn.value) }, 'Preview draft'),
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: saveOverride }, 'Save override'),
        ]),
      ]) : null,
      el('div', { style: 'margin-top:18px' }, [
        el('h4', { class: 'cc-card-title' }, 'Last 10 sends'),
        el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table cc-table-tight' }, [
          el('thead', null, el('tr', null, ['To', 'Status', 'When', 'Opened', 'Clicked'].map((h) => el('th', null, h)))),
          el('tbody', null, (d.recent || []).length
            ? d.recent.map((x) => el('tr', null, [
              el('td', null, x.to || '—'), el('td', null, x.status || '—'),
              el('td', null, fmtDateTime(x.at)),
              el('td', null, x.opened ? fmtDateTime(x.opened) : '—'),
              el('td', null, x.clicked ? fmtDateTime(x.clicked) : '—'),
            ]))
            : [el('tr', null, el('td', { colspan: '5' }, 'No sends recorded.'))]),
        ])),
      ]),
    ]));

    async function saveOverride() {
      try {
        const res = await emailOverrideSave(key, subjIn.value, htmlIn.value, activeIn.checked);
        toast(res && res.warning ? res.warning : 'Override saved.', res && res.warning ? 'info' : 'success');
        close(); load();
      } catch (e) { toast(humanizeError(e), 'error'); }
    }
  }

  function newEmailForm() {
    const keyIn = el('input', { class: 'cc-input', placeholder: 'key, e.g. billing.statement_monthly' });
    const nameIn = el('input', { class: 'cc-input', placeholder: 'Name shown in this list' });
    const subjIn = el('input', { class: 'cc-input', placeholder: 'Subject line' });
    const htmlIn = el('textarea', { class: 'cc-input', rows: '12', style: 'font-family:ui-monospace,monospace;font-size:12px', placeholder: 'HTML body — inner fragment only. delivery-worker adds the brand header and footer.' });
    const fileIn = el('input', {
      type: 'file', accept: '.html,.htm,.txt', onChange: async (e) => {
        const f = e.currentTarget.files && e.currentTarget.files[0]; if (!f) return;
        htmlIn.value = await f.text(); toast('Loaded ' + f.name + '.', 'success');
      },
    });
    const classIn = el('select', { class: 'cc-input' }, [['T', 'Transactional'], ['O', 'Operational'], ['P', 'Lifecycle'], ['M', 'Marketing']].map(([v, l]) => el('option', { value: v }, l)));
    const groupIn = el('select', { class: 'cc-input' }, groups.map((g) => el('option', { value: g.code }, g.label)));
    const audIn = el('input', { class: 'cc-input', value: 'carrier', placeholder: 'who gets it — carrier, broker, dispatcher…' });
    const box = el('div', { class: 'cc-modal-body' }, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:10px' }, 'This writes a real, sendable template and files it in the catalog at the same time, so it can never become an email nobody knows about.'),
      keyIn, nameIn, audIn, classIn, groupIn, subjIn,
      el('div', { style: 'margin:8px 0' }, fileIn), htmlIn,
      el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', style: 'margin-top:10px', onClick: save }, 'Create email'),
    ]);
    const close = openModal('New email', box);
    async function save() {
      try {
        await emailTemplateNew({
          p_key: keyIn.value.trim(), p_name: nameIn.value.trim(), p_subject: subjIn.value,
          p_html: htmlIn.value, p_class: classIn.value, p_group: groupIn.value,
          p_audience: audIn.value.trim(), p_purpose: null,
        });
        toast('Created.', 'success'); close(); load();
      } catch (e) { toast(humanizeError(e), 'error'); }
    }
  }
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openModal(title, body) {
  const close = () => { try { document.body.removeChild(wrap); } catch (_) { /* already gone */ } };
  const wrap = el('div', { class: 'cc-modal-wrap', style: 'position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px;overflow:auto' },
    el('div', { class: 'cc-modal', style: 'background:var(--cc-panel,#0b1526);border:1px solid var(--cc-border,#1e293b);border-radius:14px;max-width:1080px;width:100%;padding:18px' }, [
      el('div', { class: 'cc-card-head' }, [
        el('h3', { class: 'cc-card-title' }, title),
        el('button', { class: 'lb-btn lb-btn-sm', onClick: close }, 'Close'),
      ]),
      body,
    ]));
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  return close;
}
