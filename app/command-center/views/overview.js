// overview.js — Command Center dashboard. Real counts from cc_get_overview only.
// No fabricated metrics or charts: every number is a live count from the database.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, breakdownBars, card } from '../../shared/ui/components.js';
import { getOverviewStats } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export async function renderOverview(host, ctx, shell) {
  showLoading(host, 'Loading dashboard…');
  let s;
  try { s = await getOverviewStats(); }
  catch (e) { showError(host, humanizeError(e), () => renderOverview(host, ctx, shell)); return; }

  const n = (k) => Number((s && s[k]) || 0);
  if (shell && shell.setBadge) shell.setBadge('/documents', n('documents_pending'));

  const kpis = el('div', { class: 'cc-kpi-grid' }, [
    statCard({ icon: 'truck', label: 'Carriers', value: String(n('carriers_total')), sub: n('carriers_pending') + ' awaiting review', accent: 'blue', to: '#/carriers' }),
    statCard({ icon: 'list', label: 'Loads available', value: String(n('loads_available')), sub: n('loads_booked') + ' booked · ' + n('loads_in_transit') + ' in transit', accent: 'green', to: '#/loads' }),
    statCard({ icon: 'doc', label: 'Documents pending', value: String(n('documents_pending')), sub: 'awaiting compliance review', accent: 'amber', to: '#/documents' }),
    statCard({ icon: 'users', label: 'Active staff', value: String(n('staff_active')), sub: 'operators with access', accent: 'violet', to: '#/staff' }),
  ]);

  const carrierBreak = card([
    el('h3', { class: 'cc-card-title' }, 'Carrier pipeline'),
    breakdownBars({ pending: n('carriers_pending'), active: n('carriers_active'), paused: n('carriers_paused') }, n('carriers_total')),
  ], 'cc-pad');

  const loadBreak = card([
    el('h3', { class: 'cc-card-title' }, 'Load lifecycle'),
    breakdownBars({
      available: n('loads_available'), booked: n('loads_booked'),
      in_transit: n('loads_in_transit'), delivered: n('loads_delivered'),
    }),
  ], 'cc-pad');

  const quick = card([
    el('h3', { class: 'cc-card-title' }, 'Quick actions'),
    el('div', { class: 'cc-quick' }, [
      can('carriers.approve') ? el('a', { class: 'cc-quick-btn', href: '#/carriers' }, 'Review carriers') : '',
      can('documents.review') ? el('a', { class: 'cc-quick-btn', href: '#/documents' }, 'Review documents') : '',
      can('loads.create') ? el('a', { class: 'cc-quick-btn', href: '#/loads' }, 'Post a load') : '',
      (can('loads.assign') || can('loads.publish')) ? el('a', { class: 'cc-quick-btn', href: '#/dispatch' }, 'Open dispatch board') : '',
    ].filter(Boolean)),
  ], 'cc-pad');

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Command overview', 'Live operational snapshot for your team.'),
    kpis,
    el('div', { class: 'cc-grid-2' }, [carrierBreak, loadBreak]),
    quick,
  ]));
}

export default renderOverview;
