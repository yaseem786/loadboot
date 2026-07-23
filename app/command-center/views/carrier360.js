// carrier360.js — Control Tower Wave B: Carrier 360 record page.
// One screen that ties together everything already in the system for a single carrier:
// profile, compliance, safety grade, documents, drivers, trips, finance, and an audit
// timeline — each section linking back into the module it came from. Read-only aggregate
// via cc_carrier_360 (keyed on the carrier organization id), RBAC-gated on carriers.view.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';

import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, money, fmtDate, fmtDateTime, openDrawer, askReason, askConfirm } from '../../shared/ui/components.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { carrier360, fmcsaVerify, carrierScorecard, carrierPaymentProfile, verifyPaymentProfile, ccFactoringVerify, getCarrierCompliance, setCompliance, decideOnboarding, issueViolation, documentFile, accountHealth, accessorialQueue, reviewAccessorial, getTrip, carrierW9, carrierAgreementSignature, setBrokerVisibility, getBrokerVisibility, pauseCarrier, requestPoa, carrierReinstatements, reviewReinstatement, carrierPoaDemands, healthAdjust, healthResetFactor, reviewDocument, tripAccessorials, claimBundle, ccOnboardingRemind, ccOnboardingReminderStatus, ccCarrierBackoffice, ccCarrierPrefs } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { fmcsaRiskFlags } from '../../shared/fmcsa-flags.js';
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
    orgId = d.id || orgId; // canonical org id — search/list links can arrive with a different key
    const p = d.profile || {};
    const sc = d.safety || {};
    const ts = d.trips_summary || {};
    const fin = d.finance || {};

    const _stage = String((d.onboarding && d.onboarding.stage) || 'not started').replace('_', ' ');
    const _init = String(d.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    const head = el('div', { style: 'background:linear-gradient(135deg,#0b1b33,#12294a);border-radius:18px;padding:22px 26px;color:#fff;box-shadow:0 14px 34px -18px rgba(8,30,63,.45)' }, [
      el('div', { style: 'display:flex;gap:18px;align-items:center;flex-wrap:wrap' }, [
        el('div', { style: 'width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#0883F7,#0a6fd6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:24px;flex:none;box-shadow:0 10px 24px -8px rgba(8,131,247,.6)' }, _init),
        el('div', { style: 'flex:1;min-width:220px' }, [
          el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
            el('span', { style: 'font-size:1.45rem;font-weight:800;letter-spacing:-.02em' }, d.name || 'Carrier'),
            el('span', { class: 'cc-pill cc-pill-' + (d.compliance_ok ? 'green' : 'amber') }, d.compliance_ok ? '\u2713 verified' : _stage),
            (p.hazmat ? el('span', { class: 'cc-pill cc-pill-red' }, '\u2622 hazmat') : ''),
          ]),
          el('div', { style: 'color:#9db4d6;font-size:.86rem;margin-top:6px' },
            ['MC ' + (p.mc || '\u2014'), 'USDOT ' + (p.dot || '\u2014'), p.home_base || null, p.created_at ? 'joined ' + fmtDate(p.created_at) : null].filter(Boolean).join('  \u00b7  ')),
        ]),
        el('div', { style: 'text-align:right;flex:none' }, [
          el('div', { style: 'font-size:.68rem;font-weight:800;letter-spacing:.1em;color:#7c8db5;text-transform:uppercase' }, 'Contact (staff only)'),
          el('div', { style: 'font-weight:700;font-size:.92rem;margin-top:3px' }, p.contact_name || '\u2014'),
          el('div', { style: 'color:#9db4d6;font-size:.84rem' }, p.phone || '\u2014'),
        ]),
      ]),
    ]);
    // Onboarding application — EVERYTHING the carrier submitted, in one labeled grid
    const F = (l, v) => el('div', null, [el('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase' }, l), el('div', { style: 'font-weight:700;color:#0f172a;margin-top:2px;font-size:.92rem' }, (v == null || v === '') ? '\u2014' : v)]);
    const chips = (arr) => (arr && arr.length) ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:3px' }, arr.map((e) => el('span', { class: 'cc-pill cc-pill-blue' }, e))) : '\u2014';
    const appCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Onboarding application'), el('span', { class: 'cc-sub' }, 'exactly as submitted')]),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px 18px;margin-top:8px' }, [
        F('Company', p.company), F('Contact name', p.contact_name), F('Phone', p.phone),
        F('MC number', p.mc), F('USDOT', p.dot), F('Home base', p.home_base),
        F('Search radius', p.radius_miles ? p.radius_miles + ' mi' : null), F('Trucks', p.truck_count),
        el('div', null, [el('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase' }, 'Equipment'), chips(p.equipment_types)]),
        F('Hazmat', p.hazmat ? 'YES \u2014 3 extra docs required' : 'No'), F('Weekends', p.weekend_ok ? 'Available' : 'No'),
        F('Factoring', p.factoring_status === 'yes' ? ('Yes \u00b7 ' + (p.factoring_company || '?')) : p.factoring_status === 'interested' ? 'Wants a recommendation' : p.factoring_status === 'no' ? 'No \u2014 direct pay' : null),
      ]),
    ]);

    // ---- Carrier dispatch preferences (what the carrier set in their own account) ----
    const LB = (t) => el('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.08em;color:#94a3b8;text-transform:uppercase' }, t);
    const Fc = (l, arr) => el('div', null, [LB(l), chips(arr)]);
    const prefsCard = card([el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\ud83c\udfaf Carrier dispatch preferences'), el('span', { class: 'cc-sub' }, 'what the carrier set in their account')]), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Loading\u2026')]);
    (async () => {
      let pr; try { pr = await ccCarrierPrefs(orgId); } catch (e) { mount(prefsCard, [el('h4', { class: 'cc-card-title' }, '\ud83c\udfaf Carrier dispatch preferences'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, humanizeError(e))]); return; }
      if (pr && pr.error) { mount(prefsCard, [el('h4', { class: 'cc-card-title' }, '\ud83c\udfaf Carrier dispatch preferences'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, pr.error)]); return; }
      if (!pr || pr.none) { mount(prefsCard, [el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\ud83c\udfaf Carrier dispatch preferences')]), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'The carrier has not set dispatch preferences yet.')]); return; }
      const rpm = (v) => v != null ? ('$' + Number(v).toFixed(2) + '/mi') : null;
      const yn = (v) => v ? 'Yes' : 'No';
      mount(prefsCard, el('div', null, [
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\ud83c\udfaf Carrier dispatch preferences'),
          el('span', { class: 'cc-pill cc-pill-' + (pr.available ? 'green' : 'amber') }, pr.available ? 'available for loads' : 'paused')]),
        el('div', { class: 'cc-sub', style: 'margin:2px 0 8px' }, pr.updated_at ? 'set by the carrier \u00b7 ' + fmtDate(pr.updated_at) : 'set by the carrier'),
        el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px 18px' }, [
          Fc('Preferred equipment', pr.preferred_equipment),
          Fc('Preferred lanes', pr.preferred_lanes),
          F('Home base', pr.home_base),
          F('Min rate/mile', rpm(pr.min_rpm)), F('Target rate/mile', rpm(pr.target_rpm)),
          F('Max deadhead', pr.max_deadhead_miles ? pr.max_deadhead_miles + ' mi' : null),
          F('Trip length', (pr.min_trip_miles || pr.max_trip_miles) ? ((pr.min_trip_miles || '0') + '\u2013' + (pr.max_trip_miles || '\u221e') + ' mi') : null),
          F('Max weight', pr.max_weight_lbs ? pr.max_weight_lbs + ' lbs' : null),
          F('Hazmat', yn(pr.hazmat)), F('Team drivers', yn(pr.team_drivers)), F('Weekends', pr.weekend_ok ? 'Available' : 'No'),
          F('Min notice', pr.min_notice_hours ? pr.min_notice_hours + ' h' : null),
          Fc('Avoid states', pr.avoid_states),
          F('Cost/mile', rpm(pr.cost_per_mile)),
          F('Notes', pr.notes),
        ]),
      ]));
    })();

    const jumpTo = (elGetter) => () => { try { const e2 = elGetter(); e2 && e2.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} };
    const clickable = (node, on) => { const w = el('div', { style: 'cursor:pointer', onClick: on }); w.appendChild(node); return w; };
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      clickable(statCard({ icon: 'shield', label: 'Compliance', value: d.compliance_ok ? 'OK' : 'Gap', sub: (d.onboarding && d.onboarding.stage) || 'not started', accent: d.compliance_ok ? 'green' : 'amber' }), jumpTo(() => compCard)),
      clickable(statCard({ icon: 'check', label: 'Safety grade', value: sc.grade || '—', sub: 'score ' + (sc.score ?? '—') + (sc.on_time_pct != null ? ' · ' + sc.on_time_pct + '% OT' : ''), accent: 'blue' }), jumpTo(() => scCard)),
      clickable(statCard({ icon: 'truck', label: 'Trips', value: String(ts.total || 0), sub: (ts.active || 0) + ' active · ' + (ts.delivered || 0) + ' delivered', accent: 'violet' }), jumpTo(() => tripsCard)),
      clickable(statCard({ icon: 'doc', label: 'Fees paid', value: money(fin.fees_paid || 0), sub: money(fin.fees_outstanding || 0) + ' outstanding', accent: 'green' }), jumpTo(() => payoutCard)),
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
    const safetyHost = el('div', { style: 'margin-top:10px' });
    let fmcsaOpen = false;
    const fmcsaBtn = el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-top:8px', onClick: async (ev) => {
      const _btn9 = ev.currentTarget;
      if (fmcsaOpen) { fmcsaOpen = false; safetyHost.innerHTML = ''; _btn9.textContent = '\ud83d\udcc2 Full FMCSA profile (7 tabs)'; return; }
      const dot2 = (d.profile && (d.profile.dot_number || d.profile.dot)) || (d.onboarding && d.onboarding.dot) || await askReason('DOT number:');
      if (!dot2) return;
      fmcsaOpen = true; _btn9.textContent = '\u25b4 Hide FMCSA profile';
      safetyHost.innerHTML = ''; safetyHost.appendChild(el('div', { class: 'cc-sub' }, 'Loading government record\u2026'));
      try { const m2 = await import('../../carrier/profile-view.js'); await m2.renderFmcsaOnly(safetyHost, String(dot2).trim(), { light: true }); }
      catch (e2) { mount(safetyHost, el('div', { class: 'cc-sub' }, humanizeError(e2))); }
    } }, '\ud83d\udcc2 Full FMCSA profile (7 tabs)');
    const safetyCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Safety & authority'), verifyBtn]),
      kv('Authority', sc.authority_status || 'unknown'),
      kv('Safety rating', sc.safety_rating || 'none'),
      kv('Out of service', sc.out_of_service ? 'YES' : 'No'),
      kv('On-time delivery', sc.on_time_pct != null ? sc.on_time_pct + '%' : '—'),
      fmcsaStatus,
    ]);

    const docs = d.documents || [];
    function openDocPreview(x) {
      const previewBox = el('div', { style: 'margin:12px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#0b1220;min-height:130px;display:flex;align-items:center;justify-content:center' }, el('div', { class: 'cc-sub', style: 'color:#94a3b8;padding:26px' }, 'Loading preview…'));
      const openBtn = el('a', { class: 'lb-btn lb-btn-secondary', target: '_blank', rel: 'noopener', style: 'pointer-events:none;opacity:.5' }, 'Open in new tab');
      const dlBtn = el('a', { class: 'lb-btn lb-btn-secondary', style: 'pointer-events:none;opacity:.5' }, '\u2b07 Download');
      (async () => {
        if (!x.file_path) { mount(previewBox, el('div', { class: 'cc-sub', style: 'color:#94a3b8;padding:26px' }, 'No file attached to this record.')); return; }
        let url; try { url = await signedDocumentUrl(x.file_path, 600); }
        catch (e) { mount(previewBox, el('div', { class: 'cc-sub', style: 'color:#fca5a5;padding:26px' }, 'Could not load preview: ' + humanizeError(e))); return; }
        const ext = String(x.file_name || x.file_path).split('.').pop().toLowerCase();
        let viewer;
        if (ext === 'pdf') viewer = el('iframe', { src: url, style: 'width:100%;height:440px;border:0;background:#fff' });
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) viewer = el('img', { src: url, style: 'max-width:100%;max-height:480px;display:block;margin:0 auto' });
        else viewer = el('div', { class: 'cc-sub', style: 'color:#cbd5e1;padding:26px;text-align:center' }, '.' + ext + ' file — use Download or Open to view.');
        mount(previewBox, viewer);
        openBtn.href = url; openBtn.style.pointerEvents = 'auto'; openBtn.style.opacity = '1';
        dlBtn.href = url + (url.indexOf('?') > -1 ? '&' : '?') + 'download=' + encodeURIComponent(x.file_name || 'document');
        dlBtn.style.pointerEvents = 'auto'; dlBtn.style.opacity = '1';
      })();
      openDrawer('Document preview', el('div', null, [
        el('div', { class: 'cc-drawer-title' }, [el('h3', null, x.file_name || 'document'), statusPill(x.status)]),
        card([el('div', { class: 'cc-field' }, [el('span', null, 'Type'), el('b', null, x.type || '—')]), el('div', { class: 'cc-field' }, [el('span', null, 'Submitted'), el('b', null, fmtDate(x.created_at))])], 'cc-fields'),
        previewBox,
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [openBtn, dlBtn]),
      ]), { subtitle: d.name || '' });
    }
    safetyCard.appendChild(safetyHost); safetyCard.appendChild(fmcsaBtn);
    const docsCard = card([
      el('h4', { class: 'cc-card-title' }, 'Documents (' + docs.length + ')'),
      docs.length ? el('table', { class: 'cc-table cc-table-tight' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Type'), el('th', null, 'File'), el('th', null, 'Status'), el('th', null, 'Added')])),
        el('tbody', null, docs.map(x => el('tr', { class: 'cc-row', style: 'cursor:pointer', title: 'Preview / download', onClick: () => openDocPreview(x) }, [el('td', null, x.type || '—'), el('td', null, x.file_name || '—'), el('td', null, statusPill(x.status)), el('td', null, [fmtDate(x.created_at), ' ', el('span', { class: 'cc-row-go' }, '\u203a')])]))),
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
        el('thead', null, el('tr', null, [el('th', null, 'Status'), el('th', null, 'Rate'), el('th', null, 'Scheduled delivery'), el('th', null, 'Delivered'), el('th', null, 'Claims')])),
        el('tbody', null, trips.map(x => el('tr', { style: 'cursor:pointer', title: 'Open full trip detail', onClick: async () => {
          const hostD = el('div', null, el('div', { class: 'cc-sub' }, 'Loading trip…'));
          openDrawer('Trip — full detail', hostD);
          let t2 = x; try { t2 = Object.assign({}, x, await getTrip(x.id) || {}); } catch (_) {}
          const rows2 = Object.entries(t2).filter(([k2, v2]) => v2 != null && typeof v2 !== 'object').map(([k2, v2]) =>
            kv(k2.replace(/_/g, ' '), /(_at|pickup|delivery)$/.test(k2) && /\d{4}-\d{2}/.test(String(v2)) ? fmtDateTime(v2) : String(v2)));
          const rowKV9 = (k9, v9) => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed #eef2f7;font-size:.78rem' }, [el('span', { style: 'color:#64748b' }, String(k9).replace(/_/g, ' ')), el('b', { style: 'text-align:right;word-break:break-word' }, String(v9))]);
          const objBox9 = (v9) => { if (Array.isArray(v9)) return el('div', null, v9.length ? v9.map((it9, i9) => (typeof it9 === 'object' && it9) ? el('div', { style: 'border:1px solid #e8edf3;border-radius:8px;padding:6px 8px;margin:4px 0;background:#fff' }, Object.entries(it9).filter(([, vv9]) => vv9 != null && typeof vv9 !== 'object').map(([kk9, vv9]) => rowKV9(kk9, vv9))) : rowKV9('#' + (i9 + 1), it9)) : [el('div', { class: 'cc-sub' }, 'none')]); return el('div', null, Object.entries(v9).filter(([, vv9]) => vv9 != null).map(([kk9, vv9]) => (typeof vv9 === 'object') ? el('div', { style: 'margin:4px 0' }, [el('div', { style: 'font-size:.7rem;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em' }, String(kk9).replace(/_/g, ' ')), objBox9(vv9)]) : rowKV9(kk9, vv9))); };
          const objs = Object.entries(t2).filter(([k2, v2]) => v2 != null && typeof v2 === 'object').map(([k2, v2]) =>
            el('div', { style: 'margin-top:8px' }, [el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800' }, k2.replace(/_/g, ' ')),
              el('div', { style: 'font-size:.74rem;background:#f6f8fb;border:1px solid #e8edf3;border-radius:8px;padding:8px;max-height:220px;overflow:auto' }, objBox9(v2))]));
          const clHost = el('div', { style: 'margin-top:10px' }, el('div', { class: 'cc-sub' }, 'Loading claims…'));
          const loadCl = async () => {
            let cls = []; try { cls = await tripAccessorials(x.id) || []; } catch (_) { cls = []; }
            mount(clHost, el('div', null, [
              el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin-bottom:4px' }, [icon('dollar',15), ' Pay claims on this trip (' + cls.length + ')']),
              !cls.length ? el('div', { class: 'cc-sub' }, 'None filed.') : el('div', null, cls.map((a9) => el('div', { style: 'border:1px solid #e8edf3;border-radius:10px;padding:8px 11px;margin-bottom:6px' }, [
                el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
                  el('b', { style: 'font-size:.85rem' }, String(a9.kind || '').toUpperCase() + (a9.amount != null && Number(a9.amount) > 0 ? ' · $' + a9.amount : '')),
                  el('span', { class: 'cc-pill cc-pill-' + (a9.status === 'approved' ? 'green' : a9.status === 'rejected' ? 'red' : 'amber') }, a9.status),
                  a9.broker_status === 'approved' ? el('span', { class: 'cc-pill', style: 'background:#e7f9ee;color:#12a150' }, '✓ Broker approved') : a9.broker_status === 'disputed' ? el('span', { class: 'cc-pill', style: 'background:#fee2e2;color:#b91c1c', title: a9.broker_note || '' }, '✕ Broker disputed') : el('span', { class: 'cc-pill', style: 'background:#f1f5f9;color:#475569' }, 'Broker pending'),
                  a9.support_status === 'open' ? el('span', { class: 'cc-pill', style: 'background:#dbeafe;color:#1d4ed8' }, '🎧 Escalated') : null,
                  a9.support_status === 'decided' ? el('span', { class: 'cc-pill', style: 'background:#f1f5f9;color:#475569' }, '⚖ ' + (a9.support_verdict || '')) : null,
                ].filter(Boolean)),
                a9.note ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, a9.note) : null,
                a9.support_note ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, 'Verdict: ' + a9.support_note) : null,
                el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:5px;flex-wrap:wrap' }, [
                  el('span', { class: 'cc-sub' }, 'Filed ' + fmtDateTime(a9.created_at)),
                  (a9.status === 'requested' && can('dispatch.manage')) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => openClaimReview(Object.assign({ trip: x.id, origin: t2.origin, destination: t2.destination }, a9), loadCl) }, 'Review — evidence & decision') : null,
                ].filter(Boolean)),
              ].filter(Boolean)))),
            ]));
          };
          loadCl();
          mount(hostD, el('div', null, [clHost, ...rows2, ...objs]));
        } }, [el('td', null, statusPill(x.status)), el('td', null, money(x.rate || 0)), el('td', null, fmtDateTime(x.scheduled_delivery)), el('td', null, x.delivered_at ? fmtDateTime(x.delivered_at) : '—'),
          (() => { const td9 = el('td', { class: 'cc-sub' }, '…'); (async () => { try {
              const cls = await tripAccessorials(x.id) || [];
              if (!cls.length) { td9.textContent = '—'; return; }
              const hot = cls.some((a9) => a9.support_status === 'open') ? ['#dbeafe', '#1d4ed8', '🎧 '] : cls.some((a9) => a9.status === 'requested') ? ['#fef3c7', '#b45309', ''] : ['#e7f9ee', '#12a150', ''];
              td9.innerHTML = ''; td9.appendChild(el('span', { class: 'cc-pill', style: 'background:' + hot[0] + ';color:' + hot[1] }, hot[2] + cls.length + ' claim' + (cls.length > 1 ? 's' : '')));
            } catch (_) { td9.textContent = '—'; } })(); return td9; })()]))),
      ]) : el('div', { class: 'cc-sub' }, 'No trips yet.'),
    ]);

    const tl = d.timeline || [];
    const timelineCard = card([
      el('h4', { class: 'cc-card-title' }, 'Activity timeline'),
      tl.length ? el('div', { class: 'cc-timeline' }, tl.map(e => el('div', { class: 'cc-tl-row' }, [
        el('span', { class: 'cc-tl-dot' }), el('div', null, [el('b', null, e.action), el('div', { class: 'cc-sub' }, (e.summary || '') + ' · ' + fmtDateTime(e.at))]),
      ]))) : el('div', { class: 'cc-sub' }, 'No audit activity yet.'),
    ]);

    function computeHealth(dd) {
      const warns = []; const ts = dd.trips_summary || {}; const docs = dd.documents || []; const onb = dd.onboarding || {};
      if (!dd.compliance_ok) warns.push({ tone: 'urgent', text: 'Compliance gap \u2014 mandatory requirements incomplete. Send an onboarding/compliance reminder before assigning loads.' });
      const expired = docs.filter(x => (x.status || '').toLowerCase() === 'expired');
      if (expired.length) warns.push({ tone: 'urgent', text: expired.length + ' expired document(s): ' + expired.map(x => x.type).join(', ') + ' \u2014 request renewal now.' });
      const pending = docs.filter(x => ['pending', 'submitted', 'in_review'].indexOf((x.status || '').toLowerCase()) >= 0);
      if (pending.length) warns.push({ tone: 'warning', text: pending.length + ' document(s) awaiting verification.' });
      const stage = (onb.stage || '').toLowerCase();
      if (stage === '' || stage.indexOf('not started') >= 0) warns.push({ tone: 'warning', text: 'Onboarding not started \u2014 begin the compliance review to fully activate this carrier.' });
      if (Number(ts.delivered || 0) === 0) warns.push({ tone: 'info', text: 'No delivered trips yet \u2014 low engagement. Consider a best-match load offer or a check-in.' });
      const grade = dd.safety && (dd.safety.grade || dd.safety.rating);
      if (grade && ['D', 'F', 'conditional', 'unsatisfactory'].indexOf(String(grade).toLowerCase()) >= 0) warns.push({ tone: 'urgent', text: 'Safety concern (grade ' + grade + ') \u2014 review the FMCSA safety record before dispatching.' });
      let score = 100; warns.forEach(w => { score -= w.tone === 'urgent' ? 25 : w.tone === 'warning' ? 12 : 5; }); score = Math.max(0, score);
      const label = score >= 85 ? 'Healthy' : score >= 60 ? 'Watch' : score >= 35 ? 'At risk' : 'Critical';
      const tone = score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red';
      return { score, label, tone, warns };
    }
    const H = computeHealth(d);
    const HCOL = { green: '#16a34a', amber: '#f59e0b', red: '#dc2626' }[H.tone];
    const TCOL = { urgent: '#dc2626', warning: '#f59e0b', info: '#0883F7' };
    const healthCard = card([
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Review assistant \u2014 suggested actions'), el('span', { class: 'cc-pill cc-pill-' + H.tone }, [el('i', { class: 'cc-pill-dot' }), H.label])]),
      el('div', { style: 'display:flex;align-items:center;gap:14px;margin:8px 0 4px' }, [
        el('div', { style: 'width:64px;height:64px;border-radius:50%;flex:none;background:conic-gradient(' + HCOL + ' ' + (H.score * 3.6).toFixed(1) + 'deg,#e8edf3 0);display:flex;align-items:center;justify-content:center' },
          el('div', { style: 'width:48px;height:48px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:800' }, String(H.score))),
        el('div', { class: 'cc-sub', style: 'font-size:.85rem' }, H.warns.length ? (H.warns.length + ' item(s) need attention') : 'No warnings \u2014 this carrier is in good standing.'),
      ]),
      el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:10px 0 4px' }, 'Suggested warnings & actions'),
      H.warns.length ? el('div', null, H.warns.map(w => el('div', { style: 'display:flex;gap:9px;padding:8px 0;border-bottom:1px solid #eef2f7' }, [
        el('span', { style: 'width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:' + TCOL[w.tone] }),
        el('div', { style: 'font-size:.86rem;color:#334155' }, w.text),
      ]))) : el('div', { class: 'cc-sub' }, 'Nothing to warn about right now \u2014 keep it up.'),
      (() => { const host = el('div', null, el('div', { class: 'cc-sub', style: 'padding:8px 0' }, 'Checking live FMCSA safety record\u2026'));
        (async () => { try {
          const fl = await fmcsaRiskFlags(p.dot || '');
          if (!fl.length) { mount(host, el('div', { style: 'display:flex;gap:9px;padding:8px 0' }, [el('span', { style: 'width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:#16a34a' }), el('div', { style: 'font-size:.86rem;color:#334155' }, 'FMCSA live check: no safety red flags (authority, OOS rates, crashes all within range).')])); return; }
          mount(host, el('div', null, [el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#dc2626;font-weight:800;margin:10px 0 4px' }, '\u26a0 FMCSA live risk flags'),
            ...fl.map((w) => el('div', { style: 'display:flex;gap:9px;padding:8px 0;border-bottom:1px solid #eef2f7' }, [
              el('span', { style: 'width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:' + (w.tone === 'urgent' ? '#dc2626' : '#f59e0b') }),
              el('div', { style: 'font-size:.86rem;color:#334155;font-weight:' + (w.tone === 'urgent' ? '700' : '500') }, w.text),
            ]))]));
        } catch (_) { mount(host, el('div', { class: 'cc-sub' }, 'FMCSA live check unavailable right now.')); } })();
        return host; })(),
    ]);
    const scCard = card([el('h4', { class: 'cc-card-title' }, 'Performance scorecard'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Loading\u2026')]);
    (async () => {
      let sc; try { sc = await carrierScorecard(orgId, 90); } catch (_) { mount(scCard, [el('h4', { class: 'cc-card-title' }, 'Performance scorecard'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No delivered trips to score yet.')]); return; }
      // UNRATED, not punished: a carrier with zero delivered trips has no performance to grade
      if (!((sc.metrics || {}).delivered > 0)) {
        mount(scCard, [
          el('h4', { class: 'cc-card-title' }, 'Performance scorecard'),
          el('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:8px' }, [
            el('div', { style: 'width:70px;height:70px;border-radius:50%;flex:none;background:#eef2f7;display:flex;align-items:center;justify-content:center;font-weight:800;color:#94a3b8' }, '—'),
            el('div', null, [
              el('div', { style: 'font-weight:800;font-size:1.05rem;color:#64748b' }, 'Unrated — no delivered trips yet'),
              el('div', { class: 'cc-sub', style: 'font-size:.82rem' }, 'The grade appears after their first GPS-verified delivery. New carriers start clean — not at D.'),
            ]),
          ]),
        ]);
        return;
      }
      const grade = sc.grade || '-';
      const gcol = { A: '#16a34a', B: '#0883F7', C: '#f59e0b', D: '#dc2626' }[grade] || '#64748b';
      const score = Math.max(0, Math.min(100, Number(sc.score || 0)));
      const gauge = el('div', { style: 'width:70px;height:70px;border-radius:50%;flex:none;background:conic-gradient(' + gcol + ' ' + (score * 3.6).toFixed(1) + 'deg,#e8edf3 0);display:flex;align-items:center;justify-content:center' },
        el('div', { style: 'width:52px;height:52px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem' }, String(Math.round(score))));
      const m = sc.metrics || {};
      mount(scCard, [
        el('h4', { class: 'cc-card-title' }, 'Performance scorecard'),
        el('div', { style: 'display:flex;align-items:center;gap:14px;margin-top:8px' }, [gauge,
          el('div', null, [
            el('div', { style: 'font-weight:800;font-size:1.05rem;color:' + gcol }, 'Grade ' + grade + ' \u00b7 ' + Math.round(score) + '/100'),
            el('div', { class: 'cc-sub', style: 'font-size:.82rem' }, (m.delivered || 0) + ' delivered \u00b7 on-time ' + (m.on_time || 0) + '/' + (m.with_schedule || 0) + ' \u00b7 over ' + (sc.window_days || 90) + ' days'),
          ]),
        ]),
        el('a', { class: 'cc-360-link', href: '#/carrier-scorecards', style: 'margin-top:10px;display:inline-block' }, 'Full scorecard \u2192'),
      ]);
    })();
    const payoutCard = card([el('h4', { class: 'cc-card-title' }, 'Payout & bank details')]);
    (async () => {
      let pp; try { pp = await carrierPaymentProfile(orgId); }
      catch (e) { mount(payoutCard, [el('h4', { class: 'cc-card-title' }, 'Payout & bank details'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, /not authoriz/i.test((e && e.message) || '') ? 'Finance permission required to view bank details.' : humanizeError(e))]); return; }
      if (!pp || !pp.exists) { mount(payoutCard, [el('h4', { class: 'cc-card-title' }, 'Payout & bank details'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No bank / payout details on file yet.')]); return; }
      const verifyBtn = el('button', { class: 'cc-btn-sm ' + (pp.verified ? '' : 'cc-btn-green'), style: 'padding:7px 14px;border-radius:8px;font-weight:700;cursor:pointer;border:1px solid #cbd5e1;background:' + (pp.verified ? '#fff' : '#16a34a') + ';color:' + (pp.verified ? '#334155' : '#fff'), onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        _btn9.disabled = true; _btn9.textContent = pp.verified ? 'Revoking…' : 'Verifying…';
        try { await verifyPaymentProfile(orgId, !pp.verified, pp.verified ? (await askReason('Reason for revoking (carrier sees this):') || null) : null); load(); } catch (e) { _btn9.disabled = false; alert(humanizeError(e)); }
      } }, pp.verified ? 'Revoke verification' : 'Verify bank details');
      const bankRejectBtn = !pp.verified ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', style: 'margin-left:8px', onClick: async (ev) => {
        const _btn9 = ev.currentTarget;
        const why = await askReason('Reject bank details \u2014 reason (carrier will be notified):'); if (!why) return;
        _btn9.disabled = true;
        try { await verifyPaymentProfile(orgId, false, why); load(); } catch (e) { _btn9.disabled = false; alert(humanizeError(e)); }
      } }, '\u2715 Reject with reason') : null;
      mount(payoutCard, [
        el('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [el('h4', { class: 'cc-card-title' }, 'Payout & bank details'), statusPill(pp.verified ? 'approved' : 'pending')]),
        kv('Account holder', pp.account_title), kv('Bank', pp.bank_name),
        kv('Account #', pp.account_number), kv('Routing / ABA', pp.routing_number),
        kv('Account type', pp.account_type), kv('Pay method', pp.payment_method),
        pp.swift_bic ? kv('SWIFT / BIC', pp.swift_bic) : '',
        pp.bank_address ? kv('Bank address', pp.bank_address) : '',
        pp.remittance_email ? kv('Remittance email', pp.remittance_email) : '',
        pp.bank_phone ? kv('Bank phone', pp.bank_phone) : '',
        pp.tax_id ? kv('Tax ID / EIN', pp.tax_id) : '',
        pp.factoring_company ? kv('Factoring', pp.factoring_company + (pp.factoring_noa ? ' · NOA on file' : '')) : '',
        (pp.factor_details && (pp.factor_details.account_title || pp.factor_details.bank_name)) ? (() => {
          const fd = pp.factor_details;
          const noaLbl = pp.noa_status === 'verified' ? '✓ NOA verified' : pp.noa_status === 'rejected' ? '✕ NOA rejected' : (pp.noa_doc || pp.factoring_noa) ? 'NOA uploaded — pending review' : 'NOA not on file';
          return el('div', { style: 'margin-top:10px;border:1px solid rgba(139,92,246,.35);background:rgba(139,92,246,.07);border-radius:12px;padding:12px 14px' }, [
            el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px' }, [
              el('div', { style: 'font-weight:800;color:#7c3aed' }, [icon('bank',15),' Factoring — remit-to ' + (fd.account_title || 'factor')]),
              el('span', { class: 'cc-pill cc-pill-' + (pp.noa_status==='verified'?'green':pp.noa_status==='rejected'?'red':'amber') }, noaLbl) ]),
            fd.bank_name ? kv('Factor bank', fd.bank_name) : '',
            fd.account_number ? kv('Account #', fd.account_number) : '',
            fd.routing_number ? kv('Routing (ACH)', fd.routing_number) : '',
            fd.remittance_email ? kv('Remittance email', fd.remittance_email) : '',
            fd.terms_days_broker ? kv('Broker terms', fd.terms_days_broker + ' days') : '',
            (fd.advance_pct || fd.fee_pct) ? kv('Advance / fee', (fd.advance_pct?fd.advance_pct+'% advance':'') + (fd.fee_pct?' · '+fd.fee_pct+'% fee':'')) : '',
            el('div', { class: 'cc-sub', style: 'margin-top:6px;line-height:1.5' }, 'When factoring is active + NOA verified, broker pay panels route to THIS remit-to — never the carrier bank.'),
            can('finance.approve') ? el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
              pp.noa_status !== 'verified' ? el('button', { class: 'lb-btn lb-btn-sm', style: 'background:#7c3aed;border-color:#7c3aed', onClick: async (ev) => { const b = ev.currentTarget; if (!await askConfirm('Verify factoring NOA', { body: 'Verify this factoring NOA? Brokers will be routed to the factor remit-to (not the carrier bank) on every payment.' })) return; b.disabled = true; try { await ccFactoringVerify(orgId, true, null); alert('Factoring verified — broker payments now route to the factor.'); load(); } catch (e) { b.disabled = false; alert(humanizeError(e)); } } }, [icon('check',15),' Verify factoring / NOA']) : null,
              pp.noa_status !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async (ev) => { const why = prompt('Reject factoring NOA — reason (carrier sees this + gets an email):'); if (!why || !why.trim()) return; const b = ev.currentTarget; b.disabled = true; try { await ccFactoringVerify(orgId, false, why.trim()); load(); } catch (e) { b.disabled = false; alert(humanizeError(e)); } } }, [icon('x',15),' Reject NOA']) : null,
            ].filter(Boolean)) : null,
          ].filter(Boolean));
        })() : '',
        kv('Updated', fmtDateTime(pp.updated_at)),
        can('finance.approve') ? el('div', { style: 'margin-top:10px;display:flex;align-items:center;flex-wrap:wrap;gap:4px' }, [verifyBtn, bankRejectBtn].filter(Boolean)) : el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'Verification requires finance approver role.'),
      ].filter(Boolean));
    })();
    // ---- FMCSA CROSS-CHECK: what the carrier SUBMITTED vs the live government record ----
    const fmcsaXCard = card([el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'FMCSA cross-check'), el('span', { class: 'cc-sub' }, 'submitted vs live government record')]), el('div', { class: 'cc-sub', style: 'margin-top:8px' }, p.dot ? 'Checking FMCSA\u2026' : 'No DOT on file \u2014 nothing to check.')]);
    if (p.dot) (async () => {
      try {
        const rsp = await fetch('https://data.transportation.gov/resource/az4n-8mr2.json?dot_number=' + String(p.dot).replace(/\D/g, '') + '&$limit=1', { headers: { Accept: 'application/json' } });
        const arr = rsp.ok ? await rsp.json() : null; const c0 = (arr && arr[0]) || null;
        if (!c0) { mount(fmcsaXCard, [el('h4', { class: 'cc-card-title' }, 'FMCSA cross-check'), el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'No FMCSA record found for DOT ' + p.dot + ' \u2014 verify the number before approving.')]); return; }
        const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const XR = (label, ours, theirs, ok, warnOnly) => el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #eef2f7;font-size:.85rem' }, [
          el('span', { style: 'color:#64748b;font-weight:600' }, label),
          el('b', { style: 'color:#0f172a' }, ours == null || ours === '' ? '\u2014' : String(ours)),
          el('span', { style: 'color:#334155' }, theirs == null || theirs === '' ? '\u2014' : String(theirs)),
          el('span', { style: 'font-weight:800;text-align:center;color:' + (ok ? '#16a34a' : warnOnly ? '#d97706' : '#dc2626') }, ok ? '\u2713' : warnOnly ? '~' : '\u2717'),
        ]);
        const active = String(c0.status_code || '').toUpperCase() === 'A';
        const fmcsaHaz = String(c0.hm_ind || '').toUpperCase() === 'Y';
        const nameOk = norm(c0.legal_name) === norm(p.company) || norm(c0.dba_name) === norm(p.company);
        const mcOk = !p.mc || String(c0.docket1 || '').replace(/\D/g, '') === String(p.mc).replace(/\D/g, '');
        const pu = Number(c0.power_units || 0); const claimed = Number(p.truck_count || 0);
        const truckOk = !claimed || !pu || claimed <= pu;
        const hazOk = !p.hazmat || fmcsaHaz;
        const stOurs = String(p.home_base || '').split(',').pop().trim().toUpperCase();
        const stTheirs = String(c0.phy_state || '').toUpperCase();
        const stOk = !stOurs || !stTheirs || stOurs === stTheirs;
        mount(fmcsaXCard, [
          el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'FMCSA cross-check'), el('span', { class: 'cc-pill cc-pill-' + (active && nameOk && mcOk && hazOk ? 'green' : 'red') }, active && nameOk && mcOk && hazOk ? 'record matches' : 'MISMATCH \u2014 review')]),
          el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;font-size:.68rem;font-weight:800;letter-spacing:.06em;color:#94a3b8;text-transform:uppercase;padding:6px 0;border-bottom:2px solid #e6edf6;margin-top:6px' }, [el('span', null, 'Field'), el('span', null, 'Submitted'), el('span', null, 'FMCSA says'), el('span', null, '')]),
          XR('Operating status', 'n/a', active ? 'ACTIVE' : 'NOT ACTIVE', active, false),  // carriers don't self-report operating status; FMCSA is authoritative
          XR('Legal name', p.company, c0.legal_name, nameOk, false),
          XR('MC number', p.mc, c0.docket1 ? (c0.docket1prefix || 'MC') + c0.docket1 : null, mcOk, false),
          XR('Trucks', claimed || null, pu || null, truckOk, true),
          XR('Hazmat', p.hazmat ? 'Claims hazmat' : 'No hazmat', fmcsaHaz ? 'Authorized' : 'NOT authorized', hazOk, false),
          XR('Home state', stOurs || null, stTheirs || null, stOk, true),
          el('div', { class: 'cc-sub', style: 'margin-top:9px' }, [(!hazOk ? '\u26a0 Carrier requested hazmat but FMCSA shows NOT authorized \u2014 do not approve hazmat docs without proof. ' : ''), 'Live from FMCSA census \u00b7 drivers on record: ' + (c0.total_drivers || '\u2014') + ' \u00b7 full profile in the carrier\u2019s My Profile tab.']),
        ]);
      } catch (_) { mount(fmcsaXCard, [el('h4', { class: 'cc-card-title' }, 'FMCSA cross-check'), el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'FMCSA unreachable right now \u2014 try again shortly.')]); }
    })();
    // ---- ONE-STOP: Onboarding & compliance control (verify / reject / warn / approve — all here) ----
    const compCard = card([el('h4', { class: 'cc-card-title' }, 'Onboarding & compliance'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Loading…')]);
    async function loadComp() {
      let cc;
      try { cc = await getCarrierCompliance(orgId); }
      catch (e1) {
        await new Promise(r2 => setTimeout(r2, 900)); // one silent retry — hotspot blips happen
        try { cc = await getCarrierCompliance(orgId); }
        catch (e) {
          mount(compCard, [el('h4', { class: 'cc-card-title' }, 'Onboarding & compliance'),
            el('div', { class: 'cc-sub', style: 'margin-top:6px' }, humanizeError(e)),
            el('button', { class: 'lb-btn lb-btn-sm', style: 'margin-top:10px', onClick: () => loadComp() }, '\u21bb Retry')]);
          return;
        }
      }
      const reqs = (cc && cc.requirements) || [];
      const stage = (cc && cc.stage) || (d.onboarding && d.onboarding.stage) || 'not started';
      const rows = reqs.map((r) => {
        const tone = r.status === 'valid' ? 'green' : (r.status === 'pending' ? 'blue' : (r.status === 'expired' || r.status === 'rejected' ? 'red' : 'amber'));
        const exp = r.expiry_date ? (' · valid to ' + fmtDate(r.expiry_date)) : (r.requires_expiry && r.status === 'valid' ? ' · no expiry set' : '');
        const isW9 = /w-?9/i.test(r.name || r.key || ''); const isAgr = /agreement/i.test(r.name || r.key || '');
        const execBtn = (!r.document_id && (isW9 || isAgr)) ? el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
          const b9 = ev.currentTarget; b9.disabled = true;
          try {
            const data9 = isW9 ? await carrierW9(orgId) : await carrierAgreementSignature(orgId);
            if (!data9) { alert('No executed record on file yet.'); b9.disabled = false; return; }
            const SKIP9 = ['id', 'carrier_id', 'created_by'];
            const rows9 = Object.entries(data9).filter(([k9, v9]) => v9 != null && SKIP9.indexOf(k9) < 0)
              .map(([k9, v9]) => [k9.replace(/_/g, ' '), /(_at|date)$/.test(k9) && /\d{4}-\d{2}/.test(String(v9)) ? fmtDateTime(v9) : String(v9)]);
            const doPrint = async () => {
              try {
                if (isW9) { const mW = await import('../../carrier/w9-form.js'); mW.printExecutedW9(data9); }
                else { const mA = await import('../../carrier/dispatch-agreement.js'); mA.printExecutedAgreement({ approved: true, signer: data9.signer_name, date: data9.signed_date || (data9.signed_at ? fmtDateTime(data9.signed_at) : ''), carrier: d.name || (d.profile && d.profile.company) || '', mc: d.profile && d.profile.mc, dot: d.profile && d.profile.dot }); }
              } catch (e9b) { alert(humanizeError(e9b)); }
            };
            openDrawer((isW9 ? '\ud83e\uddfe Executed W-9' : '\u270d Dispatch Agreement \u2014 signature record'), [
              el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, [
                el('button', { class: 'lb-btn lb-btn-sm', onClick: doPrint }, '\u2b07 Open ORIGINAL signed document (print/PDF)'),
              ]),
              el('div', null, rows9.map(x9 => kv(x9[0], x9[1]))),
              el('div', { class: 'cc-sub', style: 'margin-top:10px' }, isW9
                ? 'Check: legal name matches FMCSA, TIN format valid, classification sensible, signature name matches an officer. Wrong/incomplete? Use \u2699 Actions \u2192 reject \u2014 the carrier must redo the W-9.'
                : 'Check: signer is an officer of the company and the name matches the FMCSA legal name. Not right? \u2699 Actions \u2192 reject \u2014 the carrier must re-sign.'),
            ]);
          } catch (e9) { alert(humanizeError(e9)); }
          b9.disabled = false;
        } }, '\ud83e\uddfe View executed') : null;
        const viewBtn = r.document_id ? el('button', { class: 'cc-chip-btn', onClick: async (ev) => {
          const b0 = ev.currentTarget; b0.disabled = true;
          try {
            const f = await documentFile(r.document_id);
            const url = await signedDocumentUrl(f.file_path);
            const isImg = /\.(png|jpe?g|webp|gif)$/i.test(f.file_path || '');
            openDrawer('\ud83d\udcc4 ' + r.name, [
              el('div', { style: 'display:flex;gap:8px;margin-bottom:10px' }, [
                el('a', { class: 'lb-btn lb-btn-sm', href: url, download: (f.file_name || r.name || 'document'), target: '_blank' }, '\u2b07 Download'),
                el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: url, target: '_blank' }, '\u2197 Open in new tab'),
              ]),
              isImg
                ? el('img', { src: url, style: 'width:100%;border:1px solid #e8edf3;border-radius:12px' })
                : el('iframe', { src: url, style: 'width:100%;height:70vh;border:1px solid #e8edf3;border-radius:12px;background:#fff' }),
            ]);
          } catch (e) { alert(humanizeError(e)); }
          b0.disabled = false;
        } }, [icon('doc',15),' View']) : '';
        const verifyBtn = can('compliance.verify') ? el('button', { class: 'cc-chip-btn', onClick: () => {
          const st = el('select', { class: 'cc-input' }, ['valid', 'pending', 'rejected', 'expired', 'waived'].map((x) => el('option', { value: x, selected: x === r.status ? 'selected' : null }, x)));
          const ex = el('input', { class: 'cc-input', type: 'date', value: r.expiry_date || '' });
          const nt = el('input', { class: 'cc-input', placeholder: 'Note / reason (required on reject)', value: r.note || '' });
          const dr = openDrawer('Verify: ' + r.name, el('div', { class: 'cc-form' }, [
            el('div', { class: 'cc-field' }, [el('span', null, 'Status'), st]),
            el('div', { class: 'cc-field' }, [el('span', null, 'Expiry date (from the document)'), ex]),
            el('div', { class: 'cc-field' }, [el('span', null, 'Note'), nt]),
            el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => { const b1 = ev.currentTarget; if (st.value === 'rejected' && !nt.value.trim()) { alert('Rejection needs a written reason — the carrier sees it.'); return; } b1.disabled = true; try { await setCompliance({ carrier: orgId, requirement: r.key, status: st.value, expiry: ex.value || null, note: nt.value || null }); dr.close(); loadComp(); } catch (e) { alert(humanizeError(e)); b1.disabled = false; } } }, 'Save decision'),
          ]));
        } }, 'Verify') : '';
        const DOC_HINT = {
          coi: 'Check: certificate holder = LoadBoot, auto liability $1M, cargo $100k, dates current, agent-issued (not carrier-typed).',
          w9: 'Check: legal name matches FMCSA, TIN format, signature present, current revision.',
          authority: 'Check: MC/DOT match the application, status ACTIVE, no pending revocation.',
          agreement: 'Check: signed by an officer of the company, name matches FMCSA legal name.',
          hazmat: 'Check: PHMSA registration current year, CDL-H endorsement legible, hazmat COI endorsement present.',
          bank: 'Check: account holder name matches company legal name, voided check or bank letter, legible.',
        };
        const hintFor = (name2) => { const k2 = String(name2 || '').toLowerCase();
          if (/coi|insurance/.test(k2)) return DOC_HINT.coi; if (/w-?9/.test(k2)) return DOC_HINT.w9;
          if (/authority|mc\/dot/.test(k2)) return DOC_HINT.authority; if (/agreement/.test(k2)) return DOC_HINT.agreement;
          if (/hazmat|phmsa|cdl/.test(k2)) return DOC_HINT.hazmat; if (/bank/.test(k2)) return DOC_HINT.bank; return null; };
        const warnBtn = can('compliance.verify') ? el('button', { class: 'cc-chip-btn', title: 'Actions for THIS document', onClick: () => {
          const REASONS = ['Expired — current version needed', 'Illegible / bad scan', 'Wrong document uploaded', 'Details do not match FMCSA record', 'Missing signature or endorsement', 'Filled incorrectly / incomplete details', 'Suspected altered / fraudulent', 'Other (describe below)'];
          const rs = el('select', { class: 'cc-input' }, REASONS.map(x => el('option', { value: x }, x)));
          const desc = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Details the carrier will read — be specific about what to fix.' });
          const CONS = [['warn', 'Warn only — account stays as it is'], ['reject', 'Reject document — carrier MUST re-upload (requirement goes back to pending)'], ['warn_reject', 'Both — reject + formal warning (points deducted)']];
          let consVal = 'warn';
          const consEl = el('div', null, CONS.map(([v2, l2]) => el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:.85rem;cursor:pointer' }, [
            el('input', { type: 'radio', name: 'c3cons', value: v2, checked: v2 === 'warn' ? 'checked' : undefined, onChange: () => { consVal = v2; } }), el('span', null, l2)])));
          const hint = hintFor(r.name);
          const dr2 = openDrawer('Document action — ' + r.name, [
            hint ? el('div', { style: 'background:#eef6ff;border:1px solid #bfdbfe;border-radius:10px;padding:9px 12px;font-size:.82rem;color:#1e40af;margin-bottom:10px' }, '\ud83d\udca1 Reviewer hint: ' + hint) : null,
            el('label', { class: 'cc-sub', style: 'font-weight:700' }, 'Reason'), rs,
            el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:8px;display:block' }, 'Description (carrier sees this)'), desc,
            el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:8px;display:block' }, 'Consequence'), consEl,
            el('div', { style: 'margin-top:12px;display:flex;gap:8px' }, [
              el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev2) => { const _b_ = ev2.currentTarget;
                const msg2 = rs.value + (desc.value.trim() ? ' — ' + desc.value.trim() : '');
                _b_.disabled = true;
                try {
                  if (consVal === 'reject' || consVal === 'warn_reject') await setCompliance({ carrier: orgId, requirement: r.key, status: 'rejected', expiry: null, note: msg2 });
                  if (consVal === 'warn' || consVal === 'warn_reject') await issueViolation(orgId, 'document', 'warning', '[' + r.name + '] ' + msg2);
                  dr2.close(); loadComp();
                } catch (e2) { alert(humanizeError(e2)); _b_.disabled = false; }
              } }, 'Apply'),
              el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dr2.close() }, 'Cancel'),
            ]),
            el('div', { class: 'cc-sub', style: 'margin-top:10px;font-size:.78rem' }, 'Account-level actions (move whole account to review / pause / suspend) live on the Health engine card \u2014 document actions here stay scoped to this document.'),
          ].filter(Boolean));
        } }, '\u2699 Actions') : '';
        return el('div', { style: 'display:flex;gap:9px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eef2f7' }, [
          el('div', { style: 'min-width:0' }, [el('b', { style: 'font-size:.88rem' }, r.name), el('div', { class: 'cc-sub' }, (r.mandatory ? 'Required' : 'Optional') + exp + (r.note ? ' · ' + r.note : ''))]),
          el('div', { style: 'display:flex;gap:6px;align-items:center;flex:none' }, [el('span', { class: 'cc-pill cc-pill-' + tone }, r.status),
            (r.status !== 'valid') ? el('button', { class: 'cc-chip-btn', title: 'Email + in-app reminder for THIS document (6h cooldown)', onClick: async (ev) => { const b9 = ev.currentTarget; b9.disabled = true;
              try { const r9 = await ccOnboardingRemind(orgId, r.name || r.key); b9.textContent = '✓ Sent'; alert('Reminder sent' + (r9 && r9.sent_to ? ' to ' + r9.sent_to : '') + ' — premium email + in-app, for: ' + (r.name || r.key)); }
              catch (e9) { b9.disabled = false; alert(humanizeError(e9)); } } }, [icon('mail',15),' Remind']) : null,
            execBtn, viewBtn, verifyBtn, warnBtn].filter(Boolean)),
        ]);
      });
      const allOk = reqs.filter((r) => r.mandatory).every((r) => r.status === 'valid');
      const _stg = String(stage).toLowerCase();
      const _isApproved = ['approved', 'active', 'completed'].indexOf(_stg) >= 0;
      const gate = can('compliance.approve')  // show controls at every stage; Approve self-guards on allOk
        ? (() => {
            const pubBtn = el('button', { class: 'lb-btn lb-btn-secondary' }, '\ud83d\udce2 Publish to brokers');
            (async () => { try { const v9 = await getBrokerVisibility(orgId); pubBtn.dataset.vis = v9 ? '1' : '0'; pubBtn.textContent = v9 ? '\ud83d\ude48 Unpublish from brokers' : '\ud83d\udce2 Publish to brokers'; } catch (_) {} })();
            pubBtn.onclick = async () => {
              const cur9 = pubBtn.dataset.vis === '1';
              if (!confirm(cur9 ? 'Remove this carrier from broker portals? Brokers will no longer see or match this profile.' : 'Publish this carrier to broker portals? Brokers will see the verified profile and can send direct requests.')) return;
              pubBtn.disabled = true;
              try { const r9 = await setBrokerVisibility(orgId, !cur9, null); pubBtn.dataset.vis = r9.broker_visible ? '1' : '0'; pubBtn.textContent = r9.broker_visible ? '\ud83d\ude48 Unpublish from brokers' : '\ud83d\udce2 Publish to brokers'; }
              catch (e) { alert(humanizeError(e)); }
              pubBtn.disabled = false;
            };
            return el('div', { style: 'display:flex;gap:9px;margin-top:14px;align-items:center;justify-content:flex-start;flex-wrap:wrap;border-top:1px solid #eef2f7;padding-top:12px' }, [
              _isApproved
                ? el('button', { class: 'lb-btn lb-btn-primary', disabled: 'disabled', style: 'opacity:.75', title: 'Account is approved \u2014 booking unlocked' }, '\u2713 Account approved')
                : el('button', { class: 'lb-btn lb-btn-primary', disabled: allOk ? null : 'disabled', title: allOk ? '' : 'All mandatory documents must be valid first', onClick: async (ev) => { const _btn9 = ev.currentTarget; if (!await askConfirm('Please confirm', { body: 'Approve this carrier account? Booking unlocks. (Publishing to broker portals is the separate button.)', danger: true })) return; _btn9.disabled = true; try { await decideOnboarding(orgId, 'approve', null); alert('Approved \ud83c\udf89 Carrier notified \u00b7 booking unlocked. Use \u201cPublish to brokers\u201d when ready.'); loadComp(); } catch (e) { alert(humanizeError(e)); _btn9.disabled = false; } } }, '\u2713 Approve account'),
              pubBtn,
              el('button', { style: 'margin-left:auto;border:1px solid #fecaca;background:#fff;color:#b91c1c;font-weight:800;border-radius:10px;padding:10px 18px;cursor:pointer', onClick: async (ev) => { const _btn9 = ev.currentTarget; const why = prompt((_isApproved ? 'Revoke approval' : 'Rejection reason') + ' \u2014 reason (carrier sees this):'); if (!why || !why.trim()) return; if (_isApproved && !await askConfirm('Please confirm', { body: 'Revoke approval? Booking locks again, the account goes back to review, and the carrier is notified with your reason.', danger: true })) return; _btn9.disabled = true; try { await decideOnboarding(orgId, 'reject', why.trim()); loadComp(); } catch (e) { alert(humanizeError(e)); _btn9.disabled = false; } } }, _isApproved ? '\u2715 Revoke approval' : '\u2715 Reject application'),
            ]);
          })()
        : el('div', { class: 'cc-sub', style: 'margin-top:10px' }, 'Onboarding stage: ' + stage);
      const mand = reqs.filter((r) => r.mandatory); const mandOkN = mand.filter((r) => r.status === 'valid').length;
      const agr = reqs.find((r) => /agreement/i.test(r.name || ''));
      const step = (label, state) => el('div', { style: 'display:flex;gap:6px;align-items:center;background:' + (state === 'ok' ? '#e7f9ee' : state === 'wait' ? '#eff6ff' : '#fef3c7') + ';border-radius:99px;padding:5px 12px;font-size:.74rem;font-weight:800;color:' + (state === 'ok' ? '#12a150' : state === 'wait' ? '#1d4ed8' : '#b45309') }, [(state === 'ok' ? '\u2713 ' : state === 'wait' ? '\u23f3 ' : '\u25cb ') + label]);
      const pipeline = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 12px' }, [
        step('Application', (p.company && p.dot) ? 'ok' : 'todo'),
        step('Documents ' + mandOkN + '/' + mand.length, mandOkN === mand.length ? 'ok' : 'wait'),
        step('Agreement', agr && agr.status === 'valid' ? 'ok' : agr && agr.status === 'pending' ? 'wait' : 'todo'),
        step('Decision', String(stage).toLowerCase() === 'approved' ? 'ok' : ['submitted', 'in_review', 'review'].indexOf(String(stage).toLowerCase()) >= 0 ? 'wait' : 'todo'),
      ]);
      const remindWrap9 = el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:2px 0 10px' });
      (async () => {
        let st9 = null; try { st9 = await ccOnboardingReminderStatus(orgId); } catch (_) {}
        const f9 = (x9) => x9 ? new Date(x9).toLocaleString() : 'never';
        mount(remindWrap9, el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;width:100%' }, [
          allOk ? null : el('button', { class: 'lb-btn', style: 'border:1px solid #0883F7;color:#0883F7;background:#fff;font-weight:800;border-radius:10px;padding:8px 16px;cursor:pointer', onClick: async (ev) => { const b9 = ev.currentTarget; b9.disabled = true;
            try { const r9 = await ccOnboardingRemind(orgId, null); b9.textContent = '✓ Reminder sent'; alert('Overall onboarding reminder sent' + (r9 && r9.sent_to ? ' to ' + r9.sent_to : '') + ' — premium email listing every missing item + in-app. Auto-nags keep running on their own schedule.'); }
            catch (e9) { b9.disabled = false; alert(humanizeError(e9)); } } }, [icon('mail',15),' Send onboarding reminder (all missing)']),
          el('span', { class: 'cc-sub', style: 'font-size:.76rem' }, st9 ? ('Last manual reminder: ' + f9(st9.last_manual) + (st9.last_auto ? ' · last auto: ' + f9(st9.last_auto) : '') + ' · auto engine runs on cron — these buttons are the extra human push') : ''),
        ].filter(Boolean)));
      })();
      mount(compCard, [el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Onboarding & compliance'), el('span', { class: 'cc-pill cc-pill-' + (allOk ? 'green' : 'amber') }, allOk ? 'all mandatory valid' : 'action needed')]), pipeline, remindWrap9, el('div', null, rows.length ? rows : el('div', { class: 'cc-sub' }, 'No requirements found.')), gate]);
    }
    loadComp();

    // ---- LIVE HEALTH ENGINE (same cc_account_health the carrier sees) — grouped breakdown ----
    const engineCard = card([el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Health engine \u2014 live score')]), el('div', { class: 'cc-sub' }, 'Loading\u2026')]);
    (async () => {
      let ah = null; try { ah = await accountHealth(orgId); } catch (e) { mount(engineCard, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      const tier = ah.tier || '\u2014';
      const tcol = tier === 'healthy' ? '#16a34a' : tier === 'building' ? '#0883F7' : tier === 'at_risk' ? '#f59e0b' : '#dc2626';
      // Proper warn form (drawer) — used by factor-level and account-level warn buttons
      const TEAMS9 = ['Health team', 'Reinstatement team', 'Compliance team', 'Billing team', 'Reimbursement team', 'Safety team'];
      const mkTeam = (def9) => el('select', { class: 'cc-input' }, TEAMS9.map((t9) => el('option', { value: t9, selected: t9 === def9 ? 'selected' : undefined }, t9)));
      const mkRestrict = () => {
        const sel = el('select', { class: 'cc-input' }, [
          ['none', 'No account change \u2014 keeps working normally'],
          ['booking', '\u23f8 Pause BOOKING \u2014 loads blocked until reinstated'],
          ['all', '\u26d4 Pause ALL SERVICES \u2014 full freeze until reinstated'],
        ].map(([v9, l9]) => el('option', { value: v9 }, l9)));
        const apply = async (reasonTxt) => {
          if (sel.value === 'none') return '';
          await pauseCarrier(orgId, 'pause', sel.value, reasonTxt);
          return sel.value === 'booking' ? ' \u00b7 booking paused' : ' \u00b7 account frozen';
        };
        return { sel, apply };
      };
      const openWarnForm = (factorLabel) => {
        const sev9 = el('select', { class: 'cc-input' }, [
          ['warning', 'Warning \u2014 \u22125 points, auto-expires in 90 days'],
          ['violation', 'Violation \u2014 \u221215 points, auto-expires in 180 days'],
          ['critical', 'Critical \u2014 \u221240 points, stays 365 days'],
        ].map(([v9, l9]) => el('option', { value: v9 }, l9)));
        const cat9 = el('select', { class: 'cc-input' }, [
          'Late / cancelled without notice', 'Tracking off or unreachable during a trip', 'False or misleading information',
          'Unprofessional conduct with broker / facility', 'Document or compliance issue', 'Safety practice concern', 'Other (describe below)',
        ].map((x9) => el('option', { value: x9 }, x9)));
        const why9 = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Describe exactly what happened \u2014 date, trip, what the carrier did. The carrier reads these exact words.' });
        const rst9 = mkRestrict();
        const dw9 = openDrawer('\u26a0 Warn \u2014 ' + (factorLabel || 'whole account'), [
          factorLabel ? el('div', { class: 'cc-sub' }, 'Factor: ' + factorLabel) : null,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:10px;display:block' }, 'Severity'), sev9,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason category'), cat9,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Description (required \u2014 carrier sees this)'), why9,
          el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Account effect along with this strike'), rst9.sel,
          el('div', { style: 'background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px 14px;font-size:.83rem;color:#78350f;margin-top:12px;line-height:1.55' }, [
            el('div', { style: 'font-weight:800;margin-bottom:3px' }, 'What happens:'),
            'Points are deducted from the health score immediately \u00b7 carrier gets an urgent notification with your description \u00b7 the strike shows in their Account Health with its expiry date \u00b7 audit-logged.',
            el('div', { style: 'font-weight:800;margin:8px 0 3px' }, 'How it clears:'),
            'Auto-expires per severity above \u2014 or resolve it early from the Account health board once the carrier corrects it.',
          ]),
          el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev9) => { const _b_ = ev9.currentTarget;
              if (!why9.value.trim()) { alert('Description is required \u2014 the carrier must know exactly what happened.'); return; }
              _b_.disabled = true; _b_.textContent = 'Issuing\u2026';
              if (rst9.sel.value !== 'none' && !confirm(rst9.sel.value === 'all' ? 'Freeze the ENTIRE account along with this strike?' : 'Pause booking along with this strike?')) return;
              try {
                await issueViolation(orgId, 'conduct', sev9.value, (factorLabel ? '[' + factorLabel + '] ' : '') + cat9.value + ' \u2014 ' + why9.value.trim());
                const ex9 = await rst9.apply((factorLabel ? '[' + factorLabel + '] ' : '') + 'Strike: ' + cat9.value + ' \u2014 ' + why9.value.trim());
                dw9.close(); alert('\u26a0 Issued \u2014 points deducted, carrier notified' + ex9 + '.');
              } catch (e9) { _b_.disabled = false; _b_.textContent = 'Issue warning'; alert(humanizeError(e9)); }
            } }, 'Issue warning'),
            el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dw9.close() }, 'Cancel'),
          ]),
        ].filter(Boolean));
      };
      const GRP_CTRL = {
        reliability: { fix: 'Late/cancel events heal over the 180-day window — every new on-time load replaces an old one. Approved emergencies should be excluded (check Emergency requests).', go: ['#/exception-center', 'Open Exception Center'] },
        communication: { fix: 'Tracking gaps: tell the carrier to run trips from the Live map. Open exceptions clear the moment you resolve them.', go: ['#/exception-center', 'Resolve open exceptions'] },
        compliance: { fix: 'Clears INSTANTLY when documents are verified — decide them below in Onboarding & compliance.', go: [null, 'Jump to documents', () => compCard.scrollIntoView({ behavior: 'smooth' })] },
        conduct: { fix: 'Staff strikes: warnings auto-expire in 90d, violations 180d. Resolve early from Account health board once corrected.', go: ['#/account-health', 'Open Account health board'] },
        financial: { fix: 'Clears on payment — check invoices in the payout card below.', go: [null, 'Jump to payout', () => payoutCard.scrollIntoView({ behavior: 'smooth' })] },
      };
      const grpRow = (g) => {
        const pct = g.weight ? Math.round(g.earned / g.weight * 100) : 100;
        const c2 = pct >= 100 ? '#16a34a' : pct >= 60 ? '#f59e0b' : '#dc2626';
        return el('div', { style: 'margin:7px 0;cursor:pointer', title: 'Open factor control', onClick: () => {
          const ctl = GRP_CTRL[g.key] || {};
          openDrawer(g.label + ' — ' + g.earned + '/' + g.weight, [
            el('div', null, (g.items || []).map(it => el('div', { style: 'border:1px solid #e8edf3;border-radius:10px;padding:9px 12px;margin-bottom:8px' }, [
              el('div', { style: 'display:flex;justify-content:space-between;font-weight:800;font-size:.86rem' }, [el('span', null, it.label), Number(it.deducted) > 0 ? el('span', { style: 'color:#dc2626' }, '\u2212' + it.deducted + ' pts') : el('span', { style: 'color:#16a34a' }, '\u2713 full')]),
              el('div', { style: 'font-size:.83rem;color:#334155;margin-top:3px' }, 'Value: ' + String(it.value ?? '\u2014') + ' \u00b7 target ' + (it.target || '\u2014')),
              it.basis ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, it.basis) : null,
              it.improve ? el('div', { style: 'font-size:.8rem;color:#0883F7;margin-top:3px' }, '\u21b3 carrier fix: ' + it.improve) : null,
            ].filter(Boolean)))),
            ctl.fix ? el('div', { style: 'background:#eef6ff;border:1px solid #bfdbfe;border-radius:10px;padding:9px 12px;font-size:.83rem;color:#1e40af;margin-top:6px' }, '\ud83c\udf9b Staff lever: ' + ctl.fix) : null,
            ctl.go ? el('div', { style: 'margin-top:10px' }, el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { if (ctl.go[2]) ctl.go[2](); else location.hash = ctl.go[0]; } }, ctl.go[1])) : null,
            can('carriers.approve') ? el('div', { style: 'margin-top:12px;border-top:1px solid #eef2f7;padding-top:10px' }, [
              el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin-bottom:6px' }, 'Enforce this factor'),
              el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
                el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => openWarnForm(g.label) }, '\u26a0 Warn (this factor)'),
                el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => {
                  // --- full POA demand form: pick exactly what the carrier must answer/attach ---
                  const chk = (val, lab, on) => { const c9 = el('input', { type: 'checkbox', checked: on ? 'checked' : undefined }); c9.dataset.val = val; return el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:.85rem;cursor:pointer' }, [c9, el('span', null, lab)]); };
                  const ansBox = el('div', null, [
                    chk('Root cause \u2014 what exactly happened and why', 'Root cause \u2014 what exactly happened and why', true),
                    chk('Corrective action already taken', 'Corrective action already taken', true),
                    chk('Prevention plan \u2014 how it will never repeat', 'Prevention plan \u2014 how it will never repeat', true),
                    chk('Committed dates / timeline for each step', 'Committed dates / timeline for each step', false),
                  ]);
                  const docBox = el('div', null, [
                    chk('Updated Certificate of Insurance (COI) \u2014 PDF', 'Updated Certificate of Insurance (COI) \u2014 PDF', false),
                    chk('FMCSA authority proof / MCS-150', 'FMCSA authority proof / MCS-150', false),
                    chk('ELD / GPS logs for the trips in question', 'ELD / GPS logs for the trips in question', false),
                    chk('Repair / inspection / training records', 'Repair / inspection / training records', false),
                    chk('Payment or settlement proof', 'Payment or settlement proof', false),
                  ]);
                  const otherDoc = el('input', { class: 'cc-input', placeholder: 'Any other document (optional)' });
                  const dl9 = el('select', { class: 'cc-input' }, [['24 hours', '24 hours'], ['48 hours', '48 hours'], ['3 days', '3 days'], ['7 days', '7 days']].map(([v9, l9]) => el('option', { value: v9 }, l9)));
                  const cons9 = el('select', { class: 'cc-input' }, [
                    ['a formal WARNING: \u22125 points from your Conduct & policy factor (citing ' + g.label + '), auto-expires in 90 days', 'Warning \u2014 \u22125 pts from Conduct & policy (90 days)'],
                    ['a VIOLATION: \u221215 points from your Conduct & policy factor (citing ' + g.label + '), auto-expires in 180 days', 'Violation \u2014 \u221215 pts from Conduct & policy (180 days)'],
                    ['a CRITICAL violation: \u221240 points from your Conduct & policy factor (citing ' + g.label + '), stays 365 days', 'Critical \u2014 \u221240 pts from Conduct & policy (365 days)'],
                    ['BOOKING being paused until reinstated', 'Booking paused'],
                    ['the WHOLE ACCOUNT being paused until reinstated', 'Full account pause'],
                  ].map(([v9, l9]) => el('option', { value: v9 }, l9)));
                  const consHint = el('div', { class: 'cc-sub', style: 'margin-top:4px' }, 'The exact points + factor go in the carrier\u2019s notification \u2014 no surprises. Enforcement stays manual: after the deadline, issue it via \u26a0 Warn (or Pause) yourself.');
                  const q9 = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'One question per line, e.g.\nWho was driving on the late trip of Jul 3?\nWhy was tracking off between pickup and delivery?' });
                  const msg9 = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Custom message to the carrier (optional) \u2014 sent word-for-word in the notification + email.' });
                  const teamP = mkTeam('Health team');
                  const rstP = mkRestrict();
                  const picked = (box) => Array.from(box.querySelectorAll('input:checked')).map((c9) => c9.dataset.val);
                  const dr9 = openDrawer('\ud83d\udccb Demand plan of action \u2014 ' + g.label, [
                    el('div', { class: 'cc-sub' }, 'Carrier gets an urgent notification + branded email listing EXACTLY what you require. Their answer lands in \u201cHealth requests\u201d on this page.'),
                    el('div', { style: 'background:#e7f9ee;border:1px solid #bbf7d0;border-radius:10px;padding:9px 12px;font-size:.82rem;color:#166534;margin-top:8px' }, '\u2713 No points are deducted by this demand \u2014 it only asks for answers. Points are deducted only via \u26a0 Warn, and the \u201cif no answer\u201d consequence below is a promise you enforce manually after the deadline.'),
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'The plan must answer'), ansBox,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Required documents (attach on the form, correct format enforced)'), docBox, otherDoc,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Specific questions the carrier must answer'), q9,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Deadline to respond'), dl9,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Send as (team)'), teamP,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Account effect WHILE the answer is pending'), rstP.sel,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'If no answer by the deadline'), cons9, consHint,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Custom message'), msg9,
                    el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                      el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev9) => { const _b_ = ev9.currentTarget;
                        const answers = picked(ansBox); const docs9 = picked(docBox); if (otherDoc.value.trim()) docs9.push(otherDoc.value.trim());
                        const qs9 = q9.value.split('\n').map((x9) => x9.trim()).filter(Boolean);
                        if (!answers.length && !docs9.length && !qs9.length && !msg9.value.trim()) { alert('Select at least one requirement, ask a question, or write a message.'); return; }
                        const note9 = [
                          'FROM: ' + teamP.value.toUpperCase(),
                          answers.length ? 'MUST ANSWER: ' + answers.join(' \u00b7 ') : null,
                          qs9.length ? 'QUESTIONS: ' + qs9.map((x9, i9) => (i9 + 1) + ') ' + x9).join('  ') : null,
                          docs9.length ? 'REQUIRED DOCUMENTS: ' + docs9.join(' \u00b7 ') : null,
                          'DEADLINE: respond within ' + dl9.value,
                          'IF NO ANSWER: this results in ' + cons9.value + '.',
                          msg9.value.trim() ? 'NOTE FROM ' + teamP.value.toUpperCase() + ': ' + msg9.value.trim() : null,
                        ].filter(Boolean).join('\n');
                        if (rstP.sel.value !== 'none' && !confirm(rstP.sel.value === 'all' ? 'Freeze the ENTIRE account until they answer?' : 'Pause booking until they answer?')) return;
                        _b_.disabled = true; _b_.textContent = 'Sending\u2026';
                        try {
                          await requestPoa(orgId, g.label, note9);
                          const extraP = await rstP.apply('[' + g.label + '] Plan of action demanded \u2014 ' + (msg9.value.trim() || 'answer required') + ' (restriction until answered/reinstated)');
                          dr9.close(); alert('POA demanded \u2713 carrier notified + emailed with your exact requirements' + extraP + '.');
                        } catch (e9) { _b_.disabled = false; _b_.textContent = 'Send demand'; alert(humanizeError(e9)); }
                      } }, 'Send demand'),
                      el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dr9.close() }, 'Cancel'),
                    ]),
                  ]);
                } }, '\ud83d\udccb Demand plan of action'),
                el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => {
                  // ---- \u00b1 Adjust points form: exact points, reason, fix instruction, expiry \u2014 carrier fully notified ----
                  const pts9 = el('input', { class: 'cc-input', type: 'number', min: '-40', max: '40', step: '1', value: '-5', style: 'max-width:120px' });
                  const dir9 = el('div', { class: 'cc-sub', style: 'margin-top:4px' });
                  const updDir = () => { const v8 = Number(pts9.value) || 0; dir9.textContent = v8 > 0 ? '+' + v8 + ' \u2014 score INCREASES by ' + v8 + ' points (credit / restore)' : v8 < 0 ? v8 + ' \u2014 score DECREASES by ' + Math.abs(v8) + ' points (penalty)' : 'Enter a non-zero number between \u221240 and +40'; dir9.style.color = v8 > 0 ? '#12a150' : v8 < 0 ? '#b91c1c' : '#64748b'; };
                  pts9.oninput = updDir; updDir();
                  const why8 = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Why (required) \u2014 carrier reads these exact words: which incident, which trip, what rule.' });
                  const fix8 = el('textarea', { class: 'cc-input', rows: '2', placeholder: 'How to fix / recover (required for penalties) \u2014 exact instruction, e.g. \u201cUpload valid COI; points restore on verification.\u201d' });
                  const exp8 = el('select', { class: 'cc-input' }, [['', 'Never \u2014 until manually revoked'], ['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['180', '180 days']].map(([v8, l8]) => el('option', { value: v8 }, l8)));
                  const drA = openDrawer('\u00b1 Adjust points \u2014 ' + g.label, [
                    el('div', { class: 'cc-sub' }, 'Current: ' + g.earned + '/' + g.weight + ' on this factor \u00b7 the adjustment applies to the TOTAL score and is itemized on the carrier\u2019s Account Health page with your reason + fix instruction. Notification + email go out immediately.'),
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Points (\u221240 \u2026 +40)'), pts9, dir9,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason (carrier sees this)'), why8,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'How to fix / what it means for them'), fix8,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Auto-expires'), exp8,
                    el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                      el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev8) => { const _b8 = ev8.currentTarget;
                        const v8 = Number(pts9.value) || 0;
                        if (!v8 || Math.abs(v8) > 40) { alert('Points must be a non-zero number between \u221240 and +40.'); return; }
                        if (!why8.value.trim()) { alert('A written reason is required \u2014 the carrier must know why.'); return; }
                        if (v8 < 0 && !fix8.value.trim()) { alert('For penalties, tell the carrier HOW to fix it \u2014 that is the deal.'); return; }
                        _b8.disabled = true; _b8.textContent = 'Applying\u2026';
                        try { const r8 = await healthAdjust(orgId, g.label, v8, why8.value.trim(), fix8.value.trim() || null, exp8.value ? Number(exp8.value) : null); drA.close(); alert((v8 > 0 ? '+' : '') + v8 + ' applied \u2014 new score ' + r8.new_score + ' \u00b7 carrier notified + emailed with reason & fix.'); location.reload(); } catch (e8) { _b8.disabled = false; _b8.textContent = 'Apply adjustment'; alert(humanizeError(e8)); }
                      } }, 'Apply adjustment'),
                      el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => drA.close() }, 'Cancel'),
                    ]),
                  ]);
                } }, '\u00b1 Adjust points'),
                el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => {
                  const catR = el('select', { class: 'cc-input' }, ['Issue verified as fixed \u2014 goodwill reset', 'Deduction was our error / wrong data', 'Approved emergency \u2014 should not count', 'Dispute resolved in carrier\u2019s favour', 'Fresh start agreed with carrier', 'Other (describe below)'].map((x8) => el('option', { value: x8 }, x8)));
                  const msgR = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Details (required) \u2014 carrier reads these exact words with the restore notification.' });
                  const teamR = mkTeam('Health team');
                  const drR = openDrawer('\u267b Reset factor \u2014 ' + g.label, [
                    el('div', { class: 'cc-sub' }, 'Currently lost on this factor: ' + g.deducted + ' of ' + g.weight + ' points.'),
                    el('div', { style: 'background:#e7f9ee;border:1px solid #bbf7d0;border-radius:12px;padding:12px 14px;font-size:.83rem;color:#166534;margin-top:8px;line-height:1.55' }, [
                      el('div', { style: 'font-weight:800;margin-bottom:3px' }, 'What happens:'),
                      (g.key === 'conduct' ? 'ALL open strikes resolve immediately \u00b7 ' : '') + 'the ' + g.deducted + ' lost point(s) restore as an itemized credit \u00b7 carrier gets a \u201cpoints restored\u201d notification + email with your reason \u00b7 audit-logged.',
                    ]),
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Send as (team)'), teamR,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason category'), catR,
                    el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Details (required)'), msgR,
                    el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                      el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev8) => { const _b8 = ev8.currentTarget;
                        if (!msgR.value.trim()) { alert('Details are required \u2014 the carrier must know why points came back.'); return; }
                        _b8.disabled = true; _b8.textContent = 'Resetting\u2026';
                        try { const r8 = await healthResetFactor(orgId, g.key, 'FROM: ' + teamR.value.toUpperCase() + ' \u2014 ' + catR.value + ': ' + msgR.value.trim()); drR.close(); alert('\u267b Reset done \u2014 restored ' + r8.restored + ' pts' + (r8.strikes_resolved ? ', resolved ' + r8.strikes_resolved + ' strike(s)' : '') + ' \u00b7 new score ' + r8.new_score + ' \u00b7 carrier notified.'); location.reload(); } catch (e8) { _b8.disabled = false; _b8.textContent = '\u267b Reset factor'; alert(/nothing to reset|already at full/i.test((e8 && e8.message) || '') ? 'Nothing to reset \u2014 this factor is already at full points (the view may be stale; refresh the page).' : humanizeError(e8)); }
                      } }, '\u267b Reset factor'),
                      el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => drR.close() }, 'Cancel'),
                    ]),
                  ]);
                } }, '\u267b Reset factor'),
                el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async (ev9) => { const _b_ = ev9.currentTarget;
                  const why = await askReason('\u23f8 Pause BOOKING over \u201c' + g.label + '\u201d \u2014 reason (carrier sees this):'); if (!why) return;
                  if (!await askConfirm('Please confirm', { body: 'Pause booking now? Carrier gets urgent notification + email, and must request reinstatement.', danger: true })) return;
                  _b_.disabled = true;
                  try { await pauseCarrier(orgId, 'pause', 'booking', '[' + g.label + '] ' + why); _b_.textContent = 'Booking paused \u2713'; } catch (e9) { _b_.disabled = false; alert(humanizeError(e9)); }
                } }, '\u23f8 Pause booking'),
              ]),
            ]) : null,
          ].filter(Boolean));
        } }, [
          el('div', { style: 'display:flex;justify-content:space-between;font-size:.82rem;font-weight:700' }, [el('span', null, g.label + ' \u203a'), el('span', { style: 'color:' + c2 }, g.earned + '/' + g.weight)]),
          el('div', { style: 'height:6px;border-radius:99px;background:#e8edf3;overflow:hidden;margin-top:3px' }, el('div', { style: 'height:100%;width:' + Math.max(3, pct) + '%;background:' + c2 })),
        ]);
      };
      const deds = (ah.deductions || []).slice(0, 5);
      const warnBtn = can('carriers.verify') || can('compliance.verify') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => openWarnForm(null) }, '\u26a0 Warn account') : null;
      mount(engineCard, el('div', null, [
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Health engine \u2014 live score'), el('span', { class: 'cc-pill', style: 'background:' + tcol + '1a;color:' + tcol + ';font-weight:800' }, String(ah.score) + ' \u00b7 ' + tier.replace('_', ' ').toUpperCase())]),
        el('div', null, (ah.groups || []).map(grpRow)),
        deds.length ? el('div', { style: 'margin-top:8px' }, [el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin-bottom:3px' }, 'Active deductions'),
          el('div', null, deds.map(d2 => el('div', { style: 'font-size:.83rem;color:#334155;padding:3px 0' }, '\u2212' + d2.deducted + ' \u2014 ' + d2.label + (d2.basis ? ' (' + d2.basis + ')' : ''))))]) : el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No deductions \u2014 clean account.'),
        warnBtn ? el('div', { style: 'margin-top:10px' }, warnBtn) : null,
        (() => {
          if (!can('carriers.approve')) return null;
          const hostR = el('div', { style: 'margin-top:12px;border-top:1px solid #eef2f7;padding-top:10px' });
          const drawR = async () => {
            mount(hostR, el('div', { class: 'cc-sub' }, 'Loading health requests\u2026'));
            let rr = []; try { rr = await carrierReinstatements(orgId) || []; } catch (e9) { mount(hostR, el('div', { class: 'cc-sub' }, humanizeError(e9))); return; }
            let dd = []; try { dd = await carrierPoaDemands(orgId) || []; } catch (_) {}
            const ref9 = (id8) => 'REQ-' + String(id8).replace(/-/g, '').slice(0, 8).toUpperCase();
            const openN = rr.filter((x) => x.status === 'submitted' || x.status === 'in_review').length;
            const q9 = el('input', { class: 'cc-input', placeholder: '\ud83d\udd0d Search by REQ-number or text\u2026', value: hostR.dataset.q || '', style: 'margin:6px 0' });
            q9.oninput = () => { hostR.dataset.q = q9.value; renderList9(); };
            const listHost9 = el('div');
            const bubble9 = (e8) => el('div', { style: 'display:flex;justify-content:' + (e8.who === 'carrier' ? 'flex-end' : 'flex-start') + ';margin:5px 0' },
              el('div', { style: 'max-width:90%;background:' + (e8.who === 'carrier' ? '#eff6ff' : '#fffbeb') + ';border:1px solid #e8edf3;border-radius:10px;padding:8px 11px' }, [
                el('div', { style: 'display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap' }, [
                  el('span', { style: 'font-weight:800;font-size:.72rem;color:' + (e8.who === 'carrier' ? '#1d4ed8' : '#b45309') }, e8.label),
                  el('span', { class: 'cc-sub', style: 'font-size:.7rem' }, e8.at ? fmtDateTime(e8.at) : ''),
                ]),
                el('div', { style: 'font-size:.83rem;color:#334155;white-space:pre-wrap;margin-top:3px' }, e8.text || ''),
                (Array.isArray(e8.att) && e8.att.length) ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, '\ud83d\udcce ' + e8.att.map((a8) => a8.file_name).join(' \u00b7 ')) : null,
              ].filter(Boolean)));
            const renderList9 = () => {
              const needle = (hostR.dataset.q || '').trim().toLowerCase();
              const match9 = (r8) => !needle || ref9(r8.id).toLowerCase().indexOf(needle) >= 0 || String(r8.message || '').toLowerCase().indexOf(needle) >= 0 || String(r8.staff_note || '').toLowerCase().indexOf(needle) >= 0;
              const blocks = ['health_poa', 'reinstate'].map((k8) => {
                const items = rr.filter((r8) => r8.kind === k8 && match9(r8));
                if (!items.length) return null;
                const openReq = items.find((r8) => r8.status === 'submitted' || r8.status === 'in_review');
                const latest = items[0];
                const evs = [];
                if (k8 === 'health_poa') dd.forEach((d8) => evs.push({ who: 'staff', label: '\ud83d\udccb Demand \u2014 ' + (d8.factor || 'account'), text: d8.note, at: d8.at }));
                items.forEach((r8) => {
                  evs.push({ who: 'carrier', label: '\ud83d\udce4 Answer \u00b7 ' + ref9(r8.id), text: r8.message, at: r8.created_at, att: r8.attachments });
                  if (r8.decided_at && ['approved', 'rejected', 'more_info'].indexOf(r8.status) >= 0)
                    evs.push({ who: 'staff', label: (r8.status === 'approved' ? '\u2713 Accepted' : r8.status === 'rejected' ? '\u2715 Declined' : '\u21a9 More info requested') + ' \u00b7 ' + ref9(r8.id), text: r8.staff_note || '', at: r8.decided_at });
                });
                evs.sort((a8, b8) => new Date(a8.at) - new Date(b8.at));
                const conv = el('div', { style: 'display:none;margin-top:8px;border-top:1px dashed #e2e8f0;padding-top:6px' }, evs.map(bubble9));
                const tog = el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => { const on = conv.style.display !== 'none'; conv.style.display = on ? 'none' : 'block'; tog.textContent = on ? '\ud83d\udcac See conversation (' + evs.length + ')' : '\u25b4 Show less'; } }, '\ud83d\udcac See conversation (' + evs.length + ')');
                const stc = latest.status === 'approved' ? ['#e7f9ee', '#12a150', '\u2713 Accepted'] : latest.status === 'rejected' ? ['#fee2e2', '#b91c1c', '\u2715 Declined'] : latest.status === 'in_review' ? ['#dbeafe', '#1d4ed8', '\u23f3 In review'] : latest.status === 'more_info' ? ['#fef3c7', '#b45309', '\u21a9 Awaiting more info'] : ['#fef3c7', '#b45309', '\u2022 New answer'];
                const actRow = openReq ? el('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, [
                  openReq.status !== 'in_review' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev9) => { const _b_ = ev9.currentTarget; _b_.disabled = true; try { await reviewReinstatement(openReq.id, 'in_review', null); drawR(); } catch (e9) { _b_.disabled = false; alert(humanizeError(e9)); } } }, '\u23f3 In review') : null,
                  el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev9) => { const _b_ = ev9.currentTarget;
                    if (!confirm(openReq.kind === 'health_poa' ? 'Accept this plan of action? Carrier is notified.' : 'Approve \u2014 reinstates the carrier immediately. Continue?')) return;
                    _b_.disabled = true; try { await reviewReinstatement(openReq.id, 'approve', null); drawR(); } catch (e9) { _b_.disabled = false; alert(humanizeError(e9)); }
                  } }, openReq.kind === 'health_poa' ? '\u2713 Accept' : '\u2713 Approve & reinstate'),
                  el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => openMoreInfo9(openReq) }, '\u21a9 Need more info'),
                  el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: () => {
                    const teamD = mkTeam(openReq.kind === 'health_poa' ? 'Health team' : 'Reinstatement team');
                    const catD = el('select', { class: 'cc-input' }, ['Insufficient explanation \u2014 root cause still unclear', 'Requirements not met \u2014 demanded items missing', 'Evidence invalid or does not match', 'Suspected false statement / fraud indicators', 'Repeated failure to respond properly', 'Other (describe below)'].map((x8) => el('option', { value: x8 }, x8)));
                    const msgD = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Written note (required) \u2014 carrier reads these exact words in-app + email.' });
                    const rstD = mkRestrict();
                    const drD = openDrawer('\u2715 Decline \u2014 ' + ref9(openReq.id), [
                      el('div', { class: 'cc-sub' }, 'Their answer: \u201c' + String(openReq.message || '').slice(0, 160) + '\u2026\u201d'),
                      openReq.kind === 'reinstate' ? el('div', { style: 'background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:9px 12px;font-size:.82rem;color:#7f1d1d;margin-top:8px' }, '\u26d4 Declining a reinstatement keeps the account PAUSED \u2014 they must fix the issue and submit a fresh request.') : null,
                      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Send as (team)'), teamD,
                      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason category'), catD,
                      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Written note (required)'), msgD,
                      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Account effect along with this decline'), rstD.sel,
                      el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                        el('button', { class: 'lb-btn lb-btn-primary', style: 'background:#b91c1c;border-color:#b91c1c', onClick: async (ev8) => { const _b8 = ev8.currentTarget;
                          if (!msgD.value.trim()) { alert('A written note is required \u2014 the carrier must know why.'); return; }
                          if (rstD.sel.value !== 'none' && !confirm(rstD.sel.value === 'all' ? 'Freeze the ENTIRE account along with this decline?' : 'Pause booking along with this decline?')) return;
                          const ntD = ['RE: ' + ref9(openReq.id), 'FROM: ' + teamD.value.toUpperCase(), 'REASON: ' + catD.value, 'NOTE FROM ' + teamD.value.toUpperCase() + ': ' + msgD.value.trim()].join('\n');
                          _b8.disabled = true; _b8.textContent = 'Declining\u2026';
                          try {
                            await reviewReinstatement(openReq.id, 'reject', ntD);
                            const exD = await rstD.apply('Declined ' + ref9(openReq.id) + ' \u2014 ' + catD.value + ': ' + msgD.value.trim());
                            drD.close(); drawR(); if (exD) alert('Declined' + exD + '.');
                          } catch (e8) { _b8.disabled = false; _b8.textContent = 'Decline request'; alert(humanizeError(e8)); }
                        } }, 'Decline request'),
                        el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => drD.close() }, 'Cancel'),
                      ]),
                    ].filter(Boolean));
                  } }, '\u2715 Decline'),
                ].filter(Boolean)) : null;
                const openDefault = !!openReq && openReq.status === 'submitted';
                const bodyW = el('div', { style: 'display:' + (openDefault ? 'block' : 'none') }, [
                  el('div', { style: 'font-size:.83rem;color:#334155;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, latest.message || ''),
                  (Array.isArray(latest.attachments) && latest.attachments.length)
                    ? el('div', { class: 'cc-sub', style: 'margin-top:4px' }, '\ud83d\udcce ' + latest.attachments.map((a8) => (a8.file_name || '') + ' (' + (a8.type || '') + ')').join(' \u00b7 ') + ' \u2014 preview/decide in the documents list above')
                    : el('div', { class: 'cc-sub', style: 'margin-top:4px;color:#b45309' }, '\u26a0 No document attached to this answer'),
                  el('div', { style: 'margin-top:6px' }, tog),
                  actRow, conv,
                ].filter(Boolean));
                const caretT = el('span', { style: 'color:#0883F7;font-weight:700;font-size:.82rem;margin-left:auto' }, openDefault ? '\u25b4 Close' : '\u25be Open');
                return el('div', { style: 'border:1px solid #e8edf3;border-radius:12px;padding:10px 12px;margin-bottom:8px' }, [
                  el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;cursor:pointer', onClick: () => { const on = bodyW.style.display !== 'none'; bodyW.style.display = on ? 'none' : 'block'; caretT.textContent = on ? '\u25be Open' : '\u25b4 Close'; } }, [
                    el('b', { style: 'font-size:.85rem' }, k8 === 'health_poa' ? '\ud83d\udccb Plan of action thread' : '\u25b6 Reinstatement thread'),
                    el('span', { class: 'cc-pill', style: 'background:#f1f5f9;color:#475569;font-family:monospace' }, ref9(latest.id)),
                    el('span', { class: 'cc-pill', style: 'background:' + stc[0] + ';color:' + stc[1] }, stc[2]),
                    el('span', { class: 'cc-sub' }, fmtDateTime(latest.created_at)),
                    caretT,
                  ]),
                  bodyW,
                ].filter(Boolean));
              }).filter(Boolean);
              mount(listHost9, blocks.length ? el('div', null, blocks) : el('div', { class: 'cc-sub' }, needle ? 'No request matches \u201c' + needle + '\u201d.' : 'None yet \u2014 use \u201cDemand plan of action\u201d on any factor above.'));
            };
            const openMoreInfo9 = (r9) => {
              const chkM = (lab, on) => { const c8 = el('input', { type: 'checkbox', checked: on ? 'checked' : undefined }); c8.dataset.val = lab; return el('label', { style: 'display:flex;gap:8px;align-items:flex-start;padding:4px 0;font-size:.85rem;cursor:pointer' }, [c8, el('span', null, lab)]); };
              const missBox = el('div', null, ['Answer is incomplete \u2014 root cause not explained', 'Prevention plan is missing or too vague', 'No dates / timeline committed', 'Required document is missing', 'Document is wrong / unreadable / wrong format', 'Evidence does not match the trip in question'].map((x8) => chkM(x8, false)));
              const qM = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'One question per line \u2014 exactly what must they answer this time.' });
              const docM = el('input', { class: 'cc-input', placeholder: 'Specific document(s) to attach this time (optional)' });
              const dlM = el('select', { class: 'cc-input' }, [['24 hours', '24 hours'], ['48 hours', '48 hours'], ['3 days', '3 days'], ['7 days', '7 days']].map(([v8, l8]) => el('option', { value: v8 }, l8)));
              const msgM = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Custom message (optional) \u2014 sent word-for-word.' });
              const teamM = mkTeam(r9.kind === 'health_poa' ? 'Health team' : 'Reinstatement team');
              const drM = openDrawer('\u21a9 Need more info \u2014 ' + ref9(r9.id), [
                el('div', { class: 'cc-sub' }, 'Their answer: \u201c' + String(r9.message || '').slice(0, 160) + '\u2026\u201d'),
                el('div', { style: 'background:#e7f9ee;border:1px solid #bbf7d0;border-radius:10px;padding:9px 12px;font-size:.82rem;color:#166534;margin-top:8px' }, '\u2713 No points deducted \u2014 the request goes back to the carrier and they can submit again. Previous answer stays on record.'),
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Send as (team)'), teamM,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'What is missing'), missBox,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Specific questions to answer this time'), qM,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Documents to attach this time'), docM,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Deadline'), dlM,
                el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Custom message'), msgM,
                el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
                  el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev8) => { const _b8 = ev8.currentTarget;
                    const miss = Array.from(missBox.querySelectorAll('input:checked')).map((c8) => c8.dataset.val);
                    const qs8 = qM.value.split('\n').map((x8) => x8.trim()).filter(Boolean);
                    if (!miss.length && !qs8.length && !docM.value.trim() && !msgM.value.trim()) { alert('Select what is missing, ask a question, or write a message.'); return; }
                    const nt8 = [
                      'RE: ' + ref9(r9.id),
                      'FROM: ' + teamM.value.toUpperCase(),
                      miss.length ? 'STILL MISSING: ' + miss.join(' \u00b7 ') : null,
                      qs8.length ? 'ANSWER THESE: ' + qs8.map((x8, i8) => (i8 + 1) + ') ' + x8).join('  ') : null,
                      docM.value.trim() ? 'ATTACH THIS TIME: ' + docM.value.trim() : null,
                      'DEADLINE: respond within ' + dlM.value,
                      msgM.value.trim() ? 'NOTE FROM ' + teamM.value.toUpperCase() + ': ' + msgM.value.trim() : null,
                    ].filter(Boolean).join('\n');
                    _b8.disabled = true; _b8.textContent = 'Sending\u2026';
                    try { await reviewReinstatement(r9.id, 'more_info', nt8); drM.close(); drawR(); } catch (e8) { _b8.disabled = false; _b8.textContent = 'Send back for more info'; alert(humanizeError(e8)); }
                  } }, 'Send back for more info'),
                  el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => drM.close() }, 'Cancel'),
                ]),
              ]);
            };
            mount(hostR, el('div', null, [
              el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin-bottom:4px' }, 'Health requests \u2014 plans of action & reinstatement' + (openN ? ' (' + openN + ' open)' : '')),
              q9,
              (() => {
                const dHost = el('div', { style: 'margin-bottom:8px' });
                if (dd.length) mount(dHost, el('div', null, [
                  el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:3px' }, 'Demands you sent (' + dd.length + ')'),
                  ...dd.slice(0, 6).map((d9) => el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:.8rem;padding:3px 0;cursor:pointer', title: 'Open demand detail', onClick: () => {
                    openDrawer('\ud83d\udccb Demand \u2014 ' + (d9.factor || 'account'), [
                      el('div', { class: 'cc-sub' }, 'Sent ' + fmtDateTime(d9.at) + ' \u00b7 in-app + branded email \u00b7 audit-logged'),
                      el('div', { style: 'margin-top:10px' }, d9.answered ? el('span', { class: 'cc-pill', style: 'background:#e7f9ee;color:#12a150' }, '\u2713 Answered \u2014 the reply is in the thread below') : el('span', { class: 'cc-pill', style: 'background:#fef3c7;color:#b45309' }, '\u23f3 Awaiting answer \u2014 account flagged on the carrier\u2019s dashboard')),
                      el('div', { style: 'font-weight:800;font-size:.83rem;margin-top:12px' }, 'Exactly what you demanded:'),
                      el('div', { style: 'background:#f8fafc;border:1px solid #e8edf3;border-radius:10px;padding:10px 12px;font-size:.85rem;white-space:pre-wrap;margin-top:6px' }, d9.note || '(no structured note)'),
                    ]);
                  } }, [
                    el('span', null, '\ud83d\udccb ' + (d9.factor || 'account') + ' \u00b7 ' + fmtDateTime(d9.at)),
                    d9.answered ? el('span', { class: 'cc-pill', style: 'background:#e7f9ee;color:#12a150' }, '\u2713 Answered') : el('span', { class: 'cc-pill', style: 'background:#fef3c7;color:#b45309' }, '\u23f3 Awaiting answer'),
                    el('span', { style: 'color:#0883F7;font-weight:700' }, 'View \u203a'),
                  ])),
                ]));
                return dHost;
              })(),
              listHost9,
            ]));
            renderList9();
          };
          drawR();
          return hostR;
        })(),
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', style: 'margin-top:8px;width:100%', onClick: () => {
          const LADDER = [
            ['90\u2013100', 'HEALTHY', '#16a34a', 'No action. First pick of premium loads. Consider a \u201cgreat standing\u201d note on milestones.'],
            ['70\u201389', 'AT RISK', '#f59e0b', 'Send improvement tips (below). Watch the weakest group. No booking impact yet \u2014 coach, don\u2019t punish.'],
            ['40\u201369', 'CRITICAL', '#dc2626', 'BOOKING PAUSED automatically by the prebook gate. Call the carrier, agree corrective steps, log a note. Reinstatement = fix the deductions (documents clear instantly; performance heals over the 180-day window).'],
            ['< 40 / repeat offenses', 'ENFORCEMENT', '#7f1d1d', 'Account-level warning (points), require a written plan of action before any load. Fraud/GPS-spoofing evidence \u2192 reject onboarding / offboard \u2014 decision logged in the timeline.'],
          ];
          const TIPS = [
            'Tracking below 90%? \u2192 tell the carrier to run every trip from the Live map \u2014 auto check-ins fix this group by themselves.',
            'On-time slipping? \u2192 remind them late-risk loads can be declined; an accepted load is a promise.',
            'Document deductions? \u2192 clear the moment a valid document is uploaded \u2014 send them straight to the Documents page.',
            'Warnings/violations? \u2192 auto-expire (90/180/365d) if not repeated \u2014 tell them exactly what not to repeat.',
            'Fees overdue? \u2192 clears on payment; offer the settlement PDF from their trip card.',
          ];
          const gRows = (ah.groups || []).map(g => el('div', { style: 'border:1px solid #e8edf3;border-radius:10px;padding:9px 12px;margin-bottom:8px' }, [
            el('div', { style: 'display:flex;justify-content:space-between;font-weight:800;font-size:.86rem' }, [el('span', null, g.label), el('span', null, g.earned + '/' + g.weight)]),
            el('div', null, (g.items || []).map(it => el('div', { style: 'font-size:.8rem;color:#334155;padding:2px 0' },
              (Number(it.deducted) > 0 ? '\u2212' + it.deducted + ' \u00b7 ' : '\u2713 ') + (it.label || '') + ': ' + String(it.value ?? '\u2014') + ' (target ' + (it.target || '\u2014') + ')'))),
          ]));
          openDrawer('Health policy — how to act on ' + String(ah.score), [
            el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, ah.basis || ''),
            el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin:6px 0' }, 'Score ladder \u2014 what staff does at each band'),
            el('div', null, LADDER.map(([band, name2, c2, act]) => el('div', { style: 'display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #eef2f7' }, [
              el('span', { style: 'flex:none;min-width:120px;font-weight:800;color:' + c2 }, band + ' ' + name2),
              el('span', { style: 'font-size:.83rem;color:#334155' }, act)]))),
            el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin:12px 0 6px' }, 'Full metric detail (what the carrier sees)'),
            el('div', null, gRows),
            el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin:12px 0 6px' }, 'Improvement tips \u2014 copy into a message/warning'),
            el('div', null, TIPS.map(t2 => el('div', { style: 'font-size:.83rem;color:#334155;padding:3px 0' }, '\u2022 ' + t2))),
          ]);
        } }, '\ud83d\udcd6 Open health policy \u2014 score ladder, metric detail, tips'),
      ]));
    })();

    // ---- THIS CARRIER'S PAY CLAIMS — decide right here ----
    async function printClaimReport(claimId) {
      let b = null; try { b = await claimBundle(claimId); } catch (e) { alert(humanizeError(e)); return; }
      const c = (b && b.claim) || {}; const t = (b && b.trip) || {}; const dw = (b && b.gps_dwell) || []; const cxl = (b && b.cancellation_trail) || [];
      const esc9 = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const rowsH = dw.map((e9) => '<tr><td>' + esc9(e9.stop) + '</td><td>' + (e9.arrived_at ? new Date(e9.arrived_at).toLocaleString() : '\u2014') + '</td><td>' + (e9.departed_at ? new Date(e9.departed_at).toLocaleString() : '\u2014') + '</td><td>' + (e9.held_minutes != null ? e9.held_minutes + ' min' : '\u2014') + '</td><td>' + (e9.free_minutes || 0) + ' min</td><td><b>' + (e9.detention_minutes != null ? e9.detention_minutes + ' min' : '\u2014') + '</b></td><td>' + (e9.gps ? esc9(Number(e9.gps.lat).toFixed(5)) + ', ' + esc9(Number(e9.gps.lng).toFixed(5)) + ' (' + Math.round(e9.gps.distance_m || 0) + ' m from stop) \u2014 <a href="' + (e9.stop_gps ? 'https://www.google.com/maps/dir/?api=1&origin=' + e9.gps.lat + ',' + e9.gps.lng + '&destination=' + e9.stop_gps.lat + ',' + e9.stop_gps.lng + '&travelmode=walking' : 'https://maps.google.com/?q=' + e9.gps.lat + ',' + e9.gps.lng) + '">verify: truck vs facility on map</a>' : 'no GPS') + '</td></tr>').join('');
      const cxlH = cxl.length ? '<h3>Cancellation trail (system record)</h3>' + cxl.map((x9) => '<div class="ln">' + new Date(x9.at).toLocaleString() + ' \u2014 ' + esc9(x9.what) + '</div>').join('') : '';
      const w9 = window.open('', '_blank'); if (!w9) { alert('Allow popups to download the report.'); return; }
      w9.document.write('<html><head><title>' + esc9(c.ref) + ' \u2014 Evidence report</title><style>'
        + 'body{font-family:Segoe UI,Arial,sans-serif;color:#0f172a;margin:34px;font-size:13px}h1{font-size:20px;margin:0}h3{margin:18px 0 6px;font-size:14px}'
        + '.hd{display:flex;justify-content:space-between;border-bottom:3px solid #FC5305;padding-bottom:10px;margin-bottom:14px}.muted{color:#64748b}'
        + 'table{border-collapse:collapse;width:100%;margin-top:6px}td,th{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}th{background:#f1f5f9}'
        + '.ln{padding:3px 0}.box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-top:8px}'
        + '.att{margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;font-size:11.5px}'
        + '</style></head><body>'
        + '<div class="hd"><div><h1>LoadBoot \u2014 Claim Evidence Report</h1><div class="muted">' + esc9(c.ref) + ' \u00b7 generated ' + new Date().toLocaleString() + '</div></div><div style="font-weight:800;font-size:16px">' + esc9(String(c.kind || '').toUpperCase()) + (c.amount > 0 ? ' \u00b7 $' + esc9(c.amount) : '') + '</div></div>'
        + '<div class="box"><b>Trip:</b> ' + esc9(t.origin) + ' \u2192 ' + esc9(t.destination) + ' \u00b7 rate $' + esc9(t.rate) + ' \u00b7 ' + esc9(t.pickup_mode || 'appointment') + '<br><b>Carrier:</b> ' + esc9(t.carrier) + ' \u00b7 <b>Broker:</b> ' + esc9(t.broker || '\u2014') + '<br><b>Filed:</b> ' + (c.filed_at ? new Date(c.filed_at).toLocaleString() : '\u2014') + (c.note ? ' \u00b7 <b>Carrier statement:</b> \u201c' + esc9(c.note) + '\u201d' : '') + '</div>'
        + '<h3>GPS + time evidence (recorded automatically on scene)</h3>'
        + '<table><tr><th>Stop</th><th>Arrived</th><th>Departed</th><th>Held</th><th>Free time</th><th>Detention</th><th>GPS fix (click to verify)</th></tr>' + (rowsH || '<tr><td colspan="7">No dwell events recorded.</td></tr>') + '</table>'
        + '<h3>What happened, minute by minute</h3>' + (((b && b.timeline) || []).map((tl9) => '<div class="ln"><b>' + (tl9.at ? new Date(tl9.at).toLocaleString() : '') + '</b> \u2014 ' + esc9(tl9.what) + '</div>').join('') || '<div class="ln">No timeline events.</div>')
        + (((b && b.stop_documents) || []).length ? '<h3>Paper proof collected at the stops</h3>' + b.stop_documents.map((d9) => '<div class="ln">' + esc9(({ bol_signed: 'Facility-SIGNED BOL', pod_signed: 'Facility-SIGNED POD', lumper_receipt: 'Lumper receipt', gate_ticket: 'Gate ticket', stop_photo: 'Stop photo', pod: 'POD' })[d9.kind] || d9.kind) + ' \u2014 ' + esc9(d9.file_name) + ' \u00b7 uploaded ' + (d9.uploaded_at ? new Date(d9.uploaded_at).toLocaleString() : '') + '</div>').join('') : '')
        + cxlH
        + '<h3>Decision trail</h3><div class="ln">Broker: <b>' + esc9(c.broker_status) + '</b>' + (c.broker_note ? ' \u2014 \u201c' + esc9(c.broker_note) + '\u201d' : '') + (c.broker_decided_at ? ' (' + new Date(c.broker_decided_at).toLocaleString() + ')' : '') + '</div>'
        + '<div class="ln">LoadBoot support: <b>' + esc9(c.support_status === 'decided' ? 'ruled for the ' + c.support_verdict : c.support_status) + '</b>' + (c.support_note ? ' \u2014 \u201c' + esc9(c.support_note) + '\u201d' : '') + '</div>'
        + '<div class="att"><b>Statement of method:</b> every timestamp and GPS fix above was captured automatically by the LoadBoot platform at the moment of the event (geofenced arrive/depart, 800&nbsp;m radius) and is stored server-side. Neither the carrier nor the broker can create or edit these records. Coordinates can be independently verified via the map links.</div>'
        + '<scr' + 'ipt>window.print();</scr' + 'ipt></body></html>');
      w9.document.close();
    }
    function openClaimReview(r, after9) {
          const RATE = { detention: '$60/hr after free time', layover: '$250/day', tonu: '$250 flat', lumper: 'receipt amount', other: 'case by case' };
          const suggest = () => {
            const ev2 = r.evidence || {};
            if (r.kind === 'detention') { const m2 = Number(ev2.detention_minutes) || (ev2.dwell && ev2.dwell[0] && Math.max((ev2.dwell[0].dwell_minutes || 0) - (ev2.dwell[0].free_minutes || 120), 0)) || 0; return Math.round(m2 * 1); }
            if (r.kind === 'layover') return 250;
            if (r.kind === 'tonu') return 250;
            return '';
          };
      // opens the full evidence+decision drawer for one claim; after9 runs post-decision
      const _openBody = (r, after9) => {
            const ev2 = r.evidence || {};
            const amtIn = el('input', { class: 'cc-input', type: 'number', value: String(suggest()) });
            const noteIn = el('input', { class: 'cc-input', placeholder: 'Decision note (required on reject; carrier sees it)' });
            const mkDwellRow = (d3) => el('div', { style: 'border:1px solid #e8edf3;border-radius:10px;padding:8px 11px;margin-bottom:6px;font-size:.82rem;color:#334155' }, [
              el('b', null, (d3.stop || '') + ' — '), 'in ' + (d3.arrived_at ? fmtDateTime(d3.arrived_at) : '—') + (d3.departed_at ? ' → out ' + fmtDateTime(d3.departed_at) : ' (still there)')
              + ((d3.dwell_minutes ?? d3.held_minutes) != null ? ' · ' + (d3.dwell_minutes ?? d3.held_minutes) + ' min on site' : '') + ' · free ' + (d3.free_minutes ?? 120) + ' min'
              + (d3.detention_minutes != null ? ' · detention ' + d3.detention_minutes + ' min' : '')
              + (d3.gps ? ' · GPS ✓ ' + (d3.gps.distance_m != null ? Math.round(d3.gps.distance_m) + ' m from stop' : '') : ' · no GPS'),
              d3.gps ? el('a', { href: (d3.stop_gps ? 'https://www.google.com/maps/dir/' + d3.gps.lat + ',' + d3.gps.lng + '/' + d3.stop_gps.lat + ',' + d3.stop_gps.lng : 'https://maps.google.com/?q=' + d3.gps.lat + ',' + d3.gps.lng), target: '_blank', rel: 'noopener', style: 'margin-left:6px;color:#0883F7;font-weight:700', title: d3.stop_gps ? 'Opens BOTH pins — truck fix and the facility; the gap between them is the proof' : 'Truck fix only (facility pin not on file)' }, d3.stop_gps ? 'verify: truck vs facility ↗' : 'verify on map ↗') : null,
            ].filter(Boolean));
            const dwellHost = el('div', null, (Array.isArray(ev2.dwell) ? ev2.dwell : []).map(mkDwellRow));
            (async () => { try {
              const b3 = await claimBundle(r.id);
              const live = (b3 && b3.gps_dwell) || [];
              if (live.length) mount(dwellHost, el('div', null, live.map(mkDwellRow)));
            } catch (_) {} })();
            const dwellRows = [dwellHost];
            const histHost = el('div', { class: 'cc-sub' }, 'Checking this trip\u2019s claim history\u2026');
            (async () => { try {
              const all2 = await tripAccessorials(r.trip) || [];
              const ap2 = all2.filter(z => z.status === 'approved').length, rj2 = all2.filter(z => z.status === 'rejected').length, rq2 = all2.filter(z => z.status === 'requested').length;
              histHost.textContent = 'This trip: ' + ap2 + ' approved \u00b7 ' + rj2 + ' rejected \u00b7 ' + rq2 + ' pending' + (all2.length > 3 ? ' \u2014 \u26a0 many claims on one trip, look closer' : '');
              histHost.style.color = all2.length > 3 ? '#b45309' : '';
            } catch (_) { histHost.textContent = ''; } })();
            const RECO = {
              detention: 'Approve at standard IF arrive+depart are GPS-verified and minutes exceed free time. Reject if there is no depart stamp or GPS is missing.',
              layover: 'Approve IF overnight dwell inside the geofence is continuous. Reject if the truck left and returned.',
              tonu: 'Approve IF the truck was GPS-verified at/near pickup when cancelled. Reject if cancellation predates dispatch.',
              lumper: 'Approve against the RECEIPT amount only. Reject without a legible receipt.',
              other: 'Judge on evidence; when unsure, ask the carrier for proof before deciding.',
            };
            const dr3 = openDrawer('Claim \u2014 ' + (r.kind || '').toUpperCase() + ' \u00b7 ' + (r.origin || '') + ' \u2192 ' + (r.destination || ''), [
              el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, [
                r.broker_status === 'approved' ? el('span', { class: 'cc-pill', style: 'background:#e7f9ee;color:#12a150' }, '\u2713 Broker approved') : r.broker_status === 'disputed' ? el('span', { class: 'cc-pill', style: 'background:#fee2e2;color:#b91c1c', title: r.broker_note || '' }, '\u2715 Broker disputed' + (r.broker_note ? ' \u2014 ' + String(r.broker_note).slice(0, 50) : '')) : el('span', { class: 'cc-pill', style: 'background:#f1f5f9;color:#475569' }, '\u23f3 Broker reviewing'),
                el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => printClaimReport(r.id) }, '\u2b07 Download evidence report'),
              ]),
              el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, '\ud83d\udce4 The broker was pushed this claim the moment it was filed \u2014 notification + the same GPS/policy evidence in their portal. GPS fixes are server-recorded and map-verifiable.'),
              el('div', { style: 'display:flex;justify-content:space-between;gap:8px;font-size:.78rem;color:#64748b;margin-bottom:6px' }, [el('span', null, 'Trip ' + String(r.trip || '').slice(0, 8) + '\u2026'), histHost]),
              el('div', { style: 'background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 12px;font-size:.82rem;color:#166534;margin-bottom:8px' }, '\u2696 Recommended: ' + (RECO[r.kind] || RECO.other)),
              el('div', { style: 'background:#eef6ff;border:1px solid #bfdbfe;border-radius:10px;padding:8px 12px;font-size:.82rem;color:#1e40af;margin-bottom:8px' }, '\ud83d\udccb Platform standard: ' + (RATE[r.kind] || RATE.other) + ' \u00b7 filed ' + fmtDateTime(r.created_at)),
              r.note ? el('div', { style: 'font-size:.85rem;color:#334155;margin-bottom:8px' }, '\ud83d\udcac ' + r.note) : null,
              el('div', { style: 'font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:800;margin:6px 0 4px' }, 'GPS + time evidence'),
              dwellRows.length ? el('div', null, dwellRows) : el('div', { class: 'cc-sub' }, 'No dwell stamps in this claim\u2019s snapshot.'),
              ev2.receipt_ref ? el('div', { style: 'font-size:.82rem;color:#334155;margin-top:4px' }, '\ud83e\uddfe Receipt attached: ' + ev2.receipt_ref) : null,
              ev2.cancelled_from ? el('div', { style: 'font-size:.82rem;color:#334155;margin-top:4px' }, '\u26a0 Load cancelled from status: ' + ev2.cancelled_from) : null,
              el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:10px;display:block' }, 'Amount (USD) \u2014 suggested from evidence'), amtIn,
              el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:8px;display:block' }, 'Decision note'), noteIn,
              el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [
                el('button', { class: 'lb-btn lb-btn-primary', onClick: async (e3) => { const n3 = Number(amtIn.value); if (!(n3 >= 0)) { alert('Enter a valid amount.'); return; } e3.currentTarget.disabled = true;
                  try { const _ct1058 = e3.currentTarget; await reviewAccessorial(r.id, 'approve', n3, noteIn.value.trim() || null); dr3.close(); (after9 || function () {})(); } catch (e4) { alert(humanizeError(e4)); _ct1058.disabled = false; } } }, '\u2713 Approve $' ),
                el('button', { class: 'lb-btn lb-btn-ghost', onClick: async (e3) => { if (!noteIn.value.trim()) { alert('Rejection needs a written reason \u2014 the carrier sees it.'); return; } e3.currentTarget.disabled = true;
                  try { const _ct1060 = e3.currentTarget; await reviewAccessorial(r.id, 'reject', null, noteIn.value.trim()); dr3.close(); (after9 || function () {})(); } catch (e4) { alert(humanizeError(e4)); _ct1060.disabled = false; } } }, '\u2715 Reject'),
              ]),
            ].filter(Boolean));
          };
      _openBody(r, after9);
    }
    const claimsCard = card([el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\ud83d\udcb0 Pay claims \u2014 this carrier')]), el('div', { class: 'cc-sub' }, 'Loading\u2026')]);
    async function loadC3Claims() {
      let rows = []; try { rows = (await accessorialQueue(200) || []).filter(r => r.carrier_id === orgId); } catch (_) { rows = []; }
      mount(claimsCard, el('div', null, [
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\ud83d\udcb0 Pay claims \u2014 this carrier'), el('span', { class: 'cc-pill cc-pill-' + (rows.length ? 'amber' : 'green') }, rows.length + ' awaiting')]),
        rows.length ? el('div', null, rows.map(r => {
          const openClaim = () => openClaimReview(r, loadC3Claims);
          return el('div', { style: 'display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-top:1px solid #eef2f7;flex-wrap:wrap' }, [
            el('div', { style: 'min-width:200px;flex:1;cursor:pointer', title: 'Open claim \u2014 evidence + decision', onClick: openClaim }, [
              el('div', { style: 'font-weight:800;font-size:.88rem' }, (r.kind || '').toUpperCase() + ' \u2014 ' + (r.origin || '') + ' \u2192 ' + (r.destination || '') + ' \u203a'),
              el('div', { class: 'cc-sub', style: 'font-size:.8rem' }, r.note || ''),
            ]),
            can('dispatch.manage') ? el('button', { class: 'lb-btn lb-btn-sm', onClick: openClaim }, 'Review') : null,
          ]);
        })) : el('div', { class: 'cc-sub' }, 'No claims waiting from this carrier.'),
      ]));
    }
    void claimsCard; void loadC3Claims; // merged into Recent trips (claims live with their trip)

    const backCard = card([el('h4', { class: 'cc-card-title' }, '\u{1F9FE} Back office')]);
    (async () => {
      let bo; try { bo = await ccCarrierBackoffice(orgId); } catch (e) { mount(backCard, el('div', null, [el('h4', { class: 'cc-card-title' }, '\u{1F9FE} Back office'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, humanizeError(e))])); return; }
      const pr = bo.payroll || {}; const ifta = bo.ifta || {}; const cm = bo.cost_model || {}; const qb = bo.qbo || {}; const svc = bo.fleet_service || []; const ex = bo.expenses || {};
      const secT = (t) => el('div', { style: 'font-size:.68rem;font-weight:800;letter-spacing:.09em;color:#64748b;text-transform:uppercase;margin:12px 0 4px' }, t);
      mount(backCard, el('div', null, [
        el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, '\u{1F9FE} Back office — payroll · IFTA · cost model · service log · QuickBooks'), el('span', { class: 'cc-sub' }, 'read-only — the carrier’s own self-serve books')]),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
          el('span', { class: 'cc-pill cc-pill-' + (qb.connected ? 'green' : 'gray') }, qb.connected ? ('QuickBooks ✓ ' + (qb.company || '') + ' · ' + (qb.synced || 0) + ' synced · ' + (qb.paid_in_qbo || 0) + ' paid') : 'QuickBooks not connected'),
          el('span', { class: 'cc-pill cc-pill-blue' }, 'Expenses 90d: ' + money(ex.total_90d || 0) + ' (' + (ex.count_90d || 0) + ')'),
          cm.cost_per_mile != null ? el('span', { class: 'cc-pill cc-pill-blue' }, 'Cost/mi $' + cm.cost_per_mile) : null,
          cm.truck_mpg != null ? el('span', { class: 'cc-pill cc-pill-blue' }, cm.truck_mpg + ' MPG · fuel $' + (cm.fuel_price || '—')) : null,
        ].filter(Boolean)),
        secT('Payroll — ' + ((pr.entries || []).length) + ' recent entries'),
        (pr.entries || []).length ? el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap' }, [kv('Total', money(pr.total || 0)), kv('Paid', money(pr.paid || 0)), kv('Unpaid', money(pr.unpaid || 0))]) : el('div', { class: 'cc-sub' }, 'No payroll entries — carrier hasn’t used Finance → Payroll yet.'),
        secT('IFTA — ' + (ifta.quarter || 'current quarter')),
        (ifta.rows || []).length ? el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap' }, [kv('States', String((ifta.rows || []).length)), kv('Total miles', Number(ifta.total_miles || 0).toLocaleString()), kv('Gallons', String(ifta.total_gallons || 0))]) : el('div', { class: 'cc-sub' }, 'No state miles logged this quarter.'),
        secT('Fleet service log — last ' + Math.min(svc.length, 5) + ' of ' + svc.length),
        svc.length ? el('div', null, svc.slice(0, 5).map((r9) => el('div', { style: 'display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:.82rem;flex-wrap:wrap' }, [
          el('span', null, (r9.truck_unit || '—') + ' · ' + String(r9.kind || '').replace(/_/g, ' ') + ' · ' + (r9.service_date || '')),
          r9.due_soon ? el('span', { class: 'cc-pill cc-pill-amber' }, 'due soon') : el('span', { class: 'cc-sub' }, r9.next_due_date ? ('next ' + r9.next_due_date) : ''),
        ]))) : el('div', { class: 'cc-sub' }, 'No service records.'),
      ]));
    })();
    mount(body, el('div', null, [
      head, kpis,
      el('div', { style: 'margin-top:16px' }, prefsCard),
      el('div', { style: 'margin-top:16px' }, compCard),
      el('div', { style: 'margin-top:16px' }, (() => {
        const xc = card([el('h4', { class: 'cc-card-title' }, 'Extra documents \u2014 outside the checklist')]);
        const extras = (d.documents || []).filter((x8) => String(x8.type || '') === 'other' && String(x8.status || '') !== 'superseded');
        const drawX = () => mount(xc, el('div', null, [
          el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Extra documents \u2014 outside the checklist'), el('span', { class: 'cc-sub' }, 'plan-of-action evidence, permits, anything filed as \u201cother\u201d')]),
          !extras.length ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'None on file.') : el('div', null, extras.map((x8) => {
            const st8 = String(x8.status || 'pending');
            return el('div', { style: 'display:flex;gap:9px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #eef2f7;flex-wrap:wrap' }, [
              el('div', { style: 'min-width:0' }, [el('b', { style: 'font-size:.88rem' }, x8.file_name || 'document'), el('div', { class: 'cc-sub' }, 'other \u00b7 ' + fmtDateTime(x8.created_at) + (x8.review_note ? ' \u00b7 ' + x8.review_note : ''))]),
              el('div', { style: 'display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap' }, [
                el('span', { class: 'cc-pill cc-pill-' + (st8 === 'approved' ? 'green' : st8 === 'rejected' ? 'red' : 'amber') }, st8),
                st8 !== 'approved' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev8) => { const _b8 = ev8.currentTarget; _b8.disabled = true;
                  try { await reviewDocument(x8.id, 'approved', null); x8.status = 'approved'; drawX(); } catch (e8) { _b8.disabled = false; alert(humanizeError(e8)); }
                } }, '\u2713 Approve') : null,
                st8 !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async (ev8) => { const _b8 = ev8.currentTarget;
                  const nt8 = await askReason('Reject \u2014 reason (carrier sees this):'); if (!nt8) return; _b8.disabled = true;
                  try { await reviewDocument(x8.id, 'rejected', nt8); x8.status = 'rejected'; x8.review_note = nt8; drawX(); } catch (e8) { _b8.disabled = false; alert(humanizeError(e8)); }
                } }, '\u2715 Reject') : null,
              ].filter(Boolean)),
            ]);
          })),
        ]));
        drawX();
        return xc;
      })()),
      el('div', { style: 'margin-top:16px' }, engineCard),
      el('div', { style: 'margin-top:16px' }, healthCard),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [appCard, fmcsaXCard]),
      el('div', { style: 'margin-top:16px' }, safetyCard),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [driversCard, payoutCard]), // docsCard MERGED into Onboarding & compliance (view/verify/actions per doc live there)
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [tripsCard, scCard]),
      el('div', { style: 'margin-top:16px' }, backCard),
      el('div', { style: 'margin-top:16px' }, timelineCard),
    ]));
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderCarrier360;
