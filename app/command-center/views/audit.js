// audit.js — Audit viewer (functional in 2A). Reads via get_audit_logs (audit.view).
import { el, mount } from '../../shared/ui/dom.js';
import { getAuditLogs } from '../../shared/api.js';
import { showLoading, showError, showEmpty } from '../../shared/loading.js';
import { humanizeError } from '../../shared/errors.js';

const ACTIONS = ['', 'document.review', 'carrier.status_change', 'role.assign', 'role.revoke',
  'staff.status', 'staff.session_revoke_requested', 'feature_flag.set', 'setting.set'];

function fmtTime(ts) {
  try { return new Date(ts).toLocaleString(); } catch (_) { return ts; }
}

export async function renderAudit(host) {
  const filter = el('select', null, ACTIONS.map(a =>
    el('option', { value: a }, a || 'All actions')));
  const body = el('div');
  const head = el('div', { class: 'cc-section-head' }, [
    el('div', null, [el('h2', null, 'Audit log'),
      el('p', null, 'Append-only record of privileged actions. Newest first.')]),
  ]);
  const toolbar = el('div', { class: 'cc-toolbar' }, [el('label', null, 'Filter: '), filter]);
  mount(host, el('div', null, [head, toolbar, body]));

  async function load() {
    showLoading(body, 'Loading audit log…');
    try {
      const rows = await getAuditLogs({ limit: 100, action: filter.value || null });
      if (!rows || !rows.length) { showEmpty(body, 'No audit entries match this filter yet.'); return; }
      const table = el('table', { class: 'lb-table' }, [
        el('thead', null, el('tr', null, [
          el('th', null, 'When'), el('th', null, 'Action'), el('th', null, 'Target'),
          el('th', null, 'Summary'), el('th', null, 'Actor'),
        ])),
        el('tbody', null, rows.map(r => el('tr', null, [
          el('td', null, fmtTime(r.occurred_at)),
          el('td', null, el('span', { class: 'lb-badge lb-badge-gray' }, r.action)),
          el('td', null, [r.target_type || '—', r.target_id ? el('div', { class: 'cc-audit-detail' }, r.target_id) : '']),
          el('td', null, r.summary || '—'),
          el('td', null, r.actor_is_staff ? 'staff' : (r.actor_id ? 'user' : 'system')),
        ]))),
      ]);
      mount(body, table);
    } catch (e) {
      showError(body, humanizeError(e), load);
    }
  }
  filter.addEventListener('change', load);
  await load();
}

export default renderAudit;
