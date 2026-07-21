// exceptionCenter.js — Exception Center (Increments 52–53). One queue for everything going wrong on active
// trips: auto-detected detention (from REAL arrive/depart stamps — never invented), breakdowns, weather,
// missed appointments. Detention drafts are visible but stay NON-billable until a dispatcher reviews them.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { exceptionCenter, resolveException, detentionScan, emergencyQueue, emergencyReview, accessorialQueue, reviewAccessorial, reinstatementQueue, reviewReinstatement, supportDecideClaim } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KIND_TONE = { detention: 'red', breakdown: 'red', accident: 'red', weather: 'amber', missed_appointment: 'amber', delay: 'amber', layover: 'gray', lumper: 'gray', tonu: 'gray', other: 'gray' };

export function renderExceptionCenter(host) {
  const manage = can('dispatch.manage');
  let filterStatus = 'open';
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  const stSel = el('select', { class: 'cc-input', style: 'max-width:160px' }, [['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']].map(([v, l]) => el('option', { value: v }, l)));
  stSel.onchange = () => { filterStatus = stSel.value; load(); };
  const scanBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
    const _btn9 = ev.currentTarget;
    _btn9.disabled = true;
    try { const r = await detentionScan(); toast(r.detected ? r.detected + ' detention case(s) detected — drafts created for review' : 'No new detention — all stops within free time', r.detected ? 'success' : 'info'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
    _btn9.disabled = false;
  } }, 'Run detention scan') : null;
  const emCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  const claimsCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  const appealCard = el('div', { class: 'lb-card', style: 'margin:10px 0' });
  mount(host, el('div', null, [
    sectionHead('Exception Center', 'Detention is measured from recorded arrive/depart timestamps and auto-drafted for review — nothing is billed automatically. Every open exception needs an owner and a resolution note.', scanBtn),
    kpis,
    emCard,
    appealCard,
    claimsCard,
    el('div', { style: 'display:flex;gap:8px;margin:10px 0' }, [stSel]),
    body,
  ]));
  load();
  loadEmergencies();
  loadClaims();
  loadAppeals();

  // Reinstatement requests + health plans of action (Amazon-style appeals).
  async function loadAppeals() {
    mount(appealCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '\u25b6 Reinstatement & plan-of-action requests'), el('div', { class: 'cc-sub' }, 'Loading\u2026')]));
    let rows = []; try { rows = await reinstatementQueue() || []; } catch (e) { mount(appealCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '\u25b6 Reinstatement requests'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    if (!rows.length) { mount(appealCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '\u25b6 Reinstatement & plan-of-action requests'), el('div', { class: 'cc-sub' }, 'No open requests \u2014 paused carriers and health-drop answers land here.')])); return; }
    const act = async (id, action, note, btn) => {
      btn.disabled = true;
      try { await reviewReinstatement(id, action, note); toast(action === 'approve' ? 'Approved \u2014 carrier reinstated + notified' : action === 'reject' ? 'Declined \u2014 carrier notified with your note' : action === 'more_info' ? 'Sent back \u2014 carrier asked for more information' : 'Marked in review', 'success'); loadAppeals(); }
      catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; }
    };
    mount(appealCard, el('div', null, [
      el('h3', { style: 'margin:0 0 8px' }, '\u25b6 Reinstatement & plan-of-action requests (' + rows.length + ')'),
      ...rows.map((r) => {
        const atts = Array.isArray(r.attachments) ? r.attachments : [];
        const kindPill = r.kind === 'health_poa'
          ? el('span', { class: 'lb-pill', style: 'background:#fef3c7;color:#92400e' }, 'Health plan of action')
          : el('span', { class: 'lb-pill', style: 'background:#fee2e2;color:#b91c1c' }, 'Paused \u2014 wants reinstatement');
        const row = el('div', { style: 'border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;margin:8px 0' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('b', null, r.carrier || 'Carrier'), kindPill,
            r.status === 'in_review' ? el('span', { class: 'lb-pill', style: 'background:#dbeafe;color:#1d4ed8' }, 'In review') : el('span', { class: 'lb-pill', style: 'background:#f1f5f9;color:#475569' }, 'New'),
            el('span', { class: 'cc-sub' }, fmtDateTime(r.created_at)),
          ]),
          r.pause_reason ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'Paused for: ' + r.pause_reason + (r.pause_scope ? ' (' + r.pause_scope + ')' : '')) : null,
          el('div', { style: 'margin-top:6px;background:#f8fafc;border-radius:8px;padding:8px 10px;font-size:.88rem' }, '\u201c' + (r.message || '') + '\u201d'),
          atts.length ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, '\ud83d\udcce ' + atts.map((a) => (a.file_name || '') + ' (' + (a.type || '') + ')').join(' \u00b7 ') + ' \u2014 files are in the carrier\u2019s document review') : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No documents attached.'),
          el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
            r.status !== 'in_review' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: (ev) => act(r.id, 'in_review', null, ev.currentTarget) }, '\u23f3 Mark in review') : null,
            el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/carrier?id=' + r.carrier_org, style: 'text-decoration:none' }, 'Open 360\u00b0'),
            el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (ev) => {
              if (!confirm(r.kind === 'health_poa' ? 'Accept this plan of action?' : 'Approve \u2014 this reinstates the carrier immediately (booking unblocks, welcome-back email goes out). Continue?')) return;
              act(r.id, 'approve', null, ev.currentTarget);
            } }, r.kind === 'health_poa' ? '\u2713 Accept plan' : '\u2713 Approve & reinstate'),
            el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: (ev) => {
              const note = prompt('\u21a9 Ask for MORE information \u2014 what is missing? (carrier notified + emailed, can submit again):'); if (!note) return;
              act(r.id, 'more_info', note, ev.currentTarget);
            } }, '\u21a9 Need more info'),
            el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: (ev) => {
              const note = prompt('Decline \u2014 reviewer note (carrier sees this + gets email):'); if (!note) return;
              act(r.id, 'reject', note, ev.currentTarget);
            } }, '\u2715 Decline'),
          ].filter(Boolean)),
        ].filter(Boolean));
        return row;
      }),
    ]));
  }

  // Pay claims queue — carrier/auto-filed detention, layover, TONU, lumper with GPS+time evidence.
  async function loadClaims() {
    mount(claimsCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '\ud83d\udcb0 Pay claims — awaiting review'), el('div', { class: 'cc-sub' }, 'Loading…')]));
    let rows = []; try { rows = await accessorialQueue(100) || []; } catch (e) { mount(claimsCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '\ud83d\udcb0 Pay claims'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    const evSum = (ev) => {
      if (!ev) return 'no evidence snapshot';
      const dw = Array.isArray(ev.dwell) ? ev.dwell : [];
      const parts = dw.map(d2 => d2.stop + ': in ' + (d2.arrived_at ? fmtDateTime(d2.arrived_at) : '—') + (d2.departed_at ? ' → out ' + fmtDateTime(d2.departed_at) : ' (still there)')
        + (d2.dwell_minutes != null ? ' · ' + d2.dwell_minutes + ' min' : '') + (d2.gps ? ' · GPS \u2713 (' + (d2.gps.distance_m != null ? d2.gps.distance_m + ' m from stop' : 'recorded') + ')' : ' · no GPS'));
      if (ev.detention_minutes) parts.push('detention: ' + ev.detention_minutes + ' min past free time');
      if (ev.cancelled_from) parts.push('cancelled from status: ' + ev.cancelled_from);
      return parts.join('  |  ') || 'no dwell stamps yet';
    };
    mount(claimsCard, el('div', null, [
      el('h3', { style: 'margin:0 0 8px' }, '\ud83d\udcb0 Pay claims — awaiting review (' + rows.length + ')'),
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, 'Auto-detected detention/TONU and carrier-filed layover/lumper claims. Evidence = the trip\u2019s recorded arrive/depart stamps and GPS. Approve sets the billable amount; reject needs a reason.'),
      rows.length ? el('div', null, rows.map(r => el('div', { style: 'display:flex;justify-content:space-between;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--lb-line,#e2e8f0);flex-wrap:wrap' }, [
        el('div', { style: 'min-width:240px;flex:1' }, [
          el('div', { style: 'font-weight:800' }, (r.kind || '').toUpperCase() + ' — ' + (r.carrier || 'carrier') ),
          el('div', { class: 'cc-sub' }, (r.origin || '—') + ' → ' + (r.destination || '—') + (r.note ? ' · ' + r.note : '')),
          el('div', { class: 'cc-sub', style: 'margin-top:3px;font-size:.78rem' }, '\ud83d\udccb ' + evSum(r.evidence)),
          el('div', { style: 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap' }, [
            r.broker_status === 'approved' ? el('span', { class: 'lb-pill', style: 'background:#e7f9ee;color:#12a150' }, '\u2713 Broker approved') : r.broker_status === 'disputed' ? el('span', { class: 'lb-pill', style: 'background:#fee2e2;color:#b91c1c', title: r.broker_note || '' }, '\u2715 Broker disputed' + (r.broker_note ? ' \u2014 ' + String(r.broker_note).slice(0, 40) : '')) : el('span', { class: 'lb-pill', style: 'background:#f1f5f9;color:#475569' }, '\u23f3 Broker review pending'),
            r.support_status === 'open' ? el('span', { class: 'lb-pill', style: 'background:#dbeafe;color:#1d4ed8' }, '\ud83c\udfa7 ESCALATED \u2014 needs support verdict') : null,
            r.support_status === 'decided' ? el('span', { class: 'lb-pill', style: 'background:#f1f5f9;color:#475569' }, '\u2696 Verdict: ' + (r.support_verdict || '')) : null,
          ].filter(Boolean)),
        ]),
        manage ? el('div', { style: 'display:flex;gap:8px;flex:none' }, [
          el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev2) => {
            const amt = prompt('Approve ' + r.kind + ' — billable amount (USD):'); if (amt == null) return;
            const n2 = Number(amt); if (!(n2 >= 0)) { toast('Enter a valid amount', 'error'); return; }
            ev2.target.disabled = true;
            try { await reviewAccessorial(r.id, 'approve', n2, null); toast(r.kind + ' approved — $' + n2 + ' billable', 'success'); loadClaims(); }
            catch (e) { ev2.target.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '\u2713 Approve'),
          el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev2) => {
            const why = prompt('Reject ' + r.kind + ' — reason (carrier will see this):'); if (!why) return;
            ev2.target.disabled = true;
            try { await reviewAccessorial(r.id, 'reject', null, why); toast(r.kind + ' rejected', 'info'); loadClaims(); }
            catch (e) { ev2.target.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '\u2715 Reject'),
          r.support_status === 'open' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev2) => {
            const side = prompt('\u2696 VERDICT \u2014 who is right? Type carrier or broker:'); if (!side) return;
            const v9 = side.trim().toLowerCase(); if (v9 !== 'carrier' && v9 !== 'broker') { toast('Type exactly: carrier or broker', 'error'); return; }
            let amt9 = null;
            if (v9 === 'carrier') { const a9 = prompt('Amount owed to the carrier (USD):'); if (a9 == null) return; amt9 = Number(a9); if (!(amt9 > 0)) { toast('Enter a positive amount', 'error'); return; } }
            const nt9 = prompt('Verdict note \u2014 BOTH sides read this (cite the GPS evidence):'); if (!nt9) return;
            ev2.currentTarget.disabled = true;
            try { await supportDecideClaim(r.id, v9, amt9, nt9); toast('\u2696 Verdict recorded \u2014 both sides notified. Refusal to honour it = strike/pause via Carrier 360.', 'success'); loadClaims(); }
            catch (e) { ev2.currentTarget.disabled = false; toast(humanizeError(e), 'error'); }
          } }, '\u2696 Support verdict') : null,
        ].filter(Boolean)) : el('span', { class: 'cc-sub' }, 'view only'),
      ]))) : el('div', { class: 'cc-sub' }, 'No claims waiting — auto-detention and TONU land here the moment they are detected.'),
    ]));
  }

  // A3 staff loop — carrier emergency / reschedule requests (category + detailed reason + PROOF required
  // at submission; approve/deny here with a note).
  async function loadEmergencies() {
    mount(emCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests'), el('div', { class: 'cc-sub' }, 'Loading…')]));
    let rows; try { rows = await emergencyQueue('open', 100); } catch (e) { mount(emCard, el('div', null, [el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests'), el('div', { class: 'cc-sub' }, humanizeError(e))])); return; }
    rows = Array.isArray(rows) ? rows : [];
    const head = el('h3', { style: 'margin:0 0 8px' }, '🚨 Emergency requests (' + rows.length + ' open)');
    if (!rows.length) { mount(emCard, el('div', null, [head, el('div', { class: 'cc-sub' }, 'No open emergency requests. Carriers raise these from an active trip with a defined category, a detailed reason and mandatory proof.')])); return; }
    const items = rows.map((r) => {
      const note = el('input', { class: 'cc-input', placeholder: 'Decision note (visible to the carrier)', style: 'max-width:260px' });
      const act = (label, approve, primary) => el('button', { class: 'lb-btn lb-btn-sm' + (primary ? ' lb-btn-primary' : ''), style: 'margin-left:6px', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        _btn9.disabled = true;
        try { await emergencyReview(r.id, approve, note.value.trim() || null); toast('Request ' + (approve ? 'approved' : 'denied'), 'success'); loadEmergencies(); }
        catch (e) { toast(humanizeError(e), 'error'); _btn9.disabled = false; }
      } }, label);
      return el('div', { style: 'padding:10px 0;border-bottom:1px solid var(--lb-border,#e2e8f0)' }, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap' }, [
          el('div', null, [
            el('div', { style: 'font-weight:700' }, (r.category || 'emergency').replace(/_/g, ' ').toUpperCase() + ' — ' + (r.carrier || 'carrier') + ' · ' + (r.origin || '—') + ' → ' + (r.destination || '—')),
            el('div', { class: 'cc-sub' }, 'Reason: ' + (r.reason || '—')),
            el('div', { class: 'cc-sub' }, 'Proof: ' + (r.proof_ref || '—') + (r.requested_reschedule_to ? ' · requested new delivery: ' + new Date(r.requested_reschedule_to).toLocaleString() : '') + ' · raised ' + (r.created_at ? new Date(r.created_at).toLocaleString() : '—')),
          ]),
          manage ? el('div', { style: 'display:flex;align-items:center;gap:4px;flex-wrap:wrap' }, [note, act('Approve', true, true), act('Deny', false, false)]) : el('span', { class: 'cc-sub' }, 'dispatch.manage required'),
        ]),
      ]);
    });
    mount(emCard, el('div', null, [head].concat(items)));
  }

  async function load() {
    showLoading(body, 'Loading exceptions…');
    let rows; try { rows = await exceptionCenter(filterStatus || null, 200); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'alert', label: 'In view', value: String(rows.length), sub: filterStatus || 'all', accent: 'blue' }),
      statCard({ icon: 'clock', label: 'Detention', value: String(rows.filter(r => r.kind === 'detention').length), sub: 'measured from real stamps', accent: 'red' }),
      statCard({ icon: 'shield', label: 'Draft $ pending review', value: '$' + rows.reduce((a, r) => a + Number(r.accessorial_draft || 0), 0).toLocaleString(), sub: 'not billable yet', accent: 'amber' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No exceptions for this filter.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Kind', 'Lane / carrier', 'What happened', 'Age', 'On site', 'Draft $', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
        el('td', null, el('span', { class: 'cc-pill cc-pill-' + (KIND_TONE[r.kind] || 'gray') }, r.kind)),
        el('td', null, [el('b', null, (r.origin || '?') + ' → ' + (r.destination || '?')), el('div', { class: 'cc-sub' }, r.carrier_name || '—')]),
        el('td', { style: 'max-width:340px' }, [el('div', { class: 'cc-sub' }, r.description || ''), r.resolution_note ? el('div', { class: 'cc-sub', style: 'color:#16a34a' }, '✓ ' + r.resolution_note) : null]),
        el('td', null, el('span', { class: 'cc-sub' }, r.status === 'resolved' ? fmtDateTime(r.resolved_at) : fmtAge(r.age_minutes))),
        el('td', null, r.on_site ? el('span', { class: 'cc-pill cc-pill-amber' }, r.on_site) : el('span', { class: 'cc-sub' }, '—')),
        el('td', null, Number(r.accessorial_draft || 0) > 0 ? el('b', { style: 'color:#d97706' }, '$' + Number(r.accessorial_draft).toLocaleString()) : el('span', { class: 'cc-sub' }, '—')),
        el('td', null, (manage && r.status === 'open') ? el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); resolveUI(r); } }, 'Resolve') : null),
      ]))),
    ]));
  }

  function fmtAge(min) {
    if (min == null) return '—';
    if (min < 60) return min + ' min';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd';
  }

  function resolveUI(r) {
    const ta = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'What was done? (required — this is the audit trail)' });
    const form = el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, r.description || ''),
      Number(r.accessorial_draft || 0) > 0 ? el('div', { class: 'lb-card', style: 'background:#fffbeb;margin-bottom:8px' },
        el('div', { class: 'cc-sub' }, 'This trip has $' + Number(r.accessorial_draft).toLocaleString() + ' in DRAFT accessorials (labeled assumptions). Review them under the trip before billing — resolving this exception does not bill anything.')) : null,
      el('label', { class: 'cc-field' }, [el('span', null, 'Resolution note'), ta]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        if (!ta.value.trim()) { alert('A resolution note is required.'); return; }
        try { await resolveException({ id: r.id, note: ta.value.trim() }); toast('Exception resolved', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
        catch (e) { alert(humanizeError(e)); }
      } }, 'Mark resolved')),
    ].filter(Boolean));
    openDrawer('Resolve — ' + r.kind, form, { subtitle: (r.origin || '?') + ' → ' + (r.destination || '?') });
  }
}

export default renderExceptionCenter;
