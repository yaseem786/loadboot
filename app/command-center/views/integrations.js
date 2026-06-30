// integrations.js — Wave 8 Integrations / Webhooks. Connected integrations, outbound webhook
// endpoints (https-only) subscribed to domain events, and a delivery queue. Reads/writes via
// cc_integration* / cc_*endpoint* / cc_*deliver* RPCs (integrations.view/manage), RBAC-gated +
// audited. SAFETY: deliveries are QUEUED only — nothing is transmitted to an external URL here.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, segmented, toolbar, openDrawer, fmtDateTime, card } from '../../shared/ui/components.js';
import { integrationsOverview, listIntegrations, listEndpoints, createEndpoint, setEndpointActive, testEndpoint, listDeliveries } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { humanizeError, toast } from '../../shared/errors.js';

const KIND_TONE = { webhook: 'blue', email: 'violet', sms: 'amber', storage: 'gray', crm: 'green' };
const TABS = [{ value: 'catalog', label: 'Integrations' }, { value: 'endpoints', label: 'Webhooks' }, { value: 'deliveries', label: 'Delivery log' }];
const EVENTS = ['carrier.onboarding_started', 'trip.dispatched', 'trip.delivered', 'invoice.paid', 'settlement.created', 'lead.created'];

export function renderIntegrations(host) {
  let tab = 'catalog';
  const kpiHost = el('div');
  const bodyHost = el('div', { class: 'cc-table-wrap' });

  async function loadKpis() {
    let o; try { o = await integrationsOverview(); } catch (e) { mount(kpiHost, ''); return; }
    const n = (k) => Number((o && o[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'refresh', label: 'Connected', value: String(n('connected')), sub: n('available') + ' available', accent: 'green' }),
      statCard({ icon: 'grid', label: 'Active webhooks', value: String(n('endpoints')), sub: 'endpoints', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Queued', value: String(n('queued')), sub: 'pending deliveries', accent: 'amber' }),
      statCard({ icon: 'flag', label: 'Failed', value: String(n('failed')), sub: 'delivery errors', accent: n('failed') > 0 ? 'red' : 'green' }),
    ]));
  }

  function header() {
    const actions = (tab === 'endpoints' && can('integrations.manage')) ? [el('button', { class: 'lb-btn lb-btn-primary', onClick: openCreate }, '+ Add webhook')] : null;
    return el('div', null, [
      sectionHead('Integrations & Webhooks', 'Connect external tools and subscribe webhooks to events. Deliveries are queued for review — never auto-sent.', actions),
      kpiHost,
      toolbar([ segmented(TABS, tab, (v) => { tab = v; route(); }) ]),
    ]);
  }

  function route() { mount(host, el('div', { class: 'cc-view' }, [header(), bodyHost])); if (tab === 'endpoints') loadEndpoints(); else if (tab === 'deliveries') loadDeliveries(); else loadCatalog(); }

  async function loadCatalog() {
    showLoading(bodyHost, 'Loading integrations…');
    let rows; try { rows = await listIntegrations(); } catch (e) { showError(bodyHost, humanizeError(e), loadCatalog); return; }
    mount(bodyHost, el('div', { class: 'cc-kpi-grid' }, (rows || []).map(i => card([
      el('div', { class: 'cc-card-head' }, [el('b', null, i.name), el('span', { class: 'cc-pill cc-pill-' + (KIND_TONE[i.kind] || 'gray') }, i.kind)]),
      el('div', { class: 'cc-status-row', style: 'margin-top:8px' }, [statusPill(i.status)]),
    ]))));
  }

  async function loadEndpoints() {
    showLoading(bodyHost, 'Loading webhooks…');
    let rows; try { rows = await listEndpoints(); } catch (e) { showError(bodyHost, humanizeError(e), loadEndpoints); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No webhook endpoints. Add one to subscribe to events.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Name'), el('th', null, 'URL'), el('th', null, 'Events'), el('th', null, 'Deliveries'), el('th', null, 'Active'), el('th', null, '')])),
      el('tbody', null, rows.map(e => el('tr', null, [
        el('td', null, el('b', null, e.name)),
        el('td', null, el('span', { class: 'cc-sub' }, e.url)),
        el('td', null, (e.event_types || []).length + ' subscribed'),
        el('td', null, String(e.deliveries || 0)),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (e.active ? 'green' : 'gray') }, e.active ? 'on' : 'off')),
        el('td', null, can('integrations.manage') ? el('div', { class: 'cc-status-row' }, [
          chip('Test', async () => { try { await testEndpoint(e.id); toast('Test delivery queued', 'success'); loadEndpoints(); loadKpis(); } catch (x) { toast(humanizeError(x), 'error'); } }),
          chip(e.active ? 'Disable' : 'Enable', async () => { try { await setEndpointActive(e.id, !e.active); toast('Updated', 'success'); loadEndpoints(); loadKpis(); } catch (x) { toast(humanizeError(x), 'error'); } }),
        ]) : ''),
      ]))),
    ]));
  }

  async function loadDeliveries() {
    showLoading(bodyHost, 'Loading deliveries…');
    let rows; try { rows = await listDeliveries({ limit: 200 }); } catch (e) { showError(bodyHost, humanizeError(e), loadDeliveries); return; }
    if (!rows || !rows.length) { showEmpty(bodyHost, 'No deliveries yet. Use “Test” on a webhook to queue one.'); return; }
    mount(bodyHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Endpoint'), el('th', null, 'Event'), el('th', null, 'Status'), el('th', null, 'Note'), el('th', null, 'When')])),
      el('tbody', null, rows.map(d => el('tr', null, [
        el('td', null, el('b', null, d.endpoint)),
        el('td', null, d.event_type),
        el('td', null, statusPill(d.status)),
        el('td', null, el('span', { class: 'cc-sub' }, d.note || '—')),
        el('td', null, fmtDateTime(d.created_at)),
      ]))),
    ]));
  }

  function openCreate() {
    const f = { events: {} };
    const inp = (k, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph }); i.addEventListener('input', () => f[k] = i.value); return i; };
    const evWrap = el('div', { class: 'cc-chip-wrap' }, EVENTS.map(ev => {
      const b = el('button', { class: 'cc-chip-btn', onClick: () => { f.events[ev] = !f.events[ev]; b.classList.toggle('active', f.events[ev]); } }, ev); return b;
    }));
    const err = el('div', { class: 'err' });
    const submit = el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
      err.textContent = ''; if (!f.name || !f.url) { err.textContent = 'Name and https URL required.'; return; }
      const events = Object.keys(f.events).filter(k => f.events[k]);
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Adding…';
      try { await createEndpoint({ name: f.name, url: f.url, eventTypes: events }); toast('Webhook added', 'success'); drawer.close(); loadEndpoints(); loadKpis(); }
      catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Add webhook'; }
    } }, 'Add webhook');
    const drawer = openDrawer('Add webhook', el('div', { class: 'cc-form' }, [
      inp('name', 'Name (e.g. Zapier)'), inp('url', 'https://… endpoint URL'),
      el('label', { class: 'cc-sub' }, 'Subscribe to events'), evWrap, err, submit,
    ]), { subtitle: 'Outbound webhook (https only)' });
  }

  function chip(label, onClick) { return el('button', { class: 'cc-chip-btn', onClick: async (ev) => { ev.currentTarget.disabled = true; await onClick(); } }, label); }

  route(); loadKpis();
}

export default renderIntegrations;
