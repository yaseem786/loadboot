// agent360.js — Broker Agent 360 (an agent posting under one or more brokerages' authority). bl_bp_0455.
// Rendered by the partner 360 dispatcher in broker360.js when cc_partner_360.role = 'agent'.
//
// What is different from a broker: there is no own MC. The trust story is "which brokerage(s) declared →
// screened → confirmed", the account gate is brokerage confirmation (bl_bp_0448), and the packet
// (W-9 / bank / claims contact) never gates approval — it only lifts the per-brokerage posting limit.
import { el } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { card, fmtDate } from '../../shared/ui/components.js';
import {
  hero, nextActionBanner, kpiRow, sectionNav, section, head, facts, block, pill, tierPill, dash, n0, when, agoOr,
  journeyCard, brokerTrustAct, holdReleaseButtons, gateRow, packetCard, bankCard, agreementBlock, loadsCard, claimsCard, invoicesBlock,
  commsCard, healthCard, membersCard, timelineCard, copyLinkButton, jumpHandlers,
} from './partner360-kit.js';

const P_TONE = { confirmed: 'green', pending: 'amber', screening: 'gray', failed: 'red', needs_human: 'red', declined: 'red', revoked: 'red' };
const P_LABEL = { confirmed: 'confirmed', pending: 'awaiting confirmation', screening: 'screening MC', failed: 'MC not a brokerage', needs_human: 'FMCSA unclear — needs a human', declined: 'declined', revoked: 'revoked' };

export function agentSections(ctx) {
  const { d, manage } = ctx; const o = d.org || {}; const t = d.trust || {}; const parents = Array.isArray(t.parents) ? t.parents : [];
  const j = d.journey || {}; const ls = d.load_stats || {}; const ah = d.health || {}; const inv = Array.isArray(t.invites_received) ? t.invites_received : [];
  const conf = parents.filter((p) => p.status === 'confirmed'); const pend = parents.filter((p) => p.status === 'pending' || p.status === 'screening'); const bad = parents.filter((p) => ['failed', 'needs_human', 'declined', 'revoked'].includes(p.status));
  const H = jumpHandlers();
  const canApprove = t.tier === 'agent_confirmed' || t.tier === 'verified';

  const heroNode = hero(ctx, {
    sub: [
      el('span', null, ['agent of ', el('b', null, conf.length ? conf.map((p) => p.name).join(', ') : (pend.length ? pend[0].name + ' (unconfirmed)' : 'no brokerage yet'))]),
      el('span', null, ['tier ', tierPill(t.tier)]),
      t.can_post ? pill('green', 'can post · ' + n0(t.active_postings) + ' open') : pill('amber', 'cannot post'),
      pill('gray', parents.length + ' brokerage' + (parents.length === 1 ? '' : 's') + ' declared'),
    ],
    actions: [
      ...holdReleaseButtons(ctx, brokerTrustAct),
      (manage && pend.length) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'resend_parent', { done: 'Confirmation code email re-sent to the brokerage' }) }, '✉ Resend code email') : null,
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/broker-trust' }, 'Trust queue'),
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '/app/partner/', target: '_blank', rel: 'noopener' }, [icon('ext', 14), ' Partner portal']),
      copyLinkButton(),
    ].filter(Boolean),
  });

  const kpis = kpiRow([
    { icon: 'route', label: 'Journey', value: n0(j.done) + '/' + n0(j.total), sub: j.stage || '', accent: j.stage_tone === 'green' ? 'green' : j.stage_tone === 'red' ? 'red' : 'amber', onClick: H.journey },
    { icon: 'handshake', label: 'Brokerages', value: conf.length + ' / ' + parents.length, sub: conf.length ? 'confirmed / declared' : pend.length ? pend.length + ' awaiting the brokerage' : bad.length ? bad.length + ' need attention' : 'none declared yet', accent: conf.length ? 'green' : bad.length ? 'red' : 'amber', onClick: H.trust },
    { icon: 'package', label: 'Open postings', value: String(n0(t.active_postings)), sub: t.can_post ? 'per-brokerage limit 3 → 10 after first delivery' : (t.reason || 'posting blocked').slice(0, 64), accent: t.can_post ? 'green' : 'amber', onClick: H.trust },
    { icon: 'clipboard', label: 'Loads (30 d)', value: String(n0(ls.last_30d)), sub: n0(ls.total) + ' total · ' + n0(ls.covered) + ' covered · ' + n0(ls.delivered) + ' delivered', accent: 'green', onClick: H.activity },
    { icon: 'doc', label: 'Packet', value: n0((d.packet_summary || {}).mandatory_done) + '/' + n0((d.packet_summary || {}).mandatory_total), sub: 'W-9 · bank · claims contact (lifts the limit, never gates)', accent: 'green', onClick: H.packet },
    { icon: 'shield', label: 'Health', value: String(ah.score ?? '—'), sub: String(ah.tier || '').replace('_', ' '), accent: ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : ah.tier ? 'red' : 'green', onClick: H.health },
  ]);

  // ---- trust: brokerages ----
  const parentRow = (p) => el('div', { class: 'p360-block', style: 'margin-top:10px' }, [
    el('div', { class: 'p360-block-h' }, [
      el('div', null, [el('b', null, p.name || p.declared_name || 'MC ' + dash(p.mc)), el('span', { class: 'cc-sub' }, ' · MC ' + dash(p.mc) + (p.declared_name && p.declared_name !== p.name ? ' · declared as "' + p.declared_name + '"' : ''))]),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
        pill(P_TONE[p.status] || 'gray', P_LABEL[p.status] || p.status),
        p.on_loadboot ? el('a', { class: 'cc-pill cc-pill-blue', href: '#/broker?id=' + p.parent_org_id, title: 'This brokerage has its own LoadBoot account' }, 'on LoadBoot → ' + (p.parent_org_name || 'open')) : pill('gray', 'not on LoadBoot'),
      ]),
    ]),
    facts([
      ['FMCSA screen', (p.screen ? String(p.screen).toUpperCase() : 'pending') + (p.screen_reason ? ' · ' + p.screen_reason : '') + (p.last_pass_at ? ' · last pass ' + fmtDate(p.last_pass_at) : '') + (n0(p.consecutive_fail) ? ' · ' + p.consecutive_fail + ' re-screen fails' : '')],
      ['FMCSA-listed contact', dash(p.fmcsa_email) + ' · ' + dash(p.fmcsa_phone)],
      ['Confirmation sent to', p.sent_at ? dash(p.sent_to) + ' · ' + when(p.sent_at) + (p.reminded_at ? ' · reminded ' + when(p.reminded_at) : '') : (p.contact_email ? 'agent gave ' + p.contact_email + ' (' + dash(p.contact_source) + ')' : '—')],
      ['Decision', p.confirmed_at ? '✓ confirmed ' + when(p.confirmed_at) + ' by ' + dash(p.confirmed_by) : p.declined_at ? '✕ declined ' + when(p.declined_at) : p.revoked_at ? '✕ revoked ' + when(p.revoked_at) + ' by ' + dash(p.revoked_by) : 'pending'],
      p.mc_nudge_at ? ['MC nudge email', when(p.mc_nudge_at) + ' (bl_bp_0449: MC is not a brokerage / not found)'] : null,
      ['Loads under this brokerage', String(n0(p.loads))], p.note ? ['Note', p.note] : null,
    ]),
  ]);
  const trustCard = card([
    head('Brokerages this agent posts under', el('div', { style: 'display:flex;gap:6px;align-items:center' }, [tierPill(t.tier), t.hold_reason ? pill('red', 'HOLD') : null])),
    t.hold_reason ? el('div', { class: 'p360-warn', style: 'margin-bottom:10px' }, ['⛔ On hold since ' + when(t.held_at) + ': ', el('b', null, t.hold_reason)]) : null,
    el('div', { class: 'p360-note' }, 'An agent has no MC, bond or BOC-3 of their own — they post under a brokerage’s authority. LoadBoot screens the declared MC on FMCSA, then emails the FMCSA-listed address a 6-digit code + confirm link; the brokerage (or its LoadBoot owner) confirms. Staff can confirm on a phone call. A declined brokerage puts the agent on hold.'),
    parents.length ? parents.map(parentRow) : el('div', { class: 'p360-empty' }, 'No brokerage declared yet — the portal agent card asks for the brokerage MC on first login.'),
    manage ? el('div', { class: 'p360-actions' }, [
      pend.length ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'resend_parent', { done: 'Code email re-sent' }) }, '✉ Resend code email') : null,
      (pend.length || bad.some((p) => p.status === 'declined')) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => brokerTrustAct(ctx, 'confirm_parent', { ask: 'What did you check? (agent agreement, spoke with the brokerage… — recorded; confirms the newest undecided brokerage)', done: 'Brokerage confirmed by hand — agent notified' }) }, '✓ Confirm brokerage by hand') : null,
      bad.some((p) => p.status === 'needs_human' || p.status === 'failed') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'rescreen', { done: 'Re-screen requested' }) }, '↻ Re-screen the MC') : null,
      (t.tier !== 'verified') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => brokerTrustAct(ctx, 'set_limit', { ask: 'Open-posting limit for this agent (blank = default 3 / 10 per brokerage):', optional: true, placeholder: 'e.g. 5', done: 'Limit updated' }) }, 'Set posting limit') : null,
    ].filter(Boolean)) : null,
    block('Posting allowance', t.can_post ? pill('green', 'can post') : pill('amber', 'blocked'), [
      facts([['Open postings', String(n0(t.active_postings))], ['Limit', t.posting_limit == null ? 'per brokerage: 3 → 10 after first delivery' : String(t.posting_limit)], ['Agreement', t.agreement_ok ? '✓ accepted' : '✕ not accepted']]),
      (!t.can_post && t.reason) ? el('div', { class: 'p360-warn', style: 'margin-top:8px' }, ['Why posting is blocked (the agent reads the same words): ', el('b', null, t.reason)]) : null,
    ]),
    agreementBlock(ctx, 'broker_carrier', 'Master Broker Agreement (the agent org accepts it too)'),
    inv.length ? block('Invites received', pill('blue', inv.length + ''), inv.map((i) => el('div', { class: 'p360-row' }, [el('div', null, [el('b', null, i.from), el('div', { class: 'cc-sub' }, dash(i.status))]), el('div', { class: 'cc-sub' }, when(i.accepted_at || i.created_at))]))) : null,
  ].filter(Boolean));

  const sections = [
    section('p360-journey', 'Journey', journeyCard(ctx, H), ctx),
    section('p360-trust', 'Brokerages', trustCard, ctx),
    section('p360-packet', 'Packet', el('div', null, [
      packetCard(ctx, { title: 'Agent packet — W-9, bank, claims contact', notGating: true, collapsed: true, explainer: 'Broker agent: bond, BOC-3 and MC authority belong to the brokerage they post under, so this packet does not gate approval — brokerage confirmation does. The authority items are auto-filled from the brokerage’s FMCSA pass; W-9, bank and claims contact lift the per-brokerage posting limit once verified. Review anything they upload as usual.' }),
      el('div', { style: 'margin-top:16px' }, bankCard(ctx)),
      el('div', { style: 'margin-top:16px' }, gateRow(ctx, { canApprove, whyNot: 'needs brokerage confirmation', approveBody: 'Approve this broker agent? A brokerage has confirmed them; they post under that brokerage’s MC and are notified.' })),
    ]), ctx),
    section('p360-activity', 'Activity', el('div', null, [loadsCard(ctx, 'Loads posted by this agent'), el('div', { class: 'p360-grid2' }, [claimsCard(ctx), card([head('Money'), invoicesBlock(ctx)])])]), ctx),
    section('p360-comms', 'Comms', commsCard(ctx), ctx),
    section('p360-health', 'Health', healthCard(ctx), ctx),
    section('p360-people', 'People', membersCard(ctx), ctx),
    section('p360-timeline', 'Timeline', timelineCard(ctx), ctx),
  ];
  return [heroNode, nextActionBanner(ctx, H), kpis, sectionNav(ctx.sections), ...sections];
}

export default agentSections;
