// automationsAdmin.js — Control Tower Wave F: Automations management.
// Lists every automation rule (trigger → action), shows which need human approval, and
// lets an owner enable/disable a rule. Read via cc_list_rules (staff); toggling requires
// flags.manage and is audited. This complements the Automation task-queue view.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, fmtDate } from '../../shared/ui/components.js';
import { listRules, setRuleEnabled } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderAutomationsAdmin(host) {
  let rows = [];
  const manage = can('flags.manage');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Automations', 'Every rule that turns a system event into a task or notification. High-risk actions wait for human approval.'),
    el('div', { id: 'au-kpis' }),
    el('div', { id: 'au-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading rules…')),
  ]));
  const kpiHost = host.querySelector('#au-kpis');
  const body = host.querySelector('#au-body');
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading rules…'));
    try { rows = await listRules(); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const enabled = rows.filter(r => r.enabled).length;
    const approvals = rows.filter(r => r.requires_approval).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'refresh', label: 'Rules', value: String(rows.length), sub: 'configured', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Enabled', value: String(enabled), sub: (rows.length - enabled) + ' off', accent: 'green' }),
      statCard({ icon: 'shield', label: 'Human-gated', value: String(approvals), sub: 'require approval', accent: 'amber' }),
      statCard({ icon: 'grid', label: 'Triggers', value: String(new Set(rows.map(r => r.trigger_event)).size), sub: 'distinct events', accent: 'violet' }),
    ]));
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No automation rules configured.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Rule'), el('th', null, 'Trigger'), el('th', null, 'Action'), el('th', null, 'Approval'), el('th', null, 'Since'), el('th', null, 'Enabled')])),
      el('tbody', null, rows.map(r => el('tr', null, [
        el('td', null, [el('b', null, r.name), el('div', { class: 'cc-sub' }, r.key)]),
        el('td', null, el('code', { class: 'cc-code' }, r.trigger_event)),
        el('td', null, r.action_type),
        el('td', null, r.requires_approval ? statusPill('pending') : el('span', { class: 'cc-sub' }, 'auto')),
        el('td', null, fmtDate(r.created_at)),
        el('td', null, manage
          ? el('button', { class: 'cc-toggle' + (r.enabled ? ' on' : ''), onClick: async () => { try { await setRuleEnabled(r.key, !r.enabled); } catch (e) { alert(humanizeError(e)); return; } load(); } }, r.enabled ? 'On' : 'Off')
          : statusPill(r.enabled ? 'active' : 'paused')),
      ]))),
    ])));
  }
}

export default renderAutomationsAdmin;
