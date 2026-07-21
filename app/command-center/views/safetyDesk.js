// safetyDesk.js — Operations Safety desk: live trip emergencies (Safety v2, design LOCKED).
// Open incidents first, live location block, proof list, Acknowledge -> carrier notified,
// Verify genuine -> approve reschedule -> carrier + broker notified (bell + email).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, card } from '../../shared/ui/components.js';
import { safetyIncidents, ackIncident, approveIncidentReschedule } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderSafetyDesk(host) {
  const listHost = el('div');
  async function load() {
    showLoading(listHost, 'Loading incidents…');
    let rows;
    try { rows = await safetyIncidents(null); } catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No incidents. When a driver reports an emergency on a trip, it lands here the same second — with live GPS and proof.'); return; }
    mount(listHost, el('div', null, rows.map(r => {
      const open = r.status === 'open';
      const acked = r.status === 'acknowledged';
      const done = r.status === 'reschedule_approved' || r.status === 'resolved';
      const tone = open ? '#dc2626' : acked ? '#d97706' : '#16a34a';
      const winIn = el('input', { class: 'cc-input', placeholder: 'New delivery window — e.g. Jul 6, 08:00-12:00', style: 'flex:1;min-width:220px' });
      const noteIn = el('input', { class: 'cc-input', placeholder: 'Verification note (optional)', style: 'flex:1;min-width:180px' });
      const ackBtn = open ? el('button', { class: 'cc-btn', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        _btn9.disabled = true; _btn9.textContent = 'Acknowledging…';
        try { await ackIncident(r.id); toast('Carrier notified: Dispatch is responding.'); load(); }
        catch (e) { _btn9.disabled = false; _btn9.textContent = 'Acknowledge & respond'; toast(humanizeError(e), true); }
      } }, 'Acknowledge & respond') : null;
      const apprBtn = (open || acked) ? el('button', { class: 'cc-btn primary', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        if (!winIn.value.trim()) { toast('Set the new delivery window first (driver downtime + remaining transit).', true); return; }
        _btn9.disabled = true; _btn9.textContent = 'Approving…';
        try { await approveIncidentReschedule(r.id, winIn.value.trim(), noteIn.value || null); toast('Verified — carrier and broker notified (bell + email).'); load(); }
        catch (e) { _btn9.disabled = false; _btn9.textContent = 'Verify genuine — approve reschedule'; toast(humanizeError(e), true); }
      } }, 'Verify genuine — approve reschedule') : null;
      return card([
        el('div', { style: 'display:flex;align-items:center;gap:9px;flex-wrap:wrap' }, [
          el('span', { style: 'font-weight:800;font-size:.95rem' }, '🚨 ' + String(r.itype || '').replace('_', ' ') + ' — ' + (r.carrier || 'Carrier')),
          el('span', { class: 'cc-pill', style: 'background:' + tone + '1c;color:' + tone }, open ? 'OPEN' : acked ? 'ACKNOWLEDGED' : r.status.replace('_', ' ').toUpperCase()),
          el('span', { class: 'cc-sub', style: 'margin-left:auto' }, new Date(r.created_at).toLocaleString()),
        ]),
        el('div', { class: 'cc-sub', style: 'margin-top:5px' }, 'Trip: ' + (r.lane || r.trip_id) + ' · needs: ' + r.need + (r.note ? ' · note: ' + r.note : '')),
        el('div', { style: 'margin-top:7px;border-radius:9px;background:#0f172a;color:#93c5fd;padding:8px 11px;font-size:.8rem;font-weight:700' },
          '📍 LIVE LOCATION — ' + (r.location_text || (Number(r.lat).toFixed(4) + ', ' + Number(r.lng).toFixed(4))) + (r.accuracy_m ? ' · accuracy ' + Math.round(r.accuracy_m) + ' m' : '') + ' · maps.google.com/?q=' + r.lat + ',' + r.lng),
        (r.proof_paths && r.proof_paths.length)
          ? el('div', { class: 'cc-sub', style: 'margin-top:5px' }, 'Proof on file: ' + r.proof_paths.length + ' item(s) — stored with the trip documents.')
          : el('div', { class: 'cc-sub', style: 'margin-top:5px;color:#d97706' }, 'No proof attached yet — verify by call-back + GPS trail before approving.'),
        done ? el('div', { class: 'cc-sub', style: 'margin-top:6px;color:#16a34a;font-weight:700' }, '✓ ' + (r.status === 'reschedule_approved' ? 'Reschedule approved — carrier & broker notified. No carrier penalty per policy.' : 'Resolved.'))
             : el('div', { style: 'display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;align-items:center' }, [ackBtn, winIn, noteIn, apprBtn].filter(Boolean)),
      ]);
    })));
  }
  mount(host, el('div', null, [
    sectionHead('Safety desk', 'Live trip emergencies — verify genuine (GPS trail + proof + call-back + history), then reschedule per the Emergency Rescheduling Policy. Every action notifies the carrier; approvals notify the broker too.'),
    listHost,
  ]));
  load();
}
