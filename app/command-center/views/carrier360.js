// carrier360.js — Control Tower Wave B: Carrier 360 record page.
// One screen that ties together everything already in the system for a single carrier:
// profile, compliance, safety grade, documents, drivers, trips, finance, and an audit
// timeline — each section linking back into the module it came from. Read-only aggregate
// via cc_carrier_360 (keyed on the carrier organization id), RBAC-gated on carriers.view.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, card, money, fmtDate, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { carrier360, fmcsaVerify, carrierScorecard, carrierPaymentProfile, verifyPaymentProfile } from '../../shared/api.js';
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
      el('div', { class: 'cc-card-head' }, [el('h4', { class: 'cc-card-title' }, 'Account health'), el('span', { class: 'cc-pill cc-pill-' + H.tone }, [el('i', { class: 'cc-pill-dot' }), H.label])]),
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
    ]);
    const scCard = card([el('h4', { class: 'cc-card-title' }, 'Performance scorecard'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Loading\u2026')]);
    (async () => {
      let sc; try { sc = await carrierScorecard(orgId, 90); } catch (_) { mount(scCard, [el('h4', { class: 'cc-card-title' }, 'Performance scorecard'), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'No delivered trips to score yet.')]); return; }
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
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = pp.verified ? 'Revoking…' : 'Verifying…';
        try { await verifyPaymentProfile(orgId, !pp.verified); load(); } catch (e) { ev.currentTarget.disabled = false; alert(humanizeError(e)); }
      } }, pp.verified ? 'Revoke verification' : 'Verify bank details');
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
        kv('Updated', fmtDateTime(pp.updated_at)),
        can('finance.approve') ? el('div', { style: 'margin-top:10px' }, verifyBtn) : el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'Verification requires finance approver role.'),
      ].filter(Boolean));
    })();
    mount(body, el('div', null, [
      head, kpis,
      el('div', { style: 'margin-top:16px' }, healthCard),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [profileCard, safetyCard]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [docsCard, driversCard]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [tripsCard, scCard]),
      el('div', { style: 'margin-top:16px' }, payoutCard),
      el('div', { style: 'margin-top:16px' }, timelineCard),
    ]));
  }
}

function kv(k, v) { return el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v == null || v === '' ? '—' : String(v))]); }

export default renderCarrier360;
