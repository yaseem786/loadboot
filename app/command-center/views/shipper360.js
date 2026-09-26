// shipper360.js — Shipper 360. bl_bp_0455. Rendered by the partner 360 dispatcher (broker360.js) when role = 'shipper'.
//
// A shipper has no MC / DOT and no FMCSA record. Trust is commercial: the company-email domain check
// (MX + website + name match, bl_bp_0319), a company-email code when they signed up with free mail, the
// Shipper Agreement, and a 3-item packet (billing instructions, claims contact, signed agreement) that
// unlocks booking. Quotes open on business_verified; the packet gates the first booking.
import { el } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { card } from '../../shared/ui/components.js';
import {
  hero, nextActionBanner, kpiRow, sectionNav, section, head, facts, block, pill, tierPill, dash, n0, when,
  journeyCard, shipperTrustAct, holdReleaseButtons, gateRow, packetCard, bankCard, agreementBlock, loadsCard, shipmentsCard, claimsCard, invoicesBlock,
  commsCard, healthCard, membersCard, timelineCard, copyLinkButton, jumpHandlers,
} from './partner360-kit.js';

export function shipperSections(ctx) {
  const { d, manage } = ctx; const o = d.org || {}; const t = d.trust || {}; const j = d.journey || {}; const ss = d.shipment_stats || {}; const ls = d.load_stats || {}; const ah = d.health || {}; const ps = d.packet_summary || {};
  const H = jumpHandlers();
  const checkTone = t.verified_at ? 'green' : t.check_outcome === 'pass' ? 'green' : t.check_outcome === 'free_mail' ? 'amber' : t.check_outcome ? 'red' : 'gray';
  const checkLabel = t.verified_at ? ('verified' + (t.verified_by && t.verified_by.length <= 28 ? ' · ' + t.verified_by : '')) : t.check_outcome ? String(t.check_outcome).replace('_', ' ') : (t.requested_at ? 'checking…' : 'not started');

  const heroNode = hero(ctx, {
    sub: [
      el('span', null, ['domain ', el('b', null, dash(t.domain))]),
      t.site_title ? el('span', null, ['website ', el('b', null, t.site_title)]) : null,
      el('span', null, ['tier ', tierPill(t.tier)]),
      t.can_post ? pill('green', 'can request quotes') : pill('amber', 'quotes blocked'),
    ],
    actions: [
      ...holdReleaseButtons(ctx, shipperTrustAct),
      manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => shipperTrustAct(ctx, 'recheck', { done: 'Domain re-check requested — collector runs every minute' }) }, '↻ Re-check domain') : null,
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/broker-trust' }, 'Trust queue'),
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/partner-intake' }, 'Shipper freight'),
      el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '/app/partner/', target: '_blank', rel: 'noopener' }, [icon('ext', 14), ' Partner portal']),
      copyLinkButton(),
    ].filter(Boolean),
  });

  const kpis = kpiRow([
    { icon: 'route', label: 'Journey', value: n0(j.done) + '/' + n0(j.total), sub: j.stage || '', accent: j.stage_tone === 'green' ? 'green' : j.stage_tone === 'red' ? 'red' : 'amber', onClick: H.journey },
    { icon: 'building', label: 'Business check', value: t.verified_at ? '✓' : t.check_outcome === 'pass' ? '✓' : t.check_outcome === 'free_mail' ? 'free mail' : t.check_outcome ? String(t.check_outcome) : '…', sub: checkLabel, accent: checkTone === 'green' ? 'green' : checkTone === 'red' ? 'red' : 'amber', onClick: H.trust },
    { icon: 'package', label: 'Requests (30 d)', value: String(n0(ss.last_30d) + n0(ls.last_30d)), sub: (n0(ss.total) + n0(ls.total)) + ' total · ' + n0(ss.open) + ' open · ' + n0(ss.quoted) + ' quoted', accent: n0(ss.open) ? 'amber' : 'green', onClick: H.activity },
    { icon: 'check', label: 'Booked', value: String(n0(ss.booked) + n0(ls.covered)), sub: 'tendered / booked / covered', accent: 'green', onClick: H.activity },
    { icon: 'doc', label: 'Packet', value: n0(ps.mandatory_done) + '/' + n0(ps.mandatory_total), sub: n0(ps.awaiting) ? ps.awaiting + ' awaiting your review' : 'billing · claims contact · agreement', accent: n0(ps.awaiting) ? 'amber' : (n0(ps.mandatory_done) >= n0(ps.mandatory_total) && n0(ps.mandatory_total)) ? 'green' : 'amber', onClick: H.packet },
    { icon: 'shield', label: 'Health', value: String(ah.score ?? '—'), sub: String(ah.tier || '').replace('_', ' '), accent: ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : ah.tier ? 'red' : 'green', onClick: H.health },
  ]);

  const trustCard = card([
    head('Business verification — no FMCSA record, verified commercially', el('div', { style: 'display:flex;gap:6px;align-items:center' }, [tierPill(t.tier), t.hold_reason ? pill('red', 'HOLD') : null])),
    t.hold_reason ? el('div', { class: 'p360-warn', style: 'margin-bottom:10px' }, ['⛔ On hold since ' + when(t.held_at) + ': ', el('b', null, t.hold_reason)]) : null,
    block('Company-domain check (bl_bp_0319)', pill(checkTone, checkLabel), [
      facts([
        ['Domain', t.domain], ['Free-mail signup', t.free_mail == null ? '—' : t.free_mail ? 'yes — must verify a company email' : 'no'],
        ['Mail (MX) records', t.mx == null ? '—' : t.mx ? '✓ found' : '✕ none'], ['Website', t.site_ok == null ? '—' : t.site_ok ? '✓ ' + dash(t.site_title) : '✕ not reachable'],
        t.site_url ? ['Site URL', el('a', { href: t.site_url, target: '_blank', rel: 'noopener' }, t.site_url)] : null,
        ['Company name on site', t.name_match == null ? '—' : t.name_match ? '✓ matches' : '✕ no match'],
        ['Outcome', dash(t.check_outcome) + (t.check_reason ? ' · ' + t.check_reason : '')], ['Requested / checked', when(t.requested_at) + ' / ' + when(t.checked_at)], ['Attempts', String(n0(t.attempts))],
        ['Verified', t.verified_at ? when(t.verified_at) + ' by ' + dash(t.verified_by) : '—'], t.dot ? ['DOT (optional)', t.dot] : null,
      ]),
      manage ? el('div', { class: 'p360-actions' }, [
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => shipperTrustAct(ctx, 'recheck', { done: 'Re-check requested' }) }, '↻ Re-check domain'),
        !t.verified_at ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => shipperTrustAct(ctx, 'verify', { ask: 'How did you verify the business? (called them, EIN letter, invoice, website… — recorded)', done: 'Business verified — shipper notified' }) }, '✓ Verify business by hand') : null,
      ].filter(Boolean)) : null,
    ]),
    block('Company email (free-mail signups)', t.email_verified_at ? pill('green', 'verified') : t.free_mail ? (t.code_live ? pill('blue', 'code sent · live') : pill('amber', 'not verified')) : pill('gray', 'not needed'), [
      facts([['Company email', t.company_email], ['Verified', when(t.email_verified_at)], ['Live code', t.code_live ? 'yes — waiting for them to type it' : 'no']]),
      (t.free_mail && !t.email_verified_at) ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'They signed up with ' + dash(t.domain) + '. The portal asks for a company address and emails a 6-digit code (shipper.company_email); the domain check re-runs on that domain. If they have no company domain at all, verify by hand above.') : null,
    ]),
    agreementBlock(ctx, 'broker_shipper', 'Shipper Agreement'),
    block('Quote allowance', t.can_post ? pill('green', 'can request quotes') : pill('amber', 'blocked'), [
      facts([['Allowed now', t.can_post ? 'yes' : 'no'], ['Rule', 'Quotes open on business_verified · first booking needs the 3-item packet (billing, claims contact, agreement)']]),
      (!t.can_post && t.reason) ? el('div', { class: 'p360-warn', style: 'margin-top:8px' }, ['Why blocked (the shipper reads the same words): ', el('b', null, t.reason)]) : null,
    ]),
  ].filter(Boolean));

  const sections = [
    section('p360-journey', 'Journey', journeyCard(ctx, H), ctx),
    section('p360-trust', 'Verification', trustCard, ctx),
    section('p360-packet', 'Packet', el('div', null, [
      packetCard(ctx, { title: 'Shipper packet — billing, claims contact, agreement', explainer: 'Three required items unlock booking; conditional items (payment terms, credit application, special commodity) apply only when relevant; the rest are optional. No FMCSA / bond / BOC-3 — shippers are not carriers or brokers.' }),
      el('div', { style: 'margin-top:16px' }, bankCard(ctx)),
      el('div', { style: 'margin-top:16px' }, gateRow(ctx, { approveBody: 'Approve this shipper? Booking goes live and they are notified.' })),
    ]), ctx),
    section('p360-activity', 'Activity', el('div', null, [shipmentsCard(ctx), n0(ls.total) ? el('div', { style: 'margin-top:16px' }, loadsCard(ctx, 'Loads this shipper posted directly')) : null, el('div', { class: 'p360-grid2' }, [claimsCard(ctx), card([head('Money'), invoicesBlock(ctx)])])]), ctx),
    section('p360-comms', 'Comms', commsCard(ctx), ctx),
    section('p360-health', 'Health', healthCard(ctx), ctx),
    section('p360-people', 'People', membersCard(ctx), ctx),
    section('p360-timeline', 'Timeline', timelineCard(ctx), ctx),
  ];
  return [heroNode, nextActionBanner(ctx, H), kpis, sectionNav(ctx.sections), ...sections];
}

export default shipperSections;
