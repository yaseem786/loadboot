// broker360.js — Partner 360 dispatcher + the Freight Broker (own MC) screen. bl_bp_0455.
//
// One route family, three screens: #/broker?id= · #/broker-agent?id= · #/shipper?id= all call renderPartner360,
// which reads cc_partner_360 v2 once, looks at `role`, and renders the matching screen (agent360.js /
// shipper360.js / the broker view below). A stale link still lands on the right screen and the hash is
// normalised. Everything visual + every action lives in partner360-kit.js so the three cannot drift.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { card, fmtDate, fmtDateTime } from '../../shared/ui/components.js';
import { renderFmcsaOnly } from '../../carrier/profile-view.js';
import { toast } from '../../shared/errors.js';
import {
  mountPartner360, hero, nextActionBanner, kpiRow, sectionNav, section, head, facts, block, pill, tierPill, dash, n0, money, when, agoOr,
  journeyCard, brokerTrustAct, holdReleaseButtons, gateRow, packetCard, bankCard, agreementBlock, loadsCard, claimsCard, invoicesBlock,
  commsCard, healthCard, membersCard, timelineCard, copyLinkButton, jumpHandlers,
} from './partner360-kit.js';
import { agentSections } from './agent360.js';
import { shipperSections } from './shipper360.js';

export function renderPartner360(host, orgId) {
  mountPartner360(host, orgId, { broker: brokerSections, agent: agentSections, shipper: shipperSections, facility: brokerSections });
}
export const renderBroker360 = renderPartner360;

export function brokerSections(ctx) {
  const { d, manage } = ctx; const o = d.org || {}; const t = d.trust || {}; const sc = t.screening || null; const idn = t.identity || null;
  const j = d.journey || {}; const ls = d.load_stats || {}; const sla = d.sla || null; const pay = d.pay || {}; const ah = d.health || {}; const bk = d.brokerage || {};
  const H = jumpHandlers();

  // ---- hero ----
  const heroNode = hero(ctx, {
    sub: [
      el('span', null, ['MC ', el('b', null, dash(o.mc_number || (sc && sc.mc)))]),
      el('span', null, ['USDOT ', el('b', null, dash(o.dot_number || (sc && sc.dot)))]),
      sc && sc.legal_name ? el('span', null, ['FMCSA ', el('b', null, sc.legal_name)]) : null,
      el('span', null, ['tier ', tierPill(t.tier)]),
      t.can_post ? pill('green', 'can post · ' + n0(t.active_postings) + '/' + (t.posting_limit == null ? '∞' : t.posting_limit)) : pill('amber', 'cannot post'),
    ],
    actions: [
      ...holdReleaseButtons(ctx, brokerTrustAct),
      (manage && sc && sc.outcome !== 'pending') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'rescreen', { note: null, done: 'Re-screen requested — collector runs every minute' }) }, '↻ Re-screen FMCSA') : null,
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/broker-trust' }, 'Trust queue'),
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '/app/partner/', target: '_blank', rel: 'noopener', title: 'The partner portal (their own login — CC has no impersonation)' }, [icon('ext', 14), ' Partner portal']),
      copyLinkButton(),
    ].filter(Boolean),
  });

  // ---- KPIs ----
  const kpis = kpiRow([
    { icon: 'route', label: 'Journey', value: n0(j.done) + '/' + n0(j.total), sub: j.stage || '', accent: j.stage_tone === 'green' ? 'green' : j.stage_tone === 'red' ? 'red' : 'amber', onClick: H.journey },
    { icon: 'package', label: 'Open postings', value: n0(t.active_postings) + ' / ' + (t.posting_limit == null ? '∞' : t.posting_limit), sub: t.can_post ? 'posting allowed' : (t.reason || 'posting blocked').slice(0, 60), accent: t.can_post ? 'green' : 'amber', onClick: H.trust },
    { icon: 'clipboard', label: 'Loads (30 d)', value: String(n0(ls.last_30d)), sub: n0(ls.total) + ' total · ' + n0(ls.submitted) + ' awaiting review', accent: n0(ls.submitted) ? 'amber' : 'green', onClick: H.activity },
    { icon: 'check', label: 'Fill rate (90 d)', value: sla && sla.fill_rate_pct != null ? sla.fill_rate_pct + '%' : (n0(ls.total) ? Math.round(100 * n0(ls.covered) / n0(ls.total)) + '%' : '—'), sub: sla ? (n0(sla.covered) + ' covered of ' + n0(sla.submitted) + ' · on-time ' + (sla.on_time_pct != null ? sla.on_time_pct + '%' : '—')) : n0(ls.covered) + ' covered · ' + n0(ls.delivered) + ' delivered', accent: 'green' },
    { icon: 'wallet', label: 'Pays carriers in', value: pay && pay.eligible ? pay.median_days + ' d' : '—', sub: pay && pay.eligible ? (pay.within_30_pct + '% within 30 d · ' + pay.paid_n + ' payments') : 'no pay history yet (needs 3 payments / 2 carriers)', accent: pay && pay.eligible ? (pay.median_days <= 30 ? 'green' : 'amber') : 'amber' },
    { icon: 'shield', label: 'Health', value: String(ah.score ?? '—'), sub: String(ah.tier || '').replace('_', ' '), accent: ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : ah.tier ? 'red' : 'green', onClick: H.health },
  ]);

  // ---- trust ----
  const screenTone = !sc ? 'gray' : sc.outcome === 'pass' ? (t.authority_state === 'ok' ? 'green' : 'red') : sc.outcome === 'pending' ? 'amber' : sc.outcome === 'fail' ? 'red' : 'amber';
  const screenLabel = !sc ? 'never screened' : sc.outcome === 'pass' ? (t.authority_state === 'ok' ? 'PASS · authority active' : 'PASS but authority ' + t.authority_state) : String(sc.outcome || '').toUpperCase();
  const fmcsaHost = el('div', { style: 'margin-top:8px' });
  const dotIn = el('input', { class: 'cc-input', placeholder: 'DOT number', value: o.dot_number || (sc && sc.dot) || '', style: 'max-width:160px' });
  const trustCard = card([
    head('Trust engine — authority, identity, posting', el('div', { style: 'display:flex;gap:6px;align-items:center' }, [tierPill(t.tier), t.hold_reason ? pill('red', 'HOLD') : null])),
    t.hold_reason ? el('div', { class: 'p360-warn', style: 'margin-bottom:10px' }, ['⛔ On hold since ' + when(t.held_at) + ': ', el('b', null, t.hold_reason)]) : null,
    block('FMCSA authority screen', pill(screenTone, screenLabel), [
      sc ? facts([
        ['Legal name (FMCSA)', sc.legal_name], ['MC / DOT', dash(sc.mc) + ' / ' + dash(sc.dot)], ['Entity type', sc.entity_type],
        ['Broker authority', sc.broker_authority == null ? '—' : sc.broker_authority ? '✓ active' : '✕ none'], ['Carrier authority', sc.carrier_authority == null ? '—' : sc.carrier_authority ? 'yes' : 'no'],
        ['Source', sc.authority_source], ['FMCSA email / phone', dash(sc.fmcsa_email) + ' · ' + dash(sc.fmcsa_phone)], ['Domain matches signup', sc.domain_match == null ? '—' : sc.domain_match ? 'yes' : 'no'],
        ['Last pass', when(sc.last_pass_at)], ['Last attempt', when(sc.last_attempt_at || sc.checked_at) + (sc.last_outcome ? ' · ' + sc.last_outcome : '')], ['Attempts / consecutive fails', n0(sc.attempts) + ' / ' + n0(sc.consecutive_fail)],
        sc.fail_since ? ['Failing since', when(sc.fail_since)] : null, sc.stale_blocked_at ? ['Stale-blocked', when(sc.stale_blocked_at)] : null,
      ]) : el('div', { class: 'p360-empty' }, 'No MC screened yet. The portal asks for the MC on first login; you can also enter a DOT below to look them up.'),
      (sc && sc.reason) ? el('div', { class: sc.outcome === 'pass' && t.authority_state === 'ok' ? 'p360-note' : 'p360-warn', style: 'margin-top:8px' }, ['FMCSA says: ', el('b', null, sc.reason)]) : null,
      manage ? el('div', { class: 'p360-actions' }, [
        (sc && sc.outcome !== 'pending') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'rescreen', { done: 'Re-screen requested' }) }, '↻ Re-screen now') : null,
        (sc && sc.outcome !== 'pass') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => brokerTrustAct(ctx, 'pass', { ask: 'You checked FMCSA by hand — what did you see? (recorded; verifies authority + autofills MC / bond / BOC-3)', done: 'Authority verified by hand' }) }, '✓ Pass by hand') : null,
        (t.tier === 'authority_fail' || t.tier === 'authority_stale') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => brokerTrustAct(ctx, 'pass', { ask: t.tier === 'authority_stale' ? 'You checked FMCSA by hand and the authority IS active — what did you see? (clears the stale block)' : 'You checked FMCSA by hand and the authority IS active — what did you see? (clears the fail)', done: 'Cleared' }) }, '✓ Clear ' + (t.tier === 'authority_stale' ? 'stale' : 'fail') + ' by hand') : null,
      ].filter(Boolean)) : null,
    ]),
    block('Identity — is this really the brokerage?', !idn ? pill('gray', sc && sc.outcome === 'pass' ? 'not started' : 'after the screen') : idn.status === 'verified' ? pill('green', 'verified · ' + dash(idn.method)) : idn.declined_at ? pill('red', 'DECLINED by FMCSA contact') : pill('amber', dash(idn.status)), [
      idn ? facts([
        ['FMCSA-listed email', idn.fmcsa_email], ['FMCSA-listed phone', idn.fmcsa_phone], ['Signup email', idn.signup_email],
        ['Claim email sent', when(idn.email_sent_at) + (n0(idn.email_resends) ? ' · ' + idn.email_resends + ' resend(s)' : '')], ['Verified', idn.verified_at ? when(idn.verified_at) + (idn.verified_by ? ' · ' + idn.verified_by : '') : '—'],
        idn.declined_at ? ['Declined', when(idn.declined_at)] : null, idn.note ? ['Note', idn.note] : null,
      ]) : el('div', { class: 'cc-sub' }, 'Authority ≠ identity. Once the screen passes, LoadBoot confirms the person is the brokerage: signup-domain match, a claim email to the FMCSA-listed address, or a voice code to the FMCSA-listed phone. Staff can confirm on a call.'),
      (manage && sc && sc.outcome === 'pass' && !(idn && idn.status === 'verified')) ? el('div', { class: 'p360-actions' }, [
        (idn && idn.fmcsa_email) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'resend_identity', { done: 'Claim email re-sent' }) }, '✉ Resend claim email') : null,
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => brokerTrustAct(ctx, 'verify_identity', { ask: 'How did you verify identity? e.g. "called FMCSA number ' + dash(idn && idn.fmcsa_phone || (sc && sc.fmcsa_phone)) + ', spoke to the owner" (recorded):', done: 'Identity confirmed — broker notified' }) }, '✓ Confirm identity by hand'),
        el('button', { class: 'lb-btn lb-btn-sm p360-danger', onClick: () => brokerTrustAct(ctx, 'reject_identity', { ask: 'Why can identity NOT be confirmed? (the broker reads this; account goes on hold)', done: 'Identity rejected — account on hold' }) }, '✕ Reject identity'),
      ].filter(Boolean)) : null,
    ]),
    block('Posting allowance', t.can_post ? pill('green', 'can post') : pill('amber', 'blocked'), [
      facts([['Open postings', n0(t.active_postings) + ' of ' + (t.posting_limit == null ? 'unlimited' : t.posting_limit)], ['Override', t.posting_limit_override == null ? 'default (3 → 10 after first delivery → ∞ verified)' : String(t.posting_limit_override)], ['Agreement', t.agreement_ok ? '✓ accepted' : '✕ not accepted'], ['First delivery done', t.first_delivered ? 'yes' : 'no']]),
      (!t.can_post && t.reason) ? el('div', { class: 'p360-warn', style: 'margin-top:8px' }, ['Why posting is blocked (the partner reads the same words): ', el('b', null, t.reason)]) : null,
      (manage && t.tier !== 'verified') ? el('div', { class: 'p360-actions' }, [el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'set_limit', { ask: 'Open-posting limit for this broker (blank = default 3 / 10):', optional: true, placeholder: 'e.g. 5', done: 'Limit updated' }) }, 'Set posting limit')]) : null,
    ]),
    agreementBlock(ctx, 'broker_carrier', 'Master Broker Agreement'),
    ((bk.agents || []).length || (bk.invites || []).length) ? block('Agents posting under this brokerage', pill('blue', (bk.agents || []).length + ' agent(s) · ' + (bk.invites || []).length + ' invite(s)'), [
      (bk.agents || []).length ? el('table', { class: 'p360-table' }, [
        el('thead', null, el('tr', null, ['Agent', 'Status', 'Since', 'Loads'].map((h) => el('th', null, h)))),
        el('tbody', null, bk.agents.map((a) => el('tr', { class: 'click', onClick: () => { location.hash = '#/broker-agent?id=' + a.agent_org_id; } }, [
          el('td', null, [el('b', null, a.name), el('div', { class: 'cc-sub' }, dash(a.owner_email))]),
          el('td', null, pill(a.status === 'confirmed' ? 'green' : a.status === 'pending' ? 'amber' : 'red', a.status)), el('td', null, fmtDate(a.confirmed_at || a.created_at)), el('td', null, String(n0(a.loads))),
        ]))),
      ]) : null,
      (bk.invites || []).length ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Invites: ' + bk.invites.map((i) => i.email + ' (' + i.status + ')').join(', ')) : null,
    ]) : null,
    el('details', { style: 'margin-top:10px' }, [
      el('summary', { class: 'cc-sub', style: 'cursor:pointer;font-weight:700' }, 'Live FMCSA lookup by DOT (government record, 7 tabs)'),
      el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap' }, [dotIn, el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => { const dot = (dotIn.value || '').replace(/\D/g, ''); if (!dot) { toast('Enter the DOT number from their authority letter.'); return; } renderFmcsaOnly(fmcsaHost, dot, { light: true }); } }, 'Look up')]),
      fmcsaHost,
    ]),
  ].filter(Boolean));

  // ---- money / performance block (activity side) ----
  const perfCard = card([
    head('Performance & money', sla ? el('span', { class: 'cc-sub' }, sla.window_days + '-day window') : null),
    sla ? facts([['Fill rate', sla.fill_rate_pct != null ? sla.fill_rate_pct + '%' : '—'], ['On-time', sla.on_time_pct != null ? sla.on_time_pct + '%' : '—'], ['Submitted / posted / covered', n0(sla.submitted) + ' / ' + n0(sla.posted) + ' / ' + n0(sla.covered)], ['Delivered', String(n0(sla.delivered))], ['Avg hours to cover', sla.avg_hours_to_cover != null ? String(sla.avg_hours_to_cover) : '—'], ['Open exceptions', String(n0(sla.open_exceptions))]]) : el('div', { class: 'cc-sub' }, 'SLA ranking needs partners.view.'),
    block('Pays carriers (delivered → received, 12 mo)', pay && pay.eligible ? pill(pay.median_days <= 30 ? 'green' : 'amber', 'median ' + pay.median_days + ' d') : pill('gray', 'no history yet'), [
      facts([['Payments', n0(pay && pay.paid_n)], ['Carriers paid', n0(pay && pay.carriers_n)], ['Within 30 days', pay && pay.within_30_pct != null ? pay.within_30_pct + '%' : '—'], ['Last payment', pay && pay.last_paid_at ? fmtDate(pay.last_paid_at) : '—']]),
      el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Shown to carriers on load cards once ≥ 3 payments from ≥ 2 carriers (bl_bp_0452).'),
    ]),
    invoicesBlock(ctx),
    n0(d.update_requests_open) ? el('div', { class: 'p360-warn', style: 'margin-top:10px' }, d.update_requests_open + ' dispatch update request(s) open — unanswered beyond 48 h costs health points.') : null,
  ].filter(Boolean));

  const sections = [
    section('p360-journey', 'Journey', journeyCard(ctx, H), ctx),
    section('p360-trust', 'Trust', trustCard, ctx),
    section('p360-packet', 'Packet', el('div', null, [packetCard(ctx, { title: 'Broker onboarding packet' }), el('div', { style: 'margin-top:16px' }, bankCard(ctx)), el('div', { style: 'margin-top:16px' }, gateRow(ctx, { approveBody: 'Approve this broker? Posting goes live under their own MC and they are notified.' }))]), ctx),
    section('p360-activity', 'Activity', el('div', null, [loadsCard(ctx, 'Loads posted by this broker'), el('div', { class: 'p360-grid2' }, [claimsCard(ctx), perfCard])]), ctx),
    section('p360-comms', 'Comms', commsCard(ctx), ctx),
    section('p360-health', 'Health', healthCard(ctx), ctx),
    section('p360-people', 'People', membersCard(ctx), ctx),
    section('p360-timeline', 'Timeline', timelineCard(ctx), ctx),
  ];
  return [heroNode, nextActionBanner(ctx, H), kpis, sectionNav(ctx.sections), ...sections];
}

export default renderPartner360;
