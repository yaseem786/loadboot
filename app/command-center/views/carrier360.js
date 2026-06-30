// carrier360.js — Control Tower Wave B: Carrier 360 record page.
// One screen that ties together everything already in the system for a single carrier:
// profile, compliance, safety grade, documents, drivers, trips, finance, and an audit
// timeline — each section linking back into the module it came from. Read-only aggregate
// via cc_carrier_360 (keyed on the carrier organization id), RBAC-gated on carriers.view.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, money, fmtDate, fmtDateTime } from '../../shared/ui/components.js';
import { carrier360, fmcsaVerify } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderCarrier360(host, orgId) {
  mount(host, el('div', { class: 'cc-view' }, [
    el('a', { class: 'cc-back', href: '#/carriers' }, '← Back to carriers'),
    el('div', { id: 'c3-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading carrier…')),
  ]));
  const body = host.querySelector('#c3-body');
  if (!orgId) { mount(body, el('div', { class: 'cc-sub' }, 'No carrier selected.')); return; }
  load();

  async function load() {
    let d;
    try { d = await carrier360(orgId); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    const p = d.profile || {};
    const sc = d.safety || {};
    const ts = d.trips_summary || {};
    const fin = d.finance || {};

    const head = sectionHead(d.name || 'Carrier', (p.mc ? 'MC ' + p.mc + ' · ' : '') + (p.dot ? 'DOT ' + p.dot + ' · ' : '') + (p.home_base || ''),
      el('div', { class: 'cc-head-actions' }, [statusPill(d.status || 'unknown')]));

    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'shield', label: 'Compliance', value: d.compliance_ok ? 'OK' : 'Gap', sub: (d.onboarding && d.onboarding.stage) || 'not started', accent: d.compliance_ok ? 'green' : 'amber' }),
      statCard({ icon: 'check', label: 'Safety grade', value: sc.grade || '—', sub: 'score ' + (sc.score ?? '—') + (sc.on_time_pct != null ? ' · ' + sc.on_time_pct + '% OT' : ''), accent: 'blue' }),
      statCard({ icon: 'truck', label: 'Trips', value: String(ts.total || 0), sub: (ts.active || 0) + ' active · ' + (ts.delivered || 0) + ' delivered', accent: 'violet' }),
      statCard({ icon: 'doc', label: 'Fees paid', value: money(fin.fees_paid || 0), sub: money(fin.fees_outstanding || 0) + ' outstanding', accent: 'green' }),
    ]);

    const profileCard = card([
      el('h4', { class: 'cc-card-title' }, 'Carrier profile'),
      kv('Contact', p.contact_name), kv('Email', p.email), kv('Phone', p.phone),
      kv('Equipment', Array.isArray(p.equipment_types) ? p.equipment_types.join(', ') : (p.equipment || '—')),
      kv('Trucks', p.truck_count != null ? String(p.truck_count) : '—'),
      kv('Factoring', p.factoring_status || '—'),
    ]);

    const fmcsaStatus = el('div', { class: 'cc-sub', style: 'margin-top:8px' });
    const canVerify = can('compliance.edit') || can('carriers.edit') || can('carriers.approve');
    const verifyBtn = canVerify ? el('button', { class: 'lb-btn lb-btn-secondary lb-btn-sm', onClick: async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'Verifying…'; fmcsaStatus.textContent = '';
      if (!p.dot && !p.mc) { fmcsaStatus.textContent = 'No DOT or MC number on file to verify.'; btn.disabled = false; btn.textContent = 'Verify with FMCSA'; return; }
      try {
        const res = await fmcsaVerify({ carrierOrg: orgId, dot: p.dot, mc: p.mc });
        const c = res.carrier || {};
        fmcsaStatus.style.color = '#16a34a';
        fmcsaStatus.textContent = '✓ FMCSA: ' + (c.legalName || '—') + ' · authority ' + (c.authority || '—') + ' · rating ' + (c.safetyRating || 'none') + (res.saved ? ' · saved' : '');
        setTimeout(load, 800);
      } catch (e) { fmcsaStatus.style.color = '#dc2626'; fmcsaStatus.textContent = humanizeError(e); }
      btn.disabled = false; btn.textContent = 'Verify with FMCSA';
    } }, 'Verify with FMCSA') : '';
    const safetyCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Safety & authority'), verifyBtn]),
      kv('Authority', sc.authority_status || 'unknown'),
      kv('Safety rating', sc.safety_rating || 'none'),
      kv('Out of service', sc.out_of_service ? 'YES' : 'No'),
      kv('On-time delivery', sc.on_time_pct != null ? sc.on_time_pct + '%' : '—'),
      fmcsaStatus,
    ]);

    const docs = d.documents || [];
    const docsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Documents (' + docs.length + ')'),
      docs.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Type'), el('th', null, 'File'), el('th', null, 'Status'), el('th', null, 'Added')])),
        el('tbody', null, docs.map(x => el('tr', null, [el('td', null, x.type || '—'), el('td', null, x.file_name || '—'), el('td', null, statusPill(x.status)), el('td', null, fmtDate(x.created_at))]))),
      ]) : el('div', { class: 'cc-sub' }, 'No documents on file.'),
    ]);

    const drivers = d.drivers || [];
    const driversCard = card([
      el('h4', { class: 'cc-card-title' }, 'Drivers (' + drivers.length + ')'),
      drivers.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Name'), el('th', null, 'Phone'), el('th', null, 'License exp'), el('th', null, 'Medical exp')])),
        el('tbody', null, drivers.map(x => el('tr', null, [el('td', null, el('b', null, x.name)), el('td', null, x.phone || '—'), el('td', null, fmtDate(x.license_exp)), el('td', null, fmtDate(x.medical_exp))]))),
      ]) : el('div', { class: 'cc-sub' }, 'No drivers recorded.'),
    ]);

    const trips = d.recent_trips || [];
    const tripsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Recent trips'),
      trips.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Status'), el('th', null, 'Rate'), el('th', null, 'Scheduled delivery'), el('th', null, 'Delivered')])),
        el('tbody', null, trips.map(x => el('tr', null, [el('td', null, statusPill(x.status)), el('td', null, money(x.rate || 0)), el('td', null, fmtDateTime(x.scheduled_delivery)), el('td', null, x.delivered_at ? fmtDateTime(x.delivered_at) : '—')]))),
      ]) : el('div', { class: 'cc-sub' }, 'No trips yet.'),
    ]);

    const tl = d.timeline || [];
    const timelineCard = card([
      el('h4', { class: 'cc-card-title' }, 'Activity timeline'),
      tl.length ? el('div', { class: 'cc-timeline' }, tl.map(e => el('div', { class: 'cc-tl-row' }, [
        el('span', { class: 'cc-tl-dot' }), el('div', null, [el('b', null, e.action), el('div', { class: 'cc-sub' }, (e.summary || '') + ' · ' + fmtDateTime(e.at))]),
      ]))) : el('div', { class: 'cc-sub' }, 'No audit activity yet.'),
    ]);

    mount(body, el('div', null, [
      head, kpis,
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [profileCard, safetyCard]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [docsCard, driversCard]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [tripsCard, timelineCard]),
    ]));
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderCarrier360;
