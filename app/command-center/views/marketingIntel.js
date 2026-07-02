// marketingIntel.js — C6: the ad desk's one screen. First-party, ad-campaign-ready data:
// which pages pull traffic, which UTM sources/campaigns produce LEADS (spend Google/Meta/TikTok
// budgets on measured conversion, not vibes), leads by audience (carrier/broker/shipper/referral),
// daily lead trend, and the reachable audience base per segment (email/portal marketing universe).
// Google keyword/click data appears via the GSC integration once the owner connects the service account.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard } from '../../shared/ui/components.js';
import { marketingIntel } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const AUD_LABEL = { carrier: 'Carriers', broker: 'Brokers', shipper: 'Shippers', referral_partner: 'Referral partners', newsletter: 'Newsletter', careers: 'Careers' };

export function renderMarketingIntel(host) {
  let days = 30;
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div');
  const sel = el('select', { class: 'cc-input', style: 'max-width:140px' },
    [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([v, l]) => el('option', { value: String(v), selected: v === 30 ? 'selected' : null }, l)));
  sel.onchange = () => { days = Number(sel.value); load(); };
  mount(host, el('div', null, [
    sectionHead('Marketing Intelligence', 'First-party numbers to base ad spend on: pages that pull, UTM sources/campaigns that CONVERT, leads per audience and the reachable base per segment. Keyword-level Google data arrives via the GSC card once the Google service account is connected.', sel),
    kpis, body,
  ]));
  load();

  function bars(title, rows, kf, vf, note) {
    const max = Math.max(1, ...rows.map(vf));
    return el('div', { class: 'lb-card', style: 'margin:10px 0' }, [
      el('h3', { style: 'margin:0 0 4px' }, title),
      note ? el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, note) : null,
      rows.length ? el('div', null, rows.map(r => el('div', { style: 'margin:7px 0' }, [
        el('div', { style: 'display:flex;justify-content:space-between;font-size:.88rem' }, [el('span', null, kf(r)), el('b', null, String(vf(r)))]),
        el('div', { style: 'height:7px;border-radius:99px;background:var(--lb-border,#e2e8f0)' },
          el('div', { style: 'height:7px;border-radius:99px;width:' + Math.round(vf(r) / max * 100) + '%;background:linear-gradient(90deg,#2563eb,#7c3aed)' })),
      ]))) : el('div', { class: 'cc-sub' }, 'No data in this window yet.'),
    ].filter(Boolean));
  }

  async function load() {
    showLoading(body, 'Counting real rows…');
    let o; try { o = await marketingIntel(days); } catch (e) { showError(body, humanizeError(e), load); return; }
    o = o || {};
    const ab = o.audience_base || {};
    const la = o.leads_by_audience || {};
    const totalLeads = Object.values(la).reduce((a, b) => a + Number(b || 0), 0);
    mount(kpis, [
      statCard({ icon: 'users', label: 'Leads (' + (o.window_days || days) + 'd)', value: String(totalLeads), sub: 'spam-filtered form submissions', accent: 'blue' }),
      statCard({ icon: 'truck', label: 'Carrier base', value: String(ab.carrier_orgs || 0), sub: (la.carrier || 0) + ' new leads', accent: 'green' }),
      statCard({ icon: 'briefcase', label: 'Broker base', value: String(ab.broker_orgs || 0), sub: (la.broker || 0) + ' new leads', accent: 'blue' }),
      statCard({ icon: 'gift', label: 'Referral partners', value: String(ab.referral_partners || 0), sub: (la.referral_partner || 0) + ' applied', accent: 'amber' }),
      statCard({ icon: 'mail', label: 'Newsletter reach', value: String(ab.newsletter_optins || 0), sub: 'opted-in emails', accent: 'gray' }),
    ]);
    const daily = Array.isArray(o.leads_daily) ? o.leads_daily : [];
    const maxD = Math.max(1, ...daily.map(r => Number(r.leads || 0)));
    const trend = el('div', { class: 'lb-card', style: 'margin:10px 0' }, [
      el('h3', { style: 'margin:0 0 8px' }, 'Leads per day'),
      el('div', { style: 'display:flex;align-items:flex-end;gap:2px;height:90px' },
        daily.map(r => el('div', { title: r.day + ': ' + r.leads + ' lead(s)', style: 'flex:1;min-width:3px;border-radius:3px 3px 0 0;background:' + (Number(r.leads) ? '#2563eb' : 'var(--lb-border,#e2e8f0)') + ';height:' + Math.max(4, Math.round(Number(r.leads || 0) / maxD * 100)) + '%' }))),
    ]);
    mount(body, el('div', null, [
      trend,
      bars('Leads by audience', Object.entries(la).sort((a, b) => b[1] - a[1]), r => AUD_LABEL[r[0]] || r[0], r => Number(r[1] || 0),
        'Which of the four audiences the website is actually converting — aim campaigns at the gaps.'),
      bars('UTM sources that convert', o.utm_sources || [], r => (r.source || '—') + (r.medium ? ' / ' + r.medium : ''), r => Number(r.leads || 0),
        'Tag every ad with utm_source/utm_medium — this is measured lead conversion per channel (Google / Meta / TikTok).'),
      bars('UTM campaigns', o.utm_campaigns || [], r => r.campaign || '—', r => Number(r.leads || 0),
        'Per-campaign leads — kill what does not convert, scale what does.'),
      bars('Top pages (views)', o.top_pages || [], r => r.page || '—', r => Number(r.views || 0),
        'Where visitors actually land — landing-page candidates for paid traffic.'),
      bars('Referrer domains', o.referrer_domains || [], r => r.referrer || '—', r => Number(r.leads || 0), null),
      el('div', { class: 'lb-card', style: 'margin:10px 0;background:#f8fafc' },
        el('div', { class: 'cc-sub' }, (o.basis || '') + ' · Audience push: use Campaign Manager (email, consent-enforced) and Notify broadcast (portal in-app by role) — both already live.')),
    ]));
  }
}

export default renderMarketingIntel;
