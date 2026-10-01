// shipper360.js — Shipper 360. bl_bp_0455. Rendered by the partner 360 dispatcher (broker360.js) when role = 'shipper'.
//
// A shipper has no MC / DOT and no FMCSA record. Trust is commercial and lives in the Two-lane verification card
// (bl_ship_0491: identity, registry, call-back, lane gates). The old domain-check "Verification" card (bl_bp_0319)
// was removed in bl_ship_0508 — its signals are shown on the two-lane card.
import { el } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { card } from '../../shared/ui/components.js';
import {
  hero, nextActionBanner, kpiRow, sectionNav, section, head, pill, tierPill, dash, n0,
  journeyCard, shipperTrustAct, holdReleaseButtons, gateRow, bankCard, shipperScoreGate, loadsCard, shipmentsCard, claimsCard, invoicesBlock,
  commsCard, healthCard, membersCard, timelineCard, copyLinkButton, jumpHandlers,
} from './partner360-kit.js';
import { shipperVerifyCard } from './shipperVerify360.js';  // bl_ship_0491

export function shipperSections(ctx) {
  const { d, manage } = ctx; const o = d.org || {}; const t = d.trust || {}; const j = d.journey || {}; const ss = d.shipment_stats || {}; const ls = d.load_stats || {}; const ah = d.health || {};
  const H = jumpHandlers();
  // bl_ship_0508: the old domain-check "Verification" card is gone; "Open trust" lands on Two-lane verification
  H.trust = () => { const x = document.getElementById('p360-lanes'); if (x) x.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  H.packet = H.trust;  // the A–G items are on Two-lane verification now
  H.labels = Object.assign({}, H.labels, { trust: 'Open verification', packet: 'Review A–G items' });

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

  const sg = shipperScoreGate(ctx);  // bl_ship_0510: no score for a held / not-yet-verified shipper
  const kpis = kpiRow([
    { icon: 'route', label: 'Journey', value: n0(j.done) + '/' + n0(j.total), sub: j.stage || '', accent: j.stage_tone === 'green' ? 'green' : j.stage_tone === 'red' ? 'red' : 'amber', onClick: H.journey },
    { icon: 'building', label: 'Verification', value: String(t.tier || 'new').replace('_', ' '), sub: t.hold_reason ? 'on hold' : t.can_post ? 'a lane is open' : 'no lane open yet', accent: t.hold_reason ? 'red' : t.can_post ? 'green' : 'amber', onClick: H.trust },
    { icon: 'package', label: 'Requests (30 d)', value: String(n0(ss.last_30d) + n0(ls.last_30d)), sub: (n0(ss.total) + n0(ls.total)) + ' total · ' + n0(ss.open) + ' open · ' + n0(ss.quoted) + ' quoted', accent: n0(ss.open) ? 'amber' : 'green', onClick: H.activity },
    { icon: 'check', label: 'Booked', value: String(n0(ss.booked) + n0(ls.covered)), sub: 'tendered / booked / covered', accent: 'green', onClick: H.activity },
    sg ? { icon: 'shield', label: 'Health', value: '—', sub: sg.short, accent: sg.tone === 'red' ? 'red' : 'amber', onClick: H.health }
       : { icon: 'shield', label: 'Health', value: String(ah.score ?? '—'), sub: String(ah.tier || '').replace('_', ' '), accent: ah.tier === 'healthy' ? 'green' : ah.tier === 'at_risk' ? 'amber' : ah.tier ? 'red' : 'green', onClick: H.health },
  ]);

  const sections = [
    section('p360-journey', 'Journey', journeyCard(ctx, H), ctx),
    section('p360-lanes', 'Two-lane verification', shipperVerifyCard(ctx), ctx),  // bl_ship_0491
    // The A–G items live on Two-lane verification (shipperItems360.js). The old generic packet list here was a duplicate,
    // and its Verify could mark phone_verify / independent_callback done without the code or the call — removed.
    section('p360-packet', 'Bank & approval', el('div', null, [
      bankCard(ctx),
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
