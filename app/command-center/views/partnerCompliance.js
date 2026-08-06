// partnerCompliance.js — the ongoing side of broker & shipper compliance.
//
// The packet screen (broker360) answers "did we ever check this?". This one answers
// "is it still true?" — which is a different question and, since FMCSA's broker
// financial responsibility rule took effect on 16 January 2026, a more urgent one:
// a broker's authority is suspended if their security falls below $75,000 and is not
// replenished within 7 days. A record that says "verified ✓" from four months ago is
// not evidence of anything, and carriers take loads on the strength of it.
//
// Reads cc_partner_compliance_board, writes cc_packet_set_dates.
// Lapsed items sort first — this is meant to be a work list, not a report.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented } from '../../shared/ui/components.js';
import { partnerComplianceBoard, packetSetDates, authorityBoard, orgSetDocket } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const STATE_STYLE = {
  lapsed:   { colour: '#dc2626', pill: 'LAPSED',   note: 'posting paused' },
  overdue:  { colour: '#ea580c', pill: 'OVERDUE',  note: 'past its re-check date' },
  due_soon: { colour: '#d97706', pill: 'DUE SOON', note: '' },
};

export function renderPartnerCompliance(host) {
  let days = 45;
  const listHost = el('div', { class: 'cc-table-wrap' });
  const kpis = el('div');
  const manage = can('compliance.manage') || can('partners.manage');

  async function load() {
    showLoading(listHost, 'Checking what has gone stale...');
    let data;
    try { data = await partnerComplianceBoard(days); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }

    const items = Array.isArray(data && data.items) ? data.items : [];

    mount(kpis, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'alert', label: 'Lapsed', value: String(data.lapsed || 0),
                 sub: 'posting paused', accent: data.lapsed ? 'red' : 'green' }),
      statCard({ icon: 'clock', label: 'Overdue', value: String(data.overdue || 0),
                 sub: 'past re-check date', accent: data.overdue ? 'amber' : 'green' }),
      statCard({ icon: 'shield', label: 'Due soon', value: String(data.due_soon || 0),
                 sub: 'within ' + (data.window_days || days) + ' days', accent: data.due_soon ? 'amber' : 'green' }),
    ]));

    if (!items.length) {
      showEmpty(listHost, 'Nothing lapsed and nothing due in the next ' + days + ' days. Every broker and shipper record on file is current.');
      return;
    }

    mount(listHost, el('div', null, items.map((r) => {
      const st = STATE_STYLE[r.state] || STATE_STYLE.due_soon;
      const left = Number(r.days_left);
      const when = r.state === 'lapsed'
        ? ('lapsed ' + (r.due || '') + (isFinite(left) ? ' · ' + Math.abs(left) + ' days ago' : ''))
        : r.state === 'overdue'
          ? (Math.abs(left) + ' days past due (' + (r.due || '') + ')')
          : (left + ' days left (' + (r.due || '') + ')');

      // Recording the printed expiry is the one thing that makes this list honest:
      // a bond whose term ends in three weeks should lapse in three weeks, not on our
      // generic thirty-day cadence.
      const dateBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
        const btn = ev.currentTarget;
        const v = prompt('Expiry date printed on the document (YYYY-MM-DD).\nLeave blank to cancel.\n\n' + r.label + ' — ' + r.org, r.expires_at || '');
        if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) { if (v) toast('Use YYYY-MM-DD', 'error'); return; }
        btn.disabled = true;
        try { await packetSetDates(r.org_id, r.item_key, v.trim(), null); toast('Expiry recorded', 'success'); load(); }
        catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; }
      } }, r.expires_at ? 'Change expiry' : 'Set expiry') : null;

      return el('div', { class: 'lb-card', style: 'margin:8px 0;border-left:5px solid ' + st.colour + ';display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
        el('div', { style: 'min-width:260px' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('b', null, r.org || 'Account'),
            el('span', { style: 'font-size:11px;font-weight:800;padding:2px 8px;border-radius:20px;background:' + st.colour + ';color:#fff' }, st.pill),
            r.tag === 'legal' ? el('span', { style: 'font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;background:#eef2f7;color:#475569' }, 'LEGAL') : null,
          ].filter(Boolean)),
          el('div', { class: 'cc-sub' }, r.label),
          el('div', { class: 'cc-sub' }, [(r.kind || ''), when, st.note].filter(Boolean).join(' · ')),
          r.owner_email ? el('div', { class: 'cc-sub' }, r.owner_email) : null,
        ].filter(Boolean)),
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('a', { href: '#/broker?id=' + r.org_id, style: 'color:var(--lb-blue,#0883F7);font-weight:600' }, 'Open packet →'),
          dateBtn,
        ].filter(Boolean)),
      ]);
    })));
  }

  // ---------------------------------------------------------------- FMCSA authority
  // The packet list above is about documents we hold. This is about the one fact we do
  // not have to take anyone's word for: FMCSA publishes whether an operating authority is
  // live, and the daily poll reads it. Ordered worst-first — inactive, then not found,
  // then the ones we cannot check at all because no docket number is on file.
  const authHost = el('div', { class: 'cc-table-wrap' });

  const AUTH_STYLE = {
    inactive:      { colour: '#dc2626', pill: 'NOT ACTIVE',   note: 'FMCSA says not allowed to operate — posting paused' },
    not_found:     { colour: '#ea580c', pill: 'NOT FOUND',    note: 'FMCSA has no record for this docket' },
    no_docket:     { colour: '#64748b', pill: 'NO DOCKET',    note: 'nothing on file to check against' },
    error:         { colour: '#d97706', pill: 'CHECK FAILED', note: 'nothing paused — FMCSA did not answer' },
    never_checked: { colour: '#94a3b8', pill: 'NOT CHECKED',  note: '' },
    active:        { colour: '#16a34a', pill: 'ACTIVE',       note: '' },
  };

  async function loadAuth() {
    showLoading(authHost, 'Reading the FMCSA authority poll...');
    let d;
    try { d = await authorityBoard(); }
    catch (e) { showError(authHost, humanizeError(e), loadAuth); return; }

    const rows = Array.isArray(d && d.items) ? d.items : [];
    const banner = !d.configured
      ? el('div', { class: 'lb-card', style: 'margin:8px 0;border-left:5px solid #d97706' }, [
          el('b', null, 'Authority polling is not switched on'),
          el('div', { class: 'cc-sub' }, 'app_private.fmcsa_config is missing or disabled, so the daily poll is a no-op. Everything below is from manual review only — treat "not checked" as unknown, not as clean.'),
        ])
      : null;

    // Sorted server-side; a docket that cannot be checked is worth surfacing even when
    // nothing is wrong, because "no news" from an unchecked account is not good news.
    const body = !rows.length
      ? el('div', { class: 'cc-sub', style: 'padding:10px' }, 'No broker or carrier has an authority item on file yet.')
      : el('div', null, rows.map((r) => {
          const st = AUTH_STYLE[r.authority_status] || AUTH_STYLE.never_checked;
          const docket = r.mc ? ('MC ' + r.mc) : r.dot ? ('USDOT ' + r.dot) : 'no docket on file';
          const setBtn = manage ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => {
            const btn = ev.currentTarget;
            const v = prompt('Docket number for ' + (r.org || 'this account') + '.\nPrefix it so we know which it is:\n  MC 123456   or   DOT 1234567', r.mc ? ('MC ' + r.mc) : r.dot ? ('DOT ' + r.dot) : '');
            if (!v) return;
            const isDot = /dot/i.test(v);
            const digits = v.replace(/\D/g, '');
            if (!digits) { toast('No number found in that', 'error'); return; }
            btn.disabled = true;
            try { await orgSetDocket(r.org_id, isDot ? null : digits, isDot ? digits : null); toast('Docket saved — it will be polled on the next run', 'success'); loadAuth(); }
            catch (e) { toast(humanizeError(e), 'error'); btn.disabled = false; }
          } }, (r.mc || r.dot) ? 'Change docket' : 'Set docket') : null;

          return el('div', { class: 'lb-card', style: 'margin:8px 0;border-left:5px solid ' + st.colour + ';display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center' }, [
            el('div', { style: 'min-width:260px' }, [
              el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
                el('b', null, r.org || 'Account'),
                el('span', { style: 'font-size:11px;font-weight:800;padding:2px 8px;border-radius:20px;background:' + st.colour + ';color:#fff' }, st.pill),
              ]),
              el('div', { class: 'cc-sub' }, [r.kind, docket, r.legal_name ? ('FMCSA: ' + r.legal_name) : null].filter(Boolean).join(' · ')),
              el('div', { class: 'cc-sub' }, [
                r.checked_at ? ('checked ' + new Date(r.checked_at).toLocaleString()) : 'never checked',
                st.note || null,
                r.consecutive_fail >= 3 ? (r.consecutive_fail + ' failures in a row') : null,
                r.last_error || null,
              ].filter(Boolean).join(' · ')),
            ]),
            el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
              el('a', { href: '#/' + (r.kind === 'carrier' ? 'carrier' : 'broker') + '?id=' + r.org_id, style: 'color:var(--lb-blue,#0883F7);font-weight:600' }, 'Open →'),
              setBtn,
            ].filter(Boolean)),
          ]);
        }));

    mount(authHost, el('div', null, [banner, body].filter(Boolean)));
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Broker & shipper re-verification',
      'What we checked once and have not checked since. Items tagged LEGAL pause load posting when they lapse — everything already booked keeps running. Warnings go out automatically ahead of the date; this is the list for the ones that still need a person.'),
    el('div', { class: 'cc-toolbar' }, [segmented(
      [{ value: '14', label: '14 days' }, { value: '45', label: '45 days' }, { value: '90', label: '90 days' }],
      String(days), (v) => { days = Number(v); load(); })]),
    kpis, listHost,
    sectionHead('FMCSA authority — daily poll',
      'The one fact we do not take anyone\'s word for. Every broker and carrier with an authority item is checked against FMCSA each morning; an authority FMCSA reports as not active pauses posting the same day. A failed check pauses nothing — an API having a bad afternoon is not evidence.'),
    authHost,
  ]));
  load();
  loadAuth();
}

export default renderPartnerCompliance;
