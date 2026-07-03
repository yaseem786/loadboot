// bookingRequests.js — staff queue of carrier requests to book loads. Approve books the
// load for the requesting carrier (creates the trip); decline notifies them. Staff see the
// real carrier name plus the anonymized-style trust profile (verified badge, rating, score).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, card, money } from '../../shared/ui/components.js';
import { bookRequestsQueue, decideBookRequest } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderBookingRequests(host) {
  const listHost = el('div', { class: 'cc-table-wrap' });

  async function load() {
    showLoading(listHost, 'Loading booking requests…');
    let rows;
    try { rows = await bookRequestsQueue('pending'); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!rows || !rows.length) { showEmpty(listHost, 'No pending booking requests. When a carrier requests to book a load, it appears here for approval.'); return; }
    mount(listHost, el('div', null, rows.map(r => {
      const t = r.trust || {};
      const stars = t.rating ? '★'.repeat(Math.round(t.rating)) + '☆'.repeat(5 - Math.round(t.rating)) : '';
      const note = el('input', { class: 'cc-input', placeholder: 'Optional note to the carrier…' });
      const decide = (action, ev) => {
        const btn = ev.currentTarget; btn.disabled = true; btn.textContent = '…';
        decideBookRequest(r.id, action, note.value || null)
          .then(() => { toast('Request ' + action + 'd', 'success'); load(); })
          .catch(e => { btn.disabled = false; btn.textContent = action === 'approve' ? 'Approve & book' : 'Decline'; toast(humanizeError(e), 'error'); });
      };
      return card([
        el('div', { style: 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;align-items:flex-start' }, [
          el('div', null, [
            el('h4', { class: 'cc-card-title' }, (r.origin || '—') + ' → ' + (r.destination || '—')),
            el('div', { class: 'cc-sub' }, [r.equipment, r.rate != null ? money(r.rate) : null].filter(Boolean).join(' · ')),
          ]),
          el('div', { style: 'text-align:right' }, [
            el('span', { class: 'cc-pill cc-pill-' + (t.verified ? 'green' : 'amber') }, t.verified ? '✓ ' + (t.verified_label || 'Verified') : 'Unverified'),
            el('div', { style: 'color:#f59e0b;font-weight:700;margin-top:4px' }, stars + ' ' + (t.rating || 0)),
          ]),
        ]),
        el('div', { class: 'cc-sub', style: 'margin-top:6px' },
          (r.carrier || 'Carrier') + ' · Trust ' + (t.trust_score || 0) + '/100 · ' + (t.docs_verified || 0) + '/' + (t.docs_required || 0) + ' docs verified'
          + (t.on_time_pct != null ? (' · ' + t.on_time_pct + '% on-time') : '') + (t.deliveries != null ? (' · ' + t.deliveries + ' deliveries') : '')),
        r.note ? el('div', { class: 'cc-sub' }, 'Carrier note: ' + r.note) : '',
        note,
        el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [
          el('button', { class: 'lb-btn lb-btn-primary', onClick: (e) => decide('approve', e) }, 'Approve & book'),
          el('button', { class: 'lb-btn lb-btn-secondary', onClick: (e) => decide('reject', e) }, 'Decline'),
        ]),
      ], 'lb-card');
    })));
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Booking requests', 'Carriers requesting to book loads — approve or decline after reviewing their verified trust profile.'),
    listHost,
  ]));
  load();
}

export default renderBookingRequests;
