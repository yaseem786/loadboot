// crm.js — Wave 1 CRM & Sales. Pipeline overview + leads + lead detail (stage move,
// activities, create). Reads/writes via cc_crm_* RPCs (crm.view/edit), all RBAC-gated
// + audited server-side; creating a lead emits a domain event into the Automation Core.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, searchBox, openDrawer, money, fmtDateTime, card } from '../../shared/ui/components.js';
import { crmOverview, crmListLeads, crmGetLead, crmCreateLead, crmSetLeadStage, crmAddActivity } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const STAGES = [
  { value: '', label: 'All' }, { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' }, { value: 'proposal', label: 'Proposal' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' },
];
const STAGE_TONE = { new: 'gray', contacted: 'blue', qualified: 'blue', proposal: 'amber', won: 'green', lost: 'red' };

export function renderCRM(host) {
  let state = { stage: '', search: '' };
  const kpiHost = el('div');
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await crmOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Open leads', value: String(n('leads_open')), sub: n('leads_total') + ' total', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Won', value: String(n('leads_won')), sub: 'closed deals', accent: 'green' }),
      statCard({ icon: 'building', label: 'Companies', value: String(n('companies')), sub: n('contacts') + ' contacts', accent: 'violet' }),
      statCard({ icon: 'users', label: 'Contacts', value: String(n('contacts')), sub: 'in CRM', accent: 'amber' }),
    ]));
  }

  function header() {
    const actions = can('crm.edit') ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openCreate }, '+ New lead')] : null;
    return el('div', null, [
      sectionHead('CRM & Sales', 'Leads, pipeline and follow-ups. New leads auto-create a sales task.', actions),
      kpiHost,
      toolbar([ searchBox('Search lead or company…', (v) => { state.search = v; loadLeads(); }), segmented(STAGES, state.stage, (v) => { state.stage = v; loadLeads(); }) ]),
    ]);
  }

  async function loadLeads() {
    showLoading(listHost, 'Loading leads…');
    let rows; try { rows = await crmListLeads({ stage: state.stage || null, search: state.search || null, limit: 300 }); }
    catch (e) { showError(listHost, humanizeError(e), loadLeads); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No leads yet. Create your first lead.'); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [ el('th', null, 'Lead'), el('th', null, 'Company'), el('th', null, 'Stage'), el('th', null, 'Source'), el('th', null, 'Value'), el('th', null, 'Status'), el('th', null, '') ])),
      el('tbody', null, rows.map(l => el('tr', { class: 'cc-row', onClick: () => openLead(l.id) }, [
        el('td', null, el('b', null, l.title)),
        el('td', null, l.company || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (STAGE_TONE[l.stage_key] || 'gray') }, l.stage_name || l.stage_key || '—')),
        el('td', null, l.source || '—'),
        el('td', null, l.value != null ? money(l.value) : '—'),
        el('td', null, statusPill(l.status)),
        el('td', null, el('span', { class: 'cc-row-go' }, '›')),
      ]))),
    ]));
  }

  function openCreate() {
    const f = {};
    const inp = (k, ph, type) => { const i = el('input', { class: 'cc-input', placeholder: ph, type: type || 'text' }); i.addEventListener('input', () => f[k] = i.value); return i; };
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.title) { err.textContent = 'Lead title is required.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Creating…';
      try { await crmCreateLead({ title: f.title, company: f.company || null, source: f.source || null, value: f.value ? Number(f.value) : null });
        toast('Lead created · follow-up task queued', 'success'); drawer.close(); loadLeads(); loadKpis();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Create lead'; }
    } }, 'Create lead');
    const drawer = openDrawer('New lead', el('div', { class: 'cc-form' }, [
      inp('title', 'Lead title (e.g. Acme Freight — 20 trucks)'),
      inp('company', 'Company name'),
      el('div', { class: 'cc-form-2' }, [inp('source', 'Source (website, referral…)'), inp('value', 'Value (USD)', 'number')]),
      err, submit,
    ]), { subtitle: 'Adds to the Sales pipeline (New)' });
  }

  async function openLead(id) {
    const { body } = openDrawer('Lead', el('div', { class: 'lb-state lb-loading' }, 'Loading…'), { subtitle: 'Pipeline, activities & actions' });
    let l; try { l = await crmGetLead(id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const field = (k, v) => el('div', { class: 'cc-field' }, [el('span', null, k), el('b', null, v || '—')]);

    const stageRow = el('div', { class: 'cc-status-row' });
    if (can('crm.edit')) {
      ['new','contacted','qualified','proposal','won','lost'].filter(s => s !== l.stage).forEach(s =>
        stageRow.appendChild(el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true;
          try { await crmSetLeadStage(id, s); toast('Stage → ' + s, 'success'); openLead(id); loadLeads(); loadKpis(); }
          catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; }
        } }, s)));
    }

    const acts = (l.activities || []);
    const actList = acts.length ? el('div', { class: 'cc-doclist' }, acts.map(a => el('div', { class: 'cc-doc-item' }, [
      el('div', null, [el('b', null, a.kind), el('div', { class: 'cc-sub' }, (a.body || '') + ' · ' + fmtDateTime(a.created_at))]),
    ]))) : el('div', { class: 'cc-sub' }, 'No activity yet.');

    const noteInput = el('input', { class: 'cc-input', placeholder: 'Log a call or note…' });
    const addRow = can('crm.edit') ? el('div', { class: 'cc-form-row' }, [ noteInput,
      el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (ev) => {
        if (!noteInput.value) return; const b = ev.currentTarget; b.disabled = true; b.textContent = '…';
        try { await crmAddActivity(id, 'call', noteInput.value); toast('Activity logged', 'success'); openLead(id); }
        catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; b.textContent = 'Log'; }
      } }, 'Log') ]) : '';

    mount(body, el('div', null, [
      el('div', { class: 'cc-drawer-title' }, [el('h3', null, l.title), statusPill(l.status)]),
      card([ field('Company', l.company), field('Stage', l.stage_name), field('Source', l.source), field('Value', l.value != null ? money(l.value) : '—'), field('Created', fmtDateTime(l.created_at)) ], 'cc-fields'),
      can('crm.edit') ? el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Move stage') : '',
      stageRow,
      el('h4', { class: 'cc-card-title', style: 'margin-top:16px' }, 'Activity'),
      addRow, actList,
    ]));
  }

  mount(host, el('div', { class: 'cc-view' }, [header(), listHost]));
  loadKpis(); loadLeads();
}

export default renderCRM;
