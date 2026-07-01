// marketingAnalytics.js — Marketing Analytics (Phase 3E). Campaign performance,
// consent health and audience coverage in one place. Honest about email open-tracking
// limits — click/conversion events are more reliable than opens.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime } from '../../shared/ui/components.js';
import { cmpList, listAudiences, consentSummary } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const ST_TONE = { draft: 'gray', scheduled: 'blue', sent: 'green', paused: 'amber' };

export function renderMarketingAnalytics(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const grid = el('div', { class: 'fa-grid', style: 'margin-top:16px' });
  mount(host, el('div', null, [
    sectionHead('Marketing Analytics', 'Campaign performance, consent health and audience coverage. Delivery is tracked per message; email opens are approximate — clicks and conversions are more reliable.'),
    kpis, grid,
  ]));
  load();

  async function load() {
    showLoading(grid, 'Loading marketing analytics…');
    let campaigns, audiences, consent;
    try { [campaigns, audiences, consent] = await Promise.all([cmpList().catch(() => []), listAudiences().catch(() => []), consentSummary().catch(() => null)]); }
    catch (e) { showError(grid, humanizeError(e), load); return; }
    campaigns = campaigns || []; audiences = audiences || []; consent = consent || {};
    const sent = campaigns.filter(c => c.status === 'sent');
    const delivered = campaigns.reduce((a, c) => a + (c.sent_count || 0), 0);
    mount(kpis, [
      statCard({ icon: 'trend', label: 'Campaigns', value: String(campaigns.length), sub: sent.length + ' sent', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Messages delivered', value: String(delivered), sub: 'across campaigns', accent: 'green' }),
      statCard({ icon: 'users', label: 'Saved audiences', value: String(audiences.length), sub: 'reusable segments', accent: 'violet' }),
      statCard({ icon: 'check', label: 'Marketing opt-in', value: String(consent.marketing_in || 0), sub: (consent.unsubscribed || 0) + ' unsubscribed', accent: (consent.unsubscribed || 0) > 0 ? 'amber' : 'green' }),
    ]);
    const byStatus = campaigns.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
    const recent = campaigns.slice(0, 12);
    mount(grid, [
      el('div', { class: 'lb-card fa-col2' }, [
        el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Recent campaigns'), el('span', null, campaigns.length + ' total')]),
        recent.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Campaign', 'Audience', 'Channels', 'Status', 'Delivered'].map(h => el('th', null, h)))),
          el('tbody', null, recent.map(c => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, c.name)),
            el('td', null, c.audience_name || '—'),
            el('td', null, (c.channels || []).join(', ')),
            el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[c.status] || 'gray') }, c.status)),
            el('td', null, String(c.sent_count || 0)),
          ]))),
        ]) : el('div', { class: 'lb-state' }, 'No campaigns yet.'),
      ]),
      el('div', { class: 'lb-card' }, [
        el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Campaign mix')]),
        el('div', { class: 'fa-ranks' }, ['draft', 'scheduled', 'sent', 'paused'].map(s => el('div', { class: 'fa-rank' }, [
          el('div', { class: 'fa-rank-l', style: 'text-transform:capitalize' }, s),
          el('div', { class: 'fa-rank-bar' }, el('div', { class: 'fa-rank-fill', style: 'width:' + Math.max(3, (byStatus[s] || 0) / Math.max(1, campaigns.length) * 100) + '%' })),
          el('div', { class: 'fa-rank-v' }, String(byStatus[s] || 0)),
        ]))),
        el('p', { class: 'cc-sub', style: 'margin-top:14px' }, 'Consent-aware: sends exclude unsubscribed and suppressed contacts. Operational/compliance/finance messages are always delivered.'),
      ]),
    ]);
  }
}

export default renderMarketingAnalytics;
