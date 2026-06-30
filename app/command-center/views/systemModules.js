// systemModules.js — Platform Module Registry (System Health area). Reads the live
// app_private.platform_modules registry via cc_list_modules / cc_module_summary.
// This is the "module factory" control surface: every capability and its status,
// flag, permissions and event contracts in one governed place.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, searchBox } from '../../shared/ui/components.js';
import { listModules, moduleSummary } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const STATUS_TONE = { LIVE: 'green', FLAGGED: 'blue', STAGING: 'amber', BACKEND_ONLY: 'gray', FRONTEND_ONLY: 'gray', PROVIDER_BLOCKED: 'amber', OWNER_BLOCKED: 'amber', PLANNED: 'gray', DEPRECATED: 'red', FAILED: 'red' };

export function renderSystemModules(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const tools = el('div', { style: 'margin:14px 0' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Platform Module Registry', 'Every capability, its status, flag, permissions and event contracts — the module-factory source of truth.'),
    kpis, tools, body,
  ]));
  let all = [];
  load();

  async function load() {
    showLoading(body, 'Loading registry…');
    let rows, sum;
    try { [rows, sum] = await Promise.all([listModules(), moduleSummary().catch(() => null)]); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    all = rows || [];
    const byStatus = (sum && sum.by_status) || {};
    mount(kpis, [
      statCard({ icon: 'grid', label: 'Modules', value: String((sum && sum.total) || all.length), sub: 'registered', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Live', value: String(byStatus.LIVE || 0), sub: 'in production', accent: 'green' }),
      statCard({ icon: 'flag', label: 'Flagged', value: String(byStatus.FLAGGED || 0), sub: 'behind flags', accent: 'violet' }),
      statCard({ icon: 'shield', label: 'Blocked / planned', value: String((byStatus.PROVIDER_BLOCKED || 0) + (byStatus.BACKEND_ONLY || 0) + (byStatus.PLANNED || 0)), sub: 'need work', accent: 'amber' }),
    ]);
    mount(tools, searchBox('Search modules, areas, events…', (q) => draw(q)));
    draw('');
  }

  function draw(q) {
    q = (q || '').toLowerCase();
    const rows = all.filter(m => !q || [m.id, m.name, m.area, m.route, (m.events_produced || []).join(' '), (m.events_consumed || []).join(' ')].join(' ').toLowerCase().includes(q));
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No modules match.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Module', 'Area', 'Status', 'Flag', 'Permissions', 'Events (produced → consumed)'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(m => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, m.name), el('div', { class: 'cc-sub' }, m.route || m.id)]),
        el('td', null, m.area || '—'),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (STATUS_TONE[m.status] || 'gray') }, m.status)),
        el('td', null, m.flag_key || '—'),
        el('td', null, (m.permissions && m.permissions.length) ? m.permissions.join(', ') : '—'),
        el('td', null, el('div', { class: 'cc-sub' }, ((m.events_produced || []).join(', ') || '—') + '  →  ' + ((m.events_consumed || []).join(', ') || '—'))),
      ]))),
    ]));
  }
}

export default renderSystemModules;
