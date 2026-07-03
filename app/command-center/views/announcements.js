// announcements.js — Control Tower Wave L: Announcements & Broadcast center.
// Send an Info / Warning / Emergency / Promotion message to ALL carriers or one specific
// carrier; it appears in their Carrier Portal (desktop + phone). Toggle active, set expiry.
// Reads/writes via cc_*announcement* RPCs (announce.view / announce.manage), RBAC-gated.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { listAnnouncements, createAnnouncement, setAnnouncementActive, listCarrierOrgs, sendPush } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KIND_TONE = { info: 'blue', warning: 'amber', emergency: 'red', promo: 'violet' };
let _carrierOrgs = null;

export function renderAnnouncements(host) {
  let rows = [];
  const manage = can('announce.manage');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Announcements & Broadcast', 'Send info, warnings, emergencies or promotions to all carriers or a specific carrier. They see it in the Pocket app and portal.',
      manage ? el('div', { class: 'cc-head-actions' }, el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => composer() }, '+ New broadcast')) : null),
    el('div', { id: 'an2-kpis' }),
    el('div', { id: 'an2-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#an2-kpis');
  const body = host.querySelector('#an2-body');
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    try { rows = await listAnnouncements(150); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const active = rows.filter(r => r.active).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'bell', label: 'Live now', value: String(active), sub: 'showing to carriers', accent: 'green' }),
      statCard({ icon: 'flag', label: 'Emergencies', value: String(rows.filter(r => r.kind === 'emergency' && r.active).length), sub: 'active alerts', accent: 'red' }),
      statCard({ icon: 'trend', label: 'Promotions', value: String(rows.filter(r => r.kind === 'promo' && r.active).length), sub: 'active offers', accent: 'violet' }),
      statCard({ icon: 'doc', label: 'Total sent', value: String(rows.length), sub: 'all time', accent: 'blue' }),
    ]));
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No announcements yet. Send your first broadcast.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, [el('th', null, 'Title'), el('th', null, 'Type'), el('th', null, 'Audience'), el('th', null, 'Sent'), el('th', null, 'Expires'), el('th', null, 'Live')])),
      el('tbody', null, rows.map(a => el('tr', null, [
        el('td', null, el('b', null, a.title)),
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (KIND_TONE[a.kind] || 'gray') }, [el('i', { class: 'cc-pill-dot' }), a.kind])),
        el('td', null, a.audience === 'all_carriers' ? 'All carriers' : a.audience === 'carrier' ? 'One carrier' : 'All staff'),
        el('td', null, fmtDateTime(a.created_at)),
        el('td', null, a.expires_at ? fmtDateTime(a.expires_at) : '—'),
        el('td', null, manage
          ? el('button', { class: 'cc-toggle' + (a.active ? ' on' : ''), onClick: async () => { try { await setAnnouncementActive(a.id, !a.active); } catch (e) { alert(humanizeError(e)); return; } load(); } }, a.active ? 'On' : 'Off')
          : statusPill(a.active ? 'active' : 'paused')),
      ]))),
    ])));
  }

  async function composer() {
    if (!_carrierOrgs) { try { _carrierOrgs = await listCarrierOrgs(); } catch (_) { _carrierOrgs = []; } }
    const fields = {};
    const input = (k, label, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '' }); fields[k] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const bodyIn = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Message to carriers…' });
    const kindSel = el('select', { class: 'cc-input' }, ['info', 'warning', 'emergency', 'promo'].map(k => el('option', { value: k }, k.charAt(0).toUpperCase() + k.slice(1))));
    const audSel = el('select', { class: 'cc-input' }, [el('option', { value: 'all_carriers' }, 'All carriers'), el('option', { value: 'carrier' }, 'One specific carrier')]);
    const carrierSel = el('select', { class: 'cc-input', hidden: true }, [el('option', { value: '' }, 'Select carrier…')].concat((_carrierOrgs || []).map(c => el('option', { value: c.id }, c.name))));
    audSel.addEventListener('change', () => { carrierSel.hidden = audSel.value !== 'carrier'; });
    const expIn = el('input', { class: 'cc-input', type: 'date' });
    const pushChk = el('input', { type: 'checkbox', checked: true, style: 'width:18px;height:18px' });
    const form = el('div', null, [
      input('title', 'Title', 'e.g. Winter storm — I-80 delays'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Message'), bodyIn]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Type'), kindSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Audience'), audSel]),
      carrierSel,
      el('label', { class: 'cc-field' }, [el('span', null, 'Expires (optional)'), expIn]),
      el('label', { style: 'display:flex;align-items:center;gap:9px;margin-top:6px;font-size:.9rem;cursor:pointer' }, [pushChk, el('span', null, 'Also send as a push notification to their device')]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: send }, 'Send broadcast')]),
      el('p', { class: 'cc-sub', style: 'margin-top:8px' }, 'Carriers see this in the Carrier portal (top banner). With push on, it also pops up on their device. Emergencies appear first, in red.'),
    ]);
    openDrawer('New broadcast', form, { subtitle: 'Announce to carriers' });

    async function send() {
      const title = fields.title.value.trim();
      if (!title) { alert('Title is required.'); return; }
      if (audSel.value === 'carrier' && !carrierSel.value) { alert('Pick a carrier.'); return; }
      try {
        await createAnnouncement({ title, body: bodyIn.value.trim() || null, kind: kindSel.value, audience: audSel.value,
          targetOrg: audSel.value === 'carrier' ? carrierSel.value : null, expiresAt: expIn.value ? new Date(expIn.value).toISOString() : null });
      } catch (e) { alert(humanizeError(e)); return; }
      if (pushChk.checked) {
        try {
          const r = await sendPush({ title, body: bodyIn.value.trim() || '', url: '/app/carrier/',
            audience: audSel.value === 'all_carriers' ? 'all_carriers' : null,
            org: audSel.value === 'carrier' ? carrierSel.value : null });
          toast('Broadcast sent — push delivered to ' + ((r && r.sent) || 0) + ' device(s).', 'success');
        } catch (e) { toast('Announcement saved, but push failed: ' + humanizeError(e), 'error'); }
      } else { toast('Broadcast sent.', 'success'); }
      document.getElementById('cc-drawer-root')?.remove(); load();
    }
  }
}

export default renderAnnouncements;
