// deliveryHealth.js — Command Center view over the UNIFIED delivery engine (cvb/cvc/cvd).
// One delivery ledger for every channel: shows the live status histogram, a filterable recent-deliveries
// table (attempts column exposes retry progress), dead-letter isolation, and the suppression list with
// manual add. Bounces/complaints auto-suppress server-side; failed sends retry up to 5× then dead-letter.
// Staff-gated by cc_delivery_* RPCs (content.manage OR settings.manage).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime, askReason, askConfirm } from '../../shared/ui/components.js';
import { deliveryHealth, deliveryList, suppressionsList, suppress, deliveryReleaseDue, commTriggers, setCommTrigger, studioListTemplates, pipelineHealth } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST_TONE = { queued: 'blue', scheduled: 'blue', claimed: 'amber', sent: 'green', delivered: 'green',
  opened: 'green', clicked: 'green', bounced: 'red', complained: 'red', unsubscribed: 'gray', failed: 'amber', dead_letter: 'red' };
const FILTERS = [['', 'All'], ['queued', 'Queued'], ['delivered', 'Delivered'], ['failed', 'Retrying'], ['dead_letter', 'Dead letter'], ['bounced', 'Bounced']];

export function renderDeliveryHealth(host) {
  const manage = can('content.manage') || can('settings.manage');
  let statusFilter = '';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  const suppBox = el('div', { class: 'cc-table-wrap', style: 'margin-top:18px' });
  const autoBox = el('div', { style: 'margin-top:8px' });
  const pipeStrip = el('div', { style: 'margin:8px 0' });
  const filterBar = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:10px 0' },
    FILTERS.map(([v, l]) => el('button', { class: 'cc-chip-btn' + (v === statusFilter ? ' on' : ''), onClick: () => { statusFilter = v; renderFilters(); loadTable(); } }, l)));
  function renderFilters() { [...filterBar.children].forEach((b, i) => b.classList.toggle('on', FILTERS[i][0] === statusFilter)); }

  const headActions = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: releaseDue }, 'Release due scheduled') : null;
  mount(host, el('div', null, [
    sectionHead('Delivery Health', 'Every campaign & transactional message flows through one delivery ledger. Bounces and complaints auto-suppress; failed sends retry up to 5× then move to dead letter.', headActions),
    kpis, pipeStrip, filterBar, body,
    sectionHead('Suppression list', 'Hard opt-outs, bounces and complaints. Suppressed addresses are excluded from every future send.',
      manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: addSuppression }, '+ Suppress address') : null),
    suppBox,
    sectionHead('Automations', 'Fire an acknowledgement automatically when a domain event happens (e.g. a website form is submitted). Off until you activate it.'),
    autoBox,
  ]));
  loadHealth(); loadTable(); loadSupp(); loadAutomations(); loadPipeline();

  async function loadPipeline() {
    let p; try { p = await pipelineHealth(); } catch (_) { return; }
    if (!p) return;
    const wq = Number((p.webhook_deliveries || {}).queued || 0);
    const wf = Number((p.webhook_deliveries || {}).failed || 0);
    const ep = Number((p.domain_events || {}).pending || 0);
    const inflight = Number(p.campaigns_in_flight || 0);
    const chip = (label, val, warn) => el('span', { class: 'cc-pill cc-pill-' + (warn && val > 0 ? 'amber' : 'gray'), style: 'margin-right:8px' }, label + ': ' + val);
    mount(pipeStrip, el('div', { class: 'cc-sub', style: 'display:flex;flex-wrap:wrap;align-items:center' }, [
      el('span', { style: 'margin-right:8px;font-weight:600' }, 'Pipeline backlog —'),
      chip('events pending', ep, true), chip('webhooks queued', wq, false), chip('webhooks failed', wf, true),
      chip('campaigns in flight', inflight, false),
    ]));
  }

  async function loadAutomations() {
    if (!manage) { mount(autoBox, el('div', { class: 'cc-sub' }, 'Read-only.')); return; }
    showLoading(autoBox, 'Loading automations…');
    let trigs, tpls;
    try { [trigs, tpls] = await Promise.all([commTriggers(), studioListTemplates().catch(() => [])]); }
    catch (e) { showError(autoBox, humanizeError(e), loadAutomations); return; }
    const existing = (trigs || []).find(t => t.event_type === 'form.submitted' && t.channel === 'email') || { template_key: '', subject: '', active: false };
    const tplSel = el('select', { class: 'cc-input', style: 'max-width:260px' },
      [el('option', { value: '' }, 'Select a template…')].concat((tpls || []).map(t => el('option', { value: t.key, selected: existing.template_key === t.key ? 'selected' : null }, t.name || t.key))));
    const subj = el('input', { class: 'cc-input', placeholder: 'Subject override (optional)', value: existing.subject || '' });
    const activeChip = el('button', { class: 'cc-chip-btn' + (existing.active ? ' on' : '') }, existing.active ? 'Active' : 'Inactive');
    let active = !!existing.active;
    activeChip.onclick = () => { active = !active; activeChip.classList.toggle('on'); activeChip.textContent = active ? 'Active' : 'Inactive'; };
    const save = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async () => {
      if (active && !tplSel.value) { toast('Pick a template to activate', 'error'); return; }
      try { await setCommTrigger({ event: 'form.submitted', channel: 'email', templateKey: tplSel.value || null, subject: subj.value || null, active }); toast('Automation saved', 'success'); loadAutomations(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Save automation');
    mount(autoBox, el('div', { class: 'lb-card' }, [
      el('div', { style: 'font-weight:700' }, 'Website form → acknowledgement email'),
      el('div', { class: 'cc-sub', style: 'margin:4px 0 10px' }, 'When any website form is submitted, auto-send this template to the submitter (consent + suppression still apply).'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [tplSel, activeChip]),
      subj,
      el('div', { style: 'margin-top:10px' }, save),
    ]));
  }

  async function loadHealth() {
    let h; try { h = await deliveryHealth(); } catch (e) { mount(kpis, el('div', { class: 'lb-state' }, humanizeError(e))); return; }
    h = h || {};
    const g = (k) => Number(h[k] || 0);
    const delivered = g('delivered') + g('sent') + g('opened') + g('clicked');
    const pending = g('queued') + g('scheduled') + g('claimed');
    mount(kpis, [
      statCard({ icon: 'bell', label: 'Pending', value: String(pending), sub: 'queued / claimed', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Delivered', value: String(delivered), sub: 'sent & confirmed', accent: 'green' }),
      statCard({ icon: 'trend', label: 'Bounced / complained', value: String(g('bounced') + g('complained')), sub: 'auto-suppressed', accent: 'amber' }),
      statCard({ icon: 'document', label: 'Dead letter', value: String(g('dead_letter')), sub: 'exhausted retries', accent: 'red' }),
    ]);
  }

  async function loadTable() {
    showLoading(body, 'Loading deliveries…');
    let rows; try { rows = await deliveryList({ status: statusFilter || null, limit: 200 }); } catch (e) { showError(body, humanizeError(e), loadTable); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No deliveries' + (statusFilter ? ' with status “' + statusFilter + '”.' : ' yet.'))); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Recipient', 'Channel', 'Status', 'Attempts', 'Scheduled', 'Sent', 'Failure'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(d => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, d.recipient_email || '—')),
        el('td', null, (d.channel || '') + (d.provider ? ' · ' + d.provider : '')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[d.status] || 'gray') }, d.status)),
        el('td', null, String(d.attempts || 0)),
        el('td', null, el('span', { class: 'cc-sub' }, d.scheduled_at ? fmtDateTime(d.scheduled_at) : '—')),
        el('td', null, el('span', { class: 'cc-sub' }, d.sent_at ? fmtDateTime(d.sent_at) : '—')),
        el('td', null, el('span', { class: 'cc-sub', style: d.failure_reason ? 'color:#b45309' : '' }, d.failure_reason || '')),
      ]))),
    ]));
  }

  async function loadSupp() {
    showLoading(suppBox, 'Loading suppressions…');
    let rows; try { rows = await suppressionsList({ limit: 300 }); } catch (e) { showError(suppBox, humanizeError(e), loadSupp); return; }
    rows = rows || [];
    if (!rows.length) { mount(suppBox, el('div', { class: 'lb-state' }, 'No suppressed addresses.')); return; }
    mount(suppBox, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Address', 'Channel', 'Reason', 'Since'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(s => el('tr', { class: 'cc-row' }, [
        el('td', null, el('b', null, s.address)),
        el('td', null, s.channel),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (s.reason === 'manual' ? 'gray' : 'red') }, s.reason || '—')),
        el('td', null, el('span', { class: 'cc-sub' }, fmtDateTime(s.created_at))),
      ]))),
    ]));
  }

  async function releaseDue() {
    try { const n = await deliveryReleaseDue(null); toast(n ? ('Released ' + n + ' scheduled → queued') : 'No due scheduled messages', 'success'); loadHealth(); loadTable(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function addSuppression() {
    const addr = await askReason('Email address to suppress (excluded from all future sends):');
    if (!addr || !addr.trim()) return;
    try { await suppress('email', addr.trim(), 'manual'); toast('Address suppressed', 'success'); loadSupp(); loadHealth(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }
}

export default renderDeliveryHealth;
