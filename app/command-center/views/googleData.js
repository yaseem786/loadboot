// googleData.js — Phase 3/4: REAL Google Analytics 4 + Google Search Console.
// Server-side via the ga4-insights / gsc-insights edge functions (service-account auth;
// keys never touch the browser). Clearly labelled by source, with connection status and
// freshness. NEVER mixes GA4 with first-party analytics, and NEVER fabricates: if a source
// is not connected it says so. CSV/Excel/PDF export per table.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, barChart, segmented, fmtDate, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { ga4Insights, gscInsights } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const REASON = {
  no_key: 'Service account not configured (GOOGLE_SA_KEY secret missing).',
  no_property_id: 'GA4_PROPERTY_ID secret is not set.',
  no_site: 'No verified Search Console site found for this service account.',
  bad_key: 'The service-account key could not be parsed.',
  error: 'The provider returned an error.',
};
const pctBadge = (p) => p == null ? '' : (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p) + '%';
const fmtPct = (v) => (v == null ? '—' : Math.round(Number(v) * 100) + '%');
const fmtPos = (v) => (v == null ? '—' : Number(v).toFixed(1));

function notConnected(title, reason, how) {
  return card([
    el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, title), el('span', { class: 'cc-pill cc-pill-gray' }, [el('i', { class: 'cc-pill-dot' }), 'not connected'])]),
    el('p', { class: 'cc-sub', style: 'margin:6px 0' }, REASON[reason] || 'Not connected.'),
    how ? el('p', { class: 'cc-sub' }, how) : '',
  ]);
}

export function renderGoogleData(host) {
  let days = 28;
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Google Analytics & Search Console', 'Official Google data, fetched server-side. Separate from first-party analytics — totals are never mixed.',
      el('div', { class: 'cc-head-actions', id: 'gd-range' })),
    el('div', { id: 'gd-ga4' }, el('div', { class: 'lb-state lb-loading' }, 'Loading Google Analytics…')),
    el('div', { id: 'gd-gsc', style: 'margin-top:16px' }, el('div', { class: 'lb-state lb-loading' }, 'Loading Search Console…')),
  ]));
  mount(host.querySelector('#gd-range'), segmented([{ value: 7, label: '7d' }, { value: 28, label: '28d' }, { value: 90, label: '90d' }], days, (v) => { days = v; load(); }));
  const ga4Host = host.querySelector('#gd-ga4');
  const gscHost = host.querySelector('#gd-gsc');
  load();

  async function load() { loadGA4(); loadGSC(); }

  async function loadGA4() {
    mount(ga4Host, el('div', { class: 'lb-state lb-loading' }, 'Loading Google Analytics…'));
    let d;
    try { d = await ga4Insights(days); } catch (e) { showError(ga4Host, humanizeError(e), loadGA4); return; }
    if (!d || !d.connected) { mount(ga4Host, notConnected('Google Analytics 4', d && d.reason, 'Add GOOGLE_SA_KEY + GA4_PROPERTY_ID in Supabase secrets, enable the Analytics Data API, and grant the service account Viewer on the GA4 property.')); return; }
    const t = d.totals || {}, c = d.change_pct || {};
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Active users now', value: String(d.realtime_active_users || 0), sub: 'realtime', accent: 'green' }),
      statCard({ icon: 'grid', label: 'Sessions', value: String(t.sessions || 0), sub: pctBadge(c.sessions) + ' vs prev', accent: 'blue' }),
      statCard({ icon: 'users', label: 'Users', value: String(t.users || 0), sub: pctBadge(c.users) + ' vs prev', accent: 'violet' }),
      statCard({ icon: 'trend', label: 'Conversions', value: String(t.conversions || 0), sub: pctBadge(c.conversions) + ' · ' + (t.views || 0) + ' views', accent: 'amber' }),
    ]);
    const daily = (d.daily || []).map(x => ({ c: Number(x.sessions) || 0 }));
    const head = card([
      el('div', { class: 'cc-card-head' }, [
        el('h4', { class: 'cc-card-title' }, [el('span', { class: 'cc-src' }, 'Google Analytics 4'), ' · sessions']),
        el('span', { class: 'cc-sub' }, 'property ' + d.property + ' · ' + d.range.startDate + ' → ' + d.range.endDate + ' · synced ' + fmtDateTime(d.fetched_at)),
      ]),
      barChart(daily, { height: 64 }),
    ]);
    mount(ga4Host, el('div', null, [
      el('div', { class: 'cc-conn-row', style: 'margin-bottom:12px' }, [
        el('div', null, [el('b', null, 'Google Analytics 4'), el('div', { class: 'cc-sub' }, 'Connected · data through ' + d.range.endDate)]),
        el('span', { class: 'cc-pill cc-pill-green' }, [el('i', { class: 'cc-pill-dot' }), 'connected']),
      ]),
      kpis, el('div', { style: 'margin-top:14px' }, head),
      el('div', { class: 'cc-grid-2', style: 'margin-top:14px' }, [
        gaTable('Top channels (source / medium)', d.source_medium, [{ key: 'key', label: 'Source / medium' }, { key: 'sessions', label: 'Sessions' }, { key: 'conversions', label: 'Conv.' }], 'ga4-channels'),
        gaTable('Campaigns', d.campaigns, [{ key: 'key', label: 'Campaign' }, { key: 'sessions', label: 'Sessions' }, { key: 'conversions', label: 'Conv.' }], 'ga4-campaigns'),
      ]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:14px' }, [
        gaTable('Top pages', d.pages, [{ key: 'key', label: 'Page' }, { key: 'views', label: 'Views' }], 'ga4-pages'),
        gaTable('Landing pages', d.landing_pages, [{ key: 'key', label: 'Landing page' }, { key: 'sessions', label: 'Sessions' }], 'ga4-landing'),
      ]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:14px' }, [
        gaTable('Devices', d.devices, [{ key: 'key', label: 'Device' }, { key: 'sessions', label: 'Sessions' }], 'ga4-devices'),
        gaTable('Countries', d.countries, [{ key: 'key', label: 'Country' }, { key: 'sessions', label: 'Sessions' }], 'ga4-countries'),
      ]),
      el('div', { style: 'margin-top:14px' }, gaTable('Events', d.events, [{ key: 'key', label: 'Event' }, { key: 'count', label: 'Count' }], 'ga4-events')),
    ]));
  }

  async function loadGSC() {
    mount(gscHost, el('div', { class: 'lb-state lb-loading' }, 'Loading Search Console…'));
    let d;
    try { d = await gscInsights(days); } catch (e) { showError(gscHost, humanizeError(e), loadGSC); return; }
    if (!d || !d.connected) { mount(gscHost, notConnected('Google Search Console', d && d.reason, 'Add GOOGLE_SA_KEY (and optionally GSC_SITE_URL), enable the Search Console API, and grant the service account access to the property.')); return; }
    const t = d.totals || {};
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'trend', label: 'Clicks', value: String(t.clicks || 0), sub: 'from Google search', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Impressions', value: String(t.impressions || 0), sub: 'search appearances', accent: 'violet' }),
      statCard({ icon: 'check', label: 'CTR', value: fmtPct(t.ctr), sub: 'click-through rate', accent: 'green' }),
      statCard({ icon: 'flag', label: 'Avg position', value: fmtPos(t.position), sub: 'lower is better', accent: 'amber' }),
    ]);
    const qCols = [{ key: 'key', label: 'Query' }, { key: 'clicks', label: 'Clicks' }, { key: 'impressions', label: 'Impr.' }, { key: 'ctr', label: 'CTR', fmt: fmtPct }, { key: 'position', label: 'Pos', fmt: fmtPos }];
    const oCols = [{ key: 'key', label: 'Opportunity keyword' }, { key: 'impressions', label: 'Impr.' }, { key: 'position', label: 'Pos', fmt: fmtPos }];
    mount(gscHost, el('div', null, [
      el('div', { class: 'cc-conn-row', style: 'margin-bottom:12px' }, [
        el('div', null, [el('b', null, 'Google Search Console'), el('div', { class: 'cc-sub' }, 'Connected · ' + d.site + ' · data through ' + d.range.endDate + ' (Search Console lags ~2 days)')]),
        el('span', { class: 'cc-pill cc-pill-green' }, [el('i', { class: 'cc-pill-dot' }), 'connected']),
      ]),
      kpis,
      el('div', { class: 'cc-grid-2', style: 'margin-top:14px' }, [
        gaTable('Top queries', d.queries, qCols, 'gsc-queries'),
        gaTable('Top pages', d.pages, qCols.map(c => c.key === 'key' ? { key: 'key', label: 'Page' } : c), 'gsc-pages'),
      ]),
      el('div', { style: 'margin-top:14px' }, gaTable('Page-2 opportunities (high impressions, ranking 11–40)', d.opportunities, oCols, 'gsc-opportunities')),
    ]));
  }

  function kvRow(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v)]); }
  function gaTable(title, rows, cols, base) {
    rows = rows || [];
    const mkey = (cols[1] && cols[1].key) || null;
    const total = mkey ? rows.reduce((a, r) => a + (Number(r[mkey]) || 0), 0) : 0;
    const exp = el('div', { class: 'cc-seg' }, [
      el('button', { class: 'cc-seg-btn', onClick: (e) => { e.stopPropagation(); downloadCSV('loadboot-' + base, cols, rows); } }, 'CSV'),
      el('button', { class: 'cc-seg-btn', onClick: (e) => { e.stopPropagation(); downloadExcel('loadboot-' + base, cols, rows, title); } }, 'Excel'),
      el('button', { class: 'cc-seg-btn', onClick: (e) => { e.stopPropagation(); printTable(title, 'LoadBoot · Google data', cols, rows); } }, 'PDF'),
    ]);
    const openRow = (r, rank) => {
      const body = el('div', null, cols.map(c => kvRow(c.label, c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? '—'))).concat([
        (mkey && total) ? kvRow(cols[1].label + ' share', ((Number(r[mkey]) || 0) / total * 100).toFixed(1) + '% of ' + total + ' total') : '',
        kvRow('Rank', '#' + rank + ' of ' + rows.length),
        el('p', { class: 'cc-sub', style: 'margin-top:12px' }, 'Real Google Analytics 4 data for the selected window. Export the full list with CSV / Excel / PDF on the table.'),
      ].filter(Boolean)));
      openDrawer(title + ' — ' + String(r.key ?? ''), body, { subtitle: 'Detail' });
    };
    return card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, title), exp]),
      rows.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, cols.map(c => el('th', null, c.label)))),
        el('tbody', null, rows.map((r, i) => el('tr', { class: 'cc-row-click', onClick: () => openRow(r, i + 1) }, cols.map(c => el('td', null, c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? '—')))))),
      ]) : el('div', { class: 'cc-sub' }, 'No rows for this window.'),
    ]);
  }
}

export default renderGoogleData;
