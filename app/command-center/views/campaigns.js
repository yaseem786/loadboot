// campaigns.js — Control Tower Wave L: Marketing Campaign manager.
// Create a UTM-tagged campaign, get a ready-to-share tracking link, and see live
// performance (sessions + conversions) pulled from first-party web analytics by utm_campaign.
// Reads/writes via cc_*campaign* RPCs (campaigns.view / campaigns.manage), RBAC-gated.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, openDrawer } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { listCampaigns, createCampaign, setCampaignActive } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const SITE = 'https://loadboot.com';
const COLS = [
  { key: 'name', label: 'Campaign' }, { key: 'utm_source', label: 'Source' }, { key: 'utm_medium', label: 'Medium' },
  { key: 'utm_campaign', label: 'Code' }, { key: 'sessions', label: 'Sessions' }, { key: 'conversions', label: 'Conversions' },
];

function trackingUrl(c) {
  const base = SITE + (c.landing_path || '/');
  const p = new URLSearchParams();
  if (c.utm_source) p.set('utm_source', c.utm_source);
  if (c.utm_medium) p.set('utm_medium', c.utm_medium);
  p.set('utm_campaign', c.utm_campaign);
  return base + '?' + p.toString();
}

export function renderCampaigns(host) {
  let rows = [];
  const manage = can('campaigns.manage');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Marketing campaigns', 'Build UTM-tagged links, share them, and track sessions & conversions per campaign from your own analytics.',
      el('div', { class: 'cc-head-actions', id: 'cm-actions' })),
    el('div', { id: 'cm-kpis' }),
    el('div', { id: 'cm-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const actionHost = host.querySelector('#cm-actions');
  const kpiHost = host.querySelector('#cm-kpis');
  const body = host.querySelector('#cm-body');
  mount(actionHost, el('div', { class: 'cc-seg' }, [
    el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-campaigns', COLS, rows) }, 'CSV'),
    el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-campaigns', COLS, rows, 'Campaigns') }, 'Excel'),
    el('button', { class: 'cc-seg-btn', onClick: () => printTable('Marketing campaigns', 'LoadBoot', COLS, rows) }, 'PDF'),
    manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => composer() }, '+ Campaign') : '',
  ]));
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { rows = await listCampaigns(150); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const sess = rows.reduce((a, c) => a + Number(c.sessions || 0), 0);
    const conv = rows.reduce((a, c) => a + Number(c.conversions || 0), 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'trend', label: 'Campaigns', value: String(rows.length), sub: rows.filter(c => c.active).length + ' active', accent: 'blue' }),
      statCard({ icon: 'users', label: 'Sessions', value: String(sess), sub: 'across campaigns', accent: 'violet' }),
      statCard({ icon: 'check', label: 'Conversions', value: String(conv), sub: 'from campaigns', accent: 'green' }),
      statCard({ icon: 'grid', label: 'Conv. rate', value: (sess ? Math.round(conv / sess * 100) : 0) + '%', sub: 'sessions → conv.', accent: 'amber' }),
    ]));
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No campaigns yet. Create one to get a trackable link.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Campaign'), el('th', null, 'Source / Medium'), el('th', null, 'Sessions'), el('th', null, 'Conv.'), el('th', null, 'Link'), el('th', null, 'Active')])),
      el('tbody', null, rows.map(c => el('tr', null, [
        el('td', null, [el('b', null, c.name), el('div', { class: 'cc-sub' }, c.utm_campaign)]),
        el('td', null, (c.utm_source || '—') + ' / ' + (c.utm_medium || '—')),
        el('td', null, String(c.sessions || 0)),
        el('td', null, String(c.conversions || 0)),
        el('td', null, el('button', { class: 'cc-seg-btn', onClick: () => copyLink(c) }, 'Copy link')),
        el('td', null, manage
          ? el('button', { class: 'cc-toggle' + (c.active ? ' on' : ''), onClick: async () => { try { await setCampaignActive(c.id, !c.active); } catch (e) { alert(humanizeError(e)); return; } load(); } }, c.active ? 'On' : 'Off')
          : statusPill(c.active ? 'active' : 'paused')),
      ]))),
    ])));
  }

  function copyLink(c) {
    const url = trackingUrl(c);
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => alert('Tracking link copied:\n' + url), () => prompt('Copy this link:', url));
    else prompt('Copy this link:', url);
  }

  function composer() {
    const fields = {};
    const input = (k, label, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '' }); fields[k] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const preview = el('div', { class: 'cc-sub', style: 'word-break:break-all;margin-top:6px' });
    const upd = () => { preview.textContent = trackingUrl({ landing_path: fields.landing.value || '/', utm_source: fields.source.value, utm_medium: fields.medium.value, utm_campaign: (fields.campaign.value || 'campaign').replace(/\s+/g, '_') }); };
    const form = el('div', null, [
      input('name', 'Campaign name', 'e.g. Reefer carriers — Google'),
      input('source', 'Source (utm_source)', 'google'),
      input('medium', 'Medium (utm_medium)', 'cpc'),
      input('campaign', 'Campaign code (utm_campaign)', 'reefer_q3'),
      input('landing', 'Landing page', '/carriers'),
      el('div', { class: 'cc-field' }, [el('span', null, 'Your tracking link'), preview]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Create campaign')]),
    ]);
    ['name', 'source', 'medium', 'campaign', 'landing'].forEach(k => fields[k].addEventListener('input', upd));
    upd();
    openDrawer('New campaign', form, { subtitle: 'UTM-tracked marketing link' });

    async function save() {
      const name = fields.name.value.trim(), campaign = fields.campaign.value.trim();
      if (!name || !campaign) { alert('Campaign name and code are required.'); return; }
      try { await createCampaign({ name, source: fields.source.value.trim() || null, medium: fields.medium.value.trim() || null, campaign, landing: fields.landing.value.trim() || '/' }); }
      catch (e) { alert(humanizeError(e)); return; }
      document.getElementById('cc-drawer-root')?.remove(); load();
    }
  }
}

export default renderCampaigns;
