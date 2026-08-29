// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// dispatchers.js — CC DISPATCHERS module: the verified, commission-paid dispatch workforce.
// Pipeline (applied → screening → skills_test → trial → verified → active), carrier
// assignment + per-carrier SOP, RC approval queue, per-load commission + payout.
// Distinct from Referral Partners (agents.js). Staff-gated by the RPCs themselves.
//
// 2026-08-29 audit rework (bl_disp_0300): a cross-dispatcher QUEUE on top (RC approvals with age /
// hours-to-pickup / driver-set, loads moving with last touch, unread threads, commissions to approve
// and pay, trials ending); "Move to trial" asks for the terms first (commission % + 10 working days);
// "Assign" opens the SOP first (numeric floor + note); approve only when the RC is attached, below-floor
// needs a written reason, overlap needs "override"; commissions are PAID through one dialog that records
// what actually left the account (amount, currency, FX, reference). Salary UI removed — pay is per load.
// Deep links: #/dispatchers?booking=<id> and ?assignment=<id> (from staff notifications) open the owner.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { money, fmtDate, fmtDateTime, card, sectionHead, askReason, askConfirm, openDrawer } from '../../shared/ui/components.js';
import { ccDispatchersList, ccDispatcher360, ccDispatcherDecide, ccDispatcherAssign, ccDispatcherSop,
         ccDispatcherUnassign, getCarriersDirectory, ccCarrierPrefs,
         ccDispatcherSetTerms, ccDispatcherBookings, ccDispatcherBookingDecide, ccDispatcherCommissionStatus, ccDispatcherCommissionList,
         ccDispatcherCommissionPay, ccDispatcherQueue, ccDispatcherResendIntro,
         dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead, ccDispatcherKpis } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { signedDocumentUrl } from '../../shared/storage.js';

const PIPE = ['applied', 'screening', 'skills_test', 'trial', 'verified', 'active', 'suspended', 'rejected'];
const STPILL = {
  applied: ['applied', 'violet'], screening: ['screening', 'amber'], skills_test: ['skills test', 'amber'],
  trial: ['trial (commission)', 'amber'], verified: ['verified', 'green'], active: ['ACTIVE', 'green'],
  suspended: ['suspended', 'red'], rejected: ['rejected', 'red'], withdrawn: ['withdrawn', 'violet'],
};
function pill(st) { const m = STPILL[st] || [st, 'violet']; return el('span', { class: 'cc-pill cc-pill-' + m[1] }, m[0]); }
const ET = 'America/New_York';
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const mins = (m) => { m = Number(m || 0); if (m < 60) return m + ' min'; if (m < 48 * 60) return Math.round(m / 60) + ' h'; return Math.round(m / 1440) + ' d'; };
// 10 working days (Mon–Fri) from a date — mirrors app_private.add_working_days, used only to PRE-FILL the terms form
function addWorkingDays(d, n) { const x = new Date(d); let c = 0; while (c < n) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) c++; } return x.toISOString().slice(0, 10); }

export function renderDispatchers(host) {
  const state = { q: '', st: 'all', rows: [], carriers: [], queue: null };
  const body = el('div');
  const queueBox = el('div');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Dispatchers', 'The verified dispatch workforce — hiring pipeline, carrier assignment + SOP, rate-confirmation approvals, per-load commission and payout. One dedicated dispatcher per carrier; nothing moves until LoadBoot approves the RC.'),
    queueBox,
    body,
  ]));
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading dispatchers…'));
    let rows;
    try { rows = await ccDispatchersList(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (rows && rows.error) { mount(body, el('div', { class: 'lb-state lb-error' }, rows.error)); return; }
    state.rows = Array.isArray(rows) ? rows : [];
    paint();
    paintQueue();
    // deep link from a staff notification: #/dispatchers?booking=<id> | ?assignment=<id> | ?user=<id>
    try {
      const q = new URLSearchParams((location.hash.split('?')[1] || ''));
      const bid = q.get('booking'), aid = q.get('assignment'), uid = q.get('user');
      if (uid) { const x = state.rows.find((r) => r.user_id === uid); if (x) open360(x); }
      else if (bid || aid) { const qq = state.queue || await ccDispatcherQueue().catch(() => null); state.queue = qq;
        const hit = bid ? [...(qq && qq.awaiting_approval || []), ...(qq && qq.awaiting_rc || []), ...(qq && qq.moving || [])].find((b) => b.id === bid) : (qq && qq.unread_threads || []).find((a) => a.assignment_id === aid);
        const uid2 = hit && hit.dispatcher_user_id; const x = uid2 && state.rows.find((r) => r.user_id === uid2);
        if (x) open360(x, bid || null); else if (bid) { const all = await ccDispatcherBookings({ limit: 300 }).catch(() => []); const b = (Array.isArray(all) ? all : []).find((r) => r.id === bid); const x2 = b && state.rows.find((r) => r.user_id === b.dispatcher_user_id); if (x2) open360(x2, bid); }
      }
    } catch (_) { /* deep link is best-effort */ }
  }

  // ---------------------------------------------------------------- cross-dispatcher queue (bl_disp_0300)
  async function paintQueue() {
    let q; try { q = await ccDispatcherQueue(); } catch (e) { mount(queueBox, ''); return; }
    if (!q || q.error) { mount(queueBox, ''); return; }
    state.queue = q;
    const ap = q.awaiting_approval || [], rc = q.awaiting_rc || [], mv = q.moving || [], ut = (q.unread_threads || []).filter((t) => Number(t.unread) > 0), te = q.trials_ending || [];
    const total = ap.length + rc.length + ut.length + Number(q.commission_to_approve || 0) + Number(q.commission_to_pay || 0) + te.length;
    const byUser = (uid, bid) => { const x = state.rows.find((r) => r.user_id === uid); if (x) open360(x, bid || null); };
    const chip = (n, l, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || (n ? 'amber' : 'green')), style: 'margin-right:6px' }, n + ' ' + l);
    const decideQuick = async (b) => { const ok = await approveFlow(b); if (ok) paintQueue(); };
    mount(queueBox, card([
      el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
        el('div', { style: 'font-weight:800;font-size:1.02rem' }, ['Dispatch queue ', total ? el('span', { class: 'cc-pill cc-pill-amber' }, String(total)) : el('span', { class: 'cc-pill cc-pill-green' }, 'clear')]),
        el('span', { style: 'flex:1' }), el('button', { class: 'lb-btn lb-btn-ghost', onClick: paintQueue }, [icon('refresh', 14), ' Refresh']),
      ]),
      el('div', { style: 'margin-bottom:8px' }, [chip(ap.length, 'RC to approve', ap.length ? 'red' : 'green'), chip(rc.length, 'awaiting RC'), chip(mv.length, 'moving', 'green'), chip(ut.length, 'unread threads'), chip(Number(q.commission_to_approve || 0), 'commission to approve'), chip(Number(q.commission_to_pay || 0), 'to pay'), chip(te.length, 'trials ending ≤3 d')]),
      ap.length ? el('div', null, [el('div', { style: 'font-weight:700;margin:6px 0 2px' }, 'Rate confirmations waiting — approve from the RC, never from the summary'),
        ...ap.map((b) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eef2f7' }, [
          el('div', { style: 'flex:1;min-width:240px' }, [el('b', null, b.lane), el('div', { class: 'cc-sub' }, [b.dispatcher, ' → ', b.carrier, ' · ', b.broker, ' · ', money(b.gross), b.miles ? ' · $' + (Number(b.gross) / Number(b.miles)).toFixed(2) + '/mi' : '', ' · PU ', et(b.pickup_at), ' · waiting ', mins(b.age_min)].join(''))]),
          Number(b.age_min) > 60 ? el('span', { class: 'cc-pill cc-pill-red' }, 'SLA ' + mins(b.age_min)) : '',
          b.hours_to_pickup != null && Number(b.hours_to_pickup) < 6 ? el('span', { class: 'cc-pill cc-pill-red' }, 'pickup in ' + b.hours_to_pickup + ' h') : '',
          b.below_min ? el('span', { class: 'cc-pill cc-pill-red' }, 'below floor') : '', !b.driver_set ? el('span', { class: 'cc-pill cc-pill-amber' }, 'no driver on truck') : '', !b.rc_doc_path ? el('span', { class: 'cc-pill cc-pill-amber' }, 'no RC file') : '',
          b.rc_doc_path ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => previewRc(b) }, 'View RC') : '',
          el('button', { class: 'lb-btn lb-btn-primary', disabled: !b.rc_doc_path ? '' : undefined, onClick: () => decideQuick(b) }, 'Approve'),
          el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => byUser(b.dispatcher_user_id, b.id) }, 'Open'),
        ]))]) : '',
      rc.length ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'Awaiting RC: ' + rc.map((b) => b.lane + ' (' + b.dispatcher + ', ' + mins(b.age_min) + ')').join(' · ')) : '',
      mv.length ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, ['Moving: ', ...mv.map((b, i) => el('span', null, [i ? ' · ' : '', el('a', { href: '#', onClick: (e) => { e.preventDefault(); byUser(b.dispatcher_user_id, b.id); } }, b.lane), ' (' + b.status + ', last touch ' + mins(b.last_touch_min) + (Number(b.last_touch_min) > 240 ? ' ⚠' : '') + ')']))]) : '',
      ut.length ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, ['Unread: ', ...ut.map((t, i) => el('span', null, [i ? ' · ' : '', el('a', { href: '#', onClick: (e) => { e.preventDefault(); byUser(t.dispatcher_user_id); } }, t.carrier + ' (' + t.unread + ')')]))]) : '',
      te.length ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Trials ending: ' + te.map((t) => t.name + ' — ' + t.trial_end + ' (' + t.days_left + ' d)').join(' · ') + '. Decide from KPIs: verify or end.') : '',
    ]));
  }

  // ---------------------------------------------------------------- RC preview (inline; PDF or image)
  async function previewRc(b) {
    let u; try { u = await signedDocumentUrl(b.rc_doc_path, 600); } catch (e) { toast(humanizeError(e)); return; }
    const isImg = /\.(png|jpe?g|webp)$/i.test(b.rc_doc_name || b.rc_doc_path || '');
    openDrawer('Rate confirmation — ' + (b.lane || (b.origin + ' → ' + b.destination)), el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, ['Check: carrier name + MC on the RC · rate ' + money(b.gross) + ' · pickup ' + et(b.pickup_at) + ' · broker ' + (b.broker || '') + (b.rc_number ? ' · RC # ' + b.rc_number : ''), ' ', el('a', { href: u, target: '_blank', rel: 'noopener' }, 'open in new tab ↗')]),
      isImg ? el('img', { src: u, style: 'max-width:100%;border-radius:8px;border:1px solid #e6edf5' }) : el('iframe', { src: u, style: 'width:100%;height:70vh;border:1px solid #e6edf5;border-radius:8px;background:#fff', title: 'Rate confirmation' }),
    ]), { subtitle: 'Signed link, 10 minutes' });
  }
  // approve with every guard the server enforces, surfaced as a flow instead of a wall of errors
  async function approveFlow(b, opts = {}) {
    if (!b.rc_doc_path) { toast('No rate confirmation attached — ask the dispatcher for the RC first.'); return false; }
    let note = opts.note || null;
    if (b.below_min && !note) { note = await askReason('Below the carrier’s floor — why approve?', { note: 'This load pays under the floor rate agreed with the carrier. The carrier sees this reason on the load.', placeholder: 'e.g. repositioning toward home, owner OK’d in the group at 9:40 ET' }); if (note === null) return false; }
    if (!opts.skipConfirm && !(await askConfirm('Approve ' + (b.lane || (b.origin + ' → ' + b.destination)) + ' at ' + money(b.gross) + '?', { body: 'This creates the CC load + trip under ' + (b.carrier || 'the carrier') + '’s MC, registers the RC as a carrier document, tells the carrier and the dispatcher, and freezes the commission at today’s %. Did you read the RC?', confirmLabel: 'Yes — RC checked, approve' }))) return false;
    const r = await ccDispatcherBookingDecide(b.id, 'approve', note).catch((e) => ({ error: humanizeError(e) }));
    if (r && r.error) {
      if (/override/.test(r.error) && !(note || '').includes('override')) {
        if (await askConfirm('Truck already has a load in that window', { body: r.error, confirmLabel: 'Approve anyway (override)', danger: true })) return approveFlow(b, { note: (note ? note + ' — ' : '') + 'override', skipConfirm: true });
        return false;
      }
      toast(r.error); return false;
    }
    toast('✓ approved' + (r.trip ? ' · trip created' : '')); return true;
  }

  function paint() {
    const q = state.q.toLowerCase();
    const list = state.rows.filter((x) => (state.st === 'all' || x.status === state.st)
      && (!q || ((x.name || '') + ' ' + (x.email || '') + ' ' + (x.country || '')).toLowerCase().includes(q)));
    const qIn = el('input', { class: 'lb-input', placeholder: '🔍 name / email / country', value: state.q, style: 'max-width:240px',
      onInput: (e) => { state.q = e.target.value; paint(); } });
    const stSel = el('select', { class: 'lb-input', style: 'max-width:180px', onChange: (e) => { state.st = e.target.value; paint(); } },
      [['all', 'All statuses']].concat(PIPE.map((s) => [s, (STPILL[s] || [s])[0]])).map(([v, l]) => el('option', { value: v, selected: state.st === v ? '' : undefined }, l)));
    mount(body, el('div', null, [
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center' }, [qIn, stSel,
        el('span', { class: 'cc-sub' }, list.length + ' of ' + state.rows.length + ' dispatchers')]),
      card([el('div', { class: 'cc-doclist' }, list.length ? list.map(row) : [el('div', { class: 'cc-sub' }, 'No dispatchers match.')])]),
    ]));
  }

  function row(x) {
    const q = state.queue; const uid = x.user_id;
    const nAp = q ? (q.awaiting_approval || []).filter((b) => b.dispatcher_user_id === uid).length : 0;
    const nUn = q ? (q.unread_threads || []).filter((t) => t.dispatcher_user_id === uid).reduce((s, t) => s + Number(t.unread || 0), 0) : 0;
    const tr = q ? (q.trials_ending || []).find((t) => t.user_id === uid) : null;
    return el('div', { class: 'cc-row', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 0;border-bottom:1px solid #eef2f7;cursor:pointer', onClick: () => open360(x) }, [
      el('div', { style: 'flex:1;min-width:220px' }, [
        el('div', { style: 'font-weight:700' }, (x.name || '(no name)') + ' · ' + (x.email || '')),
        el('div', { class: 'cc-sub' }, (x.country || '—') + ' · ' + (x.years_exp || 0) + ' yrs exp · applied ' + fmtDate(x.applied_at) + (x.commission_pct != null && Number(x.commission_pct) > 0 ? ' · ' + x.commission_pct + '%' : '')),
      ]),
      nAp ? el('span', { class: 'cc-pill cc-pill-red' }, nAp + ' RC to approve') : '', nUn ? el('span', { class: 'cc-pill cc-pill-amber' }, nUn + ' unread') : '', tr ? el('span', { class: 'cc-pill cc-pill-amber' }, 'trial ends in ' + tr.days_left + ' d') : '',
      Number(x.carriers) ? el('span', { class: 'cc-pill cc-pill-green' }, (x.carriers) + ' carrier' + (x.carriers > 1 ? 's' : '') + ' · ' + (x.active_trucks || 0) + ' trucks') : '',
      pill(x.status),
    ]);
  }

  async function open360(x, focusBooking) {
    let d;
    try { d = await ccDispatcher360(x.user_id); } catch (e) { toast(humanizeError(e)); return; }
    if (!d || d.error) { toast((d && d.error) || 'Could not load'); return; }
    const wrap = el('div', { class: 'cc-drawer-body', style: 'max-width:780px' });
    const rerender = async () => { const nx = await ccDispatcher360(x.user_id).catch(() => null); if (nx && !nx.error) { mount(wrap, sections(nx)); } paintQueue(); };

    function sections(dd) {
      const pp = dd.profile || {};
      return el('div', null, [
        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [
          el('h2', { style: 'margin:0' }, pp.full_name || '(no name)'), pill(pp.status),
          pp.status === 'trial' && pp.trial_end ? el('span', { class: 'cc-pill cc-pill-amber' }, 'trial ' + (pp.trial_start || '?') + ' → ' + pp.trial_end) : '',
          pp.commission_pct != null ? el('span', { class: 'cc-pill cc-pill-green' }, pp.commission_pct + '% of gross') : '',
        ]),
        el('div', { class: 'cc-sub', style: 'margin-bottom:14px' }, (dd.email || '') + ' · ' + (pp.country || '—') + ' · ' + (pp.city || '') + ' · ' + (pp.years_exp || 0) + ' yrs' + (pp.phone ? ' · ' + pp.phone : '')),
        // ---- application detail ----
        (() => { const s = pp.skills || {}; return card([
          el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Application & screening'),
          kv('English', pp.english_level),
          kv('Experience', (pp.years_exp || 0) + ' yrs · trucks handled: ' + (s.trucks_handled || '—')),
          kv('Availability', (s.availability_hours || '—') + ' hrs/wk · ' + (s.timezone || '') + (s.us_hours_overlap ? ' · US-hours overlap' : ' · ⚠ no US-hours overlap stated')),
          kv('Can source loads', s.can_source_loads === 'yes_independent' ? 'Yes — independently' : s.can_source_loads === 'yes_with_board' ? 'Yes — needs board access' : s.can_source_loads === 'learning' ? 'Not yet — learning' : '—'),
          kv('Load boards', (pp.load_boards || []).join(', ')),
          kv('Own board access', (s.own_board_access || []).join(', ') || '⚠ none — dispatcher must bring their own DAT/Truckstop'),
          kv('Freight network', s.network_desc),
          kv('Equipment', (s.equipment || []).join(', ')),
          kv('Skills', 'negotiation ' + (s.negotiation || '—') + ' · FMCSA/HOS ' + (s.fmcsa_hos || '—') + ' · geography ' + (s.us_geography || '—')),
          kv('Tools', s.tools), kv('Payout pref', s.payout_pref), kv('LinkedIn', s.linkedin),
          kv('References', (pp.refs || []).join('  |  ')),
          s.note ? kv('Why hire', s.note) : '',
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
            s.cv_doc ? docBtn('📄 CV / résumé' + (s.cv_name ? ' (' + s.cv_name + ')' : ''), s.cv_doc) : el('span', { class: 'cc-sub' }, 'No CV uploaded'),
            s.id_doc ? docBtn('🪪 Government ID', s.id_doc) : '',
          ]),
          pp.review_note ? kv('Last note', pp.review_note) : '',
        ]); })(),
        pipeline(pp),
        assignSection(dd),
        kpiSection(dd),
        termsSection(dd),
        bookingsSection(dd),
        commissionSection(dd),
        threadSection(dd),
      ]);
    }
    function kv(k, v) { return el('div', { style: 'display:flex;gap:8px;padding:3px 0;font-size:.9rem' }, [el('span', { class: 'cc-sub', style: 'min-width:120px' }, k), el('span', null, v == null || v === '' ? '—' : String(v))]); }
    function docBtn(label, path) { return el('button', { class: 'lb-btn lb-btn-ghost', onClick: async () => { try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } } }, label); }

    async function decide(action, note) {
      const r = await ccDispatcherDecide(x.user_id, action, note).catch((e) => ({ error: humanizeError(e) }));
      if (r && r.error) { toast(r.error); return null; }
      toast('✓ ' + (r.status || 'updated')); if (r.warning) toast('⚠ ' + r.warning); rerender(); return r;
    }
    function actBtn(label, action, tone, confirmMsg, body) {
      return el('button', { class: 'lb-btn ' + (tone || 'lb-btn-ghost'), style: 'margin:4px 6px 0 0', onClick: async () => {
        if (confirmMsg && !(await askConfirm(confirmMsg, { body, danger: tone === 'lb-btn-danger' }))) return;
        let note = null;
        if (action === 'reject' || action === 'suspend') { note = await askReason(action === 'reject' ? 'Reason for rejecting (the applicant sees this)' : 'Reason for suspending (the dispatcher sees this)'); if (note === null) return; }
        decide(action, note);
      } }, label);
    }
    // Move to trial = set the terms first (commission % + window), then flip the status. No 0% trials by accident.
    function trialForm(pp) {
      const pct = el('input', { class: 'lb-input', type: 'number', step: '0.25', min: '0', max: '5', value: pp.commission_pct != null && Number(pp.commission_pct) > 0 ? pp.commission_pct : 2.5, style: 'max-width:110px' });
      const today = new Date().toISOString().slice(0, 10);
      const ts = el('input', { class: 'lb-input', type: 'date', value: pp.trial_start || today, style: 'max-width:160px' });
      const te = el('input', { class: 'lb-input', type: 'date', value: pp.trial_end || addWorkingDays(today, 10), style: 'max-width:160px' });
      const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
      const go = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        const p = Number(pct.value); if (!(p > 0 && p <= 5)) { err.textContent = 'Commission must be above 0 and at most 5%.'; return; }
        if (!ts.value || !te.value || te.value < ts.value) { err.textContent = 'Set a valid trial window.'; return; }
        const r = await ccDispatcherSetTerms(x.user_id, p, ts.value, te.value).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { err.textContent = r.error; return; }
        dr.close(); await decide('trial', null);
      } }, 'Start the trial');
      const dr = openDrawer('Trial terms — ' + (pp.full_name || ''), el('div', { class: 'cc-form' }, [
        el('p', { class: 'cc-sub', style: 'margin:0 0 10px;line-height:1.6' }, 'Commission-only trial: the dispatcher earns this % of gross on every load they book that reaches Delivered inside the window. LoadBoot keeps 5% from the carrier, so the cap is 5. Ten working days is the standard. The dispatcher is e-mailed the terms and the workspace opens once a carrier is assigned.'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [el('span', { class: 'cc-sub' }, '% of gross'), pct, el('span', { class: 'cc-sub' }, 'from'), ts, el('span', { class: 'cc-sub' }, 'to'), te]),
        err, el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [go, el('button', { class: 'lb-btn', onClick: () => dr.close() }, 'Cancel')]),
      ]), { subtitle: 'Recorded in the terms log · the dispatcher is notified' });
    }
    function pipeline(pp) {
      const st = pp.status;
      const btns = []; let hint = '';
      if (st === 'applied') btns.push(actBtn('Start screening →', 'screening', 'lb-btn-primary'));
      if (st === 'screening') btns.push(actBtn('Send skills test →', 'skills_test', 'lb-btn-primary'));
      if (st === 'skills_test') btns.push(el('button', { class: 'lb-btn lb-btn-primary', style: 'margin:4px 6px 0 0', onClick: () => trialForm(pp) }, 'Move to trial (set terms) →'));
      if (st === 'trial') { btns.push(actBtn('✓ Verify (passed trial)', 'verify', 'lb-btn-primary', 'Verify ' + (pp.full_name || 'this dispatcher') + '?', 'Check My KPIs first: ≥3 loads/week/truck, avg $/mi above the floor, 100% RC attached, ≥2 check calls per load, no dispatch-caused cancellations.')); hint = 'Trial runs on commission. Assign a carrier below (with the SOP) — the workspace opens the moment it is assigned. Verify only after the KPIs above the pass bar.'; }
      if (st === 'verified') btns.push(el('span', { class: 'cc-sub' }, 'Verified — assign a carrier below to activate.'));
      if (st === 'active' || st === 'verified' || st === 'trial') btns.push(actBtn('Suspend', 'suspend', 'lb-btn-danger', 'Suspend this dispatcher?', 'Every active assignment is PAUSED immediately: the workspace, documents, thread and bookings close. Carriers are told LoadBoot dispatch covers them.'));
      if (st === 'suspended') btns.push(actBtn('Reinstate', 'reinstate', 'lb-btn-primary', 'Reinstate?', 'Paused assignments resume; returns to trial if the trial window is still open.'));
      if (!['rejected', 'active'].includes(st)) btns.push(actBtn('Reject', 'reject', 'lb-btn-danger', 'Reject this applicant?', 'Active assignments end. This is final for the application.'));
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Verification pipeline'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'applied → screening → skills test → commission trial (10 working days) → verified → active (on assignment)'),
        el('div', null, btns), hint ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, hint) : '']);
    }

    function assignSection(dd) {
      const live = (dd.assignments || []).filter((a) => a.status !== 'ended');
      const rows = live.length ? live.map((a) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eef2f7' }, [
        el('div', { style: 'flex:1;min-width:180px' }, [el('b', null, a.carrier || a.carrier_org_id), el('div', { class: 'cc-sub' }, (a.trucks || 0) + ' trucks · ' + a.status + ' · since ' + fmtDate(a.assigned_at) + (a.carrier_ack_at ? ' · carrier confirmed ' + fmtDate(a.carrier_ack_at) : a.carrier_notified_at ? ' · intro sent ' + fmtDate(a.carrier_notified_at) + ', not confirmed yet' : ' · ⚠ intro e-mail not sent') + (a.end_reason && a.status === 'paused' ? ' · ' + a.end_reason : '')),
          a.sop && (a.sop.min_rate || a.sop.scope_value) ? el('div', { class: 'cc-sub' }, ['SOP: ', a.sop.scope_value ? a.sop.scope_value + ' · ' : '', a.sop.min_rate ? 'floor $' + Number(a.sop.min_rate).toFixed(2) + '/mi' : 'no floor set', a.sop.min_rate_note ? ' (' + a.sop.min_rate_note + ')' : ''].join('')) : el('div', { class: 'cc-sub', style: 'color:#b45309' }, '⚠ No SOP — set the floor rate and scope.')]),
        el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => editSop(a) }, 'SOP'),
        el('button', { class: 'lb-btn lb-btn-ghost', title: 'Re-send the branded "meet your dispatcher" e-mail (what they can see, how a load moves, one-tap confirm)', onClick: async () => { if (!(await askConfirm('Send the intro e-mail to ' + (a.carrier || 'the carrier') + '?', { body: 'Branded e-mail to the owner: what the dispatcher can and cannot see, how a load moves, the one-channel rule, the SOP rules, and a one-tap "Got it" link. Nothing to sign — it runs under their Dispatch Service Agreement.' }))) return; const r = await ccDispatcherResendIntro(a.id).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ intro sent to ' + r.to); rerender(); } }, a.carrier_notified_at ? 'Re-send intro' : 'Send intro e-mail'),
        a.status === 'active' ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: async () => { const reason = await askReason('Pause this assignment — why? (dispatcher + carrier see it)'); if (reason === null) return; const r = await ccDispatcherUnassign(a.id, reason, true).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ paused'); rerender(); } }, 'Pause') : '',
        a.status === 'paused' ? el('span', { class: 'cc-pill cc-pill-amber' }, 'paused — resume by re-assigning or reinstating') : '',
        el('button', { class: 'lb-btn lb-btn-danger', onClick: async () => { if (!(await askConfirm('End this assignment?', { body: 'The carrier frees up for reassignment and is told LoadBoot dispatch covers the truck. Blocked while loads are moving unless you add "force".', danger: true }))) return; const reason = await askReason('Reason (dispatcher + carrier see it)'); if (reason === null) return; const r = await ccDispatcherUnassign(a.id, reason, false).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ ended'); rerender(); } }, 'End'),
      ])) : [el('div', { class: 'cc-sub' }, 'No active carriers assigned.')];
      let picker = '';
      if (['trial', 'verified', 'active'].includes((dd.profile || {}).status)) {
        const sel = el('select', { class: 'lb-input', style: 'max-width:260px' }, [el('option', { value: '' }, 'Choose a carrier…')].concat(
          state.carriers.map((c) => el('option', { value: c.id }, c.name || c.id))));
        const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: () => {
          if (!sel.value) { toast('Pick a carrier'); return; }
          const c = state.carriers.find((k) => k.id === sel.value) || { id: sel.value };
          // SOP first — an assignment without a floor rate lets the dispatcher book anything
          editSop({ carrier_org_id: c.id, carrier: c.name, sop: {} }, async (sop) => {
            const r = await ccDispatcherAssign(x.user_id, c.id, sop).catch((e) => ({ error: humanizeError(e) }));
            if (r && r.error) { toast(r.error); return false; }
            toast('✓ assigned — carrier and dispatcher notified'); rerender(); return true;
          });
        } }, 'Assign (SOP first)');
        picker = el('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [sel, btn]);
        if (!state.carriers.length) loadCarriers(sel);
      }
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Assigned carriers (one dedicated dispatcher per carrier)'), el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'The carrier gets an e-mail + a confirm card in their portal saying exactly what the dispatcher can see (truck specs, driver, authority/COI/W-9/NOA — never bank details). They can pause the dispatcher themselves.'), el('div', null, rows), picker]);
    }
    async function loadCarriers(sel) {
      try { const r = await getCarriersDirectory({}); const arr = Array.isArray(r) ? r : (r && r.rows) || [];
        state.carriers = arr.map((c) => ({ id: c.id || c.org_id || c.carrier_id, name: c.name || c.company || c.legal_name })).filter((c) => c.id);
        if (sel) state.carriers.forEach((c) => sel.appendChild(el('option', { value: c.id }, c.name || c.id)));
      } catch (e) { /* leave empty */ }
    }
    // SOP editor. onSave(sop) → for a NEW assignment (assign after SOP); otherwise saves via cc_dispatcher_sop.
    function editSop(a, onSave) {
      const s = a.sop || {};
      const prefsHint = el('div', { class: 'cc-sub', style: 'display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 10px;margin-bottom:10px;color:#1d4ed8;font-weight:600' });
      (async () => { try {
        const pr = await ccCarrierPrefs(a.carrier_org_id);
        if (!pr || pr.error || pr.none) return;
        const eb = pr.external_boards || {};
        const bits = [];
        if (eb.dat === 'active' || eb.truckstop === 'active') bits.push('🖥 Carrier has ' + [eb.dat === 'active' ? 'DAT' : null, eb.truckstop === 'active' ? 'Truckstop' : null].filter(Boolean).join(' + ') + ' — the dispatcher still uses their OWN board login, never the carrier’s');
        if (!lanes.value && Array.isArray(pr.preferred_lanes) && pr.preferred_lanes.length) lanes.value = pr.preferred_lanes.join(', ');
        if (!minRate.value && pr.min_rpm != null) { minRate.value = String(pr.min_rpm); bits.push('Floor pre-filled from the carrier’s own preference ($' + Number(pr.min_rpm).toFixed(2) + '/mi)'); }
        if (!equipment.value && Array.isArray(pr.preferred_equipment) && pr.preferred_equipment.length) equipment.value = pr.preferred_equipment.join('/');
        if (!homeTime.value && pr.home_time) homeTime.value = pr.home_time;
        if (pr.weekend_ok === false) bits.push('📅 No weekends');
        if (pr.load_size) bits.push('📦 ' + pr.load_size + ' loads');
        if (bits.length) { prefsHint.textContent = bits.join('  ·  '); prefsHint.style.display = 'block'; }
      } catch (_) {} })();
      const scopeType = el('select', { class: 'lb-input', style: 'max-width:220px' },
        [['geography', 'Geography (origin region)'], ['equipment', 'Equipment type'], ['commodity', 'Commodity / hazmat'], ['single', 'Single-carrier (no others)']]
          .map(([v9, l9]) => el('option', { value: v9, selected: (s.scope_type || 'geography') === v9 ? '' : undefined }, l9)));
      const scopeVal = el('input', { class: 'lb-input', value: s.scope_value || '', placeholder: 'e.g. "Origins in TX/OK/LA" or "Reefer only"' });
      const lanes = el('input', { class: 'lb-input', value: s.lanes || '', placeholder: 'Preferred lanes (e.g. TX↔CA)' });
      const minRate = el('input', { class: 'lb-input', type: 'number', step: '0.05', min: '0', value: s.min_rate != null && s.min_rate !== '' ? s.min_rate : '', placeholder: 'e.g. 2.10', style: 'max-width:140px' });
      const minNote = el('input', { class: 'lb-input', value: s.min_rate_note || '', placeholder: 'e.g. $2.10/mi loaded, radius 1,000 mi, weekends home' });
      const equipment = el('input', { class: 'lb-input', value: s.equipment || '', placeholder: 'Equipment (van/reefer/flatbed)' });
      const homeTime = el('input', { class: 'lb-input', value: s.home_time || '', placeholder: 'Home-time rule' });
      const rules = el('textarea', { class: 'lb-input', style: 'min-height:70px' }, s.rules || '');
      const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
      const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        const mr = minRate.value === '' ? null : Number(minRate.value);
        if (mr != null && !(mr >= 0 && mr < 20)) { err.textContent = 'Floor rate must be a number per mile (e.g. 2.10).'; return; }
        if (mr == null && !(await askConfirm('No floor rate?', { body: 'Without a floor every booking passes the rate check. Continue?', danger: true }))) return;
        const sop = { scope_type: scopeType.value, scope_value: scopeVal.value.trim(), lanes: lanes.value.trim(), min_rate: mr, min_rate_note: minNote.value.trim(), equipment: equipment.value.trim(), home_time: homeTime.value.trim(), rules: rules.value.trim(), rc_to_staff_first: true, driver_moves_only_after_approval: true };
        if (onSave) { const ok = await onSave(sop); if (ok) m.remove(); return; }
        const r = await ccDispatcherSop(a.id, sop).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { err.textContent = r.error; return; }
        m.remove(); toast('✓ SOP saved — the dispatcher sees it in Trucks'); rerender();
      } }, onSave ? 'Save SOP & assign' : 'Save SOP');
      const m = el('div', { style: 'position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:70;display:flex;align-items:center;justify-content:center', onClick: (e) => { if (e.target === m) m.remove(); } }, [
        el('div', { role: 'dialog', 'aria-modal': 'true', style: 'background:#fff;border-radius:12px;max-width:540px;width:92%;max-height:90vh;overflow:auto;padding:20px', onClick: (e) => e.stopPropagation() }, [
          el('div', { style: 'font-weight:800;margin-bottom:4px' }, 'SOP — ' + (a.carrier || 'carrier')),
          el('div', { class: 'cc-sub', style: 'margin-bottom:10px;line-height:1.5' }, '⚖️ Scope basis keeps this carrier’s loads NON-overlapping with your other carriers — so no load is ever "allocated" between carriers (FMCSA 88 FR 39371). The floor is what the rate check uses: a booking under it needs your written reason to approve.'),
          prefsHint,
          el('label', { class: 'cc-sub' }, 'Scope basis (required for compliance)'), scopeType, scopeVal,
          el('label', { class: 'cc-sub', style: 'margin-top:8px;display:block' }, 'Floor rate $/loaded mile (number)'), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [minRate, minNote]),
          el('label', { class: 'cc-sub', style: 'margin-top:8px;display:block' }, 'Lanes'), lanes,
          el('label', { class: 'cc-sub' }, 'Equipment'), equipment,
          el('label', { class: 'cc-sub' }, 'Home-time'), homeTime,
          el('label', { class: 'cc-sub' }, 'Do’s / don’ts'), rules,
          err,
          el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [save, el('button', { class: 'lb-btn', onClick: () => m.remove() }, 'Cancel')]),
        ]),
      ]);
      document.body.appendChild(m);
    }

    // ---------------------------------------------------------------- KPIs (computed; trial window from the profile)
    function kpiSection(dd) {
      const pp = dd.profile || {};
      const trialDays = pp.trial_start && pp.trial_end ? Math.max(1, Math.ceil((new Date(pp.trial_end) - new Date(pp.trial_start)) / 86400000) + 1) : null;
      const box = el('div', { class: 'cc-sub' }, 'Loading KPIs…');
      const opts = [trialDays ? [trialDays, 'Trial window (' + pp.trial_start + ' → ' + pp.trial_end + ')'] : null, [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].filter(Boolean);
      const def = trialDays && pp.status === 'trial' ? trialDays : 30;
      const sel = el('select', { class: 'lb-input', style: 'max-width:260px' }, opts.map(([v, l]) => el('option', { value: v, selected: v === def ? '' : undefined }, l)));
      sel.addEventListener('change', paint);
      async function paint() {
        let k; try { k = await ccDispatcherKpis(x.user_id, Number(sel.value)); } catch (e) { mount(box, el('span', { class: 'cc-sub' }, humanizeError(e))); return; }
        if (!k || k.error) { mount(box, el('span', { class: 'cc-sub' }, (k && k.error) || 'unavailable')); return; }
        const t = (l, v, good) => el('div', { style: 'flex:1;min-width:110px;background:#f8fafc;border:1px solid ' + (good === false ? '#fca5a5' : good === true ? '#86efac' : '#e6edf5') + ';border-radius:10px;padding:8px 10px' }, [el('div', { style: 'font-weight:800;font-size:1.05rem' }, v == null ? '—' : String(v)), el('div', { class: 'cc-sub' }, l)]);
        mount(box, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
          t('Bookings', k.bookings), t('Delivered', k.delivered), t('Cancelled', k.cancelled, k.cancelled != null ? Number(k.cancelled) === 0 : null), t('Loads / wk / truck', k.loads_per_week_per_truck, k.loads_per_week_per_truck != null ? Number(k.loads_per_week_per_truck) >= 3 : null), t('Gross', money(k.gross)), t('Gross / truck / wk', money(k.gross_per_truck_week)), t('Avg $/mi', k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : null),
          t('Deadhead', k.deadhead_pct != null ? k.deadhead_pct + '%' : null, k.deadhead_pct != null ? Number(k.deadhead_pct) <= 15 : null), t('On-time', k.on_time_pct != null ? k.on_time_pct + '%' : null, k.on_time_pct != null ? Number(k.on_time_pct) >= 95 : null), t('Check calls / load', k.check_calls_per_load, k.check_calls_per_load != null ? Number(k.check_calls_per_load) >= 2 : null), t('RC attached', k.rc_attach_rate != null ? k.rc_attach_rate + '%' : null, k.rc_attach_rate != null ? Number(k.rc_attach_rate) >= 100 : null), t('RC turnaround', k.rc_turnaround_h != null ? k.rc_turnaround_h + ' h' : null), t('Below floor', k.below_min_share != null ? k.below_min_share + '%' : null), t('Brokers', k.brokers_used), t('Trucks', k.trucks),
        ]));
      }
      paint();
      return card([el('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:6px' }, [el('div', { style: 'font-weight:700' }, 'Performance (computed from bookings + events — nothing hand-typed)'), sel]), el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Pass bar: ≥3 loads/wk/truck · avg $/mi above the floor · 100% RC attached · ≥2 check calls/load · deadhead ≤15% · 0 dispatch-caused cancellations.'), box]);
    }
    // ---------------------------------------------------------------- terms
    function termsSection(dd) {
      const pp = dd.profile || {};
      const pct = el('input', { class: 'lb-input', type: 'number', step: '0.25', min: '0', max: '5', value: pp.commission_pct != null ? pp.commission_pct : 0, style: 'max-width:110px' });
      const ts = el('input', { class: 'lb-input', type: 'date', value: pp.trial_start || '', style: 'max-width:160px' });
      const te = el('input', { class: 'lb-input', type: 'date', value: pp.trial_end || '', style: 'max-width:160px' });
      const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        if (!(await askConfirm('Update terms?', { body: 'Commission ' + pct.value + '% of gross' + (ts.value ? ', trial ' + ts.value + ' → ' + te.value : '') + '. Already-approved loads keep the % frozen at approval; the dispatcher is e-mailed the new terms.' }))) return;
        const r = await ccDispatcherSetTerms(x.user_id, Number(pct.value), ts.value || null, te.value || null).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return; } toast('✓ terms saved'); rerender();
      } }, 'Save');
      return card([
        el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Commission & trial window'),
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Per-load commission = this % of gross line-haul on every load the dispatcher books that reaches Delivered. Frozen per load at approval time. LoadBoot keeps 5% from the carrier, so this is capped at 5. Trial dates drive the countdown and the KPI window.'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [el('span', { class: 'cc-sub' }, '% of gross'), pct, el('span', { class: 'cc-sub' }, 'trial'), ts, el('span', { class: 'cc-sub' }, '→'), te, btn]),
      ]);
    }
    // ---------------------------------------------------------------- bookings (approve creates load + trip)
    function bookingsSection(dd) {
      const box = el('div', { class: 'cc-sub' }, 'Loading bookings…');
      const BST = { pending_rc: ['awaiting RC', 'amber'], rc_received: ['RC in — APPROVE?', 'amber'], approved: ['approved', 'green'], dispatched: ['dispatched', 'green'], picked_up: ['in transit', 'green'], delivered: ['delivered', 'green'], invoiced: ['invoiced', 'green'], paid: ['paid', 'green'], cancelled: ['cancelled', 'violet'], rejected: ['rejected', 'red'] };
      const bpill = (st) => { const m = BST[st] || [st, 'violet']; return el('span', { class: 'cc-pill cc-pill-' + m[1] }, m[0]); };
      const filt = el('select', { class: 'lb-input', style: 'max-width:170px' }, [['open', 'Open'], ['all', 'All'], ['rc_received', 'RC to approve'], ['moving', 'Moving'], ['done', 'Delivered / closed']].map(([v, l]) => el('option', { value: v }, l)));
      filt.addEventListener('change', paint);
      const reject = async (b) => { const note = await askReason('Why not? (the dispatcher sees this)'); if (note === null) return; const r = await ccDispatcherBookingDecide(b.id, 'reject', note).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ rejected'); paint(); paintQueue(); };
      async function paint() {
        let rows = []; try { rows = await ccDispatcherBookings({ user: x.user_id, limit: 200 }); } catch (e) { mount(box, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
        if (!Array.isArray(rows)) rows = [];
        const v = filt.value;
        const OPEN = ['pending_rc', 'rc_received', 'approved', 'dispatched', 'picked_up'];
        rows = rows.filter((b) => v === 'all' || (v === 'open' ? OPEN.includes(b.status) : v === 'rc_received' ? b.status === 'rc_received' : v === 'moving' ? ['approved', 'dispatched', 'picked_up'].includes(b.status) : !OPEN.includes(b.status)));
        if (focusBooking && !rows.some((b) => b.id === focusBooking)) { filt.value = 'all'; }
        mount(box, rows.length ? rows.map((b) => {
          const rpm = b.miles > 0 ? (Number(b.gross) / Number(b.miles)).toFixed(2) : null;
          const hot = focusBooking === b.id;
          const node = el('div', { id: 'ccb-' + b.id, style: 'padding:8px 0;border-bottom:1px solid #eef2f7' + (hot ? ';background:#fffbeb;border-radius:8px;padding:8px' : '') }, [
            el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
              el('b', { style: 'flex:1;min-width:200px' }, b.origin + ' → ' + b.destination), bpill(b.status), b.below_min ? el('span', { class: 'cc-pill cc-pill-red' }, 'below floor') : '', b.source === 'loadboot' ? el('span', { class: 'cc-pill cc-pill-violet' }, 'LoadBoot board') : '',
            ]),
            el('div', { class: 'cc-sub' }, [b.carrier || '', b.truck ? ' · unit ' + b.truck : '', ' · ', b.broker || '', b.broker_mc ? ' (MC ' + b.broker_mc + ')' : '', ' · ', money(b.gross), rpm ? ' · $' + rpm + '/mi' : '', b.miles ? ' · ' + b.miles + ' mi' : '', b.pickup_at ? ' · PU ' + et(b.pickup_at) : '', b.delivery_at ? ' · DEL ' + et(b.delivery_at) : '', b.rc_number ? ' · RC ' + b.rc_number : '', b.commodity ? ' · ' + b.commodity : '', b.weight_lbs ? ' · ' + Number(b.weight_lbs).toLocaleString() + ' lb' : ''].join('')),
            Array.isArray(b.stops) && b.stops.length ? el('div', { class: 'cc-sub' }, 'Stops: ' + b.stops.map((s, i) => (i + 1) + '. ' + (s.kind || '') + ' ' + (s.location || '') + (s.at ? ' ' + et(s.at) : '')).join(' → ')) : '',
            b.notes ? el('div', { class: 'cc-sub' }, b.notes) : '',
            b.decision_note ? el('div', { class: 'cc-sub' }, 'Decision: ' + b.decision_note) : '',
            b.cancel_reason ? el('div', { class: 'cc-sub', style: 'color:#b91c1c' }, 'Cancelled: ' + b.cancel_reason) : '',
            el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, [
              b.rc_doc_path ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => previewRc(b) }, 'View RC') : el('span', { class: 'cc-pill cc-pill-amber' }, 'No RC attached — cannot approve'),
              b.status === 'rc_received' ? el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => { if (await approveFlow(b)) { paint(); paintQueue(); } } }, 'Approve → create trip') : '',
              ['pending_rc', 'rc_received'].includes(b.status) ? el('button', { class: 'lb-btn lb-btn-danger', onClick: () => reject(b) }, 'Reject') : '',
              b.trip_id ? el('a', { class: 'lb-btn lb-btn-ghost', href: '#/trips?id=' + encodeURIComponent(b.trip_id) }, 'Trip ↗') : '',
              b.load_id ? el('a', { class: 'lb-btn lb-btn-ghost', href: '#/loads?id=' + encodeURIComponent(b.load_id) }, 'Load ↗') : '',
              b.commission ? el('span', { class: 'cc-pill cc-pill-' + (b.commission.status === 'paid' ? 'green' : 'amber') }, 'commission ' + money(b.commission.amount) + ' · ' + b.commission.status) : '',
            ]),
          ]);
          if (hot) setTimeout(() => { try { node.scrollIntoView({ block: 'center' }); } catch (_) {} }, 50);
          return node;
        }) : el('div', { class: 'cc-sub' }, 'No bookings here.'));
      }
      paint();
      return card([el('div', { style: 'display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:4px' }, [el('div', { style: 'font-weight:700' }, 'Bookings logged by this dispatcher'), filt]),
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Approve only from the rate confirmation (carrier name + MC, rate, dates). Approving creates the CC load + trip, registers the RC under the carrier’s documents, freezes the commission % and tells both sides. Invoicing and payment run in Finance as for any trip.'), box]);
    }
    // ---------------------------------------------------------------- commission ledger + payout
    function commissionSection(dd) {
      const pp = dd.profile || {};
      const box = el('div', { class: 'cc-sub' }, 'Loading…');
      const payDialog = (lines) => {
        const total = lines.reduce((a, r) => a + Number(r.amount || 0), 0);
        const amt = el('input', { class: 'lb-input', type: 'number', step: '0.01', placeholder: 'amount sent', style: 'max-width:160px' });
        const cur = el('input', { class: 'lb-input', value: pp.currency || 'PKR', style: 'max-width:90px' });
        const fx = el('input', { class: 'lb-input', type: 'number', step: '0.0001', placeholder: 'FX rate (1 USD = ?)', style: 'max-width:170px' });
        const ref = el('input', { class: 'lb-input', placeholder: 'transfer id / receipt no. *' });
        const method = el('select', { class: 'lb-input', style: 'max-width:180px' }, [['wise', 'Wise'], ['payoneer', 'Payoneer'], ['bank', 'Bank transfer'], ['jazzcash', 'JazzCash / Easypaisa'], ['other', 'Other']].map(([v, l]) => el('option', { value: v }, l)));
        const note = el('input', { class: 'lb-input', placeholder: 'note (optional)' });
        const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
        [amt, fx, cur].forEach((i) => i.addEventListener('input', () => { if (fx.value && !amt.value) amt.placeholder = (total * Number(fx.value)).toFixed(2); }));
        const go = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
          if (!ref.value.trim()) { err.textContent = 'Payout reference is required — it is what the dispatcher sees.'; return; }
          if (!(Number(amt.value) > 0) || !cur.value.trim()) { err.textContent = 'Enter the amount that actually left the account and its currency.'; return; }
          const r = await ccDispatcherCommissionPay(lines.map((l) => l.id), { paid_amount: Number(amt.value), paid_currency: cur.value.trim().toUpperCase(), fx_rate: fx.value ? Number(fx.value) : null, payout_ref: ref.value.trim(), payout_method: method.value, note: note.value.trim() || null }).catch((e) => ({ error: humanizeError(e) }));
          if (r && r.error) { err.textContent = r.error; return; }
          dr.close(); toast('✓ paid ' + r.paid + ' line' + (r.paid === 1 ? '' : 's') + ' · $' + Number(r.total_usd).toFixed(2)); paint(); paintQueue();
        } }, 'Record payout');
        const dr = openDrawer('Pay commission — ' + money(total) + ' (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')', el('div', { class: 'cc-form' }, [
          el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, lines.map((l) => money(l.amount) + ' · ' + (l.lane || '')).join(' · ')),
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [amt, cur, fx]), el('div', { style: 'margin-top:8px' }, ref), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [method, note]), err,
          el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [go, el('button', { class: 'lb-btn', onClick: () => dr.close() }, 'Cancel')]),
        ]), { subtitle: 'Recorded on every line and e-mailed to the dispatcher' });
      };
      async function paint() {
        let rows = []; try { rows = await ccDispatcherCommissionList(x.user_id); } catch (e) { mount(box, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
        if (!Array.isArray(rows)) rows = [];
        const tot = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + Number(r.amount || 0), 0);
        const approved = rows.filter((r) => r.status === 'approved');
        mount(box, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, [el('span', { class: 'cc-sub' }, 'pending ' + money(tot('draft')) + ' · approved (owed) ' + money(tot('approved')) + ' · paid ' + money(tot('paid'))), el('span', { style: 'flex:1' }), approved.length ? el('button', { class: 'lb-btn lb-btn-primary', onClick: () => payDialog(approved) }, 'Pay all approved (' + money(tot('approved')) + ')') : '']),
          rows.length ? el('div', null, rows.map((r) => el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #eef2f7' }, [
            el('div', { style: 'flex:1;min-width:200px' }, [el('b', null, money(r.amount) + ' · ' + (r.lane || '')), el('div', { class: 'cc-sub' }, r.pct + '% of ' + money(r.gross) + ' · ' + fmtDate(r.created_at) + (r.paid_at ? ' · paid ' + fmtDate(r.paid_at) + (r.paid_amount != null ? ' · ' + Number(r.paid_amount).toLocaleString() + ' ' + (r.paid_currency || '') : '') + (r.fx_rate ? ' @ ' + r.fx_rate : '') + (r.payout_ref ? ' · ref ' + r.payout_ref : '') : '') + (r.note ? ' · ' + r.note : ''))]),
            el('span', { class: 'cc-pill cc-pill-' + (r.status === 'paid' ? 'green' : r.status === 'approved' ? 'amber' : r.status === 'void' ? 'red' : 'violet') }, r.status === 'draft' ? 'pending' : r.status),
            r.status === 'draft' ? el('button', { class: 'lb-btn lb-btn-ghost', onClick: async () => { if (!(await askConfirm('Approve this commission?', { body: 'Approve once the broker has been invoiced for the load. The dispatcher is notified.' }))) return; const q = await ccDispatcherCommissionStatus(r.id, 'approved').catch((e) => ({ error: humanizeError(e) })); if (q && q.error) { toast(q.error); return; } toast('✓ approved'); paint(); paintQueue(); } }, 'Approve') : '',
            r.status === 'approved' ? el('button', { class: 'lb-btn lb-btn-primary', onClick: () => payDialog([r]) }, 'Pay') : '',
            ['draft', 'approved'].includes(r.status) ? el('button', { class: 'lb-btn lb-btn-danger', onClick: async () => { const why = await askReason('Void this commission line — why?'); if (why === null) return; const q = await ccDispatcherCommissionStatus(r.id, 'void', why).catch((e) => ({ error: humanizeError(e) })); if (q && q.error) { toast(q.error); return; } toast('voided'); paint(); paintQueue(); } }, 'Void') : '',
          ]))) : el('div', { class: 'cc-sub' }, 'No commission lines yet — they appear when a booking is marked Delivered.'),
        ]);
      }
      paint();
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Per-load commission ledger'), el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Pending (delivered) → Approve (broker invoiced) → Pay (records what left the account: amount, currency, FX, reference). Paid lines cannot be changed.'), box]);
    }
    // ---------------------------------------------------------------- 3-way thread (staff view)
    function threadSection(dd) {
      const live = (dd.assignments || []).filter((a) => a.status !== 'ended');
      if (!live.length) return '';
      const wrap = el('div');
      live.forEach((a) => {
        const list = el('div', { style: 'max-height:260px;overflow:auto;background:#f8fafc;border:1px solid #e6edf5;border-radius:10px;padding:8px 10px;margin:6px 0' }, el('span', { class: 'cc-sub' }, 'Loading…'));
        const inp = el('input', { class: 'lb-input', placeholder: 'Message dispatcher + carrier… (both see it; urgent words e-mail them)' });
        const send = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => { if (!inp.value.trim()) return; const r = await dispatcherThreadSend(a.id, inp.value).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } inp.value = ''; paint(); } }, 'Send');
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
        async function paint() {
          try { const r = await dispatcherThreadList(a.id, 100); const ms = (r && r.messages) || []; const P = (r && r.participants) || {};
            mount(list, [el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'Participants: ' + [P.dispatcher, P.carrier, 'LoadBoot'].filter(Boolean).join(' · ')), ...(ms.length ? ms.map((m) => el('div', { style: 'padding:4px 0;border-bottom:1px solid #eef2f7;font-size:.88rem' + (m.role === 'system' ? ';color:#64748b;font-style:italic' : '') }, [el('span', { class: 'cc-sub' }, (m.role === 'system' ? 'system' : (m.by || m.role)) + ' · ' + et(m.at) + ' — '), m.body])) : [el('span', { class: 'cc-sub' }, 'No messages yet.')])]);
            list.scrollTop = list.scrollHeight;
            dispatcherThreadMarkRead(a.id).catch(() => {});
          } catch (e) { mount(list, el('span', { class: 'cc-sub' }, humanizeError(e))); }
        }
        paint();
        wrap.appendChild(el('div', null, [el('div', { style: 'font-weight:600;display:flex;gap:6px;align-items:center' }, [icon('chat', 16), a.carrier || 'carrier', a.status === 'paused' ? el('span', { class: 'cc-pill cc-pill-amber' }, 'paused') : '']), list, el('div', { style: 'display:flex;gap:6px' }, [inp, send])]));
      });
      return card([el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Shared thread (dispatcher · carrier · LoadBoot)'), wrap]);
    }

    mount(wrap, sections(d));
    const overlay = el('div', { class: 'cc-overlay', style: 'position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:60;display:flex;justify-content:flex-end', onClick: (e) => { if (e.target === overlay) close(); } }, [
      el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': (d.profile && d.profile.full_name) || 'Dispatcher', style: 'background:#fff;height:100%;width:min(840px,100%);overflow:auto;padding:22px', onClick: (e) => e.stopPropagation() }, [
        el('button', { class: 'lb-btn lb-btn-ghost', style: 'float:right', onClick: () => close() }, '✕ Close'), wrap]),
    ]);
    const onKey = (e) => { if (e.key === 'Escape' && !document.getElementById('cc-drawer-root')) close(); };
    function close() { overlay.remove(); document.removeEventListener('keydown', onKey); paintQueue(); }
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  }
}
