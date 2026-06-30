// reports.js — Control Tower Wave E: Reports center.
// Pick a report (finance, carriers, operations, sales, website, compliance) and a time
// window; the server returns a typed table that renders here and exports to CSV / Excel /
// PDF. Reads via cc_report (reports.view), RBAC-gated.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, segmented, card } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { report } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const KINDS = [
  { value: 'finance', label: 'Finance' }, { value: 'carriers', label: 'Carriers' },
  { value: 'trips', label: 'Operations' }, { value: 'sales', label: 'Sales' },
  { value: 'web', label: 'Website' }, { value: 'compliance', label: 'Compliance' },
];

export function renderReports(host) {
  let kind = 'finance', days = 30, current = null;
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Reports', 'Cross-module reports you can read on screen and export to CSV, Excel or PDF.',
      el('div', { class: 'cc-head-actions', id: 'rp-export' })),
    el('div', { class: 'cc-toolbar' }, [el('div', { id: 'rp-kinds' }), el('div', { id: 'rp-range' })]),
    el('div', { id: 'rp-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading report…')),
  ]));
  const exportHost = host.querySelector('#rp-export');
  const body = host.querySelector('#rp-body');
  mount(host.querySelector('#rp-kinds'), segmented(KINDS, kind, (v) => { kind = v; load(); }));
  mount(host.querySelector('#rp-range'), segmented([{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }, { value: 365, label: '1y' }], days, (v) => { days = v; load(); }));

  load();

  function renderExport() {
    if (!current) { mount(exportHost, ''); return; }
    const cols = (current.columns || []).map(c => ({ key: c.key, label: c.label }));
    const rows = current.rows || [];
    const base = 'loadboot-report-' + current.kind;
    mount(exportHost, el('div', { class: 'cc-seg' }, [
      el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV(base, cols, rows) }, 'CSV'),
      el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel(base, cols, rows, current.title) }, 'Excel'),
      el('button', { class: 'cc-seg-btn', onClick: () => printTable(current.title, 'LoadBoot · ' + current.days + ' days', cols, rows) }, 'PDF'),
    ]));
  }

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading report…'));
    try { current = await report(kind, days); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    renderExport();
    const cols = current.columns || [];
    const rows = current.rows || [];
    const fmt = (v) => {
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (v == null) return '—';
      return String(v);
    };
    mount(body, card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, current.title), el('span', { class: 'cc-sub' }, rows.length + ' rows · last ' + current.days + ' days')]),
      rows.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, cols.map(c => el('th', null, c.label)))),
        el('tbody', null, rows.map(r => el('tr', null, cols.map(c => el('td', null, fmt(r[c.key])))))),
      ]) : el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No data for this report and window yet.'),
    ]));
  }
}

export default renderReports;
