// automationsAdmin.js — Control Tower Wave F: Automations management.
// Lists every automation rule (trigger → action), shows which need human approval, and
// lets an owner enable/disable a rule. Read via cc_list_rules (staff); toggling requires
// flags.manage and is audited. This complements the Automation task-queue view.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, fmtDate } from '../../shared/ui/components.js';
import { listRules, setRuleEnabled, runComplianceExpirySweep, runStaleBookreqSweep } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderAutomationsAdmin(host) {
  let rows = [];
  const manage = can('flags.manage');
  function manualCard(title, desc, run, summarize) {
    const out = el('div', { class: 'cc-sub', style: 'margin-top:8px;min-height:18px' });
    const btn = el('button', { class: 'lb-btn lb-btn-primary' }, 'Run now');
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Running…'; out.textContent = '';
      try { const r = await run(); out.style.color = '#16a34a'; out.textContent = '✓ ' + summarize(r); }
      catch (e) { out.style.color = '#dc2626'; out.textContent = humanizeError(e); }
      btn.disabled = false; btn.textContent = 'Run now';
    };
    return card([el('h4', { class: 'cc-card-title' }, title), el('p', { class: 'cc-sub' }, desc), btn, out], 'lb-card');
  }
  const manualSection = el('div', { style: 'margin-top:20px' }, [
    el('h3', { class: 'cc-card-title' }, 'On-demand automations'),
    el('div', { class: 'cc-sub', style: 'margin-bottom:10px' }, 'Run a maintenance sweep now. Each is idempotent, notifies the affected party and is audited — and can be moved onto a server schedule later.'),
    el('div', { class: 'cc-grid-2' }, [
      manualCard('Compliance expiry sweep', 'Auto-warn carriers whose documents are expiring within 30 days or already expired (skips anyone warned in the last 14 days).', () => runComplianceExpirySweep(30), (r) => 'Warned ' + (r.warned || 0) + ' of ' + (r.scanned || 0) + ' scanned · ' + (r.skipped || 0) + ' recently warned'),
      manualCard('Stale booking-request sweep', 'Auto-expire booking requests pending more than 5 days and notify the carriers.', () => runStaleBookreqSweep(5), (r) => 'Expired ' + (r.expired || 0) + ' of ' + (r.scanned || 0) + ' stale'),
    ]),
  ]);
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Automations', 'Every rule that turns a system event into a task or notification. High-risk actions wait for human approval.'),
    el('div', { id: 'au-kpis' }),
    el('div', { id: 'au-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading rules…')),
    manualSection,
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
