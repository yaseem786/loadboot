// analyticsWeb.js — Control Tower Wave A: Analytics Control Center.
// First-party, privacy-safe web analytics over the live beacon pipeline: live visitors,
// traffic overview, top pages, referrers, and AI-assistant (ChatGPT/Perplexity/…) referrals.
// Every number is drill-downable. GA4 + Search Console appear as honest "Not connected"
// shells (no fabricated data). All reads via cc_web_* RPCs (analytics.view), RBAC-gated.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, barChart, card, segmented, statusPill, fmtDateTime, ago } from '../../shared/ui/components.js';
import { openDrawer } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { webLive, webOverview, webPages, webReferrers, webAiReferrals, integrationStatus } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { renderGoogleData } from './googleData.js';

const SRC_TONE = { ai: 'violet', organic: 'green', social: 'blue', paid: 'amber', referral: 'blue', direct: 'gray', internal: 'gray' };

export function renderAnalyticsWeb(host) {
  let days = 7;
  let liveTimer = null;
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Analytics Control Center', 'First-party, cookie-light web analytics — live visitors, traffic sources, AI referrals and top pages. Every figure is clickable.',
      el('div', { class: 'cc-head-actions', id: 'aw-range' })),
    el('div', { id: 'aw-live' }),
    el('div', { id: 'aw-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading analytics…')),
  ]));
  const rangeHost = host.querySelector('#aw-range');
  const liveHost = host.querySelector('#aw-live');
  const body = host.querySelector('#aw-body');

  mount(rangeHost, segmented([
    { value: 1, label: '24h' }, { value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' },
  ], days, (v) => { days = v; load(); }));

  loadLive();
  load();
  liveTimer = setInterval(loadLive, 15000);
  // stop polling when the view is torn down (router replaces #aw-live's ancestors)
  const obs = new MutationObserver(() => { if (!document.body.contains(liveHost)) { clearInterval(liveTimer); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });

  async function loadLive() {
    let live;
    try { live = await webLive(5); } catch (_) { return; }
    const visitors = (live && live.visitors) || [];
    const byPage = (live && live.by_page) || [];
    mount(liveHost, card([
      el('div', { class: 'cc-card-head' }, [
        el('h4', { class: 'cc-card-title' }, [el('span', { class: 'cc-live-dot' }), ' Live visitors']),
        el('span', { class: 'cc-sub' }, (live ? live.active_now : 0) + ' active now · ' + (live ? live.active_30m : 0) + ' in last 30m'),
      ]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:10px' }, [
        el('div', null, [
          el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Visitors right now'),
          visitors.length ? el('table', { class: 'cc-table cc-table-tight' }, [
            el('thead', null, el('tr', null, [el('th', null, 'Visitor'), el('th', null, 'On page'), el('th', null, 'Source'), el('th', null, 'Seen')])),
            el('tbody', null, visitors.map(v => el('tr', { class: 'cc-row-click', onClick: () => visitorDrawer(v) }, [
              el('td', null, el('b', null, v.anon || '—')),
              el('td', null, v.page || '/'),
              el('td', null, statusPill(v.source || 'direct')),
              el('td', null, ago(v.last)),
            ]))),
          ]) : el('div', { class: 'cc-sub' }, 'No live visitors in the last 5 minutes.'),
        ]),
        el('div', null, [
          el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Active pages'),
          byPage.length ? el('div', { class: 'cc-breakdown' }, byPage.map(p => el('div', { class: 'cc-bd-row' }, [
            el('div', { class: 'cc-bd-head' }, [el('span', null, p.page || '/'), el('b', null, String(p.visitors))]),
          ]))) : el('div', { class: 'cc-sub' }, 'No active pages.'),
        ]),
      ]),
    ]));
  }

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading analytics…'));
    // RESILIENT LOADING: one failing endpoint must never blank the whole screen.
    // Each call degrades to null; whatever arrived is rendered, failures are named inline.
    const failed = [];
    const soft = (p, name) => p.catch((e) => { failed.push(name + ': ' + humanizeError(e)); return null; });
    const [ov, pages, refs, ai, integ] = await Promise.all([
      soft(webOverview(days), 'Overview'),
      soft(webPages(days, 25), 'Pages'),
      soft(webReferrers(days, 25), 'Referrers'),
      soft(webAiReferrals(Math.max(days, 30)), 'AI referrals'),
      integrationStatus().catch(() => []),
    ]);
    if (!ov && !pages && !refs && !ai) { showError(body, failed.join(' · ') || 'Analytics unavailable.', load); return; }

    const n = (k) => Number((ov && ov[k]) || 0);
    const failStrip = failed.length ? el('div', { class: 'cc-sub', style: 'margin-bottom:8px;color:#b45309' },
      '\u26a0 Some analytics endpoints failed and were skipped: ' + failed.join(' \u00b7 ')) : null;
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'users', label: 'Sessions', value: String(n('sessions')), sub: 'last ' + days + ' days', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'Pageviews', value: String(n('pageviews')), sub: 'across all pages', accent: 'violet' }),
      statCard({ icon: 'trend', label: 'Conversions', value: String(n('conversions')), sub: n('forms') + ' form submits', accent: 'green' }),
      statCard({ icon: 'bell', label: 'AI referrals', value: String(Number((ai && ai.ai_sessions) || 0)), sub: Number((ai && ai.ai_conversions) || 0) + ' converted', accent: 'amber' }),
    ]);

    const daily = (ov && ov.daily) || [];
    const trendCard = card([
      el('h4', { class: 'cc-card-title' }, 'Sessions · last ' + days + ' days'),
      areaChart(daily, { height: 168 }),
    ]);

    const sources = Object.entries((ov && ov.by_source) || {}).sort((a, b) => b[1] - a[1]);
    const srcTotal = sources.reduce((a, [, c]) => a + Number(c), 0) || 1;
    const sourcesCard = card([
      el('h4', { class: 'cc-card-title' }, 'Traffic by source'),
      sources.length ? el('div', { class: 'cc-breakdown' }, sources.map(([k, c]) => {
        const pct = (Number(c) / srcTotal * 100).toFixed(0);
        return el('div', { class: 'cc-bd-row cc-row-click', onClick: () => sourceDrawer(k, refs) }, [
          el('div', { class: 'cc-bd-head' }, [el('span', null, statusPill(k)), el('b', null, String(c) + ' · ' + pct + '%')]),
          el('div', { class: 'cc-bd-track' }, el('i', { class: 'cc-bd-fill cc-bd-' + (SRC_TONE[k] || 'gray'), style: 'width:' + pct + '%' })),
        ]);
      })) : el('div', { class: 'cc-sub' }, 'No sessions in this window.'),
    ]);

    // Pages table with export + drill-down
    const pageCols = [{ key: 'page', label: 'Page' }, { key: 'pageviews', label: 'Pageviews' }, { key: 'visitors', label: 'Visitors' }];
    const pagesCard = card([
      el('div', { class: 'cc-card-head' }, [
        el('h4', { class: 'cc-card-title' }, 'Top pages'),
        exportBtns('loadboot-top-pages', pageCols, () => pages || [], 'Top pages'),
      ]),
      (pages && pages.length) ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Page'), el('th', null, 'Pageviews'), el('th', null, 'Visitors')])),
        el('tbody', null, pages.map(p => el('tr', { class: 'cc-row-click', onClick: () => pageDrawer(p) }, [
          el('td', null, el('b', null, p.page || '/')),
          el('td', null, String(p.pageviews || 0)),
          el('td', null, String(p.visitors || 0)),
        ]))),
      ]) : el('div', { class: 'cc-sub' }, 'No pageviews yet.'),
    ]);

    // Referrers table with export + drill-down
    const refCols = [{ key: 'referrer_host', label: 'Referrer' }, { key: 'source_class', label: 'Source' }, { key: 'sessions', label: 'Sessions' }, { key: 'conversions', label: 'Conversions' }];
    const refsCard = card([
      el('div', { class: 'cc-card-head' }, [
        el('h4', { class: 'cc-card-title' }, 'Referrers'),
        exportBtns('loadboot-referrers', refCols, () => refs || [], 'Referrers'),
      ]),
      (refs && refs.length) ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Referrer'), el('th', null, 'Source'), el('th', null, 'Sessions'), el('th', null, 'Conv.')])),
        el('tbody', null, refs.map(r => el('tr', { class: 'cc-row-click', onClick: () => sourceDrawer(r.source_class, refs, r.referrer_host) }, [
          el('td', null, el('b', null, r.referrer_host || '(direct)')),
          el('td', null, statusPill(r.source_class || 'direct')),
          el('td', null, String(r.sessions || 0)),
          el('td', null, String(r.conversions || 0)),
        ]))),
      ]) : el('div', { class: 'cc-sub' }, 'No referrers yet.'),
    ]);

    // AI referrals detail
    const aiHosts = (ai && ai.by_host) || [];
    const aiCard = card([
      el('h4', { class: 'cc-card-title' }, 'AI assistant referrals'),
      el('p', { class: 'cc-sub', style: 'margin:2px 0 10px' }, (ai && ai.note) || ''),
      aiHosts.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'AI source'), el('th', null, 'Sessions')])),
        el('tbody', null, aiHosts.map(h => el('tr', null, [el('td', null, el('b', null, h.host || '(unknown)')), el('td', null, String(h.sessions || 0))]))),
      ]) : el('div', { class: 'cc-sub' }, 'No AI-assistant referrals detected in this window yet.'),
    ]);

    // GA4 / Search Console connection shells (honest, no fake data)
    const ga = (integ || []).find(i => i.provider === 'ga4');
    const gsc = (integ || []).find(i => i.provider === 'search_console');
    const shellsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Connected analytics sources'),
      el('div', { class: 'cc-conn-grid', style: 'margin-top:8px' }, [
        connRow('Google Analytics 4', ga), connRow('Google Search Console', gsc),
      ]),
      el('p', { class: 'cc-sub', style: 'margin-top:8px' }, 'First-party analytics above are live now. GA4 and Search Console are optional add-ons — connect them in Integrations to layer in Google’s data. No numbers are shown until a source is connected.'),
    ]);

    mount(body, el('div', null, [failStrip, 
      kpis,
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [trendCard, sourcesCard]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [pagesCard, refsCard]),
      el('div', { style: 'margin-top:16px' }, aiCard),
      el('div', { id: 'aw-ga', style: 'margin-top:24px;border-top:1px solid var(--lb-border);padding-top:20px' }),
    ]));
    const gaHost = body.querySelector('#aw-ga');
    if (gaHost) renderGoogleData(gaHost);
  }
}

function connRow(label, cfg) {
  const status = (cfg && cfg.status) || 'not_connected';
  const connected = status === 'connected';
  return el('div', { class: 'cc-conn-row' }, [
    el('div', null, [el('b', null, label), el('div', { class: 'cc-sub' }, connected ? ('Connected · last sync ' + (cfg.last_sync ? ago(cfg.last_sync) : '—')) : 'Not connected')]),
    el('span', { class: 'cc-pill cc-pill-' + (connected ? 'green' : 'gray') }, [el('i', { class: 'cc-pill-dot' }), connected ? 'connected' : 'not connected']),
  ]);
}

function exportBtns(baseName, cols, getRows, title) {
  const mk = (label, fn) => el('button', { class: 'cc-seg-btn', onClick: () => fn(getRows() || []) }, label);
  return el('div', { class: 'cc-seg' }, [
    mk('CSV', rows => downloadCSV(baseName, cols, rows)),
    mk('Excel', rows => downloadExcel(baseName, cols, rows, title)),
    mk('PDF', rows => printTable(title, 'LoadBoot · web analytics', cols, rows)),
  ]);
}

function visitorDrawer(v) {
  openDrawer('Visitor ' + (v.anon || ''), el('div', null, [
    kv('Current page', v.page || '/'),
    kv('Source', v.source || 'direct'),
    kv('Device', v.device || '—'),
    kv('Pages viewed', String(v.pages || 0)),
    kv('Converted', v.converted ? 'Yes' : 'No'),
    kv('Last seen', fmtDateTime(v.last)),
    el('p', { class: 'cc-sub', style: 'margin-top:12px' }, 'Anonymous first-party visitor. No personal identity is stored — only an anonymous id, page and source.'),
  ]), { subtitle: 'Live session' });
}

function pageDrawer(p) {
  openDrawer(p.page || '/', el('div', null, [
    kv('Pageviews', String(p.pageviews || 0)),
    kv('Unique visitors', String(p.visitors || 0)),
    el('p', { class: 'cc-sub', style: 'margin-top:12px' }, 'Traffic to this page in the selected window. Use the page path to cross-reference SEO keywords and redirects.'),
  ]), { subtitle: 'Page detail' });
}

function sourceDrawer(cls, refs, host) {
  const matching = (refs || []).filter(r => r.source_class === cls && (!host || r.referrer_host === host));
  openDrawer((host || cls) + ' traffic', el('div', null, [
    el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, 'Referrers classified as “' + cls + '”.'),
    matching.length ? el('table', { class: 'cc-table cc-table-tight' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Referrer'), el('th', null, 'Sessions'), el('th', null, 'Conv.')])),
      el('tbody', null, matching.map(r => el('tr', null, [el('td', null, r.referrer_host || '(direct)'), el('td', null, String(r.sessions || 0)), el('td', null, String(r.conversions || 0))]))),
    ]) : el('div', { class: 'cc-sub' }, 'No referrer rows for this source in the window.'),
  ]), { subtitle: 'Source breakdown' });
}

function kv(k, v) {
  return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v)]);
}

// GA-style smooth area+line trend from [{day,sessions}] — real data, gradient fill.
function areaChart(daily, opts) {
  opts = opts || {};
  const rows = daily || [];
  const data = rows.map(d => Number(d.sessions) || 0);
  const W = 640, H = 160, pad = 10;
  const max = Math.max(1, ...data);
  const n = data.length;
  const step = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const pts = data.map((v, i) => [pad + i * step, H - pad - (v / max) * (H - pad * 2)]);
  const line = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
  const lastX = (pad + (n - 1) * step).toFixed(1);
  const area = n > 1 ? (line + ' L' + lastX + ' ' + (H - pad) + ' L' + pad + ' ' + (H - pad) + ' Z') : '';
  const peak = Math.max(...data, 0);
  const svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + (opts.height || 168) + '" preserveAspectRatio="none">'
    + '<defs><linearGradient id="awArea" x1="0" y1="0" x2="0" y2="1">'
    + '<stop offset="0" stop-color="#0883F7" stop-opacity="0.30"/><stop offset="1" stop-color="#0883F7" stop-opacity="0"/></linearGradient></defs>'
    + (area ? '<path d="' + area + '" fill="url(#awArea)"/>' : '')
    + '<path d="' + line + '" fill="none" stroke="#0883F7" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'
    + '</svg>';
  return el('div', null, [
    el('div', { class: 'cc-chart', html: svg }),
    el('div', { class: 'cc-sub', style: 'display:flex;justify-content:space-between;margin-top:4px;font-size:.74rem' }, [
      el('span', null, (rows[0] && rows[0].day) ? String(rows[0].day) : ''),
      el('span', null, 'peak ' + peak + ' / day'),
      el('span', null, (rows[n - 1] && rows[n - 1].day) ? String(rows[n - 1].day) : ''),
    ]),
  ]);
}

export default renderAnalyticsWeb;
