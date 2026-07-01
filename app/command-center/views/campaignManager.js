// campaignManager.js — Campaign Manager (Phase 3C). Compose a campaign from a saved
// audience + template + channels, schedule it, and send. Push channel sends for real
// via the existing staff-gated push-send (reusing the broadcast pipeline); email/SMS
// route through the delivery engine (Phase 3D). A broad send always confirms the
// recipient count first.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { cmpList, cmpSave, cmpSetStatus, cmpMarkSent, listAudiences, studioListTemplates, audienceEstimate, sendPush } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST_TONE = { draft: 'gray', scheduled: 'blue', sending: 'amber', sent: 'green', paused: 'amber' };
const CHANNELS = ['push', 'email', 'sms', 'portal'];
const CARRIER_AUD = ['all_carriers', 'active_carriers', 'pending_carriers', 'onboarding_pending', 'carrier_owners', 'drivers'];

export function renderCampaignManager(host) {
  const manage = can('campaigns.view') || can('content.manage') || can('settings.manage');
  let audiences = [], templates = [];
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Campaigns', 'Compose, schedule and send to a saved audience. Push sends for real; email/SMS route through the delivery engine.',
      manage ? el('div', { class: 'cc-head-actions' }, el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => composer(null) }, '+ New campaign')) : null),
    kpis, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Loading campaigns…');
    let rows;
    try { [rows, audiences, templates] = await Promise.all([cmpList(), listAudiences().catch(() => []), studioListTemplates().catch(() => [])]); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'trend', label: 'Campaigns', value: String(rows.length), sub: 'all time', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Scheduled', value: String(rows.filter(r => r.status === 'scheduled').length), sub: 'queued', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Sent', value: String(rows.filter(r => r.status === 'sent').length), sub: rows.reduce((a, r) => a + (r.sent_count || 0), 0) + ' delivered', accent: 'green' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No campaigns yet. Create your first one.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Campaign', 'Audience', 'Channels', 'Status', 'Schedule / sent', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(c => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, c.name), c.objective ? el('div', { class: 'cc-sub' }, c.objective) : '']),
        el('td', null, c.audience_name || '—'),
        el('td', null, (c.channels || []).join(', ')),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[c.status] || 'gray') }, c.status)),
        el('td', null, el('span', { class: 'cc-sub' }, c.sent_at ? 'sent ' + fmtDateTime(c.sent_at) + ' · ' + (c.sent_count || 0) : (c.scheduled_at ? 'for ' + fmtDateTime(c.scheduled_at) : '—'))),
        el('td', null, manage ? rowActions(c) : ''),
      ]))),
    ]));
  }

  function rowActions(c) {
    const wrap = el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' });
    wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); composer(c); } }, 'Edit'));
    if (c.status !== 'sent' && (c.channels || []).includes('push')) wrap.append(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (e) => { e.stopPropagation(); sendPushCampaign(c); } }, 'Send push'));
    return wrap;
  }

  async function sendPushCampaign(c) {
    if (!c.audience_type) { toast('Attach an audience first.', 'error'); return; }
    const pushAud = CARRIER_AUD.includes(c.audience_type) ? 'all_carriers' : (c.audience_type === 'all_staff' ? 'all_staff' : null);
    if (!pushAud) { toast('Push is only available for carrier or staff audiences.', 'error'); return; }
    let est = '?'; try { est = (await audienceEstimate(c.audience_type)).count; } catch (_) {}
    if (!confirm('Send push to “' + (c.audience_name || c.audience_type) + '” (~' + est + ' recipients with notifications on)?\n\nTitle: ' + (c.subject || c.name))) return;
    try {
      const r = await sendPush({ audience: pushAud, title: c.subject || c.name, body: c.body || '', url: '/app/carrier/' });
      await cmpMarkSent(c.id, (r && r.sent) || 0);
      toast('Push delivered to ' + ((r && r.sent) || 0) + ' device(s).', 'success'); load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  function composer(c) {
    const f = { id: c ? c.id : null, name: c ? c.name : '', objective: c ? (c.objective || '') : '', audienceId: c ? c.audience_id : '', templateKey: c ? (c.template_key || '') : '', channels: c ? (c.channels || ['push']) : ['push'], subject: c ? (c.subject || '') : '', body: c ? (c.body || '') : '', scheduledAt: c && c.scheduled_at ? c.scheduled_at.slice(0, 16) : '', status: c ? (c.status || 'draft') : 'draft' };
    const inp = (label, key, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '', value: f[key] }); i.oninput = () => { f[key] = i.value; }; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const audSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select audience…')].concat(audiences.map(a => el('option', { value: a.id, selected: f.audienceId === a.id ? 'selected' : null }, a.name)))); audSel.onchange = () => { f.audienceId = audSel.value; };
    const tplSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'No template')].concat(templates.map(t => el('option', { value: t.key, selected: f.templateKey === t.key ? 'selected' : null }, t.name || t.key)))); tplSel.onchange = () => { f.templateKey = tplSel.value; const t = templates.find(x => x.key === tplSel.value); if (t) { if (!f.subject) { f.subject = t.subject || ''; subj.value = f.subject; } if (!f.body) { f.body = t.body_text || t.body || ''; bodyT.value = f.body; } } };
    const chWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:7px' }, CHANNELS.map(ch => { const on = f.channels.includes(ch); const b = el('button', { class: 'cc-chip-btn' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.channels); if (s.has(ch)) s.delete(ch); else s.add(ch); f.channels = [...s]; b.classList.toggle('on'); } }, ch); return b; }));
    const subj = el('input', { class: 'cc-input', placeholder: 'Subject / push title', value: f.subject }); subj.oninput = () => { f.subject = subj.value; };
    const bodyT = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Message body' }, f.body); bodyT.oninput = () => { f.body = bodyT.value; };
    const sched = el('input', { class: 'cc-input', type: 'datetime-local', value: f.scheduledAt }); sched.oninput = () => { f.scheduledAt = sched.value; };
    const statSel = el('select', { class: 'cc-input' }, [['draft', 'Draft'], ['scheduled', 'Scheduled'], ['paused', 'Paused']].map(([v, l]) => el('option', { value: v, selected: f.status === v ? 'selected' : null }, l))); statSel.onchange = () => { f.status = statSel.value; };
    const form = el('div', null, [
      inp('Campaign name', 'name', 'June carrier newsletter'), inp('Objective', 'objective', 'Re-engage idle carriers'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Audience'), audSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Template (optional)'), tplSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Channels'), chWrap]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Subject / title'), subj]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Body'), bodyT]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Schedule (optional)'), sched]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Status'), statSel]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Save campaign')]),
      el('p', { class: 'cc-sub', style: 'margin-top:8px' }, 'Push sends immediately from the list (with a recipient-count confirmation). Email/SMS delivery arrives with the delivery engine.'),
    ]);
    openDrawer(c ? 'Edit campaign' : 'New campaign', form, { subtitle: 'Audience + template + channels' });
    async function save() {
      if (!f.name.trim()) { alert('Campaign name is required.'); return; }
      if (f.scheduledAt) f.scheduledAt = new Date(f.scheduledAt).toISOString();
      try { await cmpSave(f); toast('Campaign saved', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
      catch (e) { alert(humanizeError(e)); }
    }
  }
}

export default renderCampaignManager;
