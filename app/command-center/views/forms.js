// forms.js — Control Tower Wave A: Forms inbox -> CRM leads.
// Website contact/quote submissions land here (via the public submit_web_form beacon),
// spam-filtered by honeypot + heuristics. Staff triage, assign, and convert a submission
// into a CRM lead in one click (which also fires the sales follow-up automation).
// Reads/writes via cc_forms_* RPCs (forms.view / forms.manage), RBAC-gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, searchBox, segmented, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { formsOverview, listForms, getForm, convertFormToLead, setFormStatus } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const COLS = [
  { key: 'created_at', label: 'Received', fmt: fmtDateTime },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'company', label: 'Company' },
  { key: 'source_page', label: 'Page' },
  { key: 'status', label: 'Status' },
];

export function renderForms(host) {
  let status = null, search = null, rows = [];
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Forms inbox', 'Website enquiries and quote requests — triage, assign, and convert to CRM leads. Spam is auto-filtered.',
      el('div', { class: 'cc-head-actions', id: 'fm-export' })),
    el('div', { id: 'fm-kpis' }),
    el('div', { class: 'cc-toolbar', id: 'fm-tools' }),
    el('div', { id: 'fm-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading forms…')),
  ]));
  const kpiHost = host.querySelector('#fm-kpis');
  const toolsHost = host.querySelector('#fm-tools');
  const exportHost = host.querySelector('#fm-export');
  const body = host.querySelector('#fm-body');

  mount(exportHost, el('div', { class: 'cc-seg' }, [
    el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-forms', COLS, rows) }, 'CSV'),
    el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-forms', COLS, rows, 'Forms') }, 'Excel'),
    el('button', { class: 'cc-seg-btn', onClick: () => printTable('Forms inbox', 'LoadBoot · website enquiries', COLS, rows) }, 'PDF'),
  ]));

  mount(toolsHost, [
    segmented([
      { value: null, label: 'All' }, { value: 'new', label: 'New' }, { value: 'assigned', label: 'Assigned' },
      { value: 'converted', label: 'Converted' }, { value: 'spam', label: 'Spam' }, { value: 'closed', label: 'Closed' },
    ], status, (v) => { status = v; load(); }),
    searchBox('Search name, email, company…', (q) => { search = q || null; load(); }),
  ]);

  loadKpis();
  load();

  async function loadKpis() {
    let ov;
    try { ov = await formsOverview(); } catch (_) { return; }
    const n = (k) => Number((ov && ov[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'bell', label: 'New', value: String(n('new')), sub: 'awaiting triage', accent: 'blue' }),
      statCard({ icon: 'users', label: 'Assigned', value: String(n('assigned')), sub: 'in progress', accent: 'amber' }),
      statCard({ icon: 'trend', label: 'Converted', value: String(n('converted')), sub: 'became leads', accent: 'green' }),
      statCard({ icon: 'doc', label: 'Today', value: String(n('today')), sub: n('spam') + ' spam blocked', accent: 'violet' }),
    ]));
  }

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading forms…'));
    try { rows = await listForms({ status, search }); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    if (!rows || !rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No submissions match this filter.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Received'), el('th', null, 'Name'), el('th', null, 'Email'), el('th', null, 'Company'), el('th', null, 'Page'), el('th', null, 'Status')])),
      el('tbody', null, rows.map(f => el('tr', { class: 'cc-row-click', onClick: () => openForm(f.id) }, [
        el('td', null, fmtDateTime(f.created_at)),
        el('td', null, el('b', null, f.name || '—')),
        el('td', null, f.email || '—'),
        el('td', null, f.company || '—'),
        el('td', null, f.source_page || '—'),
        el('td', null, statusPill(f.status)),
      ]))),
    ])));
  }

  async function openForm(id) {
    let f;
    try { f = await getForm(id); } catch (e) { alert(humanizeError(e)); return; }
    const canManage = can('forms.manage');
    const canConvert = canManage && can('crm.edit');
    const actions = el('div', { class: 'cc-drawer-actions' });
    if (canConvert && f.status !== 'converted') {
      actions.appendChild(el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        try { await convertFormToLead(id); } catch (e) { alert(humanizeError(e)); return; }
        document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load();
      } }, 'Convert to CRM lead'));
    }
    if (canManage) {
      const setS = async (s) => { try { await setFormStatus(id, s); } catch (e) { alert(humanizeError(e)); return; } document.getElementById('cc-drawer-root')?.remove(); loadKpis(); load(); };
      if (f.status !== 'assigned') actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS('assigned') }, 'Mark assigned'));
      if (f.status !== 'closed') actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS('closed') }, 'Close'));
      if (f.status !== 'spam') actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => setS('spam') }, 'Mark spam'));
    }
    openDrawer(f.name || f.email || 'Submission', el('div', null, [
      kv('Status', f.status), kv('Received', fmtDateTime(f.created_at)),
      kv('Email', f.email || '—'), kv('Phone', f.phone || '—'), kv('Company', f.company || '—'),
      kv('Form', f.form_key || 'contact'), kv('Page', f.source_page || '—'),
      kv('Source', f.utm_source || 'website'), kv('Spam score', String(f.spam_score ?? 0)),
      f.lead_id ? kv('Linked lead', f.lead_id) : '',
      el('div', { class: 'cc-kv', style: 'align-items:flex-start' }, [el('span', { class: 'cc-kv-k' }, 'Message'), el('span', { class: 'cc-kv-v', style: 'white-space:pre-wrap' }, f.message || '—')]),
      actions.childNodes.length ? el('div', { style: 'margin-top:14px' }, actions) : '',
    ]), { subtitle: 'Form submission' });
  }
}

function kv(k, v) {
  return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v)]);
}

export default renderForms;
